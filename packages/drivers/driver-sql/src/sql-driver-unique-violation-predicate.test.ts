// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `syncDeclaredIndexes` judges "did existing rows violate the unique index I
 * just tried to create?" — the #5030 branch that keeps a dirty database BOOTING
 * (the constraint is logged as not-enforced and reported by the ADR-0120 D4
 * drift pre-flight) instead of taking the process down.
 *
 * ⚠️ Since #14902 that branch has two arms, not one: the NULL-safe organization
 * composite AND the plain unique (`tenancy: { enabled: false }`, or an explicit
 * `unique: 'global'`), which used to fall through to `throw e`. The
 * discriminator below is what BOTH arms judge with, so its blind spots are now
 * twice as expensive.
 *
 * It used to judge that with a private inline regex over the stringified
 * message — `unique constraint failed|duplicate entry|duplicate key value` —
 * the fourth hand-written vocabulary #6250 inventoried. #6543 migrates it onto
 * `@objectstack/types`' `isUniqueViolationError`, passing the ERROR OBJECT so
 * the `code` / `errno` channels are read at all.
 *
 * ## Why this is a live defect and not only a structural one
 *
 * The issue graded the migration `finding`, on the reasoning that "on the three
 * dialects the repo ships, the message channel happens to carry the words".
 * That holds for the DML path (a duplicate INSERT), which is what this
 * package's other tests exercise. It does not hold for the DDL path this
 * branch is in:
 *
 * | dialect | `CREATE UNIQUE INDEX` over duplicate rows says | old regex |
 * |:---|:---|:---|
 * | SQLite   | `UNIQUE constraint failed: product.code`                | ✅ matched |
 * | MySQL    | `ER_DUP_ENTRY: Duplicate entry 'DUP' for key 'uniq_…'`  | ✅ matched |
 * | Postgres | `could not create unique index "uniq_…"`, SQLSTATE 23505 | ❌ **missed** |
 *
 * Postgres does not reuse its DML phrasing here: `duplicate key value violates
 * unique constraint` is what a conflicting INSERT says, while a conflicting
 * index BUILD says `could not create unique index "…"` and carries the verdict
 * on `error.code` (SQLSTATE `23505`, `ERRCODE_UNIQUE_VIOLATION`) with the
 * offending tuple on `error.detail`. None of the three old message limbs
 * appear in it — so on Postgres, the one dialect where the boot-survival
 * branch was needed most, it never fired and `throw e` took the boot down.
 * Postgres is a first-class shipped dialect for this package
 * (`description: "… Supports PostgreSQL, MySQL, SQLite via Knex"`).
 *
 * The failures are injected rather than driven through a live Postgres because
 * this package's unit suite boots SQLite only; the shapes below are the wire
 * shapes `pg`/`mysql2` hand knex, message prefix included.
 *
 * ## Why this package's OTHER tests keep their own spelling
 *
 * `sql-driver-schema.test.ts`, `sql-driver-unique-tenancy.test.ts` and
 * `adr0120-three-posture-conformance.test.ts` assert on
 * `/UNIQUE constraint failed|duplicate key value/`. #6543 asked for a decision
 * on those rather than leaving them to the next reader. **They stay as they
 * are, deliberately.**
 *
 * They are not discriminators — they are assertions on what a real driver
 * actually emitted when a real duplicate INSERT was refused, and their job is
 * to prove the constraint EXISTS in the database. Routing them through
 * `isUniqueViolationError` would make them strictly weaker in two ways:
 *
 *  1. The predicate is deliberately broad (four message limbs, three codes, an
 *     errno, and a `cause` walk). An assertion through it can no longer
 *     distinguish "SQLite refused this row on a unique index" from "some error
 *     the predicate happens to accept", which is the whole content of those
 *     tests.
 *  2. A test that judges with the same predicate the production path judges
 *     with shares that predicate's blind spots — the two stop being
 *     independent, and a wrong predicate passes its own tests. That
 *     independence is exactly what caught the Postgres hole above.
 *
 * The narrow spelling is therefore the right one THERE, and the shared
 * predicate the right one in `src/sql-driver.ts`. The rule that reconciles
 * them: **judge with the predicate, assert on the literal.**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import type { DeclaredIndexInput } from '../src/index.js';

/** The NULL-safe unique of the #5030 scenario: `COALESCE(organization_id), code`. */
const NULL_SAFE_INDEX: DeclaredIndexInput = {
  name: 'uniq_product_organization_id_code',
  fields: ['organization_id', 'code'],
  unique: 'organization',
  nullSafeColumns: ['organization_id'],
};

/** The same index with no NULL-safe key part — the plain single-column unique. */
const PLAIN_INDEX: DeclaredIndexInput = {
  name: 'uniq_product_code',
  fields: ['code'],
  unique: true,
};

