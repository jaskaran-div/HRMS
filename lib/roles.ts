// What each organization role may do. Used by the server (authoritative) and the UI (to hide buttons).
// The database repeats the HR read / edit / admin rules in Row Level Security (supabase/saas.sql).
import type { Role } from './types';

/** HR operations: employees, attendance, payroll, leave decisions, documents. */
export const EDIT_ROLES: Role[] = ['owner', 'admin', 'hr_admin', 'editor'];
/** Organization administration: company settings, templates, deleting records. */
export const ADMIN_ROLES: Role[] = ['owner', 'admin'];
/** May invite / create / manage logins (each only within assignableRoles). */
export const USER_MANAGER_ROLES: Role[] = ['owner', 'admin', 'hr_admin'];

export const canEditRole = (r: Role) => EDIT_ROLES.includes(r);
export const isAdminRole = (r: Role) => ADMIN_ROLES.includes(r);
export const canManageUsers = (r: Role) => USER_MANAGER_ROLES.includes(r);
/** Subscriptions, add-ons, payment methods and ownership: the owner only. */
export const canManageBilling = (r: Role) => r === 'owner';

/**
 * Roles a manager may give to (or take from) other logins. Nobody can grant `owner` (only an ownership
 * transfer can) and platform super admin is not an organization role at all.
 *   owner    → admin, hr_admin, viewer, team_lead, employee
 *   admin    → hr_admin, editor, viewer, team_lead, employee, admin   (existing Derivion admins keep their powers)
 *   hr_admin → team_lead, employee
 */
export function assignableRoles(by: Role): Role[] {
  switch (by) {
    case 'owner': return ['admin', 'hr_admin', 'viewer', 'team_lead', 'employee'];
    case 'admin': return ['admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee'];
    case 'hr_admin': return ['team_lead', 'employee'];
    default: return [];
  }
}

/** May `by` manage (reset password, deactivate, change role of) a login that currently has role `target`? */
export const canManageTarget = (by: Role, target: Role) => target !== 'owner' && assignableRoles(by).includes(target);

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', admin: 'Admin', hr_admin: 'HR Admin', editor: 'HR Editor', viewer: 'HR Viewer',
  team_lead: 'Team Leader', employee: 'Employee',
};

export const ROLE_HELP: Record<Role, string> = {
  owner: 'Registered the organization. Everything, including billing and ownership transfer.',
  admin: 'Organization admin: company settings, templates, all HR work and user access. No billing.',
  hr_admin: 'Employees, attendance, payroll, leave and documents. Can invite team leaders and employees.',
  editor: 'HR work: import, attendance, payslips and leave approval. No user management.',
  viewer: 'Can look at HR data but not change it.',
  team_lead: 'Employee panel + their team’s attendance and leave approvals. Must be linked to an employee.',
  employee: 'Employee panel: own profile, attendance, payslips, documents and leave. Must be linked to an employee.',
};

export const NEEDS_EMPLOYEE: Role[] = ['team_lead', 'employee'];
