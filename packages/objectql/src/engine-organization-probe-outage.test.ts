// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9261 — a FAILED `sys_organization` probe must not be indistinguishable from
 * "this install has no organizations yet".
 *
 * `probeInstallOrganizations` answers the one question
 * `resolveSystemWriteOrganization` decides on (#8844): 0 organizations ⇒ the
 * system insert proceeds UNSTAMPED, 1 ⇒ stamp the derived id, 2+ ⇒ REFUSE with
 * `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`. Its read used to sit behind a bare
 * `} catch { ids = [] }`, so every failure — connection drop, pool exhaustion,
 * a timeout mid-boot — was answered with the count that means "none". Both
 * halves of the ruling then became silently skippable: on a `single` install
 * with one organization the rows land untenanted and fork the autonumber
 * counter the ruling exists to protect, and on a multi-organization install the
 * mandated refusal never fires. ADR-0110 D3: the probe finding nothing and the
 * probe being unable to run are different facts.
 *
 * ⚠️ Aggravator, pinned separately below: the answer is MEMOISED. One transient
 * failure pinned "no organizations" for every later system write until an
 * organization write happened to clear it — so the outage's consequence
 * outlived the outage.
 *
 * ## What is benign here, MEASURED rather than assumed
 *
 * The card and the old comment both name "`sys_organization` may not be
 * registered at all (a lean embedding, a bare-kernel test)" as the benign
 * reason, and the dispatch expected the benign case to be TWO distinct errors.
 * Measured on this seam it is ONE, and it is not the one they name — so this
 * file pins the measurement, not the expectation:
 *
 *  - an object missing from the REGISTRY does not fail the read at all when the
 *    driver tolerates an unknown table — `find` returns `[]` through the normal
 *    path and never reaches the catch (pinned below, so a future predicate is
 *    not written against a case that cannot occur);
 *  - a strict driver surfaces that same install as a MISSING TABLE, which IS the
 *    benign cause, named by the shared `isMissingTableError` predicate
 *    (`@objectstack/metadata/errors`, #4825);
 *  - and the "no driver at all" install cannot reach the probe. `getDriver`
 *    answers every object from the default driver, which the FIRST
 *    `registerDriver` always sets (`isDefault || drivers.size === 1`) and which
 *    nothing ever clears — no driver is ever removed — so the only engine whose
 *    routing fails for `sys_organization` is one with no drivers, where the
 *    write that would have asked already failed on its own object. Pinned below
 *    with that error as the positive control, so "we did not need a second
 *    predicate" is a measurement rather than an omission.
 *
 * Both directions are pinned in the same cases deliberately. A file that pinned
 * only the propagation would stay green if the probe threw on every install,
 * and one that pinned only the benign empties would stay green if the fix had
 * never landed.
 */

import { describe, it, expect } from 'vitest';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

const ORG_ID = 'org_msokm9oaz0cal87q';
const SECOND_ORG_ID = 'org_second';
const PACKAGE_ID = '#9261';

/** The card's producer: a hook / cron write, elevated, carrying no organization. */
const SYSTEM_CTX: ExecutionContext = { isSystem: true } as ExecutionContext;

/** An application object the #8844 ruling judges: tenant-scoped, org-scoped counter. */
const DISPATCH_ORDER = {
  name: 'dispatch_order',
  fields: {
    subject: { type: 'text' },
    document_no: { type: 'autonumber', format: 'WI-{00000}', unique: 'organization' },
  },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

interface ObservedWrite {
  object: string;
  method: string;
  data: any;
  options: Record<string, unknown> | undefined;
}

/** A transient database outage: the shape `isMissingTableError` must answer `false` for. */
const outage = () =>
  Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

/** The benign unprovisioned table, in the SQLite-family spelling #4825 recognises. */
const missingTable = () => new Error('no such table: sys_organization');

function makeDriver(
  observed: ObservedWrite[],
  organizationFind: () => any[],
  name = 'memory',
) {
  const record = (object: string, method: string, data: any, options: any) =>
    observed.push({ object, method, data, options });
  return {
    name,
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      record(object, 'find', undefined, options);
      return object === 'sys_organization' ? organizationFind() : [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(object: string, data: any, options: any) {
      record(object, 'create', data, options);
      return { id: 'r_1', ...data };
    },
    async update(object: string, id: string, data: any, options: any) {
      record(object, 'update', data, options); return { id, ...data };
    },
    async delete() { return true; },
    async bulkCreate(object: string, rows: any[], options: any) {
      record(object, 'bulkCreate', rows, options);
      return rows.map((r, i) => ({ id: `r_${i + 1}`, ...r }));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  } as any;
}

async function makeEngine(opts: {
  organizationFind?: () => any[];
  registerOrganizationObject?: boolean;
} = {}) {
  const observed: ObservedWrite[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed, opts.organizationFind ?? (() => [{ id: ORG_ID }])), true);
  await engine.init();
  engine.registry.registerObject(DISPATCH_ORDER, PACKAGE_ID);
  if (opts.registerOrganizationObject !== false) engine.registry.registerObject(ORG_OBJECT, PACKAGE_ID);
  // The seam under test only runs on the `single` posture — a walled install is
  // refused without asking the database anything.
  engine.setTenancyPostureProvider(() => 'single');
  return { engine, observed };
}

const lastWrite = (observed: ObservedWrite[], object: string) =>
  [...observed].reverse().find((c) => c.object === object && c.method !== 'find');

const systemInsert = (engine: ObjectQL, subject: string) =>
  engine.insert('dispatch_order', { subject }, { context: SYSTEM_CTX } as any);

/** The probe's own read, spelled exactly as `probeInstallOrganizations` issues it. */
const PROBE_QUERY: EngineQueryOptions = { fields: ['id'], limit: 2, context: { isSystem: true } };

describe('#9261 a non-benign probe failure no longer becomes "no organizations"', () => {
  it('propagates the outage instead of proceeding unstamped, and writes nothing', async () => {
    // The `single` install that HAS one organization — the ruling requires the
    // derived stamp. Before the fix the outage answered 0 and the row landed
    // untenanted on the `__global__` counter partition.
    const { engine, observed } = await makeEngine({ organizationFind: () => { throw outage(); } });

    const failure = await systemInsert(engine, 'during the outage').catch((e) => e);

    // The probe's OWN failure, envelope intact — no new code, no new field.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as any).code).toBe('ECONNREFUSED');
    expect((failure as Error).message).toContain('ECONNREFUSED');
    // ⛔ Not filed under a guessed topology: nothing reached the driver.
    expect(observed.filter((c) => c.object === 'dispatch_order')).toEqual([]);
  });

  it('does not silently skip the multi-organization REFUSAL', async () => {
    // The #8895 shape: fail-open on a guard the ruling says must be loud. A
    // walled/ambiguous install whose probe fails must not be told "0, proceed".
    const { engine, observed } = await makeEngine({ organizationFind: () => { throw outage(); } });
    const failure = await systemInsert(engine, 'ambiguous install, outage').catch((e) => e);

    // It fails — and it fails as the OUTAGE, not as the refusal, because the
    // topology was never measured. Either way the write does not proceed.
    expect((failure as any).code).toBe('ECONNREFUSED');
    expect((failure as any).code).not.toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
    expect(observed.filter((c) => c.object === 'dispatch_order')).toEqual([]);

    // DISCRIMINATING CONTROL — the same install with a probe that WORKS still
    // reaches the ruling's refusal, so the case above is about the outage and
    // not about the refusal having been broken.
    const healthy = await makeEngine({ organizationFind: () => [{ id: ORG_ID }, { id: SECOND_ORG_ID }] });
    const refusal = await systemInsert(healthy.engine, 'ambiguous install, healthy').catch((e) => e);
    expect((refusal as any).code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
    expect((refusal as any).status).toBe(500);
    expect((refusal as any).reason).toBe('ambiguous-organization');
  });

  it('⛔ does NOT memoise a failure — the outage does not outlive itself', async () => {
    // The aggravator. One transient failure used to pin "no organizations" for
    // every later system write until an organization write cleared the memo.
    let failing = true;
    const { engine, observed } = await makeEngine({
      organizationFind: () => { if (failing) throw outage(); return [{ id: ORG_ID }]; },
    });

    await expect(systemInsert(engine, 'during')).rejects.toThrow(/ECONNREFUSED/);

    failing = false;
    await systemInsert(engine, 'after recovery');

    // The very next write re-probes and gets the truth — the stamp the #8844
    // ruling requires, not the guess the outage would have cached.
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(ORG_ID);
    // Two probes: the failed one and the repair. A memoised failure would show one.
    expect(observed.filter((c) => c.object === 'sys_organization' && c.method === 'find')).toHaveLength(2);
  });
});

describe('#9261 the benign causes still answer the empty probe', () => {
  it('[cause 2] an unprovisioned `sys_organization` table proceeds unstamped', async () => {
    // Schema sync has not run; the table cannot hold a row, so zero IS the
    // measurement and first boot must not be refused.
    const { engine, observed } = await makeEngine({ organizationFind: () => { throw missingTable(); } });
    await systemInsert(engine, 'first boot');
    expect(lastWrite(observed, 'dispatch_order')?.method).toBe('create');
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBeUndefined();
  });

  it('an UNROUTABLE organization object never reaches the probe, so it needs no predicate', async () => {
    // Why `isMissingTableError` alone is not a fail-CLOSED regression. An engine
    // that cannot route `sys_organization` raises a bare `No driver available`,
    // which that predicate answers `false` for — it would propagate. It is not
    // discriminated because it cannot occur on this path: the ONLY engine whose
    // routing fails for `sys_organization` is one with no drivers at all, and
    // there the write that would have asked fails on its OWN object first.
    const engine = new ObjectQL();
    await engine.init();
    engine.registry.registerObject(DISPATCH_ORDER, PACKAGE_ID);
    engine.registry.registerObject(ORG_OBJECT, PACKAGE_ID);
    engine.setTenancyPostureProvider(() => 'single');

    // POSITIVE CONTROL — the unroutable read really does raise that error, and
    // it really is outside the benign predicate. Without this the case below
    // would be a zero-hit measurement of nothing.
    const unroutable = await engine.find('sys_organization', PROBE_QUERY).catch((e) => e);
    expect((unroutable as Error).message).toContain("No driver available for object 'sys_organization'");

    // …and the system insert stops on `dispatch_order`, one frame BEFORE the
    // probe would have run.
    const failure = await engine
      .insert('dispatch_order', { subject: 'bare kernel' }, { context: SYSTEM_CTX } as any)
      .catch((e) => e);
    expect((failure as Error).message).toContain("No driver available for object 'dispatch_order'");
  });

  it('an object missing from the REGISTRY never reaches the catch on a tolerant driver', async () => {
    // Pinned so the next author does not write a predicate against a case that
    // cannot occur: the read succeeds and returns `[]` through the NORMAL path.
    const { engine, observed } = await makeEngine({
      registerOrganizationObject: false,
      organizationFind: () => [],
    });
    await systemInsert(engine, 'unregistered organization object');
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBeUndefined();
    // The control: the read really did happen (it is not the structural branch).
    expect(observed.filter((c) => c.object === 'sys_organization' && c.method === 'find')).toHaveLength(1);
  });

  it('a healthy probe is unchanged — one organization is still stamped, and memoised', async () => {
    // The discriminating control for this whole file: the fix must not have
    // narrowed the ordinary path.
    const { engine, observed } = await makeEngine({ organizationFind: () => [{ id: ORG_ID }] });
    await systemInsert(engine, 'a');
    await systemInsert(engine, 'b');
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(ORG_ID);
    expect(observed.filter((c) => c.object === 'sys_organization' && c.method === 'find')).toHaveLength(1);
  });
});
