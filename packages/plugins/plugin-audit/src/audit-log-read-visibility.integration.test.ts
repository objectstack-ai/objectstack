// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21175] `sys_audit_log` read visibility, on the plugin's READ PATH.
 *
 * A caller holding object-level ledger read gets back only the ledger rows
 * about records it can read, plus the rows that are about no record. An admin
 * is the caller who can read every record, so it is the control: it keeps every
 * row about a record that exists.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * The narrowing is a WHERE the gate ANDs into the caller's query, so whether it
 * selects the right rows is a question about the Filter Protocol as a driver
 * executes it (`$or` over the parent pair and the row id, `$in`, `count`,
 * `aggregate`). The record rows below are written by the real CRUD mirror,
 * stored by a real SQLite driver and read back through the real engine
 * middleware chain, and the gate is mounted by `AuditPlugin` itself at
 * `kernel:ready`, so a gate that stops being mounted fails here exactly like a
 * gate that was never written. The rows no CRUD write produces (the run-level
 * rows other packages write, and malformed ones) are inserted as those writers
 * insert them: as the system.
 *
 * ## The one stand-in
 *
 * PARENT READABILITY, as in the activity gate's pin: one engine middleware on
 * the owned parent object plays the parent's sharing, RLS and object-level
 * CRUD — a member reads the records it owns, the admin reads them all. The
 * gate cannot tell it apart from plugin-security because it asks the same
 * question the same way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';

const LEDGER = 'sys_audit_log';
/** A parent object whose records each caller reads only when it owns them. */
const OWNED = 'led_vault';
/** A parent object every caller reads. */
const OPEN = 'led_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.ledger-read';

const SYS = { isSystem: true } as const;
const MEMBER = { userId: 'u_member', tenantId: 'org_1', positions: ['org_member'] };
const OTHER = { userId: 'u_other', tenantId: 'org_1', positions: ['org_member'] };
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };

const ownedObject = {
  name: OWNED,
  label: 'Vault',
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

/** The rows no CRUD write produces, by the class each stands for. */
const ABOUT_NO_RECORD = [
  { action: 'config_change', object_name: 'sys_setting', record_id: null },
  { action: 'import', object_name: 'sys_user', record_id: null },
  { action: 'platform_admin_standing_change', object_name: 'sys_user', record_id: null },
];
const UNJUDGEABLE = [
  // A record action naming no record — the mirror stamps `null` when it cannot derive the id.
  { action: 'update', object_name: OWNED, record_id: null },
  // A record under an object no registry knows.
  { action: 'create', object_name: 'led_unregistered', record_id: 'x1' },
  // A record under the ledger itself.
  { action: 'create', object_name: LEDGER, record_id: 'a1' },
  // A record id under no object.
  { action: 'login', object_name: null, record_id: 's1' },
];

type Row = Record<string, any>;
const key = (r: Row) => `${r.action}:${r.object_name ?? 'NULL'}/${r.record_id ?? 'NULL'}`;
const keys = (rows: Row[]) => rows.map(key).sort();

describe('[#21175] sys_audit_log read visibility — the plugin read path', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};
  let allRows: Row[] = [];
  /** The rows about a record that exists, per its parent. */
  let aboutMine: string[] = [];
  let aboutTheirs: string[] = [];
  let aboutBoards: string[] = [];
  let aboutNoRecord: string[] = [];

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

    // Parent readability: a non-admin caller reads the vault records it owns.
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

    // Every record row below is written by the real audit writer's CRUD mirror.
    ids.mine = (await engine.insert(OWNED, { name: 'mine', owner: MEMBER.userId }, { context: SYS })).id;
    ids.theirs = (await engine.insert(OWNED, { name: 'theirs', owner: OTHER.userId }, { context: SYS })).id;
    await engine.update(OWNED, { name: 'theirs, renamed' }, { where: { id: ids.theirs }, context: SYS });
    ids.mineGone = (await engine.insert(OWNED, { name: 'mine, gone', owner: MEMBER.userId }, { context: SYS })).id;
    await engine.delete(OWNED, { where: { id: ids.mineGone }, context: SYS });
    ids.board = (await engine.insert(OPEN, { name: 'board' }, { context: SYS })).id;
    ids.boardGone = (await engine.insert(OPEN, { name: 'board, gone' }, { context: SYS })).id;
    await engine.delete(OPEN, { where: { id: ids.boardGone }, context: SYS });

    for (const row of [...ABOUT_NO_RECORD, ...UNJUDGEABLE]) {
      await engine.insert(LEDGER, { ...row, user_id: null, actor: 'svc:fixture' }, { context: SYS });
    }

    allRows = await engine.find(LEDGER, { context: SYS });
    const about = (object: string, id: string) =>
      allRows.filter((r) => r.object_name === object && r.record_id === id).map(key).sort();
    aboutMine = about(OWNED, ids.mine);
    aboutTheirs = about(OWNED, ids.theirs);
    aboutBoards = about(OPEN, ids.board);
    aboutNoRecord = ABOUT_NO_RECORD.map((r) => key(r)).sort();
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('control: the CRUD mirror and the system inserts produced every row this file reasons about', () => {
    expect(keys(allRows)).toEqual(
      [
        `create:${OWNED}/${ids.mine}`,
        `create:${OWNED}/${ids.theirs}`,
        `update:${OWNED}/${ids.theirs}`,
        `create:${OWNED}/${ids.mineGone}`,
        `delete:${OWNED}/${ids.mineGone}`,
        `create:${OPEN}/${ids.board}`,
        `create:${OPEN}/${ids.boardGone}`,
        `delete:${OPEN}/${ids.boardGone}`,
        ...[...ABOUT_NO_RECORD, ...UNJUDGEABLE].map((r) => key(r)),
      ].sort(),
    );
    // The mirror's snapshots carry the record they are about.
    const theirs = allRows.filter((r) => r.record_id === ids.theirs);
    expect(theirs.every((r) => String(r.new_value ?? r.old_value ?? '').length > 0)).toBe(true);
  });

  it('control: the parent stand-in answers a member exactly the records it owns', async () => {
    const owned = await engine.find(OWNED, { context: MEMBER });
    expect(owned.map((r: Row) => r.id)).toEqual([ids.mine]);
  });

  it('find: a reader who may not read a record is not served its rows; a reader who may is', async () => {
    const member = keys(await engine.find(LEDGER, { context: MEMBER }));
    const other = keys(await engine.find(LEDGER, { context: OTHER }));
    for (const k of aboutTheirs) {
      expect(member).not.toContain(k);
      expect(other).toContain(k);
    }
    for (const k of aboutMine) {
      expect(member).toContain(k);
      expect(other).not.toContain(k);
    }
  });

  it('find: a member reads the rows about records it can read and the rows about no record, and nothing else', async () => {
    const rows = await engine.find(LEDGER, { context: MEMBER });
    expect(keys(rows)).toEqual([...aboutMine, ...aboutBoards, ...aboutNoRecord].sort());
  });

  it('count: the list total is narrowed identically to the rows', async () => {
    const rows = await engine.find(LEDGER, { context: MEMBER });
    expect(await engine.count(LEDGER, {}, { context: MEMBER })).toBe(rows.length);
  });

  it('findOne: a row about a record the member cannot read is absent by id; its control is present', async () => {
    const hidden = allRows.find((r) => r.object_name === OWNED && r.record_id === ids.theirs && r.action === 'update')!;
    const shown = allRows.find((r) => r.object_name === OWNED && r.record_id === ids.mine)!;
    const runLevel = allRows.find((r) => r.action === 'config_change')!;
    expect(await engine.findOne(LEDGER, { where: { id: hidden.id }, context: MEMBER })).toBeNull();
    expect((await engine.findOne(LEDGER, { where: { id: hidden.id }, context: OTHER }))?.id).toBe(hidden.id);
    expect((await engine.findOne(LEDGER, { where: { id: shown.id }, context: MEMBER }))?.id).toBe(shown.id);
    expect((await engine.findOne(LEDGER, { where: { id: runLevel.id }, context: MEMBER }))?.id).toBe(runLevel.id);
  });

  it('aggregate: a grouped count sees only the readable rows', async () => {
    const groups = await engine.aggregate(
      LEDGER,
      { groupBy: ['object_name'], aggregations: [{ function: 'count', alias: 'n' }], context: MEMBER },
    );
    const byObject = Object.fromEntries(groups.map((g: Row) => [g.object_name ?? 'NULL', Number(g.n)]));
    expect(byObject).toEqual({ [OWNED]: aboutMine.length, [OPEN]: aboutBoards.length, sys_setting: 1, sys_user: 2 });
  });

  it('a query scoped to a record the member cannot read returns nothing', async () => {
    const rows = await engine.find(LEDGER, { where: { object_name: OWNED, record_id: ids.theirs }, context: MEMBER });
    expect(rows).toEqual([]);
    expect(await engine.count(LEDGER, { where: { object_name: OWNED, record_id: ids.theirs } }, { context: MEMBER })).toBe(0);
  });

  it('rows about a record that no longer exists, or that name a record the gate cannot judge, stay out for every caller', async () => {
    for (const ctx of [MEMBER, ADMIN]) {
      const rows = await engine.find(LEDGER, { context: ctx });
      const served = keys(rows);
      expect(rows.some((r: Row) => r.record_id === ids.mineGone || r.record_id === ids.boardGone)).toBe(false);
      expect(rows.some((r: Row) => r.action === 'delete')).toBe(false);
      for (const row of UNJUDGEABLE) expect(served).not.toContain(key(row));
    }
  });

  it('a list read probes each parent object once, not once per row', async () => {
    parentProbes.length = 0;
    await engine.find(LEDGER, { context: OTHER });
    const perObject = parentProbes.filter((p) => p.userId === OTHER.userId).map((p) => `${p.object}:${p.operation}`);
    expect(perObject.sort()).toEqual([`${OPEN}:find`, `${OWNED}:find`]);
  });

  it('an admin, who reads every record, keeps every row about a record that exists and every row about none', async () => {
    const rows = await engine.find(LEDGER, { context: ADMIN });
    expect(keys(rows)).toEqual([...aboutMine, ...aboutTheirs, ...aboutBoards, ...aboutNoRecord].sort());
    expect(await engine.count(LEDGER, {}, { context: ADMIN })).toBe(rows.length);
  });

  it('a system read is not narrowed', async () => {
    const rows = await engine.find(LEDGER, { context: SYS });
    expect(rows.length).toBe(allRows.length);
  });
});
