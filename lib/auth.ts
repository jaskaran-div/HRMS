import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import type { Profile, Role } from './types';

type Guard =
  | { ok: true; user: { id: string }; profile: Profile }
  | { ok: false; response: NextResponse };

/**
 * For API routes: the caller must be logged in, active, and (optionally) have one of the given roles.
 * The web app is recognised by its session cookie; the mobile app sends `Authorization: Bearer <Supabase access token>`.
 */
export async function guard(roles?: Role[]): Promise<Guard> {
  const token = /^Bearer\s+(\S+)/i.exec((await headers()).get('authorization') ?? '')?.[1];
  const { data: { user } } = token
    ? await supabaseAdmin().auth.getUser(token)
    : await (await supabaseServer()).auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Not logged in' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin().from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile || !profile.active)
    return { ok: false, response: NextResponse.json({ error: 'Account disabled' }, { status: 403 }) };
  if (roles && !roles.includes(profile.role))
    return { ok: false, response: NextResponse.json({ error: 'You do not have permission to do this' }, { status: 403 }) };
  return { ok: true, user, profile: profile as Profile };
}
