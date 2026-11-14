import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createOrganization, EMAIL_RE, sendOwnerVerification } from '@/lib/registration';

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

  const r = await createOrganization({ orgName, fullName, email, password, phone, country, employees, emailVerified: false });
  if (!r.ok) return NextResponse.json({ error: r.taken ? 'An account with this email already exists. Log in instead, or use another email.' : r.error }, { status: r.taken ? 409 : 500 });
  const { userId, orgId } = r;

  const mail = await sendOwnerVerification({ userId, orgId, email, name: fullName, orgName, req });
  return NextResponse.json({ ok: true, emailed: mail.ok, ...(mail.ok ? {} : { mailError: 'We could not send the verification email yet. Use “Resend” in a minute.' }) });
}
