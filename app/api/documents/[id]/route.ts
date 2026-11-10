import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { driveConfigured, driveDownload, driveTrash, DRIVE_NOT_SET } from '@/lib/drive';
import { isStaff, type DocumentRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const INLINE = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/;

/** Opens / downloads a document. Who may: HR staff; anyone for company documents; the employee for their own visible documents. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.response;
  const { id } = await params;
  const { data } = await supabaseAdmin().from('documents').select('*').eq('id', id).maybeSingle();
  const d = data as DocumentRow | null;
  const allowed = !!d && (isStaff(g.profile.role) || d.employee_id === null ||
    (d.visible_to_employee && !!g.profile.employee_id && d.employee_id === g.profile.employee_id));
  if (!d || !allowed) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  if (!driveConfigured()) return NextResponse.json({ error: DRIVE_NOT_SET }, { status: 503 });

  let file: Response;
  try {
    file = await driveDownload(d.drive_file_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const mime = d.mime_type || 'application/octet-stream';
  const download = new URL(req.url).searchParams.has('download') || !INLINE.test(mime);
  return new NextResponse(file.body, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.file_name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** HR removes a document (the Drive file goes to Drive's trash). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(['admin', 'editor']);
  if (!g.ok) return g.response;
  const { id } = await params;
  const admin = supabaseAdmin();
  const { data } = await admin.from('documents').select('*').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  if (driveConfigured()) await driveTrash((data as DocumentRow).drive_file_id).catch(() => {});
  const { error } = await admin.from('documents').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** HR shows / hides an employee document from the employee. Body: { visible } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(['admin', 'editor']);
  if (!g.ok) return g.response;
  const { id } = await params;
  const { visible } = (await req.json().catch(() => ({}))) as { visible?: boolean };
  const { error } = await supabaseAdmin().from('documents').update({ visible_to_employee: visible !== false }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
