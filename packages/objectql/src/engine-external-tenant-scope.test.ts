// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── The org-scope wall is withheld from FEDERATED objects, and ONLY from them (#7738) ──
//
// `buildDriverOptions` folds the caller's `ExecutionContext.tenantId` into
// `DriverOptions.tenantId` on every read. The SQL driver's `applyTenantScope`
// turns that into `(organization_id = :tenant OR organization_id IS NULL)` —
// the platform's implicit tenant wall. For an ADR-0015 federated object that
// predicate is issued against a table the platform does not own:
//
//   select * from `customers` where (`organization_id` = ? or `organization_id` is null)
//   -- bindings=["org_msoroxgurm6423gz"]
//
// against a remote `customers` whose columns are `id, created_at, updated_at,
// name, email, region, lifetime_value`. On Postgres/MySQL that is a remote SQL
// error; on SQLite the quoted-identifier fallback reinterprets the unresolvable
// identifier as the string literal `'organization_id'`, both disjuncts go
// constant-false, and a correctly-bound external object answers **0 rows, HTTP
// 200** (#7738, measured on the #7737 lane).
//
// ## Why the platform may not scope a federated object at all
//
// Not "because the showcase table happens to lack the column" — because the
// column it detects is **its own**. `applySystemFields`
// (`resolveInjectedSystemColumns`) injects `organization_id` into EVERY object
// it registers, external ones included: there is no `external` branch in that
// derivation. `SqlDriver.registerExternalObject` is DDL-free by design (ADR-0015
// forbids DDL on a remote schema) and runs no `columnInfo` introspection — it
// computes the tenant column from the PLATFORM's field set. So on a federated
// object `organization_id`'s presence is always the platform's injection and
// never evidence about the remote schema, and scoping by it is a guess about a
// table the platform does not own.
//
// ## This file asserts BOTH directions, and the negative one is load-bearing
//
// Withholding the tenant wall is punching a hole in tenant isolation for one
// class of object. A test that proved only the permissive direction — "the
// external read is no longer scoped" — would stay green if the fix withheld
// `tenantId` from EVERY object, which is how a tenant leak ships green. So
// every case below runs `it.each(READ_DOORS)` over an external object AND an
// ordinary one, and the ordinary object must still carry the wall for a normal
// non-system caller.
//
// ## The seam under test is `DriverOptions`, not SQL
//
// `@objectstack/objectql` cannot import `@objectstack/driver-sql` (the
// dependency runs the other way), so this file pins the exact input the
// driver's wall keys off: `applyTenantScope` early-returns an unmodified
// builder when `options.tenantId` is `undefined | null | ''`, and
// `injectTenantOnInsert` does the same. No `tenantId` in DriverOptions is
// precisely "no `organization_id` predicate in the emitted SQL" — and it is
// withheld at the ENGINE rather than in one driver so every driver is covered
// at the source (the same reason `tenancy.enabled: false` is withheld here,
// #3249).

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

/** A normal, non-system caller with an active org — the #7738 repro identity. */
const MEMBER = { userId: 'u_member', tenantId: 'org_msoroxgurm6423gz' } as any;

interface ObservedCall {
  object: string;
  method: string;
  options: Record<string, unknown> | undefined;
}

function makeDriver(name: string, observed: ObservedCall[]) {
  const record = (object: string, method: string, options: any) => {
    observed.push({ object, method, options });
  };
  const driver: any = {
    name,
    version: '0.0.0',
    // No `aggregate` capability: the engine falls back to `find` + in-memory
    // aggregation, which is itself a read door built from buildDriverOptions.
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) { record(object, 'find', options); return []; },
    async findOne(object: string, _ast: any, options: any) { record(object, 'findOne', options); return null; },
    async count(object: string, _ast: any, options: any) { record(object, 'count', options); return 0; },
    async create(object: string, data: any, options: any) { record(object, 'create', options); return { id: 'r_1', ...data }; },
    async update(object: string, id: string, data: any, options: any) { record(object, 'update', options); return { id, ...data }; },
    async delete() { return true; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    // DDL-free federated registration — the ADR-0015 seam `syncObjectSchema`
    // routes an `external != null` object to. Present so this engine takes the
    // real external path rather than the managed one.
    registerExternalObject() {},
    async syncSchema() {},
  };
  return driver;
}

