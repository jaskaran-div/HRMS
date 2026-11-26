import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { supabaseServer } from '@/lib/supabase/server';
import { RetryPayment } from './RetryPayment';

export const dynamic = 'force-dynamic';

const WHY: Record<string, { title: string; text: string }> = {
  cancelled: { title: 'Payment cancelled', text: 'You left the payment page before paying. Nothing was charged.' },
  expired: { title: 'Payment session expired', text: 'The payment page was open too long and expired. Nothing was charged — start again below.' },
  incomplete: { title: 'Payment not completed', text: 'The payment did not go through. Nothing was charged. Check your card details or try another card.' },
  failed: { title: 'Payment failed', text: 'Your bank declined the payment. Nothing was charged. Try again or use another card.' },
  unknown: { title: 'We couldn’t confirm a payment', text: 'This payment link is not valid. If money was taken from your account, it will show in Billing once Stripe confirms it.' },
};

/** Where Stripe Checkout returns when the payment is cancelled, and where the success page sends unfinished sessions. */
export default async function CheckoutFailed({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const w = WHY[reason ?? ''] ?? WHY.failed;
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  return (
    <div className="login-wrap">
      <div className="public-card">
        <div className="result-icon bad"><Icon name="x" size={28} /></div>
        <h1>{w.title}</h1>
        <p className="sub">{w.text}</p>
        <RetryPayment loggedIn={!!user} />
        <p className="foot">Need help paying? <Link href="/contact-sales">Contact Sales</Link></p>
      </div>
    </div>
  );
}
