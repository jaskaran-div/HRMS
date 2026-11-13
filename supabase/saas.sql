-- Multi-tenant SaaS layer: organizations, memberships, billing (Stripe), invitations, audit log.
-- Run AFTER schema.sql (Supabase → SQL Editor → paste all of this file → Run). Safe to re-run.
-- If you ever re-run schema.sql, run this file again straight after it: schema.sql recreates
-- the old single-company policies, and this file replaces them with organization-scoped ones.
--
-- Isolation model
--  * Every tenant table has org_id. Triggers fill it (from the linked employee / login, or the caller's
--    organization) and refuse to move a row to another organization.
--  * Row Level Security only lets a login see rows of ITS OWN organization, and only while that
--    organization has access (paid / exempt, not suspended).
--  * The service role (server code) bypasses RLS, so every server query filters by org_id itself.

begin;

------------------------------------------------------------------------------
-- Organizations
------------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  -- pending_payment: registered, not paid yet. active / past_due: has access. The rest: locked.
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'active', 'past_due', 'unpaid', 'canceled', 'expired', 'paused', 'suspended')),
  owner_user_id uuid references auth.users (id) on delete set null,
  owner_email text,
  phone text,
  country text,
  employee_count_hint int,
  email_verified_at timestamptz,
  onboarded_at timestamptz,
  -- set by platform admins only: free / grandfathered access, no Stripe subscription needed
  billing_exempt boolean not null default false,
  suspended_reason text,
  -- Stripe (ids only — never card details)
  stripe_livemode boolean,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,
  stripe_base_price_id text,
  stripe_items jsonb not null default '[]'::jsonb,       -- [{id, price, quantity, feature}]
  addons text[] not null default '{}',                    -- feature keys bought as add-ons
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  last_payment_failed_at timestamptz,
  last_payment_error text,
  stripe_synced_at timestamptz,
  -- platform admin overrides: {"grant": ["payroll"], "revoke": ["documents"]}
  entitlement_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists organizations_stripe_customer_key on public.organizations (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists organizations_stripe_sub_key on public.organizations (stripe_subscription_id) where stripe_subscription_id is not null;
drop trigger if exists organizations_touch on public.organizations;
create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();
alter table public.organizations enable row level security;

-- Platform super admins (the SaaS operator). Granted ONLY by SQL / the server script, never from an organization.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

------------------------------------------------------------------------------
-- Memberships: which organization a login belongs to, and its role there (the source of truth for roles).
-- One organization per login. profiles.role / profiles.org_id mirror it for the existing code.
--   owner     — registered the organization; everything incl. billing and ownership transfer
--   admin     — organization admin (all but billing / ownership)        [existing Derivion admins]
--   hr_admin  — HR operations + invite / manage team leader and employee logins
--   editor    — HR operations (legacy role, kept for existing logins)
--   viewer    — HR read only
--   team_lead — their team's attendance and leave
--   employee  — self service
------------------------------------------------------------------------------
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memberships_org_idx on public.memberships (org_id, role);
create unique index if not exists memberships_one_owner on public.memberships (org_id) where role = 'owner';
drop trigger if exists memberships_touch on public.memberships;
create trigger memberships_touch before update on public.memberships for each row execute function public.touch_updated_at();
alter table public.memberships enable row level security;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee'));
alter table public.profiles add column if not exists org_id uuid references public.organizations (id) on delete cascade;
create index if not exists profiles_org_idx on public.profiles (org_id);

------------------------------------------------------------------------------
-- org_id on every tenant table
------------------------------------------------------------------------------
alter table public.settings add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.email_templates add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.employees add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.attendance add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.payslips add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.exit_records add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.leave_requests add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.documents add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.attendance_punches add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.push_tokens add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.notifications add column if not exists org_id uuid references public.organizations (id) on delete cascade;

-- Mail only goes to these domains for this organization (comma separated). Blank = the env / sender domain.
alter table public.settings add column if not exists email_domains text;

------------------------------------------------------------------------------
-- Existing single-company data → the first organization (Derivion). Roles stay exactly as they were;
-- it is billing-exempt (grandfathered), so nothing is locked after this migration.
------------------------------------------------------------------------------
do $$
declare
  legacy uuid;
  cname text;
begin
  if exists (select 1 from public.profiles where org_id is null) or exists (select 1 from public.employees where org_id is null) then
    select id into legacy from public.organizations where slug = 'derivion';
    if legacy is null then
      select company_name into cname from public.settings where id = 1;
      insert into public.organizations (name, slug, status, billing_exempt, email_verified_at, onboarded_at)
      values (coalesce(nullif(trim(cname), ''), 'Derivion International Pvt Ltd'), 'derivion', 'active', true, now(), now())
      returning id into legacy;
    end if;
    update public.settings set org_id = legacy where org_id is null and id = 1;
    update public.email_templates set org_id = legacy where org_id is null;
    update public.employees set org_id = legacy where org_id is null;
    update public.profiles set org_id = legacy where org_id is null;
    update public.attendance set org_id = legacy where org_id is null;
    update public.payslips set org_id = legacy where org_id is null;
    update public.exit_records set org_id = legacy where org_id is null;
    update public.leave_requests set org_id = legacy where org_id is null;
    update public.documents set org_id = legacy where org_id is null;
    update public.attendance_punches set org_id = legacy where org_id is null;
    update public.push_tokens set org_id = legacy where org_id is null;
    update public.notifications set org_id = legacy where org_id is null;
    insert into public.memberships (org_id, user_id, role, status)
      select legacy, p.id, p.role, case when p.active then 'active' else 'deactivated' end from public.profiles p
      on conflict (user_id) do nothing;
  end if;
end $$;
-- fresh install: schema.sql's placeholder settings row belongs to nobody
delete from public.settings where org_id is null;

alter table public.settings alter column org_id set not null;
alter table public.email_templates alter column org_id set not null;
alter table public.employees alter column org_id set not null;
alter table public.attendance alter column org_id set not null;
alter table public.payslips alter column org_id set not null;
alter table public.exit_records alter column org_id set not null;
alter table public.leave_requests alter column org_id set not null;
alter table public.documents alter column org_id set not null;
alter table public.attendance_punches alter column org_id set not null;
alter table public.push_tokens alter column org_id set not null;
alter table public.notifications alter column org_id set not null;

-- settings: one row PER ORGANIZATION (was: exactly one row, id = 1)
alter table public.settings drop constraint if exists settings_id_check;
create sequence if not exists public.settings_id_seq owned by public.settings.id;
select setval('public.settings_id_seq', greatest((select coalesce(max(id), 1) from public.settings), 1));
alter table public.settings alter column id set default nextval('public.settings_id_seq');
create unique index if not exists settings_org_key on public.settings (org_id);

-- per-organization uniqueness
alter table public.employees drop constraint if exists employees_emp_code_key;
create unique index if not exists employees_org_code_key on public.employees (org_id, emp_code);
create index if not exists employees_org_idx on public.employees (org_id, archived_at);
alter table public.email_templates drop constraint if exists email_templates_pkey;
alter table public.email_templates add constraint email_templates_pkey primary key (org_id, type);
create index if not exists attendance_org_month_idx on public.attendance (org_id, month);
create index if not exists payslips_org_month_idx on public.payslips (org_id, month);
create index if not exists leave_requests_org_idx on public.leave_requests (org_id, start_date desc);
create index if not exists documents_org_idx on public.documents (org_id, created_at desc);
create index if not exists punches_org_day_idx on public.attendance_punches (org_id, day desc);

------------------------------------------------------------------------------
-- Who is asking
------------------------------------------------------------------------------
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid() and m.status = 'active'
$$;

-- The organization may use the HRMS: paid (or in a payment retry grace period) or exempt, and not suspended.
create or replace function public.org_has_access(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations where id = o and status <> 'suspended'
    and (billing_exempt or status in ('active', 'past_due')))
$$;

create or replace function public.has_org_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.status = 'active' and p.active and m.role = any (roles)
      and public.org_has_access(m.org_id))
