// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A keyset walk by `id` visits every row once, in the driver's own order
 * (#29398 item 1) — the query shape of the organization-membership completion
 * read in `@objectstack/core` (`readOrganizationMembersToCompletion`).
 *
 * That read pages `sys_member` with `{ organization_id, id: { $gt: after } }`,
 * `orderBy id asc`, a `limit`, and the columns `id` and `user_id`, resuming
 * after the last id of each full page. Its correctness rests on the driver,
 * and on nothing the resolver can check for itself: the order is the
 * database's collation, not JavaScript's code-point order (PostgreSQL with an
 * ICU `en-US` database sorts `a-c ab aB3 Ab9 AC b_1 B-2`, a `C.UTF-8` one
 * sorts `AC Ab9 B-2 a-c aB3 ab b_1`), so a resolver-side "each id is greater
 * than the last" check would refuse every correct page on such a database.
 * The keyset is collation-safe because `ORDER BY id` and `id > ?` use the
 * same comparison. This file pins exactly that, per dialect cell: the pages,
 * joined, are the same sequence as one unpaged ordered read, and that sequence
 * holds every row of the organization once and no row of another.
 *
 * The ids are mixed-case nanoid-alphabet values (letters of both cases,
 * digits, `-`, `_`), so a cell whose collation folds case or weighs
 * punctuation differently still walks a real non-code-point order. No two
 * ids are equal after case folding: a case-insensitive primary key (MySQL's
 * `utf8mb4_0900_ai_ci`) would refuse such a pair at insert, which is a
 * different fact from the one pinned here.
 *
 * Each driver package carries its own copy of this pin (driver-memory,
 * driver-sqlite-wasm, driver-turso, driver-mongodb): the drivers' shared
 * conformance cases live in `@objectstack/spec/data`, which this change does
 * not edit.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import { DIALECT_CELLS, declareUnprovisionedCell, type DialectCell } from './live-dialect-matrix.testkit.js';

/** Issue-prefixed: the live cells share a database with every other suite in this package. */
const TABLE = 'os29398_member_keyset';
const ORG = 'org_walked';
const OTHER_ORG = 'org_other';

/** The organization walked: sixteen ids, no two equal after case folding. */
const MEMBER_IDS = [
  'AC', 'Ab9', 'B-2', 'a-c', 'aB3', 'ab', 'b_1', '0Zz',
  'Z0', 'z_9', '_x', '-y', 'Mm', 'mN1', 'n', 'Q-q',
] as const;
/** Another organization's rows, interleaved with the walked ones in any collation. */
const OTHER_IDS = ['Aa', 'b', 'zZ'] as const;

/** Page sizes: one row, a mid-run boundary, an exact multiple (16 = 4 x 4), the whole set. */
const PAGE_SIZES = [1, 3, 4, 16] as const;

const READ_OPTIONS = { bypassTenantAudit: true } as const;

const userIdOf = (id: string) => `user_${id}`;

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'member keyset walk conformance');
    continue;
  }
  declareWalk(cell);
}

function declareWalk(cell: DialectCell): void {
  describe(`SqlDriver — a keyset walk by id visits every member once, in the driver's order (#29398) (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { organization_id: { type: 'string' }, user_id: { type: 'string' } } } as any,
      ]);
      const rows = [
        ...MEMBER_IDS.map((id) => ({ id, organization_id: ORG, user_id: userIdOf(id) })),
        ...OTHER_IDS.map((id) => ({ id, organization_id: OTHER_ORG, user_id: userIdOf(id) })),
      ];
      for (const row of rows) await driver.create(TABLE, row, READ_OPTIONS);
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect?.();
    });

    /** The completion read's loop: resume after the last id of each full page. */
    const walk = async (pageSize: number) => {
      const visited: Array<Record<string, unknown>> = [];
      let after: unknown;
      let reads = 0;
      for (;;) {
        const where = after === undefined
          ? { organization_id: ORG }
          : { organization_id: ORG, id: { $gt: after } };
        const page: Array<Record<string, unknown>> = await driver.find(
          TABLE,
          { where, orderBy: [{ field: 'id', order: 'asc' }], limit: pageSize, fields: ['id', 'user_id'] },
          READ_OPTIONS,
        );
        reads += 1;
        // A driver that ignores the cursor would page forever: fail instead of hanging.
        expect(reads, 'the walk did not end; the cursor is not narrowing the read').toBeLessThanOrEqual(MEMBER_IDS.length + 1);
        visited.push(...page);
        if (page.length < pageSize) break;
        after = page[page.length - 1]!.id;
      }
      return { visited, reads };
    };

    /** The driver's own order, read once without a page boundary to cross. */
    const ordered = async () => {
      const rows: Array<Record<string, unknown>> = await driver.find(
        TABLE,
        { where: { organization_id: ORG }, orderBy: [{ field: 'id', order: 'asc' }], fields: ['id', 'user_id'] },
        READ_OPTIONS,
      );
      return rows.map((r) => String(r.id));
    };

    for (const pageSize of PAGE_SIZES) {
      it(`pages of ${pageSize}: every member once, no other organization's row, in one ordered read's sequence`, async () => {
        const { visited, reads } = await walk(pageSize);
        const ids = visited.map((r) => String(r.id));

        expect(ids).toEqual(await ordered());
        expect([...ids].sort()).toEqual([...MEMBER_IDS].sort());
        expect(new Set(ids).size).toBe(MEMBER_IDS.length);
        for (const row of visited) expect(row.user_id).toBe(userIdOf(String(row.id)));
        expect(reads).toBe(Math.floor(MEMBER_IDS.length / pageSize) + 1);
      });
    }
  });
}
