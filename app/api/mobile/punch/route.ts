import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { mobileSession, ymParam } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { trustedClientIp } from '@/lib/auth';
import { todayIST } from '@/lib/geo';
import { decidePlace, officeNetworkOf, placeRules, placeUnavailable, type CheckInSource } from '@/lib/checkin';
import { daysInMonth } from '@/lib/dates';
import { downgradeToHalf, markDay } from '@/lib/attendance-mark';
import { decideCheckIn, decideCheckOut, fmtTime, minutesIST, windows, type CheckInDecision, type DayLeave, type ShiftTimes } from '@/lib/late';
import type { Employee, Punch, Settings, Shift } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The mobile app sends `Authorization: Bearer …`; the web portal uses the login cookie. */
async function sourceOf(): Promise<CheckInSource> {
  return /^Bearer\s+\S+/i.test((await headers()).get('authorization') ?? '') ? 'app' : 'web';
}

/** Where the caller can check in from right now: which methods are on and whether they are on the office network. */
function placeState(st: Settings, ip: string | null) {
  const p = placeRules(st);
  const net = p.wifi && !p.anywhere ? officeNetworkOf(ip, p.networks) : null;
  const onNetwork = p.anywhere || !!net;
  return {
    location: !!p.gps,
    wifi: p.wifi,
    /** office Wi-Fi is on with no network saved */
    anywhere: p.anywhere,
    /** on a saved office network (or anywhere): no location needed */
    on_office_network: onNetwork,
    network_name: net?.name || null,
    /** the device must send a GPS fix with the request */
    needs_location: !onNetwork && !!p.gps,
    office: p.gps ? { lat: p.gps.lat, lng: p.gps.lng, radius_m: p.gps.radius } : null,
  };
}

/** The employee's shift with its own timing rules, or null (= the company office timing). */
async function shiftOf(me: Pick<Employee, 'shift_id'>): Promise<Shift | null> {
  if (!me.shift_id) return null;
  const { data } = await supabaseAdmin().from('shifts').select('*').eq('id', me.shift_id).maybeSingle();
  return (data as Shift | null) ?? null;
}

type TodayLeave = { leave_type: string; short_session: string | null; status: string };

/**
 * The employee's short leaves / half days today (approved or pending). Read once per request, together with today's
 * punch: both the check-in rule and the early check-out rule are decided from it.
 */
async function todayLeaves(employeeId: string, day: string): Promise<TodayLeave[]> {
  const { data } = await supabaseAdmin().from('leave_requests').select('leave_type, short_session, status').eq('employee_id', employeeId)
    .in('leave_type', ['short', 'half']).eq('start_date', day).in('status', ['approved', 'pending']);
  return (data ?? []) as TodayLeave[];
}

/** An evening short leave / half day today (approved or pending): leaving early is then expected, not a half day. */
const leavesEarly = (leaves: TodayLeave[]) => leaves.some(l => l.short_session === 'evening');

/** Late check-ins earlier this month (the monthly late allowance). */
async function lateCount(employeeId: string, day: string): Promise<number> {
  const { count } = await supabaseAdmin().from('attendance_punches').select('id', { count: 'exact', head: true }).eq('employee_id', employeeId)
    .eq('in_status', 'late').gte('day', `${day.slice(0, 7)}-01`).lt('day', day);
  return count ?? 0;
}

/**
 * Applies the office-timing rules (Company & Rules → Office timing: the employee's shift tab, else "No shift") to a check-in
 * happening now: the late allowance, the morning / second-half check-in windows, and the employee's morning or evening
 * short leave / half day that day (approved, or still pending).
 */
