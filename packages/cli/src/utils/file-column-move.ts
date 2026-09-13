// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15989] The ADR-0104 file-family COLUMN step, as a further step of
 * `os migrate files-to-references --apply` — the ruling on #15041, step 2.
 *
 * The backfill converts the VALUES; this converts the COLUMNS and the encoding
 * of what they hold, and then records `sys_migration.columns_moved_at` so the
 * driver flips its write arm. Those two acts are ONE act on purpose: measured
 * on SQLite, after the columns are converted a JSON-arm driver still *reads*
 * the migrated column correctly but its next *write* re-quotes, so a column
 * move with no arm flip is a storage format that is half migrated in a way
 * nothing detects.
 *
 * ## Three gates, in this order, and the step does nothing until all three pass
 *
 *  1. **The migration's own gate.** The caller only reaches this after
 *     backfill + verify reported zero blocking rows — the ruling's "abort
 *     otherwise", enforced by the caller because only it knows the verdict.
 *  2. **Every pre-check, before any statement.** `runFileColumnMove` runs ALL
 *     the pre-checks first and executes nothing at all unless every one of
 *     them answered zero. This is stricter than the ruling asks and
 *     deliberately so: a step that moved three columns and then aborted on the
 *     fourth leaves a datastore in a state no flag can describe.
 *  3. **No refusals.** A column the driver could not plan (an unsupported
 *     dialect, a failed introspection, a declared column the datastore does
 *     not have) stops the step. ⛔ Moving the columns it *could* see and
 *     stamping the deployment as moved would certify the ones it could not.
 *
 * ## ⛔ The statements are the DRIVER's, imported at the point of use
 *
 * ## ⛔ It lives in `src/utils/`, NOT beside the command it serves
 *
 * oclif's command table is `"glob": "**\/*.js"` under `dist/commands`, so EVERY
 * module there is a command. A helper placed beside `files-to-references.ts`
 * has no default-exported `Command`, and oclif then emits a `findCommand … not
 * found` warning to **stderr on every single CLI invocation** — measured, and
 * it is not cosmetic: it broke `os validate --json` for a consumer that reads
 * stdout and stderr together, by appending non-JSON after the payload.
 *
 * `@objectstack/driver-sql` owns the dialects and MEASURED these clauses, and
 * the one thing this step must never do is carry its own copy: the copy that
 * matters here is the abort pre-check, which exists precisely because the
 * ruling's own prose carried a statement that does not abort. And the import
 * is lazy because oclif `import()`s every command module while building its
 * command table, so one static value import of a driver package costs every
 * other command its place in that table when the driver is not built (#5726,
 * pinned by `schema-migrate.lazy-driver-import.test.ts`).
 */

import type { MediaColumnMovePlan, MediaColumnMoveScan } from '@objectstack/driver-sql';

/** The raw-SQL seam shape — the same signature `resolveSeedTenancyExec` returns. */
export type RawExec = (sql: string, params?: unknown[]) => Promise<unknown>;

/** Normalizer for whatever shape a dialect's driver hands back from a raw read. */
export type RowNormalizer = (result: unknown) => Array<Record<string, unknown>>;

/** One column's outcome. */
export interface FileColumnMoveOutcome {
  table: string;
  column: string;
  kind: MediaColumnMovePlan['kind'];
  /** Cells the pre-check found that the move would not preserve. */
  blocking: number;
  /** `null` until the pre-check has actually answered. */
  statement: string;
  status: 'planned' | 'blocked' | 'moved' | 'failed' | 'not_attempted';
  error?: string;
}

export interface FileColumnMoveResult {
  /** Did the caller ask for writes? A dry run reads the pre-checks and writes nothing. */
  apply: boolean;
  outcomes: FileColumnMoveOutcome[];
  refusals: MediaColumnMoveScan['refusals'];
  /** Statements actually sent to the database. ALWAYS `[]` on a dry run. */
  executedStatements: string[];
  /**
   * Total cells every pre-check found blocking. Non-zero ⇒ nothing ran and
   * nothing may be stamped.
   */
  blocking: number;
  /**
   * May the caller record `columns_moved_at`? True only when writes were
   * asked for, there were no refusals, no pre-check blocked, and every planned
   * column reports `moved`. ⛔ An empty plan does NOT earn a stamp — see
   * {@link runFileColumnMove}.
   */
  recordable: boolean;
}

