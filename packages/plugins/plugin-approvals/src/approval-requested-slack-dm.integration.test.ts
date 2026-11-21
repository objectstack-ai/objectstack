// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34730 step 2] An approval request also reaches an approver who connected
 * Slack, by DM, carrying the e-mail's deep link.
 *
 * The real composition, end to end, as `approval-email-notification` drives
 * it: a real `ObjectQL` over `SqlDriver` (better-sqlite3) with the `secret`
 * channel wired, the real `MessagingServicePlugin` with its durable outbox and
 * dispatcher, the real `ApprovalsServicePlugin`, a recording `email`
 * transport, and connector-slack's real client service with Slack stubbed at
 * the HTTP boundary (`fetchImpl`). The organization installs its Slack app
 * and the approver links their Slack user through the link store.
 *
 *  - a confirmed link: a `slack` delivery reaches `success`, and Slack is
 *    asked for a DM with the linked user whose text links the request page at
 *    the same absolute URL the e-mail carries;
 *  - the approver muted `slack`, or is in quiet hours: no DM is sent;
 *  - a proposed link only, or none: inbox and e-mail only — no `slack` row at
 *    all, so nothing to dead-letter;
 *  - no connector-slack composed: the request does not ask for `slack`, so no
 *    refusal is logged on every request.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import { createSlackClientService } from '@objectstack/connector-slack';
import { MessagingServicePlugin, SlackLinkStore } from '@objectstack/service-messaging';
import type { CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'slackdm_invoice';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
const ORIGIN = 'https://app.example.test';
const TOKEN = 'xoxb-acme';

type Setup = 'confirmed' | 'proposed' | 'none' | 'muted' | 'quiet' | 'uncomposed';

/** Slack's Web API, stubbed at the HTTP boundary: every request it is sent, and Slack's answers. */
function slackHttp() {
  const requests: Array<{ method: string; auth: string; body: Record<string, any> }> = [];
  const answers: Record<string, Record<string, unknown>> = {
    'auth.test': { team_id: 'T1', team: 'Acme', user_id: 'UBOT' },
    'users.lookupByEmail': { user: { id: 'UAPPROVER', real_name: 'Ada Approver' } },
    'conversations.open': { channel: { id: 'D1' } },
    'chat.postMessage': { ts: '1700.1' },
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const method = String(url).replace('https://slack.com/api/', '').split('?')[0];
    requests.push({ method, auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, ...answers[method] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

/** Reversible test crypto: the stored form is a transform, never the token. */
const crypto: ICryptoProvider = {
  async encrypt(plain: string): Promise<CryptoHandle> {
    return { id: `sec_${plain.length}`, kmsKeyId: 'local', alg: 'test', version: 1, ciphertext: Buffer.from(plain).toString('base64') };
  },
  async decrypt(handle: CryptoHandle) { return Buffer.from(handle.ciphertext, 'base64').toString(); },
  async rotateKey(handle: CryptoHandle) { return handle; },
  digest: (plain: string) => `d:${plain.length}`,
  async keyedDigest(plain: string) { return `k:${plain.length}`; },
};

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  try { await stop?.(); } catch { /* noop */ }
  stop = undefined;
  vi.unstubAllEnvs();
});

async function boot(setup: Setup) {
  vi.stubEnv('OS_AUTH_URL', undefined);
  vi.stubEnv('BETTER_AUTH_URL', undefined);
  vi.stubEnv('OS_BASE_URL', ORIGIN);

  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  engine.setCryptoProvider(crypto);
  const sysUser = {
    name: 'sys_user', label: 'User',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      name: { name: 'name', label: 'Name', type: 'text' as const },
      email: { name: 'email', label: 'Email', type: 'text' as const },
      email_verified: { name: 'email_verified', label: 'Email Verified', type: 'boolean' as const },
      locale: { name: 'locale', label: 'Locale', type: 'text' as const },
    },
  };
  const invoice = { name: OBJECT, label: 'Invoice', fields: { id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true }, title: { name: 'title', label: 'Title', type: 'text' as const } } };
  const register = (def: any) => engine.registry.registerObject(def, 'approvals-slack-test', 'approvals-slack-test');
  for (const def of [sysUser, invoice, SysSecret, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken]) register(def);

  const slack = slackHttp();
  const sent: Array<Record<string, any>> = [];
  const warnings: string[] = [];
  const logger = { info: () => {}, debug: () => {}, warn: (m: string) => { warnings.push(String(m)); }, error: () => {}, child: () => logger };
  const services: Record<string, unknown> = {
    objectql: engine,
    data: engine,
    manifest: { register: (m: any) => { for (const def of m.objects ?? []) register(def); } },
    email: { async send(input: any) { sent.push(input); return { id: `mail_${sent.length}` }; } },
  };
  // connector-slack's client service, as ConnectorSlackPlugin registers it.
  if (setup !== 'uncomposed') services.slack = createSlackClientService({ fetchImpl: slack.fetchImpl });
  const readyHooks: Array<() => Promise<void> | void> = [];
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (event: string, fn: () => Promise<void> | void) => { if (event === 'kernel:ready') readyHooks.push(fn); },
    logger,
  };
  const messagingPlugin = new MessagingServicePlugin({ dispatchIntervalMs: 10, dispatchMaxIdleIntervalMs: 20 });
  await messagingPlugin.init(ctx);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const fn of readyHooks.splice(0)) await fn();
  stop = async () => { await messagingPlugin.destroy?.(); await engine.destroy(); };

  for (const [id, name] of [[SUBMITTER, 'Sam Submitter'], [APPROVER, 'Ada Approver']]) {
    await engine.insert('sys_user', { id, name, email: `${id}@example.com`, email_verified: true, locale: 'en' }, { context: SYSTEM } as any);
  }
  await engine.insert(OBJECT, { id: 'inv_1', title: 'March invoice' }, { context: SYSTEM } as any);

  // The organization's administrator installs Slack; the approver links their Slack user.
  const links = new SlackLinkStore({ getData: () => engine as any, getSlack: () => services.slack as any, notify: async () => undefined, logger });
  if (setup !== 'uncomposed') await links.install(DEFAULT_ORGANIZATION_ID, TOKEN, 'u_admin');
  if (setup !== 'none' && setup !== 'uncomposed') await links.propose(DEFAULT_ORGANIZATION_ID, APPROVER);
  if (setup !== 'none' && setup !== 'uncomposed' && setup !== 'proposed') await links.confirm(DEFAULT_ORGANIZATION_ID, APPROVER);
  const preference = (row: Record<string, unknown>) => engine.insert('sys_notification_preference',
    { id: `pref_${setup}`, organization_id: DEFAULT_ORGANIZATION_ID, user_id: APPROVER, ...row }, { context: SYSTEM } as any);
  if (setup === 'muted') await preference({ topic: '*', channel: 'slack', enabled: false });
  if (setup === 'quiet') await preference({ topic: '*', channel: '*', enabled: true, quiet_hours: { start: hhmm(Date.now() - 3_600_000), end: hhmm(Date.now() + 7_200_000) } });
  slack.requests.length = 0;

  await new ApprovalsServicePlugin().start(ctx);
  const opened: any = await (services.approvals as any).openNodeRequest({
    object: OBJECT, recordId: 'inv_1', runId: 'run_1', nodeId: 'signoff', flowName: 'slack_signoff',
    config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
    submitterId: SUBMITTER, record: { id: 'inv_1', title: 'March invoice' },
  }, asUser(SUBMITTER));

  const deliveries = async () => (await driver.getKnex()('sys_notification_delivery').where({ topic: 'approval.requested' }).select('*')) as any[];
  const link = `${ORIGIN}/system/approvals?request=${encodeURIComponent(String(opened.id))}`;
  return { slack, sent, deliveries, link, warnings };
}

