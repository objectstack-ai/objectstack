// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the CLOSED refinement projection (#18670 item 2) — the change that makes
 * `packages/spec/json-schema/**` state rules it used to leave to the runtime.
 *
 * ## The one claim every case here serves
 *
 * The published file NARROWS toward what the runtime already refuses, and ⛔ no
 * document the runtime ACCEPTS becomes refused. That is not a direction to
 * assert — for each arm the two sides are EXACTLY equal, and the equality is
 * what is measured:
 *
 *   - `required-one-of` — over the whole key-presence lattice, and with a
 *     present-but-`null` value, which is the one JSON shape where "present" and
 *     "not undefined" could have come apart.
 *   - `non-blank-string` — over every ECMA-262 WhiteSpace and LineTerminator
 *     code point, each alone (both sides refuse) and each embedded beside a
 *     letter (both sides accept). `String.prototype.trim` removes exactly that
 *     set and `\S` is its complement, so the pin is the whole argument; JSON
 *     Schema specifies `pattern` as an ECMA-262 regex, which is the same engine
 *     this assertion runs on.
 *
 * ## Why an equality pin and not a comment
 *
 * `src/shared/refinement-projection.ts` builds each predicate FROM its
 * declaration wherever it can (`requiredOneOf` reads one key array twice), so
 * that arm cannot drift. `non-blank-string` cannot be derived that way — a
 * `.trim()` and a regex are two spellings of one set, not one spelling used
 * twice — so the equivalence is pinned here instead, and an edit to either side
 * fails rather than publishes a contract nothing enforces.
 *
 * ## And why the detector is pinned beside it
 *
 * The ledger's use is that a row deletion is the observable proof a site
 * closed. That only holds while `dropped-refinements.ts` measures the
 * GENERATOR's projection rather than a bare one, so both halves of that
 * coupling are asserted: a declared refinement reads `projected`, an undeclared
 * one on the same shape still reads `dropped`.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  NON_BLANK_PATTERN,
  NON_BLANK_STRING,
  PROJECTABLE_REFINEMENT_PATTERNS,
  projectableRefinementOf,
  requiredOneOf,
} from '../src/shared/refinement-projection';
import {
  emitProjectableRefinement,
  projectableRefinementsOf,
  refinementProjectionOverride,
} from './lib/refinement-projection';
import { collectDroppedRefinements } from './lib/dropped-refinements';
import {
  EvaluatedExpressionInputSchema,
  ExpressionSchema,
} from '../src/shared/expression.zod';

/** Exactly the call shape `build-schemas.ts` publishes with. */
const publish = (schema: z.ZodType, io: 'input' | 'output' = 'output'): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    override: refinementProjectionOverride,
  }) as Record<string, unknown>;

/**
 * The node's `allOf[].anyOf[].required` rule — evaluated the way a validator
 * would, and refusing to report anything when the node carries no such rule, so
 * a projection that stopped emitting fails rather than passing vacuously.
 */
const requiredOneOfSatisfied = (node: Record<string, unknown>, doc: Record<string, unknown>): boolean => {
  const allOf = node.allOf as Array<{ anyOf?: Array<{ required: string[] }> }> | undefined;
  const branches = allOf?.flatMap((clause) => clause.anyOf ?? []);
  if (!branches || branches.length === 0) {
    throw new Error('the node carries no allOf[].anyOf[].required — nothing to evaluate');
  }
  return branches.some((branch) => branch.required.every((key) => Object.prototype.hasOwnProperty.call(doc, key)));
};

/**
 * ECMA-262 WhiteSpace ∪ LineTerminator, by code point so no control byte is
 * ever written into this file (`scripts/check-nul-bytes.mjs` is the authority
 * on why a raw one is a defect rather than a spelling).
 */
const BLANK_CODE_POINTS = [
  0x09, 0x0b, 0x0c, 0x20, 0xa0, 0xfeff, // WhiteSpace: TAB VT FF SP NBSP ZWNBSP
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x202f, 0x205f, 0x3000, // WhiteSpace: the Zs category
  0x0a, 0x0d, 0x2028, 0x2029, // LineTerminator: LF CR LS PS
];

