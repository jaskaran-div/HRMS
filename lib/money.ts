/** Stripe amount (smallest currency unit) → "₹1,499.00" / "$29.00". */
export const money = (amount: number | null | undefined, currency: string | null | undefined) =>
  amount == null || !currency ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