/** Not unique at all — an ACCESS PATH. Its failures are nobody's #5030. */
const NON_UNIQUE_INDEX: DeclaredIndexInput = {
  name: 'idx_product_code',
  fields: ['code'],
};

const PHYSICAL_COLUMNS = new Set(['id', 'organization_id', 'code']);

/**
 * What `pg` hands knex when `CREATE UNIQUE INDEX` finds duplicate rows.
 * knex prefixes the failing statement onto the message; the primary message is
 * `could not create unique index "…"` and the tuple lives on `detail`.
 */
function postgresIndexBuildConflict(): Error {
  const err = new Error(
    `create unique index "uniq_product_organization_id_code" on "product" ` +
      `(COALESCE("organization_id", '__global__'), "code") - ` +
      `could not create unique index "uniq_product_organization_id_code"`,
  );
  Object.assign(err, {
    code: '23505',
    detail: `Key (COALESCE(organization_id, '__global__'::text), code)=(__global__, DUP) is duplicated.`,
    severity: 'ERROR',
    routine: '_bt_check_unique',
  });
  return err;
}

/** mysql2's numeric channel with prose the old regex could not read. */
function mysqlErrnoOnlyConflict(): Error {
  const err = new Error('alter table `product` add unique `uniq_product_organization_id_code` - ER_DUP_ENTRY');
  Object.assign(err, { errno: 1062, sqlState: '23000' });
  return err;
}

/** A failure that is NOT a unique violation and must keep taking the boot down. */
function unrelatedDdlFailure(): Error {
  const err = new Error('create unique index "uniq_product_organization_id_code" - permission denied for table product');
  Object.assign(err, { code: '42501' });
  return err;
}

