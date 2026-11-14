import Link from 'next/link';
import QRCode from 'qrcode';
import { androidApp } from '@/lib/mobile-app';
import { baseUrl, platformName } from '@/lib/platform-mail';
import { Icon } from '@/components/Icon';
import { fmtDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/** Public "Get the mobile app" page: download button, install steps, and a QR code for scanning from a computer. */
export default async function AppPage() {
  const app = await androidApp();
  const pageUrl = `${baseUrl() || 'https://hr.derivion.in'}/app`;
  const qr = await QRCode.toString(pageUrl, { type: 'svg', margin: 1, width: 180, color: { dark: '#1c1f2b', light: '#ffffff' } });
  return (
    <div className="login-wrap">
      <div className="public-card">
        <h1>Get the mobile app</h1>
        <p className="sub">Check in and out, apply for and approve leave, see your attendance and payslips, and get notifications — with the same login you use on the web.</p>

        {app.available ? <>
          <div className="row" style={{ alignItems: 'center' }}>
            <a className="btn primary" href={app.url!} {...(app.kind === 'apk' ? { download: true } : { target: '_blank', rel: 'noreferrer' })}>
              <Icon name="download" size={16} /> {app.kind === 'store' ? 'Get it on Google Play' : 'Download for Android'}
            </a>
            {app.kind === 'apk' && <span className="muted small">{[app.version && `Version ${app.version}`, app.sizeMb && `${app.sizeMb} MB`, app.updated && `updated ${fmtDate(app.updated.slice(0, 10))}`].filter(Boolean).join(' · ')}</span>}
          </div>
          {app.kind === 'apk' && (
            <div className="note" style={{ marginTop: 6 }}>
              <b>Installing on Android</b>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li>Open this page on your phone and tap <b>Download for Android</b>.</li>
                <li>Open the downloaded file. If asked, allow your browser to <b>install unknown apps</b> (Settings → Apps → your browser → Install unknown apps).</li>
                <li>Tap <b>Install</b>, open the app and log in with your usual email or username and password.</li>
              </ol>
              <p className="small" style={{ margin: '8px 0 0' }}>To update, download and install the new version the same way — your login and data stay.</p>
            </div>
          )}
        </> : <p className="note warn">The Android app will be available here soon.</p>}

        <p className="muted small" style={{ marginTop: 14 }}><b>iPhone:</b> coming soon. Meanwhile use {platformName()} in Safari — it works on phones too.</p>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 132, height: 132, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: qr.replace('<svg ', '<svg width="132" height="132" ') }} aria-label="QR code for this page" />
          <p className="muted small" style={{ margin: 0, flex: 1, minWidth: 180 }}>On a computer? Scan this with your phone’s camera to open this page on the phone.</p>
        </div>

        <p className="foot"><Link href="/login">Log in on the web</Link></p>
      </div>
    </div>
  );
}
