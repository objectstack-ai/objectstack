// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15207] Per-tenant retention on the compliance ledger partitions on its
 * attribution field.
 *
 * ADR-0131 D7 takes the injected `organization_id` off `sys_audit_log`: the
 * organization a row is ABOUT stays in the plain attribution field
 * `tenant_id`, and a row about a deployment-level action leaves it NULL. A
 * tenant-scope `lifecycle.retention_overrides` entry naming the ledger must
 * still give that tenant its own window, so the per-tenant passes select on
 * `tenant_id`, and the global pass keeps everyone else, the NULL rows
 * included. A column-less object answered no partition since the plumbing
 * tables lost their column; without the attribution partition the ledger's
 * tenant override would silently stop applying.
 *
 * Every case runs on a REAL `ObjectQL` engine and registry, so the object the
 * sweep reads is the one the registry registered, after its system-field
 * injection. The stub driver provisions each table from that registered
 * object's fields and refuses a filter on a column the table lacks, as the SQL
 * driver does, so a pass naming the retired column fails here as it would
 * there.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '../engine.js';
import { LifecycleService } from './lifecycle-service.js';
import { parseLifecycleDuration } from './duration.js';

const FIXED_NOW = 1_700_000_000_000;
const PACKAGE_ID = 'lifecycle-attribution-partition';
const ATTRIBUTION = { tenant_id: { type: 'lookup', reference: 'sys_organization' } };

/** The ledger as ADR-0131 D7 declares it: no tenant column, the attribution field declared. */
const LEDGER = {
  name: 'sys_audit_log',
  systemFields: { tenant: false },
  fields: { action: { type: 'text' }, ...ATTRIBUTION },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' } },
};
/** The same ledger with the archiver declared, the shape it ships with. */
const LEDGER_ARCHIVED = {
  ...LEDGER,
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive', keep: '7y' } },
};
/** CONTROL: the ledger without the attribution field — nothing to partition on. */
const LEDGER_WITHOUT_FIELD = { ...LEDGER, fields: { action: { type: 'text' } } };
/** CONTROL: a column-less object carrying a field of the same name — the name alone decides nothing. */
const OTHER_WITH_FIELD = {
  name: 'sys_job_run',
  systemFields: { tenant: false },
  fields: { status: { type: 'text' }, ...ATTRIBUTION },
  lifecycle: { class: 'telemetry', retention: { maxAge: '90d' } },
};

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } };

const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();

/** One organization keeps its rows longer than the declared window. */
function fakeSettings() {
  const tenantValues: Record<string, Record<string, unknown>> = {
    org_reg: { retention_overrides: { sys_audit_log: { maxAge: '365d' }, sys_job_run: { maxAge: '365d' } } },
  };
  return {
    async get(_ns: string, key: string, ctx?: Record<string, unknown>) {
      const tenantId = ctx?.tenantId as string | undefined;
      if (tenantId && tenantValues[tenantId] && key in tenantValues[tenantId]) {
        return { value: tenantValues[tenantId][key], source: 'tenant' };
      }
      return { value: undefined, source: 'default' };
    },
  };
}

/** Every column a filter names: the non-operator keys, at any depth of `$or` / `$and`. */
function filteredColumns(where: unknown): string[] {
  if (Array.isArray(where)) return where.flatMap(filteredColumns);
  if (!where || typeof where !== 'object') return [];
  return Object.entries(where as Record<string, unknown>).flatMap(([key, value]) =>
    key.startsWith('$') ? filteredColumns(value) : [key],
  );
}

