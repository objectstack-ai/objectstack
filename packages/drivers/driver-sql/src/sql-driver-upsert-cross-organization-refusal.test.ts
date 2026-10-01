// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An upsert whose conflict lands on another organization's row is refused with
 * `UNIQUE_VIOLATION` and writes nothing; an upsert never changes a row's
 * organization.
 *
 * # The class
 *
 * `upsert` resolves its conflict against the whole table: the primary key and a
 * `unique: 'global'` column are installation-wide (ADR-0120 D1), so the row a
 * tenant-scoped call collides with can belong to an organization the caller
 * cannot read. Before this change the merge leg wrote every payload column
 * except `insertOnlyUpsertColumns` onto that row, and the tenant column was not
 * on the list: the other organization's columns were overwritten and the row
 * was re-parented to the caller's organization, with no error.
 *
 * # What the ruling decided, and where each part is pinned
 *
 *  - **The predicate is the landed row's organization, for any conflict
 *    target.** So each cell pins the `['id']` target (by default and spelled
 *    out) AND a `unique: 'global'` business column.
 *  - **The answer is `UNIQUE_VIOLATION` / 409**, the registered code `create()`
 *    answers for the same collision: from the caller's organization the row
 *    does not exist, so the call is an insert and that insert collides. The
 *    refusal names no organization (pinned on message, own properties and
 *    `cause`).
 *  - **Nothing is written** — the other organization's row reads back
 *    byte-identical, raw from the table, and no row is added.
 *  - **The mechanism:** a predicate inside the merge statement on SQLite and
 *    PostgreSQL (`… DO UPDATE SET … WHERE` the stored tenant column `IS` /
 *    `IS NOT DISTINCT FROM` the written one), and on MySQL, whose
 *    `ON DUPLICATE KEY UPDATE` has no `WHERE`, the statement and a read of the
 *    landed row under the written tenant run as one transaction whose failure
 *    rolls the write back.
 *  - **The tenant column is insert-only** (`insertOnlyUpsertColumns`): a call
 *    with no tenant context never re-parents a row. `update()` is the
 *    deliberate path.
 *
 * Controls: the same-organization upsert on the same key still merges, an
 * upsert that inserts still lands under the caller's organization, and an
 * explicitly named organization on an inserted row is not falsely refused.
 *
 * MySQL runs only where `OS_TEST_MYSQL_URL` is provisioned (CI's
 * `Temporal Conformance (live PG + MySQL)` job, which runs this package's whole
 * suite); elsewhere the cell is declared un-run, never silently passed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
  cause?: unknown;
}

const CALLER_ORG = 'org_os21185_caller';
const OTHER_ORG = 'org_os21185_other';

/** One installation-wide unique business column beside an ordinary one, on a tenanted object. */
const ACCOUNT = {
  name: 'os21185_account',
  fields: {
    organization_id: { type: 'string' },
    email: { type: 'string', unique: 'global' },
    title: { type: 'string' },
  },
} as any;

const OTHER_ID = 'os21185_other_row';
const OTHER_EMAIL = 'shared@os21185.test';
const OTHER_TITLE = 'kept by the other organization';

const captureError = async (run: () => Promise<unknown>): Promise<WireBearingError | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as WireBearingError;
  }
};

/** Every text a caller or a log line can read off the refusal. */
const refusalTexts = (err: WireBearingError): string[] => {
  const texts = [err.message, JSON.stringify({ ...err })];
  let cause: unknown = err.cause;
  for (let depth = 0; cause && depth < 4; depth++) {
    texts.push(String((cause as Error).message ?? cause), JSON.stringify({ ...(cause as object) }));
    cause = (cause as { cause?: unknown }).cause;
  }
  return texts;
};

const ON_CONFLICT_DIALECTS = new Set(['sqlite', 'pg']);

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'cross-organization upsert refusal', declareCrossOrganizationRefusal);
}

