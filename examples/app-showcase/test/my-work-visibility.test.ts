// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { MyWorkPage } from '../src/ui/pages/index.js';

/**
 * Dogfood gate for the My Work page's admin-only card (objectstack#6274).
 *
 * ADR-0089 makes `visibleWhen` the one conditional-visibility predicate, and on
 * a page it is a **component-level** key — a sibling of `properties`, not a key
 * inside it. `properties` is the widget's own prop bag (`PageCardProps` in
 * `ComponentPropsMap`), which declares no visibility key at all; a predicate
 * written there rendered correctly only because objectui's `SchemaRenderer`
 * hoists every `properties` entry onto the node before evaluating visibility.
 * That is a renderer accident, not a contract — and #5068's
 * `component-props-unknown-key` gate reported it as exactly that.
 *
 * These assertions pin the shape AND the semantics, so neither half can regress
 * silently:
 *  - the predicate lives at the component level and NO `page:card` carries a
 *    visibility key inside `properties` again;
 *  - the binding root is `current_user` — the identity root ADR-0089 declares
 *    for page-component predicates (`record`, `current_user`, `page.<var>`).
 *    Measured in a browser against the pinned console (objectui `7dfbeb70`) on
 *    2026-08-08: as `admin@objectos.ai` the card renders, as a non-admin it does
 *    not. A `data.`-rooted spelling (the metadata-form root) would never match;
 *  - the predicate actually gates the way the page's own comment claims.
 */

type AnyComponent = {
  type: string;
  visibleWhen?: unknown;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
};

/** Flatten every component across the page's regions. */
function allComponents(): AnyComponent[] {
  const out: AnyComponent[] = [];
  for (const region of MyWorkPage.regions ?? []) {
    for (const c of region.components ?? []) out.push(c as AnyComponent);
  }
  return out;
}

/** CEL source, whether stored bare or as the normalized `{ dialect, source }`. */
function predicateSource(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { source?: unknown }).source === 'string') {
    return (v as { source: string }).source;
  }
  return undefined;
}

/** Evaluate the card's comparison-only predicate against a bound scope. */
function evalPredicate(source: string, scope: Record<string, unknown>): boolean {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('current_user', `"use strict"; return (${source});`) as (
    u: unknown,
  ) => boolean;
  return Boolean(fn(scope.current_user));
}

const leadershipCard = () =>
  allComponents().find(
    (c) => c.type === 'page:card' && c.properties?.title === 'Leadership View',
  );

const workQueueGrid = () => allComponents().find((c) => c.type === 'object-grid');

/**
 * The two non-canonical spellings this grid must not carry — and the DIFFERENT
 * reason each one is absent. They share an assertion; they must never share a
 * justification, because only one of them is dead:
 *
 *  - **`filters` is DEAD.** Zero read points in the renderer on any ref, so it
 *    is accepted at authoring time and dropped before the wire. That is the
 *    #7750 defect itself.
 *  - **`defaultFilters` is ALIVE.** `ObjectGrid.tsx` reads it and lowers it to
 *    `params.$filter` — the legacy path `object-grid` still honors. It is
 *    pinned absent because this page authors the CURRENT key, NOT because the
 *    legacy one is inert.
 *
 * That distinction is the whole point of the card, so getting it wrong here
 * would reproduce the defect one level up: a future author debugging a filter
 * bug must not read this test as licence to treat `defaultFilters` as a no-op,
 * nor reach for it as a workaround.
 */
const NON_CANONICAL_FILTER_SPELLINGS: ReadonlyArray<{ key: string; why: string }> = [
  {
    key: 'filters',
    why: 'has no reader in `object-grid` — it is accepted at authoring time and then dropped before the wire (#7750)',
  },
  {
    key: 'defaultFilters',
    why: 'is the LEGACY key `object-grid` still reads and lowers to `$filter` — it works, but it is not the key this page declares',
  },
];

