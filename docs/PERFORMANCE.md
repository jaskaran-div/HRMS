# Performance, infrastructure & cost audit — November 2026

Scope: the HRMS web app (this repo), the Expo app (`~/Desktop/hrms-mobile`), the Supabase schema, and how they run on EC2.

## 1. Architecture as it actually is

| Piece | Reality |
|---|---|
| Web | Next.js 15 App Router, one `next start` process under PM2 on EC2 (ap-southeast-2, Sydney), behind nginx |
| Backend | Next.js route handlers (`app/api/*`). There is no Express server. |
| Database | Supabase (hosted Postgres + PostgREST + Auth) in **eu-west-1 (Ireland)** |
| Data path | HR pages query Supabase **directly from the browser** (Row Level Security enforces the organization); the employee portal, mobile API and cron go through the server with the service-role key |
| Mobile | Expo / React Native, calls `/api/mobile/*` with a Bearer token |
| Background work | crontab every 10 min → `/api/cron/absent`; `/api/cron/purge` is **not scheduled on EC2** |

Production data today is small (1 organization, 27 employees, 49 check-ins). **At this size the database's execution time is negligible; what users wait for is the number of sequential network round trips**, each of which crosses Sydney ↔ Ireland on the server side.

## 2. Measurements

### Round-trip cost (measured from a dev machine in India; the server was not measured, see §8)

| | median |
|---|---|
| One Supabase REST request (HEAD, 1 row) | 179–210 ms |
| One Supabase Auth `getUser()` request | 234 ms |
| Local ES256 JWT verification (`getClaims()`, key cached) | 0.85 ms |
| Creating a service-role client | 0.18 ms, ~17 KB heap |

### Row Level Security at SaaS scale (local Postgres 18, the real `schema.sql` + `saas.sql`, 100 orgs × 300 employees, 180k attendance rows, 600k check-ins, 150k leave requests; queries run as an org admin through RLS; warm session, median of 7)

| Query | Before | After `supabase/perf.sql` |
|---|---|---|
| All active employees (300 rows) | 18.5 ms | **1.7 ms** |
| Attendance for one month | 16.8 ms | **0.7 ms** |
| Check-ins for one day | 16.9 ms | **1.0 ms** |
| All leave requests of the org | 77.9 ms | **2.2 ms** |
| Count of the org's attendance rows | 75.8 ms | **0.8 ms** |
| 6 pending leave requests (LIMIT) | 0.27 ms | 0.46 ms (noise) |

Isolation was checked before and after: the admin sees exactly their 300 employees, an employee login sees 0, no login sees 0.

### Browser JavaScript (`next build`, first load, gzipped)

| Page | Before | After |
|---|---|---|
| /attendance | 351 kB | **194 kB** (−45 %) |
| /import | 342 kB | **185 kB** (−46 %) |
| every other page | unchanged | unchanged |

### Sequential round trips per request (counted from the code; multiply by the server's RTT)

| Request | Before | After |
|---|---|---|
| Any page / web API call (middleware auth check) | +1 Auth call | 0 (local verify) |
| HR dashboard data (browser → Supabase) | 4 waves | 2 waves |
| Every `/api/mobile/*` call (`mobileSession`) | 4 | 3 |
| App's 30 s check-in refresh `GET /api/mobile/punch?only=today`, after check-in | 6 | 4 |
| Check-in `POST /api/mobile/punch` (incl. marking attendance) | 10 | 7 |
| Absent cron, per run, while nothing is due (most runs) | 1 + 3×orgs + more | 3 in total |

## 3. Bottlenecks found (by impact)

