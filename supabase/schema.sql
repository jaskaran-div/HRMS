-- HR Portal schema. Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.

------------------------------------------------------------------------------
-- Users (logins live in Supabase Auth; this table holds username + role)
------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9]{2,30}$'),
  full_name text not null,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

-- Permission helpers (security definer so policies can read profiles without recursion)
create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
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
