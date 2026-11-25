// Where an employee may check in from (web portal and mobile app). Pure functions: used by the server and the settings page.
import { distanceM, MAX_GPS_ACCURACY_M } from './geo';
import type { OfficeNetwork, Settings } from './types';

export type CheckInMethod = 'gps' | 'wifi' | 'anywhere';
export type CheckInSource = 'app' | 'web';

type PlaceRules = Pick<Settings, 'office_lat' | 'office_lng' | 'office_radius_m'>
  & Partial<Pick<Settings, 'checkin_gps' | 'checkin_wifi' | 'office_networks'>>;

/** The check-in methods turned on under Company & Rules (location is on unless turned off: how it worked before). */
export function placeRules(st: PlaceRules) {
  const networks = (Array.isArray(st.office_networks) ? st.office_networks : []).filter(n => n && typeof n.ip === 'string' && n.ip.trim());
  const gpsOn = st.checkin_gps !== false;
  const office = st.office_lat != null && st.office_lng != null ? { lat: st.office_lat, lng: st.office_lng, radius: st.office_radius_m ?? 100 } : null;
  return {
    /** location check-in is on and the office location is set */
    gps: gpsOn && office ? office : null,
    gpsOn,
    wifi: st.checkin_wifi === true,
    networks,
    /** office Wi-Fi is on with no network saved: check in from anywhere */
    anywhere: st.checkin_wifi === true && networks.length === 0,
  };
}

/** Why nobody can check in at all, or null when at least one method works. */
export function placeUnavailable(st: PlaceRules): string | null {
  const p = placeRules(st);
  if (p.gps || p.wifi) return null;
  if (p.gpsOn) return 'HR has not set the office location yet.';
  return 'Check-in is turned off. Ask HR.';
}

// ---------- IP addresses ----------

/** '::ffff:1.2.3.4' → '1.2.3.4', lower-case IPv6, no brackets / zone. */
export function normIp(ip: string | null | undefined): string {
  let v = (ip ?? '').trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, '').replace(/%.*$/, '');
  if (v.startsWith('::ffff:') && v.includes('.')) v = v.slice(7);
  // '1.2.3.4:5678' (some proxies keep the port)
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) v = v.split(':')[0];
  return v;
}

