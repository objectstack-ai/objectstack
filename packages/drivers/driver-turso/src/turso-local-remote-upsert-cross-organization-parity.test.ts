// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ONE `TursoDriver`, ONE answer when an upsert's conflict lands on another
 * organization's row: refused with `UNIQUE_VIOLATION` / 409 on BOTH faces,
 * nothing written, and the tenant column never re-parented by an upsert.
 *
 * # The class
 *
 * The local face is `SqlDriver.upsert`; the remote face builds its own
 * `INSERT … ON CONFLICT … DO UPDATE` in `RemoteTransport.upsert` from the same
 * insert-only list (`insertOnlyUpsertColumns`). A merge set that leaves the
 * tenant column writable re-parents another organization's row and overwrites
 * its columns; the primary key and a `unique: 'global'` column are both
 * installation-wide, so either target can land there.
 *
 * # The remote face, specifically
 *
 * No read on this face applies the SQL driver's tenant scope, and before this
 * change its upsert did not stamp the caller's organization on the row either.
 * The guard therefore has three parts here: the caller's organization is
 * stamped on entry (as the local face stamps it), the merge statement carries
 * the predicate (`… DO UPDATE SET … WHERE` the stored tenant column `IS` the
 * written one), and the read-back of the landed row is scoped to the written
 * tenant, so a row the predicate left alone is not found and the call refuses.
 * The read-back decides rather than the statement's `rowsAffected`: when no
 * column is left to merge the statement is `DO NOTHING`, which affects zero rows
 * for a same-organization conflict too, and a `rowsAffected` verdict would
 * refuse that control.
 *
 * The local face reaches this package through the BUILT
 * `@objectstack/driver-sql` (no vitest alias to `src`), so a change to
 * `sql-driver.ts` is seen here only after that package is rebuilt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

const CALLER_ORG = 'org_os21185_caller';
const OTHER_ORG = 'org_os21185_other';

const ACCOUNT = {
  name: 'os21185_account',
  fields: {
    organization_id: { type: 'string' },
    email: { type: 'string', unique: 'global' },
    title: { type: 'string' },
  },
} as const;

const OTHER_ID = 'os21185_other_row';
const OTHER_EMAIL = 'shared@os21185.test';
const OTHER_TITLE = 'kept by the other organization';

type Face = 'local' | 'remote';
const FACES: readonly Face[] = ['local', 'remote'];

const captureError = async (run: () => Promise<unknown>): Promise<WireBearingError | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as WireBearingError;
  }
};

