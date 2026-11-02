// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [18.x step 7b-1 + 7b-2] The organization key part of a unique index, across
// the upgrade.
//
// An 18.0 database keys every organization-scoped unique index through the
// ADR-0120 D3 form `COALESCE(organization_id, '__global__')`. HEAD's new DDL
// keys the plain column (ADR-0131 D1: the tenant column is NOT NULL), and its
// differ reads the old form as equivalent where the tenant column holds no
// NULL: physically NOT NULL, or a certified database — a birth marker or the
// ownership ceremony's marker. Without that equivalence every one of those
// indexes reads as "same name, different definition", a `recreate_index`: a
// DROP of a live unique constraint, proposed at every boot and by
// `os migrate plan` to every upgraded deployment.
//
// What the ceremony itself does to them is measured, not assumed: on SQLite its
// NOT NULL step rebuilds each table through the driver's drift apply door, and
// the rebuild re-keys the table's indexes with this release's DDL — plain. A
// table the ceremony leaves nullable (`sys_email_template` here) keeps its
// 18.0 index, and only the certification makes it equivalent. PostgreSQL and
// MySQL take NOT NULL by `ALTER COLUMN` and a remote Turso store not at all, so
// there every 18.0 index survives the ceremony; a SQLite store an earlier 18.x
// ceremony certified holds them too. The second block models that store by
// restoring the 13 indexes exactly as 18.0 wrote them.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { ceremoniedFixture } from './upgrade-harness/ceremony.js';
import { readFixtureAsOf } from './upgrade-harness/fixture-as-of.js';
import { bootFixture } from './upgrade-harness/populate-fixture.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

// Its rotation shards re-dated to the day before this run (`fixture-as-of.ts`).
const { sql: fixtureSql } = readFixtureAsOf(new URL('./upgrade-harness/fixture-18.0/', import.meta.url));

/**
 * The organization uniques a `kernel:ready` migration in `metadata-protocol`
 * rebuilds on every boot (runtime-managed, ADR-0120 D4), so no boot leaves
 * their 18.0 spelling in place: `sys_setting`'s identity index, and
 * `sys_notification_preference`'s, NULL-safe on `user_id`.
 */
const RUNTIME_MANAGED_TABLES = new Set(['sys_setting', 'sys_notification_preference']);
const RUNTIME_MANAGED_INDEX = /^uniq_(sys_setting_|sys_notification_preference_)/;

/** One unique index of the file, as SQLite recorded its DDL. */
interface UniqueIndex {
  name: string;
  table: string;
  sql: string;
}