describe('the list of projectable patterns is CLOSED', () => {
  it('names exactly the two arms this change landed', () => {
    // ⛔ Growing this is a public-contract decision: every arm narrows a
    // published artifact. A new arm updates this line in the same PR, which is
    // what makes it a reviewed diff rather than a quiet widening of the
    // narrowing.
    expect([...PROJECTABLE_REFINEMENT_PATTERNS]).toEqual(['required-one-of', 'non-blank-string']);
  });

  it('a refinement nobody declared gets NO keyword', () => {
    const undeclared = z.string().refine((s) => s.startsWith('x'), 'must start with x');
    expect(projectableRefinementsOf(undeclared)).toEqual([]);
    expect(publish(undeclared)).toEqual(publish(z.string()));
  });

  it('LIT CONTROL — the same node with a DECLARED rule does get one', () => {
    const declared = z.string().refine(NON_BLANK_STRING, 'must not be blank');
    expect(projectableRefinementsOf(declared).map((p) => p.pattern)).toEqual(['non-blank-string']);
    expect(publish(declared)).not.toEqual(publish(z.string()));
  });

  it('a `.superRefine()` carries no readable rule, so it can never be declared', () => {
    // The measurement behind "the declaration cannot be read back out of the
    // predicate": `.superRefine()`'s check def holds only `{ check: 'custom' }`.
    const sup = z.string().superRefine((s, ctx) => {
      if (s.length === 0) ctx.addIssue({ code: 'custom', message: 'empty' });
    });
    expect(projectableRefinementsOf(sup)).toEqual([]);
  });
});

describe('required-one-of: one key list, read twice', () => {
  it('declares the keys it was given', () => {
    const rule = requiredOneOf(['source', 'ast']);
    expect(projectableRefinementOf(rule)).toEqual({ pattern: 'required-one-of', keys: ['source', 'ast'] });
  });

  it('emits an `anyOf` of one `required` per key, conjoined through `allOf`', () => {
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, { pattern: 'required-one-of', keys: ['a', 'b'] });
    expect(node).toEqual({
      type: 'object',
      allOf: [{ anyOf: [{ required: ['a'] }, { required: ['b'] }] }],
    });
  });

  it('⛔ never writes a TOP-LEVEL `anyOf` — the reference renderer reads that as the node\'s TYPE', () => {
    // Measured: `format-type.ts` tests `anyOf` before `properties`, so a
    // top-level `anyOf` here makes 26 reference pages print `any | any` in
    // place of an object shape they used to state. Pinned as an absence
    // because the regression is silent in every gate.
    const node: Record<string, unknown> = { type: 'object', properties: { a: { type: 'string' } } };
    emitProjectableRefinement(node, { pattern: 'required-one-of', keys: ['a', 'b'] });
    expect(node.anyOf).toBeUndefined();
    expect(node.properties).toEqual({ a: { type: 'string' } });
  });

  it('the predicate and the keywords agree over the whole presence lattice', () => {
    const rule = requiredOneOf(['a', 'b']);
    const node = publish(z.object({ a: z.string().optional(), b: z.string().optional(), c: z.string().optional() }).refine(rule));
    const keys = ['a', 'b', 'c'] as const;
    for (let mask = 0; mask < 8; mask += 1) {
      const doc: Record<string, unknown> = {};
      keys.forEach((key, i) => {
        if (mask & (1 << i)) doc[key] = 'v';
      });
      // A JSON object round-trip is what makes "absent" and "undefined" the
      // same fact — the equality this arm rests on.
      const asJson = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      expect(
        rule(asJson as never),
        `runtime vs keywords disagree for ${JSON.stringify(asJson)}`,
      ).toBe(requiredOneOfSatisfied(node, asJson));
    }
  });

  it('a key present with a `null` value satisfies BOTH sides', () => {
    const rule = requiredOneOf(['a', 'b']);
    const node = publish(z.object({ a: z.unknown().optional(), b: z.unknown().optional() }).refine(rule));
    const doc = { a: null };
    expect(rule(doc as never)).toBe(true);
    expect(requiredOneOfSatisfied(node, doc)).toBe(true);
  });

  it('leaves a union `anyOf` the node already has completely alone', () => {
    const node: Record<string, unknown> = { anyOf: [{ type: 'string' }, { type: 'number' }] };
    emitProjectableRefinement(node, { pattern: 'required-one-of', keys: ['a'] });
    expect(node.anyOf).toEqual([{ type: 'string' }, { type: 'number' }]);
    expect(node.allOf).toEqual([{ anyOf: [{ required: ['a'] }] }]);
  });

  it('two arms on one node both land, neither replacing the other', () => {
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, { pattern: 'required-one-of', keys: ['a'] });
    emitProjectableRefinement(node, { pattern: 'required-one-of', keys: ['b', 'c'] });
    expect(node.allOf).toEqual([
      { anyOf: [{ required: ['a'] }] },
      { anyOf: [{ required: ['b'] }, { required: ['c'] }] },
    ]);
  });
});

