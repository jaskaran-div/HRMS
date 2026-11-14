import Link from 'next/link';
import { portalSession, myTeam } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentYM, fmtDate, monthLabel, todayISO } from '@/lib/dates';
import { initials, inr } from '@/lib/format';
import { leaveLabel, quotaFor, stageText, STATUS_PILL } from '@/lib/leave';
import { Icon } from '@/components/Icon';
import { MaskedAmount } from '@/components/MaskedAmount';
import { AttendanceStrip, StripLegend, markOf, type StripMark } from '@/components/AttendanceStrip';
import type { Attendance, LeaveRequest } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PortalHome() {
  const s = await portalSession();
  const me = s.me!;
  const admin = supabaseAdmin();
  const month = `${currentYM()}-01`;
  const today = todayISO();
  const [{ data: leaves }, { data: slip }, { data: att }, team] = await Promise.all([
    admin.from('leave_requests').select('*').eq('employee_id', me.id).order('start_date', { ascending: false }).limit(50),
    admin.from('payslips').select('month, net_pay, pay_date').eq('employee_id', me.id).order('month', { ascending: false }).limit(1).maybeSingle(),
    admin.from('attendance').select('month, daily, present_days, absent_days, half_days, leave_days, short_leave_days')
      .eq('employee_id', me.id).order('month', { ascending: false }).limit(1).maybeSingle(),
    myTeam(s),
  ]);
  const ls = (leaves ?? []) as LeaveRequest[];
  const a = att as (Pick<Attendance, 'month' | 'daily' | 'present_days' | 'absent_days' | 'half_days' | 'leave_days' | 'short_leave_days'>) | null;
  const q = quotaFor(ls, month, s.settings, undefined, a ? [a] : []);

  // attendance circles: what HR marked, plus approved leave on days not marked yet
  const stripMonth = a?.month ?? month;
  const marks: Record<number, StripMark> = {};
  const titles: Record<number, string> = {};
  for (const [d, c] of Object.entries(a?.daily ?? {})) { marks[+d] = markOf(c); titles[+d] = c; }
  for (const l of ls) {
    if (l.status !== 'approved') continue;
    for (let d = 1; d <= 31; d++) {
      const iso = `${stripMonth.slice(0, 8)}${String(d).padStart(2, '0')}`;
      if (iso >= l.start_date && iso <= l.end_date && !marks[d]) { marks[d] = l.leave_type === 'short' ? 's' : l.leave_type === 'paid' ? 'l' : 'a'; titles[d] = `Approved ${leaveLabel(l.leave_type).toLowerCase()}`; }
    }
  }

  let pendingTeam = 0;
  if (team.length) {
    const { count } = await admin.from('leave_requests').select('id', { count: 'exact', head: true })
      .in('employee_id', team.map(t => t.id)).eq('status', 'pending').eq('tl_status', 'pending');
    pendingTeam = count ?? 0;
  }

  return (
    <>
      <div className="page-h">
        <div className="pagehead" style={{ margin: 0 }}>
          <h1>Hi, {me.name.split(' ')[0]}</h1>
          <p>Your attendance, leave and payslips at {s.settings.company_name}.</p>
        </div>
        <span className="sp" />
        <Link href="/portal/leave" className="btn primary"><Icon name="plus" size={16} /> Apply for leave</Link>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-h"><h3><span className="dot" /> Employee details</h3><span className="sp" />
            <Link href="/portal/payslips" className="btn sm"><Icon name="download" size={14} /> Payslips</Link></div>
          <div className="profile-card">
            <div className="big-av">{initials(me.name)}<span className="tag">{me.emp_code}</span></div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2>{me.name}</h2>
              <div className="facts">
                <div><small>Role</small><span>{me.designation || '—'}</span></div>
                <div><small>Email address</small><span>{me.email || '—'}</span></div>
                <div><small>Phone number</small><span>{me.phone || '—'}</span></div>
              </div>
              <div className="facts" style={{ marginTop: 14 }}>
                <div><small>Department</small><span>{me.department || '—'}</span></div>
                <div><small>Team leader</small><span>{s.lead?.name ?? me.manager ?? '—'}</span></div>
                <div><small>Joined</small><span>{fmtDate(me.doj) || '—'}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="tiles">
          <div className="tile"><small>Present days</small><b>{a ? Number(a.present_days) : '–'}<em>{a ? monthLabel(a.month, false) : ''}</em></b></div>
          <div className="tile"><small>Latest net pay</small><b style={{ fontSize: 22 }}>{slip ? <MaskedAmount value={inr(slip.net_pay)} label="net pay" /> : '–'}</b><div className="sub">{slip ? monthLabel(slip.month) : 'Not published yet'}</div></div>
          <div className="tile"><small>Short leave left</small><b>{q.shortLeft}<em>of {q.shortPerMonth}</em></b><div className="sub">{monthLabel(month)}</div></div>
          <div className="tile"><small>Paid leave left</small><b>{q.paidLeft}<em>of {q.paidPerMonth}</em></b><div className="sub">{monthLabel(month)}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h3>Attendance · {monthLabel(stripMonth)}</h3><span className="sp" /><StripLegend /></div>
        <AttendanceStrip month={stripMonth} marks={marks} titles={titles} today={today} />
        {!a && <p className="muted small" style={{ margin: '6px 0 0' }}>HR has not marked attendance for you yet. Approved leave is shown already.</p>}
      </div>

      <div className="two">
        <div className="card">
          <div className="card-h"><h3>Recent leave</h3><span className="sp" /><Link href="/portal/leave" className="btn sm">History</Link></div>
          {ls.slice(0, 5).map(l => (
            <div key={l.id} className="who-c" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)' }}>
              <span className="av"><Icon name={l.leave_type === 'short' ? 'clock' : 'plane'} size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}><b>{leaveLabel(l.leave_type)}</b>
                <div className="muted small">{l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`}</div></div>
              <span className={`pill ${STATUS_PILL[l.status]}`}>{stageText(l)}</span>
            </div>
          ))}
          {!ls.length && <p className="muted" style={{ margin: 0 }}>No leave applied yet.</p>}
        </div>
        {s.isLead ? (
          <div className="card">
            <div className="card-h"><h3>My team</h3><span className="sp" /><Link href="/portal/team" className="btn sm">Open</Link></div>
            <div className="tiles">
              <div className="tile"><small>People</small><b>{team.length}</b></div>
              <Link href="/portal/approvals" className="tile" style={{ color: 'inherit' }}><small>Waiting for you</small><b>{pendingTeam}</b><div className="sub">{pendingTeam ? 'Review now →' : 'All clear'}</div></Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <h3>Quick links</h3>
            <div className="row tight">
              <Link href="/portal/leave" className="btn"><Icon name="plane" size={15} /> Apply for leave</Link>
              <Link href="/portal/payslips" className="btn"><Icon name="receipt" size={15} /> Payslips</Link>
              <Link href="/portal/documents" className="btn"><Icon name="folder" size={15} /> Documents</Link>
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>Today is {fmtDate(today)}. Something wrong in your details? Ask HR to correct it.</p>
          </div>
        )}
      </div>
    </>
  );
}
