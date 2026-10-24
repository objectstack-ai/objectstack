/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The seven zero-read members of the three AI schemas are ADR-0049 RETIREMENT
 * TOMBSTONES (objectui#8178, director decision batch #78, 2026-09-07,
 * maintainer verbatim 「同意」), and their refusal is TYPE-LEVEL ONLY.
 *
 * ## The seven, and what was measured on each
 *
 * `AIFormAssistSchema.formId` / `.objectName` / `.fields` / `.autoFill`,
 * `AIRecommendationsSchema.objectName` / `.maxResults`, `NLQuerySchema.objectName`.
 * Each was declared by this file's neighbour `../ai`, five of the names were
 * offered as designer `inputs` by `@object-ui/plugin-ai`'s registrations
 * (seven entries across the three), all seven were taught by that package's
 * README — and no component read any of them.
 *
 * The census was re-derived on this branch's base rather than inherited, per
 * key, with a LIT CONTROL beside every zero so a nil reading cannot be a broken
 * matcher (`git grep -c -w KEY` over the component that each schema drives):
 *
 *   | schema             | zero reads                              | lit control                                    |
 *   |--------------------|-----------------------------------------|------------------------------------------------|
 *   | `AIFormAssist`     | `formId` 0, `objectName` 0, `fields` 0  | `suggestions` 9, `showConfidence` 2            |
 *   | `AIFormAssist`     | `autoFill` 1 — the destructure, unused  | `showReasoning` 2 (destructure PLUS a read)    |
 *   | `AIRecommendations`| `objectName` 0, `maxResults` 0          | `recommendations` 8, `showScores` 2, `layout` 2|
 *   | `NLQueryInput`     | `objectName` 0                          | `placeholder` 2, `result` 14, `history` 3      |
 *
 * Two channels that could have consumed a key WITHOUT naming it were measured
 * too, because "no `schema.KEY` read site" does not imply inert (objectui#8410):
 * `@object-ui/plugin-ai` has zero `{...props}` / `{...rest}` spreads in all
 * four of its sources (control: `components/src/renderers/disclosure/collapsible.tsx`
 * matches the same two patterns once), and zero dynamic `schema[…]` access
 * (control: four files under `packages/` do use that form). The shared
 * record-source ladder that reads `schema.objectName` structurally for the
 * grid/tree/map/calendar/gantt blocks is not reachable either — none of its
 * call sites takes an AI schema, and this package imports nothing from
 * `@object-ui/core` except `ComponentRegistry`.
 *
 * ## Why tombstones and not deletions — the carrier decides
 *
 * All three schemas extend {@link BaseSchema}, which carried
 * `[key: string]: any` when this was written. On such a carrier a DELETED
 * optional member was absorbed silently at any value: the index signature
 * defeated excess-property checking on a fresh literal and the weak-type check
 * on a widened one (since objectui#8347 a fresh literal is refused, and a
 * widened value still rides through). Deletion would
 * therefore have left exactly the silent no-op the retirement exists to end,
 * and the ruling's first pin — *refused by the schema types (compile-time)* —
 * would have been unsatisfiable. The routes are loud-vs-silent here, not
 * louder-vs-quieter, which is the discriminator's carrier branch as corrected
 * on objectui#7678; PRONG 2 licenses it independently, since
 * `packages/plugin-ai/README.md` taught every one of the seven as working.
 *
 * The `@ts-expect-error` directives below are REAL enforcement: this package
 * type-checks its tests through `tsconfig.test.json`, which its `type-check`
 * script chains, so re-widening any of the seven fails on the now-unused
 * directive. A green `vitest` run says nothing about them — type assertions are
 * erased before it runs. The "deleted" row is pinned LIVE, as an undeclared key
 * carrying no directive, so the contrast cannot rot into prose.
 *
 * ⛔ Not Enforce. Implementing reads nobody asked for is capability growth
 * without pull; an AI backend that later needs `objectName` / `fields` as
 * context is a feature card with its own business case.
 */

import { describe, it, expect } from 'vitest';
import type {
  AIFieldSuggestion,
  AIFormAssistSchema,
  AIRecommendationItem,
  AIRecommendationsSchema,
  NLQuerySchema,
} from '../ai';

/* ── type-level pins: the `tsc` channel ──────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * What each retired member READS as under the tombstone: `undefined`, not
 * `never` — `?: never` without `exactOptionalPropertyTypes` is
 * `never | undefined`, which collapses. `Equal` still separates that from the
 * `any` a DELETION leaves behind on this carrier, so every row below reddens on
 * a deletion as well as on a re-widening.
 */
export type assertionRetiredMembersReadAsTombstones = [
  Expect<Equal<AIFormAssistSchema['formId'], undefined>>,
  Expect<Equal<AIFormAssistSchema['objectName'], undefined>>,
  Expect<Equal<AIFormAssistSchema['fields'], undefined>>,
  Expect<Equal<AIFormAssistSchema['autoFill'], undefined>>,
  Expect<Equal<AIRecommendationsSchema['objectName'], undefined>>,
  Expect<Equal<AIRecommendationsSchema['maxResults'], undefined>>,
  Expect<Equal<NLQuerySchema['objectName'], undefined>>,
];

/**
 * The non-vacuity twin of the block above: keys the components DO read still
 * carry their real types, so the seven rows are a measurement of those seven
 * members and not of a file that stopped resolving.
 */
export type assertionLiveMembersKeepTheirTypes = [
  Expect<Equal<AIFormAssistSchema['showConfidence'], boolean | undefined>>,
  Expect<Equal<AIRecommendationsSchema['layout'], 'list' | 'grid' | undefined>>,
  Expect<Equal<NLQuerySchema['showHistory'], boolean | undefined>>,
];

/**
 * ⚠️ The `AIInsightsSchema.objectName` EXCLUSION that used to be pinned here is
 * REWRITTEN BY RULING, and this paragraph is what it was rewritten into.
 *
 * What stood here was a type-level `Equal` holding that member at
 * string-or-undefined, with the reason that objectui#8178's ruling named three
 * schemas and that fourth one "was neither screened nor decided". Both halves of
 * that reason have since been discharged: objectui#8800 screened it and the
 * director seat decided it (decision batch #137 item 2, 2026-09-15, maintainer
 * verbatim 「同意」, letter A), retiring `AIInsightsSchema` and the `ai-insights`
 * node type WHOLE from the published type face under ADR-0049. The member is not
 * reachable to be pinned, because the interface that declared it is gone.
 *
 * ⛔ That exclusion changed by RULING, ⛔ never by refactor — which is exactly what
 * the note it replaces existed to enforce, and the authorisation is on
 * objectui#8800 in those words. ⛔ It authorises this paragraph and nothing else
 * in this file: the seven tombstones below are objectui#8178's, they are
 * untouched, and no part of that retirement moves with this one.
 *
 * The successor pin — the symbol's absence, the spelling's absence, and the lit
 * controls that keep both from passing vacuously — is
 * `ai-insights-retired-8800.test.ts`, beside this file.
 */

const suggestions: AIFieldSuggestion[] = [
  { fieldName: 'company', value: 'ObjectStack Inc.', confidence: 0.92 },
];
const recommendations: AIRecommendationItem[] = [{ id: 'r1', title: 'Renew', score: 0.8 }];

describe('the seven tombstones make authoring a `tsc` error, on a fresh literal', () => {
  it('refuses all four retired `ai-form-assist` members — presence is the error, not the value', () => {
    const node: AIFormAssistSchema = {
      type: 'ai-form-assist',
      suggestions,
      // @ts-expect-error `formId` is a retirement tombstone (objectui#8178) — the host owns the form
      formId: 'new-contact',
      // @ts-expect-error `objectName` is a retirement tombstone (objectui#8178) — nothing read it
      objectName: 'Contact',
      // @ts-expect-error `fields` is a retirement tombstone (objectui#8178) — each suggestion names its own `fieldName`
      fields: ['name', 'email'],
      // @ts-expect-error `autoFill` is a retirement tombstone (objectui#8178) — apply suggestions through `onApply`
      autoFill: true,
    };
    expect(node.type).toBe('ai-form-assist');
  });

  it('refuses both retired `ai-recommendations` members', () => {
    const node: AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations,
      // @ts-expect-error `objectName` is a retirement tombstone (objectui#8178)
      objectName: 'Product',
      // @ts-expect-error `maxResults` is a retirement tombstone (objectui#8178) — every item is rendered; slice before handing over
      maxResults: 5,
    };
    expect(node.type).toBe('ai-recommendations');
  });

  it('refuses the retired `nl-query` member', () => {
    const node: NLQuerySchema = {
      type: 'nl-query',
      placeholder: 'Ask anything...',
      // @ts-expect-error `objectName` is a retirement tombstone (objectui#8178) — scope the query in the host that answers it
      objectName: 'Order',
    };
    expect(node.type).toBe('nl-query');
  });

  it('refuses a WRONG-TYPED value too — the row that goes silent under deletion', () => {
    const node: AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations,
      // @ts-expect-error `maxResults` is a retirement tombstone (objectui#8178)
      maxResults: 'five',
    };
    expect(node.type).toBe('ai-recommendations');
  });
});

