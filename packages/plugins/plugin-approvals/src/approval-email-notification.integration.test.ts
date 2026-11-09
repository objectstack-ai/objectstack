// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30509] An approval's own notices also go by e-mail, linking to the
 * request page (objectstack-ai/cloud#2549 ruling B, item ②; the template's
 * location is the ruling recorded on #30509).
 *
 * ## The defect
 *
 * `notify()` emitted with no `channels`, and messaging defaults that to the
 * in-app inbox alone, so an approval request, its reminder and its outcome
 * reached nobody who does not watch the Console bell.
 *
 * ## What this pins
 *
 * The real composition, end to end: a real `ObjectQL` over `SqlDriver`
 * (better-sqlite3, in-memory, real DDL), the real `MessagingServicePlugin`
 * with its durable outbox and dispatcher, the real `ApprovalsServicePlugin`,
 * and an `email` service whose transport records what it is handed — a
 * configured (test) transport. The deployment's address comes from
 * `OS_BASE_URL`, as an unconfigured `publicBaseUrl` option resolves it.
 *
 *  - opening a step, the submitter's reminder and the outcome each leave an
 *    `email` delivery row that reached `success` beside the `inbox` one, and
 *    a sent message whose subject is the notice's title and whose text is its
 *    body plus the request page's ABSOLUTE link;
 *  - the inbox row still links relatively (`actionUrl`), as the Console routes;
 *  - ⛔ no stored row of any table, and no message sent, holds an ADR-0043
 *    action link or token (#24564's storage axis, the same reading
 *    `reminder-action-link-at-rest` takes);
 *  - an approval topic outside the four (a comment) stays inbox-only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import type { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { SysApprovalToken } from './sys-approval-token.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'mailrest_invoice';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const SUBMITTER = 'u_submitter';
const APPROVER = 'u_approver';
const ORIGIN = 'https://app.example.test';
/** What an ADR-0043 action-page link looks like in any spelling a row could hold it. */
const ACTION_LINK = /\/approvals\/act|[?&]token=/;

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  svc: ApprovalService;
  sent: Array<Record<string, any>>;
  requestId: string;
  stop: () => Promise<void>;
}

let rig: Rig | undefined;

afterEach(async () => {
  try { await rig?.stop(); } catch { /* noop */ }
  rig = undefined;
  vi.unstubAllEnvs();
});

async function boot(): Promise<Rig> {
  vi.stubEnv('OS_AUTH_URL', undefined);
  vi.stubEnv('BETTER_AUTH_URL', undefined);
  vi.stubEnv('OS_BASE_URL', ORIGIN);

  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();

  const sysUser = {
    name: 'sys_user',
    label: 'User',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      name: { name: 'name', label: 'Name', type: 'text' as const },
      email: { name: 'email', label: 'Email', type: 'text' as const },
      locale: { name: 'locale', label: 'Locale', type: 'text' as const },
    },
  };
  const invoice = {
    name: OBJECT,
    label: 'Invoice',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
    },
  };
  const register = (def: any) => engine.registry.registerObject(def, 'approvals-email-test', 'approvals-email-test');
  for (const def of [sysUser, invoice, SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysApprovalDelegation, SysApprovalToken]) {
    register(def);
  }

  const sent: Array<Record<string, any>> = [];
  const logger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, child: () => logger };
  const services: Record<string, unknown> = {
    objectql: engine,
    data: engine,
    // The messaging plugin declares its objects through the manifest service.
    manifest: { register: (m: any) => { for (const def of m.objects ?? []) register(def); } },
    // A configured transport: what it is handed is what was sent.
    email: { async send(input: any) { sent.push(input); return { id: `mail_${sent.length}` }; } },
  };
  const readyHooks: Array<() => Promise<void> | void> = [];
  let collectReady = true;
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (event: string, fn: () => Promise<void> | void) => { if (collectReady && event === 'kernel:ready') readyHooks.push(fn); },
    logger,
  };

  const messagingPlugin = new MessagingServicePlugin({ dispatchIntervalMs: 10, dispatchMaxIdleIntervalMs: 20 });
  await messagingPlugin.init(ctx);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const fn of readyHooks) await fn();
  collectReady = false;

  for (const [id, name] of [[SUBMITTER, 'Sam Submitter'], [APPROVER, 'Ada Approver']]) {
    await engine.insert('sys_user', { id, name, email: `${id}@example.com`, locale: 'en' }, { context: SYSTEM } as any);
  }
  await engine.insert(OBJECT, { id: 'inv_1', title: 'March invoice' }, { context: SYSTEM } as any);

  await new ApprovalsServicePlugin().start(ctx);
  const svc = services.approvals as ApprovalService;

  const opened: any = await svc.openNodeRequest({
    object: OBJECT, recordId: 'inv_1', runId: 'run_1', nodeId: 'signoff', flowName: 'mail_signoff',
    config: { approvers: [{ type: 'user', value: APPROVER }], behavior: 'first_response' } as any,
    submitterId: SUBMITTER, record: { id: 'inv_1', title: 'March invoice' },
  }, asUser(SUBMITTER));

  return {
    engine, driver, svc, sent, requestId: String(opened.id),
    stop: async () => {
      await messagingPlugin.destroy?.();
      await engine.destroy();
    },
  };
}

async function deliveries(r: Rig, topic: string): Promise<Array<Record<string, any>>> {
  return (await r.driver.getKnex()('sys_notification_delivery').where({ topic }).select('*')) as Array<Record<string, any>>;
}

