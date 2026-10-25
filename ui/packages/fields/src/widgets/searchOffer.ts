/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Does a `search` on this object resolve to at least one field?
 *
 * The platform refuses a non-blank `search` over an object whose resolved
 * search set is empty with `400 INVALID_FIELD` (`param: 'search'`) — a
 * junction object made of two lookups and a composed formula title is the
 * common shape. A picker that offers type-ahead on such an object offers a
 * control the server is certain to refuse, so the record pickers ask this
 * first (objectui#12966).
 *
 * The answer is the spec's own `resolveSearchFieldResolution`, run over the
 * same inputs the engine gives it: the object's field map with every
 * `internal: true` field left out (the engine never scans one), and the
 * OBJECT's declared `searchableFields`. ⛔ No second list of searchable types
 * lives here. `displayField` is not passed: it only orders the auto-default
 * set, it never adds or removes a member, so emptiness cannot depend on it.
 *
 * A view-level `searchableFields` is not an input. The client sends it as the
 * `$searchFields` override, which the server intersects with the allowed set
 * resolved here and refuses outside it, so it can narrow a non-empty set but
 * never make an empty one searchable.
 *
 * Returns `undefined` when the schema is not known (absent, still loading, or
 * carrying no field map): the caller keeps offering search, as it did before.
 *
 * ⛔ Deliberately NOT re-exported from the package barrel: it is shared by the
 * picker widgets in this directory, not published surface.
 */
import { resolveSearchFieldResolution, type SearchFieldMeta } from '@objectstack/spec/data';

export function objectResolvesSearch(objectSchema: unknown): boolean | undefined {
  if (!objectSchema || typeof objectSchema !== 'object') return undefined;
  const schema = objectSchema as { fields?: unknown; searchableFields?: unknown };
  const raw = schema.fields;
  if (!raw || typeof raw !== 'object') return undefined;
  // The field map arrives keyed by name, or as an array of field definitions
  // carrying their `name` — the two shapes the console's schema readers accept.
  const entries: Array<[unknown, unknown]> = Array.isArray(raw)
    ? raw.map((f) => [(f as { name?: unknown } | null)?.name, f])
    : Object.entries(raw as Record<string, unknown>);
  const fields: Record<string, SearchFieldMeta> = {};
  for (const [name, meta] of entries) {
    if (typeof name !== 'string' || !meta || typeof meta !== 'object') continue;
    if ((meta as { internal?: unknown }).internal === true) continue;
    fields[name] = meta as SearchFieldMeta;
  }
  const searchableFields = Array.isArray(schema.searchableFields)
    ? schema.searchableFields.filter((f): f is string => typeof f === 'string')
    : undefined;
  return resolveSearchFieldResolution({ fields, searchableFields }).allowed.length > 0;
}
