// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE `TursoDriver`, ONE row set per tenant-scoped call: every door that reads
 * rows or picks rows to write answers the SAME rows on the remote (libSQL) face
 * as on the local face, and `create` stamps the caller's organization on both.
 *
 * # The class
 *
 * The engine hands every driver the caller's organization as
 * `DriverOptions.tenantId` (ADR-0131 D8), and the group posture's membership
 * set as `tenantIds`. On the local face `SqlDriver.applyTenantScope` puts that
 * on every read and on every update and delete predicate, and
 * `injectTenantOnInsert` stamps it on a new row. The remote face compiles its
 * own statements in `RemoteTransport`, and its doors used to receive no
 * `DriverOptions` at all: their statements carried the caller's filter and
 * nothing else. Only `distinct()` refused a scoped call.
 *
 * What reaches the driver here is the shape the engine sends when nothing above
 * the driver composes a tenant predicate: the posture in which Layer 0 is
 * inert, and an elevated caller that carries its organization (whose options
 * may also carry `bypassTenantAudit`, which mutes the audit and not the scope).
 * There the driver scope is the only fence.
 *
 * # What is asserted
 *
 * For each door, on both faces, a call scoped to one organization against
 * another organization's rows: excluded, `null`, `false`, `0` or untouched on
 * disk, and the scoped call's same-organization control answers as an unscoped
 * call would. A platform row (no organization) is inside the scope on both
 * faces: that is the chokepoint's NULL-organization arm, kept by construction
 * because the remote face compiles the chokepoint's own predicate. The final
 * test runs one script on both faces and requires equal answers, and that the
 * answers they agree on are the scoped ones.
 *
 * The local face reaches this package through the BUILT
 * `@objectstack/driver-sql` (no vitest alias to `src`), so a change to
 * `sql-driver.ts` is seen here only after that package is rebuilt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DriverOptions } from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const CALLER_ORG = 'org_os21226_caller';
const OTHER_ORG = 'org_os21226_other';
const THIRD_ORG = 'org_os21226_third';

const LEDGER = {
  name: 'os21226_ledger',
  fields: {
    organization_id: { type: 'string' },
    title: { type: 'string' },
    amount: { type: 'number' },
  },
} as const;

const SEED = [
  { id: 'own_1', organization_id: CALLER_ORG, title: 'own one', amount: 10 },
  { id: 'own_2', organization_id: CALLER_ORG, title: 'own two', amount: 20 },
  { id: 'other_1', organization_id: OTHER_ORG, title: 'other one', amount: 100 },
  { id: 'other_2', organization_id: OTHER_ORG, title: 'other two', amount: 200 },
  { id: 'third_1', organization_id: THIRD_ORG, title: 'third one', amount: 300 },
  { id: 'platform_1', organization_id: null, title: 'platform', amount: 1000 },
] as const;

const OTHER_IDS = ['other_1', 'other_2', 'third_1'];

/** What a scoped call to the caller's organization may reach. */
const IN_SCOPE_IDS = ['own_1', 'own_2', 'platform_1'];

/** The two scoped option shapes the engine sends with no Layer 0 predicate above the driver. */
const SCOPED_SHAPES: ReadonlyArray<[string, DriverOptions]> = [
  ['tenantId', { tenantId: CALLER_ORG }],
  ['tenantId with bypassTenantAudit', { tenantId: CALLER_ORG, bypassTenantAudit: true }],
];
const SCOPED: DriverOptions = { tenantId: CALLER_ORG };
const UNSCOPED: DriverOptions = { bypassTenantAudit: true };

type Face = 'local' | 'remote';
const FACES: readonly Face[] = ['local', 'remote'];

type Row = Record<string, unknown>;

const ids = (rows: ReadonlyArray<Row>): string[] => rows.map((r) => String(r.id)).sort();

const captureError = async (run: () => Promise<unknown>): Promise<WireBearingError | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as WireBearingError;
  }
};

