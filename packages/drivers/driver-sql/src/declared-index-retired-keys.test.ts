// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach, vi } from 'vitest';

import { SqlDriver, normalizeDeclaredIndex } from '../src/index.js';

/**
 * `indexes[].type` / `indexes[].partial` were retired at protocol 17 (#5248,
 * #4943, ADR-0049 enforce-or-remove). The retirement rests on ONE factual
 * claim, and this file is that claim's proof rather than its restatement:
 *
 *   **Dropping either key changes no DDL, because no DDL ever read them.**
 *
 * The claim is worth pinning because the two platform objects that authored
 * `partial` (`sys_metadata`, `sys_view_definition`) both did so for a
 * correctness reason — active-row-scoped uniqueness — and a reader who sees
 * the key disappear from those declarations is entitled to ask whether a
 * constraint was just relaxed. It was not: the constraint the DECLARATION
 * produced was always the unrestricted one. What actually delivers the
 * active-row scoping on `sys_metadata` is `metadata-protocol`'s runtime
 * `ensureOverlayIndex` migration, which issues `CREATE UNIQUE INDEX …
 * WHERE state = 'active'` in raw SQL and is untouched by this retirement.
 *
 * ⚠️ Do NOT confuse this with the driver's own `partial`. `parseIndexDdl` /
 * `introspectIndexes` / `isSyncReproducibleIndex` carry a `partial: boolean`
 * parsed back out of the DATABASE's own `CREATE INDEX` statement, consumed by
 * drift detection so a DB-authored partial index is exempt from incremental
 * sync. That is a different fact in a different direction (DB → us, not us →
 * DB) and keeps working exactly as before — the tests in
 * `sql-driver-overlay-index-drift.test.ts` own it.
 */
describe('retired declared-index keys are DDL-inert (#5248 / #4943)', () => {
  let tmp: string | undefined;
  let knexInstance: any;

  const makeDriver = () => {
    tmp = mkdtempSync(join(tmpdir(), 'os-idx-retire-'));
    const d = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(tmp, 'test.db') },
      useNullAsDefault: true,
    });
    knexInstance = (d as any).knex;
    (d as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    return d;
  };

  afterEach(async () => {
    await knexInstance?.destroy();
    knexInstance = undefined;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  /**
   * Create `table` with the given declared indexes and return the CREATE INDEX
   * statements SQLite actually stored, normalized for comparison.
   */
  const createdIndexDdl = async (driver: any, table: string, indexes: any[]): Promise<string[]> => {
    await driver.knex.schema.createTable(table, (t: any) => {
      t.string('type');
      t.string('name');
      t.string('organization_id');
      t.string('package_id');
      t.string('owner');
      t.string('state');
      t.string('tags');
    });
    const physical = new Set(['type', 'name', 'organization_id', 'package_id', 'owner', 'state', 'tags']);
    await driver.syncDeclaredIndexes(table, indexes, physical, null);
    const rows = await driver
      .knex('sqlite_master')
      .where({ type: 'index', tbl_name: table })
      .whereNotNull('sql')
      .orderBy('name');
    return rows.map((r: any) => String(r.sql).replace(/\s+/g, ' ').trim());
  };

  // The two real producers this PR flipped, plus a `type`-carrying index.
  const cases: Array<{ label: string; withKeys: any; without: any }> = [
    {
      label: 'sys_metadata / idx_sys_metadata_overlay_active',
      withKeys: {
        name: 'idx_sys_metadata_overlay_active',
        fields: ['type', 'name', 'organization_id', 'package_id'],
        unique: true,
        partial: "state = 'active'",
      },
      without: {
        name: 'idx_sys_metadata_overlay_active',
        fields: ['type', 'name', 'organization_id', 'package_id'],
        unique: true,
      },
    },
    {
      label: 'sys_view_definition / idx_sys_view_def_active',
      withKeys: {
        name: 'idx_sys_view_def_active',
        fields: ['name', 'organization_id', 'owner'],
        unique: true,
        partial: "state = 'active'",
      },
      without: {
        name: 'idx_sys_view_def_active',
        fields: ['name', 'organization_id', 'owner'],
        unique: true,
      },
    },
    {
      label: 'a non-default index method (gin)',
      withKeys: { name: 'idx_tags', fields: ['tags'], type: 'gin' },
      without: { name: 'idx_tags', fields: ['tags'] },
    },
  ];

  for (const { label, withKeys, without } of cases) {
    it(`${label}: identical CREATE INDEX with and without the retired key(s)`, async () => {
      const a = makeDriver();
      const withDdl = await createdIndexDdl(a, 't_probe', [withKeys]);
      await knexInstance.destroy();
      knexInstance = undefined;
      rmSync(tmp!, { recursive: true, force: true });
      tmp = undefined;

      const b = makeDriver();
      const withoutDdl = await createdIndexDdl(b, 't_probe', [without]);

      // The real database's own stored DDL, byte-for-byte.
      expect(withDdl).toEqual(withoutDdl);
      expect(withDdl).toHaveLength(1);
      // And it is a FULL index — no WHERE clause was ever emitted, which is
      // exactly why the declared predicate was inert.
      expect(withDdl[0]!.toLowerCase()).not.toContain(' where ');
    });
  }

  it('normalizeDeclaredIndex ignores both keys (the single seam every index create goes through)', () => {
    const normalized = normalizeDeclaredIndex(
      'sys_metadata',
      {
        name: 'idx_sys_metadata_overlay_active',
        fields: ['type', 'name', 'organization_id', 'package_id'],
        unique: true,
        // Cast: `DeclaredIndexInput` never declared these — that is the point.
        ...({ type: 'gin', partial: "state = 'active'" } as Record<string, unknown>),
      } as any,
      null,
    );
    expect(normalized).toEqual({
      name: 'idx_sys_metadata_overlay_active',
      columns: ['type', 'name', 'organization_id', 'package_id'],
      unique: true,
    });
    // Neither key survives into the shape the create path consumes.
    expect(normalized).not.toHaveProperty('partial');
    expect(normalized).not.toHaveProperty('type');
  });
});
