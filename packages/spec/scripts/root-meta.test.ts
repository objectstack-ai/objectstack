// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the root `content/docs/references/meta.json` category filter — WHICH
 * categories reach the sidebar (#11482).
 *
 * THE DEFECT THIS PINS. `build-docs.ts` §3 built the root `meta.json`'s
 * category list from `categoryZodFiles` — the `.zod.ts` files found on disk —
 * a THIRD enumeration of "the pages of this category", independent of both the
 * category's own `meta.json` (§2) and its card grid (§2.5, fixed by #11260 to
 * read the same declared list §2 wrote). A category whose published pages all
 * come from plain `.ts` files (the `misc` catch-all class — `security/misc`
 * proves the shape) has zero `.zod.ts` files while still publishing a page, so
 * the old filter dropped it from the sidebar even though it was fully
 * generated and routed everywhere else.
 *
 * WHY A UNIT TEST, rather than the regenerated root `meta.json` alone. Same
 * two reasons #11260's `category-index.test.ts` gives for the card grid:
 *
 *  - the defect's output is an ABSENT sidebar entry. `check:docs` compares
 *    generated output to committed output, so a category that was never
 *    emitted into `pages` is green forever;
 *  - the edge this exists to catch — a category with pages but NO `.zod.ts`
 *    file at all — HAS NO INSTANCE in the repo today (measured on
 *    `origin/main`: all 14 categories have `zodFiles.size > 0`), so no
 *    generated artifact can pin it in either direction. Asserting on a
 *    category that does not exist requires the rule out of the side-effecting
 *    script.
 */

import { describe, expect, it } from 'vitest';

import { rootCategoryDirs } from './lib/root-meta';

describe('rootCategoryDirs — which categories reach the root sidebar (#11482)', () => {
  it('includes an all-misc category — no `.zod.ts` files, but it published a page', () => {
    // The exact latent shape #11482 named: a category whose every published
    // schema falls to the catch-all bucket, so `categoryZodFiles` would record
    // zero files for it while `categoryMetaPages` (built from the pages §2
    // actually emitted) still holds `['misc']`.
    const metaPages = new Map([['ghost', ['misc']]]);

    expect(rootCategoryDirs(['ghost'], metaPages)).toEqual(['ghost']);
  });

  it('excludes a category that published no page', () => {
    // §2 writes no `meta.json` for a category with zero pages, so
    // `categoryMetaPages` has no entry for it — the same "no meta.json ⇒
    // absent" discipline the map already documents at its declaration site.
    const metaPages = new Map<string, string[]>();

    expect(rootCategoryDirs(['contracts'], metaPages)).toEqual([]);
  });

  it('sorts the result alphabetically, independent of input or map order', () => {
    const metaPages = new Map([
      ['zebra', ['a']],
      ['alpha', ['b']],
    ]);

    expect(rootCategoryDirs(['zebra', 'alpha'], metaPages)).toEqual(['alpha', 'zebra']);
  });

  it('reproduces the real 14-category shape unchanged (#11482 "Measured")', () => {
    // Every category on `origin/main` today has both `.zod.ts` files AND
    // declared pages, so the old (`.zod.ts`-keyed) and new (`meta.json`-keyed)
    // filters agree on all 14 — the byte-identical root `meta.json` the issue
    // itself measured, and the acceptance bar this fix must not move.
    const categories = [
      'ai', 'api', 'automation', 'cloud', 'data', 'identity', 'integration',
      'kernel', 'qa', 'security', 'shared', 'studio', 'system', 'ui',
    ];
    const metaPages = new Map(categories.map(c => [c, ['some-page']]));

    expect(rootCategoryDirs(categories, metaPages)).toEqual([...categories].sort());
  });
});
