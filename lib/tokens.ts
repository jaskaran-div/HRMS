// SERVER ONLY. One-time tokens for email links. Only the SHA-256 hash is stored, so a database leak
// cannot be turned into working verification / invitation / transfer links.
import { createHash, randomBytes } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const validTokenShape = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(t);

export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
