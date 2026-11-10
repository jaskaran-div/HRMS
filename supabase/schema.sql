-- HR Portal schema. Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.

------------------------------------------------------------------------------
-- Users (logins live in Supabase Auth; this table holds username + role)
------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9]{2,30}$'),
  full_name text not null,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer', 'team_lead', 'employee')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

-- Permission helpers (security definer so policies can read profiles without recursion).
-- can_read = HR staff only. Team leader / employee logins never read tables directly from the browser:
-- the portal loads their data on the server, after checking exactly what they may see.
create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'editor', 'viewer'))
$$;

create or replace function public.can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'editor'))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin')
$$;

------------------------------------------------------------------------------
-- Company + payroll rules (exactly one row)
------------------------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'Derivion International Pvt Ltd',
  company_address text not null default 'Plot No 42, Phase IV, Sarhol Sector 18, Gurugram, Haryana 122015, India',
  logo text,                                   -- small PNG as data URL
  footer_note text not null default '-- This is a system-generated document. --',
  paid_leave_per_month numeric(4,1) not null default 1 check (paid_leave_per_month >= 0),
  basic_pct numeric(5,2) not null default 50 check (basic_pct >= 0),
  hra_pct numeric(5,2) not null default 25 check (hra_pct >= 0),
  conveyance_pct numeric(5,2) not null default 10 check (conveyance_pct >= 0),
  -- special allowance = whatever is left of 100%
  constraint pct_total check (basic_pct + hra_pct + conveyance_pct <= 100)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Sender Email Preferences (the SMTP login itself lives in the server environment, never in the database)
alter table public.settings add column if not exists sender_name text;
alter table public.settings add column if not exists sender_email text not null default 'hr@derivion.in';
alter table public.settings add column if not exists reply_to text;

------------------------------------------------------------------------------
-- Email templates (Customisations > Email Templates). No row = the built-in default text is used.
------------------------------------------------------------------------------
create table if not exists public.email_templates (
  type text primary key,                    -- payslip | payslip_portal_disabled | payslip_offcycle | payslip_fnf | custom_xxxx (HR's own, e.g. a warning letter)
  title text,                               -- name shown for custom templates
  subject text not null,
  body text not null,                       -- HTML with %Placeholders%
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.email_templates drop constraint if exists email_templates_type_check;
alter table public.email_templates add column if not exists title text;
alter table public.email_templates enable row level security;
drop policy if exists email_templates_read on public.email_templates;
create policy email_templates_read on public.email_templates for select to authenticated using (public.can_read());
drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates for insert to authenticated with check (public.is_admin());
drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists email_templates_delete on public.email_templates;
create policy email_templates_delete on public.email_templates for delete to authenticated using (public.is_admin());

------------------------------------------------------------------------------
-- Employees (master data)
------------------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  emp_code text not null unique,
  name text not null,
  department text,
  designation text,
  email text,
  phone text,
  emergency_name text,
  emergency_phone text,
  exit_type text,                                                         -- Resigned / Terminated / Other (set when inactive)
  exit_remarks text,
  doj date,
  dob date,
  location text,
  manager text,
  bank_name text,
  account_no text,
  ifsc text,
  pan text,
  pf_no text,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  pf_amount numeric(12,2) not null default 0 check (pf_amount >= 0),      -- fixed monthly PF deduction
  tds_amount numeric(12,2) not null default 0 check (tds_amount >= 0),    -- fixed monthly income tax
  extra jsonb not null default '{}'::jsonb,                               -- any other columns from the sheet
  archived_at timestamptz,                                                -- archive instead of delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employees_name_idx on public.employees (lower(name));

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists employees_touch on public.employees;
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

------------------------------------------------------------------------------
-- Monthly attendance (one row per employee per month)
------------------------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),   -- always the 1st
  salary numeric(12,2) not null default 0,         -- monthly salary that applies for this month
  present_days numeric(4,1) not null default 0,
  half_days numeric(4,1) not null default 0,
  absent_days numeric(4,1) not null default 0,
  leave_days numeric(4,1) not null default 0,      -- leave already marked as paid in the sheet
  weekoff_days numeric(4,1) not null default 0,
  holiday_days numeric(4,1) not null default 0,
  arrears numeric(12,2) not null default 0,
  other_deduction numeric(12,2) not null default 0,
  carry_cleared boolean not null default false,    -- HR settled this month's arrears / deductions, so they do not carry to next month
  daily jsonb,                                     -- {"1":"P","2":"A",...} when uploaded day-wise
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, month)
);
create index if not exists attendance_month_idx on public.attendance (month);

drop trigger if exists attendance_touch on public.attendance;
create trigger attendance_touch before update on public.attendance
  for each row execute function public.touch_updated_at();

------------------------------------------------------------------------------
-- Generated payslips (snapshot of the numbers; only the latest 2 months are kept)
------------------------------------------------------------------------------
create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  pay_date date not null,
  net_pay numeric(12,2) not null,
  data jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by uuid default auth.uid(),
  unique (employee_id, month)
);
create index if not exists payslips_month_idx on public.payslips (month);

