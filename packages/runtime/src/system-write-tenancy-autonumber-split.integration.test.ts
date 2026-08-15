// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8844 — a SYSTEM-context write landed untenanted at RUNTIME, so one
 * single-tenant install kept re-forking the autonumber scope and minting
 * duplicate business identifiers that #8686's backfill could not reach.
 *
 * ## Why this file runs REAL implementations end to end
 *
 * The same reason `seed-tenancy-autonumber-split.integration.test.ts` does, one
 * layer up: every part of this defect lives in the seam BETWEEN components, and
 * each component is individually correct.
 *
 *   - the engine correctly declines to invent an organization for a caller that
 *     supplied none;
 *   - the SQL driver correctly keys its counter by `organization_id`
 *     (`__global__` when NULL), and each counter is correct within its scope;
 *   - the unique index correctly enforces `(COALESCE(organization_id,
 *     '__global__'), <field>)`, which is what the declaration asks for.
 *
 * Three correct components, one broken outcome — so this file uses a real
 * `ObjectQL` engine over a real `SqlDriver` on better-sqlite3, and asserts on
 * the DATABASE: the stored rows, `_objectstack_sequences`, and the duplicate
 * count. `packages/objectql`'s own `system-write-organization.test.ts` pins the
 * decision and the `DriverOptions` seam; this file pins the CONSEQUENCE, which
 * is the thing the card actually reports.
 *
 * ## What is pinned
 *
 * The 2026-08-15 maintainer ruling settled **Option 1** — a system-context
 * write on a tenant-scoped object resolves the install's organization the way a
 * session write does. Its two operative binding points are separate cases here
 * because a fix satisfying one would be indistinguishable from a fix satisfying
 * both:
 *
 *   1. single-tenant ⇒ derive and stamp; the `__global__` fork stops being
 *      minted by hooks, cron and system endpoints;
 *   2. multi-organization ⇒ carry an explicit organization or be REFUSED
 *      LOUDLY; ⛔ never silently default to `__global__`.
 *
 * ⛔ Deliberately NOT asserted anywhere below: anything about how the allocator
 * picks its next number. Both counters are already correct within their own
 * scopes — the defect is upstream of them, and #6249's counter-side remedy is
 * ruled out for exactly that reason. Every assertion here is about which
 * PARTITION a row is in and which counter describes it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const ORG_ID = 'org_msokm9oaz0cal87q';
const SECOND_ORG_ID = 'org_second';
const GLOBAL_TENANT = '__global__';

/**
 * The card's own object: the base table every dispatch category lands in, with
 * an autonumber declared `unique` at organization scope. `unique: 'organization'`
 * is what makes the driver materialize the NULL-safe partitioned index (ADR-0120
 * D3) — the index whose two partitions is where the duplicates hide.
 */
