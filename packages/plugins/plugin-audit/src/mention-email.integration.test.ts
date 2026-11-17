// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An `@mention` reaches the mentioned person by e-mail as well as the inbox,
 * the e-mail can be muted per person, and a burst of mentions of one person
 * sends one e-mail (`mention-email.ts`).
 *
 * ## What is real
 *
 * `ObjectQL` over a real SQLite driver (`SqliteWasmDriver`, in-memory, real
 * DDL); the real mention writer (`installAuditWriters`, firing from the real
 * `afterInsert` on `sys_comment`); the real `MessagingServicePlugin` with its
 * durable outbox and dispatcher, its preference filter and its template tier,
 * holding the templates `AuditPlugin` registers (`MENTION_EMAIL_TEMPLATES`).
 *
 * ## The stand-ins
 *
 *  - the `email` service: a configured transport that records what it is
 *    handed, so what it holds is what was sent;
 *  - the recipient gate admits every mention (it is pinned in
 *    `mention-recipient-gate.integration.test.ts`);
 *  - the auth service's `getConsoleUrl`, which composes `${origin}/_console${path}`
 *    as its default `uiBasePath` does (the plugin's wiring of it is pinned in
 *    `mention-email.test.ts`).
 *
 * The clock is pinned (`Date` alone is faked) inside one 10-minute window, and
 * moved past it where a case says so.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { installAuditWriters, type MessagingEmitSurface } from './audit-writers.js';
import { MENTION_EMAIL_TEMPLATES, MENTION_EMAIL_WINDOW_MS } from './mention-email.js';
import { SysActivity, SysAuditLog, SysComment } from './objects/index.js';
import { AuditTranslations } from './translations/index.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const HARNESS_PACKAGE = 'com.objectstack.audit.test.mention-email';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const TASK = 'me_task';
const ORIGIN = 'https://app.example.test';
const ALICE = 'u_alice';
const CAROL = 'u_carol';
const DAVE = 'u_dave';
/** A mentioned person who reads in Simplified Chinese (`sys_user.locale`). */
const MEI = 'u_mei';
/** Each rig user's `sys_user.locale`, which the writer's title and the e-mail template both follow. */
const LOCALES: Record<string, string> = { [ALICE]: 'en', [CAROL]: 'en', [DAVE]: 'en', [MEI]: 'zh-CN' };
/** A moment in the middle of a window, so a burst within a minute stays in it. */
const WINDOW_START = Math.ceil(Date.UTC(2026, 10, 17, 9, 0) / MENTION_EMAIL_WINDOW_MS) * MENTION_EMAIL_WINDOW_MS;
const IN_WINDOW = WINDOW_START + 3 * 60_000;

interface Rig {
  engine: ObjectQL;
  sent: Array<Record<string, any>>;
  messaging: { registerBuiltinTemplates(t: readonly unknown[]): void };
  stop: () => Promise<void>;
}

let rig: Rig | undefined;

afterEach(async () => {
  try { await rig?.stop(); } catch { /* noop */ }
  rig = undefined;
  vi.useRealTimers();
});

async function boot(): Promise<Rig> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(IN_WINDOW);

  const engine = new ObjectQL();
  const driver = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  engine.registerDriver(driver, true);
  await engine.init();

  const register = (def: any) => engine.registry.registerObject(def, HARNESS_PACKAGE, HARNESS_PACKAGE);
  register({
    name: 'sys_user',
    label: 'User',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text', primaryKey: true },
      name: { name: 'name', label: 'Name', type: 'text' },
      email: { name: 'email', label: 'Email', type: 'text' },
      locale: { name: 'locale', label: 'Locale', type: 'text' },
    },
  });
  register({
    name: TASK,
    label: 'Task',
    fields: {
      id: { name: 'id', label: 'Id', type: 'text', primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' },
    },
  });
  // The ledger and timeline the same writers fill on every write here.
  register(SysComment);
  register(SysAuditLog);
  register(SysActivity);

  const sent: Array<Record<string, any>> = [];
  const logger: any = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
  logger.child = () => logger;
  const services: Record<string, unknown> = {
    objectql: engine,
    data: engine,
    manifest: { register: (m: any) => { for (const def of m.objects ?? []) register(def); } },
    email: { async send(input: any) { sent.push(input); return { id: `mail_${sent.length}` }; } },
  };
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
  await installDefaultOrganization(engine as any);
  for (const fn of readyHooks) await fn();

  const messaging = services.messaging as MessagingEmitSurface & { registerBuiltinTemplates(t: readonly unknown[]): void };
  // What AuditPlugin registers at kernel:ready.
  messaging.registerBuiltinTemplates(MENTION_EMAIL_TEMPLATES);

  const i18n = createMemoryI18n();
  for (const [locale, data] of Object.entries(AuditTranslations)) i18n.loadTranslations(locale, data as Record<string, unknown>);
  installAuditWriters(engine as any, HARNESS_PACKAGE, {
    getMessaging: () => messaging,
    getI18n: () => i18n as any,
    getLocale: async (_tenantId, userId) => (userId ? LOCALES[userId] : undefined) ?? 'en',
    admitMentionRecipients: async ({ mentions }) => [...mentions],
    getConsoleUrl: (path) => `${ORIGIN}/_console${path}`,
  });

  for (const [id, name] of [[ALICE, 'Alice'], [CAROL, 'Carol'], [DAVE, 'Dave'], [MEI, 'Mei']]) {
    await engine.insert('sys_user', { id, name, email: `${id}@example.com`, locale: LOCALES[id] }, { context: SYSTEM });
  }
  await engine.insert(TASK, { id: 't1', title: 'Launch plan' }, { context: SYSTEM });

  return {
    engine,
    sent,
    messaging,
    stop: async () => { await messagingPlugin.destroy?.(); },
  };
}

