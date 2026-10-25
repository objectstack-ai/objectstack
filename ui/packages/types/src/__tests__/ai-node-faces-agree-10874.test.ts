/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The three `@object-ui/plugin-ai` node declarations stop offering members no
 * runtime honours, and type the handler slots their components call
 * (objectui#10874).
 *
 * ## The defect these pin
 *
 * `AIFormAssistSchema`, `AIRecommendationsSchema` and `NLQuerySchema` (`../ai.ts`)
 * offered an author two kinds of member that nothing honoured:
 *
 *   - five `on*` members typed `string` — `onApplySuggestion`,
 *     `onRejectSuggestion`, `onSelect`, `onDismiss`, `onSubmit` — the
 *     handler-expression dialect objectui#6182 withdrew on either face. The zod
 *     arms objectui#10859 wrote refuse all five by name (`handlerKeyRefusal`), so
 *     `onSelect: 'x'` passed `tsc` and was refused by `safeValidateSchema`. For
 *     the three a component CALLS (`onSelect`, `onDismiss`, `onSubmit` — the
 *     registration is the raw component and `SchemaRenderer` spreads the node's
 *     keys onto its props) that string was called as a function and threw;
 *   - `config` (all three) and `context` (two of them), read by nothing in
 *     `@object-ui/plugin-ai` — the components are presentation only and call no
 *     model — and accepted by BOTH faces, so a `config: { … }` passed `tsc`,
 *     parsed green and changed nothing.
 *
 * The ruling on objectui#10874 settles it per key, by the objectui#6124 rule
 * ("a function type only where a runtime consumer reads the key as a function,
 * else `?: never`", as `handler-keys-string-any-mirrors-7344.test.ts` quotes
 * it):
 *
 *   - `onSelect` / `onDismiss` / `onSubmit` are RUNTIME SLOTS: the TypeScript
 *     twin declares the callable the component invokes, and the zod face keeps
 *     refusing an authored value by name — the objectui#6124 shape;
 *   - `onApplySuggestion` / `onRejectSuggestion` have no reader: `?: never`;
 *   - `config` / `context` retire on both faces, with a refusal that says what
 *     to do instead — configure the model in the host's own AI service
 *     (ObjectUI has no AI-provider API) and hand its output to the node.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` aliases and the `@ts-expect-error` directives are
 * TYPE-level: `tsc -p tsconfig.test.json` (the third leg of this package's
 * `type-check` script) reads them, and a re-widened member fails there — on an
 * unused directive or on a `false` row. vitest strips types and reads none of
 * it. The `safeValidateSchema` / `StrictAnyComponentSchema` rows are RUNTIME and
 * vitest reads them. A green run of either one alone says nothing about the
 * other.
 *
 * The runtime refusal of the five `on*` members is not re-pinned here: it
 * predates this card and is `ai-zod-arms-10859.test.ts`'s, beside this file,
 * whose `assertionHandlerFacesSettled` pins both faces of all five together.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  AIFormAssistSchema,
  AIRecommendationsSchema,
  NLQuerySchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type {
  AIFieldSuggestion,
  AIFormAssistSchema as Ts_AIFormAssistSchema,
  AIRecommendationItem,
  AIRecommendationsSchema as Ts_AIRecommendationsSchema,
  NLQueryResult,
  NLQuerySchema as Ts_NLQuerySchema,
} from '../ai';

/* ── Type-level pins: the `tsc` channel ────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type ShapeOf<M> = M extends { shape: infer S } ? S : never;
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;

/**
 * Each retired member READS as `undefined` on the TypeScript face — `?: never`
 * without `exactOptionalPropertyTypes` is `never | undefined`, which collapses.
 * `Equal` separates that from the `string` the two retired `on*` members
 * carried, from the `AIConfig` / record types `config` / `context` carried, and
 * from the `any` a DELETION would leave on this `BaseSchema`-derived carrier.
 */
export type assertionRetiredMembersReadAsTombstones = [
  Expect<Equal<Ts_AIFormAssistSchema['config'], undefined>>,
  Expect<Equal<Ts_AIFormAssistSchema['context'], undefined>>,
  Expect<Equal<Ts_AIFormAssistSchema['onApplySuggestion'], undefined>>,
  Expect<Equal<Ts_AIFormAssistSchema['onRejectSuggestion'], undefined>>,
  Expect<Equal<Ts_AIRecommendationsSchema['config'], undefined>>,
  Expect<Equal<Ts_AIRecommendationsSchema['context'], undefined>>,
  Expect<Equal<Ts_NLQuerySchema['config'], undefined>>,
];

/**
 * The three RUNTIME SLOTS declare the callable their component invokes — the
 * signature of `AIRecommendationsProps.onSelect` / `.onDismiss` and
 * `NLQueryInputProps.onSubmit` — not the `string` they carried, and not a
 * tombstone: a function on the node IS called at run time.
 */
export type assertionRuntimeSlotsAreCallable = [
  Expect<Equal<Ts_AIRecommendationsSchema['onSelect'], ((item: AIRecommendationItem) => void) | undefined>>,
  Expect<Equal<Ts_AIRecommendationsSchema['onDismiss'], ((item: AIRecommendationItem) => void) | undefined>>,
  Expect<Equal<Ts_NLQuerySchema['onSubmit'], ((query: string) => void) | undefined>>,
];

/** The zod face agrees for `config` / `context`: each arm accepts nothing but absence. */
export type assertionZodFaceRefusesConfigAndContext = [
  Expect<Equal<InputOf<ShapeOf<typeof AIFormAssistSchema>['config']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIFormAssistSchema>['context']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIRecommendationsSchema>['config']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof AIRecommendationsSchema>['context']>, undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof NLQuerySchema>['config']>, undefined>>,
];

/**
 * The non-vacuity twin: members the components DO read keep their real types on
 * both faces, so the rows above measure those members and not a file that
 * stopped resolving.
 */
export type assertionLiveMembersKeepTheirTypes = [
  Expect<Equal<Ts_AIFormAssistSchema['suggestions'], AIFieldSuggestion[] | undefined>>,
  Expect<Equal<Ts_AIRecommendationsSchema['recommendations'], AIRecommendationItem[] | undefined>>,
  Expect<Equal<Ts_NLQuerySchema['result'], NLQueryResult | undefined>>,
  Expect<Equal<InputOf<ShapeOf<typeof NLQuerySchema>['placeholder']>, string | undefined>>,
];

/* ── The `tsc` half on a fresh literal and on a widened value ─────────────── */

const suggestions: AIFieldSuggestion[] = [{ fieldName: 'company', value: 'ObjectStack Inc.', confidence: 0.92 }];
const recommendations: AIRecommendationItem[] = [{ id: 'r1', title: 'Renew', score: 0.8 }];

describe('authoring a retired AI member, or a string on a runtime slot, is a `tsc` error (objectui#10874)', () => {
  it('refuses all four on `ai-form-assist` — presence is the error, not the value', () => {
    const node: Ts_AIFormAssistSchema = {
      type: 'ai-form-assist',
      suggestions,
      // @ts-expect-error `config` is retired (objectui#10874) — configure the model in the host's AI service
      config: { provider: 'openai', model: 'gpt-4' },
      // @ts-expect-error `context` is retired (objectui#10874) — pass it to the host's AI service
      context: { record: 'r1' },
      // @ts-expect-error `onApplySuggestion` is retired (objectui#10874) — pass `onApply` as a component prop
      onApplySuggestion: 'apply',
      // @ts-expect-error `onRejectSuggestion` is retired (objectui#10874) — nothing reads it
      onRejectSuggestion: 'reject',
    };
    expect(node.type).toBe('ai-form-assist');
  });

  it('refuses `config` / `context`, and a STRING on either runtime slot, on `ai-recommendations`', () => {
    const node: Ts_AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations,
      // @ts-expect-error `config` is retired (objectui#10874) — configure the model in the host's AI service
      config: { provider: 'anthropic' },
      // @ts-expect-error `context` is retired (objectui#10874) — pass it to the host's AI service
      context: { segment: 'smb' },
      // @ts-expect-error `onSelect` is a RUNTIME SLOT (objectui#10874) — a string is not the callable it invokes
      onSelect: 'select',
      // @ts-expect-error `onDismiss` is a RUNTIME SLOT (objectui#10874) — a string is not the callable it invokes
      onDismiss: 'dismiss',
    };
    expect(node.type).toBe('ai-recommendations');
  });

  it('refuses `config`, and a STRING on the runtime slot, on `nl-query`', () => {
    const node: Ts_NLQuerySchema = {
      type: 'nl-query',
      placeholder: 'Ask anything',
      // @ts-expect-error `config` is retired (objectui#10874) — configure the model in the host's AI service
      config: { temperature: 0.2 },
      // @ts-expect-error `onSubmit` is a RUNTIME SLOT (objectui#10874) — a string is not the callable it invokes
      onSubmit: 'submit',
    };
    expect(node.type).toBe('nl-query');
  });

  it('ACCEPTS a function on each runtime slot — the control that the slots are callable, not tombstones', () => {
    const picked: string[] = [];
    const recs: Ts_AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations,
      onSelect: (item) => picked.push(`select:${item.id}`),
      onDismiss: (item) => picked.push(`dismiss:${item.id}`),
    };
    const query: Ts_NLQuerySchema = { type: 'nl-query', onSubmit: (text) => picked.push(`submit:${text}`) };
    recs.onSelect?.(recommendations[0]);
    recs.onDismiss?.(recommendations[0]);
    query.onSubmit?.('top accounts');
    expect(picked).toEqual(['select:r1', 'dismiss:r1', 'submit:top accounts']);
  });

  it('refuses a WIDENED value too — the shape no excess-property check reaches', () => {
    const rawAssist = { type: 'ai-form-assist' as const, suggestions, config: { model: 'gpt-4' } };
    // @ts-expect-error `config` is retired (objectui#10874), reached through a widened value
    const assist: Ts_AIFormAssistSchema = rawAssist;
    const rawRecs = { type: 'ai-recommendations' as const, recommendations, onSelect: 'select' };
    // @ts-expect-error `onSelect` is a RUNTIME SLOT (objectui#10874): a widened string is still refused
    const recs: Ts_AIRecommendationsSchema = rawRecs;
    const rawQuery = { type: 'nl-query' as const, onSubmit: 'submit' };
    // @ts-expect-error `onSubmit` is a RUNTIME SLOT (objectui#10874): a widened string is still refused
    const query: Ts_NLQuerySchema = rawQuery;
    expect([assist.type, recs.type, query.type]).toEqual(['ai-form-assist', 'ai-recommendations', 'nl-query']);
  });
});

/* ── The runtime half: `config` / `context` refused by name, with the prescription ── */

describe('the zod face refuses `config` / `context` by name (objectui#10874)', () => {
  const CASES = [
    ['ai-form-assist', 'config', { provider: 'openai', model: 'gpt-4' }],
    ['ai-form-assist', 'context', { record: 'r1' }],
    ['ai-recommendations', 'config', { provider: 'anthropic' }],
    ['ai-recommendations', 'context', { segment: 'smb' }],
    ['nl-query', 'config', { temperature: 0.2 }],
  ] as const;

  it.each(CASES)('%s refuses `%s` on the rendering face', (type, key, value) => {
    const result = safeValidateSchema({ type, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    const [issue] = result.error.issues;
    expect(issue.code).toBe('invalid_type');
    expect(issue.path).toEqual([key]);
    // The refusal names the key and carries the prescription — the host's own
    // AI service — which is the half a bare `z.never()` would drop.
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain('objectui#10874');
    expect(issue.message).toContain("host's own AI service");
  });

  it.each(CASES)('%s refuses `%s` on the strict authoring face', (type, key, value) => {
    const result = StrictAnyComponentSchema.safeParse({ type, [key]: value });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path[0])).toContain(key);
  });

  it('accepts each node WITHOUT them, on both faces — the control', () => {
    const docs = [
      { type: 'ai-form-assist', suggestions, showConfidence: true },
      { type: 'ai-recommendations', recommendations, layout: 'grid' },
      { type: 'nl-query', placeholder: 'Ask anything', showHistory: false },
    ];
    for (const doc of docs) {
      const loose = safeValidateSchema(doc);
      expect(loose.success, JSON.stringify(loose.success ? null : loose.error.issues)).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(doc).success, doc.type).toBe(true);
    }
  });
});
