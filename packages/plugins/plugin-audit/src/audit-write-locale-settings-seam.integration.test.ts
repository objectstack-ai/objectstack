// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#24235] The held write locale against a REAL engine, in its own file: it
// boots a kernel, an engine, a SQLite driver and the audit plugin, and that
// load is kept out of `audit-writers.test.ts`. Static imports, so the load is
// paid during collection, not by one test's timeout.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuditPlugin } from './audit-plugin.js';

/**
 * [#24235] A summary line is stored ONCE, at write time, so the writer's held
 * locale must not outlive a language change. Pinned on `ObjectKernel` +
 * `ObjectQLPlugin` + `AuditPlugin` over a real SQLite driver: the plugin's own
 * locale composition, the core resolver beneath it (which caches here, since
 * this engine carries the write epoch) and the engine's real hook dispatch.
 *
 * No settings service is registered, so the core resolver answers from the
 * tenant-scoped `sys_setting` rows directly, and the change is a write to
 * that store through the engine — the write `SettingsService` makes when it
 * persists, and the one a seeder makes without emitting any settings event.
 *
 * The clock is frozen from the first audited write on, so no case can pass by
 * the TTL running out: what retires the held locale here is the write, or
 * nothing does.
 */
describe('audit writers — a localization change reaches the very next audited write (#24235)', () => {
  const HARNESS_PACKAGE = 'com.objectstack.audit.test.write-locale-seam';
  /** A stand-in under the real name: service-settings owns the definition, and the name is what the seam reads. */
  const sysSetting = {
    name: 'sys_setting',
    label: 'Setting',
    isSystem: true,
    fields: {
      namespace: { name: 'namespace', label: 'Namespace', type: 'text' as const },
      key: { name: 'key', label: 'Key', type: 'text' as const },
      scope: { name: 'scope', label: 'Scope', type: 'text' as const },
      value: { name: 'value', label: 'Value', type: 'text' as const },
    },
  };
  const task = {
    name: 'biz_task',
    label: 'Task',
    fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
  };

  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let sql: (statement: string, bindings: unknown[]) => Promise<Record<string, unknown>[]>;
  let settingsReads: () => number;

  const SYSTEM = { context: { isSystem: true } };
  const asAdmin = { context: { userId: 'u_admin' } };

  /** Write one task as a user and answer the summary its activity row stored. */
  async function auditedWrite(name: string): Promise<string> {
    const row = await engine.insert('biz_task', { name }, asAdmin as any);
    const rows = await sql('SELECT summary FROM "sys_activity" WHERE object_name = ? AND record_id = ?', [
      'biz_task',
      String((row as { id: unknown }).id),
    ]);
    expect(rows).toHaveLength(1);
    return String(rows[0].summary);
  }

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(sysSetting as any, HARNESS_PACKAGE);
    engine.registry.registerObject(task as any, HARNESS_PACKAGE);
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
    const find = vi.spyOn(engine, 'find');
    settingsReads = () => find.mock.calls.filter(([object]) => object === 'sys_setting').length;
  }, 120_000);

  afterAll(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('pin: a settings-store write between two audited writes; the second stores the new language', async () => {
    // The precondition the whole case leans on: this engine carries the write
    // epoch, so the core resolver beneath the writer caches as it does in a
    // stock boot rather than declining to.
    expect(typeof (engine as unknown as { writeEpoch?: { current?: unknown } }).writeEpoch?.current).toBe('number');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));

    // No row yet: the built-in default (`en-US`), read once and held.
    expect(await auditedWrite('T1')).toBe('Created Task "T1"');

    // CONTROL: a write with no settings change between is answered from the
    // held locale — not one settings read.
    const beforeControl = settingsReads();
    expect(await auditedWrite('T2')).toBe('Created Task "T2"');
    expect(settingsReads() - beforeControl).toBe(0);

    // The change: an insert into the settings store…
    await engine.insert(
      'sys_setting',
      { namespace: 'localization', key: 'locale', scope: 'tenant', value: 'zh-CN' },
      SYSTEM as any,
    );
    expect(await auditedWrite('T3')).toBe('创建了 Task "T3"');

    // …and an update of it, the shape a settings write takes once the row exists.
    await engine.update('sys_setting', { value: 'ja-JP' }, { where: { key: 'locale' }, multi: true, ...SYSTEM } as any);
    expect(await auditedWrite('T4')).toBe('Task「T4」を作成しました');

    // The new answer is held in turn: the next unchanged write reads nothing.
    const beforeHeld = settingsReads();
    expect(await auditedWrite('T5')).toBe('Task「T5」を作成しました');
    expect(settingsReads() - beforeHeld).toBe(0);
  });
});
