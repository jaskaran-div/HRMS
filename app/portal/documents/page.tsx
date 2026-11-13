import { portalSession } from '@/lib/portal';
import { AddonLocked } from '@/components/AddonLocked';
import { orgFeatures } from '@/lib/org';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fmtDate } from '@/lib/dates';
import { fileSize } from '@/lib/format';
import type { DocumentRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

function DocTable({ docs }: { docs: DocumentRow[] }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr><th>Title</th><th>Category</th><th>Added</th><th /></tr></thead>
        <tbody>
          {docs.map(d => (
            <tr key={d.id}>
              <td><b>{d.title}</b><div className="muted small">{d.file_name}{d.size_bytes ? ` · ${fileSize(d.size_bytes)}` : ''}</div></td>
              <td>{d.category}</td><td className="muted small">{fmtDate(d.created_at)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <a className="btn sm" href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">Open</a>{' '}
                <a className="btn sm primary" href={`/api/documents/${d.id}?download=1`}>Download</a>
              </td>
            </tr>
          ))}
          {!docs.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 26 }}>Nothing here yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default async function MyDocuments() {
  const s = await portalSession();
  if (!orgFeatures(s.org).includes('documents')) return <AddonLocked feature="documents" />;
  const admin = supabaseAdmin();
  const [company, mine] = await Promise.all([
    admin.from('documents').select('*').eq('org_id', s.org.id).is('employee_id', null).order('created_at', { ascending: false }),
    admin.from('documents').select('*').eq('employee_id', s.me!.id).eq('visible_to_employee', true).order('created_at', { ascending: false }),
  ]);
  return (
    <>
      <div className="card"><h3>My documents</h3><DocTable docs={(mine.data ?? []) as DocumentRow[]} /></div>
      <div className="card"><h3>Company documents</h3><p className="muted small" style={{ marginTop: 0 }}>Terms &amp; conditions, policies and other documents shared by HR.</p>
        <DocTable docs={(company.data ?? []) as DocumentRow[]} /></div>
    </>
  );
}
