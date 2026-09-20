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
 *   - `banned-keys` — over the whole key-presence lattice, with a
 *     present-but-`null` value, and on a name `Object.prototype` carries, which
 *     is the one JSON shape where "own property" and `in` come apart.
 *   - `banned-key-pattern` — the same lattice and the same own-property
 *     reading, plus the two things a regex adds: the emitted `pattern` is
 *     compared against the DECLARED string read off the predicate (one source,
 *     asserted rather than argued), and the predicate is shown STATELESS, which
 *     is what a flagless `RegExp` buys and what a JSON Schema `pattern` — which
 *     has no flags to carry — means.
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
  OPERATOR_PREFIX_KEY_PATTERN,
  PROJECTABLE_REFINEMENT_PATTERNS,
  bannedKeyPattern,
  bannedKeys,
  dependentRequired,
  projectableRefinementOf,
  requiredOneOf,
} from '../src/shared/refinement-projection';
import { SSLConfigSchema } from '../src/data/driver-sql.zod';
import { NormalizedFilterSchema } from '../src/data/filter.zod';
import { TraceSamplingConfigSchema } from '../src/system/tracing.zod';
import {
  emitProjectableRefinement,
  projectPublishedJsonSchema,
  projectableRefinementsOf,
} from './lib/refinement-projection';
import { collectDroppedRefinements } from './lib/dropped-refinements';
import { projectByPruningUnionBranches } from './lib/union-branch-projection';
import {
  EvaluatedExpressionInputSchema,
  ExpressionSchema,
} from '../src/shared/expression.zod';

/**
 * Exactly the call `build-schemas.ts` publishes with — the shared helper
 * itself, not a re-spelling of it. ⛔ Deliberately NOT a local
 * `z.toJSONSchema(..., { override })`: that is the convention this change
 * replaced, and a test that kept it would go on passing through the one edit
 * that matters (the override dropped from the helper) while the published file
 * went wide.
 */
const publish = (schema: z.ZodType, io: 'input' | 'output' = 'output'): Record<string, unknown> =>
  projectPublishedJsonSchema(schema, { io }) as Record<string, unknown>;

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
 * The node's banned-key rule — `propertyNames.not.enum`, wherever the emitter put
 * it — evaluated the way a validator would, and refusing to report anything when
 * the node carries no such rule, so a projection that stopped emitting fails
 * rather than passing vacuously.
 *
 * Both placements are read because the emitter chooses between them by what the
 * node already carries: a record already states `propertyNames: { type:
 * 'string' }`, so its ban is conjoined through `allOf`; a bare object has no
 * `propertyNames` and takes the rule directly.
 */
const bannedKeysSatisfied = (node: Record<string, unknown>, doc: Record<string, unknown>): boolean => {
  const clauses = [node, ...((node.allOf as Record<string, unknown>[] | undefined) ?? [])];
  const banned = clauses
    .map((clause) => (clause.propertyNames as { not?: { enum?: string[] } } | undefined)?.not?.enum)
    .filter((list): list is string[] => Array.isArray(list));
  if (banned.length === 0) {
    throw new Error('the node carries no propertyNames.not.enum — nothing to evaluate');
  }
  return banned.every((list) =>
    Object.keys(doc).every((name) => !list.includes(name)),
  );
};

/**
 * The node's banned-key-PATTERN rule — `propertyNames.not.pattern`, wherever
 * the emitter put it — evaluated the way a validator would, and refusing to
 * report anything when the node carries no such rule, so a projection that
 * stopped emitting fails rather than passing vacuously.
 *
 * ⭐ The regex is compiled from the string READ OFF THE PUBLISHED NODE, never
 * from the constant this suite imports. That is what makes these cases a test
 * of the artifact: a node publishing a different pattern than the one declared
 * would be evaluated by its own, wrong, pattern and disagree with the runtime
 * — which is the whole failure the single-source construction exists to make
 * impossible, asserted rather than assumed.
 */