/** The topic's deliveries once every one of them has left the outbox's queue. */
async function settled(r: Rig, topic: string): Promise<Array<Record<string, any>>> {
  let rows: Array<Record<string, any>> = [];
  await vi.waitFor(async () => {
    rows = await deliveries(r, topic);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((d) => d.status === 'pending' || d.status === 'in_flight')).toEqual([]);
  }, { timeout: 5000, interval: 25 });
  return rows;
}

const mailTo = (r: Rig, userId: string, subject: string) =>
  r.sent.filter((m) => m.to === `${userId}@example.com` && m.subject === subject);

describe('approval notices also go by e-mail, linking to the request page (#30509)', () => {
  it('opening a step e-mails each approver: an email delivery row, the title, the body and the absolute link', async () => {
    rig = await boot();
    const link = `${ORIGIN}/system/approvals?request=${encodeURIComponent(rig.requestId)}`;

    const rows = await settled(rig, 'approval.requested');
    expect(rows.map((d) => `${d.channel}:${d.recipient_id}:${d.status}`).sort()).toEqual([
      `email:${APPROVER}:success`,
      `inbox:${APPROVER}:success`,
    ]);

    const mails = mailTo(rig, APPROVER, 'Approval requested');
    expect(mails).toHaveLength(1);
    const text = String(mails[0].text);
    // The inbox keeps the relative deep link the Console routes on, and the
    // e-mail says what the inbox says, then links to the same request.
    const inbox = (await rig.driver.getKnex()('sys_inbox_message').where({ user_id: APPROVER }).select('*')) as any[];
    expect(inbox.map((m) => m.action_url)).toEqual([`/system/approvals?request=${encodeURIComponent(rig.requestId)}`]);
    expect(inbox[0].title).toBe('Approval requested');
    expect(inbox[0].body_md).toMatch(/^A decision on Invoice .+ is waiting on you\.$/);
    expect(text).toBe(`${inbox[0].body_md}\n\nOpen the approval: ${link}`);
  });

  it("the submitter's reminder and the outcome go by e-mail too, with the same link", async () => {
    rig = await boot();
    const link = `${ORIGIN}/system/approvals?request=${encodeURIComponent(rig.requestId)}`;
    await settled(rig, 'approval.requested');

    await rig.svc.remind(rig.requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));
    const reminders = await settled(rig, 'approval.reminder');
    expect(reminders.map((d) => `${d.channel}:${d.recipient_id}:${d.status}`).sort()).toEqual([
      `email:${APPROVER}:success`,
      `inbox:${APPROVER}:success`,
    ]);
    const reminderMail = mailTo(rig, APPROVER, 'Approval reminder');
    expect(reminderMail).toHaveLength(1);
    expect(String(reminderMail[0].text).endsWith(`Open the approval: ${link}`)).toBe(true);

    await rig.svc.decide(rig.requestId, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    const outcomes = await settled(rig, 'approval.approved');
    expect(outcomes.map((d) => `${d.channel}:${d.recipient_id}:${d.status}`).sort()).toEqual([
      `email:${SUBMITTER}:success`,
      `inbox:${SUBMITTER}:success`,
    ]);
    const outcomeMail = mailTo(rig, SUBMITTER, 'Request approved');
    expect(outcomeMail).toHaveLength(1);
    expect(String(outcomeMail[0].text).endsWith(`Open the approval: ${link}`)).toBe(true);
  });

  it('a rejection e-mails the submitter, with the decider\'s comment in the body', async () => {
    rig = await boot();
    await settled(rig, 'approval.requested');
    await rig.svc.decide(rig.requestId, { decision: 'reject', actorId: APPROVER, comment: 'Wrong cost centre' }, asUser(APPROVER));
    const rows = await settled(rig, 'approval.rejected');
    expect(rows.map((d) => `${d.channel}:${d.recipient_id}:${d.status}`).sort()).toEqual([
      `email:${SUBMITTER}:success`,
      `inbox:${SUBMITTER}:success`,
    ]);
    const mail = mailTo(rig, SUBMITTER, 'Request rejected');
    expect(mail).toHaveLength(1);
    expect(String(mail[0].text)).toContain('Wrong cost centre');
  });

  it('an approval topic outside the four stays inbox-only', async () => {
    rig = await boot();
    await settled(rig, 'approval.requested');
    await rig.svc.comment(rig.requestId, { actorId: SUBMITTER, comment: 'Any news?' } as any, asUser(SUBMITTER));
    const rows = await settled(rig, 'approval.comment');
    expect(new Set(rows.map((d) => d.channel))).toEqual(new Set(['inbox']));
  });

  it('⛔ no stored row of any table, and no message sent, holds an ADR-0043 action link or token', async () => {
    rig = await boot();
    await settled(rig, 'approval.requested');
    await rig.svc.remind(rig.requestId, { actorId: SUBMITTER }, asUser(SUBMITTER));
    await settled(rig, 'approval.reminder');
    await rig.svc.decide(rig.requestId, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    await settled(rig, 'approval.approved');

    // Not vacuous: three e-mails went, and the stored notification rows carry the request link.
    expect(rig.sent).toHaveLength(3);
    const knex = rig.driver.getKnex();
    const tables = (await knex('sqlite_master').where({ type: 'table' }).select('name')) as Array<{ name: string }>;
    const leaks: string[] = [];
    let linkRows = 0;
    for (const { name } of tables) {
      if (name.startsWith('sqlite_')) continue;
      for (const row of (await knex(name).select('*')) as Array<Record<string, unknown>>) {
        const text = JSON.stringify(row);
        if (text.includes('/system/approvals?request=')) linkRows++;
        if (ACTION_LINK.test(text)) leaks.push(`${name}: ${text}`);
      }
    }
    expect(linkRows).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
    expect(rig.sent.filter((m) => ACTION_LINK.test(JSON.stringify(m)))).toEqual([]);
  });
});
