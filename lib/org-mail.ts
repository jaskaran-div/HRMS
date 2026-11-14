// SERVER ONLY. The mail transport + From / Reply-To for one organization's emails, with its current logo.
// All organizations send through the platform SMTP account from the environment, under their own sender name.
import type Mail from 'nodemailer/lib/mailer';
import { mailTransport, senderOf } from './mailer';
import { LOGO_CID } from './email-templates';
import type { Settings } from './types';

/** Only what callers use; sendMail adds the company logo when the email shows it. */
export interface OrgTransport { sendMail(m: Mail.Options): Promise<unknown> }

export interface OrgMailer {
  transport: OrgTransport;
  from: { name: string; address: string };
  replyTo: string | undefined;
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

export async function orgMail(s: Pick<Settings, 'company_name' | 'sender_name' | 'sender_email' | 'reply_to'> & { logo?: string | null }): Promise<OrgMailer> {
  const p = senderOf(s);
  return { transport: withLogo(mailTransport(), s.logo), from: p.from, replyTo: p.replyTo };
}
