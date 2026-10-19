// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { NotNullColumn, NotNullOutcome } from './organization-ownership-apply.js';
import type { SqlDriverLike } from './schema-migrate.js';

type DriftEntry = Parameters<SqlDriverLike['applyMigrationEntries']>[0][number];

export interface NotNullTarget {
  /** The driver of the database the plan placed the table in (`database` absent: the primary). */
  driverFor(database: string | undefined): Pick<SqlDriverLike, 'applyMigrationEntries' | 'driftApplyLimit'> | undefined;
  /** Whether the booted composition declares an object for this table (a rotation shard judged by its base). */
  isDeclared(table: string): boolean;
  /** The declared table a rotation shard belongs to (`sys_activity__r20261019` → `sys_activity`), or `null`. */
  shardBaseOf?(table: string): string | null;
}

/**
 * The ceremony's `notNull` port (18.x step 5d; ruling record 6269955919 on the
 * v18 epic, ② A): each tenant column goes NOT NULL through the driver's own
 * drift apply door — the SQLite table rebuild, or `ALTER COLUMN … SET NOT
 * NULL` — never a hand `ALTER`.
 *
 * The differ proposes no entry for it (the column's nullability is the
 * ceremony's, not a declaration's), so the entry is the ceremony's own
 * `tighten_not_null`, handed to the one driver that holds the table. A table
 * the composition does not declare is not rebuilt (`not-declared`); a
 * transport whose apply door cannot perform the op (the Turso remote face,
 * `driftApplyLimit`) is `unsupported`, never attempted; so is a rotation
 * shard: the apply door rebuilds a table against its own declaration, which a
 * shard does not have, and every shard rotated in later is created from the
 * base's declaration, nullable — the shard family holds NOT NULL nowhere.
 */
export async function applyNotNullThroughDrift(target: NotNullTarget, columns: readonly NotNullColumn[]): Promise<NotNullOutcome[]> {
  const outcomes: NotNullOutcome[] = [];
  for (const { table, column, database } of columns) {
    if (!target.isDeclared(table)) {
      outcomes.push({ table, column, outcome: 'not-declared' });
      continue;
    }
    const base = target.shardBaseOf?.(table) ?? null;
    if (base !== null && base !== table) {
      outcomes.push({
        table,
        column,
        outcome: 'unsupported',
        detail: `${table} is a rotation shard of ${base}: the drift apply door rebuilds only a declared table, and each new shard is created with ${base}'s nullable column`,
      });
      continue;
    }
    const driver = target.driverFor(database);
    if (!driver) {
      outcomes.push({ table, column, outcome: 'failed', detail: `no driver serves the database ${database ?? 'primary'} the table is in` });
      continue;
    }
    const limit = driver.driftApplyLimit?.('tighten_not_null') ?? null;
    if (limit) {
      outcomes.push({ table, column, outcome: 'unsupported', detail: limit });
      continue;
    }
    const entry = {
      kind: 'nullability_mismatch',
      remoteName: table,
      table,
      column,
      expected: 'NOT NULL',
      actual: 'NULL',
      severity: 'error',
      category: 'destructive',
      op: { type: 'tighten_not_null', table, column },
      message: `${table}.${column}: NOT NULL, applied by the organization-ownership ceremony (ADR-0131 D10, 8e).`,
    } as unknown as DriftEntry;
    try {
      const { applied, skipped } = await driver.applyMigrationEntries([entry], { allowDestructive: true });
      outcomes.push(
        applied.length === 1
          ? { table, column, outcome: 'applied' }
          : { table, column, outcome: 'failed', detail: `the drift apply door did not apply it (${skipped.length} skipped)` },
      );
    } catch (error) {
      outcomes.push({ table, column, outcome: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
