// SERVER ONLY. A short-lived signed token handed out right after registration, so the new owner can pay
// straight away, before verifying their email and logging in. It only allows starting a Stripe Checkout for
// that one organization: it does not log anyone in and does not unlock anything (only payment does).
import { createHmac, timingSafeEqual } from 'node:crypto';

const key = () => {
  const s = process.env.CHECKOUT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('No secret for checkout tokens');
  return createHmac('sha256', s).update('checkout-token-v1').digest();
};
const sign = (body: string) => createHmac('sha256', key()).update(body).digest('base64url');

export function checkoutToken(orgId: string, hours = 24): string {
  const body = Buffer.from(`${orgId}.${Math.floor(Date.now() / 1000) + hours * 3600}`).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The organization id inside a valid, unexpired token, else null. */
export function readCheckoutToken(t: unknown): string | null {
  if (typeof t !== 'string' || t.length > 300) return null;
  const [body, sig] = t.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [orgId, exp] = Buffer.from(body, 'base64url').toString().split('.');
  if (!orgId || !/^[0-9a-f-]{36}$/.test(orgId) || !(Number(exp) > Date.now() / 1000)) return null;
  return orgId;
}