describe('My Work — admin-only card gating (ADR-0089 component-level visibleWhen)', () => {
  it('carries the predicate at the COMPONENT level, not inside `properties`', () => {
    const card = leadershipCard();
    expect(card, 'the "Leadership View" page:card must exist').toBeTruthy();
    expect(card!.visibleWhen, 'predicate must be a sibling of `properties`').toBeDefined();
    expect(
      card!.properties,
      '`PageCardProps` declares no visibility key — a predicate here is an unknown prop (#5068)',
    ).not.toHaveProperty('visibleWhen');
  });

  it('leaves no visibility key inside any page:card `properties` bag', () => {
    // The failure this pins is a rewrite that moves one card and forgets the
    // other, or a later card re-introducing the hoisted spelling.
    for (const card of allComponents().filter((c) => c.type === 'page:card')) {
      for (const key of ['visible', 'visibleWhen', 'visibleOn', 'visibility', 'hidden'] as const) {
        expect(
          card.properties,
          `page:card "${String(card.properties?.title)}" must not carry \`${key}\` in properties`,
        ).not.toHaveProperty(key);
      }
    }
  });

  it('binds `current_user` — the ADR-0089 identity root for a page predicate', () => {
    const source = predicateSource(leadershipCard()!.visibleWhen);
    expect(source).toBeDefined();
    expect(source).toContain('current_user.email');
    // `data.` is the metadata-editing-form root; on a runtime page surface it
    // never matches (validate-visibility-predicates, `visibility-root-mislayered`).
    expect(source).not.toMatch(/(^|[^.\w$])data\.\w/);
  });

  it('gates the card the way the page claims: admin sees it, others do not', () => {
    const source = predicateSource(leadershipCard()!.visibleWhen)!;
    expect(evalPredicate(source, { current_user: { email: 'admin@objectos.ai' } })).toBe(true);
    expect(evalPredicate(source, { current_user: { email: 'analyst@objectos.ai' } })).toBe(false);
  });
});

/**
 * The personal work queue's filter key, in the ONE spelling `object-grid`
 * publishes and reads (objectstack#7750).
 *
 * This page authored the plural `filters:`. objectui's renderer reads only
 * `schema.filter` (`plugin-grid/src/ObjectGrid.tsx`, lowered through
 * `toFilterNode`) and the legacy `schema.defaultFilters`; `schema.filters` has
 * zero read points on any ref. So the declared personal scope was accepted at
 * authoring time and then dropped before the wire — no `$filter` parameter at
 * all, and the "my work" queue listed every row.
 *
 * ⚠️ Not an authorization bypass: the unfiltered read is still RLS-constrained,
 * so the caller only ever saw rows they may see. The defect is that a DECLARED
 * personal-scope filter silently never applied.
 *
 * What these assertions can and cannot prove, stated honestly:
 *  - they pin the AUTHORED key against the spelling objectui declares, which is
 *    the whole of what is checkable inside this repo;
 *  - they do NOT prove `$filter` reaches the wire. That is objectui's own pin
 *    (`gridFilterInputSpelling.test.tsx`, objectui#4041 / `9154d9e`), and
 *    driving it end-to-end here needs the vendored `packages/console/dist`
 *    rebuilt at the current pin — tracked as objectstack#7752.
 *
 * The sibling `object-metric` tiles on this same page already spell `filter`
 * singular, which is why the grid was the only site that drifted.
 */
describe('My Work — the personal queue declares its filter in the key object-grid reads', () => {
  it('authors `filter` (singular) on the work-queue grid', () => {
    const grid = workQueueGrid();
    expect(grid, 'the personal work queue `object-grid` must exist').toBeTruthy();
    expect(
      grid!.properties,
      '`object-grid` publishes and reads `filter` — the singular key it lowers to `$filter`',
    ).toHaveProperty('filter');
  });

  it('authors neither non-canonical spelling: `filters`, which is dropped, nor the legacy `defaultFilters`', () => {
    // Each key fails for its OWN reason, so each carries its own message —
    // `filters` because nothing reads it, `defaultFilters` because it is the
    // superseded spelling rather than a dead one.
    for (const { key, why } of NON_CANONICAL_FILTER_SPELLINGS) {
      expect(workQueueGrid()!.properties, `\`${key}\` ${why}`).not.toHaveProperty(key);
    }
  });

  it('still scopes the queue to the signed-in user', () => {
    // The spelling is only half the fix; the predicate is what makes the page
    // personal at all. `{current_user_id}` is the page-level identity token.
    expect(workQueueGrid()!.properties!.filter).toEqual([
      ['owner_id', '=', '{current_user_id}'],
    ]);
  });
});
