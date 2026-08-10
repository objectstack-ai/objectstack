// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  authorisesIrreversibleAction,
  CREATION_ATTESTED_MIGRATION_IDS,
  DATA_MIGRATION_FLAG_OBJECT,
  FILE_REFERENCES_MIGRATION_ID,
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

/**
 * What this boot has admitted against one migration's contract (#4769). The
 * engine's shape, restated structurally rather than imported: this package
 * defines schemas and must not take a runtime dependency on the engine to read
 * one number. Mirrors `AdmittedValueShapeViolationTally` in
 * `@objectstack/objectql`.
 */
export interface AdmittedMigrationViolations {
  count: number;
  first?: { object?: string; field?: string; type?: string; detail?: string };
}

/** Engine surface the flag helpers need — duck-typed like the storage seams. */
export interface MigrationFlagEngine {
  getObject(name: string): unknown | undefined;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
  /**
   * Value-shape violations this boot has ADMITTED, keyed by migration id
   * (#4769) — the counterexamples that forbid attesting. Optional so a fake or
   * an older engine simply reports nothing; see {@link attestFreshDatastore}
   * for why "cannot say" is handled the way it is.
   */
  valueShapeViolationsAdmitted?(): Record<string, AdmittedMigrationViolations>;
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
      // [#4797] Absent on a row written before this column existed, which
      // reads as "no deviation observed" — the same answer as an unmarked new
      // row, and the right one: nothing recorded a deviation because nothing
      // was watching for one. Such a row is no more authorised than it was
      // before, since the irreversible gate still requires `verified_at`.
      deviation_observed_at:
        row.deviation_observed_at == null ? null : String(row.deviation_observed_at),
      deviation_detail: typeof row.deviation_detail === 'string' ? row.deviation_detail : undefined,
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

/**
 * May `migrationId`'s certificate authorise an IRREVERSIBLE action here — one
 * whose effect cannot be undone if the certificate turns out to be stale
 * (#4797)?
 *
 * Strictly stronger than {@link isDataMigrationVerified}: everything that one
 * requires, plus no deviation observed since the certificate was earned. Read
 * this at the moment of irreversibility and nowhere else; a caller about to do
 * something recoverable should keep asking the weaker question, because
 * withdrawing recoverable authority on one admitted write is exactly the
 * one-way door the ruling rejected.
 *
 * Fails toward retention through the same funnel as its sibling — an
 * unreadable row answers `null`, which answers `false`.
 */
export async function mayActIrreversibly(
  engine: MigrationFlagEngine,
  migrationId: string,
): Promise<boolean> {
  return authorisesIrreversibleAction(await readDataMigrationFlag(engine, migrationId));
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
 *
 * A run also CLEARS any deviation marker (#4797). The marker records that one
 * admitted write contradicted the certificate; a run is a fresh walk of the
 * whole store, which is evidence of the same order as the certificate itself
 * and therefore supersedes it in both directions. That is what keeps the
 * escape hatch from becoming a one-way door: `os migrate … --apply` is the
 * documented way back to full authority, and it must actually restore it.
 *
 * Cleared on a FAILING run too, deliberately. A failing run sets
 * `verified_at: null`, which already closes both gates, so leaving the marker
 * behind would only strand a stale diagnostic on a row whose verdict has been
 * replaced wholesale.
 *
 * The one race worth naming: a lax write admitted *while* the scan is running
 * can set the marker just before this clears it, and its counterexample is
 * then only visible in the scan's own findings. Turn the `OS_ALLOW_LAX_*`
 * switches off before re-running — which is what the operator is doing anyway
 * when they run the migration to re-earn the gate.
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
    deviation_observed_at: null,
    deviation_detail: null,
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
 * **The emptiness has to still be settling the question.** "Created empty"
 * licenses a claim about CONTENT — no legacy value here — and that inference
 * expires the moment the boot writes something. Before #4769 this function
 * ignored that: it ran at `kernel:ready` while the same boot's seed was still
 * landing rows, so a deployment certified itself and then immediately stored
 * values contradicting the certificate. The first boot ran warn-first over
 * data it kept; every later boot read the certificate, enforced, and rejected
 * the very rows its predecessor had written — the same data, the same code, a
 * restart the only difference.
 *
 * So the boot's own admissions are consulted first. The engine tallies every
 * off-shape value it lets through, with the exact predicate strict mode uses,
 * and one such value is a complete disproof: certifying needs a scan of
 * everything, refuting needs a single counterexample. An id this boot has
 * contradicted is NOT attested — the deployment stays warn-first, which is
 * both true and recoverable, and the operator is told which value cost them
 * the gate. An engine that cannot say (a fake, an older build) reports
 * nothing, which reads as no counterexample: this is a best-effort
 * bookkeeping path, and it was already the case that a store nobody could
 * inspect got attested on the creator's word alone.
 *
 * **Never overwrites.** A migration id that already has a row is skipped
 * untouched: a store with flag rows is by definition not one being created,
 * so a write here would be evidence about the wrong database — and it could
 * only ever *raise* a gate the real evidence had closed. (The engine owns the
 * other direction: a certificate contradicted AFTER it was issued is revoked
 * from the write path that contradicted it.)
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

  let admitted: Record<string, AdmittedMigrationViolations> = {};
  try {
    admitted = engine.valueShapeViolationsAdmitted?.() ?? {};
  } catch {
    admitted = {};
  }

  const now = new Date().toISOString();
  const attested: string[] = [];
  for (const id of ids) {
    try {
      if (await readDataMigrationFlag(engine, id)) continue; // not ours to write
      // #4769 — a boot may not prove a contract it has already broken.
      const contradiction = admitted[id];
      if (contradiction && contradiction.count > 0) {
        const at = contradiction.first;
        const where = at?.object && at?.field ? `${at.object}.${at.field}` : 'a record';
        logger?.warn(
          `[migration] NOT attesting '${id}' on this new datastore: this boot already wrote ` +
            `${contradiction.count} value(s) that the migration's own contract rejects ` +
            `(${where}${at?.detail ? `: ${at.detail}` : ''}). The store was created empty, but it ` +
            'is no longer empty and what it now holds contradicts the claim — the gate stays ' +
            'open (warn-first). Fix the data, then run `os migrate ' +
            (id === FILE_REFERENCES_MIGRATION_ID ? 'files-to-references' : 'value-shapes') +
            ' --apply` to close it on real evidence (ADR-0104).',
        );
        continue;
      }
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