function v4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some(x => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

/** Expands an IPv6 address to 8 groups (null if not IPv6). */
function v6(ip: string): number[] | null {
  if (!ip.includes(':') || !/^[0-9a-f:.]+$/.test(ip)) return null;
  let s = ip;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4(tail[1]);
    if (n == null) return null;
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const a = halves[0] ? halves[0].split(':') : [], b = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0;
  if (fill < 0 || (halves.length === 1 && a.length !== 8)) return null;
  const all = [...a, ...Array(fill).fill('0'), ...b];
  if (all.length !== 8 || all.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map(g => parseInt(g, 16));
}

/** A valid entry for an office network: an IP address, or a range like 203.0.113.0/28 or 2001:db8::/48. */
export function validNetworkIp(entry: string): boolean {
  const [ip, bits, extra] = normIp(entry).split('/');
  if (extra !== undefined) return false;
  const isV4 = v4(ip) != null, isV6 = !isV4 && v6(ip) != null;
  if (!isV4 && !isV6) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (isV4 ? 32 : 128);
}

/** Does the caller's IP fall in the entry (an exact address or a /range)? */
export function ipMatches(ip: string, entry: string): boolean {
  const a = normIp(ip);
  const [net, bitsRaw] = normIp(entry).split('/');
  const a4 = v4(a), n4 = v4(net);
  if (a4 != null && n4 != null) {
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((a4 & mask) >>> 0) === ((n4 & mask) >>> 0);
  }
  const a6 = v6(a), n6 = v6(net);
  if (a6 && n6) {
    const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
    if (!(bits >= 0 && bits <= 128)) return false;
    for (let i = 0; i < 8; i++) {
      const take = Math.max(0, Math.min(16, bits - i * 16));
      if (!take) break;
      const mask = (0xffff << (16 - take)) & 0xffff;
      if ((a6[i] & mask) !== (n6[i] & mask)) return false;
    }
    return true;
  }
  return false;
}

/** The saved office network the IP belongs to, or null. */
export function officeNetworkOf(ip: string | null, networks: OfficeNetwork[]): OfficeNetwork | null {
  if (!ip) return null;
  return networks.find(n => ipMatches(ip, n.ip)) ?? null;
}

// ---------- the decision ----------

export interface Fix { lat?: number; lng?: number; accuracy?: number; mocked?: boolean; timestamp?: number }

export type PlaceDecision =
  | { ok: true; method: CheckInMethod; network: string | null; fix: { lat: number; lng: number; accuracy_m: number; distance_m: number | null } | null }
  | { ok: false; error: string; distance_m?: number; needs_location?: boolean };

/** A GPS fix good enough to record (no rule checked), or null. */
function readFix(f: Fix, office: { lat: number; lng: number } | null) {
  const lat = Number(f.lat), lng = Number(f.lng), acc = Number(f.accuracy);
  if (f.lat == null || f.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat, lng, accuracy_m: Number.isFinite(acc) ? Math.round(acc * 10) / 10 : 0,
    distance_m: office ? Math.round(distanceM(lat, lng, office.lat, office.lng) * 10) / 10 : null,
  };
}

/**
 * May this check-in / check-out happen from here? Office Wi-Fi first (no GPS needed), then the office location.
 * `ip` is the caller's public IP as the server sees it; `f` is the GPS fix the device sent (may be empty).
 */
export function decidePlace(st: PlaceRules, ip: string | null, f: Fix, action: 'in' | 'out', now = Date.now()): PlaceDecision {
  const p = placeRules(st);
  const off = placeUnavailable(st);
  if (off) return { ok: false, error: off };

  if (p.wifi) {
    const net = p.anywhere ? null : officeNetworkOf(ip, p.networks);
    if (p.anywhere || net) return { ok: true, method: p.anywhere ? 'anywhere' : 'wifi', network: net?.name || null, fix: readFix(f, p.gps) };
  }
  const wifiHint = p.wifi ? ' or connect to the office Wi-Fi' : '';
  if (!p.gps) return { ok: false, error: `You are not connected to the office Wi-Fi. Connect to it to check ${action}.` };

  const lat = Number(f.lat), lng = Number(f.lng), acc = Number(f.accuracy);
  if (f.lat == null || f.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return { ok: false, needs_location: true, error: `Could not read your location. Turn on location${wifiHint} and try again.` };
  if (f.mocked) return { ok: false, error: `A fake-location app is active on this phone. Turn it off${wifiHint} to check ${action}.` };
  if (f.timestamp && Math.abs(now - Number(f.timestamp)) > 2 * 60 * 1000)
    return { ok: false, error: 'Your location is out of date. Try again.' };
  if (!Number.isFinite(acc) || acc > MAX_GPS_ACCURACY_M)
    return { ok: false, error: `Your location is not precise enough yet (±${Number.isFinite(acc) ? Math.round(acc) : '?'} m). Wait a few seconds, or step near a window, and try again${p.wifi ? ', or connect to the office Wi-Fi' : ''}.` };
  const dist = distanceM(lat, lng, p.gps.lat, p.gps.lng);
  if (dist > p.gps.radius)
    return { ok: false, distance_m: Math.round(dist), error: `You are ${Math.round(dist)} m from the office. You can check ${action} only within ${p.gps.radius} m${wifiHint}.` };
  return { ok: true, method: 'gps', network: null, fix: { lat, lng, accuracy_m: Math.round(acc * 10) / 10, distance_m: Math.round(dist * 10) / 10 } };
}

export const METHOD_LABEL: Record<CheckInMethod, string> = { gps: 'Office location', wifi: 'Office Wi-Fi', anywhere: 'Anywhere' };
