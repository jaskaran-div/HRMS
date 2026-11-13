// SERVER ONLY. Invitation helpers shared by the invite and accept routes.
import { supabaseAdmin } from './supabase/admin';
import { hashToken, hoursFromNow, newToken } from './tokens';
import { baseUrl, emailInvitation } from './platform-mail';
import { ROLE_LABEL } from './roles';
import type { Role } from './types';

export const INVITE_DAYS = 7;

export interface InvitationRow {
  id: string; org_id: string; email: string; full_name: string; role: Role; employee_id: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired'; invited_by: string | null; invited_by_name: string | null;
  expires_at: string; accepted_at: string | null; created_at: string;
}

/** Gives the invitation a fresh link (the old one stops working) and emails it. */
export async function sendInvitation(inv: InvitationRow, orgName: string, inviter: string, req: Request) {
  const token = newToken();
  const { error } = await supabaseAdmin().from('invitations')
    .update({ token_hash: hashToken(token), expires_at: hoursFromNow(INVITE_DAYS * 24), status: 'pending' }).eq('id', inv.id);
  if (error) return { ok: false as const, error: error.message };
  const link = `${baseUrl(req)}/invite?token=${token}`;
  const r = await emailInvitation({ to: inv.email, name: inv.full_name, orgName, inviter, roleLabel: ROLE_LABEL[inv.role], link, days: INVITE_DAYS });
  // when email is not set up, the manager can copy the link and send it themselves
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error, link };
}

/** Pending, unexpired invitation for a raw token. */
export async function invitationByToken(token: string): Promise<InvitationRow | null> {
  const { data } = await supabaseAdmin().from('invitations').select('*').eq('token_hash', hashToken(token)).maybeSingle();
  const inv = data as InvitationRow | null;
  if (!inv || inv.status !== 'pending') return null;
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    await supabaseAdmin().from('invitations').update({ status: 'expired' }).eq('id', inv.id);
    return null;
  }
  return inv;
}
