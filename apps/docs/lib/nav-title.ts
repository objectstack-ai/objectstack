// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { LoaderPlugin } from 'fumadocs-core/source';

/**
 * `navTitle` -- the short label a doc page shows in NAVIGATION, kept apart from
 * the `title` every content and metadata surface reads.
 *
 * ## The problem it exists for
 *
 * A page's frontmatter `title` is read by six consumers with different length
 * budgets, all of them served by one string (measured on `origin/main`,
 * 2026-09-01, 405 pages under `content/docs`):
 *
 *   | consumer                              | site                                            |
 *   |---------------------------------------|-------------------------------------------------|
 *   | SERP `title` / OG / twitter metadata   | `app/[lang]/docs/[[...slug]]/page.tsx:211,216,227,233` |
 *   | on-page `h1` (`DocsTitle`)             | `app/[lang]/docs/[[...slug]]/page.tsx:150`      |
 *   | JSON-LD `TechArticle` headline/name    | `app/[lang]/docs/[[...slug]]/page.tsx:123,124`  |
 *   | JSON-LD `BreadcrumbList` leaf crumb    | `app/[lang]/docs/[[...slug]]/page.tsx:95`       |
 *   | `llms.txt` / `llms-full.txt` / `.mdx`  | `app/llms.txt/route.ts:10`, `lib/source.ts` `getLLMText` |
 *   | the Open Graph card image              | `app/og/docs/[...slug]/route.tsx:18`            |
 *   | the sidebar / page tree                | `lib/source.ts` -- `loader()`, via this plugin  |
 *
 * A search-intent `title` of 50-60 characters is right for the first six and
 * unreadable in the seventh. `navTitle` is the seventh's own string.
 *
 * ## The contract, stated once
 *
 *   - `navTitle` is OPTIONAL. When it is absent -- or blank -- the page tree
 *     falls back to `title`. That fallback is `navLabel()` below and NOTHING
 *     else: there is no second `??` at any read site, which is the shape
 *     AGENTS.md Prime Directive #12 rejects.
 *   - `navTitle` reaches the PAGE TREE only. Nothing else may read the key --
 *     `page.data.title` stays the string every other consumer above sees, and
 *     `scripts/check-docs-nav-label.mjs` holds that separation.
 *   - Declaring it changes nothing else about the page: the URL, the slug, the
 *     `h1`, the canonical link and the sitemap entry are all untouched.
 *
 * ## How to use it (this is the section #12237's title rewrite cites)
 *
 * Lengthen `title` for search intent and add `navTitle` for the sidebar:
 *
 * ```yaml
 * ---
 * title: Declarative REST Endpoints -- Define APIs Without Code
 * navTitle: REST Endpoints
 * description: ...
 * ---
 * ```
 *
 * A page whose `title` is already short adds nothing: 405 of 405 pages carry no
 * `navTitle` today and every one of them keeps its present sidebar entry,
 * because `navLabel()` returns `title` unchanged for them.
 *
 * ## Where the mechanism lives
 *
 * The key is declared on the docs page schema in `apps/docs/source.config.ts`
 * (`docsSchema = pageSchema.extend({ navTitle })`), typed by
 * `scripts/check-doc-frontmatter.mjs`'s docs key contract, and resolved here.
 *
 * `PageTreeTransformer` is fumadocs' OWN extension point -- the same one
 * `fumadocs-core`'s built-in icon plugin uses (`iconPlugin` in
 * `dist/icon-*.js`: `transformPageTree: { file, folder, separator }`). This is
 * not a bolt-on around the library. fumadocs-core@16.14.4 ships no nav-label
 * key of its own: its `pageSchema` is `{ title, description, icon, full,
 * _openapi }`, its `metaSchema` has no per-page label field, and the page-tree
 * builder reads exactly `{ title, description, icon }` off a page
 * (`dist/loader-*.js`, `buildFile`). So the key is ours; only the wiring is
 * theirs.
 */

/** The frontmatter key. Named once so a reader can grep for exactly one thing. */
export const NAV_LABEL_KEY = 'navTitle';

/** The frontmatter this resolution reads -- a subset of the docs page schema. */
export interface NavLabelFrontmatter {
  title: string;
  navTitle?: unknown;
}

/**
 * The page tree label for one page: its `navTitle` when it declares a non-blank
 * one, and its `title` otherwise.
 *
 * ⛔ THIS IS THE SINGLE RESOLUTION POINT. The `title` fallback is stated here
 * and must not be repeated at a read site -- a second one would be a second
 * de-facto contract, and the two would drift.
 *
 * Blank is treated as absent on purpose: `navTitle: ""` and `navTitle: "   "`
 * are authoring slips, and a page tree entry with no visible text is worse than
 * a long one -- it is unclickable-looking and invisible to a reader scanning
 * the sidebar. YAML gives `navTitle:` with no value the type `null`, which the
 * `typeof` guard rejects for the same reason.
 */
export function navLabel(data: NavLabelFrontmatter): string {
  const declared = typeof data.navTitle === 'string' ? data.navTitle.trim() : '';
  return declared.length > 0 ? declared : data.title;
}

/**
 * The loader plugin that applies {@link navLabel} to every page node of the
 * docs page tree.
 *
 * Three conditions return the node untouched, each for its own reason:
 *
 * 1. **No file path.** The builder also runs `file` transformers over
 *    `meta.json` entries written in fumadocs' `[Name](url)` link form, and
 *    calls them with no path because there is no page behind them. Those nodes
 *    already carry a hand-written name; there is no frontmatter to read.
 * 2. **The path does not resolve to a page.** Defensive: the storage holds meta
 *    files too.
 * 3. **The page has no string `title`.** Then the builder's own name is
 *    path-derived (`pathToName(basename)`), and overwriting it with
 *    `undefined` would erase a working label. `pageSchema` makes `title`
 *    required so this cannot happen through the site build -- it is a guard
 *    against a caller that is not the site build, not a tolerated input shape.
 *
 * ⚠️ A folder inherits its index page's transformed name when its `meta.json`
 * declares no `title` (fumadocs' `buildFolder`: `metadata.title ?? node.index?.name`).
 * All 35 `meta.json` files under `content/docs` declare a `title` today, so no
 * folder takes this path; if one ever drops its title, the folder label follows
 * the index page's `navTitle`, which is the navigation-surface answer and so is
 * the intended one.
 */
export function navTitlePlugin(): LoaderPlugin {
  return {
    name: 'objectstack:nav-title',
    transformPageTree: {
      file(node, filePath) {
        if (filePath === undefined) return node;

        const file = this.storage.read(filePath);
        if (!file || file.format !== 'page') return node;

        const data = file.data as { title?: unknown; navTitle?: unknown };
        if (typeof data.title !== 'string') return node;

        node.name = navLabel({ title: data.title, navTitle: data.navTitle });
        return node;
      },
    },
  };
}