function declareCrossOrganizationRefusal(cell: DialectCell): void {
  describe(`SqlDriver.upsert — a conflict on another organization's row (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    /** Every stored row, raw from the table, in a stable order. */
    const snapshot = async (): Promise<Array<Record<string, unknown>>> => {
      const rows = await knexInstance(ACCOUNT.name).select('*');
      return [...rows]
        .map((r: Record<string, unknown>) => JSON.parse(JSON.stringify(r)))
        .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    };

    const rawRow = async (id: string): Promise<Record<string, unknown> | undefined> => {
      const row = await knexInstance(ACCOUNT.name).where('id', id).first();
      return row ? JSON.parse(JSON.stringify(row)) : undefined;
    };

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;
      await knexInstance.schema.dropTableIfExists(ACCOUNT.name);
      await driver.initObjects([ACCOUNT]);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(ACCOUNT.name).catch(() => {});
      await driver?.disconnect?.();
    });

    beforeEach(async () => {
      await knexInstance(ACCOUNT.name).delete();
      await driver.create(
        ACCOUNT.name,
        { id: OTHER_ID, email: OTHER_EMAIL, title: OTHER_TITLE },
        { tenantId: OTHER_ORG } as any,
      );
      const seeded = await rawRow(OTHER_ID);
      expect(seeded?.organization_id, 'the fixture row must belong to the other organization').toBe(OTHER_ORG);
    });

    // ───────────────────────────────────────────────────────────────────
    // The refusal — both conflict targets
    // ───────────────────────────────────────────────────────────────────

    for (const [label, keys] of [
      ['the default (`id`) target', undefined],
      ["an explicit `['id']` target", ['id']],
    ] as const) {
      it(`refuses ${label} landing on another organization's row with UNIQUE_VIOLATION, and writes nothing`, async () => {
        const before = await snapshot();

        const err = await captureError(() =>
          driver.upsert(
            ACCOUNT.name,
            { id: OTHER_ID, email: 'caller@os21185.test', title: 'overwritten?' },
            keys as string[] | undefined,
            { tenantId: CALLER_ORG } as any,
          ),
        );

        expect(err, 'the cross-organization merge was not refused').not.toBeNull();
        expect(err!.code).toBe('UNIQUE_VIOLATION');
        expect(err!.status).toBe(409);
        expect(await snapshot(), "the other organization's row was written, or a row was added").toEqual(before);
      });
    }

    it("refuses a `unique: 'global'` column target landing on another organization's row, and writes nothing", async () => {
      const before = await snapshot();

      const err = await captureError(() =>
        driver.upsert(
          ACCOUNT.name,
          { email: OTHER_EMAIL, title: 'overwritten?' },
          ['email'],
          { tenantId: CALLER_ORG } as any,
        ),
      );

      expect(err, 'the cross-organization merge was not refused').not.toBeNull();
      expect(err!.code).toBe('UNIQUE_VIOLATION');
      expect(err!.status).toBe(409);
      expect(await snapshot(), "the other organization's row was written, or a row was added").toEqual(before);
    });

    /**
     * Inside a CALLER's transaction the refusal must not depend on what the
     * caller does next: a caller that swallows the error and commits must not
     * commit a cross-organization merge. On SQLite and PostgreSQL the statement
     * never writes the row; on MySQL the statement and its check run in a
     * nested transaction (a savepoint) that the check's throw rolls back.
     */
    it("refuses inside a caller's transaction, and a commit after the refusal writes nothing", async () => {
      const before = await snapshot();

      const trx = await driver.beginTransaction();
      let err: WireBearingError | null;
      try {
        err = await captureError(() =>
          driver.upsert(
            ACCOUNT.name,
            { email: OTHER_EMAIL, title: 'overwritten?' },
            ['email'],
            { tenantId: CALLER_ORG, transaction: trx } as any,
          ),
        );
        // The caller carries on with its own transaction, and commits it.
        await driver.upsert(
          ACCOUNT.name,
          { id: 'os21185_after_refusal', email: 'after@os21185.test', title: 'committed' },
          ['email'],
          { tenantId: CALLER_ORG, transaction: trx } as any,
        );
        await driver.commit(trx);
      } catch (e) {
        await driver.rollback(trx).catch(() => {});
        throw e;
      }

      expect(err, 'the cross-organization merge was not refused').not.toBeNull();
      expect(err!.code).toBe('UNIQUE_VIOLATION');
      expect(err!.status).toBe(409);
      const after = await snapshot();
      expect(after.filter((r) => r.id !== 'os21185_after_refusal')).toEqual(before);
      expect(after.find((r) => r.id === 'os21185_after_refusal')).toMatchObject({
        title: 'committed',
        organization_id: CALLER_ORG,
      });
    });

    it('names no organization, and no value of the other row, in the refusal', async () => {
      for (const run of [
        () => driver.upsert(ACCOUNT.name, { id: OTHER_ID, title: 'x' }, ['id'], { tenantId: CALLER_ORG } as any),
        () => driver.upsert(ACCOUNT.name, { email: OTHER_EMAIL, title: 'x' }, ['email'], { tenantId: CALLER_ORG } as any),
      ]) {
        const err = await captureError(run);
        expect(err).not.toBeNull();
        for (const text of refusalTexts(err!)) {
          expect(text).not.toContain(OTHER_ORG);
          expect(text).not.toContain(CALLER_ORG);
          expect(text).not.toContain(OTHER_TITLE);
        }
      }
    });

    it('is recognised as a unique violation by the one shared predicate', async () => {
      const err = await captureError(() =>
        driver.upsert(ACCOUNT.name, { email: OTHER_EMAIL, title: 'x' }, ['email'], { tenantId: CALLER_ORG } as any),
      );
      expect(err).not.toBeNull();
      expect(isUniqueViolationError(err)).toBe(true);
    });

    /**
     * A row with no organization (a platform row) is not the caller's either:
     * the stored tenant column does not equal the written one, so the merge is
     * refused the same way rather than re-parenting the row into the caller's
     * organization.
     */
    it('refuses a conflict on a row that carries no organization, and leaves it untouched', async () => {
      await knexInstance(ACCOUNT.name).insert({ id: 'os21185_platform_row', email: 'platform@os21185.test', title: 'platform' });
      const before = await snapshot();

      const err = await captureError(() =>
        driver.upsert(
          ACCOUNT.name,
          { email: 'platform@os21185.test', title: 'overwritten?' },
          ['email'],
          { tenantId: CALLER_ORG } as any,
        ),
      );

      expect(err).not.toBeNull();
      expect(err!.code).toBe('UNIQUE_VIOLATION');
      expect(err!.status).toBe(409);
      expect(await snapshot()).toEqual(before);
    });

    /**
     * The default target with a FRESH id and the other organization's
     * business-key value. On SQLite and PostgreSQL `ON CONFLICT (id)` does not
     * absorb the `email` collision and the server raises its own unique
     * violation, as `create()` does; on MySQL the statement can merge on the
     * `email` key instead, and the transaction-bound check refuses it. Either way
     * nothing is written and the answer is a unique violation.
     */
    it("a fresh id carrying the other organization's business-key value is refused as a unique violation", async () => {
      const before = await snapshot();

      const err = await captureError(() =>
        driver.upsert(ACCOUNT.name, { email: OTHER_EMAIL, title: 'overwritten?' }, undefined, { tenantId: CALLER_ORG } as any),
      );

      expect(err).not.toBeNull();
      expect(isUniqueViolationError(err)).toBe(true);
      if (!ON_CONFLICT_DIALECTS.has(cell.id)) {
        expect(err!.code).toBe('UNIQUE_VIOLATION');
        expect(err!.status).toBe(409);
      }
      expect(await snapshot()).toEqual(before);
    });

    // ───────────────────────────────────────────────────────────────────
    // Controls
    // ───────────────────────────────────────────────────────────────────

    it('control: a same-organization upsert on the same key merges as before, on both targets', async () => {
      // The id is the literal, not `create()`'s answer: on the MySQL family
      // that answer is not the stored row (knex has no `RETURNING` there).
      const own = { id: 'os21185_own_row' };
      await driver.create(
        ACCOUNT.name,
        { id: own.id, email: 'own@os21185.test', title: 'first' },
        { tenantId: CALLER_ORG } as any,
      );

      const byEmail = await driver.upsert(
        ACCOUNT.name,
        { email: 'own@os21185.test', title: 'merged by email' },
        ['email'],
        { tenantId: CALLER_ORG } as any,
      );
      expect(byEmail.id).toBe(own.id);
      expect(byEmail.title).toBe('merged by email');

      const byId = await driver.upsert(
        ACCOUNT.name,
        { id: own.id, email: 'own@os21185.test', title: 'merged by id' },
        undefined,
        { tenantId: CALLER_ORG } as any,
      );
      expect(byId.id).toBe(own.id);
      expect(byId.title).toBe('merged by id');

      const stored = await rawRow(String(own.id));
      expect(stored?.title).toBe('merged by id');
      expect(stored?.organization_id).toBe(CALLER_ORG);
      expect(await rawRow(OTHER_ID), "the other organization's row is untouched by the control").toMatchObject({
        title: OTHER_TITLE,
        organization_id: OTHER_ORG,
      });
    });

    it("control: an upsert that inserts lands under the caller's organization and answers the row", async () => {
      const inserted = await driver.upsert(
        ACCOUNT.name,
        { id: 'os21185_new_row', email: 'new@os21185.test', title: 'new' },
        ['email'],
        { tenantId: CALLER_ORG } as any,
      );
      expect(inserted.id).toBe('os21185_new_row');
      expect((await rawRow('os21185_new_row'))?.organization_id).toBe(CALLER_ORG);
    });

    it('control: an explicitly named organization on an inserted row is not falsely refused', async () => {
      const err = await captureError(() =>
        driver.upsert(
          ACCOUNT.name,
          { organization_id: OTHER_ORG, email: 'named@os21185.test', title: 'named' },
          ['email'],
          { tenantId: CALLER_ORG } as any,
        ),
      );
      expect(err).toBeNull();
      const [row] = await knexInstance(ACCOUNT.name).where('email', 'named@os21185.test');
      expect(row?.organization_id).toBe(OTHER_ORG);
    });

    // ───────────────────────────────────────────────────────────────────
    // The tenant column is insert-only
    // ───────────────────────────────────────────────────────────────────

    it('a call with no tenant context does not change the row’s organization, on either target', async () => {
      await driver.upsert(
        ACCOUNT.name,
        { id: OTHER_ID, organization_id: CALLER_ORG, title: 'merged by id' },
        ['id'],
        { bypassTenantAudit: true } as any,
      );
      let stored = await rawRow(OTHER_ID);
      expect(stored?.title, 'the merge must still have happened').toBe('merged by id');
      expect(stored?.organization_id).toBe(OTHER_ORG);

      await driver.upsert(
        ACCOUNT.name,
        { email: OTHER_EMAIL, organization_id: CALLER_ORG, title: 'merged by email' },
        ['email'],
        { bypassTenantAudit: true } as any,
      );
      stored = await rawRow(OTHER_ID);
      expect(stored?.title, 'the merge must still have happened').toBe('merged by email');
      expect(stored?.organization_id).toBe(OTHER_ORG);
    });

    it('`update()` stays the deliberate path that moves a row between organizations', async () => {
      await driver.update(ACCOUNT.name, OTHER_ID, { organization_id: CALLER_ORG }, { bypassTenantAudit: true } as any);
      expect((await rawRow(OTHER_ID))?.organization_id).toBe(CALLER_ORG);
    });
  });
}
