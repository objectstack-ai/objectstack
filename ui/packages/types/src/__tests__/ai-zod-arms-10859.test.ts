/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The three `@object-ui/plugin-ai` node types have a zod arm in
 * `AnyComponentSchema` (objectui#10859, batch 1).
 *
 * ## The defect these pin
 *
 * `ai-form-assist`, `ai-recommendations` and `nl-query` are registered by
 * `@object-ui/plugin-ai`, declared on the published TypeScript face
 * (`../ai.ts`) and taught by that package's README — and `AnyComponentSchema`
 * carried no arm for any of them, so `safeValidateSchema` refused every
 * document naming one with `invalid_union` at `type`. The README's own
 * "Schema-Driven Usage" document was refused, and `objectui validate` printed
 * "Schema validation failed" for it.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME and vitest
 * reads them. A green run of either one alone says nothing about the other.
 *
 * ## What the parity half asserts
 *
 * For every member the TypeScript declaration declares, the arm's INPUT type
 * for that member is invariantly equal to the declaration's — with exactly the
 * objectui#6124 exception: a RUNTIME SLOT, whose TypeScript twin is the callable
 * its component invokes while the zod face refuses an authored value by name.
 * When this file was written every `on*` member was an exception of a different
 * kind: the TypeScript face declared all five `string`, the handler-expression
 * dialect objectui#6182 withdrew on EITHER face, and that divergence was pinned
 * both ways so that a repair of the TypeScript face would redden this file.
 * objectui#10874 made that repair per key — `?: never` for the two keys nothing
 * reads, the callable for the three runtime slots — and the pins below record
 * the settled shape.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AIConfigSchema,
  AIFieldSuggestionSchema,
  AIFormAssistSchema,
  AIRecommendationItemSchema,
  AIRecommendationsSchema,
  NLQueryResultSchema,
  NLQuerySchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type {
  AIConfig as Ts_AIConfig,
  AIFieldSuggestion as Ts_AIFieldSuggestion,
  AIFormAssistSchema as Ts_AIFormAssistSchema,
  AIRecommendationItem as Ts_AIRecommendationItem,
  AIRecommendationsSchema as Ts_AIRecommendationsSchema,
  NLQueryResult as Ts_NLQueryResult,
  NLQuerySchema as Ts_NLQuerySchema,
} from '../ai';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The mirror's own shape. */
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
/** The declaration's DECLARED keys — any index signature dropped (`BaseSchema` carried one until objectui#8347). */
type DeclaredKeys<D> = Extract<
  keyof { [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K] },
  string
>;
/** The mirror's declared keys, read from its own shape. */
type MirroredKeys<M> = Extract<keyof ShapeOf<M>, string>;

/** Declared members whose accepted type differs from the declaration's. */
type MismatchedKeys<M, D> = {
  [K in DeclaredKeys<D> & MirroredKeys<M>]: Equal<InputOf<ShapeOf<M>[K]>, D[K]> extends true ? never : K;
}[DeclaredKeys<D> & MirroredKeys<M>];

/** Every arm and sub-schema declares exactly the declaration's key set — none added, none dropped. */
export type assertionKeySetsAgree = [
  Expect<Equal<MirroredKeys<typeof AIFormAssistSchema>, DeclaredKeys<Ts_AIFormAssistSchema>>>,
  Expect<Equal<MirroredKeys<typeof AIRecommendationsSchema>, DeclaredKeys<Ts_AIRecommendationsSchema>>>,
  Expect<Equal<MirroredKeys<typeof NLQuerySchema>, DeclaredKeys<Ts_NLQuerySchema>>>,
  Expect<Equal<MirroredKeys<typeof AIConfigSchema>, DeclaredKeys<Ts_AIConfig>>>,
  Expect<Equal<MirroredKeys<typeof AIFieldSuggestionSchema>, DeclaredKeys<Ts_AIFieldSuggestion>>>,
  Expect<Equal<MirroredKeys<typeof AIRecommendationItemSchema>, DeclaredKeys<Ts_AIRecommendationItem>>>,
  Expect<Equal<MirroredKeys<typeof NLQueryResultSchema>, DeclaredKeys<Ts_NLQueryResult>>>,
];

/**
 * Every member's accepted type equals the declaration's — the four sub-schemas
 * and the form-assist arm with no exception, the other two arms with exactly
 * their objectui#6124 runtime slots excepted (objectui#10874).
 */
export type assertionMemberTypesAgree = [
  Expect<Equal<MismatchedKeys<typeof AIConfigSchema, Ts_AIConfig>, never>>,
  Expect<Equal<MismatchedKeys<typeof AIFieldSuggestionSchema, Ts_AIFieldSuggestion>, never>>,
  Expect<Equal<MismatchedKeys<typeof AIRecommendationItemSchema, Ts_AIRecommendationItem>, never>>,
  Expect<Equal<MismatchedKeys<typeof NLQueryResultSchema, Ts_NLQueryResult>, never>>,
  Expect<Equal<MismatchedKeys<typeof AIFormAssistSchema, Ts_AIFormAssistSchema>, never>>,
  Expect<Equal<MismatchedKeys<typeof AIRecommendationsSchema, Ts_AIRecommendationsSchema>, 'onSelect' | 'onDismiss'>>,
  Expect<Equal<MismatchedKeys<typeof NLQuerySchema, Ts_NLQuerySchema>, 'onSubmit'>>,
];

/**
 * The handler members, both halves — SETTLED per key since objectui#10874. This
 * was `assertionHandlerDivergence`: the TypeScript face typed each `string`
 * while the zod face accepted nothing but absence, and the first half was
 * written to go red when the TypeScript face was repaired. objectui#10874
 * repaired it by the objectui#6124 rule: the two keys nothing reads are
 * `?: never` (both faces refuse them), and the three RUNTIME SLOTS declare the
 * callable their component invokes while the zod face keeps refusing an
 * authored value. Re-widening either face — a `string` back on the TypeScript
 * side, a tombstone on a slot a component calls, an accepting arm on the zod
 * side — reddens a row.
 */
export type assertionHandlerFacesSettled = [
  Expect<Equal<Ts_AIFormAssistSchema['onApplySuggestion'], undefined>>,
  Expect<Equal<Ts_AIFormAssistSchema['onRejectSuggestion'], undefined>>,
  Expect<Equal<Ts_AIRecommendationsSchema['onSelect'], ((item: Ts_AIRecommendationItem) => void) | undefined>>,
  Expect<Equal<Ts_AIRecommendationsSchema['onDismiss'], ((item: Ts_AIRecommendationItem) => void) | undefined>>,
  Expect<Equal<Ts_NLQuerySchema['onSubmit'], ((query: string) => void) | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIFormAssistSchema>['onApplySuggestion']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIFormAssistSchema>['onRejectSuggestion']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIRecommendationsSchema>['onSelect']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIRecommendationsSchema>['onDismiss']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof NLQuerySchema>['onSubmit']>, undefined>>,
];

/**
 * Non-vacuity: the comparison can fail. A member typed differently on the two
 * sides is reported by name, and an unmirrored key is caught by the key-set row.
 */
export type assertionInstrumentFires = [
  Expect<Equal<MismatchedKeys<z.ZodObject<{ a: z.ZodString }>, { a: number }>, 'a'>>,
  Expect<Equal<Equal<MirroredKeys<z.ZodObject<{ a: z.ZodString }>>, DeclaredKeys<{ a: string; b: string }>>, false>>,
];

/* ── Runtime: the documents that were refused ────────────────────────────── */

/** One minimal document per armed key — the `type` alone. */
const MINIMAL = [
  { type: 'ai-form-assist' },
  { type: 'ai-recommendations' },
  { type: 'nl-query' },
] as const;

/** Rooted on this file, never on `process.cwd()` (AGENTS.md, test path roots). */
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_AI_README = join(HERE, '..', '..', '..', 'plugin-ai', 'README.md');

/**
 * The document `packages/plugin-ai/README.md` teaches under "Schema-Driven
 * Usage", read off the README itself so the pin follows the page rather than a
 * copy of it.
 */
function readmeFormAssistDocument(): Record<string, unknown> {
  const readme = readFileSync(PLUGIN_AI_README, 'utf8');
  const section = readme.slice(readme.indexOf('## Schema-Driven Usage'));
  const fence = /```json\n([\s\S]*?)\n```/.exec(section);
  if (!fence) throw new Error('no ```json fence under "## Schema-Driven Usage" in plugin-ai/README.md');
  return JSON.parse(fence[1]) as Record<string, unknown>;
}

describe('the registered AI node types validate (objectui#10859)', () => {
  it.each(MINIMAL)('$type is accepted by safeValidateSchema', (doc) => {
    const result = safeValidateSchema(doc);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it.each(MINIMAL)('$type is accepted by the strict authoring face', (doc) => {
    const result = StrictAnyComponentSchema.safeParse(doc);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it("accepts the plugin-ai README's `ai-form-assist` document on both faces", () => {
    const doc = readmeFormAssistDocument();
    // Lit control on the extraction: the fence really is the taught document.
    expect(doc.type).toBe('ai-form-assist');
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);
  });

  it('accepts a fully populated document of each type', () => {
    // `config` and `context` left these documents with objectui#10874, which
    // retired both on both faces; their refusal is pinned in
    // `ai-node-faces-agree-10874.test.ts`, beside this file.
    const docs = [
      {
        type: 'ai-form-assist',
        suggestions: [{ fieldName: 'company', value: 'ObjectStack', confidence: 0.9, reasoning: 'domain' }],
        showConfidence: true,
        showReasoning: false,
      },
      {
        type: 'ai-recommendations',
        recommendations: [
          { id: 'r1', title: 'Renew', score: 0.8, category: 'sales', metadata: { a: 1 }, action: { type: 'open', target: 'r1' } },
        ],
        showScores: true,
        layout: 'grid',
        loading: false,
        emptyMessage: 'Nothing yet',
      },
      {
        type: 'nl-query',
        placeholder: 'Ask anything',
        result: { query: 'q', data: [{ a: 1 }], columns: [{ name: 'a', label: 'A', type: 'number' }], summary: 's', confidence: 0.5 },
        suggestions: ['top accounts'],
        showHistory: true,
        history: [{ query: 'q', timestamp: '2026-09-27T00:00:00Z' }],
        loading: false,
      },
    ];
    for (const doc of docs) {
      expect(safeValidateSchema(doc).success, doc.type).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(doc).success, doc.type).toBe(true);
    }
  });
});

describe('the arms are closed where the declaration is (objectui#10859)', () => {
  it('refuses an undeclared member on the strict face, naming it — the strictness control', () => {
    const doc = { type: 'nl-query', placeholder: 'Ask', inventedKey: true };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, JSON.stringify(strict.error.issues)).toBeDefined();
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey']);
    // The rendering face keeps its `.passthrough()` — the second face is the
    // one that closes, exactly as for every other arm.
    expect(safeValidateSchema(doc).success).toBe(true);
  });

  it.each([
    ['ai-form-assist', 'formId', 'new-contact'],
    ['ai-form-assist', 'objectName', 'Contact'],
    ['ai-form-assist', 'fields', ['name']],
    ['ai-form-assist', 'autoFill', true],
    ['ai-recommendations', 'objectName', 'Product'],
    ['ai-recommendations', 'maxResults', 5],
    ['nl-query', 'objectName', 'Order'],
  ] as const)('%s refuses the objectui#8178 tombstone `%s` by name', (type, key, value) => {
    const result = safeValidateSchema({ type, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    const [issue] = result.error.issues;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#8178');
    expect(issue.message).toContain(`\`${key}\``);
  });

  it.each([
    ['ai-form-assist', 'onApplySuggestion', 'RETIRED'],
    ['ai-form-assist', 'onRejectSuggestion', 'RETIRED'],
    ['ai-recommendations', 'onSelect', 'RUNTIME SLOT'],
    ['ai-recommendations', 'onDismiss', 'RUNTIME SLOT'],
    ['nl-query', 'onSubmit', 'RUNTIME SLOT'],
  ] as const)('%s refuses an authored handler string on `%s` (objectui#6182 / #6124, %s)', (type, key, disposition) => {
    const result = safeValidateSchema({ type, [key]: 'handleIt' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const [issue] = result.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain(disposition);
  });

  it.each(['ai-form-assist', 'ai-recommendations', 'nl-query'])('%s refuses both content channels (objectui#9256 family D)', (type) => {
    for (const key of ['body', 'children'] as const) {
      const result = safeValidateSchema({ type, [key]: [{ type: 'text', content: 'x' }] });
      expect(result.success, `${type}.${key}`).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0].path).toEqual([key]);
      expect(result.error.issues[0].message).toContain('objectui#9256');
    }
  });

  it('refuses the objectui#10330 retired `carousel` layout value', () => {
    const result = safeValidateSchema({ type: 'ai-recommendations', layout: 'carousel' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(['layout']);
  });
});
