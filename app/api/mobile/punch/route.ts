import { NextResponse } from 'next/server';
import { mobileSession, ymParam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { distanceM, MAX_GPS_ACCURACY_M, todayIST } from '@/lib/geo';
import { daysInMonth, isOffSaturday } from '@/lib/dates';
import type { Punch } from '@/lib/types';

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

const KEY_OF: Record<string, 'present_days' | 'absent_days' | 'weekoff_days' | 'half_days' | 'leave_days' | 'holiday_days' | 'short_leave_days'> = {
  P: 'present_days', A: 'absent_days', W: 'weekoff_days', H: 'half_days', L: 'leave_days', O: 'holiday_days', S: 'short_leave_days',
};

/**
 * Marks today Present in the monthly attendance (same shape the HR grid saves), unless HR already marked the day.
 * Unmarked 2nd / 4th Saturdays are filled as week offs, exactly as the grid does on save, so the totals match.
 */
async function markPresent(employeeId: string, doj: string | null, salary: number, day: string) {
  const admin = supabaseAdmin();
  const month = `${day.slice(0, 7)}-01`;
  const [y, m] = month.split('-').map(Number);
  const d = Number(day.slice(8, 10));
  const { data: row } = await admin.from('attendance').select('*').eq('employee_id', employeeId).eq('month', month).maybeSingle();
  const daily: Record<string, string> = { ...((row?.daily as Record<string, string> | null) ?? {}) };
  if (row && !row.daily) return; // HR entered this month as totals only: leave it to HR
  if (daily[String(d)]) return;
  daily[String(d)] = 'P';
  let first = 1;
  if (doj) {
    const [jy, jm, jd] = doj.split('-').map(Number);
    if (jy === y && jm === m) first = jd;
  }
  for (let i = first; i <= daysInMonth(y, m); i++) if (!daily[String(i)] && isOffSaturday(y, m, i)) daily[String(i)] = 'W';
  const counts = { present_days: 0, absent_days: 0, weekoff_days: 0, half_days: 0, leave_days: 0, holiday_days: 0, short_leave_days: 0 };
  for (const c of Object.values(daily)) if (KEY_OF[c]) counts[KEY_OF[c]]++;
  await admin.from('attendance').upsert({
    employee_id: employeeId, month, salary: Number(row?.salary) || salary || 0,
    arrears: row?.arrears ?? 0, other_deduction: row?.other_deduction ?? 0, ...counts, daily,
  }, { onConflict: 'employee_id,month' });
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
  if (b.action === 'in') {
    if (existing) return NextResponse.json({ error: 'You have already checked in today.', punch: existing }, { status: 409 });
    const { data, error } = await admin.from('attendance_punches').insert({
      employee_id: me.id, day, in_at: now, in_lat: fix.lat, in_lng: fix.lng, in_accuracy_m: fix.accuracy_m, in_distance_m: fix.distance_m, created_by: profile.id,
    }).select('*').single();
    if (error || !data) {
      if (error?.code === '23505') return NextResponse.json({ error: 'You have already checked in today.' }, { status: 409 });
      return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    }
    punch = data as Punch;
    await markPresent(me.id, me.doj, Number(me.monthly_salary), day);
  } else {
    if (!existing) return NextResponse.json({ error: 'Check in first.' }, { status: 400 });
    const { data, error } = await admin.from('attendance_punches').update({
      out_at: now, out_lat: fix.lat, out_lng: fix.lng, out_accuracy_m: fix.accuracy_m, out_distance_m: fix.distance_m,
    }).eq('id', existing.id).select('*').single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    punch = data as Punch;
  }
  await admin.from('audit_log').insert({
    user_id: profile.id, username: profile.username, table_name: 'attendance_punches', op: b.action === 'in' ? 'CHECK_IN' : 'CHECK_OUT',
    row_id: punch.id, new_data: { employee_id: me.id, day, distance_m: fix.distance_m, accuracy_m: fix.accuracy_m },
  });
  return NextResponse.json({ ok: true, punch });
}
