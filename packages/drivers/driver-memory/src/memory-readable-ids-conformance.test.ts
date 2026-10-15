// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3, plan row E4] `driver-memory` implements the composed
 * `ReadableIds` leaf in process — it reads the parent under the composed
 * scope, then member-tests — and refuses an uncomposed leaf with D3's
 * envelope. It owes no tenant wall: it refuses a tenant-scoped call
 * (`memory-tenancy-guard.ts`), so the case-set's tenant-wall case records that
 * refusal instead of rows, as the case-set prescribes.
 *
 * The shared case-set (`READABLE_IDS_CASES`) runs through the shared lowering
 * a real read passes, then E3's pins, which hold on every compiling driver.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  READABLE_IDS_CASES,
  READABLE_IDS_CHILD_OBJECT,
  READABLE_IDS_CHILD_ROWS,
  READABLE_IDS_PARENT_OBJECT,
  READABLE_IDS_PARENT_ROWS,
  READABLE_IDS_REFUSAL,
  ReadableIds,
  lowerFilterCondition,
} from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MULTI_TENANT_UNSUPPORTED_CODE } from './memory-tenancy-guard.js';

const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

const TEXT = (name: string) => ({ type: 'text', name });
const PARENT_FIELDS = { id: TEXT('id'), owner: TEXT('owner'), organization_id: TEXT('organization_id') };
const CHILD_FIELDS = {
  id: TEXT('id'),
  object_name: TEXT('object_name'),
  record_id: TEXT('record_id'),
  label: TEXT('label'),
  organization_id: TEXT('organization_id'),
};
const BIG_PARENT = 'rid_big_parent';
const BIG_CHILD = 'rid_big_child';
/** Past the 2,000-row window the pre-scan this leaf replaces was capped at. */
const BIG_READABLE = 2_400;
const BIG_UNREADABLE = 300;

const sortedIds = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));

describe('[ADR-0139 D3] InMemoryDriver — ReadableIds conformance', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(READABLE_IDS_PARENT_OBJECT, { fields: PARENT_FIELDS });
    await driver.syncSchema(READABLE_IDS_CHILD_OBJECT, { fields: CHILD_FIELDS });
    await driver.syncSchema(BIG_PARENT, { fields: PARENT_FIELDS });
    await driver.syncSchema(BIG_CHILD, { fields: CHILD_FIELDS });
    for (const row of READABLE_IDS_PARENT_ROWS) await driver.create(READABLE_IDS_PARENT_OBJECT, { ...row });
    for (const row of READABLE_IDS_CHILD_ROWS) await driver.create(READABLE_IDS_CHILD_OBJECT, { ...row });
    for (let i = 0; i < BIG_READABLE + BIG_UNREADABLE; i++) {
      const id = `bp${String(i).padStart(5, '0')}`;
      await driver.create(BIG_PARENT, { id, owner: i < BIG_READABLE ? 'reader' : 'someone_else', organization_id: 'org_a' });
      await driver.create(BIG_CHILD, {
        id: `bc${String(i).padStart(5, '0')}`, object_name: BIG_PARENT, record_id: id, label: 'x', organization_id: 'org_a',
      });
    }
  });

  describe('shared conformance cases', () => {
    for (const c of READABLE_IDS_CASES) {
      if (c.verdict === 'refuses-uncomposed') {
        it(c.name, async () => {
          await expect(driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }), c.note).rejects.toMatchObject(
            READABLE_IDS_REFUSAL,
          );
        });
      } else if (c.requiresTenantWall) {
        // D3: memory refuses multi-tenant boot and every tenant-scoped call, so
        // it owes no wall — the case records that refusal.
        it(`${c.name} — refused: driver-memory answers no tenant-scoped read`, async () => {
          await expect(
            driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options),
          ).rejects.toMatchObject({ code: MULTI_TENANT_UNSUPPORTED_CODE });
        });
      } else {
        it(c.name, async () => {
          const rows = await driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options);
          expect(sortedIds(rows), c.note).toEqual(c.expected);
          expect(await driver.count(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options), c.note).toBe(
            c.expected.length,
          );
        });
      }
    }
  });

  describe('E3 pins', () => {
    const scoped = () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(BIG_PARENT), { owner: 'reader' }) } });

    it(`a reader with ${BIG_READABLE} readable candidates gets every visible row, and count equals the rows served`, async () => {
      const rows = await driver.find(BIG_CHILD, { where: seamed(scoped()) });
      expect(rows).toHaveLength(BIG_READABLE);
      expect(await driver.count(BIG_CHILD, { where: seamed(scoped()) })).toBe(rows.length);
    });

    it('an unreadable row stays hidden', async () => {
      const rows = await driver.find(BIG_CHILD, { where: seamed(scoped()) });
      expect(rows.every((r) => Number(String(r.record_id).slice(2)) < BIG_READABLE)).toBe(true);
    });

    it('a deleted parent is excluded, on find, count and aggregate alike', async () => {
      await driver.delete(BIG_PARENT, 'bp00000');
      const rows = await driver.find(BIG_CHILD, { where: seamed(scoped()) });
      expect(rows).toHaveLength(BIG_READABLE - 1);
      expect(rows.some((r) => r.record_id === 'bp00000')).toBe(false);
      expect(await driver.count(BIG_CHILD, { where: seamed(scoped()) })).toBe(BIG_READABLE - 1);
      const out = await driver.aggregate(BIG_CHILD, {
        where: seamed(scoped()),
        aggregations: [{ function: 'count', alias: 'n' }],
      });
      expect(Number((out[0] as any).n)).toBe(BIG_READABLE - 1);
    });

    it('the refusal is logged at error once per driver, and every refusal reaches the caller', async () => {
      const fresh = new InMemoryDriver({ persistence: false });
      await fresh.connect();
      const error = vi.spyOn((fresh as any).logger, 'error');
      for (let i = 0; i < 2; i++) {
        await expect(
          fresh.find(BIG_CHILD, { where: { record_id: { $in: ReadableIds.of(BIG_PARENT) } } }),
        ).rejects.toMatchObject(READABLE_IDS_REFUSAL);
      }
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});
