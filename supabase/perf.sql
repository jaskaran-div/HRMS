-- Performance: Row Level Security evaluated once per query instead of once per row.
--
-- Run once in Supabase (SQL Editor), after schema.sql and saas.sql. Safe to run again. Changes no data and no
-- table: only the policies' expressions are rewritten, IN PLACE (ALTER POLICY), so there is never a moment
-- without a policy.
--
-- Why: current_org_id(), can_read(), can_edit(), is_admin() and auth.uid() are functions. Called directly in a
-- policy, Postgres may run them for EVERY row it looks at; can_read() alone is a join of memberships + profiles +
-- organizations, so reading 300 employees cost ~900 extra index lookups. Wrapped in (select ...), Postgres runs
-- each one once per query (an "InitPlan") and compares every row with the result. Same rules, same answers:
-- this is Supabase's own recommendation (Database Advisor lint "auth_rls_initplan").
--
-- Measured on a copy of this schema with 100 organizations x 300 employees (see docs/PERFORMANCE.md).

begin;

-- read: staff of the row's organization
alter policy employees_read      on public.employees          using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy attendance_read     on public.attendance         using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy payslips_read       on public.payslips           using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy exit_read           on public.exit_records       using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy leave_read          on public.leave_requests     using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy documents_read      on public.documents          using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy punches_read        on public.attendance_punches using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy settings_read       on public.settings           using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy email_templates_read on public.email_templates   using (org_id = (select public.current_org_id()) and (select public.can_read()));
alter policy shifts_read         on public.shifts             using (org_id = (select public.current_org_id()) and (select public.can_read()));

-- own row, or admins of the organization
alter policy profiles_read    on public.profiles    using (id = (select auth.uid()) or (org_id = (select public.current_org_id()) and (select public.is_admin())));
alter policy memberships_read on public.memberships using (user_id = (select auth.uid()) or (org_id = (select public.current_org_id()) and (select public.is_admin())));

-- insert
alter policy employees_insert       on public.employees       with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy attendance_insert      on public.attendance      with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy payslips_insert        on public.payslips        with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy exit_insert            on public.exit_records    with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy email_templates_insert on public.email_templates with check (org_id = (select public.current_org_id()) and (select public.is_admin()));

-- update
alter policy employees_update  on public.employees      using (org_id = (select public.current_org_id()) and (select public.can_edit()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy attendance_update on public.attendance     using (org_id = (select public.current_org_id()) and (select public.can_edit()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy payslips_update   on public.payslips       using (org_id = (select public.current_org_id()) and (select public.can_edit()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy exit_update       on public.exit_records   using (org_id = (select public.current_org_id()) and (select public.can_edit()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy leave_update      on public.leave_requests using (org_id = (select public.current_org_id()) and (select public.can_edit()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy settings_update   on public.settings       using (org_id = (select public.current_org_id()) and (select public.is_admin()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.is_admin()));
alter policy email_templates_update on public.email_templates
                                                        using (org_id = (select public.current_org_id()) and (select public.is_admin()))
                                                        with check (org_id = (select public.current_org_id()) and (select public.is_admin()));

-- delete
alter policy employees_delete       on public.employees       using (org_id = (select public.current_org_id()) and (select public.is_admin()));
alter policy attendance_delete      on public.attendance      using (org_id = (select public.current_org_id()) and (select public.is_admin()));
alter policy exit_delete            on public.exit_records    using (org_id = (select public.current_org_id()) and (select public.can_edit()));
alter policy email_templates_delete on public.email_templates using (org_id = (select public.current_org_id()) and (select public.is_admin()));

-- shifts: admins manage them
alter policy shifts_write on public.shifts using (org_id = (select public.current_org_id()) and (select public.is_admin()))
                                           with check (org_id = (select public.current_org_id()) and (select public.is_admin()));

commit;
