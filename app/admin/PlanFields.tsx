'use client';

import { ADDONS, ALL_FEATURES, BASE_FEATURES, FEATURE_LABEL, type Feature } from '@/lib/billing/catalog';

export type FeatureChoice = 'plan' | 'on' | 'off';
export interface Plan {
  billing: 'exempt' | 'stripe';
  features: Record<Feature, FeatureChoice>;
  max_employees: string;
  max_users: string;
}

export const planFrom = (o: { billing_exempt: boolean; entitlement_overrides?: { grant?: string[]; revoke?: string[] } | null; max_employees: number | null; max_users: number | null } | null): Plan => ({
  billing: !o || o.billing_exempt ? 'exempt' : 'stripe',
  features: Object.fromEntries(ALL_FEATURES.map(f => [f,
    o?.entitlement_overrides?.revoke?.includes(f) ? 'off' : o?.entitlement_overrides?.grant?.includes(f) ? 'on' : 'plan'])) as Record<Feature, FeatureChoice>,
  max_employees: o?.max_employees?.toString() ?? '',
  max_users: o?.max_users?.toString() ?? '',
});

/** What a feature is when left on "plan": exempt = everything; Stripe = base included, add-ons only if bought. */
function planDefault(f: Feature, billing: Plan['billing'], bought: string[]) {
  if (billing === 'exempt') return 'included (free / managed plan)';
  if (BASE_FEATURES.includes(f)) return 'included in the base plan';
  return bought.includes(f) ? 'bought as an add-on' : 'add-on, not bought';
}

export function PlanFields({ plan, onChange, bought = [], usage }: {
  plan: Plan; onChange: (p: Plan) => void; bought?: string[]; usage?: { employees: number; users: number };
}) {
  const set = (patch: Partial<Plan>) => onChange({ ...plan, ...patch });
  const setF = (f: Feature, v: FeatureChoice) => set({ features: { ...plan.features, [f]: v } });
  const meter = (used: number, max: string) => {
    const m = Number(max);
    if (!max || !m) return null;
    const pct = Math.min(100, Math.round((used / m) * 100));
    return <div className="meter" title={`${used} of ${m}`}><i className={used >= m ? 'full' : ''} style={{ width: `${pct}%` }} /></div>;
  };

  return (
    <>
      <div className="mgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <label>Billing
          <select value={plan.billing} onChange={e => set({ billing: e.target.value as Plan['billing'] })}>
            <option value="exempt">Free / managed — active without payment</option>
            <option value="stripe">Stripe — the owner pays in Billing</option>
          </select>
          <span className="hint">{plan.billing === 'exempt' ? 'Use for trials, partners or customers invoiced offline.' : 'Access follows the Stripe subscription (active only when paid).'}</span>
        </label>
        <label>Max employees
          <input type="number" min={0} value={plan.max_employees} onChange={e => set({ max_employees: e.target.value })} placeholder="Unlimited" />
          <span className="hint">Active (not archived) employee records.{usage ? ` In use: ${usage.employees}.` : ''}</span>
          {usage && meter(usage.employees, plan.max_employees)}
        </label>
        <label>Max logins
          <input type="number" min={0} value={plan.max_users} onChange={e => set({ max_users: e.target.value })} placeholder="Unlimited" />
          <span className="hint">Active logins incl. owner and HR.{usage ? ` In use: ${usage.users}.` : ''}</span>
          {usage && meter(usage.users, plan.max_users)}
        </label>
      </div>
      <h4 style={{ margin: '18px 0 4px' }}>Features</h4>
      <p className="muted small" style={{ marginTop: 0 }}><b>Plan</b> = follow the billing plan · <b>On</b> = always allowed (no payment needed) · <b>Off</b> = blocked even if paid.</p>
      {ALL_FEATURES.map(f => (
        <div key={f} className="feat-row">
          <div>
            <b>{FEATURE_LABEL[f]}</b>
            <div className="muted small">{ADDONS.find(a => a.feature === f)?.description ?? 'Core HRMS feature.'} — {planDefault(f, plan.billing, bought)}</div>
          </div>
          <div className="seg" role="radiogroup" aria-label={FEATURE_LABEL[f]}>
            {(['plan', 'on', 'off'] as FeatureChoice[]).map(v => (
              <button key={v} type="button" className={`${plan.features[f] === v ? 'on' : ''} ${v === 'on' ? 'g' : v === 'off' ? 'r' : ''}`} onClick={() => setF(f, v)}>
                {v === 'plan' ? 'Plan' : v === 'on' ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