describe('non-blank-string: the trim and the regex are ONE set', () => {
  const blankRe = (): RegExp => new RegExp(NON_BLANK_PATTERN);

  it('agrees on every ECMA-262 WhiteSpace and LineTerminator code point, alone', () => {
    for (const cp of BLANK_CODE_POINTS) {
      const s = String.fromCodePoint(cp);
      expect(NON_BLANK_STRING(s), `U+${cp.toString(16)} alone`).toBe(false);
      expect(blankRe().test(s), `U+${cp.toString(16)} alone, via the pattern`).toBe(false);
    }
  });

  it('agrees on every one of them EMBEDDED beside a letter', () => {
    for (const cp of BLANK_CODE_POINTS) {
      const s = `${String.fromCodePoint(cp)}a${String.fromCodePoint(cp)}`;
      expect(NON_BLANK_STRING(s), `U+${cp.toString(16)} embedded`).toBe(true);
      expect(blankRe().test(s), `U+${cp.toString(16)} embedded, via the pattern`).toBe(true);
    }
  });

  it('agrees on a corpus, including every run of blanks', () => {
    const corpus = ['', 'a', 'ab', ' a', 'a ', ' a ', '  ', '   ', 'a b', '0', '{{record.name}}'];
    for (const s of corpus) {
      expect(NON_BLANK_STRING(s), JSON.stringify(s)).toBe(blankRe().test(s));
    }
  });

  it('emits `minLength: 1` and the pattern', () => {
    const node: Record<string, unknown> = { type: 'string' };
    emitProjectableRefinement(node, { pattern: 'non-blank-string' });
    expect(node).toEqual({ type: 'string', minLength: 1, pattern: NON_BLANK_PATTERN });
  });

  it('never LOWERS an existing minLength', () => {
    const node: Record<string, unknown> = { type: 'string', minLength: 8 };
    emitProjectableRefinement(node, { pattern: 'non-blank-string' });
    expect(node.minLength).toBe(8);
  });

  it('conjoins through `allOf` rather than replacing a pattern the node already has', () => {
    const node: Record<string, unknown> = { type: 'string', pattern: '^[a-z_]+$' };
    emitProjectableRefinement(node, { pattern: 'non-blank-string' });
    expect(node.pattern).toBe('^[a-z_]+$');
    expect(node.allOf).toEqual([{ pattern: NON_BLANK_PATTERN }]);
  });

  it('is idempotent — the same arm twice writes one pattern, not an `allOf`', () => {
    const node: Record<string, unknown> = { type: 'string' };
    emitProjectableRefinement(node, { pattern: 'non-blank-string' });
    emitProjectableRefinement(node, { pattern: 'non-blank-string' });
    expect(node).toEqual({ type: 'string', minLength: 1, pattern: NON_BLANK_PATTERN });
  });
});

