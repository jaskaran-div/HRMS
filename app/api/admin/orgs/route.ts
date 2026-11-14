import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { platformGuard } from '@/lib/auth';
import { createOrganization, EMAIL_RE } from '@/lib/registration';
import { ALL_FEATURES, isFeature } from '@/lib/billing/catalog';
import { baseUrl, emailOwnerCreated } from '@/lib/platform-mail';

export const dynamic = 'force-dynamic';

const limit = (v: unknown) => (v === '' || v == null ? null : Math.max(0, Math.floor(Number(v))) || 0);

/**
 * Platform admin creates an organization with its owner login.
 * Body: { org_name, full_name, email, password?, phone?, country?, billing: 'exempt' | 'stripe',
 *         features?: { [feature]: 'plan' | 'on' | 'off' }, max_employees?, max_users?, send_email? }
 * billing 'exempt' = active now, no payment (managed / invoiced offline); 'stripe' = the owner pays in Billing.
 */
export async function POST(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  const orgName = str('org_name', 120), fullName = str('full_name', 120), email = str('email', 200).toLowerCase();
  if (orgName.length < 2) return NextResponse.json({ error: 'Enter the organization name.' }, { status: 400 });
  if (fullName.length < 2) return NextResponse.json({ error: 'Enter the owner’s name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter a valid owner email.' }, { status: 400 });
  const given = String(b.password ?? '');
  if (given && given.length < 10) return NextResponse.json({ error: 'The password needs at least 10 characters (or leave it blank to generate one).' }, { status: 400 });
  const password = given || `${randomBytes(9).toString('base64url')}#7`;
  const exempt = b.billing === 'exempt';
  const features = (b.features ?? {}) as Record<string, string>;
  const overrides = { grant: ALL_FEATURES.filter(f => features[f] === 'on'), revoke: ALL_FEATURES.filter(f => features[f] === 'off') };

  const r = await createOrganization({
    orgName, fullName, email, password, phone: str('phone', 40) || null, country: str('country', 80) || null,
    emailVerified: true, status: exempt ? 'active' : 'pending_payment', billingExempt: exempt,
    maxEmployees: limit(b.max_employees), maxUsers: limit(b.max_users),
    overrides: { grant: overrides.grant.filter(isFeature), revoke: overrides.revoke.filter(isFeature) },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.taken ? 409 : 500 });
  const mail = b.send_email === false ? null : await emailOwnerCreated({ to: email, name: fullName, orgName, password, url: baseUrl(req), pays: !exempt });
  return NextResponse.json({ ok: true, id: r.orgId, email, password: given ? null : password, mail });
}