/**
 * The federated object, declared as `examples/app-showcase` declares it: an
 * `external.remoteName` binding, and NO `organization_id` field of its own —
 * the one the registry will nevertheless inject.
 */
const EXTERNAL_OBJECT = {
  name: 'showcase_ext_customer',
  datasource: 'showcase_external',
  external: { remoteName: 'customers' },
  fields: {
    name: { type: 'text' },
    email: { type: 'text' },
    region: { type: 'text' },
  },
} as any;

/** An ordinary managed object. Its wall must not move. */
const MANAGED_OBJECT = {
  name: 'showcase_account',
  fields: {
    name: { type: 'text' },
    region: { type: 'text' },
  },
} as any;

async function makeEngine(opts: { posture?: string } = {}) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  // Two drivers, as the showcase has: the platform's default, and the remote
  // the federated object is bound to by `datasource: 'showcase_external'`. Both
  // record into one log, so a read landing on the wrong one is still observed.
  engine.registerDriver(makeDriver('memory', observed), true);
  engine.registerDriver(makeDriver('showcase_external', observed));
  await engine.init();
  engine.registry.registerObject(EXTERNAL_OBJECT);
  engine.registry.registerObject(MANAGED_OBJECT);
  if (opts.posture) engine.setTenancyPostureProvider(() => opts.posture);
  return { engine, observed };
}

/**
 * The premise every assertion below rests on: the registry injects
 * `organization_id` into the FEDERATED object too. If this ever stops being
 * true the defect changes shape (the driver's implicit detection would no
 * longer fire) and the rest of this file would be pinning a fix for a
 * mechanism that no longer exists — so it is asserted, not assumed.
 */
describe('#7738 premise — the platform injects its tenant column into a federated object', () => {
  it('registers `organization_id` on an external object that declares no such field', async () => {
    const { engine } = await makeEngine();
    const stored = engine.registry.getObject('showcase_ext_customer') as any;
    expect(EXTERNAL_OBJECT.fields.organization_id).toBeUndefined();
    expect(stored.fields.organization_id).toBeDefined();
    expect(stored.external).toEqual({ remoteName: 'customers' });
  });
});

/**
 * Every read door that reaches the driver through `buildDriverOptions`, and the
 * driver method each one lands on. `aggregate` is included and lands on `find`:
 * this driver advertises no native aggregation, so the engine takes its
 * in-memory fallback — which still builds DriverOptions and still sends a read
 * to the remote.
 */
const READ_DOORS = [
  { name: 'find', driverMethod: 'find', run: (e: ObjectQL, o: string, ctx: any) => e.find(o, {}, { context: ctx } as any) },
  // `findOne` refuses a predicate-free query (#4419), so it carries one. The
  // caller's own `where` is orthogonal to the wall this file measures.
  { name: 'findOne', driverMethod: 'findOne', run: (e: ObjectQL, o: string, ctx: any) => e.findOne(o, { where: { region: 'EU' } }, { context: ctx } as any) },
  { name: 'count', driverMethod: 'count', run: (e: ObjectQL, o: string, ctx: any) => e.count(o, {}, { context: ctx } as any) },
  { name: 'aggregate', driverMethod: 'find', run: (e: ObjectQL, o: string, ctx: any) => e.aggregate(o, { aggregations: [{ function: 'count', field: 'id', alias: 'n' }] } as any, { context: ctx } as any) },
] as const;

describe('#7738 — a federated read carries NO org-scope predicate', () => {
  it.each(READ_DOORS)(
    '$name: DriverOptions for an external object omit tenantId',
    async ({ driverMethod, run }) => {
      const { engine, observed } = await makeEngine();
      await run(engine, 'showcase_ext_customer', MEMBER);

      const call = observed.find((c) => c.object === 'showcase_ext_customer' && c.method === driverMethod);
      expect(call, `driver.${driverMethod} was never reached`).toBeDefined();
      // `applyTenantScope` early-returns on undefined/null/'' — any of the
      // three means no `organization_id` predicate reaches the remote.
      expect(call!.options?.tenantId ?? undefined).toBeUndefined();
      // The `group`-posture union (`IN (...) OR IS NULL`) is the SAME predicate
      // on the same absent column, so it must not survive either.
      expect(call!.options?.tenantIds ?? undefined).toBeUndefined();
    },
  );

  it('withholds the tenantIds union too under the `group` posture', async () => {
    const { engine, observed } = await makeEngine({ posture: 'group' });
    await engine.find(
      'showcase_ext_customer',
      {},
      { context: { ...MEMBER, accessible_org_ids: ['org_a', 'org_b'] } } as any,
    );
    const call = observed.find((c) => c.object === 'showcase_ext_customer' && c.method === 'find');
    expect(call!.options?.tenantId ?? undefined).toBeUndefined();
    expect(call!.options?.tenantIds ?? undefined).toBeUndefined();
  });
});

