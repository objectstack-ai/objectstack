// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13239] `driver-memory` enforces OBJECT-LEVEL declared `indexes[]` carrying
 * `unique` — a colliding write is REFUSED, not landed.
 *
 * #13197 closed the FIELD surface. This is the other declaration surface
 * `driver-sql` materializes uniqueness from, and it was
 * declared-and-not-enforced here in exactly the same ADR-0078 /
 * Prime-Directive-#10 shape: an object declaring
 * `indexes: [{ fields: ['account_id', 'code'], unique: 'organization' }]` got a
 * real composite UNIQUE on the SQL family and NOTHING at all in memory — the
 * colliding write landed and a read returned both rows.
 *
 * ## ⚠️ This is NOT a smaller copy of #13197 — bare `true` inverts
 *
 * The two surfaces share a vocabulary and disagree about its POSITIONAL member:
 *
 *  - FIELD level, bare `unique: true` = `'organization'` (per organization).
 *  - DECLARED INDEX, bare `unique: true` = `'global'` (the listed columns
 *    VERBATIM, no organization key part).
 *
 * That is the #4986 trap, it is deliberate (maintainer ruling 2026-08-13 on
 * #8323, staged for retirement at protocol 18 by #5082), and `driver-sql` pins
 * it in `sql-driver-declared-index-organization-respelling.test.ts`. So the
 * scope judgment here is read off `normalizeDeclaredIndex`, NOT off
 * `uniqueIndexesFromFields` — `driver-memory` must not depend on `driver-sql`,
 * so the arms are reproduced and pinned here, and `the two surfaces disagree`
 * below holds both readings side by side on ONE object.
 *
 * ## Two things every refusal test in this package must do (#13197's rule)
 *
 *  1. Assert the ENVELOPE — `code` AND `status` — never merely "it threw"
 *     (#6144).
 *  2. Assert the store is UNCHANGED. "Refused" and "refused after writing the
 *     row" are different facts.
 *
 * ## The NULL rule is SQL's, MEASURED (not assumed)
 *
 * Run against SQLite while writing this file, over the two DDL shapes
 * `syncDeclaredIndexes` actually emits:
 *
 * ```
 * UNIQUE (account_id, code)                                  -- bare true / 'global'
 *   ('acme', NULL, 'X') then ('acme', NULL, 'X')   -> BOTH ACCEPTED   (NULL-DISTINCT)
 *   ('acme', 'A2', NULL) then ('acme', 'A2', NULL) -> BOTH ACCEPTED   (NULL-DISTINCT)
 *
 * UNIQUE (COALESCE(organization_id,'__global__'), account_id, code)  -- 'organization'
 *   (NULL, 'A1', 'X') then (NULL, 'A1', 'X')       -> second REFUSED  (the org part FOLDS)
 *   (NULL, 'A2', NULL) then (NULL, 'A2', NULL)     -> BOTH ACCEPTED   (NULL-DISTINCT wins)
 * ```
 *
 * So the composite rule is the field-level rule with a wider key, and NOT a new
 * invention: a NULL in any LISTED key column exempts the row, while a NULL
 * ORGANIZATION folds onto one bucket because its key part is an expression that
 * is never NULL. Both halves are pinned below.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';
import { InMemoryDriver } from './memory-driver.js';
import {
  UNIQUE_VIOLATION_CODE,
  UNIQUE_VIOLATION_STATUS,
  uniqueConstraintsFromDeclaredIndexes,
} from './memory-unique-constraint.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** Run `fn`, requiring it to reject; hand back the rejection for inspection. */
async function refusalOf(fn: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await fn();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this write, but it resolved');
}

/** The envelope assertion — `code` AND `status`, never just "it threw" (#6144). */
function expectUniqueViolationEnvelope(err: WireBearingError, ...mentions: string[]) {
  expect(err.code).toBe(UNIQUE_VIOLATION_CODE);
  expect(err.status).toBe(UNIQUE_VIOLATION_STATUS);
  expect(err.code).toBe('UNIQUE_VIOLATION');
  expect(err.status).toBe(409);
  for (const m of mentions) expect(err.message).toContain(m);
  // The wire identity is the SQL family's; a driver name in the sentence breaks
  // the parity `memory-filter-refusal-envelope.test.ts` holds for the filters.
  expect(err.message).not.toContain('[driver-memory]');
}

/** An object with a tenant column and one declared composite index. */
const ledger = (unique: unknown) => ({
  name: 'ledger',
  fields: {
    id: { type: 'text' },
    organization_id: { type: 'text' },
    account_id: { type: 'text' },
    code: { type: 'text' },
  },
  indexes: [{ fields: ['account_id', 'code'], unique }],
});

/* ====================================================================== *
 * 1. The defect this card closes
 * ==================================================================== */

describe('[#13239] a declared composite unique is enforced — the colliding write is refused, not landed', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
  });

  it('the second row on a taken (account_id, code) pair is refused, and nothing is written', async () => {
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });

    const err = await refusalOf(() =>
      driver.create('ledger', { id: '2', organization_id: 'acme', account_id: 'A1', code: 'X' }),
    );

    expectUniqueViolationEnvelope(err, 'account_id', 'code', 'organization_id');
    // The half that makes it a fix rather than a louder bug: ONE row, not two.
    const rows = await driver.find('ledger', { fields: ['id'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('1');
  });

  it('the refusal carries the same envelope the SQL family answers a conflict with', async () => {
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });
    const err = await refusalOf(() =>
      driver.create('ledger', { id: '2', organization_id: 'acme', account_id: 'A1', code: 'X' }),
    );
    expect(isUniqueViolationError(err)).toBe(true);
  });

  it('a DIFFERENT pair still lands — the constraint is not a blanket refusal', async () => {
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });
    await driver.create('ledger', { id: '2', organization_id: 'acme', account_id: 'A1', code: 'Y' });
    await driver.create('ledger', { id: '3', organization_id: 'acme', account_id: 'A2', code: 'X' });
    expect(await driver.count('ledger')).toBe(3);
  });
});