1. **Server and database on opposite sides of the world** (Sydney ↔ Ireland). Every server-side query pays this. Not a code issue — see §7, item 1.
2. **RLS policies call functions per row.** `can_read()` = memberships ⋈ profiles + `org_has_access()`; without `(select …)` Postgres re-runs it for each row. 10–90× at SaaS scale (table above). Fixed by `supabase/perf.sql`.
3. **Double authentication per request.** Middleware called Supabase Auth, then the page / route called it again. Fixed in middleware (see §4.1).
4. **Mobile check-in screen polls every 30 s**, also while the app is in the background (Android keeps JS timers alive for a while), and the live GPS watch (high accuracy, every 3 s) kept running in the background. Fixed in the app.
5. **Sequential queries that don't depend on each other** (dashboard, mobile session, punch route, `writeDay`). Fixed.
6. **Absent cron did a full scan 144×/day** and marked employees one at a time (300 employees × 2–3 round trips ≈ minutes at the deadline run). Fixed.
7. **SheetJS (~157 kB gz) shipped with Attendance and Import** even when no sheet is used. Now loaded on demand.
8. **Rate limits could be bypassed**: they were keyed on the left-most `X-Forwarded-For`, which the caller controls. Fixed.

Checked and found fine: no polling in the web app, no `console.log` noise, no memory leaks found (timers and listeners are cleaned up; the rate limiter's map is pruned), indexes cover every hot query (verified with the plans; no missing index found), FK columns used in lookups are indexed, tokens are stored hashed with unique indexes, uploads are size-capped and only safe types render inline (`nosniff`), payslip PDFs already load pdfmake on demand, duplicate check-ins are blocked by `unique (employee_id, day)` plus a 409.

## 4. Changes made

### 4.1 Web / server (this repo)

| File | Change |
|---|---|
| `middleware.ts` | `getUser()` → `getClaims()`: verifies the access token's signature locally with the project's ES256 public key (cached in-process by auth-js). Still refreshes expired sessions. Pages and API routes still call `getUser()` (authoritative, catches revoked sessions), so security is unchanged. `/api/health` excluded from middleware. |
| `lib/supabase/admin.ts` | One service-role client per process instead of one per call (it never holds a session: verified that nothing signs in with it). Logs DB requests slower than `SLOW_QUERY_MS` (default 1000; 0 = off) as `[slow-db] METHOD /rest/v1/table STATUS ms` — no query string, body or result, so no employee data reaches the log. |
| `lib/mobile.ts` | Team leader embedded in the employee query (as the web portal already did): −1 round trip on every mobile API call. |
| `app/api/mobile/punch/route.ts` | Today's short / half-day leave read once, in parallel with today's punch and shift; both the check-in rule and the early-check-out rule use it (same filters as before). Late count fetched only when a check-in is possible (GET) / in parallel (POST check-in). Rules unchanged. |
| `lib/attendance-mark.ts` | The month's attendance row and its approved half days read in parallel. |
| `app/api/cron/absent/route.ts` | Settings, organizations and shifts of all orgs in 3 queries (was 1 per org). An org is skipped when no window (company or any of its shifts) has closed yet — exactly when the per-employee loop could not do anything. Marks up to 8 employees at once. Response lists only orgs that were processed (`not_due` is a count), so the cron log stays small. |
| `app/(app)/page.tsx` | Dashboard: 2 parallel rounds instead of 4; employees loaded with the 5 columns it uses (1.5 KB instead of 9.4 KB for 27 employees; the imported sheet's `extra` data no longer goes to the dashboard). |
| `lib/sheet.ts` | SheetJS loaded on first use; `downloadXlsx` reports its own failure. `tests/run.ts` passes `XLSX` to `rowsFromWorkbook`. |
| `lib/auth.ts` | `clientIp()` (rate limits) = `trustedClientIp()` (X-Real-IP, else the right-most X-Forwarded-For). |
| `app/api/health/route.ts` | New. Public: `{ ok, uptime_s }` without touching the DB. With `Authorization: Bearer $CRON_SECRET`: also `db_ms`, `rss_mb`, `heap_mb`, 503 if the DB is unreachable. |
| `ecosystem.config.cjs` | New, optional PM2 file: one fork process, `max_memory_restart`, log timestamps, graceful kill timeout. |
| `scripts/server-check.sh` | New, read-only: CPU / RAM / disk, PM2 memory / restarts, log sizes, crontab, health, server → Supabase RTT. |

API responses are unchanged except the cron's (`not_due` added, skipped orgs no longer listed).

### 4.2 Database — `supabase/perf.sql` (new migration)

`ALTER POLICY` on all 29 policies: each function call wrapped in `(select …)`. Same expressions, same answers; no table, column or data change; applied in place inside one transaction (there is never a moment without a policy); safe to run again (verified twice). Rollback = re-run the policy section of `saas.sql` (and the `shifts_*` policies in `schema.sql`).

### 4.3 Mobile app (`~/Desktop/hrms-mobile`, `src/components/check-in.tsx`)

* The 30 s availability refresh stops while the app is in the background and resumes, with an immediate refresh, when it returns; a tick is skipped while the previous request is still running.
* The live GPS watch stops while the app is in the background. Accuracy is unchanged: a fix older than 15 s is never sent (a fresh highest-accuracy fix is taken), and the server still decides.

## 5. Deployment

1. **Database** (Supabase → SQL Editor): run `supabase/perf.sql`. Takes well under a second. Check: `select policyname, qual from pg_policies where tablename = 'employees';` shows `( SELECT current_org_id() …)`.
2. **Web**: as usual — `git pull --ff-only origin main && npm ci && npm run build && pm2 restart hr`. No new dependency, no new environment variable required (`SLOW_QUERY_MS` optional).
3. **Verify**: `curl -s http://127.0.0.1:3000/api/health` → `{"ok":true,…}`; `bash ~/hr/scripts/server-check.sh`.
4. **Logs** (one-time):
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   pm2 set pm2-logrotate:compress true
   ```
   and for the cron log, `/etc/logrotate.d/hr-cron` (sudo):
   ```
   /home/ec2-user/hr-cron-*.log { weekly rotate 4 compress missingok notifempty copytruncate }
   ```
5. **Payslip clean-up cron** (was only scheduled on Vercel): add to crontab, like `hr-cron-absent.sh` but calling `/api/cron/purge`, e.g. `30 21 * * * ~/hr-cron-purge.sh` (21:30 UTC = 03:00 IST).
6. **Optional PM2 file**: `pm2 delete hr && pm2 start ecosystem.config.cjs && pm2 save` (check the port nginx proxies to first; set `PORT` if it isn't 3000).
7. **Mobile**: `npm run update:android` publishes the check-in change over the air (JS only, no new build).

## 6. Remaining risks

* **Attendance read-modify-write**: `writeDay` reads the month's `daily` JSON and upserts it. An HR grid save and a check-in at the same instant can overwrite each other (pre-existing; rare). A proper fix is a Postgres function that updates the day atomically.
* **Full-table loads in HR pages** (employees, attendance, payroll load the whole org, 1000 rows per request). Fine for hundreds of employees; orgs with thousands need server-side pagination — a larger change that alters page behaviour, not done here.
* **Mobile lists** use `ScrollView` + `map` (people, staff attendance with 7 buttons per row). Fine now; switch to `FlatList` for large orgs.
* **In-memory rate limiter** works only with one process. Keep `instances: 1` or move it to the database / Redis before scaling out.
* `schema.sql`'s shifts section needs `organizations`, so a fresh install must run `schema.sql`, `saas.sql`, then `schema.sql` again (or the shifts part).
* **Backups**: Supabase free plan has no point-in-time restore. For a paid SaaS, Supabase Pro (daily backups, PITR add-on) or a nightly `pg_dump` to S3.

## 7. Cost & capacity opportunities (estimates, not measured)

1. **Put EC2 in the same region as Supabase** (eu-west-1), or move both to ap-south-1 (Mumbai, closest to users). Every server-side round trip would drop from intercontinental to ~1–5 ms. Same instance type costs about the same in either region. **This is the single largest speed-up available** and needs no code change.
2. With the fixes above, a small burstable instance (t3/t4g.small) is likely enough for many organizations: the server mostly waits on the network, and HR pages talk to Supabase directly. Confirm with `scripts/server-check.sh` under real use before changing size — never upsize first.
3. Graviton (t4g) is ~20 % cheaper than t3 for Node.js.
4. Log rotation (above) keeps the EBS volume from filling.

## 8. Not measured

* Anything on the production server (CPU, RAM, real Sydney → Ireland RTT, page timings): SSH from the audit session was not permitted. `scripts/server-check.sh` collects all of it.
* Mobile startup time and battery: needs a device / profiler.
* Load tests against production were not run (they would hit the live Supabase project).
