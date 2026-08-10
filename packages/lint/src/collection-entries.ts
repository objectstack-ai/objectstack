// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared stack-collection enumeration (issue #6662) — the one coercion from a
 * collection authored EITHER as an array OR as a name-keyed map into the
 * records it holds, each carrying the config path it actually sits at.
 *
 * This helper had grown THREE independent copies in this package, all on the
 * same view-walking rules that #6381 had just converged onto one descent
 * (`view-walk.ts`): `validate-form-layout.ts`, `validate-translatable-sections.ts`
 * and `validate-visibility-predicates.ts`. The duplication was already
 * acknowledged in-tree — `validate-form-layout.ts`'s copy said out loud "Same
 * helper, same reasoning as `validate-visibility-predicates.ts` and
 * `validate-translatable-sections.ts`" — which records the cost without paying
 * it. The copy COUNT is the argument for this file, exactly as it was for
 * `view-walk.ts` and `page-walk.ts` (#3583): with three, the next author fixes
 * one and the two survivors keep the old answer.
 *
 * ## Why the PATH is the point
 *
 * The sibling rules that do not report a location coerce with a local `asArray`
 * and throw the path away. A rule that emits findings cannot: findings are
 * consumed as EDIT TARGETS (`os lint --json`, Studio's finding renderer), so a
 * map-shaped collection must not report a synthetic array index nobody can look
 * up. `views[2]` is the honest path for the array shape and
 * `views.contact_views` for the map, and this helper is the only place that
 * decides which.
 *
 * ## Why the map shape injects `name`
 *
 * The map key IS the entry's name on that shape, so it is spread in as `name`
 * (`{ name, ...def }`, key first so an entry's own `name` still wins). That is
 * how an unnamed-but-keyed view still locates itself in a message — a rule that
 * read only `rec.name` would otherwise print an anonymous finding for an entry
 * the author named perfectly well.
 *
 * ## Non-records are skipped, not coerced
 *
 * On both shapes an entry that is not a record is dropped rather than repaired.
 * Callers therefore receive records only, which is what lets
 * `viewContainerSites` open with a defensive `isRec` guard it documents as
 * unreachable from the in-repo callers.
 */

type AnyRec = Record<string, unknown>;

/** One record of a collection, with the config path it sits at. */
export interface CollectionEntry {
  /** The record itself. On the map shape, with the map key spread in as `name`. */
  rec: AnyRec;
  /** Config path — `views[2]` for the array shape, `views.contact_views` for the map. */
  path: string;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Every record in a collection authored either as an array or as a name-keyed
 * map, each with its config path. `base` is the caller's path prefix for the
 * collection itself (e.g. `views`, `objects[0].views`).
 *
 * Order is the collection's own order — array index order, or `Object.entries`
 * insertion order for the map — because findings are emitted in walk order and
 * every consumer's pinned output order depends on it.
 */
export function collectionEntries(v: unknown, base: string): CollectionEntry[] {
  if (Array.isArray(v)) {
    const out: CollectionEntry[] = [];
    for (let i = 0; i < v.length; i++) {
      if (isRec(v[i])) out.push({ rec: v[i] as AnyRec, path: `${base}[${i}]` });
    }
    return out;
  }
  if (isRec(v)) {
    return Object.entries(v)
      .filter(([, def]) => isRec(def))
      .map(([name, def]) => ({ rec: { name, ...(def as AnyRec) }, path: `${base}.${name}` }));
  }
  return [];
}