const bannedKeyPatternSatisfied = (node: Record<string, unknown>, doc: Record<string, unknown>): boolean => {
  const clauses = [node, ...((node.allOf as Record<string, unknown>[] | undefined) ?? [])];
  const patterns = clauses
    .map((clause) => (clause.propertyNames as { not?: { pattern?: string } } | undefined)?.not?.pattern)
    .filter((source): source is string => typeof source === 'string');
  if (patterns.length === 0) {
    throw new Error('the node carries no propertyNames.not.pattern — nothing to evaluate');
  }
  return patterns.every((source) => {
    const matches = new RegExp(source);
    return Object.keys(doc).every((name) => !matches.test(name));
  });
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
  it('names exactly the arms this list has landed, and nothing else', () => {
    // ⛔ Growing this is a public-contract decision: every arm narrows a
    // published artifact. A new arm updates this line in the same PR, which is
    // what makes it a reviewed diff rather than a quiet widening of the
    // narrowing.
    expect([...PROJECTABLE_REFINEMENT_PATTERNS]).toEqual([
      'required-one-of',
      'non-blank-string',
      'dependent-required',
      'banned-keys',
      'banned-key-pattern',
    ]);
  });

  it('the set of publishable key PATTERNS is closed too, and holds exactly one', () => {
    // ⛔ The second closed list, and the reason the regex arm is bounded at
    // all: a call site cannot invent a pattern because `bannedKeyPattern` takes
    // no `string`. Widening it is the same public-contract decision growing the
    // roster above is, so the count is pinned rather than the mechanism trusted.
    // ⚠️ If this line ever needs a second entry, that is the review, not a fix.
    expect(OPERATOR_PREFIX_KEY_PATTERN).toBe('^\\$');
    // The predicate the ban is FOR: `^\$` and `key.startsWith('$')` name one
    // set, which is what the call site in `filter.zod.ts` traded away.
    const matches = new RegExp(OPERATOR_PREFIX_KEY_PATTERN);
    for (const key of ['$and', '$', '$eq', 'amount', 'a$b', '', 'account.name', 'x$']) {
      expect(matches.test(key), `disagreement on ${JSON.stringify(key)}`).toBe(key.startsWith('$'));
    }
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

describe('dependent-required: one dependency map, read twice', () => {
  /**
   * The node's `dependentRequired`, evaluated the way a validator would, and
   * refusing to report anything when the node carries no such keyword — so a
   * projection that stopped emitting fails rather than passing vacuously.
   */
  const dependentRequiredSatisfied = (
    node: Record<string, unknown>,
    doc: Record<string, unknown>,
  ): boolean => {
    const map = node.dependentRequired as Record<string, string[]> | undefined;
    if (!map || Object.keys(map).length === 0) {
      throw new Error('the node carries no `dependentRequired` — nothing to evaluate');
    }
    const present = (key: string): boolean => Object.prototype.hasOwnProperty.call(doc, key);
    return Object.entries(map).every(([key, required]) => !present(key) || required.every(present));
  };

  it('declares the dependency map it was given', () => {
    const rule = dependentRequired({ cert: ['key'], key: ['cert'] });
    expect(projectableRefinementOf(rule)).toEqual({
      pattern: 'dependent-required',
      dependencies: { cert: ['key'], key: ['cert'] },
    });
  });

  it('emits JSON Schema`s own `dependentRequired`, and nothing else', () => {
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, {
      pattern: 'dependent-required',
      dependencies: { a: ['b'] },
    });
    expect(node).toEqual({ type: 'object', dependentRequired: { a: ['b'] } });
  });

  it('⛔ never writes a TOP-LEVEL `anyOf` or replaces the node`s own shape', () => {
    // Same absence the required-one-of arm pins: `format-type.ts` reads `anyOf`
    // before `properties`, so a top-level one costs the reference table the
    // object shape it used to state.
    const node: Record<string, unknown> = { type: 'object', properties: { a: { type: 'string' } } };
    emitProjectableRefinement(node, { pattern: 'dependent-required', dependencies: { a: ['b'] } });
    expect(node.anyOf).toBeUndefined();
    expect(node.properties).toEqual({ a: { type: 'string' } });
  });

  it('drops an entry that requires nothing rather than publishing an empty rule', () => {
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, { pattern: 'dependent-required', dependencies: { a: [] } });
    expect(node).toEqual({ type: 'object' });
  });

  it('conjoins through `allOf` rather than replacing a keyword the node already has', () => {
    const node: Record<string, unknown> = { type: 'object', dependentRequired: { a: ['b'] } };
    emitProjectableRefinement(node, { pattern: 'dependent-required', dependencies: { c: ['d'] } });
    expect(node.dependentRequired).toEqual({ a: ['b'] });
    expect(node.allOf).toEqual([{ dependentRequired: { c: ['d'] } }]);
  });

  it('the predicate and the keyword agree over the whole presence lattice', () => {
    const rule = dependentRequired({ cert: ['key'], key: ['cert'] });
    const node = publish(
      z.object({
        ca: z.string().optional(),
        cert: z.string().optional(),
        key: z.string().optional(),
      }).refine(rule),
    );
    const keys = ['ca', 'cert', 'key'] as const;
    for (let mask = 0; mask < 1 << keys.length; mask += 1) {
      const doc: Record<string, unknown> = {};
      keys.forEach((key, i) => {
        if (mask & (1 << i)) doc[key] = '/path';
      });
      // The JSON round-trip is what makes "absent" and "undefined" one fact —
      // the equality this arm rests on, exactly as required-one-of does.
      const asJson = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      expect(
        rule(asJson as never),
        `runtime vs keywords disagree for ${JSON.stringify(asJson)}`,
      ).toBe(dependentRequiredSatisfied(node, asJson));
    }
  });

  it('a key present with a `null` value ARMS its dependency on both sides', () => {
    const rule = dependentRequired({ cert: ['key'], key: ['cert'] });
    const node = publish(
      z.object({ cert: z.unknown().optional(), key: z.unknown().optional() }).refine(rule),
    );
    const doc = { cert: null };
    expect(rule(doc as never)).toBe(false);
    expect(dependentRequiredSatisfied(node, doc)).toBe(false);
  });

  it('LIVE SEAM — `data/SSLConfig` states the rule, and both sides agree on a corpus', () => {
    const node = publish(SSLConfigSchema);
    expect(node.dependentRequired).toEqual({ cert: ['key'], key: ['cert'] });
    const corpus: Array<Record<string, unknown>> = [
      {},
      { ca: '/ca.pem' },
      { cert: '/c.pem' },
      { key: '/k.pem' },
      { cert: '/c.pem', key: '/k.pem' },
      { ca: '/ca.pem', cert: '/c.pem', key: '/k.pem' },
      { ca: '/ca.pem', cert: '/c.pem' },
      { rejectUnauthorized: false, key: '/k.pem' },
    ];
    for (const doc of corpus) {
      // Equality, not implication: the arm is exact, so a one-sided pin would
      // pass a projection that had stopped narrowing at all.
      expect(
        dependentRequiredSatisfied(node, doc),
        `disagreement on ${JSON.stringify(doc)}`,
      ).toBe(SSLConfigSchema.safeParse(doc).success);
    }
  });
});

describe('banned-keys: one key list, read twice', () => {
  it('declares the keys it was given', () => {
    const rule = bannedKeys(['dialect']);
    expect(projectableRefinementOf(rule)).toEqual({ pattern: 'banned-keys', keys: ['dialect'] });
  });

  it('emits `propertyNames` with a `not` over the names, when the node states none', () => {
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: ['a', 'b'] });
    expect(node).toEqual({ type: 'object', propertyNames: { not: { enum: ['a', 'b'] } } });
  });

  it('conjoins through `allOf` rather than replacing the `propertyNames` a record already states', () => {
    // A record emits `propertyNames: { type: 'string' }` of its own. Replacing
    // it would trade the key-TYPE rule the node already stated for the key-NAME
    // rule this arm adds, which is a narrowing paid for with a widening.
    const node: Record<string, unknown> = { type: 'object', propertyNames: { type: 'string' } };
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: ['dialect'] });
    expect(node.propertyNames).toEqual({ type: 'string' });
    expect(node.allOf).toEqual([{ propertyNames: { not: { enum: ['dialect'] } } }]);
  });

  it('⛔ never writes a TOP-LEVEL `anyOf` or disturbs the node’s own shape', () => {
    const node: Record<string, unknown> = { type: 'object', properties: { a: { type: 'string' } } };
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: ['b'] });
    expect(node.anyOf).toBeUndefined();
    expect(node.properties).toEqual({ a: { type: 'string' } });
  });

  it('is idempotent — the same arm twice states one rule, not two', () => {
    const node: Record<string, unknown> = { type: 'object', propertyNames: { type: 'string' } };
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: ['dialect'] });
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: ['dialect'] });
    expect(node.allOf).toEqual([{ propertyNames: { not: { enum: ['dialect'] } } }]);
  });

  it('drops an empty key list \u2014 `enum: []` is an INVALID schema, not a vacuous one', () => {
    // ⛔ Not "it would ban nothing": `enum` is specified as a non-empty array,
    // so `{ not: { enum: [] } }` fails validator schema-compilation outright
    // (ajv: "enum must have non-empty array") and would take the whole
    // published file down rather than sit there unread.
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: [] });
    expect(node).toEqual({ type: 'object' });
  });

  it('the predicate and the keywords agree over the whole presence lattice', () => {
    const rule = bannedKeys(['x', 'y']);
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const keys = ['x', 'y', 'z'] as const;
    for (let mask = 0; mask < 8; mask += 1) {
      const doc: Record<string, unknown> = {};
      keys.forEach((key, i) => {
        if (mask & (1 << i)) doc[key] = 'v';
      });
      const asJson = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      expect(
        rule(asJson),
        `runtime vs keywords disagree for ${JSON.stringify(asJson)}`,
      ).toBe(bannedKeysSatisfied(node, asJson));
    }
  });

  it('a banned key present with a `null` value is PRESENT on both sides', () => {
    const rule = bannedKeys(['dialect']);
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const doc = JSON.parse('{"dialect":null}') as Record<string, unknown>;
    expect(rule(doc)).toBe(false);
    expect(bannedKeysSatisfied(node, doc)).toBe(false);
  });

  it('⛔ judges OWN properties — a name `Object.prototype` carries is not "present" in an empty document', () => {
    // The measurement behind the predicate reading `hasOwnProperty` and never
    // `key in value`: `in` walks the prototype chain, so a ban spelled with it
    // would refuse `{}` itself while `propertyNames` accepts it. That is a
    // disagreement about a JSON DOCUMENT, not an edge outside the domain.
    const rule = bannedKeys(['toString']);
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const empty = JSON.parse('{}') as Record<string, unknown>;
    expect('toString' in empty).toBe(true);
    expect(rule(empty)).toBe(true);
    expect(bannedKeysSatisfied(node, empty)).toBe(true);
  });

  it('LIT CONTROL — the same name written INTO the document is refused by both', () => {
    const rule = bannedKeys(['toString']);
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const doc = JSON.parse('{"toString":"x"}') as Record<string, unknown>;
    expect(rule(doc)).toBe(false);
    expect(bannedKeysSatisfied(node, doc)).toBe(false);
  });
});

