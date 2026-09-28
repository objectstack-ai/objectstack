// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The frontmatter `title` of a generated reference page, and the `navTitle`
 * that keeps its sidebar label where it was.
 *
 * ## The rule this expresses
 *
 * The docs site has one page-title rule, approved on #12237 and landed for the
 * authored pages by PR #20170 (its `## The rule` section is the text):
 *
 *  - the shape is `PRIMARY-KEYWORD — QUALIFIER`, with ` — ` as the separator;
 *  - the frontmatter `title` string is 36–46 characters, so the rendered
 *    `<title>` — the layout appends the 14-character ` | ObjectStack` — lands
 *    in 50–60, and no rendered title is over 60;
 *  - `ObjectStack` is never inside a title, because the suffix carries it;
 *  - the short label the sidebar shows goes in `navTitle`, whose fallback to
 *    `title` lives only in `navLabel()` in `apps/docs/lib/nav-title.ts`.
 *
 * The authored pages carry that rule by hand. The pages under
 * `content/docs/references/` cannot: `build-docs.ts` rewrites every one of them
 * on each run and `check:docs` goes red on a hand edit, so the rule has to live
 * in the emitter (#15403). Before this module every generated title was the
 * bare module or category name — measured on `main` at `862b6ce8`, 211 of 211
 * generated titles were outside the band (3 to 29 characters, median 11).
 *
 * ## Why a ladder, and why it is total over today's pages
 *
 * A generated title can only be composed from what the generator holds: the
 * module's display name (`Agent`, from `agent.zod.ts`), its category's declared
 * title (`AI Protocol`, `lib/category-title.ts`) and fixed words. Those names
 * run from 3 to 29 characters and the categories from 11 to 20, so no single
 * template lands every page inside an 11-character band. Each page kind
 * therefore has a short ladder of candidates, LONGEST FIRST, and the title is
 * the first candidate inside the band:
 *
 *   module page       `<Name> schema — <Category> property reference`   (name + category + 29)
 *                       (offered only when the page renders a `### Properties` table)
 *                     `<Name> schema — <Category> reference`            (name + category + 20)
 *                     `<Name> — <Category> reference`                   (name + category + 13)
 *                     `<Name> — <Category>`                             (name + category + 3)
 *   category index    `<Category> — complete schema reference`          (category + 28)
 *                     `<Category> — schema reference`                   (category + 19)
 *   root index        `Protocol reference — every schema by module`     (fixed)
 *
 * The module ladder's rungs overlap end to end — together they cover every
 * name + category length from 7 to 43, and the longest pair on the tree is 41
 * (`Schemaless Node Config` in `Automation Protocol`). The category ladder
 * covers category titles of 8 to 27 characters, and the longest declared one
 * is 25. The category keeps two same-named modules apart (`Plugin` is both a
 * `kernel` and a `studio` page), so no two generated titles collide.
 *
 * The first module rung is CONDITIONAL. `property reference` is a claim about
 * the page, and a page that renders no `### Properties` table — an enum-only
 * module such as `data/feed`, whose two schemas render `### Allowed Values`
 * only — would be misdescribed by it. So that rung is offered only when at
 * least one of the page's schemas renders a property table
 * (`rendersPropertiesTable` in `lib/schema-section.ts`, the renderer's own
 * condition); otherwise the page starts at the second rung. Without the first
 * rung the ladder covers name + category lengths from 16 to 43 rather than 7:
 * the shortest property-less pair on the tree is 17 (`Feed` in `Data
 * Protocol`), and a shorter one would be refused by name — the remedy is a rung
 * here, the same as for any page no rung fits.
 *
 * A page no rung fits is REFUSED, never truncated: a cut title is an invented
 * one, and a title outside the band is the defect this module exists to end.
 * The refusal names the page and the candidates, and the remedy is a rung
 * here — ⛔ never a hand edit of the page, which the next run reverts.
 *
 * ## What stays byte-identical: the page tree
 *
 * Each page's `navTitle` is exactly the string that used to be its `title`, so
 * `navLabel()` hands the sidebar and the footer previous/next links the label
 * they showed before. A category's folder label is its `meta.json` `title`,
 * which this module does not touch; the category and root `index.mdx` pages
 * still carry `navTitle` because the footer walks folder index pages too.
 */

/** The shortest frontmatter `title` the rule allows. */
export const TITLE_MIN = 36;
/** The longest frontmatter `title` the rule allows. */
export const TITLE_MAX = 46;
/** Between the primary keyword and its qualifier, on every generated title. */
export const TITLE_SEPARATOR = ' — ';
/** What `apps/docs/app/layout.tsx`'s title template appends to every page title. */
export const RENDERED_TITLE_SUFFIX = ' | ObjectStack';
/** The longest rendered `<title>` the rule allows. */
export const RENDERED_TITLE_MAX = 60;

/** The site name, which the suffix carries and a title never repeats. */
const SITE_NAME = /objectstack/i;

/** A generated page's two title keys. */
export interface GeneratedPageTitle {
  /** The search-facing title — `<h1>`, `<title>`, Open Graph, JSON-LD, `llms.txt`. */
  title: string;
  /** The page-tree label — the sidebar entry and the footer links. */
  navTitle: string;
}

/** Whether a title obeys the rule: inside the band, and without the site name. */
export function titleInBand(title: string): boolean {
  return title.length >= TITLE_MIN && title.length <= TITLE_MAX && !SITE_NAME.test(title);
}

/** The rendered `<title>` a frontmatter `title` becomes. */
export function renderedTitle(title: string): string {
  return `${title}${RENDERED_TITLE_SUFFIX}`;
}

/**
 * The first candidate inside the band, or a thrown error naming the page and
 * every candidate with its length. Never a truncation, never a fallback.
 */
export function firstTitleInBand(page: string, candidates: readonly string[]): string {
  const title = candidates.find(titleInBand);
  if (title !== undefined) return title;
  throw new Error(
    `No title candidate for ${page} is inside the docs title band (${TITLE_MIN}–${TITLE_MAX} characters, ` +
      `no "ObjectStack"):\n\n` +
      candidates.map(c => `    ${String(c.length).padStart(3)}  ${c}`).join('\n') +
      `\n\nThe generated reference pages take their title from the ladders in ` +
      `packages/spec/scripts/lib/page-title.ts, longest candidate first. Add a rung there that brings this ` +
      `page inside the band. Do not edit the page: the next gen:docs run rewrites it, and check:docs ` +
      `reports the hand edit as drift.`,
  );
}

/** One module's page, as its title needs it. */
export interface ModuleTitleInput {
  /** The module's display name — `Agent` for `agent.zod.ts`; the page's `navTitle`. */
  name: string;
  /** The category's declared title — `AI Protocol`. */
  categoryTitle: string;
  /**
   * Whether the page renders at least one `### Properties` table — required,
   * never defaulted: the `property reference` rung is a claim about the page,
   * and a caller that does not know must not get it by omission.
   */
  documentsProperties: boolean;
}

/** The module-page ladder, longest first; the first rung only for a page with a property table. */
export function modulePageTitleCandidates({ name, categoryTitle, documentsProperties }: ModuleTitleInput): string[] {
  return [
    ...(documentsProperties ? [`${name} schema${TITLE_SEPARATOR}${categoryTitle} property reference`] : []),
    `${name} schema${TITLE_SEPARATOR}${categoryTitle} reference`,
    `${name}${TITLE_SEPARATOR}${categoryTitle} reference`,
    `${name}${TITLE_SEPARATOR}${categoryTitle}`,
  ];
}

/** A module page's `title` under the rule, and its unchanged `navTitle`. */
export function modulePageTitle(input: ModuleTitleInput, page: string): GeneratedPageTitle {
  return { title: firstTitleInBand(page, modulePageTitleCandidates(input)), navTitle: input.name };
}

/** The category-index ladder, longest first. */
export function categoryIndexTitleCandidates(categoryTitle: string): string[] {
  return [
    `${categoryTitle}${TITLE_SEPARATOR}complete schema reference`,
    `${categoryTitle}${TITLE_SEPARATOR}schema reference`,
  ];
}

/** A category `index.mdx`'s `title` under the rule, and its unchanged `navTitle`. */
export function categoryIndexTitle(categoryTitle: string, page: string): GeneratedPageTitle {
  return { title: firstTitleInBand(page, categoryIndexTitleCandidates(categoryTitle)), navTitle: categoryTitle };
}

/** The root index's page-tree label — its title before the rule. */
export const ROOT_INDEX_NAV_TITLE = 'Protocol Reference';

/** The root `references/index.mdx`'s `title` under the rule, and its unchanged `navTitle`. */
export function rootIndexTitle(page = 'content/docs/references/index.mdx'): GeneratedPageTitle {
  return {
    title: firstTitleInBand(page, [`Protocol reference${TITLE_SEPARATOR}every schema by module`]),
    navTitle: ROOT_INDEX_NAV_TITLE,
  };
}

/**
 * The two frontmatter lines, `title` then `navTitle` — the order the authored
 * pages use. Plain scalars, the spelling the title line always had: every value
 * is a module name, a declared category title or fixed words joined by ` — `,
 * and `check:doc-frontmatter` holds both keys to a string on every page, so a
 * value YAML would read as something else is refused there by name.
 */
export function titleFrontmatter({ title, navTitle }: GeneratedPageTitle): string {
  return `title: ${title}\nnavTitle: ${navTitle}\n`;
}
