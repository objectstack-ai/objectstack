// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Seam 3 — the per-call tenant-scope refusal (#16589).
 *
 * The defect: the engine scopes an object unless it opts OUT
 * (`buildDriverOptions`), while the boot guard refuses only an explicit opt-IN
 * (`declaresTenantScope`). An object that OMITS the `tenancy` block therefore
 * fell between them, and this driver discarded the scope and answered with every
 * organization's rows.
 *
 * ## Why this fixture is built the way it is
 *
 * The acceptance bar for this card is that the SAME read is distinguishable
 * **three** ways, because "after, it throws" alone is a reading that cannot
 * fail. The closed round of this card hit exactly that trap: with only two
 * organizations seeded, a `[ORG_A, ORG_B]` union covered the whole table, so
 * "the scope widened" and "no scope ran at all" produced the identical answer.
 *
 * So three organizations are seeded with row counts 2 / 3 / 7 — deliberately
 * chosen so that every reading a driver could produce is a DIFFERENT number:
 *
 * | reading                                    | rows | what it would mean          |
 * |:-------------------------------------------|-----:|:----------------------------|
 * | nothing                                    |    0 | over-scoped / wrong tenant  |
 * | the correct subset for ORG_A               |    2 | row-level isolation — the   |
 * |                                            |      | direction the ruling REFUSED|
 * | the union ORG_A + ORG_B                    |    5 | a widened `tenantIds` scope |
 * | everything                                 |   12 | the #16589 defect           |
 *
 * (2, 3, 7, 5, 10, 9 and 12 are pairwise distinct, so no two of those readings
 * can be confused for each other.)
 *
 * The refusal is then pinned as **none of them**: the driver produces no answer
 * at all. That makes the control failable in BOTH wrong directions — a revert to
 * silent non-isolation answers 12, and an implementation of row-level isolation
 * answers 2, and each one reds this file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import {
  MemoryMultiTenantUnsupportedError,
  MULTI_TENANT_UNSUPPORTED_CODE,
} from './memory-tenancy-guard.js';

const ORIGINAL_MULTI_ORG = process.env.OS_MULTI_ORG_ENABLED;
const ORIGINAL_POSTURE = process.env.OS_TENANCY_POSTURE;

/** Omits `tenancy` entirely — the case the engine scopes and seam 2 cannot see. */
const SCOPED_OBJECT = 'ats_employer';
/** Declares `tenancy.enabled: false` — ADR-0066 opt-out, never scoped. */
const GLOBAL_OBJECT = 'ats_job';

const ORG_A = 'org_ats_alpha';
const ORG_B = 'org_ats_beta';
const ORG_C = 'org_ats_gamma';

/** Distinct counts, so every possible reading is a distinct number — see header. */
const SEED: ReadonlyArray<readonly [string, number]> = [
  [ORG_A, 2],
  [ORG_B, 3],
  [ORG_C, 7],
];
const TOTAL = 12;
const ORG_A_SUBSET = 2;
const ORG_A_B_UNION = 5;

async function seedDriver() {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();

  // Both objects sync clean: neither declares `tenancy.enabled: true`, so seam 2
  // has nothing to say about either of them. That is the premise of this card.
  await driver.syncSchema(SCOPED_OBJECT, {
    name: SCOPED_OBJECT,
    fields: { name: { type: 'text' }, organization_id: { type: 'text' } },
  });
  await driver.syncSchema(GLOBAL_OBJECT, {
    name: GLOBAL_OBJECT,
    fields: { title: { type: 'text' } },
    tenancy: { enabled: false },
  });

  for (const [org, count] of SEED) {
    for (let i = 0; i < count; i++) {
      // Written WITHOUT a scope, exactly as a seeder does — the rows carry the
      // organization they belong to, which is what makes a cross-org read
      // observable at all.
      await driver.create(SCOPED_OBJECT, { name: `${org}-employer-${i}`, organization_id: org });
    }
  }
  for (let i = 0; i < 4; i++) {
    await driver.create(GLOBAL_OBJECT, { title: `job-${i}` });
  }
  return driver;
}

