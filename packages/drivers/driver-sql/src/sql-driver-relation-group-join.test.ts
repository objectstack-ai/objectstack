// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [relation group join] `aggregate()` compiles the relation joins the engine
 * hands it (objectql `relation-group-join.ts`) into one statement:
 *
 *   … FROM child LEFT JOIN (SELECT id, attr FROM parent WHERE <scope> AND
 *   <tenant wall>) p ON child.fk = p.id GROUP BY …, p.attr, <resolved>
 *
 * The related half is compiled the way a composed `ReadableIds` subquery is:
 * the engine's composed scope through this same where compiler, the parent's
 * tenant wall from the read's own options. Pinned here: the buckets and the
 * resolved column (an empty FK, an FK naming no record, a parent the scope
 * hides and another tenant's parent are all unresolved, attribute NULL), the
 * measures unmultiplied by the join, a `null` parent (nothing readable), the
 * statement binding no parameter per parent, and a parent the engine did not
 * compose refused before anything compiles.
 *
 * Every live cell runs where the suite provisions it (`OS_TEST_POSTGRES_URL`,
 * `OS_TEST_MYSQL_URL`); SQLite always runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReadableIds } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';
import { RELATION_GROUP_JOINS, type RelationGroupJoin } from './sql-driver-aggregation.js';

const PARENT = 'os_rgj_parent';
const CHILD = 'os_rgj_child';

const PARENTS = [
  { id: 'p1', stage: 'won', owner: 'me', organization_id: 'org_a' },
  { id: 'p2', stage: 'lost', owner: 'me', organization_id: 'org_a' },
  { id: 'p3', stage: 'won', owner: 'other', organization_id: 'org_a' },
  { id: 'p4', stage: null, owner: 'me', organization_id: 'org_a' },
  { id: 'pb', stage: 'won', owner: 'me', organization_id: 'org_b' },
];
const CHILDREN = [
  { id: 'c1', parent: 'p1', g: 'x', amount: 1, organization_id: 'org_a' },
  { id: 'c2', parent: 'p1', g: 'y', amount: 2, organization_id: 'org_a' },
  { id: 'c3', parent: 'p2', g: 'x', amount: 4, organization_id: 'org_a' },
  { id: 'c4', parent: 'p3', g: 'x', amount: 8, organization_id: 'org_a' },
  { id: 'c5', parent: 'p4', g: 'x', amount: 16, organization_id: 'org_a' },
  { id: 'c6', parent: null, g: 'x', amount: 32, organization_id: 'org_a' },
  { id: 'c7', parent: 'nope', g: 'x', amount: 64, organization_id: 'org_a' },
  { id: 'c8', parent: 'pb', g: 'x', amount: 128, organization_id: 'org_a' },
];

const join = (parent: RelationGroupJoin['parent']): RelationGroupJoin => ({
  field: 'parent',
  parent,
  attrs: [{ attr: 'stage', alias: 'rg_stage' }],
  resolvedAlias: 'rg_resolved',
});

const query = (joins: readonly unknown[], over: Partial<DriverQuery> = {}): DriverQuery => ({
  aggregations: [
    { function: 'count', alias: 'n' },
    { function: 'sum', field: 'amount', alias: 'total' },
  ],
  ...over,
  [RELATION_GROUP_JOINS]: joins,
} as unknown as DriverQuery);

/** `stage|resolved → [count, total]`, order-free. */
const buckets = (rows: Array<Record<string, unknown>>) =>
  Object.fromEntries(rows.map((r) => [`${String(r.rg_stage)}|${String(r.rg_resolved)}`, [Number(r.n), Number(r.total)]]));

