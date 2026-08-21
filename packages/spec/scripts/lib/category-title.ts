// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The display title of each protocol module — DECLARED, never derived (#5853).
 *
 * ## What was here before, and why it could only keep failing
 *
 * The title used to be guessed from the directory name:
 *
 * ```ts
 * const upper = dir.toUpperCase();
 * if (['UI', 'AI', 'API'].includes(upper)) return `${upper} Protocol`;
 * return `${dir.charAt(0).toUpperCase() + dir.slice(1)} Protocol`;
 * ```
 *
 * Title-case by default, with a hard-coded escape hatch for the three
 * abbreviations someone happened to think of. `qa` is an abbreviation too —
 * `src/qa/index.ts` opens with "Quality Assurance (QA) Protocol" — but it was
 * never added, so the generator unilaterally downgraded it and published
 * **"Qa Protocol"** to three places at once: the category page title, the
 * sidebar label in `qa/meta.json`, and (since #4759 folded the root index into
 * generation) two rows of `references/index.mdx`.
 *
 * The measurement that decided the shape rather than the one-line fix:
 *
 *  - `packages/spec/src/` holds **17** module directories, discovered at run
 *    time by `readdirSync` — nothing anywhere prompts an author to extend a
 *    list when they add one.
 *  - **4 of those 17 are abbreviations** (`ai`, `api`, `ui`, `qa`). The list
 *    covered 3. A 25% miss rate on the single class it exists to serve.
 *  - **No gate could ever have caught it.** `check:docs` compares generated
 *    output against committed output; a wrong title is *stable*, so it is
 *    green forever. `Qa Protocol` survived every regeneration since the
 *    directory was created and was found by eye only once #4759 printed 14
 *    titles side by side, `Qa Protocol` wedged between `AI` / `API` / `UI`.
 *
 * So the failure mode is not "one abbreviation was forgotten"; it is that a
 * guessed title is **undetectably wrong**. Adding `QA` to the list fixes the
 * one instance and leaves the next `iam` / `rbac` / `sso` directory to publish
 * "Iam Protocol" with the same silence.
 *
 * ## The shape, and the one property it has to buy
 *
 * Moving the guess into a lookup table with a fallback would buy nothing — a
 * missing entry would still fall through to title-case, still silently. The
 * point of declaring the titles is that a missing entry is **visible**:
 *
 *  - the map is **total** over the directories on disk. There is no fallback
 *    and no derivation left, so there is nothing left to be quietly wrong;
 *  - {@link categoryTitleCoverage} checks it in **both** directions and the
 *    caller stops the build, so a new directory fails `gen:docs` with a
 *    message naming it, and an entry cannot outlive the directory it titles.
 *
 * This is deliberately the idiom `CATEGORY_BLURBS` already uses one datum
 * over (`blurbCoverage` / `formatBlurbCoverage` in `lib/root-index.ts`, #4759)
 * — the title was simply the last per-category datum still being guessed
 * instead of declared. It costs a new module directory exactly one line, in
 * the same PR that must already add its blurb line, and the error message says
 * which line to add.
 */

/**
 * One declared title per `packages/spec/src/` module directory.
 *
 * Keys are the directory names — the stable identifier the pages, the sidebar
 * and the root index are all keyed by. Held to the directories on disk in both
 * directions by {@link categoryTitleCoverage}; do not add an entry
 * speculatively, and do not delete a directory without deleting its line.
 */
export const CATEGORY_TITLES: Readonly<Record<string, string>> = {
  ai: 'AI Protocol',
  api: 'API Protocol',
  automation: 'Automation Protocol',
  cloud: 'Cloud Protocol',
  contracts: 'Contracts Protocol',
  conversions: 'Conversions Protocol',
  data: 'Data Protocol',
  identity: 'Identity Protocol',
  integration: 'Integration Protocol',
  kernel: 'Kernel Protocol',
  // [#10096] The schema-free `/meta` URL-spelling entry. "Vocabulary", not
  // "Protocol": the entry carries the spelling contract's data and folds
  // without the schema machinery every Protocol category links.
  'meta-spelling': 'Meta-Spelling Vocabulary',
  migrations: 'Migrations Protocol',
  qa: 'QA Protocol',
  security: 'Security Protocol',
  shared: 'Shared Protocol',
  studio: 'Studio Protocol',
  system: 'System Protocol',
  ui: 'UI Protocol',
};

/**
 * Module directories with no declared title, and titles for directories that
 * are not there.
 *
 * Checked in BOTH directions, for the same reason `blurbCoverage` is. A
 * missing title is the `Qa Protocol` failure repeating: without this the
 * generator would have to invent one, and an invented title is wrong in a way
 * that stays green. A title whose directory is gone is the `src/hub` failure
 * in miniature — a display name outliving the thing it names.
 */
export function categoryTitleCoverage(
  dirs: readonly string[],
  titles: Readonly<Record<string, string>>,
): { missing: string[]; extra: string[] } {
  const onDisk = new Set(dirs);
  const declared = new Set(Object.keys(titles));

  return {
    missing: [...onDisk].filter(d => !declared.has(d)).sort(),
    extra: [...declared].filter(d => !onDisk.has(d)).sort(),
  };
}

/** The build-stopping message for {@link categoryTitleCoverage}. */
export function formatCategoryTitleCoverage(coverage: { missing: string[]; extra: string[] }): string {
  return (
    `CATEGORY_TITLES in scripts/lib/category-title.ts does not match the module directories under packages/spec/src/:\n\n` +
    [
      ...coverage.missing.map(d => `    + ${d} (directory exists, no title — add one line: ${d}: '...')`),
      ...coverage.extra.map(d => `    - ${d} (title, no directory — delete the line)`),
    ].join('\n') +
    `\n\nEvery reference page title, sidebar label and root-index row for a module is this string.\n` +
    `It is declared rather than derived on purpose: a title guessed from the directory name is\n` +
    `wrong for every abbreviation and no gate can see it, because a wrong title is a STABLE one\n` +
    `and check:docs only compares generation against what was committed. That is how "Qa Protocol"\n` +
    `stayed published across every regeneration until a human read the nav table (#5853).\n` +
    `Write the module's real display name — the abbreviations are spelled the way the module\n` +
    `spells itself (AI, API, QA, UI), not the way title-case would.\n`
  );
}

/**
 * The `directory -> title` map `build-docs.ts` runs on, or a thrown error.
 *
 * Total by construction: every directory handed in gets its declared title, and
 * a gap is an exception rather than a fallback. The caller reports it with
 * {@link formatCategoryTitleCoverage} and exits.
 */
export function resolveCategoryTitles(
  dirs: readonly string[],
  titles: Readonly<Record<string, string>> = CATEGORY_TITLES,
): Record<string, string> {
  const coverage = categoryTitleCoverage(dirs, titles);
  if (coverage.missing.length > 0 || coverage.extra.length > 0) {
    throw new Error(formatCategoryTitleCoverage(coverage));
  }
  return Object.fromEntries(dirs.map(dir => [dir, titles[dir]]));
}
