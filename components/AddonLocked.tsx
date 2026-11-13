'use client';

import Link from 'next/link';
import { useApp } from './AppContext';
import { Empty } from './ui';
import { ADDONS, FEATURE_LABEL, type Feature } from '@/lib/billing/catalog';

/** Shown instead of a page whose add-on the organization has not bought. */
export function AddonLocked({ feature }: { feature: Feature }) {
  const { isOwner } = useApp();
  const addon = ADDONS.find(a => a.feature === feature);
  return (
    <div className="card">
      <Empty icon="lock" title={`${FEATURE_LABEL[feature]} is an add-on`}>
        {addon?.description}{' '}
        {isOwner ? <Link href="/billing">Add it in Billing</Link> : 'Ask your organization’s owner to add it in Billing.'}
      </Empty>
    </div>
  );
}

/** Renders `children` only when the plan includes `feature`. */
export function FeatureGate({ feature, children }: { feature: Feature; children: React.ReactNode }) {
  const { has } = useApp();
  return has(feature) ? <>{children}</> : <AddonLocked feature={feature} />;
}
