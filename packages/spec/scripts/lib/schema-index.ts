// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Schema name -> owning reference page, keyed by `${category}/${name}`.
 *
 * `build-docs.ts` used to key both of its index maps by the BARE schema name,
 * globally. Two consequences, one hidden inside the other:
 *
 *  1. **Same name, two categories, last writer wins.** The winning side's page
 *     SLUG was then used to place the losing side's schema, so a schema landed
 *     on a page named after a file that does not exist in its own category
 *     (#4696, found while closing #4684's `RateLimitConfig` dual source).
 *  2. **A re-export is invisible.** The scan matched `export const X` only, so a
 *     name that reaches `@objectstack/spec/<category>` through
 *     `export { XSchema } from '../other/y.zod'` — or a bare
 *     `export { XSchema }` of an imported binding — had NO entry for its own
 *     category at all, and fell through to (1) by construction. That is where
 *     25 of the 26 mis-placed schemas on `main` came from, not from name
 *     collisions.
 *
 * The def key `build-schemas.ts` publishes is already `${category}/${name}`
 * (that is what `json-schema/<category>/<Name>.json` means), so the docs index
 * converges on the same key rather than inventing a second identity for the
 * same schema.
 *
 * ## What counts as "this category exports it"
 *
 * Exactly what `build-schemas.ts` sees, which is the category's runtime export
 * surface — so both a declaration and a value re-export count. Type-only
 * exports (`export type { X }`, `export { type X }`) do NOT: they publish no
 * `z.ZodType`, so they never produce a JSON Schema and must not claim a page.
 *
 * ## Which file OWNS the page
 *
 * A declaration beats a re-export: `api/realtime-shared.zod.ts` declares
 * `PresenceStatus` while `realtime.zod.ts` and `websocket.zod.ts` re-export it,
 * and the page belongs to the declaration. Everything else is a real ambiguity
 * and is reported as a conflict instead of being resolved by iteration order —
 * see `SchemaNameConflict`.
 */

/** How a `.zod.ts` file puts a name on its category's export surface. */
export type SchemaExportKind = 'declaration' | 're-export';

/** One `.zod.ts` file, as the scanner hands it over. */
export interface ZodFileInput {
  /** `src/` sub-directory the file lives in (`data`, `ui`, `shared`, …). */
  category: string;
  /** Page slug the file takes (`driver/postgres.zod.ts` -> `driver-postgres`). */
  slug: string;
  /** Path relative to `src/<category>/` — used verbatim in error messages. */
  rel: string;
  /** File contents. */
  source: string;
}

/**
 * A name whose owning page inside ONE category cannot be decided.
 *
 * Two shapes qualify, and neither may be resolved by overwrite:
 *  - two files DECLARE the name (the #4684 shape, moved inside one category);
 *  - no file declares it and two or more re-export it, so there is no
 *    declaration to break the tie.
 */
export interface SchemaNameConflict {
  category: string;
  name: string;
  /** Candidate files, `rel` paths, sorted — each with how it exports the name. */
  sites: Array<{ rel: string; kind: SchemaExportKind }>;
}

export interface SchemaIndex {
  /** Page slug owning `<category>/<name>`, or `undefined` when nothing exports it. */
  pageFor(category: string, name: string): string | undefined;
  /** Categories whose own `.zod.ts` files DECLARE `name` (re-exports excluded), sorted. */
  declaringCategories(name: string): string[];
  /** Every unresolvable name, sorted — a build-stopping condition, never a warning. */
  readonly conflicts: readonly SchemaNameConflict[];
}

/**
 * Value exports a `.zod.ts` file names, with how each one got there.
 *
 * Anchored to the start of a line, because `export` is only legal at module
 * top level and the alternative is matching the code samples inside TSDoc
 * comments — four of which (`leadSeed`, `SETUP_APP`, `nightlySync`,
 * `reportForm`) were entries in the old bare-name index, describing exports
 * that do not exist.
 */
export function exportedValueNames(source: string): Array<{ raw: string; kind: SchemaExportKind }> {
  const out: Array<{ raw: string; kind: SchemaExportKind }> = [];

  const declaration = /^export const (\w+)\s*[:=]/gm;
  let m: RegExpExecArray | null;
  while ((m = declaration.exec(source)) !== null) out.push({ raw: m[1], kind: 'declaration' });

  // `export { A, B as C, type D } from '…';` and the from-less binding form.
  // `export type { … }` is skipped whole: no runtime value, so no JSON Schema.
  const clause = /^export\s+(type\s+)?\{([^}]*)\}/gm;
  while ((m = clause.exec(source)) !== null) {
    if (m[1]) continue;
    for (const raw of m[2].split(',')) {
      const specifier = raw.trim();
      if (!specifier) continue;
      const parsed = /^(type\s+)?(\w+)(?:\s+as\s+(\w+))?$/.exec(specifier);
      // An export clause this module cannot read would silently shrink the
      // index and hand the page back to the cross-category fallback — the very
      // failure mode #4696 is about. Fail instead of under-reporting.
      if (!parsed) {
        throw new Error(
          `schema-index: cannot parse export specifier "${specifier}" — extend exportedValueNames() rather than letting the name drop out of the index`,
        );
      }
      if (parsed[1]) continue;
      out.push({ raw: parsed[3] || parsed[2], kind: 're-export' });
    }
  }

  return out;
}

