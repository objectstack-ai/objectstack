// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which category folders get an entry in the root
 * `content/docs/references/meta.json` — the sidebar's top-level category list
 * (#11482).
 *
 * ## The defect this replaces
 *
 * `build-docs.ts` writes THREE things from what should be one answer to "which
 * categories/pages exist": a category's own `meta.json` (§2, from the pages
 * this run emitted), that category's `index.mdx` card grid (§2.5, fixed by
 * #11260 to read the same declared list), and the ROOT `meta.json` (§3) —
 * which, until this fix, filtered on `categoryZodFiles`: the `.zod.ts` files
 * found on disk, a fourth, independently derived enumeration.
 *
 * A category whose published pages all come from plain `.ts` files rather than
 * `.zod.ts` ones — the `misc` catch-all class `security/misc` proves is real —
 * has ZERO `.zod.ts` files while still publishing a page, a `meta.json` and an
 * `index.mdx`. The old filter dropped such a category from the sidebar even
 * though §2 and §2.5 both fully generated it: a folder that is complete on
 * disk and unreachable from the nav. No category is in that state today (all
 * 14 have at least one `.zod.ts` file), so the defect was latent — `check:docs`
 * cannot see an ABSENT sidebar entry any more than #11260's card grid could see
 * an absent card.
 *
 * ## Why a function, and why here
 *
 * Same move `category-index.ts` (#11260), `schema-section.ts` (#7658) and
 * `format-type.ts` (#4912) made: the generator is a top-level script with side
 * effects, so the only way to assert on the root `meta.json`'s category list
 * was to run the whole thing and inspect emitted output — which cannot pin a
 * category shape that has no live instance in the repo. Asserting an absence
 * needs the rule out of the script.
 *
 * ## The invariant, now held by construction
 *
 * A category reaches the sidebar exactly when `categoryMetaPages` has a
 * non-empty entry for it — the SAME map §2.5 reads to build that category's
 * card grid, and the same "no meta.json ⇒ absent" discipline §2 already
 * documents for `categoryMetaPages` itself. One answer, read three times,
 * instead of three answers that happen to agree today.
 */

/**
 * The category directories that belong in the root `meta.json`'s `pages`
 * array, alphabetically sorted.
 *
 * `categories` is `Object.keys(CATEGORIES)` — every known protocol module,
 * whether or not it published anything this run. `metaPages` is
 * `categoryMetaPages`: the `pages` array §2 wrote to a category's own
 * `meta.json`, present only for a category that published at least one page.
 */
export function rootCategoryDirs(
  categories: readonly string[],
  metaPages: ReadonlyMap<string, readonly string[]>,
): string[] {
  return categories.filter(cat => (metaPages.get(cat) ?? []).length > 0).sort();
}
