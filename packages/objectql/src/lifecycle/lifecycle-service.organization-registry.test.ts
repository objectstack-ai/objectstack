// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21597] `loadGovernance`'s tenant scan asks the REGISTRY whether
 * `sys_organization` is registered before it reads it.
 *
 * Since commit eb9ef791bd an in-process engine verb refuses an object name the
 * registry does not resolve, with `OBJECT_NOT_FOUND` (404), before any driver
 * is asked. A composition that registers no `sys_organization` therefore no
 * longer reaches a driver with the tenant scan's read: it gets the engine's
 * refusal. That is not a missing table, so the scan's catch rethrew it, and
 * every sweep aborted before applying a single policy.
 *
 * Unregistered is the single-tenant answer. With no organization object there
 * is no tenant to hold an override, and that is the same answer
 * `ObjectQL.probeInstallOrganizations` gives to the same question. What does
 * NOT change is the catch: a missing table on a REGISTERED `sys_organization`
 * is still the one benign driver cause, and every other failure still aborts
 * the sweep (#12853). In particular an `OBJECT_NOT_FOUND` is not read as
 * absence wholesale: the registry already said the object is registered, so a
 * refusal arriving from the read is about something else.
 *
 * Every case runs on a REAL `ObjectQL` engine over a stub driver, so the
 * refusal the guard avoids is the engine's own and not a double's guess at it.
 * `engine.find` is spied with call-through: the spy records what the sweep
 * asked the engine, and the engine still answers.
 */

import { describe, it, expect, vi } from 'vitest';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '../engine.js';
import { LifecycleService } from './lifecycle-service.js';
import { parseLifecycleDuration } from './duration.js';

const FIXED_NOW = 1_700_000_000_000;
const PACKAGE_ID = 'lifecycle-organization-registry';

/** The lifecycle-declared object every sweep below reaps. */
const TELEMETRY_OBJ = {
  name: 'sys_job_run',
  fields: { status: { type: 'text' } },
  lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

/** A system-context read of one row, spelled as a typed query. */
const ORG_PROBE: EngineQueryOptions = { limit: 1, context: { isSystem: true } };

const isoCutoff = (literal: string) => new Date(FIXED_NOW - parseLifecycleDuration(literal)).toISOString();

/** The regulated tenant keeps its rows three times longer than the global window. */
const TENANT_OVERRIDES = { org_reg: { retention_overrides: { sys_job_run: { maxAge: '90d' } } } };

/** Settings service whose only values are tenant-scoped ones. */
function fakeSettings(tenantValues: Record<string, Record<string, unknown>>) {
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

/** A transient database outage, the shape `isMissingTableError` answers `false` for. */
const outage = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

/** The benign unprovisioned table, in the SQLite-family spelling. */
const missingTable = () => new Error('no such table: sys_organization');

const abortedError = (message: string) =>
  `governance snapshot could not be loaded (${message}) — sweep aborted before any policy ` +
  'was applied, so no rows were reaped for this object';

/**
 * A real engine with `sys_job_run` registered, and `sys_organization`
 * registered only when asked. The stub driver answers the organization read
 * with `organizationRead` and every candidate page with no rows.
 */
async function lifecycleEngine(opts: {
  registerOrganization: boolean;
  organizationRead?: () => Array<Record<string, unknown>>;
}) {
  const driverReads: string[] = [];
  const driverDeletes: string[] = [];
  const organizationRead = opts.organizationRead ?? (() => [{ id: 'org_reg' }]);
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string) {
      driverReads.push(object);
      return object === 'sys_organization' ? organizationRead() : [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(_object: string, data: any) { return { id: 'r_1', ...data }; },
    async update(_object: string, id: string, data: any) { return { id, ...data }; },
    async delete(object: string) { driverDeletes.push(object); return true; },
    async bulkCreate(_object: string, rows: any[]) { return rows; },
    async bulkUpdate() { return []; },
    async bulkDelete(object: string) { driverDeletes.push(object); },
    async syncSchema() {},
  } as any;

  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(TELEMETRY_OBJ, PACKAGE_ID);
  if (opts.registerOrganization) engine.registry.registerObject(ORG_OBJECT, PACKAGE_ID);

  const find = vi.spyOn(engine, 'find');
  const callsOn = (object: string) =>
    find.mock.calls.map((call, i) => ({ call, i })).filter(({ call }) => call[0] === object);

  return {
    engine,
    driverReads,
    driverDeletes,
    /** The `where` of every candidate read the reaper issued through the engine. */
    reapReads: () => callsOn('sys_job_run').map(({ call }) => call[1]?.where),
    /** How many times the tenant scan asked the engine for `sys_organization`. */
    orgReads: () => callsOn('sys_organization').length,
    /** What the engine rejected the tenant scan's read with. */
    orgReadRejection: async () => {
      const [first] = callsOn('sys_organization');
      return (find.mock.results[first.i].value as Promise<unknown>).then(
        () => { throw new Error('the tenant scan read resolved; expected a rejection'); },
        (error: unknown) => error as Error & { code?: unknown; status?: unknown; object?: unknown },
      );
    },
  };
}

function sweepOnce(engine: ObjectQL, warn: (msg: string) => void = () => {}) {
  return new LifecycleService({
    getEngine: () => engine,
    logger: { info: () => {}, warn, debug: () => {} },
    now: () => FIXED_NOW,
    initialDelayMs: 1,
    sweepIntervalMs: 10,
    getSettings: () => fakeSettings(TENANT_OVERRIDES),
    referenceAudit: { enabled: false },
  }).sweep();
}

describe('LifecycleService.sweep — the tenant scan asks the registry first (#21597)', () => {
  // ── POSITIVE CONTROL ──────────────────────────────────────────────────────

  it('control: a REGISTERED, provisioned sys_organization is read, and its tenant gets its own window', async () => {
    const box = await lifecycleEngine({ registerOrganization: true });

    const report = await sweepOnce(box.engine);

    // The guard does not skip the scan for a registered object: the read
    // reached the driver, and the tenant pass ran before the global one.
    expect(box.orgReads()).toBe(1);
    expect(box.driverReads.filter((o) => o === 'sys_organization')).toHaveLength(1);
    expect(box.reapReads()).toEqual([
      { created_at: { $lt: isoCutoff('90d') }, organization_id: 'org_reg' },
      {
        created_at: { $lt: isoCutoff('30d') },
        $or: [{ organization_id: { $nin: ['org_reg'] } }, { organization_id: null }],
      },
    ]);
    expect(report.errors).toEqual([]);
  });

  // ── THE DEFECT ────────────────────────────────────────────────────────────

  it('premise: with no sys_organization registered, the engine refuses the read itself', async () => {
    const box = await lifecycleEngine({ registerOrganization: false });

    const refusal = await box.engine
      .find('sys_organization', ORG_PROBE)
      .then(() => undefined, (error: unknown) => error as Error & { code?: unknown; status?: unknown; object?: unknown });

    expect(refusal?.code).toBe('OBJECT_NOT_FOUND');
    expect(refusal?.status).toBe(404);
    expect(refusal?.object).toBe('sys_organization');
    // Refused before any driver was asked: this is not a missing table.
    expect(box.driverReads).toEqual([]);
  });

  it('an UNREGISTERED sys_organization is the single-tenant answer: the sweep runs on the global window', async () => {
    const warn = vi.fn();
    const box = await lifecycleEngine({ registerOrganization: false });

    const report = await sweepOnce(box.engine, warn);

    // The sweep was not aborted. Asserted first so that a regression shows the
    // abort it reported, not a call count.
    expect(report.errors).toEqual([]);
    // The registry answered, so the scan never read: no engine refusal to
    // abort on, and nothing reached the driver for `sys_organization`.
    expect(box.orgReads()).toBe(0);
    expect(box.driverReads.filter((o) => o === 'sys_organization')).toEqual([]);
    // The sweep RAN: one global pass, no tenant pass.
    expect(box.reapReads()).toEqual([{ created_at: { $lt: isoCutoff('30d') } }]);
    expect(report.swept).toEqual([
      { object: 'sys_job_run', class: 'telemetry', policy: 'retention', cutoff: isoCutoff('30d'), deleted: 0 },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  // ── THE BENIGN DRIVER CAUSE IS UNCHANGED ──────────────────────────────────

  it('a REGISTERED but unprovisioned sys_organization keeps the missing-table answer', async () => {
    const box = await lifecycleEngine({
      registerOrganization: true,
      organizationRead: () => { throw missingTable(); },
    });

    const report = await sweepOnce(box.engine);

    // Proof the benign branch was exercised: the scan read, the driver threw.
    expect(box.orgReads()).toBe(1);
    expect(box.driverReads.filter((o) => o === 'sys_organization')).toHaveLength(1);
    expect(box.reapReads()).toEqual([{ created_at: { $lt: isoCutoff('30d') } }]);
    expect(report.errors).toEqual([]);
    expect(report.swept).toHaveLength(1);
  });

  // ── EVERYTHING ELSE STILL ABORTS ──────────────────────────────────────────

  it('a real driver fault on a registered sys_organization still aborts the sweep, with the fault itself', async () => {
    const warn = vi.fn();
    const box = await lifecycleEngine({
      registerOrganization: true,
      organizationRead: () => { throw outage(); },
    });

    const report = await sweepOnce(box.engine, warn);
    const fault = await box.orgReadRejection();

    // The read the sweep aborted on rejected with the driver's own fault.
    expect(fault.code).toBe('ECONNREFUSED');
    expect(fault.message).toContain('ECONNREFUSED');
    // …and that fault, not a swallowed outcome, is what the sweep reports.
    expect(box.reapReads()).toEqual([]);
    expect(box.driverDeletes).toEqual([]);
    expect(report.swept).toEqual([]);
    expect(report.errors).toEqual([{ object: 'sys_job_run', error: abortedError(fault.message) }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`(${fault.message})`);
  });

  it('an OBJECT_NOT_FOUND attributed to ANOTHER object is not read as absence: the sweep aborts', async () => {
    const box = await lifecycleEngine({ registerOrganization: true });
    // A hook on the organization read that itself reads an object this
    // composition never registered — the engine refuses THAT read, and the
    // refusal surfaces from the `sys_organization` scan.
    box.engine.registerHook(
      'beforeFind',
      async () => {
        await box.engine.find('sys_org_unit', ORG_PROBE);
      },
      { object: 'sys_organization' },
    );

    const report = await sweepOnce(box.engine);
    const refusal = await box.orgReadRejection();

    expect(refusal.code).toBe('OBJECT_NOT_FOUND');
    expect(refusal.status).toBe(404);
    expect(refusal.object).toBe('sys_org_unit');
    expect(box.reapReads()).toEqual([]);
    expect(report.swept).toEqual([]);
    expect(report.errors).toEqual([{ object: 'sys_job_run', error: abortedError(refusal.message) }]);
  });
});
