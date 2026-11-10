import { portalSession } from '@/lib/portal';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PayslipTable } from '@/components/portal/PayslipTable';
import type { PayslipData } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MyPayslips() {
  const s = await portalSession();
  const { data } = await supabaseAdmin().from('payslips').select('data').eq('employee_id', s.me!.id).order('month', { ascending: false });
  return (
    <div className="card">
      <h3>My payslips</h3>
      <PayslipTable slips={(data ?? []).map(r => r.data as PayslipData)} />
      <p className="muted small">The latest 2 months are kept here. Download them to keep a copy.</p>
    </div>
  );
}
