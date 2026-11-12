import { Spinner } from '@/components/ui';

/** Shown while a whole panel (its layout: login check, profile, settings) is loading, e.g. right after logging in. */
export default function Loading() {
  return (
    <div className="boot" role="status" aria-label="Loading">
      <Spinner size={34} />
      <span>Loading HR Portal…</span>
    </div>
  );
}
