import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Owner, once the organization is active: initial company setup. Body: company + leave rules + optional office location. */
export async function POST(req: Request) {
  const g = await guard(['owner']);
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  const num = (k: string) => (b[k] === '' || b[k] == null ? null : Number(b[k]));
  const company = str('company_name', 120);
  if (company.length < 2) return NextResponse.json({ error: 'Enter the company name.' }, { status: 400 });
  const paid = num('paid_leave_per_month') ?? 1;
  const short = num('short_leave_per_month') ?? 1;
  if (!(paid >= 0 && paid <= 31) || !(short >= 0 && short <= 31)) return NextResponse.json({ error: 'Leave allowances must be between 0 and 31.' }, { status: 400 });
  const lat = num('office_lat'), lng = num('office_lng'), radius = num('office_radius_m') ?? 100;
  if ((lat == null) !== (lng == null) || (lat != null && (Math.abs(lat) > 90 || Math.abs(lng!) > 180)))
    return NextResponse.json({ error: 'Enter both office latitude and longitude, or leave both blank.' }, { status: 400 });
  if (radius < 20 || radius > 5000) return NextResponse.json({ error: 'Check-in radius must be 20–5000 m.' }, { status: 400 });
  const domains = str('email_domains', 300).split(',').map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(x => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)).join(',') || null;
  const hrEmail = str('hr_email', 200) || null;

  const admin = supabaseAdmin();
  const { error } = await admin.from('settings').update({
    company_name: company, company_address: str('company_address', 400), hr_email: hrEmail, email_domains: domains,
    paid_leave_per_month: paid, short_leave_per_month: Math.round(short),
    office_lat: lat, office_lng: lng, office_radius_m: Math.round(radius),
  }).eq('org_id', g.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from('organizations').update({ name: company, onboarded_at: g.org.onboarded_at ?? new Date().toISOString() }).eq('id', g.org.id);
  return NextResponse.json({ ok: true });
}
