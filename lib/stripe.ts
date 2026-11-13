// SERVER ONLY. Stripe client and configuration. The secret key, webhook secret and price ids come from the
// server environment only; nothing here may be imported by a client component or the mobile app.
import Stripe from 'stripe';
import { ADDONS, type Feature } from './billing/catalog';

let client: Stripe | null = null;

export type StripeMode = 'test' | 'live';

/** test / live, from the secret key prefix (sk_test_ / rk_test_ vs sk_live_ / rk_live_). */
export function keyMode(key = process.env.STRIPE_SECRET_KEY ?? ''): StripeMode | null {
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  return null;
}

/**
 * Problems with the Stripe configuration, or [] when billing can run.
 * Test and live are kept apart: STRIPE_MODE (optional) must match the keys, the publishable key must be
 * the same mode as the secret key, and a production server refuses test keys unless STRIPE_MODE=test.
 */
export function stripeConfigProblems(): string[] {
  const p: string[] = [];
  const sk = process.env.STRIPE_SECRET_KEY ?? '';
  const pk = process.env.STRIPE_PUBLISHABLE_KEY ?? '';
  const mode = keyMode(sk);
  if (!sk) p.push('STRIPE_SECRET_KEY is not set');
  else if (!mode) p.push('STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_ or rk_live_');
  if (!process.env.STRIPE_WEBHOOK_SECRET) p.push('STRIPE_WEBHOOK_SECRET is not set');
  if (!process.env.STRIPE_BASE_PRICE_ID) p.push('STRIPE_BASE_PRICE_ID is not set');
  if (pk && mode && !pk.startsWith(`pk_${mode}_`)) p.push(`STRIPE_PUBLISHABLE_KEY is not a ${mode} key, but STRIPE_SECRET_KEY is`);
  const want = process.env.STRIPE_MODE;
  if (want && want !== 'test' && want !== 'live') p.push('STRIPE_MODE must be "test" or "live"');
  if (want && mode && want !== mode) p.push(`STRIPE_MODE is "${want}" but the keys are ${mode} keys`);
  if (process.env.NODE_ENV === 'production' && mode === 'test' && want !== 'test')
    p.push('Test Stripe keys on a production server: set STRIPE_MODE=test to allow this deliberately');
  return p;
}

export const stripeConfigured = () => stripeConfigProblems().length === 0;
export const liveMode = () => keyMode() === 'live';

export function stripe(): Stripe {
  const problems = stripeConfigProblems();
  if (problems.length) throw new Error(`Stripe is not configured: ${problems.join('; ')}`);
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-02-24.acacia',
    appInfo: { name: 'HRMS' },
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  return client;
}

export const basePriceId = () => process.env.STRIPE_BASE_PRICE_ID ?? '';

/** Add-ons whose price id is configured: feature → price id. */
export function addonPrices(): Map<Feature, string> {
  const m = new Map<Feature, string>();
  for (const a of ADDONS) {
    const id = (process.env[a.priceEnv] ?? '').trim();
    if (id) m.set(a.feature, id);
  }
  return m;
}

/** Which add-on feature a Stripe price unlocks (null = the base plan or unknown). */
export function featureOfPrice(priceId: string): Feature | null {
  for (const [f, id] of addonPrices()) if (id === priceId) return f;
  return null;
}

export interface PriceInfo { id: string; amount: number | null; currency: string; interval: string | null; product: string }
let priceCache: { at: number; map: Map<string, PriceInfo> } | null = null;

/** Display prices (amounts come from Stripe, never hardcoded). Cached for 10 minutes. */
export async function priceInfo(ids: string[]): Promise<Map<string, PriceInfo>> {
  if (priceCache && Date.now() - priceCache.at < 600_000 && ids.every(id => priceCache!.map.has(id))) return priceCache.map;
  const map = new Map<string, PriceInfo>(priceCache?.map ?? []);
  await Promise.all(ids.map(async id => {
    try {
      const p = await stripe().prices.retrieve(id, { expand: ['product'] });
      map.set(id, {
        id, amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval ?? null,
        product: typeof p.product === 'object' && p.product && 'name' in p.product ? p.product.name : '',
      });
    } catch { /* shown as "price unavailable" */ }
  }));
  priceCache = { at: Date.now(), map };
  return map;
}