describe('per-call tenant-scope refusal (#16589)', () => {
  beforeEach(() => {
    delete process.env.OS_MULTI_ORG_ENABLED;
    delete process.env.OS_TENANCY_POSTURE;
  });

  afterEach(() => {
    if (ORIGINAL_MULTI_ORG === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = ORIGINAL_MULTI_ORG;
    if (ORIGINAL_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = ORIGINAL_POSTURE;
  });

  describe('the fixture itself is discriminating', () => {
    it('seeds three organizations whose every reading is a different number', async () => {
      const driver = await seedDriver();
      // The premise of the whole card: this driver holds many organizations'
      // rows in one table under a `single` posture. If this ever stops being
      // true the readings below stop meaning anything, so it is asserted first.
      const all = await driver.find(SCOPED_OBJECT, {});
      expect(all).toHaveLength(TOTAL);

      const perOrg = new Map<string, number>();
      for (const row of all) {
        const org = String(row.organization_id);
        perOrg.set(org, (perOrg.get(org) ?? 0) + 1);
      }
      expect(perOrg.get(ORG_A)).toBe(ORG_A_SUBSET);
      expect(perOrg.get(ORG_B)).toBe(3);
      expect(perOrg.get(ORG_C)).toBe(7);

      // No two readings collide, which is what the closed round got wrong.
      const readings = [0, ORG_A_SUBSET, ORG_A_B_UNION, TOTAL];
      expect(new Set(readings).size).toBe(readings.length);
    });
  });

  describe('BEFORE — the defect is still reproducible on the unscoped path', () => {
    it('an UNSCOPED read returns every organization, which is what a scoped read used to answer', async () => {
      const driver = await seedDriver();
      // This is the #16589 answer, preserved deliberately: the driver has no
      // isolation, so with no scope handed to it, it returns the whole table
      // including the other two organizations' rows. Before this card, a SCOPED
      // read returned exactly this — identical rows, identical count — because
      // the scope was silently discarded. That is the defect, and it is what the
      // refusal below now stands in front of.
      const rows = await driver.find(SCOPED_OBJECT, {});
      expect(rows).toHaveLength(TOTAL);
      const orgs = new Set(rows.map((r) => String(r.organization_id)));
      expect(orgs).toEqual(new Set([ORG_A, ORG_B, ORG_C]));
    });
  });

  describe('AFTER — the same read, scoped, refuses instead of answering', () => {
    it('refuses a `tenantId`-scoped find, and answers with NO row count at all', async () => {
      const driver = await seedDriver();
      let thrown: unknown = null;
      let answered: unknown[] | null = null;
      try {
        answered = await driver.find(SCOPED_OBJECT, {}, { tenantId: ORG_A });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(MemoryMultiTenantUnsupportedError);
      expect((thrown as { code?: string }).code).toBe(MULTI_TENANT_UNSUPPORTED_CODE);

      // The discrimination, stated as the readings this call is NOT. Taken as a
      // nullable COUNT rather than with `toHaveLength`, which refuses a null
      // target even under `.not` and would pass this block for the wrong reason.
      const rowsAnswered = Array.isArray(answered) ? answered.length : null;

      // ⛔ 12 would be the defect (scope discarded, every organization returned).
      // ⛔ 2 would be row-level isolation — the direction the maintainer REFUSED
      //    on this card; implementing it reds this line.
      // ⛔ 0 would be an over-scope that silently hides rows.
      // The only acceptable outcome is that there is no answer at all.
      expect(rowsAnswered).toBeNull();
      expect(rowsAnswered).not.toBe(TOTAL);
      expect(rowsAnswered).not.toBe(ORG_A_SUBSET);
      expect(rowsAnswered).not.toBe(0);
    });

    it('names the operation, the object and the scope it was handed', async () => {
      const driver = await seedDriver();
      try {
        await driver.find(SCOPED_OBJECT, {}, { tenantId: ORG_A });
        expect.unreachable('expected the driver to refuse');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain('find()');
        expect(message).toContain(SCOPED_OBJECT);
        expect(message).toContain(ORG_A);
        // The remedy must name the isolating driver and the ADR-0066 opt-out,
        // and must reach the tracking card — a refusal that does not say what to
        // do next is the "loud" half without the "locatable" half.
        expect(message).toContain('@objectstack/driver-sql');
        expect(message).toContain('tenancy: { enabled: false }');
        expect(message).toContain('16589');
      }
    });

    it('refuses a `tenantIds` union scope too (ADR-0105 D2 group posture)', async () => {
      const driver = await seedDriver();
      let answered: unknown[] | null = null;
      let thrown: unknown = null;
      try {
        answered = await driver.find(SCOPED_OBJECT, {}, { tenantId: ORG_A, tenantIds: [ORG_A, ORG_B] });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(MemoryMultiTenantUnsupportedError);
      // ⛔ 5 would be the widened union — the reading the closed round could not
      //    distinguish from "no scope ran" when only two orgs were seeded.
      const rowsAnswered = Array.isArray(answered) ? answered.length : null;
      expect(rowsAnswered).toBeNull();
      expect(rowsAnswered).not.toBe(ORG_A_B_UNION);
      expect(rowsAnswered).not.toBe(TOTAL);
      expect((thrown as Error).message).toContain('tenantIds');
      expect((thrown as Error).message).toContain(ORG_B);
    });

    it('refuses on every door that accepts a DriverOptions, not just find', async () => {
      const driver = await seedDriver();
      const scope = { tenantId: ORG_A };
      const doors: Array<[string, () => Promise<unknown>]> = [
        ['find', () => driver.find(SCOPED_OBJECT, {}, scope)],
        ['findOne', () => driver.findOne(SCOPED_OBJECT, {}, scope)],
        ['count', () => driver.count(SCOPED_OBJECT, {}, scope)],
        ['aggregate', () => driver.aggregate(SCOPED_OBJECT, [], scope)],
        ['create', () => driver.create(SCOPED_OBJECT, { name: 'x' }, scope)],
        ['update', () => driver.update(SCOPED_OBJECT, 'anything', { name: 'x' }, scope)],
        ['upsert', () => driver.upsert(SCOPED_OBJECT, { name: 'x' }, undefined, scope)],
        ['delete', () => driver.delete(SCOPED_OBJECT, 'anything', scope)],
        ['bulkCreate', () => driver.bulkCreate(SCOPED_OBJECT, [{ name: 'x' }], scope)],
        ['updateMany', () => driver.updateMany(SCOPED_OBJECT, {}, { name: 'x' }, scope)],
        ['deleteMany', () => driver.deleteMany(SCOPED_OBJECT, {}, scope)],
        ['bulkUpdate', () => driver.bulkUpdate(SCOPED_OBJECT, [{ id: 'anything', data: {} }], scope)],
      ];

      for (const [name, call] of doors) {
        let err: unknown = null;
        try {
          await call();
        } catch (e) {
          err = e;
        }
        expect(err, `${name}() must refuse a scoped call`).toBeInstanceOf(
          MemoryMultiTenantUnsupportedError,
        );
        expect((err as Error).message, `${name}() must name itself`).toContain(`${name}()`);
      }
    });

    it('a refused write leaves the store byte-for-byte as it found it', async () => {
      const driver = await seedDriver();
      const before = await driver.find(SCOPED_OBJECT, {});

      // The F2 defect measured on the closed round: a scoped `upsert` by a
      // foreign id must NOT fall through to the `create` arm and land a second
      // row under one primary id. Seam 3 sits at the top of the door, so the
      // create arm is unreachable — this pins that.
      await expect(
        driver.upsert(SCOPED_OBJECT, { id: 'not-a-real-id', name: 'ghost' }, undefined, {
          tenantId: ORG_A,
        }),
      ).rejects.toBeInstanceOf(MemoryMultiTenantUnsupportedError);

      const after = await driver.find(SCOPED_OBJECT, {});
      expect(after).toHaveLength(TOTAL);
      expect(after).toEqual(before);
      expect(after.filter((r) => r.id === 'not-a-real-id')).toHaveLength(0);
    });
  });

  describe('BOTH — the paths that must keep working, unchanged', () => {
    it('an unscoped read on the same object is served exactly as before', async () => {
      const driver = await seedDriver();
      const rows = await driver.find(SCOPED_OBJECT, {});
      expect(rows).toHaveLength(TOTAL);
      const one = await driver.findOne(SCOPED_OBJECT, { where: { organization_id: ORG_B } });
      expect(one).not.toBeNull();
      expect(await driver.count(SCOPED_OBJECT, {})).toBe(TOTAL);
    });

    it('an object declaring `tenancy.enabled: false` is served, scope or no scope', async () => {
      const driver = await seedDriver();
      // ADR-0066: the engine never sends a `tenantId` for an opted-out object,
      // so the driver never sees one and nothing is refused. Asserted through
      // the driver's own door rather than the engine's, because it is the
      // driver's behaviour on the resulting options that this card changes.
      expect(await driver.find(GLOBAL_OBJECT, {})).toHaveLength(4);
      expect(await driver.count(GLOBAL_OBJECT, {})).toBe(4);
      await expect(driver.create(GLOBAL_OBJECT, { title: 'job-4' })).resolves.toBeTruthy();
      expect(await driver.find(GLOBAL_OBJECT, {})).toHaveLength(5);
    });

    it('options that carry no tenant scope pass straight through', async () => {
      const driver = await seedDriver();
      // Everything a caller can legally put in DriverOptions that is NOT a
      // tenant scope must remain invisible to seam 3 — an over-eager guard here
      // would break the ordinary dev path, which is the risk this card carries.
      expect(await driver.find(SCOPED_OBJECT, {}, {})).toHaveLength(TOTAL);
      expect(await driver.find(SCOPED_OBJECT, {}, { timezone: 'Asia/Shanghai' })).toHaveLength(TOTAL);
      expect(await driver.find(SCOPED_OBJECT, {}, { skipCache: true })).toHaveLength(TOTAL);
      expect(await driver.find(SCOPED_OBJECT, {}, { bypassTenantAudit: true })).toHaveLength(TOTAL);
      expect(await driver.find(SCOPED_OBJECT, {}, { tenantId: undefined })).toHaveLength(TOTAL);
      // `DriverOptionsSchema`: an absent or EMPTY `tenantIds` means "fall back to
      // `tenantId` equality", so `[]` is not a scope of its own.
      expect(await driver.find(SCOPED_OBJECT, {}, { tenantIds: [] })).toHaveLength(TOTAL);
    });

    it('the DDL doors still sync and drop with no options, as the engine calls them', async () => {
      const driver = await seedDriver();
      // Every engine call site spells `syncSchema(tableName, obj)` and
      // `dropTable(tableName)` — no options at all. Seam 3 covers these doors
      // for uniformity, and this pins that it stays a no-op on the real shape.
      await expect(driver.syncSchema('ats_interview', { name: 'ats_interview' })).resolves.not.toThrow();
      await expect(driver.dropTable('ats_interview')).resolves.not.toThrow();
    });
  });
});
