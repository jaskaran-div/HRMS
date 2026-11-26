import Link from 'next/link';
import { loginBrand } from '@/lib/brand';
import { initials } from '@/lib/format';

type Page = 'pricing' | 'register' | 'login' | 'contact' | 'other';

/** Top bar of every page shown before login: brand, Pricing, Contact sales, Log in, Get started. */
export async function PublicNav({ page = 'other' }: { page?: Page }) {
  const brand = await loginBrand();
  return (
    <header className="pnav">
      <div className="pnav-in">
        <Link href="/pricing" className="pnav-brand" aria-label={`${brand.name} — pricing`}>
          <span className={`logo ${brand.logo ? 'has-img' : ''}`}>{brand.logo ? <img src={brand.logo} alt="" /> : initials(brand.name)}</span>
          <b>{brand.name}</b>
        </Link>
        <nav className="pnav-links">
          <Link href="/pricing" className={page === 'pricing' ? 'on' : ''}>Pricing</Link>
          <Link href="/contact-sales" className={page === 'contact' ? 'on' : ''}>Contact sales</Link>
        </nav>
        <div className="pnav-actions">
          {page !== 'login' && <Link className="btn" href="/login">Log in</Link>}
          {page !== 'register' && <Link className="btn primary" href="/register?plan=business">Get started</Link>}
        </div>
      </div>
    </header>
  );
}

/** Small footer for public pages. */
export function PublicFooter({ name }: { name: string }) {
  return (
    <footer className="pfoot">
      <span>© {new Date().getFullYear()} {name}</span>
      <nav><Link href="/pricing">Pricing</Link><Link href="/register?plan=business">Register</Link><Link href="/login">Log in</Link><Link href="/contact-sales">Contact sales</Link></nav>
    </footer>
  );
}
