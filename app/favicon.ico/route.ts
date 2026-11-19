import { loginBrand } from '@/lib/brand';
import { initials } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * The browser-tab icon: the company logo uploaded on Company & Rules (LOGIN_BRAND_ORG, as on the login page),
 * or the company initials on a blue tile when there is no logo. Cached for an hour so a new logo shows up soon.
 */
export async function GET() {
  const brand = await loginBrand();
  const headers = { 'Cache-Control': 'public, max-age=3600' };
  const m = brand.logo?.match(/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon));base64,(.+)$/);
  if (m) return new Response(Buffer.from(m[2], 'base64'), { headers: { ...headers, 'Content-Type': m[1] } });
  if (brand.logo && /^https?:\/\//.test(brand.logo)) return Response.redirect(brand.logo, 302);
  const text = initials(brand.name).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1d6ff2"/>`
    + `<text x="32" y="42" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return new Response(svg, { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
}