/* ====================================================================== *
 * 2. The #4986 trap — bare `true` means the OPPOSITE of the field surface
 * ==================================================================== */

describe('[#13239] the two `unique` surfaces disagree about bare `true`, and this driver reproduces the disagreement', () => {
  it("a DECLARED index's bare `true` is `'global'` — the listed columns VERBATIM, no organization key part", async () => {
    expect(uniqueConstraintsFromDeclaredIndexes(ledger(true))).toEqual([
      { columns: ['account_id', 'code'], nullSafeColumns: [] },
    ]);

    const driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger(true));
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });

    // A DIFFERENT organization collides: that is what "global" means, and it is
    // what #8323 measured in the field before the platform's own objects were
    // respelled.
    const err = await refusalOf(() =>
      driver.create('ledger', { id: '2', organization_id: 'globex', account_id: 'A1', code: 'X' }),
    );
    expectUniqueViolationEnvelope(err, 'account_id', 'code');
    expect(err.message).not.toContain('within the same');
    expect(await driver.count('ledger')).toBe(1);
  });

  it("`unique: 'global'` is the same materialization — bare `true` is its positional spelling", () => {
    expect(uniqueConstraintsFromDeclaredIndexes(ledger(true))).toEqual(
      uniqueConstraintsFromDeclaredIndexes(ledger('global')),
    );
  });

  it("only the explicit `'organization'` prepends the NULL-safe organization key part", async () => {
    expect(uniqueConstraintsFromDeclaredIndexes(ledger('organization'))).toEqual([
      { columns: ['organization_id', 'account_id', 'code'], nullSafeColumns: ['organization_id'] },
    ]);

    const driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });
    // The same pair in ANOTHER organization now lands — the cross-organization
    // existence oracle #8323 removed.
    await driver.create('ledger', { id: '2', organization_id: 'globex', account_id: 'A1', code: 'X' });
    expect(await driver.count('ledger')).toBe(2);
  });

  it('FIELD-level bare `true` and DECLARED bare `true` disagree ON ONE OBJECT — the divergence itself', async () => {
    // Same two characters, opposite meaning, one level up. An author who reads
    // the field-level rule and writes the table-level declaration gets the
    // global index silently; a driver that reads the field-level rule here
    // would silently make it per-organization instead. Both halves live on this
    // one schema so a future edit cannot move one without moving the other.
    const both = {
      name: 'thing',
      fields: {
        id: { type: 'text' },
        organization_id: { type: 'text' },
        email: { type: 'text', unique: true },
        code: { type: 'text' },
      },
      indexes: [{ fields: ['code'], unique: true }],
    };
    const driver = new InMemoryDriver();
    await driver.syncSchema('thing', both);
    await driver.create('thing', { id: '1', organization_id: 'acme', email: 'a@b.com', code: 'C1' });

    // FIELD `unique: true` = per organization -> another organization may hold
    // the same email.
    await driver.create('thing', { id: '2', organization_id: 'globex', email: 'a@b.com', code: 'C2' });
    expect(await driver.count('thing')).toBe(2);

    // DECLARED `unique: true` = global -> another organization may NOT hold the
    // same code.
    const err = await refusalOf(() =>
      driver.create('thing', { id: '3', organization_id: 'globex', code: 'C1' }),
    );
    expectUniqueViolationEnvelope(err, 'code');
    expect(err.message).not.toContain('within the same');
    expect(await driver.count('thing')).toBe(2);
  });
});

