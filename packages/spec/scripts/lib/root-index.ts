// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The root reference index — `content/docs/references/index.mdx` (#4759).
 *
 * That file used to be the one page in this tree with NO owner. The
 * Documentation Guardrails forbid hand-editing anything under
 * `content/docs/references/`, and `build-docs.ts` never wrote it: it generated
 * every category folder and each category's `index.mdx`, and left the root one
 * alone. A table nobody may edit and nothing regenerates can only rot, and it
 * had, in every way such a table can:
 *
 *  - **rows for files that no longer exist** — `automation/trigger-registry.zod.ts`
 *    (deleted at #4499) and `automation/sync.zod.ts` (deleted at #4738), plus a
 *    `workflow.zod.ts` that `src/automation/` never had;
 *  - **schema names that were never exports** — `TriggerRegistrySchema`,
 *    `SyncSchema`, `ETLSchema` (the real one is `ETLPipeline`). Three of the
 *    four automation rows were wrong BEFORE their files were deleted, which is
 *    why validating the old table would have gone red on day one and still left
 *    it ownerless;
 *  - **a section outliving its directory** — a nine-row `src/hub` section, a
 *    directory deleted wholesale (the same fallout `protocol-map.test.ts`
 *    was written for), and a `shared/connector-auth.zod.ts` row for a file
 *    `@objectstack/spec/shared` does not publish;
 *  - **counts that disagreed with each other** — 133 in the frontmatter, 169 in
 *    the navigation table, and a Data row claiming 19 under a heading that said
 *    18;
 *  - **dead links** — two of four "Next Steps" cards, and a
 *    `[…]((/docs/protocol/objectql))` with doubled parentheses.
 *
 * ## What makes each class structurally impossible now
 *
 * `renderRootIndex` is TOTAL over its input: every file path, schema name and
 * route it prints comes from the `RootIndexCategory[]` it is handed, and
 * `build-docs.ts` hands it the very map that decided which reference pages to
 * emit. So a deleted `.zod.ts` cannot leave a row behind, a name that is not a
 * published schema cannot appear, and no route can point at a page this run did
 * not generate. The counts are `reduce` over the same arrays that produce the
 * rows, never a second tally kept beside them — the 133/169/19-vs-18 disagreement
 * has nowhere left to live.
 *
 * ## The one hand-written part, and why it is per-category
 *
 * The old table's third column was free prose ("用途") per file. Reproducing it
 * would mean 201 hand-kept sentences whose accuracy nothing can check — the
 * rotten artifact rewritten in TypeScript. It is replaced by the schema names
 * the page documents, which are enumerated. What survives as prose is one line
 * per CATEGORY: 14 entries, keyed by a stable directory name, and held to
 * exactly the categories that have pages by `blurbCoverage` in both directions,
 * so a blurb can neither outlive its directory (the `src/hub` failure) nor go
 * missing for a new one.
 *
 * The prose blocks (intro / conventions / next steps) are injected rather than
 * preserved from the emitted file on purpose. Preserving hand-written text
 * inside `content/docs/references/` would recreate exactly the ownerless state
 * this fixes; keeping it in reviewed generator source gives it the same owner
 * as the category pages' intro sentences. Their links are the one thing
 * generation cannot make true, so `docLinkTargets` exposes them for the caller
 * to resolve against the docs tree.
 */

/** One generated reference page, as the root index needs to describe it. */
export interface RootIndexPage {
  /** Page slug — the last segment of `/docs/references/<category>/<slug>`. */
  slug: string;
  /**
   * Source path relative to `src/<category>/`, or `undefined` when no single
   * file backs the page (the `misc` catch-all). Undefined must render as an
   * explicit absence: a reassembled `<category>/misc.zod.ts` points at nothing,
   * which is the defect this module exists for, one level down.
   */
  sourceRel?: string;
  /** Published schema names the page documents. Rendered sorted. */
  schemas: readonly string[];
}

/** One protocol module's section of the index. */
export interface RootIndexCategory {
  /** `src/` directory name — `data`, `ui`, `shared`, … */
  category: string;
  /** Display title — `Data Protocol`. */
  title: string;
  pages: readonly RootIndexPage[];
}

/** Hand-written prose, injected from reviewed generator source. */
export interface RootIndexProse {
  /** Opening paragraph, above the navigation table. */
  intro: string;
  /** The `## Schema Conventions` section, verbatim. */
  conventions: string;
  /** The `## Next Steps` section, verbatim. */
  nextSteps: string;
}

export interface RootIndexInput {
  categories: readonly RootIndexCategory[];
  /** One line per category, keyed by `category`. */
  blurbs: Readonly<Record<string, string>>;
  prose: RootIndexProse;
}

/**
 * Categories with pages but no blurb, and blurbs for categories with no pages.
 *
 * Checked in BOTH directions deliberately. A missing blurb renders an empty
 * cell — a small, silent lie. A stale blurb is the `src/hub` failure in
 * miniature: prose that outlived the directory it describes, which is precisely
 * how the old index kept a nine-row section for a directory that had been
 * deleted.
 */
export function blurbCoverage(
  categories: readonly RootIndexCategory[],
  blurbs: Readonly<Record<string, string>>,
): { missing: string[]; extra: string[] } {
  const withPages = new Set(categories.filter(c => c.pages.length > 0).map(c => c.category));
  const described = new Set(Object.keys(blurbs));

  return {
    missing: [...withPages].filter(c => !described.has(c)).sort(),
    extra: [...described].filter(c => !withPages.has(c)).sort(),
  };
}

/** The build-stopping message for `blurbCoverage`. */
export function formatBlurbCoverage(coverage: { missing: string[]; extra: string[] }): string {
  return (
    `CATEGORY_BLURBS in scripts/build-docs.ts does not match the categories that have reference pages:\n\n` +
    [
      ...coverage.missing.map(c => `    + ${c} (has pages, no blurb — add one line)`),
      ...coverage.extra.map(c => `    - ${c} (blurb, no pages — delete the line)`),
    ].join('\n') +
    `\n\nThe root index is generated from the pages; the blurb map is the one hand-written part of\n` +
    `it, and must neither lag behind them nor outlive them (#4759).\n`
  );
}

/** GFM table cells are split by a bare `|`, in code spans too. */
const cell = (text: string) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Render the whole page.
 *
 * Sorting happens here rather than at the call site so the output is a pure
 * function of the input SET: two runs that enumerate the same pages in a
 * different directory order produce byte-identical MDX, which is what lets
 * `--check` mean "the spec changed" instead of "the filesystem answered in a
 * different order".
 *
 * Categories sort by directory name — the same order the sidebar's root
 * `meta.json` uses, so the page and the navigation beside it never disagree.
 */
export function renderRootIndex(input: RootIndexInput): string {
  const sections = [...input.categories]
    .filter(c => c.pages.length > 0)
    .sort((a, b) => a.category.localeCompare(b.category))
    .map(c => {
      const pages = [...c.pages].sort((a, b) => a.slug.localeCompare(b.slug));
      return {
        ...c,
        pages,
        schemaCount: pages.reduce((n, p) => n + p.schemas.length, 0),
      };
    });

  const totalPages = sections.reduce((n, s) => n + s.pages.length, 0);
  const totalSchemas = sections.reduce((n, s) => n + s.schemaCount, 0);

  let mdx = `---\n`;
  mdx += `title: Protocol Reference\n`;
  mdx += `description: Every schema published by @objectstack/spec — ${totalSchemas} schemas across ${plural(sections.length, 'protocol module')}\n`;
  mdx += `---\n\n`;
  mdx += `{/* ⚠️  AUTO-GENERATED — DO NOT EDIT. Run build-docs.ts to regenerate. Hand-written docs live in the module folders under content/docs/. */}\n\n`;
  mdx += `${input.prose.intro}\n`;

  mdx += `<Callout type="info">\n`;
  mdx += `This index — like every page under it — is generated from the Zod sources in \`packages/spec/src/\` by\n`;
  mdx += `\`packages/spec/scripts/build-docs.ts\`. Its rows are enumerated from the same JSON Schema output the\n`;
  mdx += `reference pages are built from, so a schema that no longer exists cannot keep a row here, and the\n`;
  mdx += `counts are sums of the rows they head. Regenerate with\n`;
  mdx += `\`pnpm --filter @objectstack/spec gen:schema && pnpm --filter @objectstack/spec gen:docs\`.\n`;
  mdx += `</Callout>\n\n`;

  mdx += `## Quick Navigation\n\n`;
  mdx += `| Module | Pages | Schemas | Description |\n`;
  mdx += `| :--- | ---: | ---: | :--- |\n`;
  for (const s of sections) {
    mdx += `| [${s.title}](/docs/references/${s.category}) | ${s.pages.length} | ${s.schemaCount} | ${cell(input.blurbs[s.category] ?? '')} |\n`;
  }
  mdx += `| **Total** | **${totalPages}** | **${totalSchemas}** | ${plural(sections.length, 'protocol module')} |\n\n`;

  for (const s of sections) {
    mdx += `---\n\n`;
    mdx += `## ${s.title}\n\n`;
    mdx += `**Source:** \`packages/spec/src/${s.category}/\` · `;
    mdx += `**Import:** \`@objectstack/spec/${s.category}\` · `;
    mdx += `**${plural(s.pages.length, 'page')}, ${plural(s.schemaCount, 'schema')}**\n\n`;
    mdx += `${input.blurbs[s.category] ?? ''}\n\n`;
    mdx += `| File | Schemas |\n`;
    mdx += `| :--- | :--- |\n`;
    for (const page of s.pages) {
      const route = `/docs/references/${s.category}/${page.slug}`;
      const link = `[\`${cell(page.sourceRel ?? page.slug)}\`](${route})`;
      const schemas = [...page.schemas].sort().map(n => `\`${cell(n)}\``).join(', ');
      mdx += `| ${page.sourceRel ? link : `${link} *(no single source file)*`} | ${schemas} |\n`;
    }
    mdx += `\n`;
  }

  mdx += `---\n\n`;
  mdx += `${input.prose.conventions}\n`;
  mdx += `---\n\n`;
  mdx += `${input.prose.nextSteps}`;

  return mdx;
}

/**
 * Every distinct internal `/docs/...` target the page links to, sorted, with
 * any `#anchor` stripped.
 *
 * The generated tables cannot invent a target — they are rendered from pages
 * this run emits. The prose constants can, and did: two of the old page's four
 * "Next Steps" cards pointed at pages that do not exist, for months, because
 * nothing looked. Extracted (rather than resolved here) so the caller decides
 * what "exists" means — under `--check` nothing is written, so this run's own
 * output has to count as present alongside the disk.
 */
export function docLinkTargets(mdx: string): string[] {
  const targets = new Set<string>();
  for (const m of mdx.matchAll(/(?:\]\(|href=")(\/docs\/[^)"\s]+)/g)) {
    targets.add(m[1].split('#')[0].replace(/\/$/, ''));
  }
  return [...targets].sort();
}
