// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the category-overview card grid — WHICH pages
 * `content/docs/references/<cat>/index.mdx` cards (#11260).
 *
 * THE DEFECT THIS PINS. `build-docs.ts` wrote a category's `meta.json` from the
 * pages it had just emitted, and that category's card grid from a second,
 * independently derived list: the `.zod.ts` files on disk. The `misc` catch-all
 * — where a published schema that no `.zod.ts` accounts for lands — has no
 * `.zod.ts` behind it by definition, so it was structurally absent from the
 * second list. Measured on `origin/main`: `security/meta.json` declared five
 * pages, the grid carded four, and `misc.mdx` was generated, routed in the
 * sidebar, and unreachable from the category overview. The card loop's own
 * comment claimed "This aligns the index with `meta.json`" — true only for the
 * 13 categories where the two enumerations happened to agree.
 *
 * WHY A UNIT TEST, rather than the regenerated `.mdx` alone. Two reasons, and
 * the second is the load-bearing one:
 *
 *  - the defect's output is an ABSENT card. `check:docs` compares generated
 *    output to committed output, so a card that was never emitted is green
 *    forever — which is how this survived until someone diffed the grid against
 *    the `meta.json` beside it;
 *  - the edge the card asked to verify — a category whose pages are ALL `misc`
 *    — HAS NO INSTANCE in the repo, so no emitted file can pin it in either
 *    direction. Under the old loop it would have rendered an EMPTY `<Cards>`
 *    grid: every zod-derived slug filtered out by `wasEmitted`, and `misc`
 *    never considered. Asserting on a category that does not exist requires the
 *    rule to be out of the side-effecting script (the move #7658 and #4912 made
 *    for `schema-section.ts` and `format-type.ts`).
 */

import { describe, expect, it } from 'vitest';

import { categoryGrid } from './lib/category-index';

/** Every page emitted — the healthy case, where `meta.json` cannot over-declare. */
const allEmitted = () => true;

describe('categoryGrid — the pages a category overview cards (#11260)', () => {
  it('cards `misc`, the page with no `.zod.ts` behind it', () => {
    // The exact shape measured on `origin/main`: security/ declares five pages,
    // one of which (`misc`) no source-derived enumeration can contain.
    const declared = ['explain', 'misc', 'permission', 'rls', 'sharing'];

    const { cards, undelivered } = categoryGrid(declared, allEmitted);

    expect(cards).toEqual(['explain', 'misc', 'permission', 'rls', 'sharing']);
    expect(undelivered).toEqual([]);
  });

  it('cards every page `meta.json` declares, so the grid and the sidebar cannot disagree', () => {
    const declared = ['---Section One---', 'beta', 'alpha', '---Section Two---', 'gamma'];

    const { cards } = categoryGrid(declared, allEmitted);

    // Separators are sidebar headings, not pages — never carded.
    expect(cards).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('orders cards alphabetically, not in `meta.json` section order', () => {
    // The grid's order is the one the pre-fix `Array.from(zodFiles).sort()`
    // produced. Pinned because taking `meta.json`'s order instead would reshuffle
    // all 13 grids that were already correct — a fix to WHICH pages are carded
    // must not also churn the ones it is not fixing.
    const declared = ['---Grouped---', 'zebra', 'alpha', '---More---', 'middle'];

    expect(categoryGrid(declared, allEmitted).cards).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('does not card a page this run did not emit — it reports it', () => {
    // The `wasEmitted` guard is KEPT: a `.zod.ts` whose schemas are all
    // unrepresentable in JSON Schema generates no page, and carding it would be
    // a dangling 404. What changed is that dropping a declared page is now
    // reported rather than silent — silence is what shipped the `misc` bug.
    const declared = ['delivered', 'unrepresentable'];

    const { cards, undelivered } = categoryGrid(declared, page => page !== 'unrepresentable');

    expect(cards).toEqual(['delivered']);
    expect(undelivered).toEqual(['unrepresentable']);
  });

  describe('the all-`misc` category — no instance in the repo, so only assertable here', () => {
    it('cards `misc` rather than rendering an empty grid', () => {
      // A category whose every published schema falls to the catch-all. The old
      // loop iterated the `.zod.ts` slugs, all of which produced no page, and
      // emitted `<Cards>\n</Cards>` — an overview linking nowhere, for a folder
      // whose one page is routed in the sidebar.
      const { cards, undelivered } = categoryGrid(['misc'], allEmitted);

      expect(cards).toEqual(['misc']);
      expect(cards).not.toHaveLength(0);
      expect(undelivered).toEqual([]);
    });

    it('cannot produce an empty grid from a non-empty declaration without saying so', () => {
      // The invariant the caller enforces: declared pages in, at least one card
      // out — or `undelivered` names what went missing and the build stops.
      // Every way of reaching an empty grid passes through this list.
      const { cards, undelivered } = categoryGrid(['misc'], () => false);

      expect(cards).toEqual([]);
      expect(undelivered).toEqual(['misc']);
    });
  });

  it('declares nothing for a category with no pages', () => {
    // §2 writes no `meta.json` for a category that published no page, so §2.5
    // writes no `index.mdx` — the overview exists exactly when the pages do.
    expect(categoryGrid([], allEmitted)).toEqual({ cards: [], undelivered: [] });
    expect(categoryGrid(['---Empty Section---'], allEmitted).cards).toEqual([]);
  });
});