describe('banned-key-pattern: one pattern string, read twice', () => {
  it('declares the pattern it was given', () => {
    const rule = bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN);
    expect(projectableRefinementOf(rule)).toEqual({
      pattern: 'banned-key-pattern',
      keyPattern: '^\\$',
    });
  });

  it('⭐ the published keyword IS the declared string — one source, not two', () => {
    // The ruling's own requirement for this arm. Not "they happen to be equal":
    // the emitted `pattern` is read off the artifact and compared with the
    // declaration read off the predicate, so an emitter that re-spelled the
    // rule — or a declaration edited without its predicate — fails here.
    const rule = bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN);
    const declared = projectableRefinementOf(rule) as { keyPattern: string };
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const emitted = (node.allOf as Array<{ propertyNames: { not: { pattern: string } } }>)[0];
    expect(emitted.propertyNames.not.pattern).toBe(declared.keyPattern);
  });

  it('emits `propertyNames` with a `not` over the pattern, when the node states none', () => {
    const node: Record<string, unknown> = { type: 'object' };
    emitProjectableRefinement(node, { pattern: 'banned-key-pattern', keyPattern: '^\\$' });
    expect(node).toEqual({ type: 'object', propertyNames: { not: { pattern: '^\\$' } } });
  });

  it('conjoins through `allOf` rather than replacing the `propertyNames` a record already states', () => {
    const node: Record<string, unknown> = { type: 'object', propertyNames: { type: 'string' } };
    emitProjectableRefinement(node, { pattern: 'banned-key-pattern', keyPattern: '^\\$' });
    expect(node.propertyNames).toEqual({ type: 'string' });
    expect(node.allOf).toEqual([{ propertyNames: { not: { pattern: '^\\$' } } }]);
  });

  it('⛔ never writes a TOP-LEVEL `anyOf` or disturbs the node’s own shape', () => {
    const node: Record<string, unknown> = { type: 'object', properties: { a: { type: 'string' } } };
    emitProjectableRefinement(node, { pattern: 'banned-key-pattern', keyPattern: '^\\$' });
    expect(node.anyOf).toBeUndefined();
    expect(node.properties).toEqual({ a: { type: 'string' } });
  });

  it('is idempotent — the same arm twice states one rule, not two', () => {
    const node: Record<string, unknown> = { type: 'object', propertyNames: { type: 'string' } };
    emitProjectableRefinement(node, { pattern: 'banned-key-pattern', keyPattern: '^\\$' });
    emitProjectableRefinement(node, { pattern: 'banned-key-pattern', keyPattern: '^\\$' });
    expect(node.allOf).toEqual([{ propertyNames: { not: { pattern: '^\\$' } } }]);
  });

  it('a LIST ban and a PATTERN ban on one node both land, neither replacing the other', () => {
    // The two banned-key arms write the same keyword, so the conjunction they
    // share has to keep both rules. A node stating only the last one written
    // would be WIDER than its runtime in exactly the direction this card is
    // about.
    const node: Record<string, unknown> = { type: 'object', propertyNames: { type: 'string' } };
    emitProjectableRefinement(node, { pattern: 'banned-keys', keys: ['dialect'] });
    emitProjectableRefinement(node, { pattern: 'banned-key-pattern', keyPattern: '^\\$' });
    expect(node.allOf).toEqual([
      { propertyNames: { not: { enum: ['dialect'] } } },
      { propertyNames: { not: { pattern: '^\\$' } } },
    ]);
  });

  it('the predicate and the keywords agree over the whole presence lattice', () => {
    const rule = bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN);
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const keys = ['$eq', 'amount', 'a$b'] as const;
    for (let mask = 0; mask < 8; mask += 1) {
      const doc: Record<string, unknown> = {};
      keys.forEach((key, i) => {
        if (mask & (1 << i)) doc[key] = 'v';
      });
      const asJson = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      expect(
        rule(asJson),
        `runtime vs keywords disagree for ${JSON.stringify(asJson)}`,
      ).toBe(bannedKeyPatternSatisfied(node, asJson));
    }
  });

  it('a matching key present with a `null` value is PRESENT on both sides', () => {
    const rule = bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN);
    const node = publish(z.record(z.string(), z.unknown()).refine(rule));
    const doc = JSON.parse('{"$eq":null}') as Record<string, unknown>;
    expect(rule(doc)).toBe(false);
    expect(bannedKeyPatternSatisfied(node, doc)).toBe(false);
  });

  it('⛔ the predicate is STATELESS — the same document answers the same twice', () => {
    // This arm's own hazard, and the reason its `RegExp` carries no flags. With
    // `g`, `test` advances `lastIndex` and alternates true/false down a key
    // list, so a document's verdict would depend on which documents were judged
    // before it — while a JSON Schema `pattern` has no flags to carry and would
    // go on meaning the flagless rule. Two keys in one document, then the whole
    // document twice: a stateful regex fails both halves.
    const rule = bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN);
    const twoBanned = JSON.parse('{"$a":1,"$b":2}') as Record<string, unknown>;
    expect(rule(twoBanned)).toBe(false);
    expect(rule(twoBanned)).toBe(false);
    const clean = JSON.parse('{"amount":1,"total":2}') as Record<string, unknown>;
    expect(rule(clean)).toBe(true);
    expect(rule(clean)).toBe(true);
  });

  it('⛔ judges OWN enumerable keys — an inherited name is not in the document', () => {
    // The same reading `banned-keys` records: `Object.keys` is exactly what a
    // JSON object's properties are and exactly what `propertyNames` judges,
    // while `for…in` and `in` walk the prototype chain. Spelled with a name
    // planted on the prototype so the two readings actually come apart.
    const rule = bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN);
    const inherited = Object.create({ $planted: 'on the prototype' }) as Record<string, unknown>;
    expect('$planted' in inherited).toBe(true);
    expect(rule(inherited)).toBe(true);
    inherited.$own = 'on the document';
    expect(rule(inherited)).toBe(false);
  });
});

