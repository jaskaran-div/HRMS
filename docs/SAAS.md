# Multi-organization SaaS: setup and how it works

## What changed

* **Organizations.** Every row belongs to an organization (`org_id`). The database fills it in and checks it
  (triggers + Row Level Security in `supabase/saas.sql`), so a login can only ever see its own organization —
  in the web app, the employee portal and the mobile app alike.
* **The existing company (Derivion)** became the first organization, slug `derivion`. It is *billing exempt*
  (grandfathered: everything stays unlocked, no Stripe needed) and every login keeps its role.
* **Web only:** registration, email verification, onboarding, plan + add-on selection, Stripe Checkout,
  subscription / billing / invoices, Contact Sales, ownership transfer. The mobile app only logs in, checks the
  organization is active, and hides features the plan does not include.

## Roles (per organization)

| Role | Can |
|---|---|
| Owner | Everything, incl. billing, add-ons and ownership transfer. The person who registered. |
| Admin | Organization admin: settings, templates, all HR work, user access. No billing. (Existing Derivion admins.) |
| HR Admin | Employees, attendance, payroll, leave, documents. Invites / manages **team leaders and employees**. |
| HR Editor | HR work, no user management (existing logins). |
| HR Viewer | Read only. |
| Team Leader | Their team's attendance and leave approvals. |
| Employee | Self service. |

Chain for a new organization: registrant = Owner → Owner makes HR Admins → HR Admins invite team leaders and
employees. Nobody can grant Owner (only an ownership transfer), and platform super admin is not an organization
role at all (`scripts/make-platform-admin.mjs` on the server is the only way). There is no audit log.

## One-time setup

1. **Database:** Supabase → SQL Editor → run all of `supabase/saas.sql` (after `schema.sql`). Safe to re-run.
   Always re-run it after `schema.sql`.
2. **Email:** set `PLATFORM_NAME`, `PLATFORM_SENDER_EMAIL` (allowed on the SMTP account) and `SALES_EMAIL`.
3. **Supabase Auth:** keep "Allow new users to sign up" OFF — registration creates logins on the server.
   With "Confirm email" ON, unverified owners cannot even sign in; with it OFF they can sign in but are held on
   `/verify-email`. Either is safe.
4. **Platform admin:** `node --env-file=.env.local scripts/make-platform-admin.mjs you@example.com` → `/admin`.
5. **Login branding:** the login page shows Derivion's name and logo by default; `LOGIN_BRAND_ORG=<slug>` picks another organization, `LOGIN_BRAND_ORG=none` shows `PLATFORM_NAME`.

## Stripe

Stripe is the only payment provider. Nothing is hardcoded: keys and price ids come from the server environment.

1. **Products and prices** (Dashboard → Product catalog), all *recurring*, same currency and interval:
   base plan → `STRIPE_BASE_PRICE_ID`; optional add-ons → `STRIPE_ADDON_PAYROLL_PRICE_ID`,
   `STRIPE_ADDON_DOCUMENTS_PRICE_ID`, `STRIPE_ADDON_EMAIL_PRICE_ID` (blank = not offered).
2. **API keys** → `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`. Test keys on staging, live keys on production.
   The server refuses mismatched test/live keys, and test keys on a production server unless `STRIPE_MODE=test`.
   Each organization's Stripe customer is remembered per mode, so test data never mixes with live data.
3. **Webhook** (Developers → Webhooks → Add endpoint): `https://<domain>/api/stripe/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.paused`, `customer.subscription.resumed`, `customer.subscription.pending_update_applied`,
   `customer.subscription.pending_update_expired`, `invoice.paid`, `invoice.payment_succeeded`,
   `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalized`, `invoice.updated`,
   `invoice.voided`, `invoice.marked_uncollectible`, `customer.deleted`.
   Signing secret → `STRIPE_WEBHOOK_SECRET`. Use a separate endpoint (and secret) for test and live.
4. **Customer portal** (Settings → Billing → Customer portal): enable payment method updates, invoice history,
   cancellation (at period end recommended). "Manage payment & invoices" in Billing opens it.
