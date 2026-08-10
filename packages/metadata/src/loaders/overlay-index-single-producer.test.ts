// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6771 — `idx_sys_metadata_overlay_active` has ONE key, and this package is
 * not a producer of it.
 *
 * The name used to have two producers with DIFFERENT keys, both issuing
 * `CREATE … INDEX IF NOT EXISTS`, so whichever ran first claimed the name and
 * the other silently no-opped:
 *
 *  - `metadata-protocol`'s `ensureMetadataOverlayIndexes` — the current
 *    ADR-0048 key `(type, name, organization_id, COALESCE(package_id, ''))`
 *    `WHERE state = 'active'`;
 *  - this package's `addSysMetadataOverlayIndex` — the PRE-ADR-0048 key
 *    `(type, name, organization_id, environment_id, scope)`, where
 *    `environment_id` is retired (always NULL on new rows, and SQL UNIQUE
 *    treats NULLs as DISTINCT, so the index constrained nothing) and `scope`
 *    is not in the discriminator at all.
 *
 * The second one is gone. These tests pin the invariant against a REAL SQLite
 * database — the stored DDL, not the absence of an exception — because the
 * defect was never a throw: the losing producer returned `status: 'created'`
 * exactly as the winning one did.
 *
 * ⚠️ Reverse verification — directions were predicted BEFORE running, and they
 * are NOT uniform. Restoring the deleted producer from `origin/main` and
 * re-running gave 3 failed / 84 passed:
 *  - **GREEN by design (predicted):** the two `syncSchema` cases. On both, the
 *    DECLARED index has already claimed the name with the CURRENT key before
 *    the old producer ever ran, so the producer was a no-op that nonetheless
 *    returned `status: 'created'`. These pin the COVERING producer — the reason
 *    deleting was safe rather than merely tidy — not the deleted one. A test
 *    asserting they go red would be fiction.
 *  - **RED (predicted):** the engine-path case, `@objectstack/metadata/
 *    migrations` exports no producer, and — in `database-loader.test.ts` —
 *    `issues NO overlay-index DDL`.
 *  - **One prediction was WRONG and is recorded rather than reshaped:** the
 *    pre-existing-table case was expected to go red on the theory that it
 *    reaches the benign "already exists" branch with the declared indexes
 *    unbuilt. A real `syncSchema` does not throw there, so it stays green. That
 *    branch is reachable only with a mock driver, and it is covered as such in
 *    `database-loader.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { DatabaseLoader } from './database-loader';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

const INDEX = 'idx_sys_metadata_overlay_active';
const TABLE = 'sys_metadata';

/** Read the DDL SQLite actually stored for an index, or `null` if absent. */
async function storedDdl(driver: SqliteWasmDriver, name: string): Promise<string | null> {
  const rows: any = await (driver as any).execute(
    `SELECT sql FROM sqlite_master WHERE type='index' AND name='${name}'`,
  );
  const list = Array.isArray(rows) ? rows : (rows?.rows ?? []);
  if (!list.length) return null;
  return String(list[0].sql ?? '');
}

async function freshDriver(): Promise<SqliteWasmDriver> {
  const driver = new SqliteWasmDriver({ filename: ':memory:' });
  await driver.connect();
  return driver;
}

describe('#6771 — sys_metadata overlay index: one key, one owner', () => {
  it('a normal DatabaseLoader boot leaves the CURRENT ADR-0048 key in place', async () => {
    const driver = await freshDriver();
    const loader = new DatabaseLoader({ driver, tableName: TABLE });

    await loader.list('object');

    const ddl = await storedDdl(driver, INDEX);
    expect(ddl).not.toBeNull();
    // The current discriminator, delivered by the DECLARED index in
    // metadata-core's `sys-metadata.object.ts` via `syncDeclaredIndexes`.
    expect(ddl).toMatch(/package_id/);
    // And NOT the retired one.
    expect(ddl).not.toMatch(/environment_id/);
    expect(ddl).not.toMatch(/\bscope\b/);
  });

  /**
   * ⚠️ Direction, measured rather than presumed: this case is GREEN with the
   * producer restored, and that is the point of it. It was written expecting
   * red — the guess being that a pre-existing table sends the driver path down
   * the benign "already exists" branch with the declared indexes unbuilt. A
   * REAL `SqliteWasmDriver.syncSchema` does not throw there: it reconciles the
   * existing table and materializes the declared indexes anyway. So on a real
   * SQL driver the driver path is SELF-COVERING, which is precisely why
   * deleting the producer is safe rather than merely tidy. What this pins is
   * the covering producer, not the deleted one; the red-on-restore cases are
   * the engine path below and the mock-driver case in `database-loader.test.ts`
   * (`issues NO overlay-index DDL`), which does reach the benign branch.
   */
  it('syncSchema self-covers a pre-existing table with the CURRENT key', async () => {
    const driver = await freshDriver();
    // A table that exists but carries none of the declared indexes.
    await (driver as any).execute(
      `CREATE TABLE ${TABLE} (id text, type text, name text, organization_id text, ` +
        `environment_id text, scope text, package_id text, state text)`,
    );

    const loader = new DatabaseLoader({ driver, tableName: TABLE });
    await loader.list('object');

    const ddl = await storedDdl(driver, INDEX);
    expect(ddl).not.toBeNull();
    expect(ddl).toMatch(/package_id/);
    expect(ddl).not.toMatch(/environment_id/);
    expect(ddl).not.toMatch(/\bscope\b/);
  });

  /**
   * The engine path is the cleanest reproduction: the loader syncs no schema
   * at all there (ObjectQL's startup owns it), so the removed producer ran
   * against a table whose declared indexes did not exist yet and won the name
   * outright.
   */
  it('never installs the retired key on the engine path either', async () => {
    const driver = await freshDriver();
    await (driver as any).execute(
      `CREATE TABLE ${TABLE} (id text, type text, name text, organization_id text, ` +
        `environment_id text, scope text, package_id text, state text)`,
    );

    // Read-only stand-in: `list()` reaches `engine.find` and nothing else, so
    // this double declares no write verbs at all rather than declaring loose
    // ones (`check:engine-double-contract` — a fake looser than the real
    // `ObjectQL.update`/`.delete` is how #4434 shipped a dead route green).
    // What the test needs from the engine is the `driver` it hands back, which
    // is what `ensureSchema`'s engine path resolves.
    const engine = {
      driver,
      find: async () => [],
    };
    const loader = new DatabaseLoader({ engine: engine as any, tableName: TABLE });
    await loader.list('object');

    const ddl = await storedDdl(driver, INDEX);
    if (ddl !== null) {
      expect(ddl).not.toMatch(/environment_id/);
      expect(ddl).not.toMatch(/\bscope\b/);
    }
  });

  it('`@objectstack/metadata/migrations` exports no overlay-index producer', async () => {
    const migrations: Record<string, unknown> = await import('../migrations/index.js');

    expect(Object.keys(migrations)).not.toContain('addSysMetadataOverlayIndex');
    // Nothing else in the barrel may quietly take the job over either.
    const overlayProducers = Object.keys(migrations).filter((k) => /overlayindex/i.test(k));
    expect(overlayProducers).toEqual([]);
  });
});
