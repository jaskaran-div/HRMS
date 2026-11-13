// SERVER ONLY. Tiny in-memory rate limiter for public endpoints (registration, Contact Sales, invitation accept).
// The app runs as one pm2 process on EC2, so memory is shared by every request. (Several processes / servers
// would need a shared store such as Redis.)
const hits = new Map<string, number[]>();

/** true = allowed. `max` requests per `windowMs` per key. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return true;
}
