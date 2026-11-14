// SERVER ONLY. Which mail account an organization's emails go out through.
//  * The organization connected its own mail server (Customisations → Your mail server): emails are sent
//    through THEIR account, from THEIR address — employees never see the platform's address.
//  * Otherwise: the platform SMTP account from the environment, with the organization's sender name.
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { supabaseAdmin } from './supabase/admin';
import { mailTransport, senderOf } from './mailer';
import { open } from './secret-box';
import { LOGO_CID } from './email-templates';
import type { Settings } from './types';

export interface OrgMailServer {
  org_id: string; provider: string | null; host: string; port: number; secure: boolean; username: string;
  password_enc: string; from_email: string; verified_at: string | null; updated_at: string;
}

/** Only what callers use; sendMail adds the company logo when the email shows it. */
export interface OrgTransport { sendMail(m: Mail.Options): Promise<unknown> }

export interface OrgMailer {
  transport: OrgTransport;
  from: { name: string; address: string };
  replyTo: string | undefined;
  /** true = the organization's own mail server */
  own: boolean;
}

const cache = new Map<string, { at: number; row: OrgMailServer | null }>();

export async function orgMailServer(orgId: string): Promise<OrgMailServer | null> {
  const c = cache.get(orgId);
  if (c && Date.now() - c.at < 30_000) return c.row;
  const { data } = await supabaseAdmin().from('org_mail_settings').select('*').eq('org_id', orgId).maybeSingle();
  const row = (data as OrgMailServer | null) ?? null;
  cache.set(orgId, { at: Date.now(), row });
  return row;
}
export const forgetOrgMailServer = (orgId: string) => cache.delete(orgId);

export function transportFor(m: Pick<OrgMailServer, 'host' | 'port' | 'secure' | 'username'>, password: string): Mail {
  return nodemailer.createTransport({
    host: m.host, port: m.port, secure: m.secure, auth: { user: m.username, pass: password },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
}

/** The settings logo (data URL) as an inline attachment, when the email's HTML refers to it. */
export function withLogo(t: Mail, logo: string | null | undefined): OrgTransport {
  const m = logo ? /^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/.exec(logo) : null;
  return {
    sendMail: (opts: Mail.Options) => {
      if (m && typeof opts.html === 'string' && opts.html.includes(`cid:${LOGO_CID}`)) {
        const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
        opts = { ...opts, attachments: [...(opts.attachments ?? []), { filename: `logo.${ext}`, content: Buffer.from(m[2], 'base64'), contentType: m[1], cid: LOGO_CID, contentDisposition: 'inline' }] };
      }
      return t.sendMail(opts);
    },
  };
}

/** The transport + From / Reply-To for one organization's emails (with its current logo). */
export async function orgMail(s: Pick<Settings, 'org_id' | 'company_name' | 'sender_name' | 'sender_email' | 'reply_to'> & { logo?: string | null }): Promise<OrgMailer> {
  const name = (s.sender_name || s.company_name).trim();
  const replyTo = s.reply_to?.trim() || undefined;
  const own = s.org_id ? await orgMailServer(s.org_id) : null;
  if (own) {
    try {
      return { transport: withLogo(transportFor(own, open(own.password_enc)), s.logo), from: { name, address: own.from_email }, replyTo, own: true };
    } catch (e) {
      // the key changed or the row is damaged: fall back rather than lose the email, and say so in the server log
      console.error('organization mail server unusable, using the platform account', s.org_id, e);
    }
  }
  const p = senderOf(s);
  return { transport: withLogo(mailTransport(), s.logo), from: p.from, replyTo: p.replyTo, own: false };
}