-- Keeps only the newest `keep_months` distinct months of payslips; returns rows removed.
create or replace function public.purge_old_payslips(keep_months int default 2) returns int
language plpgsql security definer set search_path = public as $$
declare
  cutoff date;
  removed int;
begin
  if auth.uid() is not null and not public.can_edit() then
    raise exception 'not allowed';
  end if;
  select min(m) into cutoff
  from (select distinct month as m from public.payslips order by month desc limit keep_months) t;
  if cutoff is null then
    return 0;
  end if;
  delete from public.payslips where month < cutoff;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.purge_old_payslips(int) from public;
grant execute on function public.purge_old_payslips(int) to authenticated, service_role;

------------------------------------------------------------------------------
-- Exit records: when an employee is made inactive, their relieving letter and last
-- 3 or 6 months of payslips are stored here (kept; NOT removed by purge_old_payslips)
------------------------------------------------------------------------------
create table if not exists public.exit_records (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  relieved_on date not null,
  payslip_months int not null check (payslip_months in (3, 6)),
  letter jsonb not null,
  payslips jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.exit_records enable row level security;
drop policy if exists exit_read on public.exit_records;
create policy exit_read on public.exit_records for select to authenticated using (public.can_read());
drop policy if exists exit_insert on public.exit_records;
create policy exit_insert on public.exit_records for insert to authenticated with check (public.can_edit());
drop policy if exists exit_update on public.exit_records;
create policy exit_update on public.exit_records for update to authenticated
  using (public.can_edit()) with check (public.can_edit());
drop policy if exists exit_delete on public.exit_records;
create policy exit_delete on public.exit_records for delete to authenticated using (public.can_edit());

------------------------------------------------------------------------------
-- Audit trail: who changed what (protects against "I didn't know I did that")
------------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  username text,
  table_name text not null,
  op text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_user text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  if tg_table_name = 'settings' then      -- don't copy the logo image into the log
    v_old := v_old - 'logo';
    v_new := v_new - 'logo';
  end if;
  select username into v_user from public.profiles where id = auth.uid();
  insert into public.audit_log (user_id, username, table_name, op, row_id, old_data, new_data)
  values (auth.uid(), v_user, tg_table_name, tg_op, coalesce(v_new ->> 'id', v_old ->> 'id'), v_old, v_new);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists employees_audit on public.employees;
create trigger employees_audit after insert or update or delete on public.employees
  for each row execute function public.log_change();

drop trigger if exists attendance_audit on public.attendance;
create trigger attendance_audit after insert or update or delete on public.attendance
  for each row execute function public.log_change();

drop trigger if exists settings_audit on public.settings;
create trigger settings_audit after update on public.settings
  for each row execute function public.log_change();

------------------------------------------------------------------------------
-- Row Level Security: nobody reads or writes anything unless a policy says so
------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.payslips enable row level security;
alter table public.audit_log enable row level security;

-- profiles: you can read your own row; admins read all. Writes only via the server (service role).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- settings: any active user reads, admin updates
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (public.can_read());
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- employees: read = any active user; insert/update = admin or editor; NO delete policy (archive instead)
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated using (public.can_read());
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated with check (public.can_edit());
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using (public.can_edit()) with check (public.can_edit());
-- delete = admin only (bulk delete in the Employees list; also removes their attendance, payslips and exit documents)
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete to authenticated using (public.is_admin());

-- attendance
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated using (public.can_read());
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated with check (public.can_edit());
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_edit()) with check (public.can_edit());
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated using (public.is_admin());

-- payslips
drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips for select to authenticated using (public.can_read());
drop policy if exists payslips_insert on public.payslips;
create policy payslips_insert on public.payslips for insert to authenticated with check (public.can_edit());
drop policy if exists payslips_update on public.payslips;
create policy payslips_update on public.payslips for update to authenticated
  using (public.can_edit()) with check (public.can_edit());

-- audit log: admins read; rows are only ever written by the trigger
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

------------------------------------------------------------------------------
-- Team leader & employee panels + leave requests
------------------------------------------------------------------------------
-- Older databases: widen the role list (the inline check above only applies to new tables)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'editor', 'viewer', 'team_lead', 'employee'));
-- The employee record a login belongs to (required for team leaders and employees, optional for HR staff)
alter table public.profiles add column if not exists employee_id uuid references public.employees (id) on delete set null;
create unique index if not exists profiles_employee_id_key on public.profiles (employee_id) where employee_id is not null;

