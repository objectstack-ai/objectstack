// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  DATA_MIGRATION_FLAG_OBJECT,
  isDataMigrationFlagVerified,
  type DataMigrationFlag,
} from '@objectstack/spec/system';

/**
 * Deployment-level data-migration flag persistence (#3617).
 *
 * Reads and writes the `sys_migration` rows defined by {@link SysMigration},
 * against the duck-typed engine surface the other platform helpers use. The
 * asymmetry between the two directions is deliberate:
 *
 *  - **Reads fail toward "not verified".** A missing table, an unreadable row,
 *    a malformed row — every failure mode answers `null` / `false`, because a
 *    gate that cannot read its evidence must stay closed, never open.
 *  - **Writes fail loudly.** They run inside a migration command whose whole
 *    output is this record; a swallowed write error would report a gate as
 *    passed that no consumer will ever see.
 */

const SYSTEM_CTX = { isSystem: true } as const;

/** Engine surface the flag helpers need — duck-typed like the storage seams. */
export interface MigrationFlagEngine {
  getObject(name: string): unknown | undefined;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

/**
 * The flag row for `migrationId`, or `null` — where `null` covers every way
 * of not having trustworthy evidence: no `sys_migration` object registered,
 * no row, or a read failure.
 */
export async function readDataMigrationFlag(
  engine: MigrationFlagEngine,
  migrationId: string,
): Promise<DataMigrationFlag | null> {
  if (!engine.getObject(DATA_MIGRATION_FLAG_OBJECT)) return null;
  try {
    const rows = await engine.find(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: migrationId },
      limit: 1,
      context: { ...SYSTEM_CTX },
    });
    const row = rows?.[0];
    if (!row || row.id !== migrationId) return null;
    return {
      id: migrationId,
      last_run_at: String(row.last_run_at ?? ''),
      verified_at: row.verified_at == null ? null : String(row.verified_at),
      applied_at: row.applied_at == null ? null : String(row.applied_at),
      // A non-numeric count must read as "not zero", not as 0 — coerce
      // failures land on NaN, which fails the === 0 gate.
      blocking: typeof row.blocking === 'number' ? row.blocking : Number(row.blocking ?? Number.NaN),
      advisory: typeof row.advisory === 'number' ? row.advisory : undefined,
      details: typeof row.details === 'string' ? row.details : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Has `migrationId` been run AND self-check-verified on this deployment?
 * The read side of the gate — `verified_at` set and `blocking === 0`, via
 * the spec's single `isDataMigrationFlagVerified` predicate.
 */
export async function isDataMigrationVerified(
  engine: MigrationFlagEngine,
  migrationId: string,
): Promise<boolean> {
  return isDataMigrationFlagVerified(await readDataMigrationFlag(engine, migrationId));
}

/** Outcome of one gated (apply-mode) migration run. */
export interface DataMigrationRunOutcome {
  migrationId: string;
  /** Did the self-check pass (zero blocking findings, nothing truncated)? */
  passed: boolean;
  /** Blocking findings from the self-check. */
  blocking: number;
  /** Advisory findings (never gate). */
  advisory?: number;
  /** Whether this run applied writes (as opposed to verifying existing state). */
  applied?: boolean;
  /** JSON-serialisable counts for the `details` column. */
  details?: unknown;
}

/**
 * Upsert the flag row for a completed apply-mode run. `verified_at` is set on
 * a passing run and CLEARED on a failing one — a deployment whose data has
 * regressed since it last verified closes its own gate. Dry runs must not
 * call this: recording is what distinguishes a gated migration from a script
 * whose output can be ignored.
 */
export async function recordDataMigrationRun(
  engine: MigrationFlagEngine,
  outcome: DataMigrationRunOutcome,
): Promise<DataMigrationFlag> {
  const now = new Date().toISOString();
  const existing = await readDataMigrationFlag(engine, outcome.migrationId);
  const flag: DataMigrationFlag = {
    id: outcome.migrationId,
    last_run_at: now,
    verified_at: outcome.passed ? now : null,
    applied_at: outcome.applied === true ? now : (existing?.applied_at ?? null),
    blocking: outcome.blocking,
    advisory: outcome.advisory,
    details: outcome.details === undefined ? undefined : JSON.stringify(outcome.details),
  };

  const row: Record<string, unknown> = {
    ...flag,
    advisory: flag.advisory ?? null,
    details: flag.details ?? null,
    updated_at: now,
  };
  if (existing) {
    await engine.update(DATA_MIGRATION_FLAG_OBJECT, row, { context: { ...SYSTEM_CTX } });
  } else {
    await engine.insert(
      DATA_MIGRATION_FLAG_OBJECT,
      { ...row, created_at: now },
      { context: { ...SYSTEM_CTX } },
    );
  }
  return flag;
}