/** A tenant key part in the ADR-0120 D3 form, quoted or not. */
const COALESCE_ORG = /COALESCE\(\s*[`"]?organization_id[`"]?\s*,/i;

/** The 18.0 fixture's own `CREATE UNIQUE INDEX` statements over the COALESCE organization key part. */
const COALESCE_INDEXES_18_0: Array<{ name: string; sql: string }> = fixtureSql
  .split('\n')
  .filter((line) => /^CREATE UNIQUE INDEX/i.test(line) && COALESCE_ORG.test(line))
  .map((line) => ({
    name: /^CREATE UNIQUE INDEX\s+[`"]?([A-Za-z0-9_]+)/i.exec(line)![1]!,
    sql: line.replace(/;\s*$/, ''),
  }));

/** Every UNIQUE index of `file` whose DDL keys the organization column. */
function organizationUniqueIndexes(file: string): UniqueIndex[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      db
        .prepare("SELECT name, tbl_name AS \"table\", sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
        .all() as unknown as UniqueIndex[]
    ).filter((i) => /^CREATE UNIQUE INDEX/i.test(i.sql) && /organization_id/.test(i.sql));
  } finally {
    db.close();
  }
}

/** Whether `table`'s organization column is physically NOT NULL in `file`. */
function organizationNotNull(file: string, table: string): boolean {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT \"notnull\" AS nn FROM pragma_table_info(?) WHERE name = 'organization_id'").get(table) as
      | { nn: number }
      | undefined;
    return row?.nn === 1;
  } finally {
    db.close();
  }
}

type DriftEntry = { table: string; category: string; op: { type: string } };

/** The schema differ's verdict on the booted store, over every object it synced. */
async function managedDrift(stack: VerifyStack): Promise<DriftEntry[]> {
  const ql = (await stack.kernel.getServiceAsync('objectql')) as {
    getDriverForObject(object: string): { detectManagedDrift?: () => Promise<DriftEntry[]> };
  };
  const driver = ql.getDriverForObject('sys_migration');
  expect(typeof driver.detectManagedDrift, 'the store serving the ledger is the SQL driver').toBe('function');
  return driver.detectManagedDrift!();
}

/** No index op the differ would propose to DROP anything: no recreate, nothing destructive. */
function expectNoDestructiveIndexDrift(drift: DriftEntry[]): void {
  const recreate = drift.filter((d) => d.op.type === 'recreate_index');
  expect(recreate, JSON.stringify(recreate, null, 2)).toEqual([]);
  const destructive = drift.filter((d) => d.category === 'destructive');
  expect(destructive, JSON.stringify(destructive, null, 2)).toEqual([]);
}

describe('[18.x step 7b] the organization key part across the 18.0 → HEAD upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-index-equivalence-'));
  let ceremonied = '';

  beforeAll(async () => {
    ceremonied = (await ceremoniedFixture(dir, fixtureSql, 'equivalence')).file;
  }, 900_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the 18.0 fixture carries 13 COALESCE organization unique indexes (a vacuous fixture is no pin)', () => {
    expect(COALESCE_INDEXES_18_0).toHaveLength(13);
  });

  describe('the ceremonied database as the ceremony left it', () => {
    let stack: VerifyStack | undefined;
    let before: UniqueIndex[] = [];

    beforeAll(async () => {
      before = organizationUniqueIndexes(ceremonied);
      stack = await bootFixture(ceremonied);
    }, 300_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it("sys_email_template stays nullable and keeps its 18.0 COALESCE index: the certification is what carries it", () => {
      expect(organizationNotNull(ceremonied, 'sys_email_template')).toBe(false);
      const kept = before.filter((i) => COALESCE_ORG.test(i.sql)).map((i) => i.name);
      expect(kept).toContain('uniq_sys_email_template_organization_id_name_locale');
    });

    it("HEAD's differ reports zero recreate_index and zero destructive drift", async () => {
      expectNoDestructiveIndexDrift(await managedDrift(stack!));
    });
  });

  describe('the ceremonied database holding all 13 indexes exactly as 18.0 wrote them', () => {
    const restored = join(dir, 'restored.db');
    let stack: VerifyStack | undefined;

    beforeAll(async () => {
      copyFileSync(ceremonied, restored);
      const db = new DatabaseSync(restored);
      try {
        for (const index of COALESCE_INDEXES_18_0) {
          db.exec(`DROP INDEX IF EXISTS "${index.name}"`);
          db.exec(index.sql);
        }
      } finally {
        db.close();
      }
      stack = await bootFixture(restored);
    }, 300_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it("HEAD's differ reports zero recreate_index and zero destructive drift", async () => {
      expectNoDestructiveIndexDrift(await managedDrift(stack!));
    });

    it('the 11 declared organization composites survive the HEAD boot byte for byte', () => {
      // The other two are runtime-managed: the metadata protocol's own
      // migrations rebuild them on every boot over the plain organization key —
      // `sys_setting`'s identity index, and `sys_notification_preference`'s
      // one-global-default-per-key index, NULL-safe on its `user_id` (an empty
      // User is the admin-global default, ADR-0118 D1).
      const declared = COALESCE_INDEXES_18_0.filter((i) => !RUNTIME_MANAGED_INDEX.test(i.name));
      expect(declared).toHaveLength(11);
      const after = new Map(organizationUniqueIndexes(restored).map((i) => [i.name, i.sql]));
      for (const index of declared) expect(after.get(index.name), index.name).toBe(index.sql);
    });
  });

  describe('a store 18.0.0 created from empty: birth-marked, nullable tenant columns, COALESCE organization indexes', () => {
    // 18.0.0 (published) births a store with its ownership marker at shape
    // generation 1 — the generation HEAD still requires — while it still built
    // every tenant column nullable and keyed organization uniques through the
    // COALESCE form. Measured on the published 18.0.0 for this part: 34 tenant
    // columns, none NOT NULL; 10 of 14 organization uniques in the COALESCE
    // form; then HEAD booted it with no refusal and `os migrate plan` read
    // 0 changes. This leg models that store from a HEAD birth (same marker),
    // the tenant columns relaxed through the drift door and the indexes
    // re-spelled exactly as 18.0.0 wrote them, so the CERTIFICATION is the
    // only witness: no tenant column here is NOT NULL.
    const born = join(dir, 'born-18.0.0.db');
    let stack: VerifyStack | undefined;
    let respelled: Array<{ name: string; sql: string }> = [];

    beforeAll(async () => {
      const first = await bootFixture(born);
      try {
        const ql = (await first.kernel.getServiceAsync('objectql')) as { getDriverForObject(object: string): unknown };
        // The tables whose organization unique 18.0.0 keyed through COALESCE —
        // the ones whose equivalence is under test. (The runtime-managed
        // indexes are their migrations', rebuilt every boot.)
        const tenantTables = [
          ...new Set(organizationUniqueIndexes(born).map((i) => i.table).filter((t) => !RUNTIME_MANAGED_TABLES.has(t))),
        ];
        await relaxTenantColumns(ql, tenantTables);
      } finally {
        await first.stop();
      }
      const db = new DatabaseSync(born);
      try {
        for (const index of organizationUniqueIndexes(born)) {
          // A runtime-managed index is its migration's, rebuilt every boot.
          if (RUNTIME_MANAGED_TABLES.has(index.table)) continue;
          const sql = index.sql.replace(/\(\s*([`"]?)organization_id\1\s*([,)])/, "(COALESCE($1organization_id$1, '__global__')$2")
            .replace(/,\s*([`"]?)organization_id\1\s*([,)])/, ", COALESCE($1organization_id$1, '__global__')$2");
          if (sql === index.sql) continue;
          db.exec(`DROP INDEX "${index.name}"`);
          db.exec(sql);
          respelled.push({ name: index.name, sql });
        }
      } finally {
        db.close();
      }
      stack = await bootFixture(born);
    }, 600_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it('is the 18.0.0 shape: a verified generation-1 birth marker, no NOT NULL tenant column, COALESCE indexes', () => {
      const db = new DatabaseSync(born, { readOnly: true });
      try {
        const marker = db.prepare('SELECT verified_at, details FROM sys_migration WHERE id = ?').get(
          'adr-0131-organization-ownership',
        ) as { verified_at: unknown; details: string } | undefined;
        expect(marker?.verified_at).toBeTruthy();
        expect(JSON.parse(marker!.details).birth?.shapeGeneration).toBe(1);
      } finally {
        db.close();
      }
      expect(respelled.length, 'the store holds COALESCE organization indexes').toBeGreaterThanOrEqual(10);
      for (const index of respelled) {
        const table = organizationUniqueIndexes(born).find((i) => i.name === index.name)!.table;
        expect(organizationNotNull(born, table), `${table}.organization_id`).toBe(false);
      }
    });

    it("HEAD boots it, and its differ reports zero recreate_index and zero destructive drift", async () => {
      expectNoDestructiveIndexDrift(await managedDrift(stack!));
    });

    it('every COALESCE index survives the HEAD boot byte for byte', () => {
      const after = new Map(organizationUniqueIndexes(born).map((i) => [i.name, i.sql]));
      for (const index of respelled) expect(after.get(index.name), index.name).toBe(index.sql);
    });
  });

  describe('a store HEAD creates from empty', () => {
    const fresh = join(dir, 'fresh.db');
    let stack: VerifyStack | undefined;

    beforeAll(async () => {
      stack = await bootFixture(fresh);
    }, 300_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it('keys every organization unique index on the plain column: no COALESCE organization key part anywhere', () => {
      const indexes = organizationUniqueIndexes(fresh);
      expect(indexes.length, 'the fresh store holds organization unique indexes').toBeGreaterThanOrEqual(13);
      expect(indexes.filter((i) => COALESCE_ORG.test(i.sql)).map((i) => i.name)).toEqual([]);
    });

    it('and its differ reports no index drift', async () => {
      const drift = await managedDrift(stack!);
      expect(drift.filter((d) => d.op.type.endsWith('_index'))).toEqual([]);
    });
  });
});
