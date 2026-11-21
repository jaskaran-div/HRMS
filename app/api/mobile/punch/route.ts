import { NextResponse } from 'next/server';
import { mobileSession, ymParam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { distanceM, MAX_GPS_ACCURACY_M, todayIST } from '@/lib/geo';
import { daysInMonth } from '@/lib/dates';
import { markDay } from '@/lib/attendance-mark';
import { decideCheckIn, decideCheckOut, fmtTime, minutesIST, windows, type CheckInDecision, type DayLeave, type ShiftTimes } from '@/lib/late';
import type { Employee, Punch, Settings, Shift } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The employee's shift with its own timing rules, or null (= the company office timing). */
async function shiftOf(me: Pick<Employee, 'shift_id'>): Promise<Shift | null> {
  if (!me.shift_id) return null;
  const { data } = await supabaseAdmin().from('shifts').select('*').eq('id', me.shift_id).maybeSingle();
  return (data as Shift | null) ?? null;
}

/**
 * Applies the office-timing rules (Company & Rules → Office timing: the employee's shift tab, else "No shift") to a check-in
 * happening now: the late allowance, the morning / second-half check-in windows, and the employee's morning or evening
 * short leave / half day that day (approved, or still pending).
 */
async function checkInRule(employeeId: string, day: string, st: Settings, shift: ShiftTimes): Promise<CheckInDecision> {
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
  return decideCheckIn(minutesIST(), st, count ?? 0, leave, shift);
}

/**
 * GET ?month=YYYY-MM — the employee's check-ins for that month (default: this month), plus `today`: whether check-in /
 * check-out is open right now and why not, so the app can disable the button and show the reason before it is tapped.
 */
export async function GET(req: Request) {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const { me, settings: st } = r.s;
  const day = todayIST();
  const ym = ymParam(new URL(req.url).searchParams.get('month')) ?? day.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const admin = supabaseAdmin();
  const [{ data, error }, { data: mine }, shift] = await Promise.all([
    admin.from('attendance_punches').select('*').eq('employee_id', me.id)
      .gte('day', `${ym}-01`).lte('day', `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`).order('day', { ascending: false }),
    admin.from('attendance_punches').select('*').eq('employee_id', me.id).eq('day', day).maybeSingle(),
    shiftOf(me),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const p = mine as Punch | null;
  const w = windows(st, shift);
  let inState: { allowed: boolean; note: string | null };
  if (p) inState = { allowed: false, note: `Checked in at ${new Date(p.in_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.` };
  else if (st.office_lat == null || st.office_lng == null) inState = { allowed: false, note: 'HR has not set the office location yet.' };
  else {
    const d = await checkInRule(me.id, day, st, shift);
    inState = d.ok
      ? { allowed: true, note: d.status === 'half_day' || d.code === 'H' ? 'Checking in now counts as a half day.' : d.status === 'late' ? 'Checking in now counts as a late check-in.' : null }
      : { allowed: false, note: d.error };
  }
  let outState: { allowed: boolean; note: string | null };
  if (!p) outState = { allowed: false, note: 'Check in first.' };
  else if (p.out_missed) outState = { allowed: false, note: 'You did not check out in time, so today counts as a half day.' };
  else {
    const d = decideCheckOut(minutesIST(), st, shift);
    outState = d.ok
      ? { allowed: true, note: w?.checkoutBy != null ? `Check out by ${fmtTime(w.checkoutBy)}, or today counts as a half day.` : null }
      : { allowed: false, note: d.error };
  }
  return NextResponse.json({
    punches: (data ?? []) as Punch[],
    today: {
      day,
      shift: shift ? { name: shift.name, start: fmtTime(shift.start_time), end: fmtTime(shift.end_time) } : null,
      check_in: inState,
      check_out: outState,
      // the day's times, for display (null = no office timing rule)
      times: w ? {
        start: fmtTime(w.start), check_in_by: fmtTime(w.start), late_until: fmtTime(w.grace), check_in_closes: fmtTime(w.close),
        second_half: `${fmtTime(w.second)} – ${fmtTime(w.deadline)}`, check_out_by: w.checkoutBy != null ? fmtTime(w.checkoutBy) : null,
      } : null,
    },
  });
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

  // time rules first: no point asking for a GPS fix when the window is closed anyway
  const admin = supabaseAdmin();
  const day = todayIST();
  const [{ data: existing }, shift] = await Promise.all([
    admin.from('attendance_punches').select('*').eq('employee_id', me.id).eq('day', day).maybeSingle(),
    shiftOf(me),
  ]);
  let rule: CheckInDecision | null = null;
  if (b.action === 'in') {
    if (existing) return NextResponse.json({ error: 'You have already checked in today.', punch: existing }, { status: 409 });
    rule = await checkInRule(me.id, day, st, shift);
    if (!rule.ok) return NextResponse.json({ error: rule.error }, { status: 400 });
  } else {
    if (!existing) return NextResponse.json({ error: 'Check in first.' }, { status: 400 });
    if ((existing as Punch).out_missed) return NextResponse.json({ error: 'You did not check out in time, so today counts as a half day.' }, { status: 400 });
    const out = decideCheckOut(minutesIST(), st, shift);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
  }

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

  const now = new Date().toISOString();
  const fix = { lat, lng, accuracy_m: Math.round(acc * 10) / 10, distance_m: Math.round(dist * 10) / 10 };

  let punch: Punch;
  let message: string | undefined;
  if (b.action === 'in' && rule?.ok) {
    const { data, error } = await admin.from('attendance_punches').insert({
      employee_id: me.id, day, in_at: now, in_lat: fix.lat, in_lng: fix.lng, in_accuracy_m: fix.accuracy_m, in_distance_m: fix.distance_m, created_by: profile.id,
      in_status: rule.status,
    }).select('*').single();
    if (error || !data) {
      if (error?.code === '23505') return NextResponse.json({ error: 'You have already checked in today.' }, { status: 409 });
      return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    }
    punch = data as Punch;
    message = rule.message;
    const w = windows(st, shift);
    if (w?.checkoutBy != null) message = `${message ? `${message} ` : ''}Remember to check out by ${fmtTime(w.checkoutBy)}.`;
    await markDay(me.id, me.doj, Number(me.monthly_salary), day, rule.code);
  } else {
    const { data, error } = await admin.from('attendance_punches').update({
      out_at: now, out_lat: fix.lat, out_lng: fix.lng, out_accuracy_m: fix.accuracy_m, out_distance_m: fix.distance_m,
    }).eq('id', existing!.id).select('*').single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    punch = data as Punch;
  }
  return NextResponse.json({ ok: true, punch, message });
}
