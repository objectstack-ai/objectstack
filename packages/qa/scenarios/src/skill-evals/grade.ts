// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The grader the cases already declare, applied mechanically: an answer
 * passes when every `must_contain` token appears in it and no
 * `must_not_contain` token does. A token is matched as a literal,
 * case-sensitive substring of the answer text — the tokens are code
 * spellings (`$icontains`, `engine.find('account'`), where case is meaning.
 * No model judges an answer, and nothing is normalised.
 */

export interface GradeAssertions {
  mustContain: readonly string[];
  mustNotContain: readonly string[];
}

export interface GradeResult {
  pass: boolean;
  /** `must_contain` tokens the answer lacks, in the case's order. */
  missing: string[];
  /** `must_not_contain` tokens the answer carries, in the case's order. */
  forbidden: string[];
}

export type Grader = (answer: string, assertions: GradeAssertions) => GradeResult;

export const gradeAnswer: Grader = (answer, { mustContain, mustNotContain }) => {
  const missing = mustContain.filter((t) => !answer.includes(t));
  const forbidden = mustNotContain.filter((t) => answer.includes(t));
  return { pass: missing.length === 0 && forbidden.length === 0, missing, forbidden };
};
