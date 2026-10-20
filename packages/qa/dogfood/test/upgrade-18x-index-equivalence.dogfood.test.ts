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
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { ceremoniedFixture } from './upgrade-harness/ceremony.js';
import { bootFixture } from './upgrade-harness/populate-fixture.js';

const fixtureSql = readFileSync(new URL('./upgrade-harness/fixture-18.0/database.sql', import.meta.url), 'utf8');

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

    it('the 12 declared organization composites survive the HEAD boot byte for byte', () => {
      // `sys_setting`'s identity index is the thirteenth: the metadata
      // protocol's own runtime migration rebuilds it on every boot, now over
      // the plain organization key.
      const declared = COALESCE_INDEXES_18_0.filter((i) => !i.name.startsWith('uniq_sys_setting_'));
      expect(declared).toHaveLength(12);
      const after = new Map(organizationUniqueIndexes(restored).map((i) => [i.name, i.sql]));
      for (const index of declared) expect(after.get(index.name), index.name).toBe(index.sql);
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