/**
 * Build the category-keyed index. `toSchemaName` is injected so the suffix rule
 * stays in `lib/schema-name.ts` alone (#4592) — this module must not grow a
 * second copy of it.
 */
export function buildSchemaIndex(
  files: readonly ZodFileInput[],
  toSchemaName: (exportKey: string) => string,
): SchemaIndex {
  // `${category}/${name}` -> slug -> { rel, kinds }
  const sites = new Map<string, Map<string, { rel: string; kinds: Set<SchemaExportKind> }>>();
  const declaringByName = new Map<string, Set<string>>();

  for (const file of files) {
    for (const { raw, kind } of exportedValueNames(file.source)) {
      const name = toSchemaName(raw);
      const key = `${file.category}/${name}`;
      let bySlug = sites.get(key);
      if (!bySlug) sites.set(key, (bySlug = new Map()));
      let site = bySlug.get(file.slug);
      if (!site) bySlug.set(file.slug, (site = { rel: file.rel, kinds: new Set() }));
      site.kinds.add(kind);

      if (kind === 'declaration') {
        let cats = declaringByName.get(name);
        if (!cats) declaringByName.set(name, (cats = new Set()));
        cats.add(file.category);
      }
    }
  }

  const owner = new Map<string, string>();
  const conflicts: SchemaNameConflict[] = [];

  for (const [key, bySlug] of sites) {
    const declaring = [...bySlug].filter(([, s]) => s.kinds.has('declaration'));
    // One declaration is the answer however many files re-export it.
    if (declaring.length === 1) { owner.set(key, declaring[0][0]); continue; }
    if (declaring.length === 0 && bySlug.size === 1) { owner.set(key, [...bySlug.keys()][0]); continue; }

    const sep = key.indexOf('/');
    conflicts.push({
      category: key.slice(0, sep),
      name: key.slice(sep + 1),
      sites: [...bySlug]
        .map(([, s]) => ({
          rel: s.rel,
          kind: (s.kinds.has('declaration') ? 'declaration' : 're-export') as SchemaExportKind,
        }))
        .sort((a, b) => a.rel.localeCompare(b.rel)),
    });
  }

  conflicts.sort((a, b) => `${a.category}/${a.name}`.localeCompare(`${b.category}/${b.name}`));

  return {
    pageFor: (category, name) => owner.get(`${category}/${name}`),
    declaringCategories: (name) => [...(declaringByName.get(name) ?? [])].sort(),
    conflicts,
  };
}

/**
 * The page a reference from `fromCategory` should link `name` to.
 *
 * Own category first: the reader is on a page whose import example says
 * `from '@objectstack/spec/<fromCategory>'`, and that entry point really does
 * export the name, so sending them to another category's page would hand them a
 * different import path than the one they came from — and would leave the
 * category's own section for that name unreachable, which is the ghost-page
 * pathology one level down.
 *
 * Otherwise the DECLARING category, and only when exactly one declares it. Two
 * declarations mean the name alone does not identify a schema (the #4684
 * shape), so no link is emitted at all — a `$ref` renders as plain text rather
 * than as a confident link to the wrong schema.
 */
export function resolveSchemaPage(
  index: SchemaIndex,
  fromCategory: string,
  name: string,
): { category: string; slug: string } | null {
  const own = index.pageFor(fromCategory, name);
  if (own) return { category: fromCategory, slug: own };

  const declaring = index.declaringCategories(name);
  if (declaring.length !== 1) return null;

  const slug = index.pageFor(declaring[0], name);
  return slug ? { category: declaring[0], slug } : null;
}

/** The build-stopping message for `SchemaIndex.conflicts`. */
export function formatConflicts(conflicts: readonly SchemaNameConflict[]): string {
  const lines = conflicts.map((c) => {
    const sites = c.sites.map((s) => `        - ${c.category}/${s.rel} (${s.kind})`).join('\n');
    return `    ${c.category}/${c.name}\n${sites}`;
  });
  return (
    `${conflicts.length} schema name(s) have no single owning page inside their category:\n\n` +
    `${lines.join('\n')}\n\n` +
    `The docs index is keyed by \`<category>/<name>\` (#4696), so one of these files has to win —\n` +
    `and picking one by directory-walk order is how a schema ends up documented on a page named\n` +
    `after a file that does not contain it. Fix it at the source, not here:\n` +
    `  - two DECLARATIONS: rename one (that is what #4684 did for RateLimitConfig), or delete the\n` +
    `    duplicate and re-export the survivor;\n` +
    `  - two RE-EXPORTS and no declaration: keep the one the category should own.\n`
  );
}
