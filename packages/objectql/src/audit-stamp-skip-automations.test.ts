// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22070 — `skipAutomations` never bypasses ObjectQL's own audit stamps.
//
// ## The contract
//
// `ExecutionContext.skipAutomations` (`@objectstack/spec` kernel
// `execution-context.zod.ts`) suppresses the lifecycle hooks bound FROM
// METADATA, and states the other half in the same breath: "Hooks registered in
// code by plugins — audit, capability gates, sharing projection — carry no
// metadata binding and STILL run: this flag must never bypass security or
// audit." The engine's skip says the same at `triggerHooks`.
//
// ## The defect
//
// The engine keys the skip on `entry.meta`, the metadata binding the hook
// binder stamps on every registration it makes. ObjectQL's builtin audit stamps
// (`sys_stamp_audit_insert` / `sys_stamp_audit_update`) were registered THROUGH
// the binder, so they carried `meta` and the opt-out skipped them: a data
// import with "run automations & triggers" unchecked — a real user in the
// session — stored rows with no `created_by` / `updated_by` and no declared
// `tenant_id`, and, on a driver that does not stamp its own timestamps, no
// `created_at` / `updated_at` either. The organization column was never the
// hook's: the driver stamps it from the engine's `DriverOptions.tenantId`,
// flag or no flag, so the tenancy wall held throughout.
//
// ## The fix
//
// `ObjectQLPlugin.registerAuditHooks` registers the builtins IN CODE
// (`engine.registerHook`, no `meta`), which is what the contract already says
// audit is. The engine's rule stays one bit — `meta` means "bound from
// metadata" — so no dispatch site gains a second criterion. The builtins keep
// the binder's wrapper and the unregister-by-package, so the opt-out is the
// only thing that changes for them. (a), (c) and (d) were red before it and (b)
// was green.
//
// ## Pins
//
//  (a) under `skipAutomations`, with a session user, an insert stamps
//      `created_by`, `updated_by`, `created_at`, `updated_at` and the declared
//      `tenant_id`, and an update stamps `updated_by` and `updated_at` — the
//      same answers as without the flag, through the real engine;
//  (b) control: a metadata-bound app hook is still skipped under the flag;
//  (c) the door: a `runImport` with automations off, through the real
//      DataProtocol, stamps the session user on the rows it creates and updates;
//  (d) the registration: every `sys:audit` entry carries no metadata binding,
//      so a builtin added to the list later cannot reach the opt-out either.
//
// The driver below stamps NOTHING itself, so every audit value on a stored row
// is the hook's.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectKernel, runImport } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

const OBJECT = 'audit_ticket';
const T_INSERT = '2026-10-07T10:00:00.000Z';
const T_UPDATE = '2026-10-07T11:00:00.000Z';
const IMPORTER = 'usr_importer';
const EDITOR = 'usr_editor';
const ORG = 'org_acme';

