// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4812 — `parseCelToAst` is the canonical parse-to-AST entry: the ONE answer in
// this repo to "what parses". These tests pin it against `celEngine.compile`,
// which is the entry the runtime actually uses, in both directions — what both
// accept, what both reject, and the one asymmetry that is deliberate.
//
// They also pin the two things a consumer silently opts out of by building its
// own `new Environment(...)` instead: the #3306 nullable-ternary rewrite, and
// `DEFAULT_LIMITS`. `@objectstack/lint`'s null-guard pass did exactly that until
// #4812 — and it was the *bounds* it diverged on, so a bare-env comparison is
// asserted here rather than described.

import { Environment } from '@marcbachmann/cel-js';
import { describe, expect, it } from 'vitest';

import { celEngine, parseCelToAst, DEFAULT_LIMITS } from './cel-engine';

/**
 * A bare cel-js environment — byte-for-byte the one `validate-null-guards.ts`
 * built for itself before #4812, and the shape any consumer naturally reaches
 * for. Its only difference from the canonical env is what it does NOT carry:
 * no `limits`, no stdlib, no rewrite.
 */
const bareEnv = new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true });
const bareParses = (source: string): boolean => {
  try {
    bareEnv.parse(source);
    return true;
  } catch {
    return false;
  }
};

/** Sources the platform accepts — drawn from the shapes this package's own suites use. */
const ACCEPTED = [
  'record.amount > 1000',
  'record.end_date < record.start_date',
  'record.start_date != null && record.end_date != null && record.end_date < record.start_date',
  'has(record.start_date) && record.start_date < record.end_date',
  '"manager" in os.user.positions',
  'record.rating >= 4',
  'record.end_date <= daysFromNow(60)',
  'daysBetween(record.start_date, record.end_date) + 1',
  'record.budget == null || record.budget > 100',
  '!isBlank(record.owner) && record.owner != record.creator',
  'record.status == "open" ? record.amount * 0.1 : null',
  'true ? 5 : null',
  'size(record.items) > 0',
  '[1, 2, 3].all(x, x > 0)',
  'record.?owner.orValue("none") == "none"',
];

/** Sources the platform rejects at PARSE — syntax faults, in both entries. */
const SYNTAX_REJECTED = [
  'record.budget >',
  'record.a $$ 1',
  'record.a ?? 3', // cel-js 8 has no `??`
  '((record.a)',
];

/**
 * The comparable content of a cel-js AST: `op` plus `args`, recursively.
 *
 * A raw deep-equal cannot be used here. `compile()` runs cel-js's `check()`,
 * which decorates every node IN PLACE with an entire evaluation plan — measured
 * on `record.amount > 1000`, the root gains `left`, `right`, `candidates`,
 * `handle` (a bound function), `rightStaticType` and `checkedType`, and
 * `candidates.registry` points back at the Environment, so the decorated tree is
 * circular. `parseCelToAst` is parse-only and carries none of it.
 *
 * `op` + `args` is also exactly the surface every AST consumer in this repo
 * walks (`lowerCelAst`, `collectCelRootIdentifiers`, lint's null-guard pass), so
 * equality on this projection is the claim that matters: the two entries hand a
 * consumer the same tree.
 */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value && typeof value === 'object' && typeof (value as { op?: unknown }).op === 'string') {
    return { op: (value as { op: string }).op, args: shapeOf((value as { args: unknown }).args) };
  }
  // Leaves: identifier / member / function-name strings and literal values
  // (including the BigInts cel-js produces for `int`).
  return value;
}

/** Sources that parse but do NOT type-check — the deliberate asymmetry. */
const PARSES_BUT_FAILS_CHECK = [
  '1 + "x"',
  'NOPE(record.a) > 1',
  'record.a.NOPE()',
];

/** Over the platform's bounds — the divergence a bare env does not see. */
const OVER_BOUNDS: Record<string, string> = {
  maxAstNodes: Array.from({ length: 300 }, (_, i) => `record.f${i}`).join(' + '),
  maxDepth: '('.repeat(60) + 'record.a' + ')'.repeat(60),
  maxListElements: `[${Array.from({ length: 200 }, (_, i) => i).join(',')}].size() > 0`,
};