describe('syncDeclaredIndexes unique-violation discriminator (#6543)', () => {
  let driver: SqlDriver;
  let realKnex: any;
  let errors: string[];
  let warns: string[];

  /** Make the NULL-safe index creation fail with `err`, and capture the log. */
  function arm(err: Error): void {
    (driver as any).createNullSafeUniqueIndex = async () => {
      throw err;
    };
    errors = [];
    warns = [];
    (driver as any).logger = {
      warn: (msg: string) => warns.push(String(msg)),
      error: (msg: string) => errors.push(String(msg)),
    };
  }

  /** Drive the branch under test directly — `initObjects` is not needed to reach it. */
  function sync(indexes: DeclaredIndexInput[]): Promise<void> {
    return (driver as any).syncDeclaredIndexes('product', indexes, PHYSICAL_COLUMNS, 'organization_id');
  }

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    realKnex = (driver as any).knex;
    await realKnex.schema.createTable('product', (t: any) => {
      t.string('id').primary();
      t.string('organization_id');
      t.string('code');
    });
  });

  afterEach(async () => {
    // One test stands in for `knex`; put the real one back so teardown closes it.
    (driver as any).knex = realKnex;
    await driver.disconnect();
  });

  // ── The channels the old message-only read could not see ──────────────────

  it('absorbs a Postgres index-build conflict that names the verdict only on `code` (SQLSTATE 23505)', async () => {
    arm(postgresIndexBuildConflict());

    // Before #6543 this REJECTED: none of `unique constraint failed`,
    // `duplicate entry`, `duplicate key value` appears in Postgres' DDL
    // phrasing, so the branch fell through to `throw e` and the boot died on
    // exactly the dirty database it exists to survive.
    await expect(sync([NULL_SAFE_INDEX])).resolves.toBeUndefined();

    // Absorbed the way the branch promises: the durability-degradation
    // channel, naming the constraint that is NOT enforced and the way out.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cannot create NULL-safe unique index/);
    expect(errors[0]).toMatch(/uniq_product_organization_id_code/);
    expect(errors[0]).toMatch(/NOT enforced/);
    expect(errors[0]).toMatch(/#5030/);
    expect(errors[0]).toMatch(/ADR-0120 D4/);
  });

  it('absorbs a MySQL conflict carried only on `errno` (1062)', async () => {
    arm(mysqlErrnoOnlyConflict());

    await expect(sync([NULL_SAFE_INDEX])).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/#5030/);
  });

  it('reads the violation through a driver `cause` wrapper', async () => {
    const wrapped = new Error('index sync failed');
    Object.assign(wrapped, { cause: postgresIndexBuildConflict() });
    arm(wrapped);

    await expect(sync([NULL_SAFE_INDEX])).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/#5030/);
  });

  // ── Nothing the old regex caught may be narrowed ──────────────────────────

  it.each([
    ['sqlite', 'UNIQUE constraint failed: product.organization_id, product.code'],
    ['mysql', "ER_DUP_ENTRY: Duplicate entry 'DUP' for key 'uniq_product_organization_id_code'"],
    ['postgres dml', 'duplicate key value violates unique constraint "uniq_product_organization_id_code"'],
  ])('still absorbs the %s message spelling the inline regex used to match', async (_dialect, message) => {
    arm(new Error(message));

    await expect(sync([NULL_SAFE_INDEX])).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/#5030/);
  });

  // ── The site's own business logic, untouched by the migration ─────────────

  /**
   * ⚠️ RETIRED PIN, re-authored — #14902.
   *
   * This block used to assert the opposite: 「leaves the `nullSafe.size > 0`
   * guard intact — a plain unique still fails the sync」, on the reasoning that
   * absorbing it 「would silently ship an unenforced constraint **the drift
   * pre-flight was never told about**」. That reasoning was right, and its
   * premise is exactly what #14902 removed: the ADR-0120 D4 pre-flight now
   * probes the plain unique too, so the drift pass IS told, and `os migrate
   * plan` reports the blocked op `destructive` with the offending rows instead
   * of calling it `safe`.
   *
   * So the invariant the old pin was defending survives verbatim — a plain
   * unique violation must never be absorbed SILENTLY — and only its
   * disposition moved: from `throw` (the boot dies carrying the database's own
   * error, naming no rows and no remedy) to the same loud, non-fatal posture
   * the NULL-safe arm has had since #5030. What follows asserts the LOUD half,
   * which is the half that was actually load-bearing.
   */
  it('absorbs the plain arm too — but only LOUDLY, naming the rows and the remedy (#14902)', async () => {
    arm(postgresIndexBuildConflict());
    await realKnex('product').insert([
      { id: 'r1', organization_id: 'org_a', code: 'DUP' },
      { id: 'r2', organization_id: 'org_b', code: 'DUP' },
    ]);
    // The plain arm goes through knex's schema builder rather than the
    // overridden method, and `knex.schema` is a fresh builder on every access
    // — so the failure is injected by standing in for `knex` itself. Only
    // `schema` is stood in for: `ref`/`raw` and the query builder stay REAL, so
    // the duplicate probe in the branch under test runs against the real table
    // and the row report below is a measurement, not a fixture.
    (driver as any).getExistingIndexNames = async () => new Set<string>();
    (driver as any).knex = Object.assign((...args: any[]) => (realKnex as any)(...args), {
      ref: (id: string) => realKnex.ref(id),
      raw: (...args: any[]) => realKnex.raw(...args),
      schema: {
        alterTable: () => Promise.reject(postgresIndexBuildConflict()),
      },
    });

    await expect(sync([PLAIN_INDEX])).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cannot create unique index/);
    expect(errors[0]).toMatch(/uniq_product_code/);
    expect(errors[0]).toMatch(/NOT enforced/);
    expect(errors[0]).toMatch(/os migrate plan/);
    // The rows the database's own error never named.
    expect(errors[0]).toContain('code="DUP"');
    expect(errors[0]).toMatch(/× 2 rows/);
    // ⛔ And it does not borrow the NULL-safe arm's story: no earlier index
    // admitted these rows, so #5030 is not what happened here.
    expect(errors[0]).not.toMatch(/#5030/);
    expect(errors[0]).not.toMatch(/NULL-safe/);
  });

  it('never absorbs a NON-unique index failure, however much the error reads like a conflict', async () => {
    arm(postgresIndexBuildConflict());
    (driver as any).getExistingIndexNames = async () => new Set<string>();
    (driver as any).knex = {
      schema: {
        alterTable: () => Promise.reject(postgresIndexBuildConflict()),
      },
    };

    // A non-unique index exists for an ACCESS PATH — it cannot raise a
    // uniqueness violation, so a failure that reads as one while creating it is
    // something else entirely. #14902's `unique` limb is what keeps that
    // failing loudly instead of being logged away as an unenforced constraint
    // that was never declared in the first place.
    const rejected: any = await sync([NON_UNIQUE_INDEX]).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(rejected).toBeInstanceOf(Error);
    expect(rejected.code).toBe('23505');
    expect(errors).toHaveLength(0);
  });

  it('rethrows a failure that is not a unique violation, identity preserved', async () => {
    const original = unrelatedDdlFailure();
    arm(original);

    const rejected: any = await sync([NULL_SAFE_INDEX]).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(rejected).toBe(original);
    expect(rejected.code).toBe('42501');
    expect(errors).toHaveLength(0);
  });

  it('still treats an "already exists" race as benign, ahead of the conflict branch', async () => {
    const race = new Error('create unique index - index "uniq_product_organization_id_code" already exists');
    Object.assign(race, { code: '42P07' });
    arm(race);

    await expect(sync([NULL_SAFE_INDEX])).resolves.toBeUndefined();
    // Benign: absorbed WITHOUT the durability-degradation log, because the
    // constraint IS enforced — a different outcome from the #5030 branch.
    expect(errors).toHaveLength(0);
  });
});
