// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FlowEdgeSchema.condition` is an EVALUATED slot (#15807) — it composes
 * `EvaluatedExpressionInputSchema`, so an envelope the engine cannot evaluate
 * is refused at authoring instead of answering a silent `false` at run time.
 *
 * Before this, the slot was `ExpressionInputSchema` — the persistence contract,
 * `source` OR `ast` — and `AutomationEngine.evaluateCondition` reads
 * `expression.source ?? ''`: an `ast`-only envelope landed in the empty-source
 * arm and the branch quietly never fired (measured on #15430: `{ dialect:
 * 'cel', ast: { kind: 'const', value: true } }` answered `false`; registration
 * said nothing). A whitespace-only `source` was the same seam through the
 * other key.
 *
 * Reproduction pins, one per spelling, each asserting the issue's `code`,
 * `path` and message — never `success === false` alone. The controls are the
 * persistence contract (`ExpressionInputSchema` / `ExpressionSchema` still
 * ACCEPT both shapes, because they were not narrowed) and the accepted
 * envelope, byte-identical to what it parsed to before.
 */

import { describe, expect, it } from 'vitest';

import {
  EVALUATED_EXPRESSION_SOURCE_REQUIRED,
  EvaluatedExpressionInputSchema,
  ExpressionInputSchema,
  ExpressionSchema,
} from '../shared/expression.zod.js';
import { FlowEdgeSchema, FlowSchema, type FlowEdge } from './flow.zod.js';

const AST_ONLY = { dialect: 'cel', ast: { kind: 'const', value: true } };
const BLANK_SOURCE = { dialect: 'cel', source: '   ' };
const GOOD = { dialect: 'cel', source: 'record.amount > 1' };

const edge = (condition: unknown) => ({ id: 'e1', source: 'a', target: 'b', condition });

function issuesOf(value: unknown) {
  const result = FlowEdgeSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));
}

describe('FlowEdgeSchema.condition — an evaluated slot requires a non-blank `source` (#15807)', () => {
  it('REFUSES an `ast`-only envelope: one issue at `condition`, the published sentence', () => {
    // Both union arms abort on this shape (the envelope arm's missing `source`
    // is an aborting `invalid_type`), so it surfaces as the union's own issue
    // at the slot, worded by the union's error map — measured, zod 4.4.
    expect(issuesOf(edge(AST_ONLY))).toEqual([
      { code: 'invalid_union', path: 'condition', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
    // With no dialect either — the envelope `evaluateCondition` reads as CEL.
    expect(issuesOf(edge({ ast: { kind: 'const', value: true } }))).toEqual([
      { code: 'invalid_union', path: 'condition', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
  });

  it.each([
    ['three spaces', '   '],
    ['a tab and a newline', '\t\n'],
    ['the empty string', ''],
  ])('REFUSES an envelope whose `source` is blank after trimming (%s): one issue at `condition.source`', (_label, source) => {
    // The envelope arm refuses this one WITHOUT aborting (a `custom` refine),
    // so the union reports that arm's issue, at the key the author wrote.
    expect(issuesOf(edge({ dialect: 'cel', source }))).toEqual([
      { code: 'custom', path: 'condition.source', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
  });

  it.each([
    ['three spaces', '   '],
    ['a tab and a newline', '\t\n'],
    ['the empty string', ''],
  ])('REFUSES a bare string that is blank after trimming (%s) — the shorthand cannot smuggle the blank `source` in', (_label, source) => {
    // Under `ExpressionInputSchema` a whitespace-only string normalized to
    // `{ dialect: 'cel', source: '   ' }` — exactly the envelope the evaluated
    // rule refuses — so the string arm applies the same trim.
    expect(issuesOf(edge(source))).toEqual([
      { code: 'invalid_union', path: 'condition', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
  });

  it('ONE rule — every refused spelling carries the same sentence, and it names what the engine needs and why', () => {
    const messages = [AST_ONLY, BLANK_SOURCE, '   '].map((c) => issuesOf(edge(c))[0]!.message);
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    expect(EVALUATED_EXPRESSION_SOURCE_REQUIRED).toContain('cannot evaluate `ast` alone');
  });

  it('does NOT blame `source` for a refusal that is not about it — the map yields to zod\'s default there', () => {
    // A number is neither arm's business; a `dialect` outside the enum is the
    // enum's refusal. Neither is the evaluated-slot rule, so neither gets its
    // sentence (the union's error map returns `undefined` and the default
    // stands) — otherwise every malformed edge would prescribe "write a
    // `source`" for a defect a `source` would not fix.
    for (const value of [42, { dialect: 'js', source: 'x' }]) {
      const [issue] = issuesOf(edge(value));
      expect(issue!.code).toBe('invalid_union');
      expect(issue!.path).toBe('condition');
      expect(issue!.message).not.toBe(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    }
  });

  it('ACCEPTS a well-formed envelope unchanged — `source` plus `ast`, `meta`, inner whitespace', () => {
    const parsed = FlowEdgeSchema.safeParse(edge(GOOD));
    expect(parsed.success).toBe(true);
    expect(parsed.data!.condition).toEqual(GOOD);
    // `ast` beside a `source` is fine: the engine still has what it evaluates.
    const withAst = { ...GOOD, ast: { kind: 'x' }, meta: { rationale: 'r' } };
    expect(FlowEdgeSchema.safeParse(edge(withAst)).data!.condition).toEqual(withAst);
    // The notion of blank is the engine's own (`.trim()`): inner whitespace is authored.
    expect(FlowEdgeSchema.safeParse(edge({ dialect: 'cel', source: '  record.amount > 1  ' })).success).toBe(true);
  });

  it('still normalizes the bare-string shorthand to `{ dialect: \'cel\', source }`', () => {
    expect(FlowEdgeSchema.safeParse(edge('record.amount > 1')).data!.condition)
      .toEqual({ dialect: 'cel', source: 'record.amount > 1' });
    // An absent condition is still "unconditional", not a refused one.
    const { condition, ...unconditional } = edge(undefined);
    expect(FlowEdgeSchema.safeParse(unconditional).success).toBe(true);
    expect(condition).toBeUndefined();
  });

  it('is refused at the same path through `FlowSchema`, where `registerFlow` parses', () => {
    const result = FlowSchema.safeParse({
      name: 'gate_flow',
      nodes: [
        { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
        { id: 'end', type: 'end' },
      ],
      edges: [edge(AST_ONLY)],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }))).toEqual([
      { code: 'invalid_union', path: 'edges.0.condition', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED },
    ]);
  });

  it('CONTROL — `ExpressionInputSchema` and `ExpressionSchema`, the persistence contract, still ACCEPT both shapes', () => {
    expect(ExpressionInputSchema.safeParse(AST_ONLY).success).toBe(true);
    expect(ExpressionInputSchema.safeParse(BLANK_SOURCE).success).toBe(true);
    expect(ExpressionInputSchema.safeParse('   ').success).toBe(true);
    expect(ExpressionSchema.safeParse(AST_ONLY).success).toBe(true);
    expect(ExpressionSchema.safeParse(BLANK_SOURCE).success).toBe(true);
  });

  it('narrows the TYPE too: an `ast`-only edge condition is a compile error before it is a parse error', () => {
    const ok: FlowEdge = edge(GOOD) as FlowEdge;
    const shorthand: FlowEdge = { id: 'e1', source: 'a', target: 'b', condition: 'record.amount > 1' };
    // @ts-expect-error — `source` is required in an evaluated slot; `ast` alone is not evaluable.
    const astOnly: FlowEdge = { id: 'e1', source: 'a', target: 'b', condition: { dialect: 'cel', ast: {} } };
    expect([ok, shorthand, astOnly]).toHaveLength(3);
  });
});