function declareCell(cell: DialectCell): void {
  describe(`[relation group join] driver-sql — aggregate LEFT JOINs the composed related rows (${cell.label})`, () => {
    let driver: SqlDriver;
    const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = 'isolated';
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${CHILD}`).catch(() => {});
      await driver.execute(`drop table if exists ${PARENT}`).catch(() => {});
      await driver.initObjects([
        { name: PARENT, fields: { stage: { type: 'text' }, owner: { type: 'text' }, organization_id: { type: 'text' } } },
        { name: CHILD, fields: { parent: { type: 'lookup', reference: PARENT }, g: { type: 'text' }, amount: { type: 'number' }, organization_id: { type: 'text' } } },
      ] as never);
      for (const row of PARENTS) await driver.create(PARENT, { ...row }, { bypassTenantAudit: true });
      for (const row of CHILDREN) await driver.create(CHILD, { ...row }, { bypassTenantAudit: true });
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${CHILD}`).catch(() => {});
      await driver?.execute(`drop table if exists ${PARENT}`).catch(() => {});
      await driver?.disconnect();
      if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
    });

    it('the fixture is tenant-walled on both tables', () => {
      const tenantField = (o: string) => (driver as unknown as { resolveTenantField(o: string): string | null }).resolveTenantField(o);
      expect(tenantField(PARENT)).toBe('organization_id');
      expect(tenantField(CHILD)).toBe('organization_id');
    });

    it('groups by the joined attribute; an empty FK, an FK naming no record, a hidden and another tenant\'s parent are unresolved — every child counted once', async () => {
      const scope = { owner: 'me' };
      const rows = await driver.aggregate(CHILD, query([join(ReadableIds.compose(ReadableIds.of(PARENT), scope))]), { tenantId: 'org_a' });
      expect(buckets(rows as Array<Record<string, unknown>>)).toEqual({
        'won|1': [2, 3], // p1
        'lost|1': [1, 4], // p2
        'null|1': [1, 16], // p4: a readable parent whose stage IS null
        // p3 (outside the scope), no FK, 'nope', pb (org_b): 8 + 32 + 64 + 128.
        'null|0': [4, 232],
      });
    });

    it('beside a base group key, and with no scope (every same-tenant parent readable)', async () => {
      const rows = await driver.aggregate(CHILD, query([join(ReadableIds.compose(ReadableIds.of(PARENT), undefined))], { groupBy: ['g'] }), { tenantId: 'org_a' });
      const got = Object.fromEntries((rows as Array<Record<string, unknown>>).map((r) => [`${String(r.g)}|${String(r.rg_stage)}|${String(r.rg_resolved)}`, Number(r.total)]));
      expect(got).toEqual({
        'x|won|1': 1 + 8, 'y|won|1': 2, 'x|lost|1': 4, 'x|null|1': 16, 'x|null|0': 32 + 64 + 128,
      });
    });

    it('a null parent (nothing readable): every group unresolved, no join', async () => {
      const rows = await driver.aggregate(CHILD, query([join(null)]), { tenantId: 'org_a' });
      expect(buckets(rows as Array<Record<string, unknown>>)).toEqual({ 'null|0': [8, 255] });
    });

    it('binds no parameter per related record: the scope\'s and the walls\' own only', async () => {
      const knex = (driver as unknown as { knex: { on(e: string, f: (q: { bindings?: unknown[] }) => void): void; removeListener(e: string, f: unknown): void } }).knex;
      const seen: number[] = [];
      const listen = (q: { bindings?: unknown[] }) => { seen.push(q.bindings?.length ?? 0); };
      knex.on('query', listen);
      try {
        await driver.aggregate(CHILD, query([join(ReadableIds.compose(ReadableIds.of(PARENT), { owner: 'me' }))]), { tenantId: 'org_a' });
      } finally {
        knex.removeListener('query', listen);
      }
      // child wall + parent wall + the scope's one comparand.
      expect(Math.max(...seen)).toBe(3);
    });

    it('a parent the engine did not compose is refused before anything compiles: INTERNAL_ERROR / 500', async () => {
      const forged = { object: PARENT, scope: undefined };
      const err = await driver.aggregate(CHILD, query([join(forged as never)]), { tenantId: 'org_a' })
        .then(() => null, (e: Error & { code?: string; status?: number }) => e);
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'aggregate relation group join', declareCell);
