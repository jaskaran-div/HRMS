// SERVER ONLY. Where the "Get the app" button points.
//  * APP_ANDROID_URL set (e.g. the Play Store page): the button opens it.
//  * Otherwise the APK file at APP_APK_PATH (default ~/hr-downloads/hrms.apk) is downloaded via /api/app/android.
//    It lives outside the code folder, so deploys never touch it; replace the file to publish a new build.
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const apkPath = () => process.env.APP_APK_PATH || join(homedir(), 'hr-downloads', 'hrms.apk');
export const APK_FILENAME = 'hrms.apk';

export interface AndroidApp { available: boolean; kind: 'store' | 'apk' | null }

export async function androidApp(): Promise<AndroidApp> {
  if (process.env.APP_ANDROID_URL?.trim()) return { available: true, kind: 'store' };
  try {
    const s = await stat(apkPath());
    return s.isFile() && s.size > 1024 ? { available: true, kind: 'apk' } : { available: false, kind: null };
  } catch {
    return { available: false, kind: null };
  }
}
