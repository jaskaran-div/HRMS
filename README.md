# HR Portal

> **Multi-organization SaaS:** organizations, roles, registration, Stripe billing and the platform admin panel are described in [docs/SAAS.md](docs/SAAS.md). Run `supabase/saas.sql` after `supabase/schema.sql`.

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
* Access levels: **Admin** (everything, users, company settings) · **Editor** (import, attendance, payslips, leave approval) · **Viewer** (read only) — these use the HR app. **Team leader** and **Employee** logins use the employee panel at `/portal` and must be linked to an employee record.
* HR can **Set password** for anyone who forgot theirs (User Access), or reset it to the default pattern. *Create employee logins for everyone without one* makes a login per employee (username = employee ID in lowercase).
* Nothing is hard-deleted from the UI: employees are *archived*.

## Employee & team leader panel (`/portal`)

* **Employees** see their own profile, payslips (once HR generates them), attendance, documents, and **apply for leave**.
* **Leave**: each month gives *Short leave* and *Paid leave* (counts set in *Company & Rules*, default 1 each). Once used, only *Absent (unpaid)* can be picked. Week offs are not counted. On applying, the request is emailed to the employee's team leader and HR (*Company & Rules → Leave requests go to*). HR sees everything under **Leave history**; approving / rejecting emails the employee. Approved leave is a record only — attendance is still marked as usual.
* **Team leaders** also see **My team** (everyone below them in the hierarchy: profile, attendance, payslips, leave — not bank / PAN / salary) and approve their team's leave.
* HR sets who reports to whom under **Teams & hierarchy** (filter by department, pick “Reports to”, or select many and set one team leader).
* Security: portal logins cannot read any table from the browser (database rules allow HR staff only); the portal loads their data on the server after checking exactly what they may see.

## Documents (Google Drive)

HR uploads company documents (terms & conditions, policies — every login sees them) and per-employee documents (visible to that employee unless hidden) under **Documents**. Files are stored privately in a Google Drive folder and streamed through the app after a permission check. Max 4 MB per file (Vercel's request limit). Set it up with **one** of:

* **Google Workspace (recommended)**: Google Cloud Console → create a project → enable *Google Drive API* → *IAM → Service accounts* → create one → *Keys → Add key → JSON*. In Google Drive create a **Shared drive**, add the service account's email as *Content manager*, create a folder in it. Set `GOOGLE_DRIVE_FOLDER_ID` (from the folder URL), `GOOGLE_SERVICE_ACCOUNT_EMAIL` (`client_email` from the JSON) and `GOOGLE_PRIVATE_KEY` (`private_key` from the JSON, in double quotes).
* **Normal Google account**: create an OAuth client (type *Web application*, redirect URI `https://developers.google.com/oauthplayground`), then in the OAuth Playground (⚙️ → *Use your own OAuth credentials*) authorise `https://www.googleapis.com/auth/drive` and exchange for a refresh token. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID`. (Publish the OAuth app, otherwise the token expires after 7 days.)

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
