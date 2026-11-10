// SERVER ONLY. Google Drive as file storage, via the REST API (no extra packages).
// Files stay private in Drive; the app streams them to people after checking they may see them.
//
// Auth — either:
//   A) Service account (Google Workspace, recommended): GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY,
//      and GOOGLE_DRIVE_FOLDER_ID = a folder inside a *Shared drive* the service account is a member of (Content manager).
//      (Service accounts have no storage of their own, so a normal My Drive folder will not work.)
//   B) OAuth refresh token of a normal Google account: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN,
//      and GOOGLE_DRIVE_FOLDER_ID = any folder in that account's Drive.
import { createSign } from 'node:crypto';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';

const env = (k: string) => process.env[k]?.trim() || '';
const useOAuth = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_REFRESH_TOKEN'));
const useServiceAccount = () => !!(env('GOOGLE_SERVICE_ACCOUNT_EMAIL') && env('GOOGLE_PRIVATE_KEY'));

export const driveConfigured = () => !!env('GOOGLE_DRIVE_FOLDER_ID') && (useOAuth() || useServiceAccount());
export const DRIVE_NOT_SET = 'Document storage is not set up yet: add the Google Drive keys (see .env.example) to the server environment.';

let token: { value: string; until: number } | null = null;

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  let body: URLSearchParams;
  if (useOAuth()) {
    body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: env('GOOGLE_REFRESH_TOKEN'),
      client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
    });
  } else {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
      iss: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'), scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    }))}`;
    const key = env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');
    const sig = createSign('RSA-SHA256').update(unsigned).sign(key);
    body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` });
  }
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description ?? j.error ?? res.status}`);
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Google Drive: ${j.error?.message ?? res.statusText}`);
  }
  return res;
}

const ALL = 'supportsAllDrives=true';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Id of the sub-folder `name` inside the storage folder (created if missing). */
async function folder(name: string): Promise<string> {
  const root = env('GOOGLE_DRIVE_FOLDER_ID');
  const query = `name = '${q(name)}' and mimeType = '${FOLDER}' and '${q(root)}' in parents and trashed = false`;
  const found = (await (await call(`${API}/files?${ALL}&includeItemsFromAllDrives=true&fields=files(id)&q=${encodeURIComponent(query)}`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return found.files[0].id;
  const made = (await (await call(`${API}/files?${ALL}&fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [root] }),
  })).json()) as { id: string };
  return made.id;
}

/** Uploads a file into `<storage folder>/<subfolder>`; returns the Drive file id. */
export async function driveUpload(subfolder: string, name: string, mime: string, data: Buffer): Promise<string> {
  const parent = await folder(subfolder);
  const boundary = `hrportal${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await call(`${UPLOAD}?uploadType=multipart&${ALL}&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return ((await res.json()) as { id: string }).id;
}

/** The file's bytes as a stream. */
export async function driveDownload(id: string): Promise<Response> {
  return call(`${API}/files/${encodeURIComponent(id)}?alt=media&${ALL}`);
}

/** Moves the file to the Drive trash (recoverable there for 30 days). */
export async function driveTrash(id: string): Promise<void> {
  await call(`${API}/files/${encodeURIComponent(id)}?${ALL}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  });
}
