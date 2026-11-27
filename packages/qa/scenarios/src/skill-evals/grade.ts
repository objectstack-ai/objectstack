// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The grader the cases already declare, applied mechanically: an answer
 * passes when every `must_contain` token appears in it, every
 * `must_contain_any` group has at least one of its tokens in it, and no
 * `must_not_contain` token does. A token is matched as a literal,
 * case-sensitive substring of the answer text — the tokens are code
 * spellings (`$icontains`, `engine.find('account'`), where case is meaning.
 * No model judges an answer, and nothing is normalised.
 *
 * The any-of form is for a case whose correct answers do not share one
 * literal: each group lists the spellings a correct answer may use for one
 * thing, and the groups are all required, so `[[a, b], [c]]` reads
 * "(`a` or `b`) and `c`".
 */

export interface GradeAssertions {
  mustContain: readonly string[];
  mustNotContain: readonly string[];
  /** `must_contain_any` groups; absent ⇒ none. */
  mustContainAny?: ReadonlyArray<readonly string[]>;
}

export interface GradeResult {
  pass: boolean;
  /** `must_contain` tokens the answer lacks, in the case's order. */
  missing: string[];
  /** `must_not_contain` tokens the answer carries, in the case's order. */
  forbidden: string[];
  /**
   * `must_contain_any` groups with none of their tokens in the answer, each
   * group whole and in the case's order. Present only when a group is unmet.
   */
  unmetAny?: string[][];
}

export type Grader = (answer: string, assertions: GradeAssertions) => GradeResult;

export const gradeAnswer: Grader = (answer, { mustContain, mustNotContain, mustContainAny = [] }) => {
  const missing = mustContain.filter((t) => !answer.includes(t));
  const forbidden = mustNotContain.filter((t) => answer.includes(t));
  const unmetAny = mustContainAny.filter((group) => !group.some((t) => answer.includes(t))).map((group) => [...group]);
  return { pass: missing.length === 0 && forbidden.length === 0 && unmetAny.length === 0, missing, forbidden, ...(unmetAny.length ? { unmetAny } : {}) };
};