function checkInRule(st: Settings, shift: ShiftTimes, leaves: TodayLeave[], late: number): CheckInDecision {
  // a half day outweighs a short leave; an approved one outweighs a pending one
  const l = [...leaves].sort((a, b) => (a.leave_type === 'half' ? -1 : 1) - (b.leave_type === 'half' ? -1 : 1)
    || (a.status === 'approved' ? -1 : 1) - (b.status === 'approved' ? -1 : 1))[0];
  const leave: DayLeave | null = l ? { type: l.leave_type as DayLeave['type'], session: (l.short_session ?? null) as DayLeave['session'], approved: l.status === 'approved' } : null;
  return decideCheckIn(minutesIST(), st, late, leave, shift);
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
  const sp = new URL(req.url).searchParams;
  const ym = ymParam(sp.get('month')) ?? day.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const admin = supabaseAdmin();
  const [{ data, error }, { data: mine }, shift, leaves] = await Promise.all([
    // ?only=today (the web portal's check-in card, the app's 30 s refresh): no month list
    sp.get('only') === 'today' ? Promise.resolve({ data: [], error: null }) : admin.from('attendance_punches').select('*').eq('employee_id', me.id)
      .gte('day', `${ym}-01`).lte('day', `${ym}-${String(daysInMonth(y, m)).padStart(2, '0')}`).order('day', { ascending: false }),
    admin.from('attendance_punches').select('*').eq('employee_id', me.id).eq('day', day).maybeSingle(),
    shiftOf(me),
    todayLeaves(me.id, day),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const p = mine as Punch | null;
  const w = windows(st, shift);
  const place = placeState(st, await trustedClientIp());
  const off = placeUnavailable(st);
  // office Wi-Fi is the only method and this device is not on it: nothing to try until it connects
  const notHere = !off && !place.on_office_network && !place.location;
  let inState: { allowed: boolean; note: string | null };
  if (p) inState = { allowed: false, note: `Checked in at ${new Date(p.in_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.` };
  else if (off) inState = { allowed: false, note: off };
  else if (notHere) inState = { allowed: false, note: 'Connect to the office Wi-Fi to check in.' };
  else {
    const d = checkInRule(st, shift, leaves, await lateCount(me.id, day));
    inState = d.ok
      ? { allowed: true, note: d.status === 'half_day' || d.code === 'H' ? 'Checking in now counts as a half day.' : d.status === 'late' ? 'Checking in now counts as a late check-in.' : null }
      : { allowed: false, note: d.error };
  }
  let outState: { allowed: boolean; note: string | null };
  if (!p) outState = { allowed: false, note: 'Check in first.' };
  else if (p.out_missed) outState = { allowed: false, note: 'You did not check out in time, so today counts as a half day.' };
  else if (off) outState = { allowed: false, note: off };
  else if (notHere) outState = { allowed: false, note: 'Connect to the office Wi-Fi to check out.' };
  else {
    const d = decideCheckOut(minutesIST(), st, shift);
    outState = !d.ok ? { allowed: false, note: d.error }
      : d.half && !leavesEarly(leaves)
        ? { allowed: true, note: `Checking out before ${fmtTime(d.earlyOut)} counts as a half day.` }
        : { allowed: true, note: w?.checkoutBy != null ? `Check out by ${fmtTime(w.checkoutBy)}, or today counts as a half day.` : null };
  }
  return NextResponse.json({
    punches: (data ?? []) as Punch[],
    today: {
      day,
      punch: p,
      place,
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
 * Body: { action: 'in' | 'out', lat?, lng?, accuracy?, mocked?, timestamp? }
 * Allowed from the office Wi-Fi (the request's public IP is a saved office network: no GPS needed), or with a fresh
 * GPS fix within the office radius — whichever HR turned on (Company & Rules → Check-in). Web portal and app alike.
 */
export async function POST(req: Request) {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  const { me, settings: st, profile } = r.s;
  const b = (await req.json().catch(() => ({}))) as { action?: string; lat?: number; lng?: number; accuracy?: number; mocked?: boolean; timestamp?: number };

  if (b.action !== 'in' && b.action !== 'out') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const off = placeUnavailable(st);
  if (off) return NextResponse.json({ error: `${off} HR can set it under Company & Rules → Check-in.` }, { status: 400 });

  // time rules first: no point asking for a GPS fix when the window is closed anyway
  const admin = supabaseAdmin();
  const day = todayIST();
  // everything the rules need, in one round trip (the late count only matters for a check-in)
  const [{ data: existing }, shift, leaves, late] = await Promise.all([
    admin.from('attendance_punches').select('*').eq('employee_id', me.id).eq('day', day).maybeSingle(),
    shiftOf(me),
    todayLeaves(me.id, day),
    b.action === 'in' ? lateCount(me.id, day) : Promise.resolve(0),
  ]);
  let rule: CheckInDecision | null = null;
  let earlyHalf: string | null = null; // checking out before the early check-out time: the day becomes a Half day
  if (b.action === 'in') {
    if (existing) return NextResponse.json({ error: 'You have already checked in today.', punch: existing }, { status: 409 });
    rule = checkInRule(st, shift, leaves, late);
    if (!rule.ok) return NextResponse.json({ error: rule.error }, { status: 400 });
  } else {
    if (!existing) return NextResponse.json({ error: 'Check in first.' }, { status: 400 });
    if ((existing as Punch).out_missed) return NextResponse.json({ error: 'You did not check out in time, so today counts as a half day.' }, { status: 400 });
    const out = decideCheckOut(minutesIST(), st, shift);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    if (out.half && !leavesEarly(leaves)) earlyHalf = fmtTime(out.earlyOut);
  }

  const [ip, source] = await Promise.all([trustedClientIp(), sourceOf()]);
  const place = decidePlace(st, ip, b, b.action);
  if (!place.ok)
    return NextResponse.json({ error: place.error, distance_m: place.distance_m, needs_location: place.needs_location }, { status: 400 });

  const now = new Date().toISOString();
  const fix = place.fix;

  let punch: Punch;
  let message: string | undefined;
  if (b.action === 'in' && rule?.ok) {
    const { data, error } = await admin.from('attendance_punches').insert({
      employee_id: me.id, day, in_at: now, in_lat: fix?.lat ?? null, in_lng: fix?.lng ?? null, in_accuracy_m: fix?.accuracy_m ?? null,
      in_distance_m: fix?.distance_m ?? null, created_by: profile.id, in_status: rule.status,
      in_method: place.method, in_source: source, in_network: place.network, in_ip: ip,
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
      out_at: now, out_lat: fix?.lat ?? null, out_lng: fix?.lng ?? null, out_accuracy_m: fix?.accuracy_m ?? null, out_distance_m: fix?.distance_m ?? null,
      out_method: place.method, out_source: source, out_ip: ip,
    }).eq('id', existing!.id).select('*').single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 500 });
    punch = data as Punch;
    if (earlyHalf) {
      await downgradeToHalf(me.id, me.doj, Number(me.monthly_salary), day);
      message = `Checked out before ${earlyHalf}: today is marked as a half day.`;
    }
  }
  return NextResponse.json({ ok: true, punch, message });
}
