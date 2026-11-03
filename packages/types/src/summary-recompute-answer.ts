// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The answer a data write EARNED, carried on the stale-roll-up refusal its
 * engine call threw — so an HTTP door can answer the write's success while
 * every other caller still reads the refusal.
 *
 * ## The case
 *
 * When a write lands but a parent's roll-up summary cannot be recomputed
 * after it, the engine throws objectql's `SummaryRecomputeError`
 * (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written") carrying
 * the written result as `written`. Two kinds of caller read that refusal:
 *
 *  - a BULK caller treats it as "written, with a stale summary" and reports
 *    that in its own result — the import runner marks the row created with a
 *    warning code, the seed loader counts `summariesStale`. They need the
 *    refusal to keep arriving exactly as it does.
 *  - an HTTP data door (`POST` / `PATCH` / `DELETE /api/v1/data/...`) mapped it
 *    to a 500, so a client was told a write failed that had landed, and a
 *    retried create made a duplicate.
 *
 * The data methods of `ObjectStackProtocolImplementation` therefore build the
 * answer the write earned — its record with the `internal: true` strip
 * applied, `droppedFields`, `warnings` and the rest, exactly the body the
 * same write answers when every roll-up recomputes — and attach it to the
 * refusal before rethrowing it. The HTTP door answers that body with the
 * write's own success status; nothing is added to it, so the door answers no
 * new shape. A caller that does not ask for it reads the refusal unchanged.
 *
 * Matched by `code`, never `instanceof`: the class lives in objectql, which
 * depends on this package, so importing it back would cycle (the seed
 * loader's reason too). The code is READ here, compared inline the way the
 * import runner and the seed loader read it, never re-declared: objectql
 * stamps it and owns its ledger row (`check:error-code-provenance`).
 */

/** Where the earned answer rides on the refusal — a symbol, so it never serializes. */
const EARNED_ANSWER = Symbol.for('@objectstack/types:summary-recompute-earned-answer');

/** Structural view of objectql's `SummaryRecomputeError`: what a write's caller reads off it. */
export interface SummaryRecomputeRefusal extends Error {
  /**
   * Always `'ERR_SUMMARY_RECOMPUTE'` (what `isSummaryRecomputeRefusal` checks). Typed
   * `string`: a literal member here reads as a second stamp of objectql's code
   * (`check:error-code-provenance`, objlit).
   */
  readonly code: string;
  /** The write's result — what the engine call returns when every roll-up recomputes. */
  readonly written: unknown;
  readonly failures?: ReadonlyArray<{ childObject?: string; parentObject?: string; parentId?: string; field?: string }>;
}

/** Is `e` the engine's stale-roll-up refusal — a write that landed? */
export function isSummaryRecomputeRefusal(e: unknown): e is SummaryRecomputeRefusal {
  return e instanceof Error && (e as { code?: unknown }).code === 'ERR_SUMMARY_RECOMPUTE';
}

/**
 * An engine write's `.catch`: hand back the stale-roll-up refusal — a write
 * that landed, whose `written` is the result the call would have answered —
 * so the caller can build the answer the write earned; rethrow every other
 * error unchanged.
 *
 * A `.catch` on the engine call, not a wrapper taking it as a closure: the
 * call stays in the data method's own body, where the by-id write-seam scan
 * (`check:engine-double-contract`, #8194) reads it.
 */
export function staleSummaryRefusalOrThrow(e: unknown): SummaryRecomputeRefusal {
  if (!isSummaryRecomputeRefusal(e)) throw e;
  return e;
}

/** Attach the answer the write earned to its refusal, and hand the refusal back to be thrown. */
export function withEarnedAnswer(stale: SummaryRecomputeRefusal, answer: Record<string, unknown>): SummaryRecomputeRefusal {
  Object.defineProperty(stale, EARNED_ANSWER, { value: answer, enumerable: false, configurable: true });
  return stale;
}

/**
 * The answer a write earned, when `e` is its stale-roll-up refusal and the
 * data method that ran it attached one; `undefined` for every other error.
 */
export function earnedAnswerOf(e: unknown): Record<string, unknown> | undefined {
  if (!isSummaryRecomputeRefusal(e)) return undefined;
  const answer = (e as unknown as Record<symbol, unknown>)[EARNED_ANSWER];
  return answer !== null && typeof answer === 'object' ? (answer as Record<string, unknown>) : undefined;
}

/** Per process: never cleared, so a restart reports each field again (not a republish). */
const reportedStaleSummaries = new Set<string>();

/**
 * The operator lines a door logs, at `error`, when it answers a write's success
 * over a stale-roll-up refusal — one per child object and summary field not yet
 * reported in this process; `[]` once each has been said. The memory lives as
 * long as the process and is never cleared — a republish does not re-arm it.
 *
 * `error` because the database is now internally inconsistent while every
 * answer looks normal: the parent's summary column disagrees with its detail
 * rows until a later write recomputes it (AGENTS.md, degradation log levels:
 * the consequence and the fix, said once). The engine's own `warn` names every
 * failure, and why the recompute was refused, as it happens.
 */
export function staleSummaryAnswerLines(error: SummaryRecomputeRefusal, object: string | undefined): string[] {
  const failures = Array.isArray(error.failures) && error.failures.length > 0 ? error.failures : [{}];
  const lines: string[] = [];
  for (const f of failures) {
    const child = f.childObject ?? object ?? '?';
    const summary = `${f.parentObject ?? '?'}.${f.field ?? '?'}`;
    const key = `${child}|${summary}`;
    if (reportedStaleSummaries.has(key)) continue;
    reportedStaleSummaries.add(key);
    lines.push(
      `A write to "${child}" landed and was answered as a success, but the roll-up summary "${summary}" ` +
        'could not be recomputed: that column now disagrees with its detail rows, and nothing looks wrong. ' +
        "Fix the summary field's `summaryOperations` (the engine's warning names why the recompute was " +
        'refused) and republish; the next write to a child recomputes it. Reported once per field per process.',
    );
  }
  return lines;
}
