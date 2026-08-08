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
