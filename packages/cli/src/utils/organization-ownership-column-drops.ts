// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ColumnDrop, ColumnDropOutcome } from './organization-ownership-apply.js';
import type { SqlDriverLike } from './schema-migrate.js';

type DriftEntry = Awaited<ReturnType<SqlDriverLike['detectManagedDrift']>>[number];

export interface ColumnDropTarget {
  /** The booted stack's schema-drift ceremony (ADR-0120 D4). */
  drift: Pick<SqlDriverLike, 'detectManagedDrift' | 'applyMigrationEntries'>;
  /** Whether the booted composition declares an object for this table (a rotation shard judged by its base). */
  isDeclared(table: string): boolean;
  /** The physical name the driver gives a declared index — `@objectstack/driver-sql`'s `buildIndexName`. */
  indexName(table: string, columns: readonly string[], unique: boolean): string;
}

const opOf = (d: DriftEntry): { type?: string; column?: string; indexName?: string } =>
  ((d as { op?: unknown }).op ?? {}) as { type?: string; column?: string; indexName?: string };
const key = (table: string, column: string): string => `${table}.${column}`;
const messageOf = (d: DriftEntry): string => String((d as { message?: unknown }).message ?? 'skipped by the schema-drift ceremony');

/**
 * The ceremony's `columnDrops` port: each named column goes through the
 * schema-drift ceremony, never a hand `ALTER`.
 *
 * A column's retired indexes ({@link ColumnDrop.retiredIndexes}) are dropped
 * FIRST, in their own `applyMigrationEntries` call: that call runs column ops
 * before index ops, so one call would drop the column under a key that still
 * uses it (MySQL refuses it, or keeps the key minus the column). A column
 * whose retired index the ceremony could not drop is not dropped; its outcome
 * is `failed`, naming the index.
 */
export async function dropColumnsThroughDrift(target: ColumnDropTarget, columns: readonly ColumnDrop[]): Promise<ColumnDropOutcome[]> {
  const drift = await target.drift.detectManagedDrift();
  const wanted = new Set(columns.map((c) => key(c.table, c.column)));
  let columnEntries = drift.filter((d) => {
    const op = opOf(d);
    return op.type === 'drop_column' && wanted.has(key(String(d.table), String(op.column)));
  });
  const outcomes: ColumnDropOutcome[] = [];
  const proposed = new Set(columnEntries.map((d) => key(String(d.table), String(opOf(d).column))));
  for (const c of columns) {
    if (proposed.has(key(c.table, c.column))) continue;
    outcomes.push(
      target.isDeclared(c.table)
        ? { table: c.table, column: c.column, outcome: 'not-proposed', detail: 'the drift differ proposed no drop for it' }
        : { table: c.table, column: c.column, outcome: 'not-declared' },
    );
  }

  // The retired indexes of every column that IS proposed, by physical name.
  const indexOwner = new Map<string, ColumnDrop>();
  for (const c of columns) {
    if (!proposed.has(key(c.table, c.column))) continue;
    for (const index of c.retiredIndexes ?? []) indexOwner.set(key(c.table, target.indexName(c.table, index.columns, index.unique)), c);
  }
  const indexEntries = drift.filter((d) => {
    const op = opOf(d);
    return op.type === 'drop_index' && indexOwner.has(key(String(d.table), String(op.indexName)));
  });
  if (indexEntries.length) {
    const { skipped } = await target.drift.applyMigrationEntries(indexEntries, { allowDestructive: true });
    const blocked = new Set<string>();
    for (const d of skipped) {
      const owner = indexOwner.get(key(String(d.table), String(opOf(d).indexName)))!;
      if (blocked.has(key(owner.table, owner.column))) continue;
      blocked.add(key(owner.table, owner.column));
      outcomes.push({
        table: owner.table,
        column: owner.column,
        outcome: 'failed',
        detail: `the index ${String(opOf(d).indexName)} it keyed could not be dropped first (${messageOf(d)})`,
      });
    }
    columnEntries = columnEntries.filter((d) => !blocked.has(key(String(d.table), String(opOf(d).column))));
  }

  if (columnEntries.length === 0) return outcomes;
  const { applied, skipped } = await target.drift.applyMigrationEntries(columnEntries, { allowDestructive: true });
  for (const d of applied) outcomes.push({ table: String(d.table), column: String(opOf(d).column), outcome: 'dropped' });
  for (const d of skipped) {
    outcomes.push({ table: String(d.table), column: String(opOf(d).column), outcome: 'failed', detail: messageOf(d) });
  }
  return outcomes;
}
