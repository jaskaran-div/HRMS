# HR Portal

Employees, monthly attendance and auto-generated payslips. Next.js on Vercel, Supabase (Postgres + Auth) for data and logins.

## How it works each month

1. **Employees** (once, then when something changes): *Import / Export* → upload the employee sheet. Needs an `Employee ID` column; `Monthly Salary` is what payslips are calculated from.
2. **Attendance**: *Attendance* → pick the month → upload the sheet (one row per employee, a column per day: Present / Absent / Week Off / Half Day / Paid Leave; blank = not employed that day). Check the preview, save.
3. **Payslips**: *Payroll & Payslips* → pick the month → Generate. View / download one, or all in a single PDF.

Payslips are kept for the **latest 2 months** only; older ones are deleted automatically (when you generate, and by a daily job).

## Pay rules (verified against the February sheet and the July payslip)

| | |
|---|---|
| Daily rate | monthly salary ÷ days in that month |
| Paid days | present + ½ × half days + week offs + holidays + paid leave |
| Monthly paid leave | the first **1** absent day each month is paid (change in *Company & Rules*) |
| Pay | daily rate × paid days, rounded to the rupee |
| Split | Basic 50 %, HRA 25 %, Conveyance 10 %, Special = rest (editable) |
| Plus / minus | Arrears are added; Income Tax, Provident Fund (per employee) and the sheet's "Deduction" are subtracted |

`npm test` replays all 8 February rows and the July payslip through this code.

## Logins and access

* Username + password. Admins add people under **User Access**; the password is generated from the username: `jaskaran` → `Jaskaran@isft`.
* By default a new user must choose their own password at first login (untick the box when creating to skip). Because the pattern is guessable, leaving this on is strongly recommended — this system holds salaries.
* Access levels: **Admin** (everything, users, company settings) · **Editor** (import, attendance, payslips) · **Viewer** (read only).
* Nothing is hard-deleted from the UI: employees are *archived*, and every change to employees / attendance / settings is recorded under **Activity Log** (who, when, old → new).

## One-time setup

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, Run.
3. **Authentication → Sign In / Providers → turn OFF "Allow new users to sign up"** (only admins create logins).
4. **Project Settings → API**: copy the Project URL, the `anon` (or publishable) key, and the `service_role` key.

### 2. Run it locally
```bash
npm install
cp .env.example .env.local      # fill in the 3 Supabase values and a random CRON_SECRET
npm run create-admin -- hr "HR Admin"     # first admin: username hr, password Hr@isft
npm run dev                      # http://localhost:3000
```

### 3. GitHub → Vercel
```bash
git init && git add . && git commit -m "HR portal"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git   # create an empty private repo first
git push -u origin main
```
In Vercel: **Add New → Project →** pick the repo → add the environment variables from `.env.example` (`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are secrets — never prefix them with `NEXT_PUBLIC_`) → Deploy. You get a `*.vercel.app` URL that works from any device. `vercel.json` already schedules the daily payslip clean-up.

## Things to know

* `NEXT_PUBLIC_LOGIN_DOMAIN` — Supabase Auth needs an email, so username `hr` is stored as `hr@<domain>`. No email is ever sent. If you ever see "email address invalid" when creating users, set this to a domain you own.
* Backups: the data lives in Supabase. On the free plan there is no point-in-time restore, so use **Import / Export → Export all employees** now and then, and consider Supabase Pro for daily backups.
* `legacy-prototype/index.html` is the earlier single-file demo; it is not used.
