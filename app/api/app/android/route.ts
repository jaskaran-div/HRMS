import { NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { APK_FILENAME, apkPath } from '@/lib/mobile-app';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Public: the Android app (APK). The Play Store page instead, when APP_ANDROID_URL is set. */
export async function GET() {
  const store = process.env.APP_ANDROID_URL?.trim();
  if (store) return NextResponse.redirect(store, 302);
  const file = apkPath();
  let size: number;
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    size = s.size;
  } catch {
    return NextResponse.json({ error: 'The Android app is not available for download yet.' }, { status: 404 });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${APK_FILENAME}"`,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
