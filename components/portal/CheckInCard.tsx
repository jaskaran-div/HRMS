'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../AppContext';
import { Icon } from '../Icon';
import { METHOD_LABEL } from '@/lib/checkin';
import type { Punch } from '@/lib/types';

interface Gate { allowed: boolean; note: string | null }
interface Today {
  day: string;
  punch: Punch | null;
  place: {
    location: boolean; wifi: boolean; anywhere: boolean; on_office_network: boolean; network_name: string | null;
    needs_location: boolean; office: { lat: number; lng: number; radius_m: number } | null;
  };
  shift: { name: string; start: string; end: string } | null;
  check_in: Gate;
  check_out: Gate;
  times: { check_in_by: string; check_out_by: string | null } | null;
}

const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';

/** A fresh, precise location from the browser (laptops use Wi-Fi positioning: often less precise than a phone). */
function readLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot read your location.')); return; }
    navigator.geolocation.getCurrentPosition(resolve, e => reject(new Error(
      e.code === e.PERMISSION_DENIED ? 'Location is blocked for this site. Allow it in the browser (the icon in the address bar) and try again.'
        : e.code === e.TIMEOUT ? 'Reading your location took too long. Try again.' : e.message || 'Could not read your location.',
    )), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

/** Today's check-in / check-out from the web portal: office Wi-Fi or office location, as HR set it up. */
export function CheckInCard() {
  const { notify } = useApp();
  const router = useRouter();
  const [t, setT] = useState<Today | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'in' | 'out'>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/mobile/punch?only=today', { cache: 'no-store' }).catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !j?.today) { setErr(j?.error ?? 'Could not load today’s check-in.'); return; }
    setErr(null);
    setT(j.today as Today);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function punch(action: 'in' | 'out') {
    if (!t) return;
    setBusy(action);
    try {
      const send = async (withLocation: boolean) => {
        let body: Record<string, unknown> = { action };
        if (withLocation) {
          const p = await readLocation();
          body = { ...body, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp };
        }
        const res = await fetch('/api/mobile/punch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { res, j: await res.json().catch(() => ({})) as { error?: string; message?: string; needs_location?: boolean } };
      };
      let { res, j } = await send(t.place.needs_location);
      // the network changed since the page loaded (e.g. off the office Wi-Fi): try again with the location
      if (!res.ok && j.needs_location && t.place.location && !t.place.needs_location) ({ res, j } = await send(true));
      if (!res.ok) { notify(j.error ?? 'Could not save.', 'err'); await load(); return; }
      notify(j.message || (action === 'in' ? 'Checked in' : 'Checked out'));
      await load();
      router.refresh();
    } catch (e) {
      notify((e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  }

  if (err) return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><h3><Icon name="clock" size={17} /> Today&apos;s check-in</h3><span className="sp" /><button className="btn sm" onClick={load}>Retry</button></div>
      <p className="muted small" style={{ margin: 0 }}>{err}</p>
    </div>
  );
  if (!t) return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h"><h3><Icon name="clock" size={17} /> Today&apos;s check-in</h3></div>
      <p className="muted small" style={{ margin: 0 }}>Loading…</p>
    </div>
  );

  const p = t.punch;
  const pl = t.place;
  const where = pl.anywhere ? 'You can check in from anywhere.'
    : pl.on_office_network ? `You are on the office Wi-Fi${pl.network_name ? ` (${pl.network_name})` : ''}.`
      : pl.location && pl.wifi ? `Connect to the office Wi-Fi, or be within ${pl.office?.radius_m} m of the office (your browser will ask for your location).`
        : pl.location ? `You must be within ${pl.office?.radius_m} m of the office. Your browser will ask for your location.`
          : pl.wifi ? 'You are not on the office Wi-Fi.' : null;
  const gate = !p ? t.check_in : t.check_out;
  const done = !!p?.out_at || !!p?.out_missed;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3><Icon name="clock" size={17} /> Today&apos;s check-in</h3>
        <span className="sp" />
        {t.times && <span className="muted small">Check in by {t.times.check_in_by}{t.times.check_out_by ? ` · check out by ${t.times.check_out_by}` : ''}{t.shift ? ` · ${t.shift.name}` : ''}</span>}
      </div>
      <div className="row" style={{ marginBottom: 0, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          {p ? (
            <div>
              <b>In {time(p.in_at)}</b>
              {p.in_method && <span className="muted small"> · {METHOD_LABEL[p.in_method]}{p.in_network ? ` (${p.in_network})` : ''}</span>}
              {p.in_status === 'late' && <span className="pill warn" style={{ marginLeft: 8 }}>Late</span>}
              {p.in_status === 'half_day' && <span className="pill bad" style={{ marginLeft: 8 }}>Half day</span>}
              <span style={{ margin: '0 10px' }} className="muted">→</span>
              {p.out_at ? <b>Out {time(p.out_at)}</b> : p.out_missed ? <span className="pill bad">Missed check-out · Half day</span> : <span className="muted">Not checked out</span>}
            </div>
          ) : <b>Not checked in yet</b>}
          {!done && (gate.note || where) && <div className="muted small" style={{ marginTop: 4 }}>{gate.note ?? where}</div>}
          {!done && gate.note && gate.allowed && where && <div className="muted small">{where}</div>}
        </div>
        {!done && (
          <button className="btn primary" disabled={!gate.allowed || !!busy} onClick={() => punch(p ? 'out' : 'in')}>
            <Icon name={p ? 'logout' : 'check'} size={16} />
            {busy === 'in' ? 'Checking in…' : busy === 'out' ? 'Checking out…' : p ? 'Check out' : 'Check in'}
          </button>
        )}
      </div>
    </div>
  );
}
