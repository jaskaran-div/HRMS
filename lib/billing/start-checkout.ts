// BROWSER. Starts Stripe Checkout with the token the registration returned (kept in sessionStorage for retries).

export const TOKEN_KEY = 'hr.checkoutToken';

/** Sends the browser to Stripe Checkout. Resolves with an error message only when that is not possible. */
export async function startCheckout(token?: string | null): Promise<string> {
  try {
    const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(token ? { token } : {}) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.url) { window.location.href = j.url; return new Promise<string>(() => {}); }
    if (j.relogin) sessionStorage.removeItem(TOKEN_KEY);
    return j.error ?? 'Could not start the payment.';
  } catch {
    return 'Could not reach the server. Check your internet connection.';
  }
}
