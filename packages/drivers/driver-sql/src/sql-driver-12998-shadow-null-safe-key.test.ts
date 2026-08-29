// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12998 — the hash shadow must carry the DECLARED key: NULL-safe organization
 * key parts (ADR-0120 D3) ride into the generation expression.
 *
 * ## The defect
 *
 * When MySQL refuses a declared UNIQUE index directly, the #11627 shadow route
 * received the bare column list — `norm.nullSafeColumns` was not passed — so
 * the generation expression hashed the RAW columns. `CONCAT` returns NULL when
 * any argument is NULL, so every NULL-organization row hashed to NULL and was
 * constrained by NOTHING, on exactly the rows (single-tenant stacks,
 * admin-global defaults) the `COALESCE(organization_id, '__global__')` bucket
 * exists to constrain. That is #5030's zero-constraint shape, silently
 * reintroduced by the fallback while the boot log reported the constraint as
 * carried.
 *
 * ## The two directions, and which is the control
 *
 * - An ORG-SCOPED unique must now COLLIDE two NULL-organization rows — the
 *   declared ADR-0120 D3 semantics, the positive half of this fix.
 * - A PLAIN composite must keep any-NULL tuples NON-conflicting — MySQL's own
 *   composite-UNIQUE semantics, pinned as deliberate in
 *   `sql-driver-11627-hash-shadow-key.test.ts` ("hashes a composite tuple,
 *   keeps any-NULL tuples non-conflicting"). That pin is this change's
 *   CONTROL: a fix that coalesced every key part would pass the first
 *   direction and break a landed, deliberate behaviour.
 *
 * Physical claims are read from `information_schema` in separate queries,
 * never from the DDL this driver emitted (same discipline as the #11627 file).
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

/**
 * An object with a tenant column and one long text field carrying an
 * ORG-SCOPED unique. `maxLength: 1024` exceeds the 768-char keyable ceiling, so
 * MySQL refuses the direct (functional-key-part) index and the sync takes the
 * shadow route — the same route the live members
 * (`sys_notification_preference` / `sys_notification_subscription`) take.
 */
const orgUniqueOn = (name: string) => ({
  name,
  fields: {
    organization_id: { type: 'string' },
    v: { type: 'text', maxLength: 1024 },
  },
  indexes: [{ fields: ['v'], unique: 'organization' as const, name: `uniq_${name}_org_v` }],
});

declareDialectCell(MYSQL_CELL, 'hash-shadow NULL-safe key (#12998)', (cell) => {
  describe('hash-shadow NULL-safe organization key on live MySQL (#12998)', () => {
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

    /**
     * The positive direction: the generation expression embeds the NULL-safe
     * key part, so NULL-organization rows fold into the global bucket and
     * collide — while a different organization, or a different payload, still
     * inserts. The '__global__' literal row colliding with a NULL row is the
     * equivalence pin: the shadow enforces the SAME key the direct
     * `COALESCE(organization_id, '__global__')` index would have.
     */
    it('collides two NULL-organization rows under an org-scoped shadow unique', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([orgUniqueOn('os12998_org')]);

      const { cols, idx } = await catalog('os12998_org');
      const shadow = cols.find((c: any) => isHashShadowColumn(c.COLUMN_NAME));
      expect(shadow, 'a shadow column must exist').toBeTruthy();
      // The generation expression carries the DECLARED key: the organization
      // part in its COALESCE form, folding NULL into the global bucket.
      const expr = String(shadow.GENERATION_EXPRESSION).toLowerCase();
      expect(expr).toContain('coalesce');
      expect(expr).toContain('organization_id');
      expect(expr).toContain('__global__');
      const carried = idx.filter((i: any) => isHashShadowColumn(i.COLUMN_NAME));
      expect(carried.length).toBe(1);
      expect(Number(carried[0].NON_UNIQUE)).toBe(0);
      expect(carried[0].SUB_PART).toBeNull();

      const knex = (driver as any).knex;
      const V = 'x'.repeat(900);
      await knex('os12998_org').insert({ id: 'a', v: V, organization_id: null });
      // The defect's exact shape: a second NULL-organization row with the same
      // payload used to insert (CONCAT → NULL → no constraint). It must now be
      // refused.
      await expect(
        knex('os12998_org').insert({ id: 'b', v: V, organization_id: null }),
      ).rejects.toThrow(/duplicate/i);
      // Scoping is still real: another organization holds the same payload.
      await knex('os12998_org').insert({ id: 'c', v: V, organization_id: 'org_b' });
      // …and a different payload in the global bucket is no conflict.
      await knex('os12998_org').insert({ id: 'd', v: 'y'.repeat(900), organization_id: null });
      // Equivalence with the direct index's key: NULL and the '__global__'
      // literal are ONE bucket.
      const V2 = 'z'.repeat(900);
      await knex('os12998_org').insert({ id: 'e', v: V2, organization_id: '__global__' });
      await expect(
        knex('os12998_org').insert({ id: 'f', v: V2, organization_id: null }),
      ).rejects.toThrow(/duplicate/i);
    });

    /**
     * ⛔ The control, colocated: a PLAIN composite's expression must NOT gain a
     * COALESCE — any-NULL tuples keep conflicting with nothing (the deliberate
     * #11627 semantics its own file pins behaviourally). A fix that coalesced
     * every part would fail exactly here.
     */
    it('leaves plain composite key parts un-coalesced', async () => {
      driver = new SqlDriver(cell.config());
      const plain = {
        name: 'os12998_plain',
        fields: { a: { type: 'text', maxLength: 1024 }, b: { type: 'text', maxLength: 1024 } },
        indexes: [{ fields: ['a', 'b'], unique: true, name: 'uniq_os12998_plain_ab' }],
      };
      await driver.initObjects([plain]);
      const { cols } = await catalog('os12998_plain');
      const shadow = cols.find((c: any) => isHashShadowColumn(c.COLUMN_NAME));
      expect(shadow, 'a shadow column must exist').toBeTruthy();
      expect(String(shadow.GENERATION_EXPRESSION).toLowerCase()).not.toContain('coalesce');
      // And behaviourally: two any-NULL tuples coexist.
      const knex = (driver as any).knex;
      await knex('os12998_plain').insert([
        { id: 'n1', a: 'x'.repeat(900), b: null },
        { id: 'n2', a: 'x'.repeat(900), b: null },
      ]);
      expect((await knex('os12998_plain').whereNull('b')).length).toBe(2);
    });

    /**
     * Turning the constraint ON is data-dependent (ADR-0120 D4's exact shape):
     * a database that accumulated duplicate NULL-organization rows while the
     * shadow enforced nothing fails the shadow ALTER with ER_DUP_ENTRY. That
     * must be a DIAGNOSED degradation — boot survives, the log names the
     * conflicting groups and the operator action — never an unexplained
     * boot-time failure, and never a silent success.
     */
    it('diagnoses existing NULL-org duplicates instead of failing the boot unexplained', async () => {
      driver = new SqlDriver(cell.config());
      const logs: string[] = [];
      (driver as any).logger = {
        warn: (msg: string) => logs.push(String(msg)),
        error: (msg: string) => logs.push(String(msg)),
      };
      // Boot once WITHOUT the unique index, and accumulate the duplicates the
      // void constraint admitted.
      const bare = orgUniqueOn('os12998_dirty');
      const withoutIndex = { ...bare, indexes: [] };
      await driver.initObjects([withoutIndex]);
      const knex = (driver as any).knex;
      const V = 'd'.repeat(900);
      await knex('os12998_dirty').insert([
        { id: 'a', v: V, organization_id: null },
        { id: 'b', v: V, organization_id: null },
      ]);

      // Re-register WITH the org-scoped unique: direct index refused (TEXT key),
      // shadow ALTER hits ER_DUP_ENTRY on the existing rows.
      await expect(driver.initObjects([bare])).resolves.not.toThrow();

      const diagnosis = logs.find((l) => l.includes('cannot create hash-shadow unique index'));
      expect(diagnosis, 'the degradation must be logged').toBeTruthy();
      // It names the constraint in its declared (COALESCE) form, the
      // conflicting group, and what the operator must do.
      expect(diagnosis).toContain("COALESCE(organization_id, '__global__')");
      expect(diagnosis).toMatch(/Conflicting group\(s\):/);
      expect(diagnosis).toMatch(/os migrate plan/);
      // And the constraint is honestly ABSENT — no index, and the atomic ALTER
      // left no orphaned shadow column behind.
      const { cols, idx } = await catalog('os12998_dirty');
      expect(idx.some((i: any) => i.INDEX_NAME === 'uniq_os12998_dirty_org_v')).toBe(false);
      expect(cols.filter((c: any) => isHashShadowColumn(c.COLUMN_NAME))).toEqual([]);
    });

    /**
     * The write-path half of ruling #11627 clause-②, now for the NULL-safe
     * key: a genuine NULL-organization duplicate must be named in DECLARED
     * terms — not left as MySQL's binary digest, and above all not misreported
     * as a HASH COLLISION. The re-select must compare through the same
     * COALESCE fold the enforced key applies (a bare `= NULL` matches nothing
     * and would flip the verdict to the collision branch).
     */
    it('names a NULL-organization duplicate in declared terms, never as a collision', async () => {
      driver = new SqlDriver(cell.config());
      await driver.initObjects([orgUniqueOn('os12998_msg')]);
      const V = 'm'.repeat(900);
      await driver.create('os12998_msg', { v: V });
      const err: unknown = await driver.create('os12998_msg', { v: V }).then(
        () => null,
        (e) => e,
      );
      expect(err, 'the NULL-organization duplicate must be refused').toBeTruthy();
      const msg = String((err as Error)?.message ?? err);
      expect(msg).toMatch(/duplicate value for the UNIQUE constraint 'uniq_os12998_msg_org_v'/);
      expect(msg).toContain("COALESCE(organization_id, '__global__')");
      expect(msg).not.toContain('HASH COLLISION');
    });
  });
});
