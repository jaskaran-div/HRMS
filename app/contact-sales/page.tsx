import type { Metadata } from 'next';
import { PublicNav } from '@/components/PublicNav';
import { ContactSalesForm } from './ContactSalesForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Contact Sales' };

export default function ContactSalesPage() {
  return <div className="pub"><PublicNav page="contact" /><ContactSalesForm /></div>;
}