describe('a tenant-scoped call on BOTH TursoDriver faces answers one row set', () => {
  let drivers: Record<Face, TursoDriver>;
  let stub: LibsqlSqliteStub;

  /** Every stored row, raw from the face's own database, in a stable order. */
  const snapshot = async (face: Face): Promise<Row[]> => {
    const rows: Row[] =
      face === 'remote'
        ? stub.raw.prepare(`SELECT "id", "organization_id", "title", "amount" FROM "${LEDGER.name}" ORDER BY "id"`).all()
        : await (drivers.local as any).knex(LEDGER.name).select('id', 'organization_id', 'title', 'amount').orderBy('id');
    return rows.map((r) => JSON.parse(JSON.stringify(r)));
  };

  const rawRow = async (face: Face, id: string): Promise<Row | undefined> =>
    (await snapshot(face)).find((r) => r.id === id);

  beforeEach(async () => {
    const local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');

    stub = makeLibsqlSqliteStub();
    const remote = new TursoDriver({ url: 'libsql://tenant-scope-parity.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');

    drivers = { local, remote };
    for (const driver of Object.values(drivers)) {
      await driver.initObjects([{ ...LEDGER, fields: { ...LEDGER.fields } }]);
      for (const row of SEED) await driver.create(LEDGER.name, { ...row }, UNSCOPED);
    }
  });

  afterEach(async () => {
    await drivers.local.disconnect();
    await drivers.remote.disconnect();
    stub.close();
  });

  for (const face of FACES) {
    describe(`the ${face} face`, () => {
      it('control: the seed landed with each row\'s own organization', async () => {
        const stored = await snapshot(face);
        expect(stored.map((r) => [r.id, r.organization_id])).toEqual(
          [...SEED].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, r.organization_id]),
        );
      });

      for (const [shape, options] of SCOPED_SHAPES) {
        it(`find answers the caller's organization and platform rows only (${shape})`, async () => {
          const driver = drivers[face];
          expect(ids(await driver.find(LEDGER.name, {}, options))).toEqual(IN_SCOPE_IDS);
          // A filter naming another organization's rows still answers none.
          expect(await driver.find(LEDGER.name, { where: { title: 'other one' } }, options)).toEqual([]);
        });
      }

      it("find: a top-level `$or` in the caller's filter does not escape the scope", async () => {
        const driver = drivers[face];
        const rows = await driver.find(
          LEDGER.name,
          { where: { $or: [{ title: 'other one' }, { title: 'own one' }] } },
          SCOPED,
        );
        expect(ids(rows)).toEqual(['own_1']);
      });

      it("findOne answers null for another organization's row, and the caller's own row as before", async () => {
        const driver = drivers[face];
        for (const id of OTHER_IDS) {
          expect(await driver.findOne(LEDGER.name, { where: { id } }, SCOPED)).toBeNull();
        }
        expect((await driver.findOne(LEDGER.name, { where: { id: 'own_1' } }, SCOPED))?.title).toBe('own one');
      });

      it('count counts the scoped rows only', async () => {
        const driver = drivers[face];
        expect(await driver.count(LEDGER.name, {}, SCOPED)).toBe(IN_SCOPE_IDS.length);
        expect(await driver.count(LEDGER.name, { where: { title: 'other one' } }, SCOPED)).toBe(0);
        expect(await driver.count(LEDGER.name, {}, UNSCOPED)).toBe(SEED.length);
      });

      it('aggregate groups the scoped rows only', async () => {
        const driver = drivers[face];
        const total = await driver.aggregate(
          LEDGER.name,
          { aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] } as never,
          SCOPED,
        );
        expect(Number(total[0]?.total)).toBe(10 + 20 + 1000);

        const grouped = await driver.aggregate(
          LEDGER.name,
          { groupBy: ['organization_id'], aggregations: [{ function: 'count', alias: 'n' }] } as never,
          SCOPED,
        );
        const groups = grouped.map((g) => g.organization_id ?? null);
        expect(groups).not.toContain(OTHER_ORG);
        expect(groups).not.toContain(THIRD_ORG);
        expect(groups).toContain(CALLER_ORG);
      });

      it("update answers null for another organization's row and leaves it unchanged; the caller's own row updates", async () => {
        const driver = drivers[face];
        const before = await rawRow(face, 'other_1');
        expect(await driver.update(LEDGER.name, 'other_1', { title: 'overwritten?' }, SCOPED)).toBeNull();
        expect(await rawRow(face, 'other_1')).toEqual(before);

        const own = await driver.update(LEDGER.name, 'own_1', { title: 'updated' }, SCOPED);
        expect(own?.title).toBe('updated');
        expect((await rawRow(face, 'own_1'))?.title).toBe('updated');
      });

      it("delete answers false for another organization's row and leaves it; the caller's own row is deleted", async () => {
        const driver = drivers[face];
        expect(await driver.delete(LEDGER.name, 'other_2', SCOPED)).toBe(false);
        expect(await rawRow(face, 'other_2')).toBeDefined();

        expect(await driver.delete(LEDGER.name, 'own_2', SCOPED)).toBe(true);
        expect(await rawRow(face, 'own_2')).toBeUndefined();
      });

      it('updateMany writes the scoped rows only', async () => {
        const driver = drivers[face];
        const affected = await driver.updateMany(LEDGER.name, { where: { amount: { $gte: 0 } } }, { title: 'swept' }, SCOPED);
        expect(affected).toBe(IN_SCOPE_IDS.length);
        const stored = await snapshot(face);
        for (const row of stored) {
          expect(row.title === 'swept', `row ${row.id}`).toBe(IN_SCOPE_IDS.includes(String(row.id)));
        }
      });

      it('deleteMany deletes the scoped rows only', async () => {
        const driver = drivers[face];
        expect(await driver.deleteMany(LEDGER.name, { where: { title: 'other one' } }, SCOPED)).toBe(0);
        expect(await rawRow(face, 'other_1')).toBeDefined();

        expect(await driver.deleteMany(LEDGER.name, { where: { amount: { $gte: 0 } } }, SCOPED)).toBe(IN_SCOPE_IDS.length);
        expect(ids(await snapshot(face))).toEqual([...OTHER_IDS].sort());
      });

      it("bulkUpdate answers and writes the caller's rows only", async () => {
        const driver = drivers[face];
        const before = await rawRow(face, 'other_1');
        const updated = await driver.bulkUpdate(
          LEDGER.name,
          [
            { id: 'other_1', data: { title: 'overwritten?' } },
            { id: 'own_1', data: { title: 'bulk updated' } },
          ],
          SCOPED,
        );
        expect(ids(updated)).toEqual(['own_1']);
        expect(await rawRow(face, 'other_1')).toEqual(before);
        expect((await rawRow(face, 'own_1'))?.title).toBe('bulk updated');
      });

      it("bulkDelete deletes the caller's rows only", async () => {
        const driver = drivers[face];
        await driver.bulkDelete(LEDGER.name, ['other_1', 'third_1', 'own_2'], SCOPED);
        expect(await rawRow(face, 'other_1')).toBeDefined();
        expect(await rawRow(face, 'third_1')).toBeDefined();
        expect(await rawRow(face, 'own_2')).toBeUndefined();
      });

      it("create stamps the caller's organization on the row, and keeps an explicit one", async () => {
        const driver = drivers[face];
        const created = await driver.create(LEDGER.name, { id: 'new_1', title: 'new', amount: 1 }, SCOPED);
        expect(created.organization_id).toBe(CALLER_ORG);
        expect((await rawRow(face, 'new_1'))?.organization_id).toBe(CALLER_ORG);

        await driver.create(
          LEDGER.name,
          { id: 'new_2', title: 'explicit', amount: 1, organization_id: THIRD_ORG },
          SCOPED,
        );
        expect((await rawRow(face, 'new_2'))?.organization_id).toBe(THIRD_ORG);
      });

      it("bulkCreate stamps the caller's organization on every row", async () => {
        const driver = drivers[face];
        await driver.bulkCreate(
          LEDGER.name,
          [
            { id: 'bulk_1', title: 'bulk one', amount: 1 },
            { id: 'bulk_2', title: 'bulk two', amount: 2 },
          ],
          SCOPED,
        );
        expect((await rawRow(face, 'bulk_1'))?.organization_id).toBe(CALLER_ORG);
        expect((await rawRow(face, 'bulk_2'))?.organization_id).toBe(CALLER_ORG);
      });

      it("the group posture's membership set (`tenantIds`) scopes to the union, and no further", async () => {
        const driver = drivers[face];
        const union: DriverOptions = { tenantId: CALLER_ORG, tenantIds: [CALLER_ORG, THIRD_ORG] };
        expect(ids(await driver.find(LEDGER.name, {}, union))).toEqual([...IN_SCOPE_IDS, 'third_1'].sort());
        expect(await driver.count(LEDGER.name, {}, union)).toBe(IN_SCOPE_IDS.length + 1);
        expect(await driver.update(LEDGER.name, 'other_1', { title: 'overwritten?' }, union)).toBeNull();
        expect((await driver.update(LEDGER.name, 'third_1', { title: 'member write' }, union))?.title).toBe('member write');
      });

      it('control: a call with no tenant context reaches every row, as before', async () => {
        const driver = drivers[face];
        expect(ids(await driver.find(LEDGER.name, {}, UNSCOPED))).toEqual(SEED.map((r) => r.id).sort());
        expect((await driver.findOne(LEDGER.name, { where: { id: 'other_1' } }, UNSCOPED))?.title).toBe('other one');
        expect((await driver.update(LEDGER.name, 'other_1', { title: 'unscoped write' }, UNSCOPED))?.title).toBe(
          'unscoped write',
        );
        expect(await driver.delete(LEDGER.name, 'other_2', UNSCOPED)).toBe(true);
      });
    });
  }

  it('the remote face refuses, rather than sends unscoped, a scope it cannot read', async () => {
    class UnreadableScopeDriver extends TursoDriver {
      protected override applyTenantScope(builder: any, object: string, options?: DriverOptions): any {
        return super.applyTenantScope(builder, object, options).limit(1);
      }
    }
    const driver = new UnreadableScopeDriver({
      url: 'libsql://tenant-scope-parity.turso.io',
      client: asLibsqlClient(stub),
    });
    await driver.connect();
    await driver.initObjects([{ ...LEDGER, fields: { ...LEDGER.fields } }]);
    const before = await snapshot('remote');

    for (const run of [
      () => driver.find(LEDGER.name, {}, SCOPED),
      () => driver.update(LEDGER.name, 'other_1', { title: 'overwritten?' }, SCOPED),
      () => driver.deleteMany(LEDGER.name, {}, SCOPED),
    ]) {
      const err = await captureError(run);
      expect(err, 'the call was answered').not.toBeNull();
      expect(err!.code).toBe('INTERNAL_ERROR');
      expect(err!.status).toBe(500);
    }
    expect(await snapshot('remote')).toEqual(before);
    await driver.disconnect();
  });

  it('both faces give one answer to the same scoped script, and it is the scoped one', async () => {
    const run = async (face: Face) => {
      const driver = drivers[face];
      return {
        found: ids(await driver.find(LEDGER.name, {}, SCOPED)),
        counted: await driver.count(LEDGER.name, {}, SCOPED),
        otherOne: await driver.findOne(LEDGER.name, { where: { id: 'other_1' } }, SCOPED),
        updatedOther: await driver.update(LEDGER.name, 'other_1', { title: 'x' }, SCOPED),
        deletedOther: await driver.delete(LEDGER.name, 'other_2', SCOPED),
        swept: await driver.updateMany(LEDGER.name, { where: { amount: { $gte: 0 } } }, { title: 'swept' }, SCOPED),
        created: (await driver.create(LEDGER.name, { id: 'new_1', title: 'n', amount: 1 }, SCOPED)).organization_id,
        stored: (await snapshot(face)).map((r) => [r.id, r.organization_id, r.title]),
      };
    };

    const local = await run('local');
    const remote = await run('remote');

    expect(remote).toEqual(local);
    // …and the answer they agree on is the scoped one: two faces that both
    // answered across organizations would agree perfectly.
    expect(local.found).toEqual(IN_SCOPE_IDS);
    expect(local.otherOne).toBeNull();
    expect(local.updatedOther).toBeNull();
    expect(local.deletedOther).toBe(false);
    expect(local.swept).toBe(IN_SCOPE_IDS.length);
    expect(local.created).toBe(CALLER_ORG);
  });
});
