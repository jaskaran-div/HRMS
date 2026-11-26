import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { OPTIONAL_FEATURES, isFeature } from '@/lib/billing/catalog';

export const dynamic = 'force-dynamic';

/** Owner / admin: which optional features the organization switches off. Body: { disabled: Feature[] } */
export async function POST(req: Request) {
  const g = await guard(['owner', 'admin'], { allowLocked: true });
  if (!g.ok) return g.response;
  const b = (await req.json().catch(() => ({}))) as { disabled?: unknown };
  const disabled = [...new Set(Array.isArray(b.disabled) ? b.disabled.filter(isFeature).filter(f => OPTIONAL_FEATURES.includes(f)) : [])];
  const { error } = await supabaseAdmin().from('organizations').update({ disabled_features: disabled }).eq('id', g.org.id);
  if (error) return NextResponse.json({ error: 'Could not save the features.' }, { status: 500 });
  return NextResponse.json({ ok: true, disabled });
}