$$;

-- Same names as before, now organization-aware (policies below also compare org_id).
create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(array['owner', 'admin', 'hr_admin', 'editor', 'viewer'])
$$;
create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(array['owner', 'admin', 'hr_admin', 'editor'])
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(array['owner', 'admin'])
$$;

------------------------------------------------------------------------------
-- org_id is filled and checked by the database, never trusted from the client.
--   'employee' : from the linked employee (attendance, payslips, leave, punches, exit records, documents)
--   'user'     : from the login (notifications, push tokens)
--   'caller'   : given by the server, else the caller's organization (employees, settings, templates)
-- A row can never move to another organization.
------------------------------------------------------------------------------
create or replace function public.set_org_id() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  other uuid;
begin
  -- (IFs are nested on purpose: plpgsql does not short-circuit AND, and new.employee_id
  --  only exists on some tables)
  if tg_argv[0] = 'employee' then
    if new.employee_id is not null then
      select org_id into v from public.employees where id = new.employee_id;
      if v is null then raise exception 'employee not found'; end if;
    end if;
  elsif tg_argv[0] = 'user' then
    select org_id into v from public.profiles where id = new.user_id;
  end if;
  if v is null then v := coalesce(new.org_id, public.current_org_id()); end if;
  if v is null then raise exception 'organization required for %', tg_table_name; end if;
  if tg_op = 'UPDATE' and old.org_id is distinct from v then
    raise exception 'rows cannot be moved to another organization';
  end if;
  new.org_id := v;
  if tg_table_name = 'employees' then  -- (nested: plpgsql would resolve new.team_lead_id on other tables too)
    if new.team_lead_id is not null then
      select org_id into other from public.employees where id = new.team_lead_id;
      if other is distinct from v then raise exception 'team leader must belong to the same organization'; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists employees_org on public.employees;