/* ====================================================================== *
 * 3. `normalizeDeclaredIndex`'s remaining arms, reproduced and pinned
 * ==================================================================== */

describe("[#13239] the arms are `normalizeDeclaredIndex`'s, reproduced without importing driver-sql", () => {
  it('a listed column that IS the tenant column is not prepended again — its own key part becomes NULL-safe', () => {
    // The hand-written S6 spelling, opted in. Order is preserved: the author's
    // column stays where they put it.
    const schema = {
      name: 'ledger',
      fields: { id: {}, organization_id: {}, code: {} },
      indexes: [{ fields: ['code', 'organization_id'], unique: 'organization' }],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['code', 'organization_id'], nullSafeColumns: ['organization_id'] },
    ]);
  });

  it("with NO tenant column, `'organization'` degrades to the listed columns alone", () => {
    const schema = {
      name: 'doc',
      fields: { id: {}, a: {}, b: {} },
      indexes: [{ fields: ['a', 'b'], unique: 'organization' }],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['a', 'b'], nullSafeColumns: [] },
    ]);
  });

  it('an object that opts OUT of tenancy has no tenant column to prepend', () => {
    const schema = {
      name: 'doc',
      fields: { id: {}, organization_id: {}, a: {} },
      tenancy: { enabled: false },
      indexes: [{ fields: ['a'], unique: 'organization' }],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['a'], nullSafeColumns: [] },
    ]);
  });

  it('a declared `tenancy.tenantField` is what gets prepended, when it exists on the object', () => {
    const schema = {
      name: 'doc',
      fields: { id: {}, org: {}, organization_id: {}, a: {} },
      tenancy: { tenantField: 'org' },
      indexes: [{ fields: ['a'], unique: 'organization' }],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['org', 'a'], nullSafeColumns: ['org'] },
    ]);
  });

  it('`unique: false` / absent declares a plain index — not a constraint', () => {
    expect(uniqueConstraintsFromDeclaredIndexes(ledger(false))).toEqual([]);
    expect(uniqueConstraintsFromDeclaredIndexes(ledger(undefined))).toEqual([]);
    expect(
      uniqueConstraintsFromDeclaredIndexes({
        fields: { a: {} },
        indexes: [{ fields: ['a'] }],
      }),
    ).toEqual([]);
  });

  it('an entry with no usable `fields` is unusable — `normalizeDeclaredIndex` answers null there', () => {
    const unusable = {
      name: 'x',
      fields: { a: {} },
      indexes: [
        { fields: [], unique: true },
        { unique: true },
        { fields: ['', '  '], unique: true },
      ],
    };
    // `'  '` is a non-empty string and survives the SQL-side filter too — the
    // filter is `typeof f === 'string' && f.length > 0`, nothing more.
    expect(uniqueConstraintsFromDeclaredIndexes(unusable)).toEqual([
      { columns: ['  '], nullSafeColumns: [] },
    ]);
  });

  it('non-string entries are filtered out of `fields`, exactly as on the SQL side', () => {
    const schema = {
      name: 'x',
      fields: { a: {}, b: {} },
      indexes: [{ fields: ['a', 42, null, 'b'], unique: 'global' }],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['a', 'b'], nullSafeColumns: [] },
    ]);
  });

  it('an object with no `indexes` at all declares nothing', () => {
    expect(uniqueConstraintsFromDeclaredIndexes({ fields: { a: {} } })).toEqual([]);
    expect(uniqueConstraintsFromDeclaredIndexes(undefined)).toEqual([]);
    expect(uniqueConstraintsFromDeclaredIndexes({ fields: { a: {} }, indexes: null })).toEqual([]);
  });

  it('several declared indexes on one object each become their own constraint', () => {
    const schema = {
      name: 'x',
      fields: { id: {}, organization_id: {}, a: {}, b: {}, c: {} },
      indexes: [
        { fields: ['a'], unique: true },
        { fields: ['b', 'c'], unique: 'organization' },
        { fields: ['c'] },
      ],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['a'], nullSafeColumns: [] },
      { columns: ['organization_id', 'b', 'c'], nullSafeColumns: ['organization_id'] },
    ]);
  });
});