describe('parseCelToAst — parity with celEngine.compile (#4812)', () => {
  it.each(ACCEPTED)('returns the SAME ast compile() returns: %s', (source) => {
    const compiled = celEngine.compile(source);
    expect(compiled.ok).toBe(true);
    const ast = parseCelToAst(source);
    expect(ast).not.toBeNull();
    // `compile()` builds a FRESH env per call; `parseCelToAst` memoizes one.
    // Deep equality here is what pins that memo as equivalent — if the two ever
    // drift (a rewrite applied on one side, a limit on the other), this fails.
    expect(shapeOf(ast)).toEqual(
      shapeOf(compiled.ok ? compiled.value : undefined),
    );
  });

  it.each(SYNTAX_REJECTED)('rejects exactly what compile() rejects at parse: %s', (source) => {
    // The parity claim is the accept/reject verdict itself. `compile`'s error
    // *classification* is asserted separately below, and is now independent of
    // wording: `classifyError` reads the thrown error's TYPE (`instanceof
    // ParseError`), not its phrasing — the keyword table it used to consult was
    // closed for parse faults by #6133 / PR #6202 and deleted outright by
    // #6223 / PR #6677.
    expect(parseCelToAst(source)).toBeNull();
    expect(celEngine.compile(source).ok).toBe(false);
  });

  it('yields a plain parse tree, while compile() yields a type-ANNOTATED one', () => {
    // The concrete difference between "parse" and "parse + check", pinned so the
    // two entries are not mistaken for interchangeable. A consumer walking
    // `.op`/`.args` sees the same tree from either; only `compile()` has run the
    // type checker over it.
    const source = 'record.amount > 1000';
    const compiled = celEngine.compile(source);
    expect(compiled.ok).toBe(true);
    expect(compiled.ok && (compiled.value as { checkedType?: unknown }).checkedType).toBeDefined();
    expect((parseCelToAst(source) as unknown as { checkedType?: unknown }).checkedType).toBeUndefined();
  });

  // Both wordings, because the pair used to disagree and the disagreement was
  // the whole point of this test. cel-js phrases a dangling operator as
  // `Unexpected token: EOF` and an unbalanced delimiter as `Expected RPAREN,
  // got EOF` (both measured on cel-js 8.0.0, unchanged); when `classifyError`
  // matched /parse|unexpected|syntax/i the second wording missed every keyword
  // and a genuine syntax fault reached the author graded `runtime`. #6133 /
  // PR #6202 replaced that arm with `err instanceof ParseError`, so the grade no
  // longer depends on which of the two an author happens to write.
  //
  // The exhaustive per-wording matrix lives in `cel-error-classification.test.ts`
  // (#6133); these two are pinned HERE because this suite's `SYNTAX_REJECTED`
  // list is what claims they are parse faults, and a list that says `parse`
  // while the engine says otherwise is the drift #6678 was filed for.
  it.each([
    ['dangling operator', 'record.budget >'],
    ['unbalanced delimiter', '((record.a)'],
  ])('classifies a %s as `parse`', (_label, source) => {
    const compiled = celEngine.compile(source);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.error.kind).toBe('parse');
  });

  it.each(PARSES_BUT_FAILS_CHECK)(
    'still yields an AST for a source that parses but fails check(): %s',
    (source) => {
      // The asymmetry is deliberate and load-bearing: `parseCelToAst` is parse
      // ONLY, `compile()` is parse + check. A consumer analysing an AST (the
      // null-guard pass, the pushdown compiler) must not be denied one just
      // because cel-js cannot type an expression over `dyn` operands — and a
      // caller who wants the type verdict asks `compile()`. Asserted so that
      // nobody "tightens" this entry into a second compile().
      expect(parseCelToAst(source)).not.toBeNull();
      const compiled = celEngine.compile(source);
      expect(compiled.ok).toBe(false);
      if (!compiled.ok) expect(compiled.error.kind).toBe('type');
    },
  );

  it('never throws, and answers null for an empty source', () => {
    expect(parseCelToAst('')).toBeNull();
    expect(parseCelToAst('   ')).toBeNull();
    expect(parseCelToAst(undefined as unknown as string)).toBeNull();
    expect(parseCelToAst(null as unknown as string)).toBeNull();
  });
});

