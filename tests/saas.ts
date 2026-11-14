// SaaS rules: subscription status → access, entitlements, role assignment, Stripe configuration and webhooks.
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { orgFeatures, orgHasAccess, statusFromStripe, type Org } from '../lib/org';
import { assignableRoles, canManageTarget } from '../lib/roles';
import { BASE_FEATURES } from '../lib/billing/catalog';
import { keyMode, stripeConfigProblems } from '../lib/stripe';
import { hashToken, newToken, validTokenShape } from '../lib/tokens';
import nodemailer from 'nodemailer';
import { wrapEmail } from '../lib/email-templates';
import { withLogo } from '../lib/org-mail';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; }
};
const org = (o: Partial<Org>) => ({ status: 'active', billing_exempt: false, addons: [], entitlement_overrides: {}, ...o }) as Org;

test('only paid Stripe states grant access; past_due is a grace period', () => {
  assert.equal(statusFromStripe('active'), 'active');
  assert.equal(statusFromStripe('trialing'), 'active');
  assert.equal(statusFromStripe('past_due'), 'past_due');
  assert.equal(statusFromStripe('incomplete'), 'pending_payment');
  assert.equal(statusFromStripe('incomplete_expired'), 'expired');
  assert.equal(statusFromStripe('unpaid'), 'unpaid');
  assert.equal(statusFromStripe('canceled'), 'canceled');
  assert.equal(statusFromStripe(undefined), 'pending_payment');
  for (const s of ['active', 'past_due'] as const) assert.ok(orgHasAccess(org({ status: s })));
  for (const s of ['pending_payment', 'unpaid', 'canceled', 'expired', 'paused', 'suspended'] as const) assert.ok(!orgHasAccess(org({ status: s })), s);
});

test('exempt organizations have access unless suspended', () => {
  assert.ok(orgHasAccess(org({ status: 'pending_payment', billing_exempt: true })));
  assert.ok(!orgHasAccess(org({ status: 'suspended', billing_exempt: true })));
});

test('features = base + paid add-ons ± platform overrides; none without access', () => {
  assert.deepEqual(orgFeatures(org({})), BASE_FEATURES);
  assert.ok(orgFeatures(org({ addons: ['payroll'] })).includes('payroll'));
  assert.ok(!orgFeatures(org({ addons: ['payroll'] })).includes('documents'));
  assert.ok(!orgFeatures(org({ addons: ['bogus'] })).includes('bogus' as never));
  assert.ok(orgFeatures(org({ entitlement_overrides: { grant: ['documents'] } })).includes('documents'));
  assert.ok(!orgFeatures(org({ addons: ['payroll'], entitlement_overrides: { revoke: ['payroll'] } })).includes('payroll'));
  assert.deepEqual(orgFeatures(org({ status: 'canceled', addons: ['payroll'] })), []);
  assert.ok(orgFeatures(org({ billing_exempt: true })).includes('email_center'));
});

test('role chain: owner → HR admin → team leader / employee; nobody grants owner', () => {
  assert.ok(assignableRoles('owner').includes('hr_admin'));
  assert.deepEqual(assignableRoles('hr_admin'), ['team_lead', 'employee']);
  for (const r of ['owner', 'admin', 'hr_admin', 'editor', 'viewer', 'team_lead', 'employee'] as const) assert.ok(!assignableRoles(r).includes('owner'), r);
  assert.deepEqual(assignableRoles('employee'), []);
  assert.deepEqual(assignableRoles('team_lead'), []);
  assert.deepEqual(assignableRoles('editor'), []);
  assert.ok(!canManageTarget('hr_admin', 'admin'));
  assert.ok(!canManageTarget('hr_admin', 'hr_admin'));
  assert.ok(canManageTarget('hr_admin', 'employee'));
  assert.ok(!canManageTarget('admin', 'owner'));
  assert.ok(canManageTarget('admin', 'admin')); // existing Derivion admins keep managing admins
});

test('Stripe test and live keys are kept apart', () => {
  const save = { ...process.env };
  const set = (e: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(e)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  const base = { STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_BASE_PRICE_ID: 'price_x', STRIPE_MODE: undefined, STRIPE_PUBLISHABLE_KEY: undefined };
  try {
    set({ ...base, STRIPE_SECRET_KEY: 'sk_test_abc', NODE_ENV: 'development' });
    assert.equal(keyMode(), 'test');
    assert.deepEqual(stripeConfigProblems(), []);
    set({ STRIPE_PUBLISHABLE_KEY: 'pk_live_abc' });
    assert.match(stripeConfigProblems().join(), /not a test key/);
    set({ STRIPE_PUBLISHABLE_KEY: 'pk_test_abc', STRIPE_MODE: 'live' });
    assert.match(stripeConfigProblems().join(), /STRIPE_MODE is "live"/);
    set({ STRIPE_MODE: undefined, NODE_ENV: 'production' });
    assert.match(stripeConfigProblems().join(), /production server/);
    set({ STRIPE_MODE: 'test' });
    assert.deepEqual(stripeConfigProblems(), []);
    set({ STRIPE_SECRET_KEY: '' });
    assert.match(stripeConfigProblems().join(), /STRIPE_SECRET_KEY is not set/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in save)) delete process.env[k];
    Object.assign(process.env, save);
  }
});

test('webhook signatures: valid accepted, tampered / wrong secret rejected', () => {
  const s = new Stripe('sk_test_dummy', { apiVersion: '2025-02-24.acacia' });
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'invoice.paid', livemode: false, data: { object: { id: 'in_1' } } });
  const header = s.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(s.webhooks.constructEvent(payload, header, secret).id, 'evt_1');
  assert.throws(() => s.webhooks.constructEvent(payload.replace('in_1', 'in_2'), header, secret));
  assert.throws(() => s.webhooks.constructEvent(payload, header, 'whsec_other'));
});

test('email-link tokens: random, url-safe, only the hash is stored', () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b);
  assert.ok(validTokenShape(a));
  assert.ok(!validTokenShape('../etc/passwd'));
  assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), a);
});

// async: the logo check renders a real MIME message in memory
(async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  try {
    const html = wrapEmail('<p>Hi</p>', { company_name: 'Acme', logo: PNG });
    assert.match(html, /src="cid:company-logo"/);
    assert.ok(!html.includes('base64'), 'no data URL in the email body (Gmail blocks those)');
    assert.match(wrapEmail('<p>Hi</p>', { company_name: 'Acme', logo: PNG }, { inlineLogo: true }), /src="data:image\/png/);
    assert.ok(!wrapEmail('<p>Hi</p>', { company_name: 'Acme', logo: null }).includes('<img'));
    assert.ok(!wrapEmail('<p>Hi</p>', { company_name: 'Acme', logo: 'javascript:alert(1)' }).includes('<img'));
    const t = withLogo(nodemailer.createTransport({ streamTransport: true, buffer: true }), PNG);
    const info = (await t.sendMail({ from: 'a@acme.test', to: 'b@acme.test', subject: 's', html })) as { message: Buffer };
    const raw = info.message.toString();
    assert.match(raw, /Content-ID: <company-logo>/);
    assert.match(raw, /Content-Type: image\/png/);
    const plain = (await t.sendMail({ from: 'a@acme.test', to: 'b@acme.test', subject: 's', html: '<p>no logo here</p>' })) as { message: Buffer };
    assert.ok(!plain.message.toString().includes('company-logo'), 'logo attached only when the email shows it');
    passed++; console.log('  ok   emails show the organization logo from settings (inline image, Gmail-safe)');
  } catch (e) { console.error('  FAIL emails show the organization logo', '\n', e); process.exitCode = 1; }
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
