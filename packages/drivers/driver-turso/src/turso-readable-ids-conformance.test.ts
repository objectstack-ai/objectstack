// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D3, plan row E3] `TursoDriver` compiles the composed `ReadableIds`
 * leaf on BOTH faces, and refuses an uncomposed one with D3's envelope:
 *
 * - **local** inherits `SqlDriver`'s compile (`readableIdsSubquery`, walled by
 *   `applyTenantScope` with the outer read's options);
 * - **remote** is an independent compiler: `TursoDriver.toRemoteWhere`
 *   resolves the leaf — the parent's table and its tenant wall, compiled by the
 *   same chokepoint — and `RemoteTransport` compiles the semi-join.
 *
 * The shared case-set (`READABLE_IDS_CASES`) runs on each face through the
 * shared lowering a real read passes, then E3's pins on the remote face, the
 * one that inherits nothing.
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
} from '@objectstack/spec/data';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

const seamed = (where: unknown): any => lowerFilterCondition(where, { isDatetimeColumn: () => false });

const PARENT = {
  name: READABLE_IDS_PARENT_OBJECT,
  fields: { owner: { type: 'string' }, organization_id: { type: 'string' } },
};
const CHILD = {
  name: READABLE_IDS_CHILD_OBJECT,
  fields: {
    object_name: { type: 'string' },
    record_id: { type: 'string' },
    label: { type: 'string' },
    organization_id: { type: 'string' },
  },
};
const BIG_PARENT = { ...PARENT, name: 'rid_big_parent' };
const BIG_CHILD = { ...CHILD, name: 'rid_big_child' };
/** Past the 2,000-row window the pre-scan this leaf replaces was capped at. */
const BIG_READABLE = 2_100;
const BIG_UNREADABLE = 50;

const sortedIds = (rows: Array<Record<string, unknown>>): string[] =>
  rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));

type Face = 'local' | 'remote';

function declareFace(face: Face): void {
  describe(`[ADR-0139 D3] TursoDriver — ReadableIds conformance (${face} face)`, () => {
    let driver: TursoDriver;
    let stub: LibsqlSqliteStub | undefined;

    beforeAll(async () => {
      if (face === 'remote') {
        stub = makeLibsqlSqliteStub();
        driver = new TursoDriver({ url: 'libsql://readable-ids.turso.io', client: stub as never });
        await driver.connect();
        expect(driver.transportMode).toBe('remote');
        for (const obj of [PARENT, CHILD, BIG_PARENT, BIG_CHILD]) await driver.syncSchema(obj.name, obj);
      } else {
        driver = new TursoDriver({ url: ':memory:' });
        expect(driver.transportMode).toBe('local');
        await driver.initObjects([PARENT, CHILD, BIG_PARENT, BIG_CHILD]);
      }
      const opts = { bypassTenantAudit: true } as const;
      for (const row of READABLE_IDS_PARENT_ROWS) await driver.create(PARENT.name, { ...row }, opts);
      for (const row of READABLE_IDS_CHILD_ROWS) await driver.create(CHILD.name, { ...row }, opts);
      if (face === 'remote') {
        for (let i = 0; i < BIG_READABLE + BIG_UNREADABLE; i++) {
          const id = `bp${String(i).padStart(5, '0')}`;
          await driver.create(BIG_PARENT.name, {
            id, owner: i < BIG_READABLE ? 'reader' : 'someone_else', organization_id: 'org_a',
          }, opts);
          await driver.create(BIG_CHILD.name, {
            id: `bc${String(i).padStart(5, '0')}`, object_name: BIG_PARENT.name, record_id: id, label: 'x', organization_id: 'org_a',
          }, opts);
        }
      }
    }, 120_000);

    afterAll(async () => {
      await driver?.disconnect();
      stub?.close();
    });

    describe('shared conformance cases', () => {
      for (const c of READABLE_IDS_CASES) {
        if (c.verdict === 'matches') {
          it(c.name, async () => {
            const rows = await driver.find(CHILD.name, { where: seamed(c.where()) }, c.options);
            expect(sortedIds(rows), c.note).toEqual(c.expected);
            expect(await driver.count(CHILD.name, { where: seamed(c.where()) }, c.options), c.note).toBe(c.expected.length);
          });
        } else {
          it(c.name, async () => {
            await expect(driver.find(CHILD.name, { where: seamed(c.where()) }), c.note).rejects.toMatchObject(
              READABLE_IDS_REFUSAL,
            );
          });
        }
      }
    });

    if (face !== 'remote') return;

    describe('E3 pins (remote face)', () => {
      const scoped = () => ({ record_id: { $in: ReadableIds.compose(ReadableIds.of(BIG_PARENT.name), { owner: 'reader' }) } });

      it(`a reader with ${BIG_READABLE} readable candidates gets every visible row, and count equals the rows served`, async () => {
        const rows = await driver.find(BIG_CHILD.name, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        expect(rows).toHaveLength(BIG_READABLE);
        expect(await driver.count(BIG_CHILD.name, { where: seamed(scoped()) }, { tenantId: 'org_a' })).toBe(rows.length);
      });

      it('an unreadable row stays hidden', async () => {
        const rows = await driver.find(BIG_CHILD.name, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        expect(rows.every((r) => Number(String(r.record_id).slice(2)) < BIG_READABLE)).toBe(true);
      });

      it('a deleted parent is excluded', async () => {
        await driver.delete(BIG_PARENT.name, 'bp00000', { bypassTenantAudit: true } as any);
        const rows = await driver.find(BIG_CHILD.name, { where: seamed(scoped()) }, { tenantId: 'org_a' });
        expect(rows).toHaveLength(BIG_READABLE - 1);
        expect(rows.some((r) => r.record_id === 'bp00000')).toBe(false);
        expect(await driver.count(BIG_CHILD.name, { where: seamed(scoped()) }, { tenantId: 'org_a' })).toBe(BIG_READABLE - 1);
      });

      it('aggregate agrees with find', async () => {
        const out = await driver.aggregate(
          BIG_CHILD.name,
          { where: seamed(scoped()), aggregations: [{ function: 'count', alias: 'n' }] } as any,
          { tenantId: 'org_a' },
        );
        expect(Number((out[0] as any).n)).toBe(BIG_READABLE - 1);
      });

      it('the refusal is logged at error once per driver, and every refusal reaches the caller', async () => {
        const error = vi.spyOn((driver as any).logger, 'error');
        const uncomposed = () => ({ record_id: { $in: ReadableIds.of(BIG_PARENT.name) } });
        for (let i = 0; i < 2; i++) {
          await expect(driver.find(BIG_CHILD.name, { where: uncomposed() as any })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          await expect(driver.count(BIG_CHILD.name, { where: uncomposed() as any })).rejects.toMatchObject(READABLE_IDS_REFUSAL);
        }
        // Once for this instance — the shared cases above already refused once.
        expect(error.mock.calls.length).toBeLessThanOrEqual(1);
        error.mockRestore();
      });
    });
  });
}

declareFace('local');
declareFace('remote');
