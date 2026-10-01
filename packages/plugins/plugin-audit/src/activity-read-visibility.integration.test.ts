// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_activity` read visibility, on the plugin's READ PATH.
 *
 * A caller holding object-level `sys_activity` read gets back only the
 * activity rows whose parent record (`object_name`, `record_id`) it can read,
 * the same way `installCommentReadVisibility` narrows `sys_comment`. An admin
 * is the caller who can read every record, so it keeps every row about a
 * record that exists.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The narrowing is a WHERE the gate ANDs into the caller's query. Whether that
 * WHERE selects the right rows is a question about the Filter Protocol as a
 * driver executes it (`$or` over two columns, `$in`, `count`, `aggregate`), not
 * about the shape of an object, so the rows below are written by the real
 * audit writer (the CRUD mirror is the platform's own producer of these rows),
 * stored by a real SQLite driver and read back through the real engine
 * middleware chain. The gate is mounted by `AuditPlugin` itself at
 * `kernel:ready`, so a gate that stops being mounted fails here exactly like a
 * gate that was never written.
 *
 * ## The one stand-in, and why it is the smallest honest one
 *
 * PARENT READABILITY. In a deployment the parent object's own sharing, RLS and
 * object-level CRUD decide whether a caller can read a record; the gate only
 * ever asks the engine, under the caller's context. Here one engine middleware
 * on the owned parent object plays that part: a member reads the ledger rows
 * it owns, the admin reads them all. The gate cannot tell it apart from
 * plugin-security because it asks the same question the same way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';

const ACTIVITY = 'sys_activity';
/** A parent object whose rows each caller reads only when it owns them. */
const OWNED = 'act_ledger';
/** A parent object every caller reads. */
const OPEN = 'act_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-read';

const SYS = { isSystem: true } as const;
const MEMBER = { userId: 'u_member', tenantId: 'org_1', positions: ['org_member'] };
const OTHER = { userId: 'u_other', tenantId: 'org_1', positions: ['org_member'] };
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };

const ownedObject = {
  name: OWNED,
  label: 'Ledger',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    owner: { name: 'owner', label: 'Owner', type: 'text' as const },
  },
};
const openObject = {
  name: OPEN,
  label: 'Board',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);

/** Parent-object read operations issued under a caller (non-system) context. */
const parentProbes: Array<{ object: string; operation: string; userId?: string }> = [];

type Row = Record<string, any>;
const pair = (r: Row) => `${r.object_name ?? 'NULL'}/${r.record_id ?? 'NULL'}`;
const pairs = (rows: Row[]) => rows.map(pair).sort();

