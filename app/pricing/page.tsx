import Link from 'next/link';
import type { Metadata } from 'next';
import { PricingCard, planAmount } from '@/components/PricingCard';
import { PublicFooter, PublicNav } from '@/components/PublicNav';
import { Icon } from '@/components/Icon';
import { planPrice } from '@/lib/stripe';
import { loginBrand } from '@/lib/brand';
import { ALL_FEATURES, FEATURE_DESCRIPTION, FEATURE_LABEL, PLAN, type Feature } from '@/lib/billing/catalog';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pricing' };

const ICON: Record<Feature, string> = {
  employees: 'users', attendance: 'clock', leave: 'calendar', mobile: 'download', notifications: 'bell',
  teams: 'network', payroll: 'wallet', documents: 'folder', email_center: 'mail',
};

const FAQ = [
  ['Is there a limit on employees?', 'No. Add as many employees, HR users and team leaders as you need — the price stays the same.'],
  ['When am I charged?', 'Right after you register, on Stripe’s secure page. Then once a month on the same date. Every payment and invoice is in Billing.'],
  ['Can I cancel?', 'Yes, any time from Billing. You keep full access until the end of the month you paid for, and nothing renews after that.'],
  ['Can I switch off features we don’t use?', 'Yes. Payslips, documents, the mobile app and the rest can each be switched off for your organization, and back on any time.'],
];

/** Public pricing page (before login): the one plan → registration → payment. */
export default async function PricingPage() {
  const [price, brand] = await Promise.all([planPrice().catch(() => undefined), loginBrand()]);
  const p = price ?? { amount: PLAN.amount, currency: PLAN.currency, interval: PLAN.interval };
  return (
    <div className="pub">
      <PublicNav page="pricing" />

      <section className="pr-hero">
        <div className="pr-hero-text">
          <span className="price-badge">Pricing</span>
          <h1>One simple plan for your whole organization</h1>
          <p>Attendance, leave, payslips, documents and the employee app — everything {brand.name} offers, for one flat monthly price. No per-employee fees.</p>
          <ul className="pr-trust">
            <li><Icon name="checkCircle" size={18} />Unlimited employees</li>
            <li><Icon name="checkCircle" size={18} />Cancel any time</li>
            <li><Icon name="lock" size={18} />Secure payments by Stripe</li>
          </ul>
          <p className="pr-login">Already have an account? <Link href="/login">Log in here <Icon name="chevronRight" size={14} /></Link></p>
        </div>
        <PricingCard price={price}>
          <Link className="btn primary" href="/register?plan=business">Get started — {planAmount(p)} / {p.interval}</Link>
          <Link className="btn" href="/contact-sales">Talk to sales</Link>
        </PricingCard>
      </section>

      <section className="pr-section">
        <h2>Everything is included</h2>
        <p className="pr-lead">Every feature comes with the plan. Switch off what you don’t need.</p>
        <div className="pr-features">
          {ALL_FEATURES.map(f => (
            <div key={f} className="pr-feature">
              <span className="pr-ic"><Icon name={ICON[f]} size={20} /></span>
              <b>{FEATURE_LABEL[f]}</b>
              <p>{FEATURE_DESCRIPTION[f]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pr-section">
        <h2>Up and running in three steps</h2>
        <div className="pr-steps">
          <div><i>1</i><b>Register</b><p>Your organization’s name, your name, email and a password.</p></div>
          <div><i>2</i><b>Pay securely</b><p>{planAmount(p)} a month on Stripe. You come straight back when it’s done.</p></div>
          <div><i>3</i><b>Verify & log in</b><p>Click the link in your email, log in and invite your HR team and employees.</p></div>
        </div>
      </section>

      <section className="pr-section">
        <h2>Questions</h2>
        <div className="pr-faq">
          {FAQ.map(([q, a]) => <div key={q}><b>{q}</b><p>{a}</p></div>)}
        </div>
      </section>

      <section className="pr-cta">
        <div>
          <h2>Ready to get started?</h2>
          <p>Set up your organization in a few minutes.</p>
        </div>
        <div className="pr-cta-actions">
          <Link className="btn" href="/login">Log in</Link>
          <Link className="btn primary" href="/register?plan=business">Get started</Link>
        </div>
      </section>

      <PublicFooter name={brand.name} />
    </div>
  );
}
