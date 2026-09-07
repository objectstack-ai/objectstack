// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `EvaluatedExpressionSchema` — an Expression envelope in an EVALUATED slot
 * requires what the engine can actually evaluate (#15430).
 *
 * `ExpressionSchema` is the persistence contract: `source` OR `ast`, either
 * one. The CEL engine evaluates `source` only (its `evaluate` refuses an
 * `ast`-only envelope: "AST-only evaluation not yet supported; persist
 * `source`"), and parses `source` untrimmed, so two shapes the persistence
 * contract accepts validate, register, and fault at run time — or, in a
 * predicate, answer `false` silently. The evaluated sibling refuses both at
 * authoring with ONE rule and one message at `source`.
 *
 * Reproduction pins, one per spelling, each asserting the issue's `code`,
 * `path` and message — never `success === false` alone. The control is the
 * persistence contract itself: `ExpressionSchema` still ACCEPTS both shapes,
 * because it was not narrowed.
 */

import { describe, expect, it } from 'vitest';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  EvaluatedExpressionSchema,
  ExpressionSchema,
  type EvaluatedExpression,
} from './expression.zod.js';

const AST_ONLY = { dialect: 'cel', ast: { kind: 'const', value: 1 } };
const BLANK_SOURCE = { dialect: 'cel', source: '   ' };
const GOOD = { dialect: 'cel', source: 'record.amount > 1' };

function issuesOf(value: unknown) {
  const result = EvaluatedExpressionSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));
}

describe('EvaluatedExpressionSchema — an evaluated slot requires a non-blank `source` (#15430)', () => {
  it('REFUSES an `ast`-only envelope: one issue, at `source`, the published sentence', () => {
    expect(issuesOf(AST_ONLY)).toEqual([
      { code: 'invalid_type', path: 'source', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
  });

  it.each([
    ['three spaces', '   '],
    ['a tab and a newline', '\t\n'],
    ['the empty string', ''],
  ])('REFUSES a `source` that is blank after trimming (%s): one issue, at `source`, the same sentence', (_label, source) => {
    expect(issuesOf({ dialect: 'cel', source })).toEqual([
      { code: 'custom', path: 'source', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
  });

  it('ONE rule — both spellings carry the same message, and the message names what the engine needs and why', () => {
    const [astIssue] = issuesOf(AST_ONLY);
    const [blankIssue] = issuesOf(BLANK_SOURCE);
    expect(astIssue!.message).toBe(blankIssue!.message);
    expect(EVALUATED_EXPRESSION_SOURCE_REQUIRED).toContain('non-blank `source`');
    expect(EVALUATED_EXPRESSION_SOURCE_REQUIRED).toContain('cannot evaluate `ast` alone');
    expect(EVALUATED_EXPRESSION_SOURCE_REQUIRED).toContain("{ dialect: 'cel', source: '…' }");
  });

  it('the notion of blank is the engine\'s own — `.trim()` — so a source with inner whitespace is authored', () => {
    // A source that trims to something is a source; the engine trims the same way.
    expect(EvaluatedExpressionSchema.safeParse({ dialect: 'cel', source: '  record.amount > 1  ' }).success).toBe(true);
    expect(EvaluatedExpressionSchema.safeParse({ dialect: 'cel', source: '\n1\n' }).success).toBe(true);
  });

  it('ACCEPTS a well-formed envelope unchanged — `source` plus `ast`, `meta`, every dialect', () => {
    const parsed = EvaluatedExpressionSchema.safeParse(GOOD);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(GOOD);
    // `ast` beside a source is fine: the engine still has what it evaluates.
    expect(EvaluatedExpressionSchema.safeParse({ ...GOOD, ast: { kind: 'x' }, meta: { rationale: 'r' } }).success).toBe(true);
    for (const dialect of ['cron', 'template']) {
      expect(EvaluatedExpressionSchema.safeParse({ dialect, source: 'x' }).success).toBe(true);
    }
  });

  it('keeps `ExpressionSchema`\'s own rules — a dialect outside the enum is still refused there', () => {
    const issues = issuesOf({ dialect: 'js', source: '1 + 1' });
    expect(issues.map((i) => i.path)).toEqual(['dialect']);
  });

  it('CONTROL — `ExpressionSchema`, the persistence contract, still ACCEPTS both shapes (it is not narrowed)', () => {
    expect(ExpressionSchema.safeParse(AST_ONLY).success).toBe(true);
    expect(ExpressionSchema.safeParse(BLANK_SOURCE).success).toBe(true);
    // And still refuses what it always refused: neither `source` nor `ast`.
    expect(ExpressionSchema.safeParse({ dialect: 'cel' }).success).toBe(false);
  });

  it('narrows the TYPE too: `source` is required on `EvaluatedExpression`, so an `ast`-only envelope is a compile error', () => {
    const ok: EvaluatedExpression = { dialect: 'cel', source: 'x' };
    // @ts-expect-error — `source` is required in an evaluated slot; `ast` alone is not evaluable.
    const astOnly: EvaluatedExpression = { dialect: 'cel', ast: {} };
    expect([ok, astOnly]).toHaveLength(2);
  });
});
