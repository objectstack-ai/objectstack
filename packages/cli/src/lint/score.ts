// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata quality scorer — the automated rubric for the metadata-generation
 * eval (see `metadata-eval.ts`).
 *
 * The premise (chosen with the user): the LINTER is the rubric. A generated
 * stack is "good" exactly when it (a) parses against the canonical spec schema
 * and (b) is clean under the data-model lint rules. This is deterministic,
 * needs no LLM/API key, and runs in CI — yet it directly measures the
 * conventions we care about (master-detail, inlineEdit, roll-ups, selects,
 * naming, labels).
 *
 * `scoreMetadata(stack)` returns a 0–100 score plus a breakdown so callers can
 * show *why* a generation scored the way it did.
 */

import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { lintConfig } from '../commands/lint.js';
import type { LintIssue, Severity } from '@objectstack/lint';

/** Penalty weights per issue class. Schema errors are the most severe. */
export const SCORE_WEIGHTS = {
  schemaError: 12,
  error: 8,
  warning: 3,
  suggestion: 1,
} as const;

/**
 * The `rule` id on the synthetic issue raised when the linter throws.
 *
 * Exported so a consumer can tell "the linter reported a problem" from "the
 * linter never ran" by matching an id rather than prose.
 */
export const LINT_CRASHED_RULE = 'rubric/lint-crashed';

export interface MetadataScore {
  /** 0–100 quality score (higher is better). */
  score: number;
  /** True when the stack is schema-valid AND has zero lint errors. */
  valid: boolean;
  /** Letter grade derived from `score` (A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F otherwise). */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  counts: {
    schemaErrors: number;
    errors: number;
    warnings: number;
    suggestions: number;
  };
  /** Schema parse error messages (empty when valid). */
  schemaErrors: string[];
  /** Lint issues (naming, labels, structure, data-model conventions). */
  issues: LintIssue[];
  /**
   * Set only when the lint half of the rubric could NOT run: `lintConfig` threw
   * and this carries the thrown message. Absent on every run where the linter
   * completed -- including one where it reported errors, which is a lint
   * verdict, not a missing one.
   *
   * Optional on purpose. It is the machine-readable half of the refusal below,
   * not its enforcement: a consumer that never reads it still cannot mistake a
   * crashed run for a clean one, because the same event is carried by `issues`,
   * `counts.errors`, `valid` and `score`.
   */
  lintError?: string;
}

function gradeFor(score: number): MetadataScore['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function bySeverity(issues: LintIssue[], severity: Severity): LintIssue[] {
  return issues.filter((i) => i.severity === severity);
}

/**
 * Score a stack definition (raw or normalized) for metadata quality.
 * Pure & deterministic.
 */
export function scoreMetadata(stack: unknown): MetadataScore {
  const normalized = normalizeStackInput((stack ?? {}) as Record<string, unknown>);

  // 1) Schema validity against the canonical spec.
  const parsed = ObjectStackDefinitionSchema.safeParse(normalized);
  const schemaErrors: string[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

  // 2) Lint (naming/labels/structure + data-model conventions).
  //
  // A linter crash must not mask the schema verdict — the original intent, and
  // still right. What was not right is the number that came out of it: with
  // `issues = []` the penalty was 0, so a stack whose linter threw scored
  // 100 / A / `valid: true` with every count at zero — byte-for-byte the
  // verdict a genuinely clean stack gets, on a rubric half of which never ran.
  // "The linter found nothing" and "the linter never ran" are different facts.
  //
  // Reachable, and not exotically: a localized `label` (`{ en: …, 'zh-CN': … }`)
  // on an app, or on a view's `list`, is schema-valid and makes the label-case
  // rule throw. That crash is its own defect, filed separately; this function's
  // job is to never publish a clean verdict it did not earn.
  //
  // So the failure is recorded in every carrier a consumer might read, because
  // reading any ONE of them must be enough:
  //   · `lintError` — the fact itself, typed, for a machine consumer;
  //   · a synthetic `error` issue — so `issues`, `counts.errors` and `valid`
  //     carry it too, which is what makes the eval harness fail the case: its
  //     `passed` reads `counts.errors` and would never see a new field;
  //   · `score` 0 / grade `F` — the only channel `os lint --score --json`
  //     publishes, and the same refusal `unscorableScore()` (metadata-eval.ts)
  //     already gives a case there was nothing to judge, for the same reason:
  //     a clean number nothing earned is the worst possible output.
  // The schema verdict survives all of it — `schemaErrors` and
  // `counts.schemaErrors` still report exactly what the parse found.
  let issues: LintIssue[] = [];
  let lintError: string | undefined;
  try {
    issues = lintConfig(normalized) as LintIssue[];
  } catch (err) {
    lintError = err instanceof Error ? err.message : String(err);
    issues = [
      {
        severity: 'error',
        rule: LINT_CRASHED_RULE,
        message:
          `The lint rubric did not run: ${lintError}. This verdict covers the schema ` +
          `parse only — no lint verdict was produced, so it must not be read as a clean one.`,
        path: '(lint)',
      },
    ];
  }

  const errors = bySeverity(issues, 'error');
  const warnings = bySeverity(issues, 'warning');
  const suggestions = bySeverity(issues, 'suggestion');

  const penalty =
    schemaErrors.length * SCORE_WEIGHTS.schemaError +
    errors.length * SCORE_WEIGHTS.error +
    warnings.length * SCORE_WEIGHTS.warning +
    suggestions.length * SCORE_WEIGHTS.suggestion;

  // A rubric that did not run has no score to report. 0 / `F` is not a penalty
  // dressed up as a measurement — it is the refusal, and it is the shape the
  // eval harness already uses for "there was nothing to judge".
  const score = lintError !== undefined ? 0 : Math.max(0, Math.min(100, 100 - penalty));

  return {
    score: Math.round(score),
    valid: schemaErrors.length === 0 && errors.length === 0,
    grade: gradeFor(score),
    counts: {
      schemaErrors: schemaErrors.length,
      errors: errors.length,
      warnings: warnings.length,
      suggestions: suggestions.length,
    },
    schemaErrors,
    issues,
    ...(lintError !== undefined ? { lintError } : {}),
  };
}
