// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#23804] The real-engine half of the own UI-state rule, in its own file: it
// boots a kernel, an engine, a SQLite driver and the audit plugin, and that
// load is kept out of `audit-writers.test.ts`, whose fake-engine pins
// (#22961's block) hold the same rule on hand-built hook contexts. Static
// imports, so the load is paid during collection, not by one test's timeout.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysUserPreference } from '@objectstack/platform-objects/identity';
import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';

/**
 * [#23804, ruling record 6212163130] A user's own write to their own per-user
 * UI-state row writes neither the ledger row nor the activity row, on a REAL
 * engine with the audit plugin: `ObjectKernel` + `ObjectQLPlugin` +
 * `AuditPlugin` over a real SQLite driver, the shipped `sys_user_preference`,
 * and both tables read at rest. The user travels as it does in production
 * (`ExecutionContext.userId` to the hook session), and `result` / `previous`
 * are whatever the engine binds for a create, an update and a delete, not
 * hand-built shapes.
 *
 * Each case writes its own preference row and reads only the rows its write
 * under test ADDS about that row, so the seeding write never counts for or
 * against it. An own-write case that can still be written to ends with an
 * administrator's write to the same row, which must add exactly one ledger
 * row: a "no row" verdict cannot pass on a writer that never ran.
 */
