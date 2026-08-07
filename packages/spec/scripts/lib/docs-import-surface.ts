// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Import-example names for the generated reference pages, resolved against the
 * package's REAL export surface (`api-surface/`).
 *
 * Every `content/docs/references/<category>/<page>.mdx` opens with a
 * "TypeScript Usage" block:
 *
 *     import { XSchema } from '@objectstack/spec/<category>';
 *     import type { X } from '@objectstack/spec/<category>';
 *
 * Those two lines used to be spelled straight from the JSON Schema file name —
 * `<name>` for the value import, `<name>` with a `Schema` suffix stripped for
 * the type import — on the assumption that both names exist. Nothing checked
 * it, and `check:docs` could not: it diffs the generator's output against the
 * committed docs, so a name the generator invents is "in sync" with itself
 * forever. The result was reference pages advertising imports that do not
 * compile (#4570) — and an import line in the reference docs is precisely the
 * line an AI metadata author copies.
 *
 * ## How a name is resolved
 *
 * `api-surface/` records `name (kind)` for every public entry point, so it
 * answers both questions directly. Two asymmetries drive the rules below:
 *
 *  - **Type side is decidable.** `build-api-surface.ts`'s `kindOf` tests
 *    TypeAlias/Interface BEFORE Variable, so a name that carries a type is
 *    never reported as `const`. A `type`/`interface`/`class`/`enum` kind
 *    therefore PROVES `import type { N }` resolves, and `const` proves it does
 *    not.
 *  - **Value side is not.** The same ordering hides the value half of a merged
 *    declaration: `export const FieldType = z.enum(…)` plus
 *    `export type FieldType = …` is reported as `type` only. So value-ness
 *    cannot be read off the kind, and PRESENCE is the strongest sound signal.
 *    That is enough here, because `build-schemas.ts` derives a JSON Schema's
 *    name from an actual runtime export key of that same entry by stripping a
 *    `Schema` suffix — so the const behind schema `N` is `NSchema` or `N`, and
 *    whichever of the two the entry exports is it.
 *
 * A name that resolves to nothing is not emitted (the docs stop advertising a
 * dead import) AND is reported as a gap, so the omission is loud rather than
 * silent — see `docs-import-surface.baseline.json` and the ratchet in
 * `build-docs.ts`.
 */

/** Kinds that guarantee `import type { N }` resolves. */
const TYPE_KINDS: ReadonlySet<string> = new Set(['type', 'interface', 'class', 'enum']);

/** `name (kind)` for one entry point, as recorded in `api-surface/<entry>.json`. */
export type CategorySurface = ReadonlyMap<string, ReadonlySet<string>>;

const SURFACE_LINE = /^(\S+) \((\w+)\)$/;

/**
 * Parse the aggregated api-surface record into `category -> name -> kinds`, keyed by the
 * category segment of each subpath entry (`./data` -> `data`). The root entry
 * (`.`) is skipped: reference pages import from the subpath, never the root
 * (`export * as Namespace` was removed from the root index for tree-shaking).
 */
export function loadEntrySurfaces(apiSurface: Record<string, string[]>): Map<string, CategorySurface> {
  const out = new Map<string, CategorySurface>();
  for (const [subpath, entries] of Object.entries(apiSurface)) {
    if (!subpath.startsWith('./')) continue;
    const names = new Map<string, Set<string>>();
    for (const line of entries) {
      const m = SURFACE_LINE.exec(line);
      // A format change here would silently empty the surface and strip every
      // import example — fail instead of degrading into a confident lie.
      if (!m) throw new Error(`api-surface/: cannot parse entry "${line}" under "${subpath}" (expected "Name (kind)")`);
      let kinds = names.get(m[1]);
      if (!kinds) names.set(m[1], (kinds = new Set()));
      kinds.add(m[2]);
    }
    out.set(subpath.slice(2), names);
  }
  return out;
}

/** The exported const to spell in the value import, or null when none exists. */
export function resolveValueName(schemaName: string, surface: CategorySurface): string | null {
  for (const candidate of [`${schemaName}Schema`, schemaName]) {
    if (surface.has(candidate)) return candidate;
  }
  return null;
}

/** The exported type to spell in the `import type` line, or null when none exists. */
export function resolveTypeName(schemaName: string, surface: CategorySurface): string | null {
  const kinds = surface.get(schemaName);
  if (!kinds) return null;
  for (const kind of kinds) if (TYPE_KINDS.has(kind)) return schemaName;
  return null;
}

export interface ResolvedImports {
  /** Const names for `import { … }`, in page order, dead names dropped. */
  valueNames: string[];
  /** Type names for `import type { … }`, in page order, dead names dropped. */
  typeNames: string[];
  /** The const to call `.parse()` on in the example, or null when none exists. */
  exampleValue: string | null;
  /** One stable line per name that could not be resolved. Sorted by caller. */
  gaps: string[];
}

/**
 * Resolve one page's import example. `schemaNames` are the JSON Schema names
 * the page documents, in the order they appear on the page.
 */
export function resolveImports(
  category: string,
  schemaNames: readonly string[],
  surfaces: ReadonlyMap<string, CategorySurface>,
): ResolvedImports {
  const surface = surfaces.get(category);
  if (!surface) {
    // Pages exist for a category the package does not publish as an entry
    // point: every `from '@objectstack/spec/<category>'` on the page is dead,
    // not just a name on it. Report once, emit nothing.
    return {
      valueNames: [],
      typeNames: [],
      exampleValue: null,
      gaps: [`${category}/* — no such entry point`],
    };
  }

  const valueNames: string[] = [];
  const typeNames: string[] = [];
  const gaps: string[] = [];

  for (const name of schemaNames) {
    const value = resolveValueName(name, surface);
    if (value) valueNames.push(value);
    else gaps.push(`${category}/${name} — no schema const export`);

    const type = resolveTypeName(name, surface);
    if (type) typeNames.push(type);
    else gaps.push(`${category}/${name} — no type export`);
  }

  return { valueNames, typeNames, exampleValue: valueNames[0] ?? null, gaps };
}

export interface BaselineVerdict {
  /** Gaps not covered by the baseline — a NEW dead import example. */
  fresh: string[];
  /** Baseline lines that no longer describe a gap — the ratchet must shrink. */
  stale: string[];
}

/**
 * Compare this run's gaps against the committed baseline. Shrink-only: a fresh
 * gap fails (a type alias was removed, or a schema was published without one),
 * and so does a stale line — a baseline entry left behind after its gap is
 * fixed stays available to excuse the NEXT one, which is how a ratchet quietly
 * stops ratcheting.
 */
export function evaluateBaseline(gaps: readonly string[], baseline: readonly string[]): BaselineVerdict {
  const known = new Set(baseline);
  const current = new Set(gaps);
  return {
    fresh: [...current].filter((g) => !known.has(g)).sort(),
    stale: [...new Set(baseline)].filter((b) => !current.has(b)).sort(),
  };
}