-- Hierarchy: who each employee reports to. A team leader sees everyone below them (their team, and their team's teams).
alter table public.employees add column if not exists team_lead_id uuid references public.employees (id) on delete set null;
alter table public.employees drop constraint if exists employees_team_lead_not_self;
alter table public.employees add constraint employees_team_lead_not_self check (team_lead_id is null or team_lead_id <> id);
create index if not exists employees_team_lead_idx on public.employees (team_lead_id);

-- Leave quotas per month, and where leave requests are emailed (blank = sender / reply-to address)
alter table public.settings add column if not exists short_leave_per_month int not null default 1 check (short_leave_per_month >= 0);
alter table public.settings add column if not exists hr_email text;

-- Everyone below `lead` in the hierarchy (cycles are harmless: UNION stops on repeats). Server only.
create or replace function public.team_tree(lead uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive t(id) as (
    select id from public.employees where team_lead_id = lead
    union
    select e.id from public.employees e join t on e.team_lead_id = t.id
  )
  select id from t where id <> lead
$$;
revoke all on function public.team_tree(uuid) from public, anon, authenticated;
grant execute on function public.team_tree(uuid) to service_role;

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type text not null check (leave_type in ('short', 'paid', 'unpaid')),
  start_date date not null,
  end_date date not null,
  days numeric(4,1) not null default 1 check (days >= 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  emailed_at timestamptz,
  emailed_to text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint leave_dates check (end_date >= start_date)
);
create index if not exists leave_requests_emp_idx on public.leave_requests (employee_id, start_date desc);
create index if not exists leave_requests_start_idx on public.leave_requests (start_date desc);
create index if not exists leave_requests_pending_idx on public.leave_requests (status) where status = 'pending';

alter table public.leave_requests enable row level security;
-- HR staff read / decide from the browser; employees and team leaders go through /api/leave (server checks the rules)
drop policy if exists leave_read on public.leave_requests;
create policy leave_read on public.leave_requests for select to authenticated using (public.can_read());
drop policy if exists leave_update on public.leave_requests;
create policy leave_update on public.leave_requests for update to authenticated
  using (public.can_edit()) with check (public.can_edit());

drop trigger if exists leave_audit on public.leave_requests;
create trigger leave_audit after insert or update or delete on public.leave_requests
  for each row execute function public.log_change();

------------------------------------------------------------------------------
-- Documents (files live in Google Drive; this table says what they are and who may see them)
-- employee_id null = company document (terms & conditions, policies…) visible to every login.
------------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees (id) on delete cascade,
  title text not null,
  category text,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  drive_file_id text not null,
  visible_to_employee boolean not null default true,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists documents_employee_idx on public.documents (employee_id, created_at desc);
alter table public.documents enable row level security;
-- HR staff read from the browser; uploads, deletes and every download go through /api/documents
drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated using (public.can_read());

drop trigger if exists documents_audit on public.documents;
create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function public.log_change();

------------------------------------------------------------------------------
-- Two-step leave approval: team leader + HR, each approve / decline independently.
-- status (overall) = rejected if either declined; approved when HR approved and the team leader approved (or has no step); else pending.
------------------------------------------------------------------------------
alter table public.leave_requests add column if not exists tl_status text check (tl_status in ('pending', 'approved', 'rejected', 'not_required'));
alter table public.leave_requests add column if not exists tl_by uuid references public.profiles (id) on delete set null;
alter table public.leave_requests add column if not exists tl_by_name text;
alter table public.leave_requests add column if not exists tl_at timestamptz;
alter table public.leave_requests add column if not exists tl_note text;
alter table public.leave_requests add column if not exists hr_status text check (hr_status in ('pending', 'approved', 'rejected'));
alter table public.leave_requests add column if not exists hr_by uuid references public.profiles (id) on delete set null;
alter table public.leave_requests add column if not exists hr_by_name text;
alter table public.leave_requests add column if not exists hr_at timestamptz;
alter table public.leave_requests add column if not exists hr_note text;
-- requests made before this existed: the old single decision counts as HR's
update public.leave_requests set hr_status = case when status in ('approved', 'rejected') then status else 'pending' end,
  hr_by = decided_by, hr_by_name = decided_by_name, hr_at = decided_at, hr_note = decision_note
  where hr_status is null;
update public.leave_requests set tl_status = 'not_required' where tl_status is null;
alter table public.leave_requests alter column tl_status set default 'not_required';
alter table public.leave_requests alter column tl_status set not null;
alter table public.leave_requests alter column hr_status set default 'pending';
alter table public.leave_requests alter column hr_status set not null;

------------------------------------------------------------------------------
-- Short leave in attendance: the first `short_leave_per_month` are fully paid, extra ones count as half days
------------------------------------------------------------------------------
alter table public.attendance add column if not exists short_leave_days numeric(4,1) not null default 0;

------------------------------------------------------------------------------
-- Paid leave beyond the monthly allowance can still be requested; HR approves it as paid leave or as absent.
-- requested_type = what the employee asked for, leave_type = what it counts as.
------------------------------------------------------------------------------
alter table public.leave_requests add column if not exists requested_type text check (requested_type in ('short', 'paid', 'unpaid'));
alter table public.leave_requests add column if not exists over_quota boolean not null default false;
update public.leave_requests set requested_type = leave_type where requested_type is null;

------------------------------------------------------------------------------
-- Where account emails (login details, password resets) go. Empty = the linked employee's email.
------------------------------------------------------------------------------
alter table public.profiles add column if not exists email text;