describe('the tombstones survive the shape no excess-property check reaches', () => {
  it('refuses a WIDENED value carrying a retired key, on each of the three schemas', () => {
    const rawAssist = { type: 'ai-form-assist' as const, suggestions, formId: 'new-lead' };
    // @ts-expect-error `formId` is a retirement tombstone (objectui#8178), reached through a widened value
    const assist: AIFormAssistSchema = rawAssist;
    const rawRecs = { type: 'ai-recommendations' as const, recommendations, maxResults: 10 };
    // @ts-expect-error `maxResults` is a retirement tombstone (objectui#8178), reached through a widened value
    const recs: AIRecommendationsSchema = rawRecs;
    const rawQuery = { type: 'nl-query' as const, objectName: 'Order' };
    // @ts-expect-error `objectName` is a retirement tombstone (objectui#8178), reached through a widened value
    const query: NLQuerySchema = rawQuery;
    expect([assist.type, recs.type, query.type]).toEqual([
      'ai-form-assist',
      'ai-recommendations',
      'nl-query',
    ]);
  });
});

describe('the controls — without these, a broken import would satisfy every pin above', () => {
  it('keeps every key the three components DO read writable', () => {
    const assist: AIFormAssistSchema = {
      type: 'ai-form-assist',
      suggestions,
      showConfidence: true,
      showReasoning: false,
    };
    const recs: AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations,
      showScores: true,
      layout: 'grid',
      loading: false,
      emptyMessage: 'Nothing yet',
    };
    const query: NLQuerySchema = {
      type: 'nl-query',
      placeholder: 'Ask anything...',
      suggestions: ['Recent orders'],
      showHistory: true,
      history: [{ query: 'Recent orders', timestamp: '2026-09-09T00:00:00.000Z' }],
    };
    expect([assist.showConfidence, recs.layout, query.showHistory]).toEqual([true, 'grid', true]);
  });

  it('an UNDECLARED key is refused on a fresh literal, and still rides a widened value — the DELETED row, live', () => {
    // This is where each of the seven would sit had it been deleted instead of
    // tombstoned. Until objectui#8347 `BaseSchema`'s `[key: string]: any`
    // absorbed it at any value in every shape, so a deletion produced no
    // diagnostic at all. The signature is gone: a fresh literal is refused,
    // with no name for the remedy, while a value that reached its annotation
    // through a wider variable is still not re-checked (no excess-property
    // check on a non-fresh object). The tombstone is what refuses both.
    // @ts-expect-error — `AIFormAssistSchema` declares no `bogusUndeclared` (objectui#8347)
    const fresh: AIFormAssistSchema = { type: 'ai-form-assist', suggestions, bogusUndeclared: 1 };
    const raw = { type: 'ai-recommendations' as const, recommendations, bogusUndeclared: 1 };
    const widened: AIRecommendationsSchema = raw;
    expect([fresh.type, widened.type]).toEqual(['ai-form-assist', 'ai-recommendations']);
  });

  it('…and the same undeclared key IS refused on a carrier without an index signature — the instrument control', () => {
    // `AIFieldSuggestion` and `AIRecommendationItem` declare no index
    // signature, so the compiler's two ordinary guards fire here: excess-property
    // checking on a fresh literal (TS2353) and the weak-type check on a
    // lone-key widened value (TS2559). Their firing proved the silence above
    // was the index signature and not a blind run; since objectui#8347 the only
    // silence left above is the widened value's (no excess-property check on a
    // non-fresh object).
    const fresh: AIFieldSuggestion = {
      fieldName: 'company',
      value: 'ObjectStack Inc.',
      confidence: 0.92,
      // @ts-expect-error TS2353 — `AIFieldSuggestion` has no index signature, so a fresh undeclared key is refused
      bogusUndeclared: 1,
    };
    const loneKey = { bogusUndeclared: 1 };
    // @ts-expect-error TS2559 — the weak-type check fires on a lone-key widened value without an index signature
    const widened: AIRecommendationItem = loneKey;
    expect(fresh.fieldName).toBe('company');
    expect(widened).toBeDefined();
  });
});
