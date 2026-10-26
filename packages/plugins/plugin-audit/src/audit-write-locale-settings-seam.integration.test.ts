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
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/**
 * [#26167] What the held write locale localizes is the @mention notification
 * title: `sys_activity.summary` is stored in English and served in each
 * READER's locale. So the title is what this pin reads. The plugin's real
 * recipient gate needs a sharing model this harness does not boot, so the
 * writers are handed a messaging double and an admitting gate; every other
 * option — the locale composition included — is the plugin's own.
 */
const mentionTitles = vi.hoisted(() => [] as string[]);
vi.mock('./audit-writers.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./audit-writers.js')>();
  return {
    ...mod,
    installAuditWriters: (engine: any, packageId: string, opts: any) =>
      mod.installAuditWriters(engine, packageId, {
        ...opts,
        getMessaging: () => ({
          emit: async (e: any) => {
            if (e.topic === 'collab.mention') mentionTitles.push(String(e.payload?.title));
            return {};
          },
        }),
        admitMentionRecipients: async ({ mentions }: { mentions: string[] }) => [...mentions],
      }),
  };
});

/**
 * [#24235] A notification title is written ONCE, at write time, so the
 * writer's held locale must not outlive a language change. Pinned on `ObjectKernel` +
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
describe('audit writers — a localization change reaches the very next @mention title (#24235)', () => {
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

  let taskId = '';
  let comments = 0;
  /** Mention one user in a comment on the task, as the admin; answer the title the mention was given. */
  async function mentionTitle(): Promise<string> {
    if (!taskId) taskId = String(((await engine.insert('biz_task', { name: 'thread' }, asAdmin)) as any).id);
    comments += 1;
    const before = mentionTitles.length;
    await engine.insert(
      'sys_comment',
      {
        thread_id: `biz_task:${taskId}`,
        author_id: 'u_admin',
        author_name: 'Ada',
        body: `note ${comments}`,
        mentions: '["u_bob"]',
      },
      asAdmin,
    );
    expect(mentionTitles.length - before).toBe(1);
    return mentionTitles[mentionTitles.length - 1];
  }

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
    engine.registry.registerObject(sysSetting as any, HARNESS_PACKAGE);
    engine.registry.registerObject(task as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);

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

  it('pin: a settings-store write between two mentions; the second is titled in the new language', async () => {
    // The precondition the whole case leans on: this engine carries the write
    // epoch, so the core resolver beneath the writer caches as it does in a
    // stock boot rather than declining to.
    expect(typeof (engine as unknown as { writeEpoch?: { current?: unknown } }).writeEpoch?.current).toBe('number');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));

    // No row yet: the built-in default (`en-US`), read once and held.
    expect(await mentionTitle()).toBe('Ada mentioned you');

    // CONTROL: a write with no settings change between is answered from the
    // held locale — not one settings read.
    const beforeControl = settingsReads();
    expect(await mentionTitle()).toBe('Ada mentioned you');
    expect(settingsReads() - beforeControl).toBe(0);

    // The change: an insert into the settings store…
    await engine.insert(
      'sys_setting',
      { namespace: 'localization', key: 'locale', scope: 'tenant', value: 'zh-CN' },
      SYSTEM as any,
    );
    expect(await mentionTitle()).toBe('Ada 提到了你');

    // …and an update of it, the shape a settings write takes once the row exists.
    await engine.update('sys_setting', { value: 'ja-JP' }, { where: { key: 'locale' }, multi: true, ...SYSTEM } as any);
    expect(await mentionTitle()).toBe('Adaさんがあなたをメンションしました');

    // The new answer is held in turn: the next unchanged write reads nothing.
    const beforeHeld = settingsReads();
    expect(await mentionTitle()).toBe('Adaさんがあなたをメンションしました');
    expect(settingsReads() - beforeHeld).toBe(0);

    // [#26167] The audited write itself stores the English sentence under any
    // workspace language: it is served in each reader's own.
    expect(await auditedWrite('T6')).toBe('Created Task "T6"');
  });
});