describe("the LIVE seam: the card's own worked instance stops saying yes", () => {
  /**
   * The published `TraceSamplingConfig.composite[].condition` node.
   *
   * ⭐ It is the node ITSELF, not a union arm. #18118 retired this slot's CEL
   * expression arm (PR #19084), so the union collapsed to the structured-filter
   * record it always had beside it — which is why the ban lands directly on
   * `condition` and is still conjoined through `allOf`: a record states its own
   * `propertyNames: { type: 'string' }`, and that key-TYPE rule is not the one
   * this arm adds.
   */
  const conditionNode = (): Record<string, unknown> => {
    const node = publish(TraceSamplingConfigSchema);
    const composite = (node.properties as Record<string, Record<string, unknown>>).composite;
    const item = composite.items as Record<string, Record<string, Record<string, unknown>>>;
    return item.properties.condition as unknown as Record<string, unknown>;
  };

  /** A `TraceSamplingConfig` that parses, with only `condition` varying. */
  const parses = (condition: unknown): boolean =>
    TraceSamplingConfigSchema.safeParse({
      type: 'composite',
      composite: [{ strategy: 'always_on', condition }],
    }).success;

  it('states the ban, and keeps the record shape it always stated', () => {
    const node = conditionNode();
    expect(node.type).toBe('object');
    expect(node.propertyNames).toEqual({ type: 'string' });
    expect(node.allOf).toEqual([{ propertyNames: { not: { enum: ['dialect'] } } }]);
  });

  it("the card's own specimen — `{ dialect: 'cel' }` — is refused by BOTH sides now", () => {
    const doc = JSON.parse('{"dialect":"cel"}') as Record<string, unknown>;
    expect(parses(doc)).toBe(false);
    expect(bannedKeysSatisfied(conditionNode(), doc)).toBe(false);
  });

  it('⛔ the runtime and the emitted keywords agree on every document in the corpus', () => {
    const node = conditionNode();
    const corpus: Array<Record<string, unknown>> = [
      {},
      { amount: { $gt: 1 } },
      { service: 'api', attributes: { 'http.route': '/v1/orders' } },
      { dialect: 'cel' },
      { dialect: null },
      // Since #18118 retired the expression arm, a healthy CEL envelope is
      // refused at this slot too — so the two sides agree here as well, where
      // before the retirement the union's other arm accepted it.
      { dialect: 'cel', source: 'record.amount > 10' },
    ];
    for (const doc of corpus) {
      const asJson = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      // Equality, not implication: this arm is exact, so a one-sided pin would
      // pass a projection that had stopped narrowing at all.
      expect(
        bannedKeysSatisfied(node, asJson),
        `disagreement on ${JSON.stringify(asJson)}`,
      ).toBe(parses(asJson));
    }
  });

  it('LIT CONTROL — a structured filter with no `dialect` is accepted by both', () => {
    const doc = JSON.parse('{"amount":{"$gt":10}}') as Record<string, unknown>;
    expect(parses(doc)).toBe(true);
    expect(bannedKeysSatisfied(conditionNode(), doc)).toBe(true);
  });

  it('its ledger row is gone because the site now reads `projected`, naming the arm', () => {
    const census = collectDroppedRefinements('system/TraceSamplingConfig', TraceSamplingConfigSchema);
    const site = census.projected.find((s) => s.path === 'composite.element.condition');
    expect(site?.declaredPatterns).toEqual(['banned-keys']);
    expect(census.dropped).toEqual([]);
  });
});

