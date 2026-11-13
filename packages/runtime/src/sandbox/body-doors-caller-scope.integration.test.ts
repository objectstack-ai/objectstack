// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook body's door reads the record it points at in the scope of the user
 * whose write fired the hook: that write's own grants, never the system's.
 *
 * Measured in composition: a real `ObjectQL`, a real SQLite driver, the real
 * hook wrapper and `QuickJSScriptRunner`. The pointed-at object is guarded by
 * an engine middleware that stands in for the authorization door: it lets a
 * read through only for a context that carries the `account_reader` grant and
 * is not the system, and records every context it judged.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const TASK = { name: 'door_task', fields: { title: { type: 'text', name: 'title' } } };
const ACCOUNT = { name: 'door_account', fields: { name: { type: 'text', name: 'name' } } };

describe('a hook body\'s door reads in the scope of the user whose write fired it', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-body-door-scope-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([TASK, ACCOUNT]);
    engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    for (const o of [TASK, ACCOUNT]) engine.registry.registerObject(o as any);
    const account = (await engine.insert('door_account', { name: 'Acme' }, { context: { isSystem: true } } as any)) as { id: string };

    const judged: Array<Record<string, unknown>> = [];
    engine.registerMiddleware(
      async (op, next) => {
        if (op.operation === 'findOne' || op.operation === 'find') {
          const context = (op.context ?? {}) as Record<string, unknown>;
          judged.push(context);
          const grants = Array.isArray(context.permissions) ? (context.permissions as string[]) : [];
          if (context.isSystem === true || !grants.includes('account_reader')) {
            throw Object.assign(new Error('not readable'), { code: 'PERMISSION_DENIED', statusCode: 403 });
          }
        }
        await next();
      },
      { object: 'door_account' },
    );

    const appended: Array<{ entry: any; stamp: any }> = [];
    const getService = (name: string): unknown =>
      name === 'audit'
        ? {
            appendAppActivity: async (entry: unknown, stamp: unknown) => {
              appended.push({ entry, stamp });
              return { id: 'act_1' };
            },
          }
        : undefined;
    const bodyRunner = hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'door', getService });
    bindHooksToEngine(
      engine,
      [
        {
          name: 'note_on_account',
          object: 'door_task',
          events: ['afterInsert'],
          body: {
            language: 'js',
            source: `await ctx.activity.append({ object: 'door_account', recordId: '${account.id}', type: 'completed', summary: 'Task added' });`,
            capabilities: ['activity.append'],
          },
        } as any,
      ],
      { packageId: 'door', bodyRunner },
    );
    return { e: engine, accountId: account.id, judged, appended };
  }

  const ann = { userId: 'usr_ann', tenantId: 'org_acme', positions: ['member'] };

  it('reads with the grants the write carried, so a record readable through an assigned permission set is found', async () => {
    const { e, judged, appended } = await boot();
    await e.insert('door_task', { title: 'Call back' }, { context: { ...ann, permissions: ['account_reader'] } } as any);
    expect(appended).toHaveLength(1);
    expect(appended[0].stamp).toMatchObject({ actorId: 'usr_ann', organizationId: 'org_acme' });
    expect(judged.at(-1)).toMatchObject({ userId: 'usr_ann', permissions: ['account_reader'] });
  }, 30_000);

  it('reads as the user, not as the system, when the write that fired the hook ran elevated', async () => {
    const { e, judged, appended } = await boot();
    await e.insert('door_task', { title: 'Call back' }, { context: { ...ann, permissions: ['account_reader'], isSystem: true } } as any);
    expect(appended).toHaveLength(1);
    expect(judged.at(-1)?.isSystem).not.toBe(true);
  }, 30_000);

  it('refuses a record the user cannot read, and writes nothing', async () => {
    const { e, appended } = await boot();
    const err = await e
      .insert('door_task', { title: 'Call back' }, { context: { ...ann, permissions: ['other_set'], isSystem: true } } as any)
      .then(() => null, (x) => x);
    expect(String(err?.message ?? err)).toContain("no 'door_account' record");
    expect(appended).toHaveLength(0);
  }, 30_000);
});
