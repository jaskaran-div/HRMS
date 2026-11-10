import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DRIVE_NOT_SET, driveConfigured, driveTrash, driveUpload } from '@/lib/drive';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Vercel rejects request bodies over 4.5 MB, so uploads are capped just below that. */
const MAX_BYTES = 4 * 1024 * 1024;

/** HR uploads a document. Form fields: file, title, category, employee_id (blank = company document), visible ('1' / '0'). */
export async function POST(req: Request) {
  const g = await guard(['admin', 'editor']);
  if (!g.ok) return g.response;
  if (!driveConfigured()) return NextResponse.json({ error: DRIVE_NOT_SET }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The file is too large (4 MB at most). Compress the PDF or split it.' }, { status: 413 });
  const title = String(form.get('title') ?? '').trim().slice(0, 200) || file.name;
  const category = String(form.get('category') ?? '').trim().slice(0, 80) || null;
  const employeeId = String(form.get('employee_id') ?? '').trim() || null;
  const visible = String(form.get('visible') ?? '1') !== '0';

  const admin = supabaseAdmin();
  let sub = 'Company documents';
  if (employeeId) {
    const { data: emp } = await admin.from('employees').select('emp_code, name').eq('id', employeeId).maybeSingle();
    if (!emp) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    sub = `${emp.emp_code} - ${emp.name}`;
  }
  const safeName = file.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
  let driveId: string;
  try {
    driveId = await driveUpload(sub, safeName, file.type || 'application/octet-stream', Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const { data: row, error } = await admin.from('documents').insert({
    employee_id: employeeId, title, category, file_name: safeName, mime_type: file.type || null, size_bytes: file.size,
    drive_file_id: driveId, visible_to_employee: visible, uploaded_by: g.user.id, uploaded_by_name: g.profile.full_name,
  }).select('*').single();
  if (error) {
    await driveTrash(driveId).catch(() => {});
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ document: row });
}
