// SERVER ONLY. Where people get the mobile app.
//  * APP_ANDROID_URL set (e.g. the Play Store page): every "Get the app" button opens it.
//  * Otherwise the APK file at APP_APK_PATH is offered as a direct download (/api/app/android).
//    It lives outside the code folder, so deploys never touch it; replace the file to publish a new build.
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const apkPath = () => process.env.APP_APK_PATH || join(homedir(), 'hr-downloads', 'hrms.apk');
export const APK_FILENAME = 'hrms.apk';

export interface AndroidApp {
  available: boolean;
  kind: 'store' | 'apk' | null;
  url: string | null;
  /** APK only */
  sizeMb: number | null;
  updated: string | null;
  version: string | null;
}

export async function androidApp(): Promise<AndroidApp> {
  const store = process.env.APP_ANDROID_URL?.trim();
  const version = process.env.APP_ANDROID_VERSION?.trim() || null;
  if (store) return { available: true, kind: 'store', url: store, sizeMb: null, updated: null, version };
  try {
    const s = await stat(apkPath());
    if (!s.isFile() || s.size < 1024) throw new Error('not a file');
    return { available: true, kind: 'apk', url: '/api/app/android', sizeMb: Math.round((s.size / 1048576) * 10) / 10, updated: s.mtime.toISOString(), version };
  } catch {
    return { available: false, kind: null, url: null, sizeMb: null, updated: null, version };
  }
}