// ── The load-bearing half ────────────────────────────────────────────────────
//
// If the fix over-reaches, THIS is what goes red — not the block above. A
// change to an implicit tenant wall that only tests the permissive direction is
// how a leak ships green, so these cases are the reason this file exists.
describe('#7738 non-regression — an ORDINARY object is still org-scoped', () => {
  it.each(READ_DOORS)(
    '$name: DriverOptions for a managed object still carry tenantId for a non-system caller',
    async ({ driverMethod, run }) => {
      const { engine, observed } = await makeEngine();
      await run(engine, 'showcase_account', MEMBER);

      const call = observed.find((c) => c.object === 'showcase_account' && c.method === driverMethod);
      expect(call, `driver.${driverMethod} was never reached`).toBeDefined();
      expect(call!.options?.tenantId).toBe('org_msoroxgurm6423gz');
    },
  );

  it('still threads the `group`-posture tenantIds union for a managed object', async () => {
    const { engine, observed } = await makeEngine({ posture: 'group' });
    await engine.find(
      'showcase_account',
      {},
      { context: { ...MEMBER, accessible_org_ids: ['org_a', 'org_b'] } } as any,
    );
    const call = observed.find((c) => c.object === 'showcase_account' && c.method === 'find');
    expect(call!.options?.tenantId).toBe('org_msoroxgurm6423gz');
    expect(call!.options?.tenantIds).toEqual(['org_a', 'org_b']);
  });

  it('still stamps the tenant column on an ordinary WRITE', async () => {
    // The write half of the same wall (`injectTenantOnInsert`) reads the same
    // `DriverOptions.tenantId`. The read-path exemption must not reach it.
    const { engine, observed } = await makeEngine();
    await engine.insert('showcase_account', { name: 'A-1' }, { context: MEMBER } as any);
    const call = observed.find((c) => c.object === 'showcase_account' && c.method === 'create');
    expect(call!.options?.tenantId).toBe('org_msoroxgurm6423gz');
  });

  it('leaves the pre-existing `tenancy.enabled: false` exemption exactly as it was', async () => {
    // ADR-0066 / #3249. A second, older reason to withhold the wall — asserted
    // here so the federation exemption is proved to be an ADDITION to it and
    // not a rewrite of it.
    const { engine, observed } = await makeEngine();
    engine.registry.registerObject({
      name: 'sys_license_probe',
      tenancy: { enabled: false },
      fields: { name: { type: 'text' } },
    } as any);
    await engine.find('sys_license_probe', {}, { context: MEMBER } as any);
    const call = observed.find((c) => c.object === 'sys_license_probe' && c.method === 'find');
    expect(call!.options?.tenantId ?? undefined).toBeUndefined();
  });
});

describe('#7738 — an explicitly-passed tenantId is still deliberate caller intent', () => {
  it('does not strip a tenantId the caller passed by name', async () => {
    // On `find`/`findOne`/`update`/`delete` the option bag IS the base of the
    // driver options (`ENGINE_DRIVER_PASSTHROUGH_KEYS`, #4371), and
    // `buildDriverOptions` documents that an explicit `base.tenantId` wins.
    //
    // The federation exemption governs what the engine FOLDS IN from the
    // execution context; it is not a scrubber for what a caller asked for by
    // name — a caller who names the column has asserted something about the
    // remote that the engine has no standing to contradict. This is also
    // exactly how the older `tenancy.enabled: false` exemption behaves, so the
    // two stay one shape rather than two.
    const { engine, observed } = await makeEngine();
    await engine.find('showcase_ext_customer', { tenantId: 'org_explicit' } as any, { context: MEMBER } as any);
    const call = observed.find((c) => c.object === 'showcase_ext_customer' && c.method === 'find');
    expect(call!.options?.tenantId ?? undefined).toBe('org_explicit');
  });
});
