import { NextResponse } from 'next/server';
import { mobileSession, ymParam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { distanceM, MAX_GPS_ACCURACY_M, todayIST } from '@/lib/geo';
import { daysInMonth } from '@/lib/dates';
import { markDay } from '@/lib/attendance-mark';
import { decideCheckIn, minutesIST, type CheckInDecision, type DayLeave } from '@/lib/late';
import type { Punch, Settings } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET ?month=YYYY-MM — the employee's check-ins for that month (default: this month). */
export async function GET(req: Request) {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const ym = ymParam(new URL(req.url).searchParams.get('month')) ?? todayIST().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const { data, error } = await supabaseAdmin().from('attendance_punches').select('*').eq('employee_id', r.s.me.id)
    .gte('day', `${ym}-01`).lte('day', `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`).order('day', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ punches: (data ?? []) as Punch[] });
}

/**
 * Applies the office-timing rules (Company & Rules → Office timing) to a check-in happening now: the late allowance,
 * the morning / second-half check-in windows, and the employee's morning or evening short leave / half day that day
 * (approved, or still pending).
 */
async function checkInRule(employeeId: string, day: string, st: Settings): Promise<CheckInDecision> {
  const admin = supabaseAdmin();
  const [{ data: leaves }, { count }] = await Promise.all([
    admin.from('leave_requests').select('leave_type, short_session, status').eq('employee_id', employeeId)
      .in('leave_type', ['short', 'half']).eq('start_date', day).in('status', ['approved', 'pending']),
    admin.from('attendance_punches').select('id', { count: 'exact', head: true }).eq('employee_id', employeeId)
      .eq('in_status', 'late').gte('day', `${day.slice(0, 7)}-01`).lt('day', day),
  ]);
  // a half day outweighs a short leave; an approved one outweighs a pending one
  const l = [...(leaves ?? [])].sort((a, b) => (a.leave_type === 'half' ? -1 : 1) - (b.leave_type === 'half' ? -1 : 1)
    || (a.status === 'approved' ? -1 : 1) - (b.status === 'approved' ? -1 : 1))[0];
  const leave: DayLeave | null = l ? { type: l.leave_type, session: l.short_session ?? null, approved: l.status === 'approved' } : null;
  return decideCheckIn(minutesIST(), st, count ?? 0, leave);
}

/**
 * Body: { action: 'in' | 'out', lat, lng, accuracy, mocked?, timestamp? }
 * The phone sends a fresh GPS fix; the server checks it is within the office radius.
 */
export async function POST(req: Request) {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const { me, settings: st, profile } = r.s;
  const b = (await req.json().catch(() => ({}))) as { action?: string; lat?: number; lng?: number; accuracy?: number; mocked?: boolean; timestamp?: number };

  if (b.action !== 'in' && b.action !== 'out') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (st.office_lat == null || st.office_lng == null)
    return NextResponse.json({ error: 'HR has not set the office location yet. Ask HR to set it under Company & Rules.' }, { status: 400 });
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return NextResponse.json({ error: 'Could not read your location. Turn on GPS and try again.' }, { status: 400 });
  if (b.mocked) return NextResponse.json({ error: 'A fake-location app is active on this phone. Turn it off to check in.' }, { status: 400 });
  if (b.timestamp && Math.abs(Date.now() - Number(b.timestamp)) > 2 * 60 * 1000)
    return NextResponse.json({ error: 'Your location is out of date. Try again.' }, { status: 400 });
  if (!Number.isFinite(acc) || acc > MAX_GPS_ACCURACY_M)
    return NextResponse.json({ error: `GPS is not precise enough yet (±${Number.isFinite(acc) ? Math.round(acc) : '?'} m). Wait a few seconds, or step near a window, and try again.` }, { status: 400 });

  const radius = st.office_radius_m ?? 100;
  const dist = distanceM(lat, lng, st.office_lat, st.office_lng);
  if (dist > radius)
    return NextResponse.json({ error: `You are ${Math.round(dist)} m from the office. You can check ${b.action} only within ${radius} m.`, distance_m: Math.round(dist) }, { status: 400 });

  const admin = supabaseAdmin();
  const day = todayIST();
  const { data: existing } = await admin.from('attendance_punches').select('*').eq('employee_id', me.id).eq('day', day).maybeSingle();
  const now = new Date().toISOString();
  const fix = { lat, lng, accuracy_m: Math.round(acc * 10) / 10, distance_m: Math.round(dist * 10) / 10 };

  let punch: Punch;
  let message: string | undefined;
  if (b.action === 'in') {
    if (existing) return NextResponse.json({ error: 'You have already checked in today.', punch: existing }, { status: 409 });
    const late = await checkInRule(me.id, day, st);
    if (!late.ok) return NextResponse.json({ error: late.error }, { status: 400 });
    const { data, error } = await admin.from('attendance_punches').insert({
      employee_id: me.id, day, in_at: now, in_lat: fix.lat, in_lng: fix.lng, in_accuracy_m: fix.accuracy_m, in_distance_m: fix.distance_m, created_by: profile.id,
      in_status: late.status,
    }).select('*').single();
    if (error || !data) {
      if (error?.code === '23505') return NextResponse.json({ error: 'You have already checked in today.' }, { status: 409 });
      return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    }
    punch = data as Punch;
    message = late.message;
    await markDay(me.id, me.doj, Number(me.monthly_salary), day, late.code);
  } else {
    if (!existing) return NextResponse.json({ error: 'Check in first.' }, { status: 400 });
    const { data, error } = await admin.from('attendance_punches').update({
      out_at: now, out_lat: fix.lat, out_lng: fix.lng, out_accuracy_m: fix.accuracy_m, out_distance_m: fix.distance_m,
    }).eq('id', existing.id).select('*').single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    punch = data as Punch;
  }
  return NextResponse.json({ ok: true, punch, message });
}
