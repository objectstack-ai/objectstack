// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15207] An object with no tenant column has no tenant partition.
 *
 * ADR-0131 D7 takes the injected `organization_id` off the deployment-level
 * platform tables (`sys_job_run`, `sys_job_queue`, `sys_flow_dispatch` among
 * them): each declares `systemFields: { tenant: false }`, so the registry
 * injects no tenant column and the table is provisioned without one. An
 * operator can still store a tenant-scope `lifecycle.retention_overrides`
 * entry naming such a table. The reaper used to answer it with a per-tenant
 * window, so it partitioned the table on `organization_id`: the per-tenant
 * pass and the global pass's `$or` both named a column the table does not
 * have, the SQL driver refused both (`INVALID_FILTER`), and the table's
 * retention stopped. The federated case (#21918) had the same refusal for the
 * same reason, and the same answer: no column, no windows, one global pass.
 *
 * Every case runs on a REAL `ObjectQL` engine and registry, so the object the
 * sweep reads is the one the registry registered, after its system-field
 * injection. The stub driver provisions each table from that registered
 * object's fields, and refuses a filter on a column the table lacks, as the
 * SQL driver does.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '../engine.js';
import { LifecycleService } from './lifecycle-service.js';
import { parseLifecycleDuration } from './duration.js';

const FIXED_NOW = 1_700_000_000_000;
const PACKAGE_ID = 'lifecycle-no-tenant-column';

/** A deployment-level table as ADR-0131 D7 declares it: no injected organization column. */
const COLUMN_LESS = {
  name: 'sys_job_run',
  systemFields: { tenant: false },
  fields: { status: { type: 'text' } },
  lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } },
};

/** CONTROL: the same declaration without the opt-out, so the registry injects `organization_id`. */
const WITH_COLUMN = {
  name: 'sys_job_run',
  fields: { status: { type: 'text' } },
  lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } },
};

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } };

const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();

/** One organization stores a tenant-scope override that keeps its rows three times longer. */
function fakeSettings() {
  const tenantValues: Record<string, Record<string, unknown>> = {
    org_reg: { retention_overrides: { sys_job_run: { maxAge: '90d' } } },
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
  /** The table's columns: the REGISTERED object's fields, as schema sync provisions them, plus the key. */
  const columnsOf = (name: string): Set<string> => {
    const registered = engine.registry.getObject(name) as { fields?: Record<string, unknown> } | undefined;
    return new Set(['id', ...Object.keys(registered?.fields ?? {})]);
  };
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(name: string, ast: { where?: unknown } | undefined) {
      if (name === 'sys_organization') return [{ id: 'org_reg' }];
      const columns = columnsOf(name);
      const missing = filteredColumns(ast?.where).find((column) => !columns.has(column));
      if (missing !== undefined) {
        throw Object.assign(
          new Error(`A filter on object '${name}' names a column the database could not resolve (${missing}).`),
          { code: 'INVALID_FILTER', status: 400 },
        );
      }
      return [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(_name: string, data: Record<string, unknown>) { return { id: 'r_1', ...data }; },
    async update(_name: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async delete() { return true; },
    async bulkCreate(_name: string, rows: unknown[]) { return rows; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async syncSchema() {},
  };

  engine.registerDriver(driver as unknown as Parameters<ObjectQL['registerDriver']>[0], true);
  await engine.init();
  engine.registry.registerObject(object as unknown as Parameters<ObjectQL['registry']['registerObject']>[0], PACKAGE_ID);
  engine.registry.registerObject(ORG_OBJECT as unknown as Parameters<ObjectQL['registry']['registerObject']>[0], PACKAGE_ID);

  const find = vi.spyOn(engine, 'find');
  return {
    engine,
    /** The `where` of every candidate read the reaper issued through the engine. */
    reapReads: () =>
      find.mock.calls.filter((call) => call[0] === 'sys_job_run').map((call) => (call[1] as { where?: unknown } | undefined)?.where),
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

describe('LifecycleService.sweep — an object with no tenant column has no tenant partition (#15207)', () => {
  it('premise: the registered object has no organization_id, and a filter on it is refused by the driver', async () => {
    const box = await lifecycleEngine(COLUMN_LESS);

    const registered = box.engine.registry.getObject('sys_job_run') as { fields?: Record<string, unknown> } | undefined;
    expect(Object.keys(registered?.fields ?? {})).not.toContain('organization_id');
    const refusal = await box.engine
      .find('sys_job_run', { where: { organization_id: 'org_reg' }, context: { isSystem: true } })
      .then(() => undefined, (error: unknown) => error as { code?: unknown; status?: unknown });
    expect(refusal?.code).toBe('INVALID_FILTER');
    expect(refusal?.status).toBe(400);
  });

  it('a tenant-scope retention override on a column-less object: one global pass, no INVALID_FILTER, no tenant window', async () => {
    const box = await lifecycleEngine(COLUMN_LESS);

    const report = await sweepOnce(box.engine);

    expect(report.errors).toEqual([]);
    // One pass at the declared window: the tenant's 90d override is not applied,
    // and no read names the column the table does not have.
    expect(box.reapReads()).toEqual([{ created_at: { $lt: isoCutoff('30d') } }]);
    expect(report.swept).toEqual([
      { object: 'sys_job_run', class: 'telemetry', policy: 'retention', cutoff: isoCutoff('30d'), deleted: 0 },
    ]);
  });

  it('CONTROL: the same object WITH the injected column keeps its per-tenant window', async () => {
    const box = await lifecycleEngine(WITH_COLUMN);

    const report = await sweepOnce(box.engine);

    const registered = box.engine.registry.getObject('sys_job_run') as { fields?: Record<string, unknown> } | undefined;
    expect(Object.keys(registered?.fields ?? {})).toContain('organization_id');
    expect(report.errors).toEqual([]);
    expect(box.reapReads()).toEqual([
      { created_at: { $lt: isoCutoff('90d') }, organization_id: 'org_reg' },
      {
        created_at: { $lt: isoCutoff('30d') },
        $or: [{ organization_id: { $nin: ['org_reg'] } }, { organization_id: null }],
      },
    ]);
  });
});
