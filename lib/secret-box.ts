// SERVER ONLY. Encrypts small secrets (an organization's mail password) with AES-256-GCM.
// The key comes from MAIL_SECRET_KEY in the server environment (any long random string); losing or
// changing it means every organization has to enter its mail password again.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const key = () => {
  const k = process.env.MAIL_SECRET_KEY ?? '';
  if (k.length < 32) throw new Error('MAIL_SECRET_KEY is not set (use a random string of at least 32 characters).');
  return createHash('sha256').update(k).digest();
};

export const secretBoxReady = () => (process.env.MAIL_SECRET_KEY ?? '').length >= 32;

/** "v1.<iv>.<tag>.<ciphertext>" (base64url) */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable secret');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
