// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15479 — the HASH-SHADOW arm of `syncDeclaredIndexes`'s `catch`, on a PLAIN
 * unique over rows that already violate it.
 *
 * ## The defect
 *
 * #14902 (PR #15477) brought the DIRECT arm to parity: a plain unique over
 * existing duplicates logs on the durability channel and lets the boot
 * continue, instead of throwing the database's raw error. The hash-shadow arm
 * — one branch above it in the SAME `catch`, taken when MySQL refuses to key
 * the column directly — still asked `nullSafe.size > 0 && isUniqueViolation…`,
 * so with no organization key part the branch did not fire, the code fell
 * through to `logDurabilityFailure(unkeyable, msg)` + `throw`, and the boot
 * died carrying a message about an UNKEYABLE TEXT COLUMN while the actual
 * cause was duplicate rows — naming neither the conflicting rows nor a remedy.
 *
 * ## Why this file is a live cell and could not be a SQLite one
 *
 * The shadow route exists only because MySQL refuses a key part over the
 * 768-char utf8mb4 ceiling; SQLite and Postgres never refuse, so they never
 * reach this arm. `maxLength: 1024` is what selects it. The card that filed
 * this said the branch was unreachable in the dispatch container — measured
 * false: MySQL 8.0 installs from the distro archive and this suite drives it.
 *
 * ## The two-arm message split, which is the half that is NOT a guard widening
 *
 * The surviving branch's message said "existing rows violate the NULL-safe key
 * (duplicates the previous void constraint admitted, #5030)". Neither clause is
 * true of a plain unique: nothing admitted those rows, and there is no NULL-safe
 * key. Widening the guard and leaving one message would ship a FACTUALLY FALSE
 * durability log — worse than the throw it replaces, because it sends the
 * operator hunting for a NULL-distinct index that was never there. So the
 * NULL-safe branch keeps its wording (asserted below as the CONTROL) and the
 * plain branch gets the direct arm's reviewed sentence.
 *
 * Opt-in, like every live cell in this package:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *     pnpm --filter @objectstack/driver-sql test
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { isHashShadowColumn } from './schema-drift.js';
import { MYSQL_CELL, declareDialectCell } from './live-dialect-matrix.testkit.js';

/** 900 chars — comfortably over the 768-char keyable ceiling, so `v` is TEXT. */
const LONG = 'p'.repeat(900);

/**
 * A tenancy-DISABLED object whose one long text field carries a PLAIN unique.
 * `maxLength: 1024` exceeds the keyable ceiling, so MySQL refuses the direct
 * index and the sync takes the shadow route; `tenancy: { enabled: false }` is
 * one of the two shapes #14902 identified as reaching the plain path (the other
 * is an explicit `unique: 'global'`, exercised by `globalUniqueOn` below).
 */
const plainUniqueOn = (name: string) => ({
  name,
  tenancy: { enabled: false },
  fields: { v: { type: 'text', maxLength: 1024 } },
  indexes: [{ fields: ['v'], unique: true as const, name: `uniq_${name}_v` }],
});

/** The second shape of the same path: tenanted object, explicit global scope. */
const globalUniqueOn = (name: string) => ({
  name,
  fields: {
    organization_id: { type: 'string' },
    v: { type: 'text', maxLength: 1024 },
  },
  indexes: [{ fields: ['v'], unique: 'global' as const, name: `uniq_${name}_v` }],
});

/** The CONTROL shape: an organization-scoped unique, i.e. the NULL-safe arm. */
const orgUniqueOn = (name: string) => ({
  name,
  fields: {
    organization_id: { type: 'string' },
    v: { type: 'text', maxLength: 1024 },
  },
  indexes: [{ fields: ['v'], unique: 'organization' as const, name: `uniq_${name}_v` }],
});

declareDialectCell(MYSQL_CELL, 'hash-shadow plain unique over duplicates (#15479)', (cell) => {
  describe('hash-shadow arm, plain unique over duplicate rows on live MySQL (#15479)', () => {
    let driver: SqlDriver;
    afterEach(async () => {
      await driver?.disconnect().catch(() => {});
    });

    /** Physical truth, read back from the catalog rather than from our DDL. */
    const catalog = async (table: string) => {
      const knex = (driver as any).knex;
      const cols = await knex
        .select('COLUMN_NAME', 'DATA_TYPE', 'GENERATION_EXPRESSION')
        .from('information_schema.COLUMNS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: table });
      const idx = await knex
        .select('INDEX_NAME', 'NON_UNIQUE', 'COLUMN_NAME', 'SUB_PART')
        .from('information_schema.STATISTICS')
        .where({ TABLE_SCHEMA: knex.client.database(), TABLE_NAME: table });
      return { cols, idx };
    };

    /** Collect this driver's log lines rather than letting them reach stdout. */
    const spy = (): string[] => {
      const logs: string[] = [];
      (driver as any).logger = {
        warn: (msg: string) => logs.push(String(msg)),
        info: (msg: string) => logs.push(String(msg)),
        error: (msg: string) => logs.push(String(msg)),
      };
      return logs;
    };

    /**
     * Boot the object WITHOUT its unique index, accumulate two rows that
     * violate it, then re-register WITH the index — the legacy-upgrade shape.
     */
    const seedDuplicatesThenDeclare = async (
      meta: { name: string; indexes: unknown[] },
      row: Record<string, unknown>,
    ): Promise<{ logs: string[]; err: unknown }> => {
      driver = new SqlDriver(cell.config());
      const logs = spy();
      await driver.initObjects([{ ...meta, indexes: [] }] as any);
      const knex = (driver as any).knex;
      await knex(meta.name).insert([
        { id: 'a', ...row },
        { id: 'b', ...row },
      ]);
      const err: unknown = await driver.initObjects([meta] as any).then(
        () => null,
        (e) => e,
      );
      return { logs, err };
    };

    // ── Why each it() carries an explicit 60_000 budget (#13902) ──
    // Each block constructs a FRESH `new SqlDriver(...)` against this cell's
    // live server inside its own body, so the connect cycle plus the schema-sync
    // DDL and catalog read-back are paid PER TEST rather than once in a
    // beforeAll. Sized like this package's siblings; not a claim that these are
    // normally anywhere near that slow.

    /**
     * THE CARD'S THREE ACCEPTANCE CONDITIONS, on the `tenancy: { enabled: false }`
     * shape: the boot survives, the durability log names the conflicting group
     * and the remedy, and the index is absent afterwards.
     */
    it('survives the boot and diagnoses duplicates under a tenancy-disabled plain unique', async () => {
      const { logs, err } = await seedDuplicatesThenDeclare(plainUniqueOn('os15479_plain'), {
        v: LONG,
      });

      expect(err, 'the boot must NOT die: this is a degradation, not a fatal').toBeNull();

      const diagnosis = logs.find((l) => l.includes("cannot create hash-shadow unique index 'uniq_os15479_plain_v'"));
      expect(diagnosis, 'the degradation must reach the durability channel').toBeTruthy();
      expect(diagnosis).toMatch(/Conflicting group\(s\): \(v="p+"\) × 2 rows/);
      expect(diagnosis).toMatch(/os migrate plan/);
      expect(diagnosis).toContain("The constraint 'v' is NOT enforced");

      // ⛔ And it must NOT carry the NULL-safe arm's framing, which is false
      // here: nothing admitted these rows and there is no NULL-safe key.
      expect(diagnosis).not.toContain('#5030');
      expect(diagnosis).not.toContain('NULL-safe');
      expect(diagnosis).not.toContain('COALESCE');

      // The constraint is honestly ABSENT, and the atomic ALTER left no
      // orphaned shadow column behind.
      const { cols, idx } = await catalog('os15479_plain');
      expect(idx.some((i: any) => i.INDEX_NAME === 'uniq_os15479_plain_v')).toBe(false);
      expect(cols.filter((c: any) => isHashShadowColumn(c.COLUMN_NAME))).toEqual([]);
    }, 60_000);

    /**
     * The same disposition on the OTHER shape that reaches the plain path — an
     * explicit `unique: 'global'` on a tenanted object. Two shapes because
     * #14902 measured both, and a guard keyed on the wrong one would pass here
     * and fail in production.
     */
    it("survives the boot under an explicit unique: 'global' on a tenanted object", async () => {
      const { logs, err } = await seedDuplicatesThenDeclare(globalUniqueOn('os15479_global'), {
        v: LONG,
        organization_id: 'org_a',
      });

      expect(err, 'the boot must NOT die').toBeNull();
      const diagnosis = logs.find((l) => l.includes("cannot create hash-shadow unique index 'uniq_os15479_global_v'"));
      expect(diagnosis, 'the degradation must reach the durability channel').toBeTruthy();
      expect(diagnosis).toMatch(/Conflicting group\(s\):/);
      expect(diagnosis).not.toContain('#5030');
      expect(diagnosis).not.toContain('COALESCE');

      const { idx } = await catalog('os15479_global');
      expect(idx.some((i: any) => i.INDEX_NAME === 'uniq_os15479_global_v')).toBe(false);
    }, 60_000);

    /**
     * ⛔ THE CONTROL for the message split: the NULL-safe arm keeps its OWN
     * wording. A one-character fix that widened the guard and left a single
     * message would pass the two blocks above and fail exactly here — and the
     * inverse mistake, rewriting both arms into the plain sentence, fails here
     * too.
     */
    it('leaves the NULL-safe arm saying the NULL-safe thing', async () => {
      const { logs, err } = await seedDuplicatesThenDeclare(orgUniqueOn('os15479_org'), {
        v: LONG,
        organization_id: null,
      });

      expect(err, 'the NULL-safe arm already survived the boot').toBeNull();
      const diagnosis = logs.find((l) => l.includes("cannot create hash-shadow unique index 'uniq_os15479_org_v'"));
      expect(diagnosis, 'the NULL-safe degradation must still be logged').toBeTruthy();
      expect(diagnosis).toContain('#5030');
      expect(diagnosis).toContain('NULL-safe');
      expect(diagnosis).toContain("COALESCE(organization_id, '__global__')");
    }, 60_000);

    /**
     * The positive control that the widened guard did not turn the shadow route
     * off: over CLEAN data the plain unique is still CREATED, on the shadow
     * column, and still enforces.
     */
    it('still creates and enforces the plain shadow unique over clean data', async () => {
      driver = new SqlDriver(cell.config());
      spy();
      await driver.initObjects([plainUniqueOn('os15479_clean')] as any);

      const { cols, idx } = await catalog('os15479_clean');
      const shadow = cols.find((c: any) => isHashShadowColumn(c.COLUMN_NAME));
      expect(shadow, 'a shadow column must exist').toBeTruthy();
      const carried = idx.filter((i: any) => isHashShadowColumn(i.COLUMN_NAME));
      expect(carried.length).toBe(1);
      expect(Number(carried[0].NON_UNIQUE)).toBe(0);

      const knex = (driver as any).knex;
      await knex('os15479_clean').insert({ id: 'a', v: LONG });
      await expect(knex('os15479_clean').insert({ id: 'b', v: LONG })).rejects.toThrow(/duplicate/i);
      await knex('os15479_clean').insert({ id: 'c', v: 'q'.repeat(900) });
    }, 60_000);
  });
});
