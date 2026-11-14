import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { officialEmailOf } from '@/lib/official-email';
import { isOfficial, mailConfigured, notOfficialMsg } from '@/lib/mailer';
import { orgMail } from '@/lib/org-mail';
import { baseVars, fillTemplate, htmlToText, wrapEmail } from '@/lib/email-templates';
import { EDIT_ROLES } from '@/lib/roles';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPTIONAL_VARS = ['PayPeriodMonth', 'PayDate', 'NetPay', 'LastWorkingDay'];
const MAX_BYTES = 8 * 1024 * 1024;

/** HR writes (or edits a template into) a one-off email to a single employee, with optional attachments. */
export async function POST(req: Request) {
  const g = await guard(EDIT_ROLES, { feature: 'email_center' });
  if (!g.ok) return g.response;
  if (!mailConfigured())
    return NextResponse.json({ error: 'Email is not set up yet: add SMTP_HOST, SMTP_USER and SMTP_PASS to the server environment.' }, { status: 503 });

  const b = (await req.json().catch(() => ({}))) as {
    employee_id?: string; subject?: string; body?: string; vars?: Record<string, string>;
    attachments?: { filename?: string; base64?: string; contentType?: string }[];
  };
  const subject = (b.subject ?? '').trim();
  const body = (b.body ?? '').trim();
  if (!b.employee_id) return NextResponse.json({ error: 'No employee chosen.' }, { status: 400 });
  if (!subject) return NextResponse.json({ error: 'Write a subject.' }, { status: 400 });
  if (!body) return NextResponse.json({ error: 'Write the message.' }, { status: 400 });

  const admin = supabaseAdmin();
  const [{ data: settings }, { data: emp }] = await Promise.all([
    admin.from('settings').select('*').eq('org_id', g.org.id).single(),
    admin.from('employees').select('id, name, emp_code, email, extra').eq('id', b.employee_id).eq('org_id', g.org.id).maybeSingle(),
  ]);
  if (!settings) return NextResponse.json({ error: 'Company settings are missing.' }, { status: 500 });
  if (!emp) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  const to = officialEmailOf(emp) ?? '';
  if (!EMAIL.test(to)) return NextResponse.json({ error: 'This employee has no valid email address on file.' }, { status: 400 });
  if (!isOfficial(to, settings as Settings)) return NextResponse.json({ error: `${to}: ${notOfficialMsg(settings as Settings)}` }, { status: 400 });

  const files = (b.attachments ?? []).filter(a => a.filename && a.base64);
  const attachments = files.map(a => ({
    filename: a.filename!.replace(/[^\w.\- ()]/g, '_'), content: Buffer.from(a.base64!, 'base64'),
    ...(a.contentType ? { contentType: a.contentType } : {}),
  }));
  if (attachments.reduce((n, a) => n + a.content.length, 0) > MAX_BYTES)
    return NextResponse.json({ error: 'Attachments are too large (8 MB total).' }, { status: 413 });

  const s = settings as Settings;
  const vars = baseVars(s.company_name, emp as { name: string; emp_code: string });
  for (const k of OPTIONAL_VARS) vars[k] = typeof b.vars?.[k] === 'string' ? b.vars[k].slice(0, 200) : '';
  const html = wrapEmail(fillTemplate(body, vars, true), s);
  const { from, replyTo, transport } = await orgMail(s);
  try {
    await transport.sendMail({ from, replyTo, to, subject: fillTemplate(subject, vars, false), html, text: htmlToText(html), attachments });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  return NextResponse.json({ ok: true, to });
}
