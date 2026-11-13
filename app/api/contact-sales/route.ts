import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clientIp, currentUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { EMAIL_RE } from '@/lib/registration';
import { emailSalesInquiry } from '@/lib/platform-mail';

export const dynamic = 'force-dynamic';

/** Public Contact Sales form (web only). Stored, and emailed to SALES_EMAIL. */
export async function POST(req: Request) {
  const ip = (await clientIp()) ?? 'unknown';
  if (!rateLimit(`sales:${ip}`, 5, 3600_000)) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max) || null;
  if (str('website', 200)) return NextResponse.json({ ok: true });
  const row = { name: str('name', 120), email: (str('email', 200) ?? '').toLowerCase(), company: str('company', 160), phone: str('phone', 40), employees: str('employees', 40), message: str('message', 4000) };
  if (!row.name) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
  if (!EMAIL_RE.test(row.email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const user = await currentUser().catch(() => null);
  const admin = supabaseAdmin();
  const { data: m } = user ? await admin.from('memberships').select('org_id').eq('user_id', user.id).maybeSingle() : { data: null };
  const { error } = await admin.from('sales_inquiries').insert({ ...row, name: row.name, user_id: user?.id ?? null, org_id: m?.org_id ?? null });
  if (error) return NextResponse.json({ error: 'Could not send your request. Please try again.' }, { status: 500 });
  await emailSalesInquiry({ ...row, name: row.name });
  return NextResponse.json({ ok: true });
}