describe('parseCelToAst — carries the #3306 nullable-ternary rewrite', () => {
  // `true ? 5 : null` is the specimen: it PARSES in any env, but cel-js's
  // ternary unifier rejects it at check ("Ternary branches must have the same
  // type, got 'int' and 'null'"), so without the rewrite the blessed
  // `guard ? value : null` shape does not compile. The rewrite wraps the
  // non-null branch in `dyn(...)`, which is what makes it legal — and it is the
  // AST the runtime executes. An entry that skipped the rewrite would hand a
  // consumer a DIFFERENT tree from the one the platform runs.
  it('wraps the non-null branch in dyn(...), matching what the runtime executes', () => {
    const ast = parseCelToAst('true ? 5 : null') as unknown as {
      op: string;
      args: [unknown, { op: string; args: [string, unknown[]] }, unknown];
    };
    expect(ast).not.toBeNull();
    expect(ast.op).toBe('?:');
    expect(ast.args[1].op).toBe('call');
    expect(ast.args[1].args[0]).toBe('dyn');
  });

  it('agrees with compile() on the rewritten shape, which only compile() could evaluate', () => {
    const source = 'record.status == "open" ? record.amount * 0.1 : null';
    const compiled = celEngine.compile(source);
    expect(compiled.ok).toBe(true);
    expect(shapeOf(parseCelToAst(source))).toEqual(
      shapeOf(compiled.ok ? compiled.value : undefined),
    );
  });

  it('cannot change WHETHER a source parses — only the AST it yields', () => {
    // Stated as a test because it is the fact that makes #4812's originally
    // suspected hole ("formula rewrites something bare cel-js cannot parse, so
    // lint silently skips it") impossible by construction: the rewrite parses
    // the source FIRST and returns it unchanged on failure. Every source below
    // therefore gets the same accept/reject verdict from both entries.
    for (const source of [...ACCEPTED, ...PARSES_BUT_FAILS_CHECK]) {
      expect(bareParses(source)).toBe(true);
      expect(parseCelToAst(source)).not.toBeNull();
    }
    for (const source of SYNTAX_REJECTED) {
      expect(bareParses(source)).toBe(false);
      expect(parseCelToAst(source)).toBeNull();
    }
  });
});

describe('parseCelToAst — carries the platform bounds (the real #4812 divergence)', () => {
  it.each(Object.entries(OVER_BOUNDS))(
    'refuses a source over %s, which a bare env happily parses',
    (_limit, source) => {
      // This is the measured divergence, in the direction it actually runs: a
      // consumer with its own limitless env parses — and then reasons about — a
      // predicate the platform rejects outright. Both halves asserted, so the
      // test states the divergence rather than merely benefiting from its fix.
      expect(bareParses(source)).toBe(true);
      expect(parseCelToAst(source)).toBeNull();

      const compiled = celEngine.compile(source);
      expect(compiled.ok).toBe(false);
      if (!compiled.ok) {
        expect(compiled.error.kind).toBe('bounds');
        expect(compiled.error.message).toMatch(/Exceeded max/i);
      }
    },
  );

  it('pins the bounds the entry enforces to DEFAULT_LIMITS', () => {
    // If DEFAULT_LIMITS moves, the fixtures above must move with it; this
    // assertion is the tripwire that says so out loud.
    expect(DEFAULT_LIMITS.maxAstNodes).toBe(256);
    expect(DEFAULT_LIMITS.maxDepth).toBe(32);
    expect(DEFAULT_LIMITS.maxListElements).toBe(64);
  });
});
