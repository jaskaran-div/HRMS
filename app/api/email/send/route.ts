import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { officialEmailOf } from '@/lib/official-email';
import { isOfficial, mailConfigured, notOfficialMsg } from '@/lib/mailer';
import { orgMail } from '@/lib/org-mail';
import {
  baseVars, DEFAULT_TEMPLATES, fillTemplate, htmlToText, TEMPLATE_TYPES, wrapEmail, type EmailTemplateType,
} from '@/lib/email-templates';
import { EDIT_ROLES } from '@/lib/roles';
import type { Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Item {
  employee_id?: string;
  vars?: Record<string, string>;
  attachments?: { filename?: string; base64?: string }[];
}

const MAX_ITEMS = 15;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPTIONAL_VARS = ['PayPeriodMonth', 'PayDate', 'NetPay', 'LastWorkingDay'];

/** Emails a payslip / settlement PDF to each employee using the saved template. The PDFs are built in the browser and sent here. */
export async function POST(req: Request) {
  const g = await guard(EDIT_ROLES, { feature: 'payroll' });
  if (!g.ok) return g.response;
  if (!mailConfigured())
    return NextResponse.json({ error: 'Email is not set up yet: add SMTP_HOST, SMTP_USER and SMTP_PASS to the server environment.' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { type?: EmailTemplateType; items?: Item[] };
  const type = body.type;
  const items = body.items ?? [];
  if (!type || !TEMPLATE_TYPES.includes(type)) return NextResponse.json({ error: 'Unknown email template.' }, { status: 400 });
  if (!items.length || items.length > MAX_ITEMS) return NextResponse.json({ error: `Send between 1 and ${MAX_ITEMS} emails at a time.` }, { status: 400 });

  const admin = supabaseAdmin();
  const [{ data: settings }, { data: tpl }, { data: emps }] = await Promise.all([
    admin.from('settings').select('*').eq('org_id', g.org.id).single(),
    admin.from('email_templates').select('subject, body').eq('org_id', g.org.id).eq('type', type).maybeSingle(),
    admin.from('employees').select('id, name, emp_code, email, extra').eq('org_id', g.org.id).in('id', items.map(i => i.employee_id ?? '')),
  ]);
  if (!settings) return NextResponse.json({ error: 'Company settings are missing.' }, { status: 500 });
  const s = settings as Settings;
  const template = tpl ?? DEFAULT_TEMPLATES[type];
  const { from, replyTo, transport } = await orgMail(s);
  const byId = new Map((emps ?? []).map(e => [e.id as string, e as { id: string; name: string; emp_code: string; email: string | null }]));

  const results: { employee_id: string; ok: boolean; error?: string }[] = [];
  for (const it of items) {
    const id = it.employee_id ?? '';
    const emp = byId.get(id);
    if (!emp) { results.push({ employee_id: id, ok: false, error: 'Employee not found' }); continue; }
    const to = officialEmailOf(emp as never) ?? '';
    if (!EMAIL.test(to)) { results.push({ employee_id: id, ok: false, error: 'No valid email address on file' }); continue; }
    if (!isOfficial(to, s)) { results.push({ employee_id: id, ok: false, error: notOfficialMsg(s) }); continue; }
    const attachments = (it.attachments ?? []).filter(a => a.filename && a.base64)
      .map(a => ({ filename: a.filename!.replace(/[^\w.\- ]/g, '_'), content: Buffer.from(a.base64!, 'base64'), contentType: 'application/pdf' }));
    if (!attachments.length) { results.push({ employee_id: id, ok: false, error: 'Nothing to attach' }); continue; }

    const vars = baseVars(s.company_name, emp);
    for (const k of OPTIONAL_VARS) if (typeof it.vars?.[k] === 'string') vars[k] = it.vars[k].slice(0, 200);
    const html = wrapEmail(fillTemplate(template.body, vars, true), s);
    try {
      await transport.sendMail({
        from, replyTo, to,
        subject: fillTemplate(template.subject, vars, false),
        html, text: htmlToText(html), attachments,
      });
      results.push({ employee_id: id, ok: true });
    } catch (e) {
      results.push({ employee_id: id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const sent = results.filter(r => r.ok).length;
  return NextResponse.json({ results, sent });
}
