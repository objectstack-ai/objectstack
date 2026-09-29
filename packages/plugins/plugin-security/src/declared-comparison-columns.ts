// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MatchesFilterOptions } from '@objectstack/formula';

/**
 * The declared columns of one object declaration, in the shape the record
 * matcher's comparison-class rule reads (`MatchesFilterOptions['fields']`, the
 * spec's `crossFieldComparisonVerdict` over each column's `type` and
 * `multiple`).
 *
 * ONE reading, used by the two judges that hand the matcher an object's
 * columns: the row-level write check (#20355), which judges the image a write
 * would store, and `security/explain` (#20431, #20604), which answers with the
 * refusal enforcement gives the same predicate. Where each gets the
 * declaration from is its own question; what the declaration SAYS about a
 * column is this function's, so the two cannot read one declaration two ways.
 *
 * A field map keyed by name and a list of `{ name, … }` entries read the same.
 * A declaration with no field map hands over no columns (`undefined`), and the
 * matcher then judges values only: a missing declaration never manufactures a
 * refusal. A column whose `type` is not a string is left out, so it is not
 * judged.
 */
export function declaredComparisonColumns(declaration: unknown): MatchesFilterOptions | undefined {
  const declared = (declaration as { fields?: unknown } | null | undefined)?.fields;
  if (!declared || typeof declared !== 'object') return undefined;
  const entries: Array<[string, unknown]> = Array.isArray(declared)
    ? (declared as Array<{ name?: unknown }>).filter((f) => f?.name).map((f) => [String(f.name), f])
    : Object.entries(declared as Record<string, unknown>);
  const fields: Record<string, { type: string; multiple: boolean }> = {};
  for (const [name, decl] of entries) {
    if (!decl || typeof decl !== 'object') continue;
    const { type, multiple } = decl as { type?: unknown; multiple?: unknown };
    if (typeof type !== 'string') continue;
    fields[name] = { type, multiple: multiple === true };
  }
  return { fields };
}