describe('the LIVE seam: the published file now states the rule it used to drop', () => {
  it('`Expression` publishes the source-or-ast rule, and keeps its object shape', () => {
    const node = publish(ExpressionSchema);
    expect(node.allOf).toEqual([{ anyOf: [{ required: ['source'] }, { required: ['ast'] }] }]);
    expect(node.type).toBe('object');
    expect(Object.keys(node.properties as Record<string, unknown>)).toEqual(['dialect', 'source', 'ast', 'meta']);
  });

  it('the card\'s own specimen — `{ dialect: \'cel\' }` — is refused by BOTH sides now', () => {
    const doc = { dialect: 'cel' };
    expect(ExpressionSchema.safeParse(doc).success).toBe(false);
    expect(requiredOneOfSatisfied(publish(ExpressionSchema), doc)).toBe(false);
  });

  it('⛔ no envelope the runtime ACCEPTS is refused by the emitted keywords', () => {
    const node = publish(ExpressionSchema);
    const corpus: Array<Record<string, unknown>> = [
      { dialect: 'cel', source: 'a == 1' },
      { dialect: 'cel', ast: { kind: 'eq' } },
      { dialect: 'cel', source: 'a == 1', ast: { kind: 'eq' } },
      { dialect: 'cron', source: '0 9 * * 1-5' },
      { dialect: 'template', source: '{{record.name}}', meta: { rationale: 'why' } },
      { dialect: 'cel' },
      { dialect: 'cel', meta: { generatedBy: 'agent' } },
    ];
    for (const doc of corpus) {
      const runtimeAccepts = ExpressionSchema.safeParse(doc).success;
      const keywordsAccept = requiredOneOfSatisfied(node, doc);
      // Equality, not implication: this arm is exact, so a one-sided pin would
      // pass a projection that had stopped narrowing at all.
      expect(keywordsAccept, `disagreement on ${JSON.stringify(doc)}`).toBe(runtimeAccepts);
    }
  });

  it('an evaluated input slot publishes the non-blank rule on BOTH of its arms', () => {
    const node = publish(EvaluatedExpressionInputSchema, 'input');
    const [stringArm, objectArm] = node.anyOf as Array<Record<string, unknown>>;
    expect(stringArm).toMatchObject({ type: 'string', minLength: 1, pattern: NON_BLANK_PATTERN });
    expect((objectArm.properties as Record<string, unknown>).source)
      .toMatchObject({ type: 'string', minLength: 1, pattern: NON_BLANK_PATTERN });
  });

  it('a whitespace-only source is refused by BOTH sides, on both arms', () => {
    const node = publish(EvaluatedExpressionInputSchema, 'input');
    const [stringArm, objectArm] = node.anyOf as Array<Record<string, unknown>>;
    const blank = '   ';
    expect(EvaluatedExpressionInputSchema.safeParse(blank).success).toBe(false);
    expect(new RegExp(stringArm.pattern as string).test(blank)).toBe(false);
    expect(EvaluatedExpressionInputSchema.safeParse({ dialect: 'cel', source: blank }).success).toBe(false);
    const sourceNode = (objectArm.properties as Record<string, Record<string, unknown>>).source;
    expect(new RegExp(sourceNode.pattern as string).test(blank)).toBe(false);
  });

  it('LIT CONTROL — a non-blank source is accepted by both', () => {
    const node = publish(EvaluatedExpressionInputSchema, 'input');
    const [stringArm] = node.anyOf as Array<Record<string, unknown>>;
    expect(EvaluatedExpressionInputSchema.safeParse('a == 1').success).toBe(true);
    expect(new RegExp(stringArm.pattern as string).test('a == 1')).toBe(true);
  });
});

describe('the ledger measures THIS projection', () => {
  it('a DECLARED refinement reads `projected`, and names its pattern', () => {
    const schema = z.object({ a: z.string().optional(), b: z.string().optional() })
      .refine(requiredOneOf(['a', 'b']), 'one of a or b');
    const census = collectDroppedRefinements('test/Declared', schema);
    expect(census.dropped).toEqual([]);
    expect(census.projected).toHaveLength(1);
    expect(census.projected[0].declaredPatterns).toEqual(['required-one-of']);
  });

  it('LIT CONTROL — the same shape with an UNDECLARED rule still reads `dropped`', () => {
    const schema = z.object({ a: z.string().optional(), b: z.string().optional() })
      .refine((v) => v.a !== undefined || v.b !== undefined, 'one of a or b');
    const census = collectDroppedRefinements('test/Undeclared', schema);
    expect(census.projected).toEqual([]);
    expect(census.dropped).toHaveLength(1);
    expect(census.dropped[0].declaredPatterns).toEqual([]);
  });

  it('a declared refinement one level down is `projected` at its own path', () => {
    const schema = z.object({ slot: z.string().refine(NON_BLANK_STRING, 'non-blank') });
    const census = collectDroppedRefinements('test/Nested', schema);
    expect(census.dropped).toEqual([]);
    expect(census.projected.map((s) => s.path)).toEqual(['slot']);
    expect(census.projected[0].declaredPatterns).toEqual(['non-blank-string']);
  });
});
