// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8686 — the seed loader wrote untenanted rows while the REST path stamped an
 * organization, so ONE single-tenant install ran TWO autonumber scopes and
 * minted duplicate business identifiers with no error and no warning.
 *
 * ## Why this file runs REAL implementations end to end
 *
 * Every part of this defect lives in the seam BETWEEN components, and each
 * component is individually correct:
 *
 *   - the seed loader correctly declines to stamp an organization that does not
 *     exist yet (a fresh install has none — the admin signs up after boot);
 *   - the SQL driver correctly keys its counter by `organization_id`
 *     (`__global__` when NULL), and each counter is correct WITHIN its scope;
 *   - the unique index correctly enforces `(COALESCE(organization_id,
 *     '__global__'), <field>)`, which is what the declaration asks for.
 *
 * Three correct components, one broken outcome. A test built on doubles would
 * have to encode the very disagreement it is meant to detect, so this file uses
 * the real `SeedLoaderService`, a real `ObjectQL` engine and a real `SqlDriver`
 * over better-sqlite3, and asserts on the DATABASE — the stored rows, the
 * `_objectstack_sequences` table, and the duplicate count — rather than on any
 * component's own report of itself.
 *
 * ## What is pinned, and why each case exists separately
 *
 * The 2026-08-15 maintainer ruling settled contract **Option 1** (seed writes
 * carry the organization exactly the way API writes do) and stored-data **shape
 * 2** (a one-shot backfill, single-tenant-guarded). Its three sub-rulings are
 * separate cases here because a fix that satisfied only one would be
 * indistinguishable from a fix that satisfied all three:
 *
 *   1. a FRESH install stops splitting at all (the card's own repro);
 *   2. an EXISTING install is repaired, and the identifiers it already minted
 *      twice are REPORTED, never renumbered;
 *   3. a MULTI-TENANT install is not guessed at — the backfill skips and says so.
 *
 * ⛔ Note what is deliberately NOT asserted anywhere below: nothing about how the
 * allocator picks its next number. That was #6249's remedy and the card
 * demonstrates it cannot work here — both counters are already correct. Every
 * assertion in this file is about which PARTITION a row is in and which counter
 * describes it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  SeedLoaderService,
  backfillSeedTenancy,
  buildSequencesPresenceSql,
  resolveSeedTenancySeam,
  GLOBAL_TENANT,
} from '@objectstack/metadata-protocol';

const ORG_ID = 'org_mssymr19xzd645gv';
const SEEDED_ROWS = 38;

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * The card's own object shape: an autonumber declared `unique` at organization
 * scope, on an object carrying the tenant column. `unique: 'organization'` is
 * what makes the driver materialize the NULL-safe partitioned index (ADR-0120
 * D3) — the index whose two partitions is where the duplicates hide.
 */
const CASE_OBJECT = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text' },
    organization_id: { type: 'text' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: 'organization' },
  },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

function createMetadata(objects: any[]) {
  const byName: Record<string, any> = Object.fromEntries(objects.map((o) => [o.name, o]));
  return {
    getObject: vi.fn(async (n: string) => byName[n]),
    listObjects: vi.fn(async () => objects),
    getObjects: vi.fn(async () => objects),
  } as any;
}

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
  engine.registry.registerObject(CASE_OBJECT, '#8686');
  engine.registry.registerObject(ORG_OBJECT, '#8686');
  await driver.initObjects([CASE_OBJECT, ORG_OBJECT]);
  return { driver, engine };
}

/** Seed the app's declared data on a FRESH database — zero organizations exist. */
async function seedFreshInstall(engine: ObjectQL) {
  const loader = new SeedLoaderService(
    engine as any,
    createMetadata([CASE_OBJECT, ORG_OBJECT]),
    createLogger() as any,
  );
  return loader.load({
    seeds: [
      {
        object: 'crm_case',
        externalId: 'subject',
        records: Array.from({ length: SEEDED_ROWS }, (_, i) => ({ subject: `seeded ${i + 1}` })),
      },
    ],
    config: {},
  } as any);
}

/** The sign-up that first brings an organization into existence. */
const createOrganization = (engine: ObjectQL) =>
  engine.insert('sys_organization', { id: ORG_ID, name: 'Acme' }, { context: { isSystem: true } } as any);

/** One REST-shaped create: an organization is supplied, the number is not. */
const apiCreate = (engine: ObjectQL, subject: string) =>
  engine.insert(
    'crm_case',
    { subject, organization_id: ORG_ID },
    { context: { isSystem: true } } as any,
  );

