// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reason-carrying sister entrance (#6132).
 *
 * `parseCelToAst` collapses "not valid CEL" and "valid CEL, over the platform's
 * budget" into one `null`. `parseCelToAstWithReason` separates them and names
 * the bound. These tests pin the identity of that answer — WHICH limit, its
 * platform value, and what the source measures — because the consumer built on
 * it (the RLS / sharing pushdown path) fails closed on a refusal, and a refusal
 * that says "parse error" about a well-formed 431-node predicate sends the
 * author hunting a typo that does not exist.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIMITS,
  celEngine,
  parseCelToAst,
  parseCelToAstWithReason,
} from './cel-engine';

/** 300-term addition — the `maxAstNodes` shape measured on the issue. */
const OVER_AST_NODES = Array.from({ length: 300 }, (_, i) => String(i)).join(' + ');
/** 60-level parenthesis nest — the `maxDepth` shape. */
const OVER_DEPTH = `${'('.repeat(60)}record.a == 1${')'.repeat(60)}`;
/** 200-element list literal — the `maxListElements` shape. */
const OVER_LIST = `record.id in [${Array.from({ length: 200 }, (_, i) => `'u${i}'`).join(',')}]`;

describe('parseCelToAstWithReason — the ok path is `parseCelToAst`, unchanged', () => {
  const WITHIN = [
    "record.region == 'EMEA'",
    'record.owner_id == current_user.id',
    "record.stage in ['a', 'b']",
    'record.closed_at != null',
    "record.name.startsWith('A')",
    // AT the bound, both axes — admitted, not refused.
    `record.id in [${Array.from({ length: DEFAULT_LIMITS.maxListElements }, (_, i) => `'u${i}'`).join(',')}]`,
  ];

  for (const source of WITHIN) {
    it(`admits: ${source.slice(0, 48)}`, () => {
      const parsed = parseCelToAstWithReason(source);
      expect(parsed.ok).toBe(true);
      // Same AST object identity contract as the null-collapsing entry.
      expect(parsed.ok && parsed.ast).toEqual(parseCelToAst(source));
    });
  }

  it('a blank source is `empty`, not a syntax fault', () => {
    expect(parseCelToAstWithReason('   ')).toEqual({ ok: false, kind: 'empty', message: 'empty expression' });
    expect(parseCelToAst('   ')).toBeNull();
  });

  it('a genuine syntax fault is `parse`, and carries cel-js\'s message', () => {
    const parsed = parseCelToAstWithReason('record.stage ==');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.kind).toBe('parse');
    expect(parsed.ok === false && parsed.kind === 'parse' && parsed.message.length).toBeGreaterThan(0);
  });
});

describe('parseCelToAstWithReason — a bounds overrun NAMES its bound', () => {
  const CASES = [
    { name: 'maxAstNodes', source: OVER_AST_NODES, limit: 'maxAstNodes' as const },
    { name: 'maxDepth', source: OVER_DEPTH, limit: 'maxDepth' as const },
    { name: 'maxListElements', source: OVER_LIST, limit: 'maxListElements' as const },
  ];

  for (const { name, source, limit } of CASES) {
    it(`${name}: kind is 'bounds', not 'parse', and the limit is named`, () => {
      const parsed = parseCelToAstWithReason(source);
      expect(parsed.ok).toBe(false);
      if (parsed.ok || parsed.kind !== 'bounds') throw new Error(`expected bounds, got ${JSON.stringify(parsed)}`);
      expect(parsed.overrun.limit).toBe(limit);
      expect(parsed.overrun.limitValue).toBe(DEFAULT_LIMITS[limit]);
      expect(parsed.overrun.summary).toBe(`Exceeded ${limit} (${DEFAULT_LIMITS[limit]})`);
      // No measurement, and no unbounded AST, unless the caller asks — a bounds
      // REFUSAL must not re-parse the source it has just declared too big.
      expect(parsed.overrun.measured).toBeNull();
      expect(parsed.unboundedAst).toBeNull();
    });

    it(`${name}: with { admitOverLimit } it measures the source and yields an AST`, () => {
      const parsed = parseCelToAstWithReason(source, { admitOverLimit: true });
      if (parsed.ok || parsed.kind !== 'bounds') throw new Error(`expected bounds, got ${JSON.stringify(parsed)}`);
      expect(parsed.unboundedAst).not.toBeNull();
      // The measure is cel-js's own accounting: the SMALLEST bound the source
      // parses under. So it is strictly over the platform's bound, and parsing
      // at exactly that value succeeds while one less fails.
      const measured = parsed.overrun.measured;
      expect(measured).not.toBeNull();
      expect(measured as number).toBeGreaterThan(DEFAULT_LIMITS[limit]);
    });
  }

  it('the measured value for the 200-element list is exactly 200', () => {
    const parsed = parseCelToAstWithReason(OVER_LIST, { admitOverLimit: true });
    if (parsed.ok || parsed.kind !== 'bounds') throw new Error('expected bounds');
    expect(parsed.overrun.measured).toBe(200);
  });

  it('`parseCelToAst` still collapses every refusal to `null` — the #4812 contract is untouched', () => {
    for (const source of [OVER_AST_NODES, OVER_DEPTH, OVER_LIST, 'record.stage ==', '   ']) {
      expect(parseCelToAst(source)).toBeNull();
    }
  });
});

describe('parseCelToAstWithReason composes with the by-code classification (#6223)', () => {
  /**
   * The sister entrance grades the fault through the SAME `classifyCelFault`
   * `celEngine.compile` uses — error class plus structured `code`, never prose.
   * This pins that the two answer the same thing about the same source, so the
   * fresh by-code table cannot be re-graded from one side only.
   */
  it('a bounds overrun is `bounds` on BOTH entrances, with the same summary', () => {
    for (const source of [OVER_AST_NODES, OVER_DEPTH, OVER_LIST]) {
      const compiled = celEngine.compile(source);
      const parsed = parseCelToAstWithReason(source);
      if (compiled.ok) throw new Error('expected compile to refuse');
      if (parsed.ok || parsed.kind !== 'bounds') throw new Error('expected bounds');
      expect(compiled.error.kind).toBe('bounds');
      expect(compiled.error.message).toContain(parsed.overrun.summary);
    }
  });

  it('a syntax fault is `parse` on BOTH entrances', () => {
    const compiled = celEngine.compile('record.stage ==');
    const parsed = parseCelToAstWithReason('record.stage ==');
    expect(compiled.ok === false && compiled.error.kind).toBe('parse');
    expect(parsed.ok === false && parsed.kind).toBe('parse');
  });

  /**
   * The #6223 hazard in one assertion: a field name that spells a bounds
   * message must not be read as one. The grading is by `code`, so it isn't.
   */
  it('an author-controlled name that spells a bounds message is NOT graded bounds', () => {
    const parsed = parseCelToAstWithReason('record.Exceeded_maxAstNodes ==');
    expect(parsed.ok === false && parsed.kind).toBe('parse');
  });
});