describe('sys_activity read visibility — the plugin read path', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};
  let allRows: Row[] = [];

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(ownedObject as any, HARNESS_PACKAGE);
    engine.registry.registerObject(openObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    // Parent readability: a non-admin caller reads the ledger rows it owns.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) {
        parentProbes.push({ object: op.object, operation: op.operation, userId: op.context.userId });
        if (op.context.userId !== ADMIN.userId && op.ast) {
          const mine = { owner: op.context.userId ?? '__nobody__' };
          op.ast.where = op.ast.where ? { $and: [op.ast.where, mine] } : mine;
        }
      }
      return next();
    }, { object: OWNED });
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem) {
        parentProbes.push({ object: op.object, operation: op.operation, userId: op.context.userId });
      }
      return next();
    }, { object: OPEN });

    // Every row below is written by the real audit writer's CRUD mirror.
    ids.mine = (await engine.insert(OWNED, { name: 'mine', owner: MEMBER.userId }, { context: SYS })).id;
    ids.theirs = (await engine.insert(OWNED, { name: 'theirs', owner: OTHER.userId }, { context: SYS })).id;
    await engine.update(OWNED, { name: 'theirs, renamed' }, { where: { id: ids.theirs }, context: SYS });
    ids.board1 = (await engine.insert(OPEN, { name: 'board one' }, { context: SYS })).id;
    ids.board2 = (await engine.insert(OPEN, { name: 'board two' }, { context: SYS })).id;
    ids.gone = (await engine.insert(OPEN, { name: 'board gone' }, { context: SYS })).id;
    await engine.delete(OPEN, { where: { id: ids.gone }, context: SYS });

    // Rows no CRUD mirror writes, but an app's own server action can: one that
    // names no parent, one that names an object no registry knows, and one
    // that names the activity stream itself.
    const stamp = new Date().toISOString();
    for (const row of [
      { type: 'note', summary: 'no parent', object_name: null, record_id: null },
      { type: 'note', summary: 'unknown parent', object_name: 'act_unregistered', record_id: 'x1' },
      { type: 'note', summary: 'self parent', object_name: ACTIVITY, record_id: 'a1' },
    ]) {
      await engine.insert(ACTIVITY, { ...row, timestamp: stamp }, { context: SYS });
    }

    allRows = await engine.find(ACTIVITY, { context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('control: the CRUD mirror and the direct writes produced every row this file reasons about', () => {
    expect(pairs(allRows)).toEqual(
      [
        `${OPEN}/${ids.board1}`,
        `${OPEN}/${ids.board2}`,
        `${OPEN}/${ids.gone}`,
        `${OPEN}/${ids.gone}`,
        `${OWNED}/${ids.mine}`,
        `${OWNED}/${ids.theirs}`,
        `${OWNED}/${ids.theirs}`,
        `${ACTIVITY}/a1`,
        'NULL/NULL',
        'act_unregistered/x1',
      ].sort(),
    );
  });

  it('control: the parent stand-in answers a member exactly the records it owns', async () => {
    const owned = await engine.find(OWNED, { context: MEMBER });
    expect(owned.map((r: Row) => r.id)).toEqual([ids.mine]);
  });

  it('find: a member reads only the activity of records it can read', async () => {
    const rows = await engine.find(ACTIVITY, { context: MEMBER });
    expect(pairs(rows)).toEqual([`${OPEN}/${ids.board1}`, `${OPEN}/${ids.board2}`, `${OWNED}/${ids.mine}`].sort());
  });

  it('find: another member reads its own record’s activity, not the first member’s', async () => {
    const rows = await engine.find(ACTIVITY, { context: OTHER });
    expect(pairs(rows)).toEqual(
      [`${OPEN}/${ids.board1}`, `${OPEN}/${ids.board2}`, `${OWNED}/${ids.theirs}`, `${OWNED}/${ids.theirs}`].sort(),
    );
  });

  it('count: the list total is narrowed identically to the rows', async () => {
    expect(await engine.count(ACTIVITY, {}, { context: MEMBER })).toBe(3);
  });

  it('findOne: a row whose parent the member cannot read is absent by id', async () => {
    const hidden = allRows.find((r) => r.object_name === OWNED && r.record_id === ids.theirs)!;
    const shown = allRows.find((r) => r.object_name === OWNED && r.record_id === ids.mine)!;
    expect(await engine.findOne(ACTIVITY, { where: { id: hidden.id }, context: MEMBER })).toBeNull();
    expect((await engine.findOne(ACTIVITY, { where: { id: shown.id }, context: MEMBER }))?.id).toBe(shown.id);
  });

  it('aggregate: a grouped count sees only the readable rows', async () => {
    const groups = await engine.aggregate(
      ACTIVITY,
      { groupBy: ['object_name'], aggregations: [{ function: 'count', alias: 'n' }], context: MEMBER },
    );
    const byObject = Object.fromEntries(groups.map((g: Row) => [g.object_name ?? 'NULL', Number(g.n)]));
    expect(byObject).toEqual({ [OPEN]: 2, [OWNED]: 1 });
  });

  it('a query scoped to a record the member cannot read returns nothing', async () => {
    const rows = await engine.find(
      ACTIVITY,
      { where: { object_name: OWNED, record_id: ids.theirs }, context: MEMBER },
    );
    expect(rows).toEqual([]);
  });

  it('rows whose parent no longer exists, or that name no readable parent, stay out', async () => {
    const rows = await engine.find(ACTIVITY, { context: MEMBER });
    const seen = new Set(rows.map((r: Row) => r.object_name ?? 'NULL'));
    expect(rows.some((r: Row) => r.record_id === ids.gone)).toBe(false);
    for (const name of ['NULL', 'act_unregistered', ACTIVITY]) expect(seen.has(name)).toBe(false);
  });

  it('a list read probes each parent object once, not once per row', async () => {
    parentProbes.length = 0;
    await engine.find(ACTIVITY, { context: OTHER });
    const perObject = parentProbes.filter((p) => p.userId === OTHER.userId).map((p) => `${p.object}:${p.operation}`);
    expect(perObject.sort()).toEqual([`${OPEN}:find`, `${OWNED}:find`]);
  });

  it('an admin, who reads every record, keeps every row about a record that exists', async () => {
    const rows = await engine.find(ACTIVITY, { context: ADMIN });
    const existing = allRows.filter(
      (r) => (r.object_name === OWNED || r.object_name === OPEN) && r.record_id !== ids.gone,
    );
    expect(pairs(rows)).toEqual(pairs(existing));
    expect(await engine.count(ACTIVITY, {}, { context: ADMIN })).toBe(existing.length);
  });

  it('a system read is not narrowed', async () => {
    const rows = await engine.find(ACTIVITY, { context: SYS });
    expect(rows.length).toBe(allRows.length);
  });
});
