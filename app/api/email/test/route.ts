import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured } from '@/lib/mailer';
import { orgMail } from '@/lib/org-mail';
import { fillTemplate, htmlToText, PLACEHOLDERS, wrapEmail } from '@/lib/email-templates';
import { ADMIN_ROLES } from '@/lib/roles';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin only: sends the template being edited (with sample values) to one address, to check SMTP and the look. */
export async function POST(req: Request) {
  const g = await guard(ADMIN_ROLES);
  if (!g.ok) return g.response;
  if (!mailConfigured())
    return NextResponse.json({ error: 'SMTP is not configured on the server yet. Add SMTP_HOST, SMTP_USER and SMTP_PASS to the environment and restart.' }, { status: 503 });

  const { to, subject, body } = (await req.json().catch(() => ({}))) as { to?: string; subject?: string; body?: string };
  if (!to || !EMAIL.test(to.trim())) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const { data: settings } = await supabaseAdmin().from('settings').select('*').eq('org_id', g.org.id).single();
  if (!settings) return NextResponse.json({ error: 'Company settings are missing.' }, { status: 500 });
  const s = settings as Settings;
  const vars = Object.fromEntries(PLACEHOLDERS.map(p => [p.key, p.key === 'CompanyName' ? s.company_name : p.sample]));
  const html = wrapEmail(fillTemplate(body ?? '<p>This is a test email.</p>', vars, true), s);
  const { from, replyTo, transport } = await orgMail(s);
  try {
    await transport.sendMail({
      from, replyTo, to: to.trim(), subject: `[Test] ${fillTemplate(subject || 'Test email', vars, false)}`, html, text: htmlToText(html),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  return NextResponse.json({ ok: true, from: from.address });
}
