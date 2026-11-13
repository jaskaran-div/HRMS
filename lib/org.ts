// Organization status and entitlements. Pure functions: safe on the server and in the browser.
import { ALL_FEATURES, BASE_FEATURES, isFeature, type Feature } from './billing/catalog';

export type OrgStatus = 'pending_payment' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'expired' | 'paused' | 'suspended';

export interface Org {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  owner_user_id: string | null;
  owner_email: string | null;
  email_verified_at: string | null;
  onboarded_at: string | null;
  billing_exempt: boolean;
  suspended_reason: string | null;
  stripe_livemode: boolean | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_base_price_id: string | null;
  stripe_items: { id: string; price: string; quantity: number; feature: string | null }[];
  addons: string[];
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  last_payment_failed_at: string | null;
  last_payment_error: string | null;
  stripe_synced_at: string | null;
  entitlement_overrides: { grant?: string[]; revoke?: string[] };
  created_at: string;
}

/** What the browser / mobile app may know about its organization (no Stripe ids). */
export interface OrgSummary {
  id: string;
  name: string;
  status: OrgStatus;
  access: boolean;
  emailVerified: boolean;
  onboarded: boolean;
  features: Feature[];
  pastDue: boolean;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
}

export const STATUS_LABEL: Record<OrgStatus, string> = {
  pending_payment: 'Awaiting payment', active: 'Active', past_due: 'Payment overdue', unpaid: 'Unpaid',
  canceled: 'Cancelled', expired: 'Expired', paused: 'Paused', suspended: 'Suspended',
};

/** May the organization use the HRMS? Mirrors org_has_access() in supabase/saas.sql. */
export const orgHasAccess = (o: Pick<Org, 'status' | 'billing_exempt'>) =>
  o.status !== 'suspended' && (o.billing_exempt || o.status === 'active' || o.status === 'past_due');

/** Features the organization may use right now: base + purchased add-ons (+/- platform overrides). Exempt = all. */
export function orgFeatures(o: Pick<Org, 'status' | 'billing_exempt' | 'addons' | 'entitlement_overrides'>): Feature[] {
  if (!orgHasAccess(o)) return [];
  const set = new Set<Feature>(o.billing_exempt ? ALL_FEATURES : [...BASE_FEATURES, ...(o.addons ?? []).filter(isFeature)]);
  for (const g of o.entitlement_overrides?.grant ?? []) if (isFeature(g)) set.add(g);
  for (const r of o.entitlement_overrides?.revoke ?? []) if (isFeature(r)) set.delete(r);
  return ALL_FEATURES.filter(f => set.has(f));
}

export const summarize = (o: Org): OrgSummary => ({
  id: o.id, name: o.name, status: o.status, access: orgHasAccess(o), emailVerified: !!o.email_verified_at,
  onboarded: !!o.onboarded_at, features: orgFeatures(o), pastDue: o.status === 'past_due',
  cancelAtPeriodEnd: o.cancel_at_period_end, periodEnd: o.current_period_end,
});

/** Stripe subscription status → organization status. Only paid states grant access. */
export function statusFromStripe(s: string | null | undefined): OrgStatus {
  switch (s) {
    case 'active': case 'trialing': return 'active';
    case 'past_due': return 'past_due';           // renewal failed, Stripe is retrying: grace period
    case 'unpaid': return 'unpaid';               // retries exhausted
    case 'canceled': return 'canceled';
    case 'incomplete_expired': return 'expired';  // first payment never completed
    case 'paused': return 'paused';
    default: return 'pending_payment';            // incomplete (payment pending / needs action) or none
  }
}