const readSequences = async (driver: any) =>
  (await driver.knex('_objectstack_sequences').select('tenant_id', 'last_value')).map((r: any) => ({
    tenant: String(r.tenant_id),
    lastValue: Number(r.last_value),
  }));

/** The same rows WITH their scope — a `{field}`/date format runs one per scope. */
const readScopedSequences = async (driver: any) =>
  (await driver.knex('_objectstack_sequences').select('tenant_id', 'scope', 'last_value').orderBy('scope'))
    .map((r: any) => ({
      tenant: String(r.tenant_id),
      scope: String(r.scope),
      lastValue: Number(r.last_value),
    }));

const readDuplicates = async (driver: any) =>
  driver
    .knex('crm_case')
    .select('case_number')
    .count({ holders: '*' })
    .groupBy('case_number')
    .having(driver.knex.raw('count(*) > 1'));

const countUntenanted = async (driver: any) =>
  Number((await driver.knex('crm_case').whereNull('organization_id').count({ n: '*' }))[0].n);

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

describe('#8686 seed/API tenancy split — autonumber scope', () => {
  it('[the defect] a fresh install splits one object across two counters and two partitions', async () => {
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);

    // The seed landed untenanted, because at seed time no organization exists.
    expect(await countUntenanted(driver)).toBe(SEEDED_ROWS);
    expect(await readSequences(driver)).toEqual([{ tenant: GLOBAL_TENANT, lastValue: SEEDED_ROWS }]);

    // The admin signs up; the organization now exists. WITHOUT the handoff, the
    // API path draws from its own empty counter.
    await createOrganization(engine);
    const first = await apiCreate(engine, 'api 1');

    // This is the whole defect in one assertion: a value the seed already used,
    // minted again, with a 201 and no constraint violation.
    expect(first.case_number).toBe('CASE-00001');
    expect(await readSequences(driver)).toEqual([
      { tenant: GLOBAL_TENANT, lastValue: SEEDED_ROWS },
      { tenant: ORG_ID, lastValue: 1 },
    ]);
    expect(await readDuplicates(driver)).toHaveLength(1);
  });

  it('[ruling: option 1] the handoff adopts the seed rows, and the fresh install never duplicates', async () => {
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);
    await createOrganization(engine);

    // The fix: the moment an organization exists, the untenanted seed rows are
    // adopted into it and the `__global__` counter is retired.
    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);
    expect(result.status).toBe('applied');
    expect(result.organizationId).toBe(ORG_ID);
    expect(result.collisions).toEqual([]);

    // Every seeded row now carries the organization — one tenancy contract for
    // both write paths, which is what option 1 says.
    expect(await countUntenanted(driver)).toBe(0);
    // The `__global__` pseudo-tenant is gone as a peer of the real organization
    // — and its HIGH-WATER MARK did not go with it (#12394). This assertion used
    // to read `toEqual([])`, which pinned the defect as if it were the contract:
    // an empty counter table is exactly what sends the driver back into its
    // one-time `MAX(data)` bootstrap.
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: SEEDED_ROWS }]);

    // The API path now continues the SAME sequence instead of restarting it.
    const numbers: string[] = [];
    for (let i = 0; i < 4; i++) numbers.push((await apiCreate(engine, `api ${i + 1}`)).case_number);
    expect(numbers).toEqual(['CASE-00039', 'CASE-00040', 'CASE-00041', 'CASE-00042']);

    // The card's headline symptom, gone.
    expect(await readDuplicates(driver)).toEqual([]);
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: 42 }]);
  });

  it('[ruling: shape 2] an install that ALREADY minted duplicates is repaired, and they are reported not renumbered', async () => {
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);
    await createOrganization(engine);
    // The damage the card measured on 17.0.0 GA, reproduced before repairing it.
    for (let i = 0; i < 4; i++) await apiCreate(engine, `api ${i + 1}`);
    expect(await readDuplicates(driver)).toHaveLength(4);

    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);
    expect(result.status).toBe('applied');

    // Reported — every already-minted duplicate is named, with its holder count.
    expect(result.collisions.map((c) => c.value)).toEqual([
      'CASE-00001',
      'CASE-00002',
      'CASE-00003',
      'CASE-00004',
    ]);
    expect(result.collisions.every((c) => c.rows === 2)).toBe(true);

    // NOT renumbered. The four values still exist exactly twice each: a record
    // number that has already been handed out is not the platform's to rewrite.
    expect(await readDuplicates(driver)).toHaveLength(4);

    // The four colliding seed rows are the ONLY ones left untenanted — they
    // cannot enter the organization partition without renumbering, which is
    // forbidden. The other 34 were adopted.
    expect(await countUntenanted(driver)).toBe(4);

    // The counters are merged at max(last_value) — 38, the seed high-water mark,
    // NOT the API counter's 4 — and the `__global__` row is retired.
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: SEEDED_ROWS }]);

    // And the bleeding stops: the next create takes a genuinely free number.
    expect((await apiCreate(engine, 'after repair')).case_number).toBe('CASE-00039');
    expect(await readDuplicates(driver)).toHaveLength(4); // still four, no new ones
  });

  it('[ruling: idempotent] a second run of the backfill is a no-op', async () => {
    const { engine } = await bootInstall();
    await seedFreshInstall(engine);
    await createOrganization(engine);

    await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);
    const second = await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);

    // Nothing left to detect: the `__global__` counter is gone, so the probe
    // short-circuits before any guard or write is even considered.
    expect(second.status).toBe('no-split');
    expect(second.splits).toEqual([]);
    expect(second.objectsStamped).toBe(0);
  });

  it('[ruling: multi-tenant] a walled install is SKIPPED loudly and its data is left untouched', async () => {
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);
    await createOrganization(engine);

    // The posture the boot banner prints — read from the one protocol-level
    // source, not re-derived. `isolated` is a walled (multi-organization) shape.
    vi.stubEnv('OS_TENANCY_POSTURE', 'isolated');
    const logger = createLogger();
    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), logger as any);

    expect(result.status).toBe('skipped-multi-tenant');
    // Skipping is not silence: the ruling requires the condition AND the remedy.
    const warning = logger.warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warning).toContain('MULTI-ORGANIZATION');
    expect(warning).toContain('backfill skipped');
    expect(warning).toContain('no derivable answer');
    expect(warning).toContain(`UPDATE <object> SET organization_id = '<org id>'`);
    // The split it declined to repair is still named, so the operator can act.
    expect(result.splits.map((s) => `${s.object}.${s.field}`)).toEqual(['crm_case.case_number']);

    // Nothing guessed, nothing moved.
    expect(await countUntenanted(driver)).toBe(SEEDED_ROWS);
    expect(await readSequences(driver)).toEqual([{ tenant: GLOBAL_TENANT, lastValue: SEEDED_ROWS }]);
  });

  it('[ruling: no guessing] a single-tenant install with several organizations is skipped too', async () => {
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);
    await createOrganization(engine);
    await engine.insert(
      'sys_organization',
      { id: 'org_second', name: 'Second' },
      { context: { isSystem: true } } as any,
    );

    const logger = createLogger();
    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), logger as any);

    // The posture says single-tenant but the DATA says otherwise. Two organizations
    // means the owner of an untenanted row is not derivable, whatever the posture
    // claims — so this is a skip, not a coin flip between them.
    expect(result.status).toBe('skipped-ambiguous-organization');
    expect(logger.warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('not ' + 'derivable');
    expect(await countUntenanted(driver)).toBe(SEEDED_ROWS);
  });

  it('[wiring] the app-plugin handoff fires on the organization insert itself', async () => {
    // The tests above call the backfill directly, which pins WHAT it does but not
    // that anything ever calls it on a real install. This case pins the delivery:
    // `sys_organization` gaining its first row is what triggers the adoption, with
    // no restart and no explicit call — the fresh-install half of the fix.
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);

    const { AppPlugin } = await import('./app-plugin.js');
    const ctx = { logger: createLogger() } as any;
    (AppPlugin.prototype as any).registerSeedTenancyHandoff.call({}, ctx, engine);

    expect(await countUntenanted(driver)).toBe(SEEDED_ROWS);

    // The sign-up's organization insert — nothing else.
    await createOrganization(engine);

    expect(await countUntenanted(driver)).toBe(0);
    // Merged into the organization's own row, not deleted along with the
    // `__global__` one (#12394).
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: SEEDED_ROWS }]);
    // And the very first API create on this install already continues the seed's
    // sequence, which is the outcome the card measured going wrong.
    expect((await apiCreate(engine, 'api 1')).case_number).toBe('CASE-00039');
  });

  /**
   * #12394 — the handoff must carry the COUNTER's high-water mark, not the data
   * max. Both cases below BURN a number first, and that is the whole point.
   *
   * ⚠️ A pin that asserts "no duplicates after seed + sign-up + create" is GREEN
   * with and without the defect: with no number burned, the `MAX(data)` rescan
   * the driver falls back to lands on exactly the value the counter held, so the
   * two candidate mechanisms are indistinguishable. Only a burned number — a
   * value the platform has already handed out that no surviving row holds —
   * separates them, and `SqlDriver.getNextSequenceValue`'s own docstring names
   * that state as BY DESIGN ("a rolled-back insert burns a number", and after
   * the one-time bootstrap "the data table is never consulted again").
   *
   * Deleting the highest-numbered row is the stand-in the card measured with:
   * it leaves the counter at 38 and the data max at 37, which is precisely the
   * shape a rolled-back allocation leaves behind.
   */
  it('[#12394] a burned number survives the handoff — the merged counter is written, not destroyed', async () => {
    const { driver, engine } = await bootInstall();
    await seedFreshInstall(engine);

    // Burn the top number. The counter stays at 38; the data max is now 37.
    await (driver as any).knex('crm_case').where({ case_number: 'CASE-00038' }).delete();
    expect(await readSequences(driver)).toEqual([{ tenant: GLOBAL_TENANT, lastValue: SEEDED_ROWS }]);
    const dataMax = String(
      (await (driver as any).knex('crm_case').max({ m: 'case_number' }))[0].m,
    );
    expect(dataMax).toBe('CASE-00037');

    await createOrganization(engine);
    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);
    expect(result.status).toBe('applied');

    // The mechanism: the merged high-water mark is WRITTEN into the
    // organization's own counter row. Before this fix the merge targeted a row
    // that did not exist yet, the `__global__` row was deleted unconditionally,
    // and this table came back empty.
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: SEEDED_ROWS }]);

    // The consequence: CASE-00038 is NOT handed out a second time.
    expect((await apiCreate(engine, 'api 1')).case_number).toBe('CASE-00039');
    expect((await apiCreate(engine, 'api 2')).case_number).toBe('CASE-00040');
  });

  /**
   * #12394, per-scope half — the same handoff on a `{field}`-scoped format.
   *
   * A scoped autonumber runs ONE counter row per rendered prefix, keyed by a
   * `key_hash` over `(object, tenant, field, scope)`. So the merge cannot be
   * scope-blind in either direction: writing one row for the object/field pair
   * would leave every other scope's mark destroyed, and writing a row under the
   * wrong `scope` produces a counter the driver can never find — which reads
   * exactly like the destroyed mark it was supposed to repair.
   *
   * This case is also the cross-package agreement pin for the row key: if the
   * hash this migration computes disagreed with the driver's by one byte, the
   * driver would miss the row, re-enter its `MAX(data)` bootstrap, and re-issue
   * the burned number below.
   */
  it('[#12394] each {field} scope keeps its own high-water mark across the handoff', async () => {
    const ticketObject = {
      name: 'crm_ticket',
      fields: {
        subject: { type: 'text' },
        region: { type: 'text' },
        organization_id: { type: 'text' },
        ticket_no: { type: 'autonumber', format: '{region}-{0000}', unique: 'organization' },
      },
    } as any;

    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    openDrivers.push(driver);
    const engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(ticketObject, '#12394');
    engine.registry.registerObject(ORG_OBJECT, '#12394');
    await driver.initObjects([ticketObject, ORG_OBJECT]);

    // Seed-shaped writes: untenanted, because no organization exists yet.
    const seed = (region: string, n: number) =>
      engine.insert(
        'crm_ticket',
        { subject: `seeded ${region} ${n}`, region },
        { context: { isSystem: true } } as any,
      );
    for (let i = 1; i <= 3; i++) await seed('EU', i);
    for (let i = 1; i <= 2; i++) await seed('US', i);

    // Two independent counters, one per rendered scope.
    expect(await readScopedSequences(driver)).toEqual([
      { tenant: GLOBAL_TENANT, scope: 'EU-', lastValue: 3 },
      { tenant: GLOBAL_TENANT, scope: 'US-', lastValue: 2 },
    ]);

    // Burn the top EU number only. EU data max drops to EU-0002; US is untouched.
    await (driver as any).knex('crm_ticket').where({ ticket_no: 'EU-0003' }).delete();

    await createOrganization(engine);
    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);
    expect(result.status).toBe('applied');

    // Both marks move into the organization, each under its OWN scope.
    expect(await readScopedSequences(driver)).toEqual([
      { tenant: ORG_ID, scope: 'EU-', lastValue: 3 },
      { tenant: ORG_ID, scope: 'US-', lastValue: 2 },
    ]);

    // EU does not re-issue the burned EU-0003, and US continues its own run.
    const eu = await engine.insert(
      'crm_ticket',
      { subject: 'api eu', region: 'EU', organization_id: ORG_ID },
      { context: { isSystem: true } } as any,
    );
    const us = await engine.insert(
      'crm_ticket',
      { subject: 'api us', region: 'US', organization_id: ORG_ID },
      { context: { isSystem: true } } as any,
    );
    expect(eu.ticket_no).toBe('EU-0004');
    expect(us.ticket_no).toBe('US-0003');
  });

  it('[GUARD] platform seeds stay global — sys_/cloud_/ai_ are never adopted', async () => {
    // The seed loader deliberately leaves platform-namespace seeds untenanted.
    // A backfill that adopted them would manufacture a NEW disagreement between
    // the two write paths while claiming to remove one.
    const sysObject = {
      name: 'sys_audit_entry',
      fields: {
        subject: { type: 'text' },
        organization_id: { type: 'text' },
        entry_no: { type: 'autonumber', format: 'AE-{00000}', unique: 'organization' },
      },
    } as any;

    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    openDrivers.push(driver);
    const engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(sysObject, '#8686');
    engine.registry.registerObject(ORG_OBJECT, '#8686');
    await driver.initObjects([sysObject, ORG_OBJECT]);

    // Land untenanted platform rows, then bring an organization into existence.
    for (let i = 0; i < 3; i++) {
      await engine.insert('sys_audit_entry', { subject: `e${i}` }, { context: { isSystem: true } } as any);
    }
    await createOrganization(engine);
    expect(await readSequences(driver)).toEqual([{ tenant: GLOBAL_TENANT, lastValue: 3 }]);

    const result = await backfillSeedTenancy(resolveSeedTenancySeam(engine), createLogger() as any);

    // Seen as no split at all — the platform namespace is filtered before any
    // guard runs, so nothing is adopted and nothing is warned about.
    expect(result.status).toBe('no-split');
    const untenanted = Number(
      (await (driver as any).knex('sys_audit_entry').whereNull('organization_id').count({ n: '*' }))[0].n,
    );
    expect(untenanted).toBe(3);
    expect(await readSequences(driver)).toEqual([{ tenant: GLOBAL_TENANT, lastValue: 3 }]);
  });
  /**
   * #10789 — PRESERVED-BEHAVIOUR control for the `absent`/`no-split` separation.
   *
   * `backfillSeedTenancy` used to answer `no-split` over a seam it never
   * queried: a no-op `execute` returns `null`, `normalizeRows(null)` is `[]`,
   * and zero rows is this module's every-branch no-op. The repair keys the
   * distinction on whether a probe returns a RESULT SET — so this case exists
   * to prove the OTHER side of that key, on the real driver, with real SQL:
   *
   *   - an EMPTY result set is an ANSWER. `buildSequencesPresenceSql` is a
   *     `WHERE 1 = 0` SELECT that matches nothing by construction, and it is the
   *     first thing every boot runs. If "no rows" were read as "no answer", every
   *     healthy SQL install on earth would report `absent` at boot instead of
   *     `no-split` — a fix that satisfied the defect control perfectly and
   *     destroyed the status.
   *   - a real seam with no split rows still reports `no-split`.
   *
   * A hand-built double cannot stand in: the whole question is what
   * better-sqlite3 through knex actually hands back for an empty SELECT, which
   * is a fact about the driver, not about the fixture.
   */
  it('[#10789 preserved] a real seam with no split rows still answers no-split, not absent', async () => {
    const { driver, engine } = await bootInstall();

    // An install that allocated numbers WITH an organization from the first
    // write: `_objectstack_sequences` exists and holds exactly one row, so there
    // is a counter table to read and nothing split across two partitions.
    await createOrganization(engine);
    await apiCreate(engine, 'api 1');
    await apiCreate(engine, 'api 2');
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: 2 }]);

    const seam = resolveSeedTenancySeam(engine);

    // The measurement the separation rests on, taken from the driver itself
    // rather than assumed: the presence probe matches no rows and still comes
    // back as a result set (a bare array, on this dialect).
    const presence = await seam!.exec(buildSequencesPresenceSql(seam!.client));
    expect(Array.isArray(presence)).toBe(true);
    expect(presence).toEqual([]);

    const result = await backfillSeedTenancy(seam, createLogger() as any);

    expect(result.status).toBe('no-split');
    expect(result.detail).toBeUndefined();
    // Nothing moved: the SQL path is untouched by #10789.
    expect(await readSequences(driver)).toEqual([{ tenant: ORG_ID, lastValue: 2 }]);
    expect(await countUntenanted(driver)).toBe(0);
  });
});
