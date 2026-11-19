// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Passed every half", read from a run record's `results` — the per-half
 * verdicts `runRecord` (`runner/scorecard.ts`) writes, one row per
 * `<card>.<mode>.<half>`. Nothing here re-scores: the verdict the record holds
 * is the verdict.
 *
 *   - The verdict must be `pass`. `partial`, `fail`, `blocked` and `not-run`
 *     are not a pass (a half with nothing measured is `not-run` in the record,
 *     never `pass`), and a row the record does not hold is not a pass either.
 *   - The record must hold the scratch mode: the gallery ships the scratch
 *     project's source, so that is the run the verdicts are about.
 *   - Scratch mode owes every half: Build, Run-问数, Run-operations, and the
 *     three iterate halves (the iterate build and its re-run). A record run
 *     with `--no-iterate-run` leaves the iterate Run halves `not-run`, so it
 *     does not pass.
 *   - Template mode, when the record holds it, owes its iterate halves. Its
 *     first Build and Run rows are `not-run` by construction (the mode installs
 *     a verified build and builds nothing first), so they are not asked. A
 *     template mode that was skipped holds `not-run` in every row and fails.
 *   - An ask mode, when the record holds it, owes nothing and is not judged:
 *     it ran the questions and operations on a supplied build and authored
 *     none, so it says nothing about the scratch build the gallery ships
 *     ({@link ASK_MODE_NOT_EXPORTED}). It never fails the record either.
 *   - No turn may be NOT MEASURED, in any Run half the record holds of the
 *     scratch and template modes (the first Run and the iterate re-run), questions and operations
 *     alike. The scorecard leaves a not-measured turn (one that reads a seed
 *     row the app refused) out of both passed and total, so its half can still
 *     read `pass`; the gallery is trust-first, and a turn nobody measured is a
 *     claim nobody proved. Each one is a reason of its own.
 */

import type { ScenarioRunRecord, Verdict } from './record.js';

/** Why the gallery passes over a record's ask mode: its pass rule and its transcript show the build this app ships. */
export const ASK_MODE_NOT_EXPORTED =
  'the ask mode ran the questions and operations on a supplied build and authored nothing, so it says nothing about the build this app ships: it is not judged or shown here';

/** The halves each mode owes, in the record's row order. */
export const OWED_HALVES = {
  scratch: ['build', 'run-ask', 'run-operations', 'iterate-build', 'iterate-run-ask', 'iterate-run-operations'],
  template: ['iterate-build', 'iterate-run-ask', 'iterate-run-operations'],
} as const satisfies Record<'scratch' | 'template', readonly string[]>;

export interface HalfVerdict {
  /** `<card>.<mode>.<half>`, the record's row id. */
  id: string;
  /** `missing` when the record holds no row for it. */
  verdict: Verdict | 'missing';
}

export interface PassJudgement {
  passed: boolean;
  /** Every owed half with its verdict, in order. */
  halves: HalfVerdict[];
  /** Why it did not pass, one line per reason (a failing half, or a not-measured turn); empty when it passed. */
  reasons: string[];
}

export function judgeRecord(record: ScenarioRunRecord): PassJudgement {
  const card = record.cardRun.card;
  const byId = new Map(record.results.map((r) => [r.id, r.verdict]));
  const modes = record.cardRun.modes.map((m) => m.mode);
  const reasons: string[] = [];
  if (!modes.includes('scratch')) reasons.push('the record holds no scratch mode, and the scratch project is what the gallery ships');
  const halves: HalfVerdict[] = [];
  for (const mode of (['scratch', 'template'] as const).filter((m) => modes.includes(m))) {
    for (const half of OWED_HALVES[mode]) {
      const id = `${card}.${mode}.${half}`;
      const verdict = byId.get(id) ?? 'missing';
      halves.push({ id, verdict });
      if (verdict !== 'pass') reasons.push(`${id}: ${verdict}`);
    }
  }
  for (const m of record.cardRun.modes) {
    if (m.mode === 'ask') continue; // ASK_MODE_NOT_EXPORTED
    const runs = [
      ['run', m.run],
      ['iterate-run', m.iterate?.run],
    ] as const;
    for (const [phase, half] of runs) {
      for (const q of half?.questions ?? []) {
        if (q.notMeasured) reasons.push(`${card}.${m.mode}.${phase} question ${q.question}${q.persona ? ` as ${q.persona}` : ''}: not measured — ${q.notMeasured}`);
      }
      for (const o of half?.operations ?? []) {
        if (o.notMeasured) reasons.push(`${card}.${m.mode}.${phase} operation ${o.operation} as ${o.persona}: not measured — ${o.notMeasured}`);
      }
    }
  }
  return { passed: reasons.length === 0, halves, reasons };
}
