// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3, plan row E3] `driver-sql` compiles the composed `ReadableIds`
 * leaf to `field IN (SELECT id FROM P_TABLE WHERE SCOPE AND TENANT)`, the
 * subquery walled by `applyTenantScope` with the outer read's options, and
 * refuses an uncomposed leaf with D3's envelope.
 *
 * Two halves:
 *
 * - **the shared case-set** (`READABLE_IDS_CASES`, `@objectstack/spec/data`),
 *   on every dialect cell — no per-driver hand copy;
 * - **E3's pins** — more than 2,000 readable candidates all served, an
 *   unreadable row hidden, a deleted parent excluded, `count` equal to the rows
 *   served — plus the O1 reading: what the statement binds.
 *
 * Every `where` goes through the shared lowering first (`lowerFilterCondition`),
 * the seam a real read passes, so the NULL-safe `$not` case measures the
 * lowering's guard composed with the leaf rather than a three-valued `NOT IN`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  READABLE_IDS_CASES,
  READABLE_IDS_CHILD_OBJECT,
  READABLE_IDS_CHILD_ROWS,
  READABLE_IDS_PARENT_OBJECT,
  READABLE_IDS_PARENT_ROWS,
  READABLE_IDS_REFUSAL,
  ReadableIds,
  lowerFilterCondition,
  type FilterCondition,
} from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

const PARENT_FIELDS = { owner: { type: 'text' }, organization_id: { type: 'text' } };
const CHILD_FIELDS = {
  object_name: { type: 'text' },
  record_id: { type: 'text' },
  label: { type: 'text' },
  organization_id: { type: 'text' },
};

const BIG_PARENT = 'rid_big_parent';
const BIG_CHILD = 'rid_big_child';
/** Past the 2,000-row window the pre-scan this leaf replaces was capped at. */
const BIG_READABLE = 2_400;
const BIG_UNREADABLE = 300;

const sortedIds = (rows: any[]): string[] => rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));

async function insertChunked(driver: SqlDriver, table: string, rows: Record<string, unknown>[]): Promise<void> {
  const knex = (driver as any).knex;
  for (let i = 0; i < rows.length; i += 100) await knex(table).insert(rows.slice(i, i + 100));
}

