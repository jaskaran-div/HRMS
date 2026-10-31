export const inr = (n: number) =>
  '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const inrWhole = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/** Indian-system number to words, Zoho style: "Indian Rupee Twenty-Two Thousand Three Hundred Forty-Four Only". */
export function amountInWords(amount: number): string {
  let n = Math.round(Math.abs(amount) || 0);
  if (n === 0) return 'Indian Rupee Zero Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : ''));
  const three = (x: number) =>
    [x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' : '', x % 100 ? two(x % 100) : ''].filter(Boolean).join(' ');
  const out: string[] = [];
  for (const [d, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (n >= d) { out.push(three(Math.floor(n / d)) + ' ' + name); n %= d; }
  }
  if (n) out.push(three(n));
  return 'Indian Rupee ' + out.join(' ') + ' Only';
}

export const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
