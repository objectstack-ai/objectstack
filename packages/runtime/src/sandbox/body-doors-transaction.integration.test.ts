// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook body sends no mail, and a body's timeline entry commits or rolls back
 * with the write that runs the body.
 *
 * Measured in composition: a real `ObjectQL`, a real SQLite driver (one
 * connection), the real hook wrapper and `QuickJSScriptRunner`. The timeline
 * writer is a stand-in that writes its entry through the engine as the
 * platform, under the transaction handle it is passed, as the activity feed's
 * own writer does (`app-activity-door.ts`, `@objectstack/plugin-audit`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine, openTransactionKind } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const TASK = { name: 'txd_task', fields: { title: { type: 'text', name: 'title' } } };
const ACCOUNT = { name: 'txd_account', fields: { name: { type: 'text', name: 'name' } } };
const ENTRY = { name: 'txd_entry', fields: { summary: { type: 'text', name: 'summary' } } };

describe('a body\'s door and the transaction of the write that runs it', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot(source: string, capabilities: string[]) {
    dir = mkdtempSync(join(tmpdir(), 'os-body-door-tx-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([TASK, ACCOUNT, ENTRY]);
    const e = new ObjectQL();
    engine = e;
    e.registerDriver(driver as any, true);
    await e.init();
    for (const o of [TASK, ACCOUNT, ENTRY]) e.registry.registerObject(o as any);
    const account = (await e.insert('txd_account', { name: 'Acme' }, { context: { isSystem: true } } as any)) as { id: string };

    const sent: unknown[] = [];
    const getService = (name: string): unknown => {
      if (name === 'email') {
        return {
          getDefaultFrom: () => ({ address: 'noreply@acme.test' }),
          send: async (input: unknown) => {
            sent.push(input);
            return { id: 'em_1', status: 'sent' };
          },
        };
      }
      if (name === 'audit') {
        return {
          appendAppActivity: async (entry: { summary: string }, _stamp: unknown, options?: { transaction?: unknown }) =>
            (await e.insert('txd_entry', { summary: entry.summary }, {
              context: { isSystem: true, ...(options?.transaction != null ? { transaction: options.transaction } : {}) },
            } as any)) as { id: string },
        };
      }
      return undefined;
    };
    const bodyRunner = hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: e, appId: 'txd', getService });
    const bound = bindHooksToEngine(
      e,
      [
        {
          name: 'on_task',
          object: 'txd_task',
          events: ['afterInsert'],
          body: { language: 'js', source: source.replace('ACCOUNT_ID', account.id), capabilities },
        } as any,
      ],
      { packageId: 'txd', bodyRunner },
    );
    return { e, sent, bound };
  }

  const ann = { userId: 'usr_ann', tenantId: 'org_acme', permissions: ['reader'] };
  const mail = "await ctx.email.send({ to: 'pat@example.test', subject: 'Task added', text: 'x' });";
  const entry = "await ctx.activity.append({ object: 'txd_account', recordId: 'ACCOUNT_ID', type: 'completed', summary: 'Task added' });";

  it('refuses to bind a hook body granted email.send, so its write sends no mail', async () => {
    const { e, sent, bound } = await boot(mail, ['email.send']);
    expect(bound.registered).toBe(0);
    expect(bound.errors.map((x) => x.reason)).toEqual([
      expect.stringContaining("Hook 'on_task' was not bound: its body is granted `email.send`"),
    ]);
    await e.insert('txd_task', { title: 'Call back' }, { context: ann } as any);
    expect(sent).toHaveLength(0);
  }, 30_000);

  it('sends no mail from a hook body whose write runs inside a transaction', async () => {
    const { e, sent } = await boot(mail, []);
    const err = await e
      .transaction(async (trx: any) => {
        await e.insert('txd_task', { title: 'Call back' }, { context: trx } as any);
      }, ann)
      .then(() => null, (x: unknown) => x);
    expect(String((err as Error | null)?.message ?? err)).toContain("capability 'email.send' not granted to hook 'on_task'");
    expect(sent).toHaveLength(0);
    expect(await e.find('txd_task', {})).toHaveLength(0);
  }, 30_000);

  it('keeps a timeline entry when the write that runs the body commits, and drops it when it rolls back', async () => {
    const { e } = await boot(entry, ['activity.append']);
    await e.transaction(async (trx: any) => {
      await e.insert('txd_task', { title: 'Kept' }, { context: trx } as any);
    }, ann);
    expect(await e.find('txd_entry', {})).toHaveLength(1);

    await e
      .transaction(async (trx: any) => {
        await e.insert('txd_task', { title: 'Dropped' }, { context: trx } as any);
        throw new Error('the caller gives up');
      }, ann)
      .catch(() => undefined);
    expect(await e.find('txd_entry', {})).toHaveLength(1);
    expect(await e.find('txd_task', {})).toHaveLength(1);
  }, 30_000);

  it('keeps a timeline entry when a write under a transaction handle commits, and drops it when it rolls back', async () => {
    const { e } = await boot(entry, ['activity.append']);
    const kept = await e.createContext(ann as any).beginTransaction();
    expect(kept, 'precondition: the driver opens transactions').not.toBeNull();
    await kept!.ctx.object('txd_task').insert({ title: 'Kept' });
    await e.createContext(ann as any).commitTransaction(kept!.handle);
    expect(await e.find('txd_entry', {})).toHaveLength(1);

    const dropped = await e.createContext(ann as any).beginTransaction();
    await dropped!.ctx.object('txd_task').insert({ title: 'Dropped' });
    await e.createContext(ann as any).rollbackTransaction(dropped!.handle);
    expect(await e.find('txd_entry', {})).toHaveLength(1);
    expect(await e.find('txd_task', {})).toHaveLength(1);
  }, 30_000);
});

describe('where a write stands with respect to a transaction, read off a real engine', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-open-tx-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([TASK]);
    const e = new ObjectQL();
    engine = e;
    e.registerDriver(driver as any, true);
    await e.init();
    e.registry.registerObject(TASK as any);
    return e;
  }

  const ann = { userId: 'usr_ann', tenantId: 'org_acme' };

  it('answers none outside a transaction, and joined inside the engine\'s own, carried or not', async () => {
    const e = await boot();
    expect(openTransactionKind(e)).toBe('none');
    const inside: string[] = [];
    let handle: unknown;
    await e.transaction(async (trx: any) => {
      handle = trx.transaction;
      inside.push(openTransactionKind(e), openTransactionKind(e, trx.transaction));
      await e.insert('txd_task', { title: 'Inside' }, { context: trx } as any);
      inside.push(openTransactionKind(e));
    }, ann);
    expect(inside).toEqual(['joined', 'joined', 'joined']);
    expect(openTransactionKind(e)).toBe('none');
    expect(openTransactionKind(e, handle)).toBe('none');
  }, 30_000);

  it('answers separate for an open handle the engine\'s own transaction does not hold', async () => {
    const e = await boot();
    const opened = await e.createContext(ann as any).beginTransaction();
    expect(opened, 'precondition: the driver opens transactions').not.toBeNull();
    expect(openTransactionKind(e, opened!.handle)).toBe('separate');
    await e.createContext(ann as any).rollbackTransaction(opened!.handle);
  }, 30_000);
});