create trigger employees_org before insert or update on public.employees for each row execute function public.set_org_id('caller');
drop trigger if exists settings_org on public.settings;
create trigger settings_org before insert or update on public.settings for each row execute function public.set_org_id('caller');
drop trigger if exists email_templates_org on public.email_templates;
create trigger email_templates_org before insert or update on public.email_templates for each row execute function public.set_org_id('caller');
drop trigger if exists attendance_org on public.attendance;
create trigger attendance_org before insert or update on public.attendance for each row execute function public.set_org_id('employee');
drop trigger if exists payslips_org on public.payslips;
create trigger payslips_org before insert or update on public.payslips for each row execute function public.set_org_id('employee');
drop trigger if exists exit_records_org on public.exit_records;
create trigger exit_records_org before insert or update on public.exit_records for each row execute function public.set_org_id('employee');
drop trigger if exists leave_requests_org on public.leave_requests;
create trigger leave_requests_org before insert or update on public.leave_requests for each row execute function public.set_org_id('employee');
drop trigger if exists documents_org on public.documents;
create trigger documents_org before insert or update on public.documents for each row execute function public.set_org_id('employee');
drop trigger if exists punches_org on public.attendance_punches;
create trigger punches_org before insert or update on public.attendance_punches for each row execute function public.set_org_id('employee');
drop trigger if exists notifications_org on public.notifications;
create trigger notifications_org before insert or update on public.notifications for each row execute function public.set_org_id('user');
drop trigger if exists push_tokens_org on public.push_tokens;
create trigger push_tokens_org before insert or update on public.push_tokens for each row execute function public.set_org_id('user');

-- A login can only be linked to an employee of its own organization.
create or replace function public.check_profile_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  if new.employee_id is not null then
    select org_id into e from public.employees where id = new.employee_id;
    if e is distinct from new.org_id then raise exception 'employee belongs to another organization'; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_org_check on public.profiles;
create trigger profiles_org_check before insert or update of employee_id, org_id on public.profiles
  for each row execute function public.check_profile_org();

