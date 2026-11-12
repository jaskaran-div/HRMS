import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

async function logout(_req: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  // Relative Location: behind nginx req.url is http(s)://localhost:3000, which would send the browser there.
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}

export const GET = logout;
export const POST = logout;
