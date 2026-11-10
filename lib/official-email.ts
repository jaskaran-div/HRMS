/**
 * The employee's OFFICIAL email — the address all HRMS mail goes to.
 * Employee sheets often have both a personal "Email Address" and an "Official Mail Id" column; the official one is
 * kept in `extra` under whatever header the sheet used. Order: an extra field named like "official / work / company mail",
 * else the main email field. (The server additionally refuses addresses outside the company domain.)
 */
const OFFICIAL_KEY = /(official|office|work|company|corporate|business).*(mail)|(mail).*(official|office|work|company|corporate)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type HasEmail = { email?: string | null; extra?: Record<string, string> | null };

export function officialEmailOf(e: HasEmail | null | undefined): string | null {
  if (!e) return null;
  for (const [k, v] of Object.entries(e.extra ?? {})) {
    const x = String(v ?? '').trim();
    if (OFFICIAL_KEY.test(k) && EMAIL.test(x)) return x;
  }
  const m = (e.email ?? '').trim();
  return EMAIL.test(m) ? m : null;
}