async function lifecycleEngine(object: Record<string, unknown>) {
  const engine = new ObjectQL();
  const name = object.name as string;
  /** The table's columns: the REGISTERED object's fields, as schema sync provisions them, plus the key. */
  const columnsOf = (table: string): Set<string> => {
    const registered = engine.registry.getObject(table) as { fields?: Record<string, unknown> } | undefined;
    return new Set(['id', ...Object.keys(registered?.fields ?? {})]);
  };
  /** The `where` of every read the driver served for the swept table — the archiver reads the hot store directly. */
  const driverReads: unknown[] = [];
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(table: string, ast: { where?: unknown } | undefined) {
      if (table === 'sys_organization') return [{ id: 'org_reg' }];
      const missing = filteredColumns(ast?.where).find((column) => !columnsOf(table).has(column));
      if (missing !== undefined) {
        throw Object.assign(
          new Error(`A filter on object '${table}' names a column the database could not resolve (${missing}).`),
          { code: 'INVALID_FILTER', status: 400 },
        );
      }
      if (table === name) driverReads.push(ast?.where);
      return [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(_t: string, data: Record<string, unknown>) { return { id: 'r_1', ...data }; },
    async update(_t: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async delete() { return true; },
    async bulkCreate(_t: string, rows: unknown[]) { return rows; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async upsert(_t: string, row: Record<string, unknown>) { return row; },
    async syncSchema() {},
  };
  const archive = {
    ...driver,
    name: 'archive',
    async find() { return []; },
    async deleteMany() { return 0; },
  };

  engine.registerDriver(driver as unknown as Parameters<ObjectQL['registerDriver']>[0], true);
  engine.registerDriver(archive as unknown as Parameters<ObjectQL['registerDriver']>[0], false);
  await engine.init();
  engine.registry.registerObject(object as unknown as Parameters<ObjectQL['registry']['registerObject']>[0], PACKAGE_ID);
  engine.registry.registerObject(ORG_OBJECT as unknown as Parameters<ObjectQL['registry']['registerObject']>[0], PACKAGE_ID);
  const find = vi.spyOn(engine, 'find');
  return {
    engine,
    driverReads,
    /** The `where` of every candidate read the reaper issued through the engine, as it issued them. */
    reapReads: () =>
      find.mock.calls.filter((call) => call[0] === name).map((call) => (call[1] as { where?: unknown } | undefined)?.where),
  };
}

function sweepOnce(engine: ObjectQL) {
  return new LifecycleService({
    getEngine: () => engine,
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
    now: () => FIXED_NOW,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
    getSettings: () => fakeSettings(),
    referenceAudit: { enabled: false },
  }).sweep();
}

/** The two passes a partitioned sweep issues: the tenant's own window, then everyone else's. */
const partitioned = (column: string) => [
  { created_at: { $lt: isoCutoff('365d') }, [column]: 'org_reg' },
  { created_at: { $lt: isoCutoff('90d') }, $or: [{ [column]: { $nin: ['org_reg'] } }, { [column]: null }] },
];
const onePass = [{ created_at: { $lt: isoCutoff('90d') } }];

describe('LifecycleService.sweep — the ledger partitions per-tenant retention on its attribution field (#15207)', () => {
  it('premise: the registered ledger has tenant_id and no organization_id', async () => {
    const { engine } = await lifecycleEngine(LEDGER);
    const fields = Object.keys((engine.registry.getObject('sys_audit_log') as { fields?: object })?.fields ?? {});
    expect(fields).toContain('tenant_id');
    expect(fields).not.toContain('organization_id');
  });

  it('reap: the tenant gets its own window on the rows about it, and the global pass keeps the NULL rows', async () => {
    const box = await lifecycleEngine(LEDGER);
    const report = await sweepOnce(box.engine);
    expect(report.errors).toEqual([]);
    expect(box.reapReads()).toEqual(partitioned('tenant_id'));
  });

  it('archive: the archiver selects the same two partitions from the hot store', async () => {
    const box = await lifecycleEngine(LEDGER_ARCHIVED);
    const report = await sweepOnce(box.engine);
    expect(report.errors).toEqual([]);
    expect(box.driverReads).toEqual(partitioned('tenant_id'));
    expect(report.swept.find((e) => e.object === 'sys_audit_log')?.policy).toBe('archive');
  });

  it('CONTROL: the ledger without the attribution field runs one global pass, never a phantom partition', async () => {
    const box = await lifecycleEngine(LEDGER_WITHOUT_FIELD);
    const report = await sweepOnce(box.engine);
    expect(report.errors).toEqual([]);
    expect(box.reapReads()).toEqual(onePass);
  });

  it('CONTROL: another column-less object with a field of the same name runs one global pass', async () => {
    const box = await lifecycleEngine(OTHER_WITH_FIELD);
    const report = await sweepOnce(box.engine);
    expect(report.errors).toEqual([]);
    expect(box.reapReads()).toEqual(onePass);
  });

  it('CONTROL: the ledger WITH the injected column partitions on it, as every walled object does', async () => {
    const { systemFields: _optOut, ...withColumn } = LEDGER;
    const box = await lifecycleEngine(withColumn);
    const report = await sweepOnce(box.engine);
    expect(report.errors).toEqual([]);
    expect(box.reapReads()).toEqual(partitioned('organization_id'));
  });
});
