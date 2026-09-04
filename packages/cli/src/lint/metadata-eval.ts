// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata-generation eval harness.
 *
 * Measures how well a stack of metadata follows the platform's modelling
 * conventions, using `scoreMetadata` (the linter-as-rubric) as the judge. Two
 * modes, same rubric:
 *
 *  - **Offline (default):** each case ships a golden fixture stack — the ideal
 *    output for its prompt. Scoring the fixtures is a deterministic regression
 *    guard: it proves the conventions + rubric stay self-consistent, runs in CI,
 *    and needs no API key.
 *
 *  - **Live (opt-in):** pass `generate(prompt, caseId) => stack`. The harness
 *    scores whatever the generator produced for each prompt instead of the
 *    fixture. Wire `generate` to `AIService.generateObject<SolutionBlueprint>`
 *    (+ blueprint→metadata expansion) to benchmark a real model against the
 *    same bar. The seam is injected so this package keeps no LLM dependency.
 */

import { scoreMetadata, type MetadataScore } from './score.js';

export interface MetadataEvalCase {
  /** Stable id (snake_case). */
  id: string;
  /** The natural-language authoring goal a generator would receive. */
  prompt: string;
  /** Golden/representative stack used in offline mode. */
  fixture: unknown;
  /** Minimum score to pass this case (defaults to the runner's `minScore`). */
  minScore?: number;
  /** Optional human note about what the case exercises. */
  note?: string;
}

export interface MetadataEvalCaseResult {
  id: string;
  prompt: string;
  /**
   * Set when this case has no usable stack to judge — the generator threw, or
   * the value it returned could not be scored. Present ⇒ the case FAILED, and
   * the string names the cause.
   */
  generationError?: string;
  score: MetadataScore;
  minScore: number;
  passed: boolean;
  /** 'fixture' offline, 'generated' when a live generator produced the stack. */
  source: 'fixture' | 'generated';
}

export interface MetadataEvalReport {
  results: MetadataEvalCaseResult[];
  total: number;
  passed: number;
  failed: number;
  /** Mean score across all cases (0–100, rounded). */
  meanScore: number;
  /** True when every case passed. */
  ok: boolean;
  mode: 'offline' | 'live';
}

export interface RunMetadataEvalOptions {
  /**
   * Live generator. When provided, the harness scores `generate(prompt, id)`
   * instead of the case fixture. Returning a rejected promise / throwing marks
   * that case as a generation error (failed) — and so does returning a value
   * that cannot be scored, since scoring it is what the harness does next.
   */
  generate?: (prompt: string, caseId: string) => unknown | Promise<unknown>;
  /** Default pass threshold for cases that don't set their own `minScore`. */
  minScore?: number;
}

const DEFAULT_MIN_SCORE = 75;

/**
 * The score attached to a case whose stack could not be scored AT ALL.
 *
 * ⛔ Deliberately NOT `scoreMetadata({})`, even though the throwing-generator
 * path above substitutes an empty stack: the empty stack scores 100 / A /
 * `valid: true` (pinned in `score.test.ts`), and stamping that on a stack
 * nobody could parse would put a benign-looking verdict next to a failure.
 * A stack that cannot be walked is not an empty stack, and `valid: true` for
 * one that was never parsed is simply false.
 *
 * ⛔ This is not a measurement and must never be read as one — the case is
 * already failed by its `generationError`. It exists so `MetadataScore` stays
 * total and the report's shape never varies between a scored and an unscorable
 * case. Fresh object per call: the report is handed to callers who may mutate.
 */
function unscorableScore(): MetadataScore {
  return {
    score: 0,
    valid: false,
    grade: 'F',
    counts: { schemaErrors: 0, errors: 0, warnings: 0, suggestions: 0 },
    schemaErrors: [],
    issues: [],
  };
}

/**
 * Run the eval over a set of cases. Offline (fixtures) unless `generate` is
 * supplied.
 *
 * Never throws over its own work: producing a stack and scoring it are both
 * inside the loop's guards, so a generator that throws, a generator that
 * returns a value nobody can walk, and a fixture that cannot be scored all
 * become that case's `generationError` — a FAILED case in the returned report,
 * never an escaping error.
 *
 * ⚠️ The one thing outside that promise, stated rather than implied: reading
 * the caller's own `cases` entries (`c.id`, `c.prompt`, `c.fixture`,
 * `c.minScore`). A case object whose property reads themselves throw is a
 * broken argument, not a failed case — there is no id to report it under. No
 * in-repo caller can reach it: `os lint --eval` passes a static corpus.
 */
export async function runMetadataEval(
  cases: MetadataEvalCase[],
  options: RunMetadataEvalOptions = {},
): Promise<MetadataEvalReport> {
  const defaultMin = options.minScore ?? DEFAULT_MIN_SCORE;
  const live = typeof options.generate === 'function';
  const results: MetadataEvalCaseResult[] = [];

  for (const c of cases) {
    const minScore = c.minScore ?? defaultMin;
    let stack: unknown = c.fixture;
    let generationError: string | undefined;
    let source: 'fixture' | 'generated' = 'fixture';

    if (live) {
      source = 'generated';
      try {
        stack = await options.generate!(c.prompt, c.id);
      } catch (err: any) {
        generationError = err?.message || String(err);
        stack = {};
      }
    }

    // Scoring walks a value this harness did not build, and walking it can
    // throw. Two sites are driven: the normalizer spreads the stack's top
    // level, and the schema parse one call further in walks the rest — so a
    // poisoned property enumeration anywhere in a generated stack surfaces
    // here, NOT inside the `try` above, which only ever covered `generate`
    // itself. That is why the docblock's "Never throws" was false as written.
    //
    // ⛔ The throw is never absorbed: it becomes THIS CASE's failure rather
    // than the process's, routed through the same per-case channel a throwing
    // generator uses, so `passed` below is false and the caller's report says
    // `ok: false`. Swallowing it into a passing case would be worse than the
    // crash it replaces.
    let score: MetadataScore;
    try {
      score = scoreMetadata(stack);
    } catch (err: any) {
      generationError = `Failed to score the ${source} stack: ${err?.message || String(err)}`;
      score = unscorableScore();
    }
    results.push({
      id: c.id,
      prompt: c.prompt,
      ...(generationError ? { generationError } : {}),
      score,
      minScore,
      passed: !generationError && score.score >= minScore && score.counts.errors === 0 && score.counts.schemaErrors === 0,
      source,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const meanScore = results.length
    ? Math.round(results.reduce((sum, r) => sum + r.score.score, 0) / results.length)
    : 0;

  return {
    results,
    total: results.length,
    passed,
    failed: results.length - passed,
    meanScore,
    ok: passed === results.length,
    mode: live ? 'live' : 'offline',
  };
}
