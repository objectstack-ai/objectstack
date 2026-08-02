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
  let issues: LintIssue[] = [];
  try {
    issues = lintConfig(normalized) as LintIssue[];
  } catch {
    // A linter crash shouldn't mask the schema verdict — treat as no lint data.
    issues = [];
  }

  const errors = bySeverity(issues, 'error');
  const warnings = bySeverity(issues, 'warning');
  const suggestions = bySeverity(issues, 'suggestion');

  const penalty =
    schemaErrors.length * SCORE_WEIGHTS.schemaError +
    errors.length * SCORE_WEIGHTS.error +
    warnings.length * SCORE_WEIGHTS.warning +
    suggestions.length * SCORE_WEIGHTS.suggestion;

  const score = Math.max(0, Math.min(100, 100 - penalty));

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
  };
}
