// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_metadata_history.recorded_by`: sentinel `'system'` → `NULL` (#4556).
 *
 * ## What was wrong
 *
 * `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` —
 * a foreign key. The write path filled it with `actor ?? 'system'`, so every
 * actor-less metadata write (boot sync, migration, scheduled job) stored the
 * STRING `'system'` in a column whose declared type says "an id of a
 * `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
 * (`'usr_system'`) is not auto-provisioned on the current runtime either, so
 * the value could not resolve under any reading.
 *
 * That is `declared ≠ actual` at the data layer, and it had already cost
 * twice: #4441 had to exempt every `readonly` field from the write-path
 * referential-integrity check to stop ordinary package create/publish/clone
 * being rejected, and #4551's dangling-reference audit had to skip the same
 * set. The field ended up the platform's only reference column that is
 * neither enforced nor audited.
 *
 * The maintainer's ruling (2026-08-02) fixed the WRITE path rather than
 * loosening the declared type: `recorded_by` stays a `lookup('sys_user')`,
 * an actor-less write stores `NULL`, and `NULL` means "system-initiated".
 * No Salesforce-style magic system-user row (a record that can never log in
 * yet holds an identity is a new security surface), and no `actor_kind`
 * companion column.
 *
 * ## What this plan does
 *
 * Rewrites the rows already on disk. The column has only ever held one
 * sentinel — `'system'`, written by exactly one expression, `actor ??
 * 'system'` — so `'system'` → `NULL` is SEMANTICALLY EQUIVALENT, not a
 * reinterpretation: both spellings mean "no actor", and only the second one
 * is expressible in the declared type.
 *
 * ## Why it rides the journal rather than a boot-time backfill
 *
 * ADR-0119 D2 (#4617). A backfill that runs as a side effect of a process
 * starting is invisible when it half-finishes, and this one rewrites an
 * append-only audit log — the one table where "it partly ran" must never be
 * a guess. Under the journal each chunk is one transaction, `chunk_done` is
 * written INSIDE it, and an interrupted run stays exactly as recoverable as
 * it was at the moment it died.
 *
 * ## Idempotency
 *
 * `forward` sets a constant (`NULL`) on rows addressed by primary key, so a
 * redelivered chunk (`attempt > 1`, outcome UNKNOWN) reaches the same state
 * as a first delivery — the recheck the runner's at-least-once contract asks
 * for is satisfied by construction rather than by a lookup. `load()` selects
 * only rows still holding the sentinel, so a second RUN of the whole plan
 * finds nothing and commits zero chunks.
 */

import type { MigrationPlan, MigrationPlanStep, MigrationChunkContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { EngineUpdateOptions } from '@objectstack/spec/data';

/**
 * `MigrationChunkContext.context` is declared `unknown` — the runner hands
 * back whatever the driver's `transaction()` produced and has no business
 * asserting its shape. The engine's write options declare the execution
 * envelope. This narrows once, at the one place that threads the two
 * together, rather than at each call.
 */
type EngineExecutionContext = EngineUpdateOptions['context'];

/** The table this plan rewrites. Matches `SysMetadataRepository.historyTable`. */
export const METADATA_HISTORY_OBJECT = 'sys_metadata_history';

/**
 * The one sentinel this column has ever held.
 *
 * Named rather than inlined so the plan, its compensation and its tests all
 * refer to the same literal — a compensation that restores a DIFFERENT string
 * than forward removed would silently rewrite history.
 */
export const RECORDED_BY_SENTINEL = 'system';

/** Stable plan id — recorded in the journal and looked up by `os migrate resume`. */
export const RECORDED_BY_SENTINEL_PLAN_ID = 'metadata.recorded-by-sentinel-to-null';

/** Minimal row shape the plan needs: the primary key, nothing else. */
export interface SentinelHistoryRow {
  readonly id: string;
}

/**
 * Read the rows still holding the sentinel.
 *
 * Exported so a dry run can report the exact same set the apply run would
 * rewrite, rather than a second query that could disagree with it.
 */
export async function findSentinelHistoryRows(
  engine: IObjectQLEngine,
): Promise<SentinelHistoryRow[]> {
  const rows = (await engine.find(
    METADATA_HISTORY_OBJECT,
    { where: { recorded_by: RECORDED_BY_SENTINEL }, fields: ['id'] },
    { context: { isSystem: true } },
  )) as Array<{ id?: unknown }> | null | undefined;
  return (rows ?? [])
    .filter((r): r is { id: string } => typeof r?.id === 'string')
    .map((r) => ({ id: r.id }));
}

/**
 * Set `recorded_by` on one chunk of rows.
 *
 * `context: ctx.context` is the transaction-bound context, so the writes join
 * the chunk's transaction instead of committing beside it — AND it carries
 * `isSystem`, which is what lets a `readonly` column be written at all
 * (`ObjectQL.update` strips caller-supplied writes to `readonly` fields for
 * every non-system caller; a migration is the platform, not a caller).
 */
async function setRecordedBy(
  rows: readonly SentinelHistoryRow[],
  ctx: MigrationChunkContext,
  engine: IObjectQLEngine,
  value: string | null,
): Promise<void> {
  for (const row of rows) {
    await engine.update(
      METADATA_HISTORY_OBJECT,
      { recorded_by: value },
      { where: { id: row.id }, context: ctx.context as EngineExecutionContext },
    );
  }
}

/**
 * The `'system'` → `NULL` plan.
 *
 * `onCrash: 'resume'` — a rediscovered run goes FORWARD. Unwinding would
 * re-introduce the fake foreign key this plan exists to remove, so "finish
 * the job" is the safe direction here and "put it back" is not. A
 * `compensate` is still declared, because an in-run failure always unwinds
 * (the runner is alive to do it) and a partially-rewritten audit log is
 * nobody's intent.
 */
export function createRecordedBySentinelPlan(opts: { chunkSize?: number } = {}): MigrationPlan {
  const step: MigrationPlanStep<SentinelHistoryRow> = {
    name: 'sys_metadata_history.recorded_by: sentinel → null',
    load: (engine) => findSentinelHistoryRows(engine),
    forward: (rows, ctx, engine) => setRecordedBy(rows, ctx, engine, null),
    compensate: (rows, ctx, engine) => setRecordedBy(rows, ctx, engine, RECORDED_BY_SENTINEL),
  };
  return {
    id: RECORDED_BY_SENTINEL_PLAN_ID,
    steps: [step],
    onCrash: 'resume',
    ...(opts.chunkSize !== undefined ? { chunkSize: opts.chunkSize } : {}),
  };
}
