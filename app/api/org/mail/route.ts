import { NextResponse } from 'next/server';
import { guard } from '@/lib/auth';
import { ADMIN_ROLES } from '@/lib/roles';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { forgetOrgMailServer, orgMailServer, transportFor } from '@/lib/org-mail';
import { open, seal, secretBoxReady } from '@/lib/secret-box';
import { EMAIL_RE } from '@/lib/registration';

export const dynamic = 'force-dynamic';

/** The organization's own mail server (never the password). */
export async function GET() {
  const g = await guard(ADMIN_ROLES);
  if (!g.ok) return g.response;
  const m = await orgMailServer(g.org.id);
  return NextResponse.json({
    ready: secretBoxReady(),
    server: m ? { provider: m.provider, host: m.host, port: m.port, secure: m.secure, username: m.username, from_email: m.from_email, verified_at: m.verified_at } : null,
    platform_sender: process.env.PLATFORM_SENDER_EMAIL || null,
  });
}

/**
 * Connect / update. Body: { provider, host, port, secure, username, password?, from_email }
 * The login is tested before anything is saved. Password blank on update = keep the saved one.
 */
export async function PUT(req: Request) {
  const g = await guard(ADMIN_ROLES);
  if (!g.ok) return g.response;
  if (!secretBoxReady()) return NextResponse.json({ error: 'The server is missing MAIL_SECRET_KEY, so mail passwords cannot be stored safely yet. Ask the platform administrator.' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const host = String(b.host ?? '').trim().toLowerCase();
  const port = Number(b.port);
  const secure = !!b.secure;
  const username = String(b.username ?? '').trim();
  const fromEmail = String(b.from_email ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return NextResponse.json({ error: 'Enter the mail server (SMTP host), e.g. smtp.gmail.com.' }, { status: 400 });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ error: 'Enter the port, usually 587 or 465.' }, { status: 400 });
  if (!username) return NextResponse.json({ error: 'Enter the login (usually the email address).' }, { status: 400 });
  if (!EMAIL_RE.test(fromEmail)) return NextResponse.json({ error: 'Enter the address emails should come from.' }, { status: 400 });

  const existing = await orgMailServer(g.org.id);
  let password = String(b.password ?? '');
  if (!password) {
    if (!existing) return NextResponse.json({ error: 'Enter the password (or app password).' }, { status: 400 });
    password = open(existing.password_enc);
  }

  // test the login first: nothing is saved if the server refuses it
  try {
    await transportFor({ host, port, secure, username }, password).verify();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /auth|535|534|credentials|password/i.test(msg)
      ? ' The login was refused: check the email and password. Gmail / Outlook with 2-step verification need an “app password”.'
      : /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(msg) ? ' The server could not be reached: check the host and port.' : '';
    return NextResponse.json({ error: `Could not connect to your mail server.${hint}`, detail: msg.slice(0, 300) }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin.from('org_mail_settings').upsert({
    org_id: g.org.id, provider: String(b.provider ?? '').slice(0, 20) || null, host, port, secure, username,
    password_enc: seal(password), from_email: fromEmail, verified_at: new Date().toISOString(),
    updated_by: g.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // the sender address everywhere is now their own; their domain counts as official
  const domain = fromEmail.split('@')[1];
  const { data: st } = await admin.from('settings').select('email_domains').eq('org_id', g.org.id).single();
  await admin.from('settings').update({
    sender_email: fromEmail, ...(st?.email_domains ? {} : { email_domains: domain }),
  }).eq('org_id', g.org.id);
  forgetOrgMailServer(g.org.id);
  return NextResponse.json({ ok: true });
}

/** Disconnect: emails go back to the platform's mail account. */
export async function DELETE() {
  const g = await guard(ADMIN_ROLES);
  if (!g.ok) return g.response;
  const admin = supabaseAdmin();
  await admin.from('org_mail_settings').delete().eq('org_id', g.org.id);
  const { data: st } = await admin.from('settings').select('id').eq('org_id', g.org.id).single();
  // the first organization (Derivion) keeps its address; others go back to the platform sender
  if (st && st.id !== 1) await admin.from('settings').update({ sender_email: process.env.PLATFORM_SENDER_EMAIL || process.env.SMTP_USER || '' }).eq('org_id', g.org.id);
  forgetOrgMailServer(g.org.id);
  return NextResponse.json({ ok: true });
}
