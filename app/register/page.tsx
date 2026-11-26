import type { Metadata } from 'next';
import { PublicNav } from '@/components/PublicNav';
import { RegisterForm } from './RegisterForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Register your organization' };

export default function RegisterPage() {
  return <div className="pub"><PublicNav page="register" /><RegisterForm /></div>;
}
