// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20432] What the CLI does with the driver's new report-only drift op,
 * `unbuildable_index`: a declared index that can never be built, because a key
 * column is not a field of the object or is a virtual `formula` field.
 *
 * ## Why this lives in `packages/cli`
 *
 * The driver owns the entry. The CLI owns the three places it lands:
 *
 *   - `os migrate plan` renders it through `renderPlan` / `driftTarget`, which
 *     read `category`, `op.indexName`, `op.type` and `message` generically.
 *     This file proves that the new op needs no CLI source change to be shown.
 *   - `os migrate apply` hands it to `applyMigrationEntries`, which reports it
 *     `skipped`: there is no reconciler arm, and none can exist.
 *   - The artifact-pinned boot gate applies every non-destructive entry and
 *     refuses the boot only on `category === 'destructive'`. A report-only
 *     entry must WARN and let the boot continue. Refusing would take down
 *     every deployment carrying a misspelt index column at `kernel:ready`,
 *     over a declaration that no DDL can repair. That is the same asymmetry
 *     `artifact-boot-migration.report-only-drift.test.ts` pins for
 *     `manual_column_type_change`.
 *
 * Every entry here comes from the REAL driver (an in-memory SQLite
 * `SqlDriver`) and goes through the REAL gate and renderer. A hand-stamped
 * entry would stay green on the day the driver starts emitting the op as
 * `destructive`, because nothing would connect the two.
 *
 * ⚠️ `@objectstack/driver-sql` resolves through its `exports` to its **dist**
 * (no `resolve.alias` for it in this package, deliberately), so this file
 * reads the BUILT driver. A stale `dist/` makes it a verdict about build
 * state. The value import also puts it in the `integration` tier
 * (`vitest-tiers.ts`, KERNEL).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver, buildIndexName } from '@objectstack/driver-sql';
import { runArtifactBootMigrationGate } from './artifact-boot-migration.js';
import { driftTarget, groupByCategory, renderPlan, type SqlDriverLike } from './schema-migrate.js';

const T = 'os20432_boot';
const INDEX = buildIndexName(T, ['statsu'], true);

/** A table whose only real column is `status`, declaring a UNIQUE over the misspelling `statsu`. */
const OBJECT = {
  name: T,
  tenancy: { enabled: false },
  fields: { status: { type: 'text', maxLength: 64 } },
  indexes: [{ fields: ['statsu'], unique: true as const }],
};

async function syncedDriver(): Promise<SqlDriver> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  // Quiet: the driver's own error line is pinned in driver-sql. This file is about the CLI's handling.
  (driver as any).logger = { debug() {}, info() {}, warn() {}, error() {} };
  await driver.initObjects([OBJECT]);
  return driver;
}

describe('the unbuildable_index drift op through the CLI (#20432)', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await driver?.disconnect().catch(() => {});
    driver = undefined;
  });

  it('the fixture is real: the driver reports exactly one unbuildable_index entry, needs_confirm', async () => {
    driver = await syncedDriver();
    const drift = await driver.detectManagedDrift();
    expect(drift.map((d) => d.op.type)).toEqual(['unbuildable_index']);
    expect(drift[0]).toMatchObject({ category: 'needs_confirm', op: { indexName: INDEX, unique: true } });
  });

  it('the artifact boot gate warns about it and does NOT refuse the boot', async () => {
    driver = await syncedDriver();
    const info: string[] = [];
    const warn: string[] = [];

    // The gate's two members, delegated to the REAL driver. `bootSchemaStack`
    // reaches the driver by duck type, and `SqlDriver` keeps `config`
    // protected, so the class itself is not assignable to `SqlDriverLike`.
    const real = driver;
    const gateDriver: SqlDriverLike = {
      detectManagedDrift: () => real.detectManagedDrift(),
      applyMigrationEntries: (entries, opts) => real.applyMigrationEntries(entries, opts),
    };
    const verdict = await runArtifactBootMigrationGate({
      driver: gateDriver,
      artifactDisplay: 'https://artifacts.example.com/app.json',
      info: (m) => info.push(m),
      warn: (m) => warn.push(m),
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.refusal).toBeUndefined();
    expect(verdict.destructive).toEqual([]);
    // Handed to the driver, which declined it: skipped, never "migrated".
    expect(verdict.applied).toEqual([]);
    expect(verdict.skipped.map((d) => d.op.type)).toEqual(['unbuildable_index']);
    expect(info).toEqual([]);
    // …and the skip is not silent: one warn, carrying the driver's message.
    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain(T);
    expect(warn[0]).toContain(INDEX);
  });

  it('os migrate plan renders it with no CLI change: grouped needs_confirm, targeted by index name, tagged by op', async () => {
    driver = await syncedDriver();
    const drift = await driver.detectManagedDrift();

    expect(groupByCategory(drift).needs_confirm).toEqual(drift);
    expect(driftTarget(drift[0]!)).toBe(`${T} [${INDEX}]`);

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    renderPlan(drift);
    const out = lines.join('\n');
    expect(out).toContain(`${T} [${INDEX}]`);
    expect(out).toContain('[unbuildable_index]');
    expect(out).toContain(drift[0]!.message);
  });
});
