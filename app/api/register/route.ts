import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { EMAIL_RE, freeSlug, freeUsername, sendOwnerVerification } from '@/lib/registration';

export const dynamic = 'force-dynamic';

/**
 * Web-only organization registration. Creates: login (unverified), organization (pending_payment),
 * owner profile + OWNER membership, the organization's settings row; then emails a verification link.
 * Body: { org_name, full_name, email, password, phone?, country?, employees?, website? (honeypot) }
 */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? 'unknown';
  if (!rateLimit(`register:${ip}`, 5, 3600_000))
    return NextResponse.json({ error: 'Too many registrations from this network. Try again in an hour.' }, { status: 429 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  if (str('website', 200)) return NextResponse.json({ ok: true }); // bots fill hidden fields
  const orgName = str('org_name', 120);
  const fullName = str('full_name', 120);
  const email = str('email', 200).toLowerCase();
  const password = String(b.password ?? '');
  const phone = str('phone', 40) || null;
  const country = str('country', 80) || null;
  const employees = Number(b.employees) > 0 ? Math.min(Math.floor(Number(b.employees)), 1_000_000) : null;

  if (orgName.length < 2) return NextResponse.json({ error: 'Enter your organization’s name.' }, { status: 400 });
  if (fullName.length < 2) return NextResponse.json({ error: 'Enter your full name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid work email address.' }, { status: 400 });
  if (password.length < 10) return NextResponse.json({ error: 'Use a password of at least 10 characters.' }, { status: 400 });
  if (password.toLowerCase().includes(email.split('@')[0])) return NextResponse.json({ error: 'Do not use your email name in the password.' }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: false, user_metadata: { full_name: fullName },
  });
  if (uErr || !created.user) {
    const taken = /already|registered|exists/i.test(uErr?.message ?? '');
    return NextResponse.json({ error: taken ? 'An account with this email already exists. Log in instead, or use another email.' : (uErr?.message ?? 'Could not create the account.') }, { status: taken ? 409 : 400 });
  }
  const userId = created.user.id;
  let orgId: string | null = null;
  try {
    const { data: org, error: oErr } = await admin.from('organizations').insert({
      name: orgName, slug: await freeSlug(orgName), status: 'pending_payment', owner_user_id: userId, owner_email: email,
      phone, country, employee_count_hint: employees,
    }).select('id').single();
    if (oErr || !org) throw new Error(oErr?.message ?? 'organization');
    orgId = org.id as string;
    const username = await freeUsername(email);
    const { error: pErr } = await admin.from('profiles').insert({
      id: userId, org_id: orgId, username, full_name: fullName, role: 'owner', email, must_change_password: false,
    });
    if (pErr) throw new Error(pErr.message);
    const { error: mErr } = await admin.from('memberships').insert({ org_id: orgId, user_id: userId, role: 'owner' });
    if (mErr) throw new Error(mErr.message);
    const domain = email.split('@')[1];
    const { error: sErr } = await admin.from('settings').insert({
      org_id: orgId, company_name: orgName, company_address: '', footer_note: '-- This is a system-generated document. --',
      sender_name: orgName, sender_email: process.env.PLATFORM_SENDER_EMAIL || process.env.SMTP_USER || email,
      reply_to: email, hr_email: email, email_domains: domain,
    });
    if (sErr) throw new Error(sErr.message);
  } catch (e) {
    // undo everything: the organization (cascades to profile, membership, settings) and the login
    if (orgId) await admin.from('organizations').delete().eq('id', orgId);
    await admin.auth.admin.deleteUser(userId);
    console.error('registration failed', e);
    return NextResponse.json({ error: 'Could not create the organization. Please try again.' }, { status: 500 });
  }

  await audit({ orgId, actor: { id: userId, full_name: fullName }, action: 'org.registered', target: { type: 'organization', id: orgId, label: orgName }, details: { email } });
  const mail = await sendOwnerVerification({ userId, orgId, email, name: fullName, orgName, req });
  return NextResponse.json({ ok: true, emailed: mail.ok, ...(mail.ok ? {} : { mailError: 'We could not send the verification email yet. Use “Resend” in a minute.' }) });
}