-- memberships → profiles (role, org) so every existing role check keeps working
create or replace function public.mirror_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set role = new.role, org_id = new.org_id
    where id = new.user_id and (role is distinct from new.role or org_id is distinct from new.org_id);
  return new;
end $$;
drop trigger if exists memberships_mirror on public.memberships;
create trigger memberships_mirror after insert or update of role, org_id on public.memberships
  for each row execute function public.mirror_membership();

-- profiles.role changed directly (old scripts) → membership follows
create or replace function public.mirror_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update public.memberships set role = new.role where user_id = new.id and role is distinct from new.role;
  return new;
end $$;
drop trigger if exists profiles_role_mirror on public.profiles;
create trigger profiles_role_mirror after update of role on public.profiles
  for each row execute function public.mirror_profile_role();

------------------------------------------------------------------------------
-- Row Level Security, organization-scoped (replaces schema.sql's policies)
------------------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));

-- organizations: no browser access at all (billing columns); the server reports status and features.
drop policy if exists organizations_read on public.organizations;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (org_id = public.current_org_id() and public.is_admin()) with check (org_id = public.current_org_id() and public.is_admin());

drop policy if exists email_templates_read on public.email_templates;
create policy email_templates_read on public.email_templates for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates for insert to authenticated with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates for update to authenticated
  using (org_id = public.current_org_id() and public.is_admin()) with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates for delete to authenticated using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using (org_id = public.current_org_id() and public.can_edit()) with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete to authenticated using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
  using (org_id = public.current_org_id() and public.can_edit()) with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists payslips_insert on public.payslips;
create policy payslips_insert on public.payslips for insert to authenticated with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists payslips_update on public.payslips;
create policy payslips_update on public.payslips for update to authenticated
  using (org_id = public.current_org_id() and public.can_edit()) with check (org_id = public.current_org_id() and public.can_edit());

drop policy if exists exit_read on public.exit_records;
create policy exit_read on public.exit_records for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists exit_insert on public.exit_records;
create policy exit_insert on public.exit_records for insert to authenticated with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists exit_update on public.exit_records;
create policy exit_update on public.exit_records for update to authenticated
  using (org_id = public.current_org_id() and public.can_edit()) with check (org_id = public.current_org_id() and public.can_edit());
drop policy if exists exit_delete on public.exit_records;
create policy exit_delete on public.exit_records for delete to authenticated using (org_id = public.current_org_id() and public.can_edit());

drop policy if exists leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select to authenticated using (org_id = public.current_org_id() and public.can_read());
drop policy if exists leave_update on public.leave_requests;
create policy leave_update on public.leave_requests for update to authenticated
  using (org_id = public.current_org_id() and public.can_edit()) with check (org_id = public.current_org_id() and public.can_edit());

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated using (org_id = public.current_org_id() and public.can_read());

drop policy if exists punches_read on public.attendance_punches;
create policy punches_read on public.attendance_punches for select to authenticated using (org_id = public.current_org_id() and public.can_read());

-- Payslip clean-up, per organization: keeps each organization's newest `keep_months` months.
-- Called by a logged-in HR user it only touches their own organization; by the daily job (service role), all.
create or replace function public.purge_old_payslips(keep_months int default 2) returns int
language plpgsql security definer set search_path = public as $$
declare
  only_org uuid;
  removed int;
begin
  if auth.uid() is not null then
    if not public.can_edit() then raise exception 'not allowed'; end if;
    only_org := public.current_org_id();
  end if;
  with months as (
    select org_id, month, dense_rank() over (partition by org_id order by month desc) as r
    from (select distinct org_id, month from public.payslips where only_org is null or org_id = only_org) d
  ), cutoff as (
    select org_id, min(month) as m from months where r <= keep_months group by org_id
  )
  delete from public.payslips p using cutoff c where p.org_id = c.org_id and p.month < c.m;
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke all on function public.purge_old_payslips(int) from public;
grant execute on function public.purge_old_payslips(int) to authenticated, service_role;