const DISPATCH_ORDER = {
  name: 'dispatch_order',
  fields: {
    subject: { type: 'text' },
    organization_id: { type: 'text' },
    document_no: { type: 'autonumber', format: 'WI-{00000}', unique: 'organization' },
  },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

const openDrivers: SqlDriver[] = [];

async function bootInstall() {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  openDrivers.push(driver);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(DISPATCH_ORDER, '#8844');
  engine.registry.registerObject(ORG_OBJECT, '#8844');
  await driver.initObjects([DISPATCH_ORDER, ORG_OBJECT]);
  return { driver, engine };
}

/** The sign-up that first brings the install's organization into existence. */
const createOrganization = (engine: ObjectQL, id = ORG_ID) =>
  engine.insert('sys_organization', { id, name: id }, { context: { isSystem: true } } as any);

/**
 * The card's first producer: a quality-verdict HOOK / the "maintenance overdue"
 * CRON job. Elevated, unattended, and carrying no organization at all.
 */
const systemWrite = (engine: ObjectQL, subject: string) =>
  engine.insert('dispatch_order', { subject }, { context: { isSystem: true } } as any);

/**
 * The card's second producer: a PLANNER in the Console. A signed-in session
 * carries the active organization on the execution context — nothing is set on
 * the row, exactly as a REST create does it.
 */
const sessionWrite = (engine: ObjectQL, subject: string) =>
  engine.insert(
    'dispatch_order',
    { subject },
    { context: { userId: 'u_planner', tenantId: ORG_ID } } as any,
  );

const readSequences = async (driver: any) =>
  (await driver.knex('_objectstack_sequences').select('tenant_id', 'last_value')).map((r: any) => ({
    tenant: String(r.tenant_id),
    lastValue: Number(r.last_value),
  }));

const readDuplicates = async (driver: any) =>
  driver
    .knex('dispatch_order')
    .select('document_no')
    .count({ holders: '*' })
    .groupBy('document_no')
    .having(driver.knex.raw('count(*) > 1'));

const countUntenanted = async (driver: any) =>
  Number((await driver.knex('dispatch_order').whereNull('organization_id').count({ n: '*' }))[0].n);

afterEach(async () => {
  while (openDrivers.length) {
    const d = openDrivers.pop();
    try {
      await d?.disconnect();
    } catch {
      /* a test that already disconnected is not a failure */
    }
  }
  vi.unstubAllEnvs();
});

describe('#8844 system-context writes — the runtime autonumber fork', () => {
  it('[binding point 1] a single-tenant install runs ONE counter across both producers', async () => {
    const { driver, engine } = await bootInstall();
    await createOrganization(engine);

    // The exact interleaving the card measured on `notification`: a cron job and
    // a user action creating on the same object, alternately.
    const numbers: string[] = [];
    for (let i = 0; i < 5; i++) {
      numbers.push((await systemWrite(engine, `cron ${i}`)).document_no);
      numbers.push((await sessionWrite(engine, `planner ${i}`)).document_no);
    }

    // Every number distinct, in one unbroken run — the two producers are drawing
    // from the same counter instead of two that cannot see each other.
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([
      'WI-00001', 'WI-00002', 'WI-00003', 'WI-00004', 'WI-00005',
      'WI-00006', 'WI-00007', 'WI-00008', 'WI-00009', 'WI-00010',
    ]);

    // ONE sequence row, under the real organization. The `__global__` fork the
    // card reports is simply not minted any more.
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: 10 }]);

    // The system-written rows carry the organization exactly as the session ones
    // do — the ruling's "the way a session write does", asserted on the data.
    expect(await countUntenanted(driver)).toBe(0);

    // The card's headline symptom: two records, same value on a field the app
    // declared unique, no error and no warning.
    expect(await readDuplicates(driver)).toEqual([]);
  });

  it('[binding point 2] a walled install REFUSES the untenanted system write instead of forking', async () => {
    const { driver, engine } = await bootInstall();
    await createOrganization(engine);
    await createOrganization(engine, SECOND_ORG_ID);

    // The posture the boot banner prints, read from the one protocol-level
    // source. `isolated` is a walled (multi-organization) shape, where "the
    // install's organization" is not a thing that exists.
    vi.stubEnv('OS_TENANCY_POSTURE', 'isolated');

    const refusal = await systemWrite(engine, 'unattended cron').catch((e) => e);

    // The ADR-0112 envelope, not merely "it threw": a bare throw assertion would
    // stay green for any unrelated failure on this path.
    expect(refusal.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
    expect(refusal.status).toBe(500);
    expect(refusal.message).toContain('dispatch_order');
    expect(refusal.message).toContain(GLOBAL_TENANT);

    // ⛔ Not defaulted: no row, and — the assertion that distinguishes "refused"
    // from "wrote it under `__global__` and then threw" — no `__global__`
    // counter was allocated either.
    expect(await countUntenanted(driver)).toBe(0);
    expect(await readSequences(driver)).toEqual([]);

    // DISCRIMINATING CONTROL, on the same walled install: a write that CARRIES
    // an organization is not refused. Without this the refusal could be
    // unconditional and every assertion above would still pass.
    const carried = await engine.insert(
      'dispatch_order',
      { subject: 'explicit org' },
      { context: { isSystem: true, tenantId: SECOND_ORG_ID } } as any,
    );
    expect(carried.document_no).toBe('WI-00001');
    expect(await readSequences(driver)).toEqual([{ tenant: SECOND_ORG_ID, lastValue: 1 }]);
  });

  it('[first boot] before any organization exists nothing is refused, and #8686 still adopts the rows', async () => {
    // Seeds and boot-time system writes land before the admin signs up, so there
    // is no organization to derive — and no second partition to fork away from
    // either. Refusing here would refuse first boot itself. This is the case
    // that keeps #8844's refusal from swallowing #8686's handoff seam.
    const { driver, engine } = await bootInstall();

    await systemWrite(engine, 'boot-time');
    expect(await countUntenanted(driver)).toBe(1);
    expect(await readSequences(driver)).toEqual([{ tenant: GLOBAL_TENANT, lastValue: 1 }]);

    // The sign-up arrives; from here on the runtime producer is stamped, which
    // is what stops the split REOPENING after #8686's backfill has closed it.
    await createOrganization(engine);
    await systemWrite(engine, 'after sign-up');
    expect(await countUntenanted(driver)).toBe(1); // still just the boot-time row
    expect(await readSequences(driver)).toEqual([
      { tenant: GLOBAL_TENANT, lastValue: 1 },
      { tenant: ORG_ID, lastValue: 1 },
    ]);
  });

  it('[#8686 regression] the repaired install no longer re-splits on the next system write', async () => {
    // The residual the card is actually about: #8686's backfill leaves a
    // repaired install with ONE counter, and before this fix the very next
    // hook/cron write re-created the `__global__` row and reopened the split —
    // making the backfill self-undoing on any install with automation.
    const { driver, engine } = await bootInstall();
    await createOrganization(engine);
    for (let i = 0; i < 3; i++) await sessionWrite(engine, `seeded ${i}`);
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: 3 }]);

    await systemWrite(engine, 'the next cron tick');

    // Still one counter, continuing the same run — not a second one restarting.
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: 4 }]);
    expect(await readDuplicates(driver)).toEqual([]);
  });
});
