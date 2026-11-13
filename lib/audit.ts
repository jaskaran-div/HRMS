// SERVER ONLY. Organization audit log (role changes, invitations, deactivations, ownership, billing).
import { supabaseAdmin } from './supabase/admin';
import { clientIp } from './auth';

export type AuditAction =
  | 'org.registered' | 'org.email_verified' | 'org.onboarded' | 'org.settings_changed'
  | 'user.created' | 'user.deleted' | 'user.role_changed' | 'user.deactivated' | 'user.activated'
  | 'user.password_reset' | 'user.password_set' | 'user.employee_linked' | 'user.email_changed'
  | 'invitation.sent' | 'invitation.resent' | 'invitation.revoked' | 'invitation.accepted'
  | 'ownership.transfer_started' | 'ownership.transfer_cancelled' | 'ownership.transferred'
  | 'billing.checkout_started' | 'billing.subscription_changed' | 'billing.payment_succeeded' | 'billing.payment_failed'
  | 'billing.addons_changed' | 'billing.portal_opened'
  | 'platform.entitlements_changed' | 'platform.status_changed' | 'platform.synced';

export interface AuditEntry {
  orgId: string;
  actor?: { id: string; full_name?: string | null } | null;
  /** shown when there is no actor login (e.g. "Stripe", "Platform admin") */
  actorName?: string;
  action: AuditAction;
  target?: { type: string; id?: string | null; label?: string | null };
  details?: Record<string, unknown>;
}

/** Appends to the log. Never throws: an audit failure must not undo the action, but it is reported in the server log. */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    let ip: string | null = null;
    try { ip = await clientIp(); } catch { /* outside a request (webhook helpers) */ }
    const { error } = await supabaseAdmin().from('org_audit_logs').insert({
      org_id: e.orgId, actor_id: e.actor?.id ?? null, actor_name: e.actor?.full_name ?? e.actorName ?? null,
      action: e.action, target_type: e.target?.type ?? null, target_id: e.target?.id ?? null, target_label: e.target?.label ?? null,
      details: e.details ?? {}, ip,
    });
    if (error) console.error('audit log insert failed', e.action, error.message);
  } catch (err) {
    console.error('audit log insert failed', e.action, err);
  }
}
