import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** API routes the mobile app calls with `Authorization: Bearer <access token>`; each checks the token itself in guard(). */
const MOBILE_API = /^\/api\/(mobile\/|leave$|change-password$)/;

/** Pages and APIs anyone may open without logging in (each public API checks its own input / rate limit). */
const PUBLIC = /^\/(login|register|verify-email|invite|contact-sales)(\/|$)|^\/api\/(logout|register(\/.*)?|invitations\/accept|contact-sales|app\/android)$/;

/** Keeps the Supabase session fresh and sends logged-out visitors to /login. */
export async function middleware(req: NextRequest) {
  if (MOBILE_API.test(req.nextUrl.pathname) && /^Bearer\s+\S+/i.test(req.headers.get('authorization') ?? ''))
    return NextResponse.next({ request: req });
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (!user && !PUBLIC.test(path)) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (user && (path === '/login' || path === '/register')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // everything except static files, the cron endpoint (checks its own secret) and the Stripe webhook (checks its signature)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron|api/stripe/webhook).*)'],
};
