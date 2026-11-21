// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36074] A reply in a comment thread notifies the thread's starter and its
 * earlier repliers — inbox and e-mail, the mention notice's shape under the
 * `collab.reply` topic (`audit-writers.ts`, `writeCommentReplyNotices`).
 *
 * ## What is real
 *
 * The rig of `mention-email.integration.test.ts`: `ObjectQL` over a real
 * SQLite driver (so the participants' grouped read runs as SQL), the real
 * writers firing from the real `afterInsert` / `afterUpdate` on `sys_comment`,
 * and the real `MessagingServicePlugin` with its outbox, dispatcher,
 * preference filter and template tier holding both template sets.
 *
 * ## The stand-ins
 *
 *  - the `email` service: a transport that records what it is handed;
 *  - the recipient gate admits every candidate (who it withholds is pinned in
 *    `mention-recipient-gate.integration.test.ts`, which asks the reply of the
 *    real gate);
 *  - the auth service's `getConsoleUrl`.
 *
 * The clock is pinned (`Date` alone is faked) inside one 10-minute window.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { installAuditWriters, type MessagingEmitSurface } from './audit-writers.js';
import { MENTION_EMAIL_TEMPLATES, MENTION_EMAIL_WINDOW_MS, REPLY_EMAIL_TEMPLATES } from './mention-email.js';
import { SysActivity, SysAuditLog, SysComment } from './objects/index.js';
import { AuditTranslations } from './translations/index.js';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const HARNESS_PACKAGE = 'com.objectstack.audit.test.reply-notice';
const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const TASK = 'rn_task';
const ORIGIN = 'https://app.example.test';
const ALICE = 'u_alice';
const CAROL = 'u_carol';
const DAVE = 'u_dave';
const BOB = 'u_bob';
/** A participant who reads in Simplified Chinese (`sys_user.locale`). */
const MEI = 'u_mei';
/** Each rig user's `sys_user.locale`, which the writer's title and the e-mail template both follow. */
const LOCALES: Record<string, string> = { [ALICE]: 'en', [BOB]: 'en', [CAROL]: 'en', [DAVE]: 'en', [MEI]: 'zh-CN' };
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
  messaging.registerBuiltinTemplates(REPLY_EMAIL_TEMPLATES);

  const i18n = createMemoryI18n();
  for (const [locale, data] of Object.entries(AuditTranslations)) i18n.loadTranslations(locale, data as Record<string, unknown>);
  installAuditWriters(engine as any, HARNESS_PACKAGE, {
    getMessaging: () => messaging,
    getI18n: () => i18n as any,
    getLocale: async (_tenantId, userId) => (userId ? LOCALES[userId] : undefined) ?? 'en',
    admitMentionRecipients: async ({ mentions }) => [...mentions],
    getConsoleUrl: (path) => `${ORIGIN}/_console${path}`,
  });

  for (const [id, name] of [[ALICE, 'Alice'], [BOB, 'Bob'], [CAROL, 'Carol'], [DAVE, 'Dave'], [MEI, 'Mei']]) {
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
/** `author` writes a comment on the task (a reply when `parentId` is given); its id. */
async function say(
  engine: ObjectQL,
  author: string,
  opts: { parentId?: string; mentions?: string[]; body?: string } = {},
): Promise<string> {
  const row: any = await engine.insert('sys_comment', {
    thread_id: `${TASK}:t1`,
    body: opts.body ?? `note ${++seq}`,
    author_id: author,
    author_name: author.slice(2, 3).toUpperCase() + author.slice(3),
    organization_id: DEFAULT_ORGANIZATION_ID,
    mentions: JSON.stringify(opts.mentions ?? []),
    ...(opts.parentId ? { parent_id: opts.parentId } : {}),
  }, { context: SYSTEM });
  return String(row.id);
}

async function deliveries(engine: ObjectQL, topic: string): Promise<Array<Record<string, any>>> {
  return (await engine.find('sys_notification_delivery', { where: { topic }, context: SYSTEM })) as any[];
}

/** Wait (real time) until every reply and mention delivery left `pending` / `in_flight`. */
async function drained(engine: ObjectQL): Promise<{ reply: Array<Record<string, any>>; mention: Array<Record<string, any>> }> {
  const deadline = performance.now() + 10_000;
  for (;;) {
    const reply = await deliveries(engine, 'collab.reply');
    const mention = await deliveries(engine, 'collab.mention');
    if ([...reply, ...mention].every((r) => r.status !== 'pending' && r.status !== 'in_flight')) return { reply, mention };
    if (performance.now() > deadline) throw new Error('deliveries never drained');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const byChannel = (rows: Array<Record<string, any>>, recipient: string) =>
  rows.filter((r) => r.recipient_id === recipient).map((r) => `${r.channel}:${r.status}`).sort();

describe('a reply notifies the thread\'s starter and earlier repliers', () => {
  it('Alice comments, Bob replies: Alice gets one inbox notice and one e-mail that open the record; Bob gets nothing', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE, { body: 'Is the launch plan final?' });
    await say(rig.engine, BOB, { parentId: root, body: 'Not yet, two items left.' });

    const { reply } = await drained(rig.engine);
    expect(byChannel(reply, ALICE)).toEqual(['email:success', 'inbox:success']);
    expect(byChannel(reply, BOB)).toEqual([]);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]).toMatchObject({ to: `${ALICE}@example.com`, subject: 'Bob replied to your comment' });
    expect(rig.sent[0].text).toBe(`Not yet, two items left.\n\nOpen the comment: ${ORIGIN}/_console/${TASK}/t1`);
  });

  it('Alice comments, Bob replies, Carol replies: Alice and Bob get one notice each, Carol none', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE);
    await say(rig.engine, BOB, { parentId: root });
    await drained(rig.engine);
    rig.sent.length = 0;
    vi.setSystemTime(WINDOW_START + MENTION_EMAIL_WINDOW_MS + 60_000); // a fresh e-mail window

    await say(rig.engine, CAROL, { parentId: root, body: 'Agreed.' });
    const { reply } = await drained(rig.engine);
    // Alice: one from Bob's reply, one from Carol's (two windows → two e-mails).
    expect(byChannel(reply, ALICE)).toEqual(['email:success', 'email:success', 'inbox:success', 'inbox:success']);
    expect(byChannel(reply, BOB)).toEqual(['email:success', 'inbox:success']);
    expect(byChannel(reply, CAROL)).toEqual([]);
    expect(rig.sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      [`${ALICE}@example.com`, 'Carol replied to your comment'],
      [`${BOB}@example.com`, 'Carol replied in a comment thread you are in'],
    ]);
  });

  it('a reply that mentions the starter gives them the mention notice only, not a second one', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE);
    await say(rig.engine, BOB, { parentId: root, mentions: [ALICE] });

    const { reply, mention } = await drained(rig.engine);
    expect(byChannel(mention, ALICE)).toEqual(['email:success', 'inbox:success']);
    expect(byChannel(reply, ALICE)).toEqual([]);
    expect(rig.sent.map((m) => m.subject)).toEqual(['Bob mentioned you']);
  });

  it('a reader of zh-CN gets the zh-CN title and link line', async () => {
    rig = await boot();
    const root = await say(rig.engine, MEI);
    await say(rig.engine, BOB, { parentId: root, body: '已更新' });

    await drained(rig.engine);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]).toMatchObject({ to: `${MEI}@example.com`, subject: 'Bob 回复了你的评论' });
    expect(rig.sent[0].text).toBe(`已更新\n\n查看评论：${ORIGIN}/_console/${TASK}/t1`);
  });

  it('burst: three replies within the window are three inbox notices and one e-mail to the starter', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE);
    await say(rig.engine, BOB, { parentId: root, body: 'first' });
    vi.setSystemTime(IN_WINDOW + 60_000);
    await say(rig.engine, BOB, { parentId: root, body: 'second' });
    vi.setSystemTime(IN_WINDOW + 2 * 60_000);
    await say(rig.engine, BOB, { parentId: root, body: 'third' });

    const { reply } = await drained(rig.engine);
    expect(byChannel(reply, ALICE)).toEqual(['email:success', 'inbox:success', 'inbox:success', 'inbox:success']);
    expect(rig.sent.map((m) => String(m.text).split('\n')[0])).toEqual(['first']);
  });

  it('the reply e-mail window does not hold back a mention e-mail in the same window', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE);
    await say(rig.engine, BOB, { parentId: root });
    vi.setSystemTime(IN_WINDOW + 60_000);
    await say(rig.engine, CAROL, { mentions: [ALICE] });

    await drained(rig.engine);
    expect(rig.sent.map((m) => m.subject).sort()).toEqual(['Bob replied to your comment', 'Carol mentioned you']);
  });

  it('muted: a collab.reply e-mail preference off leaves the inbox notice', async () => {
    rig = await boot();
    await rig.engine.insert('sys_notification_preference', {
      user_id: ALICE,
      topic: 'collab.reply',
      channel: 'email',
      enabled: false,
      organization_id: DEFAULT_ORGANIZATION_ID,
    }, { context: SYSTEM });
    const root = await say(rig.engine, ALICE);
    await say(rig.engine, BOB, { parentId: root });

    const { reply } = await drained(rig.engine);
    expect(byChannel(reply, ALICE)).toEqual(['inbox:success']);
    expect(rig.sent).toEqual([]);
  });

  it('a top-level comment and an edit of a reply notify no participant', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE);
    await say(rig.engine, BOB); // a second top-level comment on the same record
    const replyId = await say(rig.engine, CAROL, { parentId: root });
    await drained(rig.engine);
    const before = (await deliveries(rig.engine, 'collab.reply')).length;
    expect(before).toBeGreaterThan(0);

    await rig.engine.update('sys_comment', { body: 'edited' }, { where: { id: replyId }, context: SYSTEM } as any);
    const { reply } = await drained(rig.engine);
    expect(reply).toHaveLength(before);
    // Bob only commented beside the thread, never in it.
    expect(byChannel(reply, BOB)).toEqual([]);
  });

  it('a reply to a reply walks up to the starter: everyone up the chain and every replier is a participant', async () => {
    rig = await boot();
    const root = await say(rig.engine, ALICE);
    const bobs = await say(rig.engine, BOB, { parentId: root });
    await say(rig.engine, DAVE, { parentId: root });
    await drained(rig.engine);
    rig.sent.length = 0;
    vi.setSystemTime(WINDOW_START + MENTION_EMAIL_WINDOW_MS + 60_000);

    await say(rig.engine, CAROL, { parentId: bobs });
    await drained(rig.engine);
    expect(rig.sent.map((m) => [m.to, m.subject]).sort()).toEqual([
      [`${ALICE}@example.com`, 'Carol replied to your comment'],
      [`${BOB}@example.com`, 'Carol replied in a comment thread you are in'],
      [`${DAVE}@example.com`, 'Carol replied in a comment thread you are in'],
    ]);
    expect(byChannel((await drained(rig.engine)).reply, CAROL)).toEqual([]);
  });
});
