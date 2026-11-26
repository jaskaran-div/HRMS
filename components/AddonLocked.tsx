'use client';

import Link from 'next/link';
import { useApp } from './AppContext';
import { Empty } from './ui';
import { FEATURE_DESCRIPTION, FEATURE_LABEL, type Feature } from '@/lib/billing/catalog';

/** Shown instead of a page whose feature the organization has switched off. */
export function AddonLocked({ feature }: { feature: Feature }) {
  const { isOwner, isAdmin } = useApp();
  return (
    <div className="card">
      <Empty icon="lock" title={`${FEATURE_LABEL[feature]} is switched off`}>
        {FEATURE_DESCRIPTION[feature]}{' '}
        {isOwner || isAdmin ? <Link href="/billing">Switch it on in Billing → Features</Link> : 'Ask your organization’s owner or admin to switch it on.'}
      </Empty>
    </div>
  );
}

/** Renders `children` only when the plan includes `feature`. */
export function FeatureGate({ feature, children }: { feature: Feature; children: React.ReactNode }) {
  const { has } = useApp();
  return has(feature) ? <>{children}</> : <AddonLocked feature={feature} />;
}