describe('the LIVE seam: `data/NormalizedFilter` stops accepting `$`-prefixed field keys', () => {
  /**
   * The published `data/NormalizedFilter.json`, through the pass that actually
   * writes it.
   *
   * ⭐ ⛔ NOT `publish()`. `FieldOperatorsSchema` carries `z.date()` members, so
   * both strict io directions refuse this export outright and the generator
   * reaches its file through the branch-pruning pass — which is the same reason
   * these nodes were `undecidable` to the ledger until the detector's ladder
   * grew that rung. A test projecting it any other way would be testing a file
   * nobody publishes.
   */
  const published = (): Record<string, unknown> => {
    const projected = projectByPruningUnionBranches(NormalizedFilterSchema);
    if (!projected) {
      throw new Error('NormalizedFilter no longer projects through the branch-pruning pass');
    }
    return projected.schema as Record<string, unknown>;
  };

  /** The three field-condition record nodes, by the path the artifact reads at. */
  const fieldConditionNodes = (): Record<string, Record<string, unknown>> => {
    const props = published().properties as Record<string, Record<string, unknown>>;
    const arrayMember = (key: '$and' | '$or'): Record<string, unknown> =>
      ((props[key].items as Record<string, unknown>).anyOf as Record<string, unknown>[])[0];
    return {
      'properties.$and.items.anyOf[0]': arrayMember('$and'),
      'properties.$or.items.anyOf[0]': arrayMember('$or'),
      'properties.$not.anyOf[0]': (props.$not.anyOf as Record<string, unknown>[])[0],
    };
  };

  /** A normalized filter that parses, with only the `$and` member varying. */
  const parsesAsMember = (member: unknown): boolean =>
    NormalizedFilterSchema.safeParse({ $and: [member] }).success;

  it('all THREE nodes state the ban, and keep the record shape they always stated', () => {
    // The card's §6 measured all three publishing as a bare object with no ban
    // at all. Named individually rather than counted: a loop that found two
    // would still read "every node states it".
    const nodes = fieldConditionNodes();
    expect(Object.keys(nodes)).toEqual([
      'properties.$and.items.anyOf[0]',
      'properties.$or.items.anyOf[0]',
      'properties.$not.anyOf[0]',
    ]);
    for (const [where, node] of Object.entries(nodes)) {
      expect(node.type, where).toBe('object');
      expect(node.propertyNames, where).toEqual({ type: 'string' });
      expect(node.allOf, where).toEqual([{ propertyNames: { not: { pattern: '^\\$' } } }]);
    }
  });

  it("the thread's own specimen — a `$`-prefixed operator key — is refused by BOTH sides now", () => {
    // Measured on the merged tree at filing: the file PASSed this document and
    // the runtime refused it, naming the rule 「a field condition's keys are
    // field names, never `$`-prefixed operators」.
    const doc = JSON.parse('{"$and":[{"$bogus":{"$eq":1}}]}') as Record<string, unknown>;
    expect(NormalizedFilterSchema.safeParse(doc).success).toBe(false);
    const member = (doc.$and as Record<string, unknown>[])[0];
    expect(bannedKeyPatternSatisfied(fieldConditionNodes()['properties.$and.items.anyOf[0]'], member)).toBe(false);
  });

  it('⛔ the runtime and the emitted keywords agree on every FIELD-CONDITION member in the corpus', () => {
    // ⚠️ Field conditions only, deliberately. A member may also be a GROUP —
    // `{ "$and": [] }` is a `$`-keyed document the runtime accepts through the
    // union's OTHER branch — so a corpus mixing the two would measure which
    // branch answered, not whether this node's rule and its keywords agree.
    // The group direction is the next case, and it is the one that proves
    // nothing accepted became refused.
    const node = fieldConditionNodes()['properties.$and.items.anyOf[0]'];
    const corpus: Array<Record<string, unknown>> = [
      {},
      { amount: { $eq: 1 } },
      { 'account.name': { $eq: 'acme' } },
      { amount: { $eq: 1 }, total: { $gt: 2 } },
      { $bogus: { $eq: 1 } },
      { $eq: { $eq: 1 } },
      { amount: { $eq: 1 }, $x: { $eq: 2 } },
      { $and: { $eq: 1 } },
    ];
    for (const doc of corpus) {
      const asJson = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      // Equality, not implication: the arm is exact, so a one-sided pin would
      // pass a projection that had stopped narrowing at all.
      expect(
        bannedKeyPatternSatisfied(node, asJson),
        `disagreement on ${JSON.stringify(asJson)}`,
      ).toBe(parsesAsMember(asJson));
    }
  });

  it('⛔ no GROUP member the runtime accepts becomes refused — the other branch is untouched', () => {
    // The direction the whole card turns on. A group member is `$`-keyed by
    // construction, so if the ban had landed on the union instead of on the
    // field-condition branch, every one of these would have been narrowed away.
    const groups = [{}, { $and: [] }, { $or: [] }, { $or: [{}] }, { $not: {} }, { $and: [{ amount: { $eq: 1 } }] }];
    for (const group of groups) {
      expect(parsesAsMember(group), `runtime refused ${JSON.stringify(group)}`).toBe(true);
    }
    const branches = (published().properties as Record<string, Record<string, unknown>>)
      .$and.items as Record<string, unknown>;
    // The group branch is a bare `$ref` and gains nothing: the ban is on
    // `anyOf[0]` and on nothing else.
    expect((branches.anyOf as Record<string, unknown>[])[1] && Object.keys((branches.anyOf as Record<string, unknown>[])[1]))
      .toEqual(['$ref']);
  });

  it('its three ledger rows are gone because the sites now read `projected`, naming the arm', () => {
    const census = collectDroppedRefinements('data/NormalizedFilter', NormalizedFilterSchema);
    const paths = ['lazy.$and.element.options[0]', 'lazy.$not.options[0]', 'lazy.$or.element.options[0]'];
    for (const path of paths) {
      const site = census.projected.find((s) => s.path === path);
      expect(site?.declaredPatterns, path).toEqual(['banned-key-pattern']);
    }
    // ⛔ And they are not merely absent from `dropped`: `undecidable` was the
    // verdict they used to carry, and it is the one that holds no ledger row.
    expect(census.undecidable).toEqual([]);
    expect(census.dropped.map((s) => s.path)).not.toContain('lazy.$and.element.options[0]');
  });
});