5. **Smart Retries** (Settings → Billing → Subscriptions and emails) decide how failed renewals are retried and
   when the subscription becomes `unpaid` / `canceled`.

Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a test signing secret.

### Subscription lifecycle

1. Owner registers → organization `pending_payment`, owner verifies their email, logs in, lands on **Billing**.
2. Owner picks add-ons → server creates / reuses the Stripe Customer and a Checkout Session (base + add-ons).
3. Stripe hosted checkout. The success redirect only shows "confirming payment…"; **it unlocks nothing**.
4. Stripe sends signed webhooks → signature verified → event id stored (duplicates are ignored, failed events are
   retried by Stripe) → the subscription is **re-read from the Stripe API** → status, period, add-ons saved.
5. The organization is `active` only when Stripe reports the subscription `active` (i.e. paid). Then the owner
   does onboarding and invites people; employees can use the mobile app.

| Stripe subscription | Organization | Access |
|---|---|---|
| active / trialing | active | yes |
| past_due (renewal failed, retrying) | past_due | yes, with a warning banner (grace period) |
| incomplete (payment pending / needs action) | pending_payment | no |
| unpaid (retries exhausted) | unpaid | no |
| canceled | canceled | no |
| incomplete_expired | expired | no |
| paused | paused | no |

Add-ons on an existing subscription: added ones are charged immediately (prorated) with
`payment_behavior=pending_if_incomplete`, so **they switch on only if that payment succeeds**; removed ones stop at
once and are credited on the next invoice. Cancellation, card changes and resuming happen in the Stripe portal and
arrive through webhooks. Payment failures email the owner.

### Platform admin (`/admin`)

Open it by logging in normally, then going to `/admin` (platform admins only; everyone else gets "not found").

* **Dashboard** — organizations by status, new sign-ups, employees and logins across all organizations,
  revenue of the last 30 days, failed payments, latest payments, renewals in the next 7 days.
* **Organizations** — search / filter, employees and logins used vs. their limits, plan, renewal, failed payments.
  Per organization:
  * *Overview* — edit name, company name / address, contact, internal notes; mark the owner's email verified.
  * *Plan & features* — billing **Free / managed** (active without payment) or **Stripe** (access follows
    payment); each feature **Plan / On / Off**; **max employees** and **max logins** (blank = unlimited).
    Limits are enforced by the database: adding, importing or re-activating past the limit is refused.
  * *Members* — change roles, disable / enable logins, make someone the owner.
  * *Payments* — total paid, failures, next renewal, Stripe ids, cancellation, all invoices, Stripe events,
    **Sync from Stripe**.
  * *Suspend / delete* — suspend with a reason (everyone locked out, nothing deleted), or delete the
    organization for good (type its short name; cancels an active Stripe subscription first).
* **New organization** — creates the organization and its owner login (email + password, generated if blank,
  optionally emailed), with plan, features and limits.
* **Payments** — every organization's invoices, filter by status / organization / period, totals.
No card details are stored anywhere; Stripe holds them.

## Not done yet / decisions for later

* Moving the database off Supabase to the EC2 server (deferred on purpose).
* Departments and designations are still free-text fields on each employee (no separate managed lists).
* Usernames stay unique across all organizations; invited people log in with their email.
* The mobile app still has the HR "Company & Rules" screen (office location, leave rules) for org admins.
* Rate limits are in memory (fine for one pm2 process; use a shared store if you scale out).

## Emails: sender and logo

* Every organization's emails go out through the platform SMTP account, with **the organization's own sender name**
  and reply-to (set in *Customisations → Sender Email Preferences*). Derivion keeps its own sender address.
* **Logo:** the logo from *Company & Rules* appears in the header of every email (attached as an inline image,
  which Gmail and Outlook show), as it already does on payslips, letters, the sidebar and the mobile app.
  Changing the logo changes it everywhere immediately.
* Platform emails (registration, invitations, payment problems) come from `PLATFORM_SENDER_EMAIL`.