describe('audit writers — a user\'s own UI-state write leaves no ledger row, on a real engine (#23804)', () => {
  const PREFS = 'sys_user_preference';
  const RULE = 'sys_sharing_rule';
  const OWNER = 'u_alice';
  const ADMIN = 'u_admin';
  const HARNESS_PACKAGE = 'com.objectstack.audit.test.own-ui-state-ledger';
  /** A stand-in under the real name: plugin-sharing owns the definition, and the name is what the rule reads. */
  const sharingRule = {
    name: RULE,
    label: 'Sharing Rule',
    isSystem: true,
    fields: {
      name: { name: 'name', label: 'Name', type: 'text' as const },
      object_name: { name: 'object_name', label: 'Object', type: 'text' as const },
      access_level: { name: 'access_level', label: 'Access Level', type: 'text' as const },
    },
  };

  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let sql: (statement: string, bindings: unknown[]) => Promise<Record<string, unknown>[]>;

  const as = (userId: string) => ({ context: { userId } });
  const SYSTEM = { context: { isSystem: true } };

  type Table = 'sys_audit_log' | 'sys_activity';
  /** Every row `table` holds about one record, at rest. */
  const rowsAbout = (table: Table, object: string, recordId: string) =>
    sql(`SELECT * FROM "${table}" WHERE object_name = ? AND record_id = ?`, [object, recordId]);
  /** The rows `write` adds to each table about one record. */
  async function rowsAddedBy(object: string, recordId: string, write: () => Promise<unknown>) {
    const seen = new Set<string>();
    for (const table of ['sys_audit_log', 'sys_activity'] as const) {
      for (const r of await rowsAbout(table, object, recordId)) seen.add(`${table}:${String(r.id)}`);
    }
    await write();
    const added = async (table: Table) =>
      (await rowsAbout(table, object, recordId)).filter((r) => !seen.has(`${table}:${String(r.id)}`));
    return { ledger: await added('sys_audit_log'), activity: await added('sys_activity') };
  }

  /** The owner's own create of a fresh preference row (a distinct key per case). */
  let seq = 0;
  async function ownPreference(): Promise<string> {
    seq += 1;
    const row = await engine.insert(PREFS, { user_id: OWNER, key: `ui.recent.${seq}`, value: [] }, as(OWNER) as any);
    return String((row as { id: unknown }).id);
  }
  const setValue = (id: string, value: unknown[], options: Record<string, unknown>) =>
    engine.update(PREFS, { value }, { where: { id }, ...options } as any);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(SysUserPreference as any, HARNESS_PACKAGE);
    engine.registry.registerObject(sharingRule as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    sql = async (statement, bindings) => {
      const result = await (driver as unknown as { execute(s: string, b: unknown[]): Promise<unknown> }).execute(
        statement,
        bindings,
      );
      // knex wraps some results as `[rows]`; normalize both shapes.
      const list = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
      expect(Array.isArray(list)).toBe(true);
      return list as Record<string, unknown>[];
    };
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('the owner\'s own create writes no sys_audit_log row and no sys_activity row', async () => {
    const id = await ownPreference();

    expect(await rowsAbout('sys_audit_log', PREFS, id)).toHaveLength(0);
    expect(await rowsAbout('sys_activity', PREFS, id)).toHaveLength(0);

    // Live-writer CONTROL: another actor's write to the same row is recorded.
    const control = await rowsAddedBy(PREFS, id, () => setValue(id, [{ id: 'acc-1' }], as(ADMIN)));
    expect(control.ledger.map((r) => [r.action, r.user_id])).toEqual([['update', ADMIN]]);
  });

  it('the owner\'s own update writes no sys_audit_log row and no sys_activity row', async () => {
    const id = await ownPreference();
    const own = await rowsAddedBy(PREFS, id, async () => {
      await setValue(id, [{ id: 'acc-1' }], as(OWNER));
      await setValue(id, [{ id: 'acc-1' }, { id: 'acc-2' }], as(OWNER));
    });

    expect(own.ledger).toHaveLength(0);
    expect(own.activity).toHaveLength(0);

    // Live-writer CONTROL, as above.
    const control = await rowsAddedBy(PREFS, id, () => setValue(id, [], as(ADMIN)));
    expect(control.ledger.map((r) => [r.action, r.user_id])).toEqual([['update', ADMIN]]);
  });

  it('the owner\'s own delete writes no sys_audit_log row and no sys_activity row', async () => {
    // The engine binds the deleted row as `previous`, which names the owner;
    // the delete's `result` names no owner and is not evidence either way.
    const id = await ownPreference();
    const own = await rowsAddedBy(PREFS, id, () => engine.delete(PREFS, { where: { id }, ...as(OWNER) } as any));

    expect(own.ledger).toHaveLength(0);
    expect(own.activity).toHaveLength(0);
  });

  it('an administrator\'s update of another user\'s row writes a ledger row (and its activity row)', async () => {
    const id = await ownPreference();
    const added = await rowsAddedBy(PREFS, id, () => setValue(id, [{ id: 'acc-9' }], as(ADMIN)));

    expect(added.ledger.map((r) => [r.action, r.user_id])).toEqual([['update', ADMIN]]);
    expect(added.activity.map((r) => [r.type, r.actor_id])).toEqual([['updated', ADMIN]]);
  });

  it('a system write with no user writes a ledger row', async () => {
    const id = await ownPreference();
    const added = await rowsAddedBy(PREFS, id, () => setValue(id, [{ id: 'acc-9' }], SYSTEM));

    expect(added.ledger.map((r) => [r.action, r.user_id ?? null])).toEqual([['update', null]]);
  });

  it('the owner moving the row to another user writes a ledger row', async () => {
    const id = await ownPreference();
    const added = await rowsAddedBy(PREFS, id, () =>
      engine.update(PREFS, { user_id: 'u_bob' }, { where: { id }, ...as(OWNER) } as any),
    );

    expect(added.ledger.map((r) => [r.action, r.user_id])).toEqual([['update', OWNER]]);
  });

  it('the same user\'s update of a sys_sharing_rule writes a ledger row', async () => {
    const rule = await engine.insert(RULE, { name: 'Region West', object_name: 'account', access_level: 'read' }, SYSTEM as any);
    const id = String((rule as { id: unknown }).id);
    const added = await rowsAddedBy(RULE, id, () =>
      engine.update(RULE, { access_level: 'edit' }, { where: { id }, ...as(OWNER) } as any),
    );

    expect(added.ledger.map((r) => [r.action, r.user_id])).toEqual([['update', OWNER]]);
  });
});