function declareReadableIdsSweep(cell: DialectCell): void {
  describe(`[ADR-0139 D3] driver-sql — ReadableIds conformance (${cell.label})`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      for (const t of [READABLE_IDS_CHILD_OBJECT, READABLE_IDS_PARENT_OBJECT, BIG_CHILD, BIG_PARENT]) {
        await driver.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver.initObjects([
        { name: READABLE_IDS_PARENT_OBJECT, fields: { ...PARENT_FIELDS } },
        { name: READABLE_IDS_CHILD_OBJECT, fields: { ...CHILD_FIELDS } },
        { name: BIG_PARENT, fields: { ...PARENT_FIELDS } },
        { name: BIG_CHILD, fields: { ...CHILD_FIELDS } },
      ] as any);
      await insertChunked(driver, READABLE_IDS_PARENT_OBJECT, READABLE_IDS_PARENT_ROWS.map((r) => ({ ...r })));
      await insertChunked(driver, READABLE_IDS_CHILD_OBJECT, READABLE_IDS_CHILD_ROWS.map((r) => ({ ...r })));

      // E3's population: BIG_READABLE parents the scope admits, BIG_UNREADABLE
      // it does not, one child each.
      const parents: Record<string, unknown>[] = [];
      const children: Record<string, unknown>[] = [];
      for (let i = 0; i < BIG_READABLE + BIG_UNREADABLE; i++) {
        const id = `bp${String(i).padStart(5, '0')}`;
        parents.push({ id, owner: i < BIG_READABLE ? 'reader' : 'someone_else', organization_id: 'org_a' });
        children.push({ id: `bc${String(i).padStart(5, '0')}`, object_name: BIG_PARENT, record_id: id, label: 'x', organization_id: 'org_a' });
      }
      await insertChunked(driver, BIG_PARENT, parents);
      await insertChunked(driver, BIG_CHILD, children);
    }, 60_000);

    afterAll(async () => {
      for (const t of [READABLE_IDS_CHILD_OBJECT, READABLE_IDS_PARENT_OBJECT, BIG_CHILD, BIG_PARENT]) {
        await driver?.execute(`drop table if exists ${t}`).catch(() => {});
      }
      await driver?.disconnect?.();
    });

    describe('shared conformance cases', () => {
      for (const c of READABLE_IDS_CASES) {
        if (c.verdict === 'matches') {
          it(c.name, async () => {
            const rows = await driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options);
            expect(sortedIds(rows), c.note).toEqual(c.expected);
            // One statement: `count` answers the same population as `find`.
            const n = await driver.count(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options);
            expect(n, c.note).toBe(c.expected.length);
          });
        } else {
          it(c.name, async () => {
            await expect(
              driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }),
              c.note,
            ).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          });
        }
      }
    });

    describe('E3 pins', () => {
      const scoped = () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(BIG_PARENT), { owner: 'reader' }) } });

      it(`a reader with ${BIG_READABLE} readable candidates gets every visible row, and count equals the rows served`, async () => {
        const rows = await driver.find(BIG_CHILD, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        expect(rows).toHaveLength(BIG_READABLE);
        const n = await driver.count(BIG_CHILD, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        expect(n).toBe(rows.length);
      });

      it('an unreadable row stays hidden', async () => {
        const rows = await driver.find(BIG_CHILD, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        const ids = new Set(rows.map((r: any) => String(r.record_id)));
        expect(ids.has(`bp${String(BIG_READABLE).padStart(5, '0')}`)).toBe(false);
        expect([...ids].every((id) => Number(id.slice(2)) < BIG_READABLE)).toBe(true);
      });

      it('a deleted parent is excluded', async () => {
        await driver.delete(BIG_PARENT, 'bp00000', { bypassTenantAudit: true });
        const rows = await driver.find(BIG_CHILD, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        expect(rows).toHaveLength(BIG_READABLE - 1);
        expect(rows.some((r: any) => r.record_id === 'bp00000')).toBe(false);
        expect(await driver.count(BIG_CHILD, { where: seamed(scoped()) }, { tenantId: 'org_a' })).toBe(BIG_READABLE - 1);
      });

      it('aggregate agrees with find: the leaf is one statement on every read verb', async () => {
        const out = await driver.aggregate(
          BIG_CHILD,
          { where: seamed(scoped()), aggregations: [{ function: 'count', alias: 'n' }] },
          { tenantId: 'org_a' },
        );
        expect(Number((out[0] as any).n)).toBe(BIG_READABLE - 1);
      });

      it('O1: the statement binds no per-id parameter, whatever the parent\'s size', async () => {
        const knex = (driver as any).knex;
        const bindings: number[] = [];
        const onQuery = (q: { sql: string; bindings?: unknown[] }) => {
          if (/rid_big_parent/.test(q.sql)) bindings.push(q.bindings?.length ?? 0);
        };
        knex.on('query', onQuery);
        try {
          await driver.find(BIG_CHILD, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        } finally {
          knex.removeListener('query', onQuery);
        }
        // The scope's one comparand and the two tenant walls (outer and
        // subquery) — ⛔ never one parameter per readable parent.
        expect(bindings).toHaveLength(1);
        expect(bindings[0]).toBeLessThanOrEqual(3);
      });

      it('the refusal is logged at error once per driver, and every refusal reaches the caller', async () => {
        const fresh = new SqlDriver(cell.config());
        const error = vi.spyOn((fresh as any).logger, 'error');
        const uncomposed = () => ({ record_id: { $in: ReadableIds.of(BIG_PARENT) } });
        for (let i = 0; i < 2; i++) {
          await expect(fresh.find(BIG_CHILD, { where: uncomposed() })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
        }
        expect(error).toHaveBeenCalledTimes(1);
        await fresh.disconnect?.();
      });

      it('a composed leaf outside a $in comparand is refused with the same envelope', async () => {
        const leaf = ReadableIds.compose(ReadableIds.of(BIG_PARENT), undefined);
        await expect(driver.find(BIG_CHILD, { where: { record_id: { $nin: leaf } } as unknown as FilterCondition })).rejects.toMatchObject(
          READABLE_IDS_REFUSAL,
        );
      });
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'ReadableIds conformance', declareReadableIdsSweep);