/** A store-backed stub driver that stamps nothing: the stored row IS the verdict. */
function makeStubDriver() {
  const rows = new Map<string, Record<string, any>>();
  const createOptions: any[] = [];
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k.startsWith('$')) throw new Error(`stub driver: unsupported combinator ${k}`);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$eq') return row?.[k] === target;
          if (op === '$in') return Array.isArray(target) && target.includes(row?.[k]);
          // REFUSE, never silently match.
          throw new Error(`stub driver: unsupported operator ${op}`);
        });
      }
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'audit-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(_o: string, ast: any) {
      const hits = Array.from(rows.values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, applied AFTER the filter (the import runner's
      // match probe asks for `limit: 2`).
      const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
      return page.map((r) => ({ ...r }));
    },
    async findOne(_o: string, ast: any) {
      for (const r of rows.values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(_o: string, data: Record<string, unknown>, options?: any) {
      createOptions.push(options);
      n += 1;
      const id = (data.id as string) ?? `rec_${n}`;
      const row = { ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const row = { ...rows.get(id), ...data, id };
      rows.set(id, row);
      return { ...row };
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async count(_o: string, ast: any) {
      return Array.from(rows.values()).filter((r) => matches(r, ast?.where)).length;
    },
  };
  return { driver, rows, createOptions };
}

/** The audit columns a stored row carries — `undefined` where nothing stamped one. */
const auditOf = (row: Record<string, any> | undefined) => ({
  created_by: row?.created_by,
  updated_by: row?.updated_by,
  created_at: row?.created_at,
  updated_at: row?.updated_at,
  tenant_id: row?.tenant_id,
});

describe('#22070 — skipAutomations never bypasses the builtin audit stamps', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;
  let appHookCalls: string[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T_INSERT));
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    stub = makeStubDriver();
    await kernel.use({
      name: 'audit-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.audit-store', stub.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    // The audit family is NOT declared: the registry injects it, as on every
    // real object. `tenant_id` is declared, because the insert stamp writes it
    // only where the object carries the column.
    objectql.registry.registerObject({
      name: OBJECT,
      label: 'Audit Ticket',
      datasource: 'audit-store',
      fields: {
        code: { name: 'code', label: 'Code', type: 'text' },
        title: { name: 'title', label: 'Title', type: 'text' },
        tenant_id: { name: 'tenant_id', label: 'Tenant', type: 'text' },
      },
    } as any, 'test', 'test');
    // (b)'s subject: an app's lifecycle hook, bound from metadata exactly as a
    // `defineStack({ hooks })` app binds it.
    appHookCalls = [];
    objectql.bindHooks([
      {
        name: 'app_touch',
        object: OBJECT,
        events: ['beforeInsert', 'beforeUpdate'],
        handler: async (ctx: any) => { appHookCalls.push(ctx.event); },
      },
    ], { packageId: 'test-app' });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (kernel.getState() === 'running') await kernel.shutdown();
  });

  const storedByCode = (code: string) => {
    const hits = Array.from(stub.rows.values()).filter((r) => r.code === code);
    expect(hits.length, `exactly one stored row for code ${code}`).toBe(1);
    return hits[0]!;
  };

  /** One insert as IMPORTER, then one update as EDITOR, under the given flag. */
  async function insertThenUpdate(code: string, skipAutomations: boolean) {
    vi.setSystemTime(new Date(T_INSERT));
    const created: any = await objectql.insert(
      OBJECT,
      { code, title: 'first' },
      { context: { userId: IMPORTER, tenantId: ORG, skipAutomations } as any },
    );
    const afterInsert = auditOf(storedByCode(code));
    vi.setSystemTime(new Date(T_UPDATE));
    await objectql.update(
      OBJECT,
      { id: created.id, title: 'second' },
      { context: { userId: EDITOR, tenantId: ORG, skipAutomations } as any },
    );
    return { afterInsert, afterUpdate: auditOf(storedByCode(code)) };
  }

  const EXPECTED_AFTER_INSERT = {
    created_by: IMPORTER,
    updated_by: IMPORTER,
    created_at: T_INSERT,
    updated_at: T_INSERT,
    tenant_id: ORG,
  };
  const EXPECTED_AFTER_UPDATE = {
    created_by: IMPORTER,
    updated_by: EDITOR,
    created_at: T_INSERT,
    updated_at: T_UPDATE,
    tenant_id: ORG,
  };

  it('(a) the flag changes no audit stamp: insert and update stamp the same columns with and without it', async () => {
    const without = await insertThenUpdate('plain', false);
    const withFlag = await insertThenUpdate('skipped', true);

    expect(without.afterInsert).toEqual(EXPECTED_AFTER_INSERT);
    expect(without.afterUpdate).toEqual(EXPECTED_AFTER_UPDATE);
    expect(withFlag.afterInsert).toEqual(EXPECTED_AFTER_INSERT);
    expect(withFlag.afterUpdate).toEqual(EXPECTED_AFTER_UPDATE);
    // The organization reaches the driver either way: it is the engine's
    // `DriverOptions.tenantId`, never a hook's write.
    expect(stub.createOptions.map((o) => o?.tenantId)).toEqual([ORG, ORG]);
  });

  it('(b) control: a metadata-bound app hook still does not run under the flag', async () => {
    await insertThenUpdate('skipped', true);
    expect(appHookCalls).toEqual([]);

    await insertThenUpdate('plain', false);
    expect(appHookCalls).toEqual(['beforeInsert', 'beforeUpdate']);
  });

  it('(c) the import door: runImport with automations off stamps the session user on created and updated rows', async () => {
    const protocol = new ObjectStackProtocolImplementation(objectql as never);
    const base = {
      p: protocol as never,
      objectName: OBJECT,
      metaMap: new Map([
        ['code', { name: 'code', type: 'text' }],
        ['title', { name: 'title', type: 'text' }],
      ]) as never,
      matchFields: ['code'],
      dryRun: false,
      runAutomations: false,
      trimWhitespace: false,
      createMissingOptions: false,
      skipBlankMatchKey: true,
    };

    vi.setSystemTime(new Date(T_INSERT));
    const created = await runImport({
      ...base,
      writeMode: 'insert',
      context: { userId: IMPORTER, tenantId: ORG },
      rows: [{ code: 'imp', title: 'first' }],
    });
    expect(created.created, JSON.stringify(created.results)).toBe(1);
    expect(auditOf(storedByCode('imp'))).toEqual(EXPECTED_AFTER_INSERT);

    vi.setSystemTime(new Date(T_UPDATE));
    const updated = await runImport({
      ...base,
      writeMode: 'update',
      context: { userId: EDITOR, tenantId: ORG },
      rows: [{ code: 'imp', title: 'second' }],
    });
    expect(updated.updated, JSON.stringify(updated.results)).toBe(1);
    expect(auditOf(storedByCode('imp'))).toEqual(EXPECTED_AFTER_UPDATE);

    // The opt-out still means what the user asked for at the same door.
    expect(appHookCalls).toEqual([]);
  });

  it('(d) every builtin audit registration carries no metadata binding', () => {
    const hooks = (objectql as unknown as { hooks: Map<string, Array<{ packageId?: string; meta?: unknown }>> }).hooks;
    const builtins = [...hooks.values()].flat().filter((entry) => entry.packageId === 'sys:audit');
    // One `beforeInsert` and one `beforeUpdate` stamp today.
    expect(builtins.length).toBeGreaterThanOrEqual(2);
    expect(builtins.filter((entry) => entry.meta !== undefined)).toEqual([]);
  });
});
