import { notFound } from 'next/navigation';
import { orgDetail } from '@/lib/platform';
import { orgFeatures } from '@/lib/org';
import { OrgManager } from './OrgManager';

export const dynamic = 'force-dynamic';

export default async function AdminOrganization({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const x = await orgDetail(id);
  if (!x) notFound();
  return <OrgManager data={{ ...x, features: orgFeatures(x.org) }} />;
}
