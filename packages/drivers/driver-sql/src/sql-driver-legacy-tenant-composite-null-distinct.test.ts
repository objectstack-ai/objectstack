// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver, classifyIndexKeyPart, parseIndexDdl } from '../src/index.js';
import { asPre18TenantColumn } from './pre-18-tenant-column.testkit.js';

/**
 * #23603 row 7 — the OLD hand-written table composite
 * `indexes: [{ fields: ['organization_id', X], unique }]` constrains NOTHING on
 * untenanted rows, because SQL UNIQUE is NULL-distinct. Field-level
 * `unique: true` once differed — its organization key part was NULL-safe
 * (ADR-0120 D3: `COALESCE(organization_id, '__global__')`). Since ADR-0131 D1
 * it is the SAME plain composite: the untenanted hole is closed at the column
 * instead (a fresh tenant column is NOT NULL, so no untenanted row can be
 * written), and on a database built before 18.x — whose column is still
 * nullable — both spellings admit untenanted duplicates alike.
 *
 * Replaces the driver half of objectstack-ai/hotcrm
 * `test/case-number-tenant-scope.test.ts` (the R residue in #15953's
 * classification table, row 7: its "the OLD table-composite spelling
 * constrained nothing untenanted" reverse verification), so hotcrm can retire
 * it (objectstack-ai/hotcrm#1583). The derivable half — every field declared
 * unique collides within one organization and never across — is #15953's
 * unique-scope family in `@objectstack/verify`; hotcrm's K residue (that
 * `crm_case.case_number` is unique at all) stays in hotcrm.
 *
 * Why the hole matters: `organization_id` is kernel-injected and NULL on every
 * row of a single-organization or untenanted install, and an autonumber
 * sequence is keyed per tenant — so under the old spelling duplicate numbers
 * were prevented only by the accident of a single sequence, never by the
 * database. The old index still refuses a duplicate WITHIN one organization,
 * which is exactly what hid the hole; both halves are pinned, against the
 * field-level spelling on the same driver — which now measures the same.
 *
 * A declared index's `unique: true` is the positional spelling of `'global'`
 * (verbatim columns; ADR-0120 D2 converts stored rows to `'global'` and the
 * spec refuses bare `true` since protocol 18). Both spellings are measured,
 * because stored metadata older than the conversion reaches the driver bare.
 */
describe('row 7 — the old table composite and field-level unique are one plain composite; the untenanted hole closes at the column (hotcrm case-number-tenant-scope)', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  });
  afterEach(async () => {
    await driver.disconnect();
  });

  /** Unique index name → key parts; a legacy NULL-safe part would read `COALESCE(col)`. */
  async function uniqueKeyParts(table: string): Promise<Record<string, string[]>> {
    const k = (driver as any).knex;
    const master: any = await k.raw(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`, [table]);
    const out: Record<string, string[]> = {};
    for (const r of master as Array<{ name: string; sql: string | null }>) {
      if (!r.sql || !/^CREATE UNIQUE/i.test(r.sql)) continue;
      const parsed = parseIndexDdl(r.sql);
      out[r.name] = (parsed?.keyParts ?? []).map((p) => {
        const part = classifyIndexKeyPart(p);
        if (part.kind === 'column') return part.column;
        return part.column === null ? p : `COALESCE(${part.column})`;
      });
    }
    return out;
  }

  const refusal = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e);

  describe('field-level unique: true', () => {
    beforeEach(async () => {
      await driver.initObjects([
        { name: 'kase', fields: { organization_id: { type: 'string' }, case_number: { type: 'string', unique: true } } },
      ] as any);
    });

    it('materializes the per-organization unique with a PLAIN organization key part — the old composite, byte for byte (ADR-0131 D1)', async () => {
      expect(await uniqueKeyParts('kase')).toEqual({
        uniq_kase_organization_id_case_number: ['organization_id', 'case_number'],
      });
    });

    it('accepts the same number in two organizations and refuses it twice in one', async () => {
      await driver.create('kase', { organization_id: 'org_a', case_number: 'CASE-1' });
      await driver.create('kase', { organization_id: 'org_b', case_number: 'CASE-1' });
      const err = await refusal(driver.create('kase', { organization_id: 'org_a', case_number: 'CASE-1' }));
      expect(isUniqueViolationError(err)).toBe(true);
    });

    it('closes the UNTENANTED hole at the column: a fresh install refuses the row, a pre-18 one is NULL-distinct', async () => {
      // A fresh tenant column is NOT NULL (ADR-0131 D1): the untenanted row the
      // hole needed cannot be written at all — the refusal is the column's,
      // not the unique index's.
      const err = await refusal(driver.create('kase', { case_number: 'CASE-2' }));
      expect(isUniqueViolationError(err)).toBe(false);
      expect(String((err as Error)?.message)).toMatch(/NOT NULL constraint failed|null value in column/);

      // Rows with no organization exist only on a database built before 18.x;
      // there the plain key part is NULL-distinct, like the old composite.
      await asPre18TenantColumn(driver, 'kase');
      const first = await driver.create('kase', { case_number: 'CASE-2' });
      const second = await driver.create('kase', { case_number: 'CASE-2' });
      expect(second.id).not.toBe(first.id);
    });
  });

  describe.each([
    ['bare unique: true', true],
    ["unique: 'global'", 'global'],
  ] as const)('the old table composite, %s (the reverse verification)', (_label, unique) => {
    beforeEach(async () => {
      await driver.initObjects([
        {
          name: 'kase',
          fields: { organization_id: { type: 'string' }, case_number: { type: 'string' } },
          indexes: [{ fields: ['organization_id', 'case_number'], unique }],
        },
      ] as any);
    });

    it('materializes a plain composite with no NULL-safe key part', async () => {
      expect(await uniqueKeyParts('kase')).toEqual({
        uniq_kase_organization_id_case_number: ['organization_id', 'case_number'],
      });
    });

    it('still refuses a duplicate within one organization — which is what hid the hole', async () => {
      await driver.create('kase', { organization_id: 'org_a', case_number: 'CASE-10' });
      const err = await refusal(driver.create('kase', { organization_id: 'org_a', case_number: 'CASE-10' }));
      expect(isUniqueViolationError(err)).toBe(true);
    });

    it('ACCEPTS a duplicate untenanted number — SQL UNIQUE is NULL-distinct', async () => {
      // Rows with no organization exist only on a database built before 18.x
      // (ADR-0131 D1 makes a fresh tenant column NOT NULL).
      await asPre18TenantColumn(driver, 'kase');
      const first = await driver.create('kase', { case_number: 'CASE-11' });
      const second = await driver.create('kase', { case_number: 'CASE-11' });
      expect(second.id).not.toBe(first.id);
      expect([first.organization_id ?? null, second.organization_id ?? null]).toEqual([null, null]);
    });
  });
});