describe('the detector projects through the generator`s OWN ladder, all three rungs', () => {
  /**
   * A node that no strict io direction can project — a `z.date()` member — but
   * that the branch-pruning pass can, because the date sits in a UNION position.
   * That is the shape of every site this rung was added for.
   */
  const dateBearingRecord = (rule: (value: never) => boolean): z.ZodType =>
    z.record(z.string(), z.union([z.string(), z.date()])).refine(rule as (value: object) => boolean);

  it('a node only the pruning pass can project is ADJUDICATED, not shrugged at', () => {
    // Before this rung the verdict was `undecidable`: the comparison had no two
    // sides, the site held no ledger row, and no repair of it could delete one
    // — while the published file carried the node all the same.
    const undeclared = dateBearingRecord(((value: object) => Object.keys(value).length < 99) as never);
    const census = collectDroppedRefinements('probe/OnlyPrunable', undeclared);
    expect(census.undecidable).toEqual([]);
    expect(census.dropped.map((s) => s.path)).toEqual(['']);
  });

  it('LIT CONTROL — a DECLARED rule on the same shape reads `projected` through that rung too', () => {
    const declared = dateBearingRecord(bannedKeyPattern(OPERATOR_PREFIX_KEY_PATTERN) as never);
    const census = collectDroppedRefinements('probe/OnlyPrunable', declared);
    expect(census.undecidable).toEqual([]);
    expect(census.dropped).toEqual([]);
    expect(census.projected.map((s) => s.declaredPatterns)).toEqual([['banned-key-pattern']]);
  });

  it('a node NO rung can project is still `undecidable` — the rung is a ladder, not a blanket', () => {
    // A live callable in a PROPERTY position: not droppable, because every
    // document the declaration accepts carries that key. The verdict has to
    // stay honest here, or the generator's zero-undecidable ratchet would be
    // measuring a detector that simply stopped saying it.
    const unprojectable = z.object({ handler: z.custom<() => void>((v) => typeof v === 'function') })
      .refine((value) => typeof value.handler === 'function');
    const census = collectDroppedRefinements('probe/NeverProjects', unprojectable);
    expect(census.undecidable.map((s) => s.path)).toEqual(['']);
    expect(census.dropped).toEqual([]);
  });
});