describe('EvaluatedExpressionInputSchema — the sibling of ExpressionInputSchema for an evaluated slot (#15807)', () => {
  const direct = (value: unknown) => {
    const r = EvaluatedExpressionInputSchema.safeParse(value);
    return r.success
      ? { ok: true as const, data: r.data }
      : { ok: false as const, issues: r.error.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message })) };
  };

  it('string arm: non-blank normalizes; blank is refused with the published sentence', () => {
    expect(direct('record.amount > 1')).toEqual({ ok: true, data: { dialect: 'cel', source: 'record.amount > 1' } });
    expect(direct('   ')).toEqual({ ok: false, issues: [{ code: 'invalid_union', path: '', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED }] });
  });

  it('envelope arm: composes EvaluatedExpressionSchema — `ast`-only refused, blank `source` refused at `source`', () => {
    expect(direct(AST_ONLY)).toEqual({ ok: false, issues: [{ code: 'invalid_union', path: '', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED }] });
    expect(direct(BLANK_SOURCE)).toEqual({ ok: false, issues: [{ code: 'custom', path: 'source', message: EVALUATED_EXPRESSION_SOURCE_REQUIRED }] });
    expect(direct(GOOD)).toEqual({ ok: true, data: GOOD });
    // Every declared dialect is still admitted in envelope form — this is the
    // untyped input, narrowed on `source` only, not a typed (cron / template) slot.
    for (const dialect of ['cron', 'template']) expect(direct({ dialect, source: 'x' }).ok).toBe(true);
  });
});