describe("an upsert whose conflict lands on another organization's row, on BOTH TursoDriver faces", () => {
  let drivers: Record<Face, TursoDriver>;
  let stub: LibsqlSqliteStub;

  /** Every stored row, raw from the face's own database, in a stable order. */
  const snapshot = async (face: Face): Promise<Array<Record<string, unknown>>> => {
    const rows: Array<Record<string, unknown>> =
      face === 'remote'
        ? stub.raw.prepare(`SELECT * FROM "${ACCOUNT.name}" ORDER BY "id"`).all()
        : await (drivers.local as any).knex(ACCOUNT.name).select('*').orderBy('id');
    return rows.map((r) => JSON.parse(JSON.stringify(r)));
  };

  const rawRow = async (face: Face, id: string): Promise<Record<string, unknown> | undefined> =>
    (await snapshot(face)).find((r) => r.id === id);

  beforeEach(async () => {
    const local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');

    stub = makeLibsqlSqliteStub();
    const remote = new TursoDriver({ url: 'libsql://upsert-cross-org.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');

    drivers = { local, remote };
    for (const driver of Object.values(drivers)) {
      await driver.initObjects([{ ...ACCOUNT, fields: { ...ACCOUNT.fields } }]);
      await driver.create(
        ACCOUNT.name,
        { id: OTHER_ID, organization_id: OTHER_ORG, email: OTHER_EMAIL, title: OTHER_TITLE },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await drivers.local.disconnect();
    await drivers.remote.disconnect();
    stub.close();
  });

  for (const face of FACES) {
    describe(`the ${face} face`, () => {
      it("refuses an `['id']` target landing on another organization's row with UNIQUE_VIOLATION, and writes nothing", async () => {
        const driver = drivers[face];
        const before = await snapshot(face);

        for (const keys of [undefined, ['id']]) {
          const err = await captureError(() =>
            driver.upsert(
              ACCOUNT.name,
              { id: OTHER_ID, email: 'caller@os21185.test', title: 'overwritten?' },
              keys,
              { tenantId: CALLER_ORG },
            ),
          );
          expect(err, 'the cross-organization merge was not refused').not.toBeNull();
          expect(err!.code).toBe('UNIQUE_VIOLATION');
          expect(err!.status).toBe(409);
        }
        expect(await snapshot(face), "the other organization's row was written, or a row was added").toEqual(before);
      });

      it("refuses a `unique: 'global'` column target landing on another organization's row, and writes nothing", async () => {
        const driver = drivers[face];
        const before = await snapshot(face);

        const err = await captureError(() =>
          driver.upsert(ACCOUNT.name, { email: OTHER_EMAIL, title: 'overwritten?' }, ['email'], { tenantId: CALLER_ORG }),
        );

        expect(err, 'the cross-organization merge was not refused').not.toBeNull();
        expect(err!.code).toBe('UNIQUE_VIOLATION');
        expect(err!.status).toBe(409);
        expect(await snapshot(face), "the other organization's row was written, or a row was added").toEqual(before);
      });

      it('names no organization, and no value of the other row, in the refusal', async () => {
        const driver = drivers[face];
        const err = await captureError(() =>
          driver.upsert(ACCOUNT.name, { email: OTHER_EMAIL, title: 'x' }, ['email'], { tenantId: CALLER_ORG }),
        );
        expect(err).not.toBeNull();
        for (const text of [err!.message, JSON.stringify({ ...err! }), String((err!.cause as Error | undefined)?.message)]) {
          expect(text).not.toContain(OTHER_ORG);
          expect(text).not.toContain(CALLER_ORG);
          expect(text).not.toContain(OTHER_TITLE);
        }
      });

      it('control: a same-organization upsert on the same key merges as before, on both targets', async () => {
        const driver = drivers[face];
        await driver.create(
          ACCOUNT.name,
          { id: 'os21185_own_row', organization_id: CALLER_ORG, email: 'own@os21185.test', title: 'first' },
          { bypassTenantAudit: true },
        );

        const byEmail = await driver.upsert(
          ACCOUNT.name,
          { email: 'own@os21185.test', title: 'merged by email' },
          ['email'],
          { tenantId: CALLER_ORG },
        );
        expect(byEmail.id).toBe('os21185_own_row');
        expect(byEmail.title).toBe('merged by email');

        const byId = await driver.upsert(
          ACCOUNT.name,
          { id: 'os21185_own_row', title: 'merged by id' },
          undefined,
          { tenantId: CALLER_ORG },
        );
        expect(byId.id).toBe('os21185_own_row');
        expect(byId.title).toBe('merged by id');

        expect(await rawRow(face, 'os21185_own_row')).toMatchObject({ title: 'merged by id', organization_id: CALLER_ORG });
        expect(await rawRow(face, OTHER_ID)).toMatchObject({ title: OTHER_TITLE, organization_id: OTHER_ORG });
      });

      it('control: a same-organization conflict with nothing left to merge is not refused', async () => {
        const driver = drivers[face];
        await driver.create(
          ACCOUNT.name,
          { id: 'os21185_bare_row', organization_id: CALLER_ORG, email: 'bare@os21185.test', title: 'kept' },
          { bypassTenantAudit: true },
        );

        const err = await captureError(() =>
          driver.upsert(ACCOUNT.name, { email: 'bare@os21185.test' }, ['email'], { tenantId: CALLER_ORG }),
        );
        expect(err).toBeNull();
        expect(await rawRow(face, 'os21185_bare_row')).toMatchObject({ title: 'kept', organization_id: CALLER_ORG });
      });

      it("control: an upsert that inserts lands under the caller's organization", async () => {
        const driver = drivers[face];
        const inserted = await driver.upsert(
          ACCOUNT.name,
          { id: 'os21185_new_row', email: 'new@os21185.test', title: 'new' },
          ['email'],
          { tenantId: CALLER_ORG },
        );
        expect(inserted.id).toBe('os21185_new_row');
        expect((await rawRow(face, 'os21185_new_row'))?.organization_id).toBe(CALLER_ORG);
      });

      it('a call with no tenant context does not change the row’s organization, on either target', async () => {
        const driver = drivers[face];

        await driver.upsert(
          ACCOUNT.name,
          { id: OTHER_ID, organization_id: CALLER_ORG, title: 'merged by id' },
          ['id'],
          { bypassTenantAudit: true },
        );
        expect(await rawRow(face, OTHER_ID)).toMatchObject({ title: 'merged by id', organization_id: OTHER_ORG });

        await driver.upsert(
          ACCOUNT.name,
          { email: OTHER_EMAIL, organization_id: CALLER_ORG, title: 'merged by email' },
          ['email'],
          { bypassTenantAudit: true },
        );
        expect(await rawRow(face, OTHER_ID)).toMatchObject({ title: 'merged by email', organization_id: OTHER_ORG });
      });
    });
  }

  it('both faces give one answer to the cross-organization conflict and to the control', async () => {
    const run = async (face: Face) => {
      const driver = drivers[face];
      const refused = await captureError(() =>
        driver.upsert(ACCOUNT.name, { email: OTHER_EMAIL, title: 'overwritten?' }, ['email'], { tenantId: CALLER_ORG }),
      );
      const merged = await driver.upsert(
        ACCOUNT.name,
        { email: OTHER_EMAIL, title: 'merged without context' },
        ['email'],
        { bypassTenantAudit: true },
      );
      return {
        refusal: refused && { code: refused.code, status: refused.status, message: refused.message },
        merged: { id: merged.id, title: merged.title, organization_id: merged.organization_id },
      };
    };

    const local = await run('local');
    const remote = await run('remote');

    expect(remote).toEqual(local);
    // …and the answer they agree on is the right one: two faces that both
    // merged across organizations would agree perfectly.
    expect(local.refusal?.code).toBe('UNIQUE_VIOLATION');
    expect(local.merged).toEqual({ id: OTHER_ID, title: 'merged without context', organization_id: OTHER_ORG });
  });
});