describe('the verdict is adjudicated per NODE over every check on it', () => {
  const nonBlank = (): z.ZodString => z.string().refine(NON_BLANK_STRING, 'non-blank');

  it('a DECLARED arm beside an UNDECLARED rule stays `dropped`, with the arm still named', () => {
    // Before this was fixed the whole node read `projected` on the strength of
    // the declared arm, so the undeclared rule reached neither the ledger nor
    // `x-dropped-refinements` nor the generator's UNDECLARED line — a silent
    // violation of 「A refinement that is not one of these named patterns stays
    // dropped and annotated」.
    const mixed = nonBlank().refine((s) => s.startsWith('x'), 'must start with x');
    const census = collectDroppedRefinements('test/Mixed', mixed);
    expect(census.projected).toEqual([]);
    expect(census.dropped).toHaveLength(1);
    expect(census.dropped[0].count).toBe(2);
    expect(census.dropped[0].declaredPatterns).toEqual(['non-blank-string']);
    // The RAW differential is kept, so the detector still measures rather than
    // asserts: something about this node DID reach the file.
    expect(census.dropped[0].projectionMoved).toBe(true);
  });

  it('LIT CONTROL — the declared arm ALONE on the same shape reads `projected`', () => {
    const census = collectDroppedRefinements('test/DeclaredOnly', nonBlank());
    expect(census.dropped).toEqual([]);
    expect(census.projected).toHaveLength(1);
    expect(census.projected[0].count).toBe(1);
    expect(census.projected[0].projectionMoved).toBe(true);
  });

  it('LIT CONTROL — the undeclared rule ALONE reads `dropped` and moved NOTHING', () => {
    const census = collectDroppedRefinements(
      'test/UndeclaredOnly',
      z.string().refine((s) => s.startsWith('x'), 'must start with x'),
    );
    expect(census.projected).toEqual([]);
    expect(census.dropped).toHaveLength(1);
    expect(census.dropped[0].declaredPatterns).toEqual([]);
    expect(census.dropped[0].projectionMoved).toBe(false);
  });

  it('two DECLARED arms on one node read `projected` — the fix is not "more than one check"', () => {
    const both = z.object({ a: z.string().optional(), b: z.string().optional() })
      .refine(requiredOneOf(['a', 'b']), 'one of a or b')
      .refine(dependentRequired({ a: ['b'] }), 'a needs b');
    const census = collectDroppedRefinements('test/TwoArms', both);
    expect(census.dropped).toEqual([]);
    expect(census.projected).toHaveLength(1);
    expect(census.projected[0].count).toBe(2);
    expect(census.projected[0].declaredPatterns).toEqual(['required-one-of', 'dependent-required']);
  });

  it('⛔ `projected` with a differential that never moved cannot occur', () => {
    for (const schema of [nonBlank(), z.string().refine((s) => s.length > 2)]) {
      for (const site of collectDroppedRefinements('test/Invariant', schema).projected) {
        expect(site.projectionMoved).toBe(true);
      }
    }
  });
});