/** Read one pre-check's count out of whatever the seam handed back. */
function countOf(rows: Array<Record<string, unknown>>): number {
  const first = rows[0];
  if (!first) return Number.NaN;
  // `count(*) as n` comes back as `n` on every dialect this step serves, but
  // the case and the JS type vary (Postgres hands back a string for bigint).
  const raw = first.n ?? first.N ?? Object.values(first)[0];
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Run the column step.
 *
 * ## What a dry run does, and why it is not "executes nothing"
 *
 * `os migrate multi-value-columns` holds its `exec` seam completely unused on
 * a dry run, and says so. This step cannot borrow that contract, because the
 * one thing an operator needs to know before a column move is whether it would
 * ABORT — and that answer is a `SELECT`. So a dry run here runs every
 * pre-check and no statement: reads happen, writes do not, which is the
 * contract `os migrate files-to-references` already keeps for its own scan.
 * The distinction is in the report rather than implied: `executedStatements`
 * is `[]` on a dry run, always.
 *
 * ## ⛔ An empty plan is not a completed move
 *
 * A datastore with no media columns at all, and a driver whose dialect this
 * step cannot serve, both produce zero plans. Stamping the second as moved
 * would be a certificate over columns nobody looked at, so `recordable` is
 * false whenever there is nothing to move — a deployment with no media columns
 * has nothing for the bare arm to change, and leaving it unstamped costs it
 * nothing.
 */
export async function runFileColumnMove(args: {
  scan: MediaColumnMoveScan;
  exec: RawExec;
  rows: RowNormalizer;
  apply: boolean;
  onStatement?: (statement: string) => void;
}): Promise<FileColumnMoveResult> {
  const { scan, exec, rows, apply } = args;
  const outcomes: FileColumnMoveOutcome[] = scan.plans.map((plan) => ({
    table: plan.table,
    column: plan.column,
    kind: plan.kind,
    blocking: 0,
    statement: plan.statement,
    status: 'planned',
  }));
  const executedStatements: string[] = [];

  // ── Phase 1 · every pre-check, before any statement ──────────────────────
  let blocking = 0;
  let precheckFailed = false;
  for (let i = 0; i < scan.plans.length; i++) {
    const plan = scan.plans[i]!;
    const outcome = outcomes[i]!;
    try {
      const n = countOf(rows(await exec(plan.precheck)));
      if (!Number.isFinite(n)) {
        // A pre-check that answered nothing readable is NOT a zero. Treated as
        // a failure, because the alternative is moving a column on the
        // strength of a reading that never happened.
        outcome.status = 'failed';
        outcome.error =
          `the abort pre-check for ${plan.table}.${plan.column} returned no readable count, so ` +
          'whether this column holds a cell the move would destroy is unknown. Nothing was run.';
        precheckFailed = true;
        continue;
      }
      outcome.blocking = n;
      if (n > 0) {
        outcome.status = 'blocked';
        outcome.error = `${n} ${plan.precheckMeaning}`;
        blocking += n;
      }
    } catch (error: unknown) {
      outcome.status = 'failed';
      outcome.error = error instanceof Error ? error.message : String(error);
      precheckFailed = true;
    }
  }

  const stopped = blocking > 0 || precheckFailed || scan.refusals.length > 0;

  if (!apply || stopped) {
    for (const outcome of outcomes) {
      if (outcome.status === 'planned' && stopped) outcome.status = 'not_attempted';
    }
    return {
      apply,
      outcomes,
      refusals: scan.refusals,
      executedStatements,
      blocking,
      recordable: false,
    };
  }

  // ── Phase 2 · the statements, in plan order ──────────────────────────────
  let failed = false;
  for (let i = 0; i < scan.plans.length; i++) {
    const plan = scan.plans[i]!;
    const outcome = outcomes[i]!;
    if (failed) {
      outcome.status = 'not_attempted';
      continue;
    }
    try {
      args.onStatement?.(plan.statement);
      await exec(plan.statement);
      executedStatements.push(plan.statement);
      outcome.status = 'moved';
    } catch (error: unknown) {
      outcome.status = 'failed';
      outcome.error = error instanceof Error ? error.message : String(error);
      failed = true;
    }
  }

  return {
    apply,
    outcomes,
    refusals: scan.refusals,
    executedStatements,
    blocking,
    // ⛔ `every` over an EMPTY array is `true`, which is exactly the certificate
    // over nothing this step must not issue — so the length is asked first.
    recordable: outcomes.length > 0 && outcomes.every((o) => o.status === 'moved'),
  };
}

/**
 * The one sentence an operator reads when the step refused to move anything.
 * Kept beside the runner so the report and the reason cannot drift apart.
 */
export function describeFileColumnMoveRefusal(result: FileColumnMoveResult): string | null {
  if (result.refusals.length > 0) {
    return (
      `The column step did not run: ${result.refusals.length} media column(s) could not be planned. ` +
      'Every declared media column has to be plannable before any of them moves — moving the ones ' +
      'that could be seen would record this deployment as migrated on behalf of the ones that ' +
      'could not.'
    );
  }
  if (result.blocking > 0) {
    return (
      `The column step ABORTED before running any statement: ${result.blocking} cell(s) still hold a ` +
      'value the move would not preserve. This is the gate working — the superseded form of this ' +
      'migration accepted those rows and flattened them to literal text. Convert the rows named ' +
      'above and re-run.'
    );
  }
  return null;
}
