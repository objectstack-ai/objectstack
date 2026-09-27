// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Entry points that publish PART OF ANOTHER CATEGORY'S protocol — a packaging
 * split, not a new protocol (#18576).
 *
 * ## Why this exists
 *
 * Everywhere else in this package one `src/<category>/` directory is one
 * protocol category AND one `@objectstack/spec/<category>` entry: the JSON
 * Schema tree (`json-schema/<category>/`), the reference pages, the
 * authorable-surface keys (`<category>/<Def>:<prop>`) and the import line a page
 * prints are all keyed by the same word.
 *
 * `./api-assembled` breaks that one-to-one on purpose. The maintainer ruling
 * on #18576 (letter B) moved the API-protocol declarations whose payload embeds
 * the ASSEMBLED package body off `@objectstack/spec/api`, because that body
 * links the whole metadata vocabulary and the datasource/driver validators and
 * `./api` is imported by browser code. The declarations did not change
 * protocol: they are still `api` schemas, their JSON Schema ids stay
 * `api/<Name>`, and they are documented in the API reference beside the rest
 * of the Package API. Only the import path moved.
 *
 * So a split entry has a HOME category, and the tools that key by category
 * need to know it:
 *
 *  - `build-schemas.ts` walks the split entry's exports as part of its home
 *    category, so no published schema id moves;
 *  - `build-docs.ts` does not look for `json-schema/<split>/` (its schemas are
 *    under the home) — `lib/schema-closure.ts` reads this map for that;
 *  - `lib/docs-import-surface.ts` spells a page's import line from whichever
 *    of the home and its split entries actually exports the page's names.
 *
 * ⛔ An entry here is a claim that the split entry's every export is a
 * declaration of its home protocol. It is not a place to park a new protocol:
 * a directory that declares something new gets its own category, title and
 * JSON Schema tree like every other one.
 */
export interface SplitEntry {
  /** The category whose protocol this entry publishes part of. */
  readonly home: string;
  /** The citation that declares the split. */
  readonly citation: string;
}

/** Split-entry directory under `src/` (== its subpath name) -> its home. */
export const SPLIT_ENTRIES: Readonly<Record<string, SplitEntry>> = {
  'api-assembled': {
    home: 'api',
    citation:
      'maintainer ruling on #18576 (letter B): the API declarations that embed the assembled package ' +
      'body leave the browser-facing `./api` for `./api-assembled` — see src/api-assembled/index.ts and ' +
      'src/api/package-api-assembled.zod.ts',
  },
};

/** Is this `src/` directory a split entry (its schemas publish under a home category)? */
export function isSplitEntry(dir: string, splits: Readonly<Record<string, SplitEntry>> = SPLIT_ENTRIES): boolean {
  return Object.hasOwn(splits, dir);
}

/** The split entries whose home is `category`, in declaration order. */
export function splitEntriesHomedAt(
  category: string,
  splits: Readonly<Record<string, SplitEntry>> = SPLIT_ENTRIES,
): string[] {
  return Object.entries(splits)
    .filter(([, entry]) => entry.home === category)
    .map(([dir]) => dir);
}

/** Split entries that no longer describe the tree. */
export interface SplitEntryCoverage {
  /** Declared split, but `json-schema/<split>/` exists — it publishes on its own now. */
  selfPublishing: string[];
  /** Declared split, but its HOME publishes no `json-schema/<home>/` — the claim points at nothing. */
  homeless: string[];
  /** Declared split, and `src/<split>/` is gone. */
  orphaned: string[];
}

/**
 * Place the declared splits against the tree. The exemption a split buys in
 * `lib/schema-closure.ts` (no warning for its absent schema directory) is only
 * safe while all three hold, so `build-docs.ts` stops on any of them — the same
 * expiry discipline as `schemaClosureExemptionCoverage`, one datum over.
 */
export function splitEntryCoverage(
  allCategories: readonly string[],
  categoriesWithSchemaDir: readonly string[],
  splits: Readonly<Record<string, SplitEntry>> = SPLIT_ENTRIES,
): SplitEntryCoverage {
  const onDisk = new Set(allCategories);
  const withSchemaDir = new Set(categoriesWithSchemaDir);
  const dirs = Object.keys(splits).sort();
  return {
    selfPublishing: dirs.filter((d) => withSchemaDir.has(d)),
    homeless: dirs.filter((d) => !withSchemaDir.has(splits[d].home)),
    orphaned: dirs.filter((d) => !onDisk.has(d)),
  };
}

/** The build-stopping message for {@link splitEntryCoverage}, or null when clean. */
export function formatSplitEntryCoverage(coverage: SplitEntryCoverage): string | null {
  const lines = [
    ...coverage.selfPublishing.map((d) => `    - ${d} (declared a split entry, but json-schema/${d}/ now exists — it publishes on its own; delete the entry)`),
    ...coverage.homeless.map((d) => `    - ${d} (declared a split entry, but its home publishes no json-schema/ directory — fix the home or delete the entry)`),
    ...coverage.orphaned.map((d) => `    - ${d} (declared a split entry, but packages/spec/src/${d}/ is gone — delete the entry)`),
  ];
  if (lines.length === 0) return null;
  return (
    `SPLIT_ENTRIES in scripts/lib/split-entries.ts no longer describes this tree:\n\n${lines.join('\n')}\n\n` +
    `A split entry is exempt from the missing-schema-directory warning only because its schemas are\n` +
    `published under its home category. An entry that no longer matches the tree silences a reading\n` +
    `nobody decided to silence.\n`
  );
}
