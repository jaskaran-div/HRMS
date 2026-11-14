import { Icon } from './Icon';

/** Small button in the bottom-right corner: one click downloads the Android app. Rendered only when an APK is on the server. */
export function AppDownloadFab({ store }: { store?: boolean }) {
  return (
    <a className="app-fab" href="/api/app/android" {...(store ? { target: '_blank', rel: 'noreferrer' } : { download: true })}
      title="Download the mobile app for Android" aria-label="Download the mobile app for Android">
      <Icon name="download" size={16} /><span>Get the app</span>
    </a>
  );
}