------------------------------------------------------------------------------
-- Registration: email verification tokens (server only; only a SHA-256 hash of the token is stored)
------------------------------------------------------------------------------
create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_verifications enable row level security;

------------------------------------------------------------------------------
-- Invitations (server only)
------------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee')),
  employee_id uuid references public.employees (id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references public.profiles (id) on delete set null,
  invited_by_name text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invitations_org_idx on public.invitations (org_id, created_at desc);
create unique index if not exists invitations_pending_email on public.invitations (org_id, lower(email)) where status = 'pending';
alter table public.invitations enable row level security;

------------------------------------------------------------------------------
-- Ownership transfer: the owner (after re-entering their password) offers it; the new owner accepts.
------------------------------------------------------------------------------
create table if not exists public.ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists ownership_transfers_one_pending on public.ownership_transfers (org_id) where status = 'pending';
alter table public.ownership_transfers enable row level security;

-- Swaps the two roles atomically (called by the server after every check passed).
create or replace function public.transfer_ownership(transfer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.ownership_transfers;
begin
  select * into t from public.ownership_transfers where id = transfer and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'transfer not found or expired'; end if;
  if not exists (select 1 from public.memberships where user_id = t.to_user_id and org_id = t.org_id and status = 'active') then
    raise exception 'new owner is not an active member';
  end if;
  update public.memberships set role = 'admin' where user_id = t.from_user_id and org_id = t.org_id and role = 'owner';
  update public.memberships set role = 'owner' where user_id = t.to_user_id and org_id = t.org_id;
  update public.organizations set owner_user_id = t.to_user_id,
    owner_email = (select email from auth.users where id = t.to_user_id) where id = t.org_id;
  update public.ownership_transfers set status = 'accepted', decided_at = now() where id = t.id;
end $$;
revoke all on function public.transfer_ownership(uuid) from public, anon, authenticated;
grant execute on function public.transfer_ownership(uuid) to service_role;

------------------------------------------------------------------------------
-- Organization audit log: role changes, invitations, deactivations, ownership, billing. Append only.
------------------------------------------------------------------------------
create table if not exists public.org_audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  target_label text,
  details jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists org_audit_logs_org_idx on public.org_audit_logs (org_id, created_at desc);
alter table public.org_audit_logs enable row level security;
drop policy if exists audit_read on public.org_audit_logs;
create policy audit_read on public.org_audit_logs for select to authenticated using (org_id = public.current_org_id() and public.is_admin());

------------------------------------------------------------------------------
-- Stripe: webhook events (idempotency + history) and invoices (payment history). Server only.
------------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id text primary key,                         -- Stripe event id (evt_…): a duplicate delivery hits this key
  type text not null,
  livemode boolean not null,
  org_id uuid references public.organizations (id) on delete set null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts int not null default 1,
  error text,
  object_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists stripe_events_org_idx on public.stripe_events (org_id, received_at desc);
alter table public.stripe_events enable row level security;

create table if not exists public.billing_invoices (
  id text primary key,                         -- Stripe invoice id (in_…)
  org_id uuid not null references public.organizations (id) on delete cascade,
  livemode boolean not null,
  subscription_id text,
  number text,
  status text,                                 -- draft | open | paid | uncollectible | void
  billing_reason text,
  currency text,
  amount_due bigint,                           -- smallest currency unit
  amount_paid bigint,
  amount_remaining bigint,
  attempt_count int,
  next_payment_attempt timestamptz,
  last_error text,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_invoices_org_idx on public.billing_invoices (org_id, created_at desc);
alter table public.billing_invoices enable row level security;

------------------------------------------------------------------------------
-- Contact Sales (public form on the website)
------------------------------------------------------------------------------
create table if not exists public.sales_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  phone text,
  employees text,
  message text,
  org_id uuid references public.organizations (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);
alter table public.sales_inquiries enable row level security;

commit;