/* ====================================================================== *
 * 4. NULL handling — the measured SQL rule, both halves
 * ==================================================================== */

describe('[#13239] NULL handling matches the composite index SQL actually builds', () => {
  it('a NULL in a LISTED key column exempts the row — NULL-DISTINCT, as measured on SQLite', async () => {
    const driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: null, code: 'X' });
    await driver.create('ledger', { id: '2', organization_id: 'acme', account_id: null, code: 'X' });
    await driver.create('ledger', { id: '3', organization_id: 'acme', account_id: 'A2' }); // `code` absent
    await driver.create('ledger', { id: '4', organization_id: 'acme', account_id: 'A2' });
    expect(await driver.count('ledger')).toBe(4);
  });

  it('a NULL ORGANIZATION does NOT exempt — the D3 fold, reached without the `__global__` token', async () => {
    // SQL folds NULL organizations with COALESCE onto a reserved literal because
    // an index EXPRESSION needs a non-NULL one. A JS key holds `null` directly,
    // so the same bucket is reached with no token at all.
    const driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
    await driver.create('ledger', { id: '1', account_id: 'A1', code: 'X' });
    const err = await refusalOf(() => driver.create('ledger', { id: '2', account_id: 'A1', code: 'X' }));
    expectUniqueViolationEnvelope(err, 'account_id', 'code', 'organization_id');
    // …and a row that DOES carry an organization is untouched by that bucket.
    await driver.create('ledger', { id: '3', organization_id: 'acme', account_id: 'A1', code: 'X' });
    expect(await driver.count('ledger')).toBe(2);
  });

  it('an index whose ONLY key part is the NULL-safe organization is "one row per organization"', async () => {
    // `normalizeDeclaredIndex` has no "a unique ON the tenant column stays
    // single-column" guard — that guard is the FIELD surface's. Here the listed
    // organization column simply becomes the NULL-safe key part, so NULL-org
    // rows share one bucket and are unique among themselves.
    const schema = {
      name: 'settings',
      fields: { id: {}, organization_id: {} },
      indexes: [{ fields: ['organization_id'], unique: 'organization' }],
    };
    expect(uniqueConstraintsFromDeclaredIndexes(schema)).toEqual([
      { columns: ['organization_id'], nullSafeColumns: ['organization_id'] },
    ]);

    const driver = new InMemoryDriver();
    await driver.syncSchema('settings', schema);
    await driver.create('settings', { id: '1', organization_id: 'acme' });
    await driver.create('settings', { id: '2' }); // NULL organization: its own bucket
    const dupOrg = await refusalOf(() => driver.create('settings', { id: '3', organization_id: 'acme' }));
    expectUniqueViolationEnvelope(dupOrg, 'organization_id');
    const dupNull = await refusalOf(() => driver.create('settings', { id: '4' }));
    expectUniqueViolationEnvelope(dupNull, 'organization_id');
    expect(await driver.count('settings')).toBe(2);
  });
});

