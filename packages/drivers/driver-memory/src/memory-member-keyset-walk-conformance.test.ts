// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A keyset walk by `id` visits every row once, in the driver's own order
 * (#29398 item 1) — the query shape of the organization-membership completion
 * read in `@objectstack/core` (`readOrganizationMembersToCompletion`): pages
 * of `{ organization_id, id: { $gt: after } }`, `orderBy id asc`, a `limit`,
 * the columns `id` and `user_id`, resuming after each full page's last id.
 *
 * The resolver cannot check the order itself, because the order is the
 * driver's (a SQL database's collation, not JavaScript's code points); the
 * walk is correct exactly when the cursor and the order share one comparison.
 * This pins that for this driver: the pages, joined, are the sequence of one
 * unpaged ordered read, holding every row of the organization once and no row
 * of another. The ids are mixed-case nanoid-alphabet values, no two equal
 * after case folding. The same pin lives in driver-sql (per dialect cell),
 * driver-sqlite-wasm, driver-turso and driver-mongodb; the drivers' shared
 * conformance cases live in `@objectstack/spec/data`, which this change does
 * not edit.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

const TABLE = 'sys_member';
const ORG = 'org_walked';
const OTHER_ORG = 'org_other';

/** The organization walked: sixteen ids, no two equal after case folding. */
const MEMBER_IDS = [
  'AC', 'Ab9', 'B-2', 'a-c', 'aB3', 'ab', 'b_1', '0Zz',
  'Z0', 'z_9', '_x', '-y', 'Mm', 'mN1', 'n', 'Q-q',
] as const;
/** Another organization's rows, interleaved with the walked ones. */
const OTHER_IDS = ['Aa', 'b', 'zZ'] as const;

/** Page sizes: one row, a mid-run boundary, an exact multiple (16 = 4 x 4), the whole set. */
const PAGE_SIZES = [1, 3, 4, 16] as const;

const userIdOf = (id: string) => `user_${id}`;

describe("InMemoryDriver — a keyset walk by id visits every member once, in the driver's order (#29398)", () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    const rows = [
      ...MEMBER_IDS.map((id) => ({ id, organization_id: ORG, user_id: userIdOf(id) })),
      ...OTHER_IDS.map((id) => ({ id, organization_id: OTHER_ORG, user_id: userIdOf(id) })),
    ];
    for (const row of rows) await driver.create(TABLE, row);
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