/** The deliveries once none is waiting in the outbox. */
async function settled(deliveries: () => Promise<any[]>) {
  let rows: any[] = [];
  await vi.waitFor(async () => {
    rows = await deliveries();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((d) => d.status === 'pending' || d.status === 'in_flight')).toEqual([]);
  }, { timeout: 5000, interval: 25 });
  return rows.map((d) => `${d.channel}:${d.recipient_id}:${d.status}`).sort();
}

describe('an approval request reaches a linked approver by Slack DM (#34730)', () => {
  it('a confirmed link: a DM to the linked user, with the organization\'s token, linking the e-mail\'s link', async () => {
    const t = await boot('confirmed');
    expect(await settled(t.deliveries)).toEqual([`email:${APPROVER}:success`, `inbox:${APPROVER}:success`, `slack:${APPROVER}:success`]);
    expect(t.slack.requests.map((r) => r.method)).toEqual(['conversations.open', 'chat.postMessage']);
    expect(t.slack.requests.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(t.slack.requests[0].body).toEqual({ users: 'UAPPROVER' });
    const dm = t.slack.requests[1].body;
    expect(dm).toMatchObject({ channel: 'D1', unfurl_links: false });
    expect(dm.text).toMatch(new RegExp(`^\\*<${t.link.replace(/[.?]/g, '\\$&')}\\|Approval requested>\\*\\nA decision on Invoice .+ is waiting on you\\.$`));
    // The same link the e-mail carries.
    const mail = t.sent.find((m) => m.to === `${APPROVER}@example.com`);
    expect(String(mail?.text).endsWith(`Open the approval: ${t.link}`)).toBe(true);
  });

  it('the approver muted slack: inbox and e-mail, no DM', async () => {
    const t = await boot('muted');
    expect(await settled(t.deliveries)).toEqual([`email:${APPROVER}:success`, `inbox:${APPROVER}:success`]);
    expect(t.slack.requests).toEqual([]);
  });

  it('the approver is in quiet hours: the DM is held, not sent', async () => {
    const t = await boot('quiet');
    await vi.waitFor(async () => expect((await t.deliveries()).map((d) => d.channel).sort()).toEqual(['email', 'inbox', 'slack']));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const slackRow = (await t.deliveries()).find((d) => d.channel === 'slack');
    expect(slackRow.status).toBe('pending');
    expect(Number(slackRow.next_attempt_at)).toBeGreaterThan(Date.now());
    expect(t.slack.requests).toEqual([]);
  });

  it.each(['proposed', 'none'] as const)('a %s link: inbox and e-mail only — no slack row, nothing dead-lettered', async (setup) => {
    const t = await boot(setup);
    expect(await settled(t.deliveries)).toEqual([`email:${APPROVER}:success`, `inbox:${APPROVER}:success`]);
    expect(t.slack.requests).toEqual([]);
  });

  it('a composition without connector-slack: the request does not ask for slack, so nothing is refused or logged', async () => {
    const t = await boot('uncomposed');
    expect(await settled(t.deliveries)).toEqual([`email:${APPROVER}:success`, `inbox:${APPROVER}:success`]);
    expect(t.warnings.filter((w) => w.includes("'slack'"))).toEqual([]);
  });
});