describe('generator and detector project through ONE call, not two conventions', () => {
  it('the helper applies the refinement projection with NO override from the caller', () => {
    // The coupling, asserted where it now lives. A caller passing nothing is
    // the generator's own call shape; if the override were still the caller's
    // to remember, this would come back byte-identical to a bare projection.
    const declared = z.string().refine(NON_BLANK_STRING, 'non-blank');
    expect(projectPublishedJsonSchema(declared)).toMatchObject({
      minLength: 1,
      pattern: NON_BLANK_PATTERN,
    });
  });

  it('a caller`s OWN override runs first, and does not displace the refinement pass', () => {
    const declared = z.string().refine(NON_BLANK_STRING, 'non-blank');
    const marked = projectPublishedJsonSchema(declared, {
      override: (ctx) => {
        (ctx.jsonSchema as Record<string, unknown>)['x-marked'] = true;
      },
    }) as Record<string, unknown>;
    expect(marked['x-marked']).toBe(true);
    expect(marked.pattern).toBe(NON_BLANK_PATTERN);
  });

  it('the detector`s differential reads the SAME projection the helper publishes', () => {
    // Both halves through one call: a site the helper emits for is `projected`
    // here, and the ledger's "a row deletion is the proof a site closed" holds
    // only while that is true.
    const schema = z.object({ cert: z.string().optional(), key: z.string().optional() })
      .refine(dependentRequired({ cert: ['key'], key: ['cert'] }), 'together');
    expect(publish(schema).dependentRequired).toEqual({ cert: ['key'], key: ['cert'] });
    const census = collectDroppedRefinements('test/Coupled', schema);
    expect(census.dropped).toEqual([]);
    expect(census.projected.map((s) => s.declaredPatterns)).toEqual([['dependent-required']]);
  });
});
