import Link from 'next/link';
import type { Metadata } from 'next';
import { PricingCard } from '@/components/PricingCard';
import { planPrice } from '@/lib/stripe';
import { loginBrand } from '@/lib/brand';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pricing' };

/** Public pricing page (before login): the one plan, with "Get started" → registration → payment. */
export default async function PricingPage() {
  const [price, brand] = await Promise.all([planPrice().catch(() => undefined), loginBrand()]);
  return (
    <div className="pricing-wrap">
      <div className="pricing-hero">
        <div className="pricing-brand">{brand.logo && <img src={brand.logo} alt="" />}{brand.name}</div>
        <h1>Simple pricing. Everything included.</h1>
        <p>One plan for your whole organization: unlimited employees, every HR feature, the mobile app. Turn off what you don’t need.</p>
      </div>
      <PricingCard price={price}>
        <Link className="btn primary" href="/register?plan=business">Get started</Link>
        <span className="muted small" style={{ textAlign: 'center' }}>Already registered? <Link href="/login">Log in</Link></span>
      </PricingCard>
      <div className="pricing-faq">
        <div><b>How does it start?</b>Register your organization, pay securely with Stripe, verify your email and log in. Then invite your HR team and employees.</div>
        <div><b>Can I cancel?</b>Yes, any time from Billing. You keep access until the end of the month you paid for; nothing renews after that.</div>
        <div><b>Is there a limit on employees?</b>No. Add as many employees and logins as you need at the same price.</div>
        <div><b>Bigger rollout or invoicing?</b><Link href="/contact-sales">Contact Sales</Link> and we’ll set it up with you.</div>
      </div>
    </div>
  );
}