let seq = 0;
async function mention(engine: ObjectQL, mentions: string[], body = `note ${++seq}`): Promise<void> {
  await engine.insert('sys_comment', {
    thread_id: `${TASK}:t1`,
    body,
    author_id: ALICE,
    author_name: 'Alice',
    organization_id: DEFAULT_ORGANIZATION_ID,
    mentions: JSON.stringify(mentions),
  }, { context: SYSTEM });
}

async function deliveries(engine: ObjectQL): Promise<Array<Record<string, any>>> {
  return (await engine.find('sys_notification_delivery', { where: { topic: 'collab.mention' }, context: SYSTEM })) as any[];
}

/** Wait (real time) until every mention delivery left `pending` / `in_flight`. */
async function drained(engine: ObjectQL): Promise<Array<Record<string, any>>> {
  const deadline = performance.now() + 10_000;
  for (;;) {
    const rows = await deliveries(engine);
    if (rows.every((r) => r.status !== 'pending' && r.status !== 'in_flight')) return rows;
    if (performance.now() > deadline) throw new Error(`deliveries never drained: ${JSON.stringify(rows.map((r) => [r.channel, r.status]))}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const byChannel = (rows: Array<Record<string, any>>, recipient: string) =>
  rows.filter((r) => r.recipient_id === recipient).map((r) => `${r.channel}:${r.status}`).sort();

describe('an @mention reaches the mentioned person by e-mail as well as the inbox', () => {
  it('default: one inbox notice and one e-mail with the comment preview and an absolute link to the record', async () => {
    rig = await boot();
    await mention(rig.engine, [CAROL], 'Carol, can you review the launch plan?');

    const rows = await drained(rig.engine);
    expect(byChannel(rows, CAROL)).toEqual(['email:success', 'inbox:success']);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]).toMatchObject({ to: `${CAROL}@example.com`, subject: 'Alice mentioned you' });
    expect(rig.sent[0].text).toBe(
      `Carol, can you review the launch plan?\n\nOpen the comment: ${ORIGIN}/_console/${TASK}/t1`,
    );
    // The author is never notified, on either channel.
    expect(byChannel(rows, ALICE)).toEqual([]);
  });

  it('[#34729] a zh-CN reader gets the zh-CN subject and link line', async () => {
    rig = await boot();
    await mention(rig.engine, [MEI], '请看一下发布计划');

    const rows = await drained(rig.engine);
    expect(byChannel(rows, MEI)).toEqual(['email:success', 'inbox:success']);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]).toMatchObject({ to: `${MEI}@example.com`, subject: 'Alice 提到了你' });
    expect(rig.sent[0].text).toBe(`请看一下发布计划\n\n查看评论：${ORIGIN}/_console/${TASK}/t1`);
  });

  it('muted: a person whose collab.mention e-mail preference is off gets the inbox notice only', async () => {
    rig = await boot();
    await rig.engine.insert('sys_notification_preference', {
      user_id: CAROL,
      topic: 'collab.mention',
      channel: 'email',
      enabled: false,
      organization_id: DEFAULT_ORGANIZATION_ID,
    }, { context: SYSTEM });

    await mention(rig.engine, [CAROL, DAVE]);

    const rows = await drained(rig.engine);
    expect(byChannel(rows, CAROL)).toEqual(['inbox:success']);
    // DAVE, mentioned in the same comment with no preference, still gets both.
    expect(byChannel(rows, DAVE)).toEqual(['email:success', 'inbox:success']);
    expect(rig.sent.map((m) => m.to)).toEqual([`${DAVE}@example.com`]);
  });

  it('burst: three mentions of one person within the window are three inbox notices and one e-mail; the next window sends again', async () => {
    rig = await boot();
    await mention(rig.engine, [CAROL], 'first');
    vi.setSystemTime(IN_WINDOW + 60_000);
    await mention(rig.engine, [CAROL], 'second');
    vi.setSystemTime(IN_WINDOW + 2 * 60_000);
    await mention(rig.engine, [CAROL], 'third');

    let rows = await drained(rig.engine);
    expect(byChannel(rows, CAROL)).toEqual(['email:success', 'inbox:success', 'inbox:success', 'inbox:success']);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0].text).toMatch(/^first\n\n/);

    // The next window: the first mention there sends one more e-mail.
    vi.setSystemTime(WINDOW_START + MENTION_EMAIL_WINDOW_MS + 60_000);
    await mention(rig.engine, [CAROL], 'fourth');
    rows = await drained(rig.engine);
    expect(byChannel(rows, CAROL).filter((c) => c.startsWith('email:'))).toEqual(['email:success', 'email:success']);
    expect(rig.sent.map((m) => String(m.text).split('\n')[0])).toEqual(['first', 'fourth']);
  });

  it('the window is per person: a burst naming two people sends each of them one e-mail', async () => {
    rig = await boot();
    await mention(rig.engine, [CAROL, DAVE]);
    await mention(rig.engine, [CAROL, DAVE]);

    await drained(rig.engine);
    expect(rig.sent.map((m) => m.to).sort()).toEqual([`${CAROL}@example.com`, `${DAVE}@example.com`]);
  });
});
