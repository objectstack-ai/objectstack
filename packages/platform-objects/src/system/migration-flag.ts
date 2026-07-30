// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  CREATION_ATTESTED_MIGRATION_IDS,
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

/** Marker written into a creation-attested row's `details`, so an operator
 * reading a verified flag can tell evidence-by-scan from evidence-by-birth. */
export const CREATION_ATTESTATION_DETAIL = { attested: 'datastore-created-empty' } as const;

/** Optional sink for attestation trouble — best-effort, never fatal. */
export interface AttestationLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

/**
 * Attest, at the moment a datastore is created from empty, the migrations
 * whose facts that emptiness already settles (ADR-0104, 2026-07-30 addendum).
 *
 * **The caller carries the whole precondition.** This function cannot check
 * it: by the time anything can be queried, "created empty" and "found empty"
 * look identical, and they are not the same claim — a half-initialised store,
 * a misconfigured connection, or a store someone truncated all *look* empty
 * while legacy values may yet arrive. Only the code performing the creation
 * knows it watched the store come into being. Call this ONLY from there;
 * never from a probe that concluded a store looks empty.
 *
 * Given that, the fact recorded is observed, not assumed — the same discipline
 * the gates run on. Without it, every deployment born on a version that
 * already ships these migrations would start lax and stay lax until someone
 * ran a command that, for them, does nothing.
 *
 * **Never overwrites.** A migration id that already has a row is skipped
 * untouched: a store with flag rows is by definition not one being created,
 * so a write here would be evidence about the wrong database — and it could
 * only ever *raise* a gate the real evidence had closed.
 *
 * **Best-effort, deliberately diverging from this module's "writes fail
 * loudly" rule.** That rule fits the migration commands, whose entire output
 * is the record. This runs inside a fresh deployment's boot, where the two
 * failure directions are not symmetric: a missed attestation leaves the
 * deployment lax (warnings, retained files — recoverable by running the
 * migration), while a thrown error would break the boot of a brand-new
 * deployment over bookkeeping.
 *
 * @returns the ids actually attested (absent ones only).
 */
export async function attestFreshDatastore(
  engine: MigrationFlagEngine,
  options: { migrationIds?: readonly string[]; logger?: AttestationLogger } = {},
): Promise<string[]> {
  const ids = options.migrationIds ?? CREATION_ATTESTED_MIGRATION_IDS;
  const logger = options.logger;
  if (!engine.getObject(DATA_MIGRATION_FLAG_OBJECT)) return [];

  const now = new Date().toISOString();
  const attested: string[] = [];
  for (const id of ids) {
    try {
      if (await readDataMigrationFlag(engine, id)) continue; // not ours to write
      await engine.insert(
        DATA_MIGRATION_FLAG_OBJECT,
        {
          id,
          last_run_at: now,
          verified_at: now,
          // Nothing was applied — no backfill ran, and none was needed.
          applied_at: null,
          blocking: 0,
          advisory: 0,
          details: JSON.stringify(CREATION_ATTESTATION_DETAIL),
          created_at: now,
          updated_at: now,
        },
        { context: { ...SYSTEM_CTX } },
      );
      attested.push(id);
    } catch (err) {
      logger?.warn(
        `[migration] could not attest '${id}' on this new datastore ` +
          `(${(err as Error)?.message ?? err}) — it stays in the lax posture until ` +
          `\`os migrate\` records the flag`,
      );
    }
  }
  if (attested.length > 0) {
    logger?.info(
      `[migration] new datastore attested at creation: ${attested.join(', ')} — ` +
        `no legacy data can exist here, so the gated behaviour is enabled from birth`,
    );
  }
  return attested;
}