/* ====================================================================== *
 * 5. `uniqueViolationColumn` — a composite has no single offending column
 * ==================================================================== */

describe('[#13239] the refusal names no single column, because a composite has none (#6544)', () => {
  it('a composite refusal answers `undefined` — never the first column, never an index name', async () => {
    const driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });
    const err = await refusalOf(() =>
      driver.create('ledger', { id: '2', organization_id: 'acme', account_id: 'A1', code: 'X' }),
    );
    // Matches what SQLite answers for the same index — measured: the plain
    // composite prints `UNIQUE constraint failed: t.account_id, t.code` (two
    // targets -> undefined) and the NULL-safe form prints
    // `UNIQUE constraint failed: index '…'` (an index name -> undefined).
    expect(isUniqueViolationError(err)).toBe(true);
    expect(uniqueViolationColumn(err)).toBeUndefined();
  });

  it('a SINGLE-column declared index answers `undefined` too — this driver never names a column', async () => {
    // Not an oversight and not a regression: #13197's field-level refusal
    // already answers `undefined` (asserted here as the baseline), because this
    // driver states the conflict in its own words rather than mimicking a
    // dialect's grammar. `undefined` is the safe answer under the #6544 ruling
    // — an identifier mistaken for a column is worse than no answer — and the
    // engine's autonumber resync treats it as attributable by design.
    const driver = new InMemoryDriver();
    await driver.syncSchema('doc', {
      name: 'doc',
      fields: { id: {}, token: {}, doc_no: { type: 'autonumber', unique: true } },
      indexes: [{ fields: ['token'], unique: true }],
    });
    await driver.create('doc', { id: '1', token: 'T1', doc_no: 'D-1' });

    const declared = await refusalOf(() => driver.create('doc', { id: '2', token: 'T1', doc_no: 'D-2' }));
    expect(uniqueViolationColumn(declared)).toBeUndefined();

    const fieldLevel = await refusalOf(() => driver.create('doc', { id: '3', token: 'T3', doc_no: 'D-1' }));
    expect(uniqueViolationColumn(fieldLevel)).toBeUndefined();
  });
});

/* ====================================================================== *
 * 6. Every write path goes through the ONE seam
 * ==================================================================== */

describe('[#13239] every write path is checked, not just create', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });
    await driver.create('ledger', { id: '2', organization_id: 'acme', account_id: 'A1', code: 'Y' });
  });

  it('update onto a taken pair is refused and the row keeps its old values', async () => {
    const err = await refusalOf(() => driver.update('ledger', '2', { code: 'X' }));
    expectUniqueViolationEnvelope(err, 'account_id', 'code');
    expect((await driver.findOne('ledger', { fields: ['code'], where: { id: '2' } }))!.code).toBe('Y');
  });

  it('a row does not collide with ITSELF', async () => {
    const updated = await driver.update('ledger', '2', { code: 'Y' });
    expect(updated!.code).toBe('Y');
  });

  it('bulkCreate catches a duplicate WITHIN the batch, not only against stored rows', async () => {
    const err = await refusalOf(() =>
      driver.bulkCreate('ledger', [
        { id: 'a', organization_id: 'acme', account_id: 'A9', code: 'Z' },
        { id: 'b', organization_id: 'acme', account_id: 'A9', code: 'Z' },
      ]),
    );
    expectUniqueViolationEnvelope(err, 'account_id', 'code');
    // [#13340] ⛔ The refusal is NOT what this test is for — the refusal was
    // already correct, and #13197/#13239 already pin it. What it asserts is
    // that THE ROW COUNT DOES NOT MOVE: the batch is all-or-nothing.
    //
    // This assertion was INVERTED in place, not re-baselined. It used to read
    // `toHaveLength(1)` / `toBe(3)` and recorded the opposite behaviour as a
    // known boundary: `bulkCreate` was `Promise.all(map(create))`, so the row
    // accepted BEFORE the refusal stayed in the store and a refused 2-row
    // batch left a 2-row table holding THREE rows. #13340 gave `bulkCreate`
    // the check-then-push posture `updateMany` has had since #13197, so
    // neither row lands now. The old numbers are kept in this comment
    // deliberately: they are the discriminating reading, and an assertion
    // that only checked "the refusal still happens" would pass in both
    // worlds.
    const colliding = await driver.find('ledger', {
      fields: ['id'],
      where: { account_id: 'A9', code: 'Z' },
    });
    expect(colliding).toHaveLength(0);
    expect(await driver.count('ledger')).toBe(2);
  });

  it('updateMany refuses BEFORE mutating anything — no half-applied batch', async () => {
    const err = await refusalOf(() => driver.updateMany('ledger', { where: {} }, { code: 'Z' }));
    expectUniqueViolationEnvelope(err, 'account_id', 'code');
    const rows = await driver.find('ledger', {
      fields: ['id', 'code'],
      orderBy: [{ field: 'id', order: 'asc' }],
    });
    expect(rows.map((r: any) => r.code)).toEqual(['X', 'Y']);
  });
});

