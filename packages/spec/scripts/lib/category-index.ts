// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which pages a category overview (`content/docs/references/<cat>/index.mdx`)
 * cards — the pages that category's `meta.json` DECLARES (#11260).
 *
 * ## The defect this replaces
 *
 * `build-docs.ts` writes both files in one run, and they used to be built from
 * two different enumerations of "the pages of this category":
 *
 *   - `meta.json` from `PAGES_BY_CATEGORY` — the pages the run actually
 *     emitted, which is where a published schema that no `.zod.ts` accounts for
 *     lands (the `misc` catch-all bucket);
 *   - the `index.mdx` card grid from `categoryZodFiles` — page slugs derived
 *     from the `.zod.ts` files on disk.
 *
 * `misc` has no file behind it — the generator says so twice, and
 * `sourcePathFor` returns `undefined` for it precisely so the page prints no
 * invented "Source:" line — so it is STRUCTURALLY absent from the second
 * enumeration. The card loop never considered it, and the `wasEmitted` guard
 * the loop's own comment leaned on ("This aligns the index with `meta.json`")
 * never ran for it. Measured on `origin/main`: `security/` shipped five pages,
 * its `meta.json` declared five, its grid carded four. `misc.mdx` was
 * generated and routed in the sidebar, and unreachable from the one page whose
 * job is to reach it.
 *
 * The comment was not merely wrong, it was wrong in the shape that reads as
 * verified — it named the invariant while the code held it by coincidence, for
 * the 13 categories where the two enumerations happen to agree.
 *
 * ## Why a function, and why here
 *
 * Same move `schema-section.ts` (#7658) and `format-type.ts` (#4912) made, for
 * the same reason: the generator is a top-level script with side effects, so
 * the only way to assert on the grid was to run the whole thing and grep the
 * emitted `.mdx`. This defect's output is an ABSENT card, and the edge that
 * cannot be caught that way at all is a category whose pages are ALL `misc`:
 * no such category exists today, so no emitted file can pin it, and under the
 * old loop it would have rendered an EMPTY `<Cards>` grid (every zod slug
 * filtered by `wasEmitted`, `misc` never considered). Asserting an absence
 * needs the rule out of the script.
 *
 * ## The invariant, now held by construction
 *
 * Card the declared pages, keep the `wasEmitted` guard. Both files then read
 * the same list, so the guard can no longer silently drop a page: a declared
 * page this run did not emit is reported as `undelivered` and stops the build,
 * rather than thinning the grid the way `misc` was thinned. That also makes an
 * empty grid unreachable — a category with declared pages cards at least one,
 * or the run fails naming the pages it could not deliver.
 */

/**
 * A fumadocs section separator in a `meta.json` `pages` array (`---Section---`)
 * — a heading in the sidebar, not a page. Same predicate
 * `scripts/check-section-landing-index.mjs` applies to the same arrays.
 */
function isSectionSeparator(page: string): boolean {
  return page.startsWith('---');
}

/** What `categoryGrid` decided about one category's overview. */
export interface CategoryGrid {
  /**
   * Page slugs to card, in grid order (alphabetical — the order the old
   * `Array.from(zodFiles).sort()` produced, so a fix to WHICH pages are carded
   * does not also reshuffle the 13 grids that were already right).
   */
  cards: string[];
  /**
   * Declared pages this run did not emit. Always empty in a healthy run:
   * `meta.json` is built from the emitted page map, so this is a generator bug
   * — the caller stops the build rather than publishing a thinned grid.
   */
  undelivered: string[];
}

/**
 * Split a category's declared pages into the ones its grid cards and the ones
 * that would be silently dropped.
 *
 * `declaredPages` is the `pages` array written to that category's `meta.json`,
 * separators included. `wasEmitted` answers whether a page slug got a reference
 * page out of THIS run — the sink, never the disk, because under `--check`
 * nothing is written and the stale tree is still lying around.
 */
export function categoryGrid(
  declaredPages: readonly string[],
  wasEmitted: (page: string) => boolean,
): CategoryGrid {
  const declared = [...new Set(declaredPages.filter(page => !isSectionSeparator(page)))].sort();
  return {
    cards: declared.filter(page => wasEmitted(page)),
    undelivered: declared.filter(page => !wasEmitted(page)),
  };
}
