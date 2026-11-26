import { PLAN } from '@/lib/billing/catalog';
import { money } from '@/lib/money';
import { Icon } from './Icon';

export interface PlanPrice { amount: number; currency: string; interval: string }

/** "₹2,499" without paise when the amount is whole. */
export const planAmount = (p: PlanPrice) => money(p.amount, p.currency).replace(/\.00$/, '');

/** The one plan, as a pricing card. `children` = the call to action. */
export function PricingCard({ price, children, compact }: { price?: PlanPrice; children?: React.ReactNode; compact?: boolean }) {
  const p = price ?? { amount: PLAN.amount, currency: PLAN.currency, interval: PLAN.interval };
  return (
    <div className={`price-card${compact ? ' compact' : ''}`}>
      <div className="price-card-head">
        <span className="price-badge">One plan · everything included</span>
        <h2>{PLAN.name}</h2>
        <p className="muted">{PLAN.tagline}</p>
        <div className="price-big">{planAmount(p)}<small> / {p.interval}</small></div>
        <p className="muted small">Billed {p.interval === 'year' ? 'yearly' : 'monthly'} · cancel any time · taxes as applicable</p>
      </div>
      <ul className="price-list">
        {PLAN.highlights.map(h => <li key={h}><Icon name="check" size={16} />{h}</li>)}
      </ul>
      {children && <div className="price-cta">{children}</div>}
    </div>
  );
}
