import { NextResponse } from 'next/server';
import { mobileSession } from '@/lib/mobile';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { orgFeatures } from '@/lib/org';
import type { PayslipData } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The employee's payslips (HR keeps the latest 2 months) + the company details printed on them. */
export async function GET() {
  const r = await mobileSession();
  if (!r.ok) return r.response;
  if (!orgFeatures(r.s.org).includes('payroll'))
    return NextResponse.json({ error: 'Payslips are not part of your organization’s plan.', code: 'feature_missing' }, { status: 402 });
  const { data, error } = await supabaseAdmin().from('payslips').select('data').eq('employee_id', r.s.me.id).order('month', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const st = r.s.settings;
  return NextResponse.json({
    company: { name: st.company_name, address: st.company_address, footer: st.footer_note },
    payslips: (data ?? []).map(x => x.data as PayslipData),
  });
}