/* ====================================================================== *
 * 7. The boundaries, stated so they are not read as gaps
 * ==================================================================== */

describe('[#13239] what is NOT constrained', () => {
  it('an object that never passed through syncSchema is unconstrained', async () => {
    const driver = new InMemoryDriver();
    await driver.create('undeclared', { id: '1', account_id: 'A1', code: 'X' });
    await driver.create('undeclared', { id: '2', account_id: 'A1', code: 'X' });
    expect(await driver.count('undeclared')).toBe(2);
  });

  it('dropTable forgets the declaration — a constraint must not outlive its table', async () => {
    const driver = new InMemoryDriver();
    await driver.syncSchema('ledger', ledger('organization'));
    await driver.dropTable('ledger');
    await driver.create('ledger', { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' });
    await driver.create('ledger', { id: '2', organization_id: 'acme', account_id: 'A1', code: 'X' });
    expect(await driver.count('ledger')).toBe(2);
  });

  it('rows already present when the schema arrives are not retroactively refused', async () => {
    const driver = new InMemoryDriver({
      initialData: {
        ledger: [
          { id: '1', organization_id: 'acme', account_id: 'A1', code: 'X' },
          { id: '2', organization_id: 'acme', account_id: 'A1', code: 'X' },
        ],
      },
    });
    await driver.connect();
    await expect(driver.syncSchema('ledger', ledger('organization'))).resolves.toBeUndefined();
    expect(await driver.count('ledger')).toBe(2);
    // From here on every WRITE is checked.
    const err = await refusalOf(() =>
      driver.create('ledger', { id: '3', organization_id: 'acme', account_id: 'A1', code: 'X' }),
    );
    expectUniqueViolationEnvelope(err, 'account_id', 'code');
  });

  it('an index over a column the object never declares constrains nothing — as SQL skips an unmaterialized one', async () => {
    // `syncDeclaredIndexes` skips a declared index whose columns are not
    // materialized. Here the degradation is automatic and needs no filter: the
    // column is `undefined` on every row, and a NULL key part exempts the row.
    const driver = new InMemoryDriver();
    await driver.syncSchema('ghost', {
      name: 'ghost',
      fields: { id: {}, a: {} },
      indexes: [{ fields: ['a', 'never_declared'], unique: 'global' }],
    });
    await driver.create('ghost', { id: '1', a: 'same' });
    await driver.create('ghost', { id: '2', a: 'same' });
    expect(await driver.count('ghost')).toBe(2);
  });

  it('field-level and declared-index constraints coexist — both are enforced on one object', async () => {
    const driver = new InMemoryDriver();
    await driver.syncSchema('both', {
      name: 'both',
      fields: { id: {}, organization_id: {}, email: { unique: 'global' }, a: {}, b: {} },
      indexes: [{ fields: ['a', 'b'], unique: 'global' }],
    });
    await driver.create('both', { id: '1', email: 'x@y.com', a: '1', b: '2' });
    expectUniqueViolationEnvelope(
      await refusalOf(() => driver.create('both', { id: '2', email: 'x@y.com', a: '9', b: '9' })),
      'email',
    );
    expectUniqueViolationEnvelope(
      await refusalOf(() => driver.create('both', { id: '3', email: 'z@y.com', a: '1', b: '2' })),
      'a',
      'b',
    );
    expect(await driver.count('both')).toBe(1);
  });
});
