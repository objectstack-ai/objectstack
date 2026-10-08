// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Conditional-visibility predicate normalization (ADR-0089)
 *
 * One concept — *"show this only when the CEL predicate is TRUE"* — used to be
 * spelled three different ways depending on the layer:
 *
 * | Layer                         | Legacy key   | Canonical    |
 * |:------------------------------|:-------------|:-------------|
 * | Data field / field option     | `visibleWhen`| `visibleWhen`|
 * | View form section / field     | `visibleOn`  | `visibleWhen`|
 * | Page component                | `visibility` | `visibleWhen`|
 *
 * ADR-0089 makes **`visibleWhen`** the single canonical key across all layers
 * (aligning with the `readonlyWhen` / `requiredWhen` family and the resolved
 * `conditionalRequired → requiredWhen` precedent). `visibleOn` and `visibility`
 * stay accepted as `@deprecated` aliases and are folded into `visibleWhen`
 * **once, at the schema boundary** (a zod `.transform()`), so no renderer or
 * validator has to re-implement the fallback.
 *
 * The *binding root* is still determined by the layer — runtime record surfaces
 * bind `record` + `current_user`; metadata-editing forms bind `data` — this
 * unifies the *name*, not the environment.
 */

/** Deprecated alias keys folded into the canonical `visibleWhen`. */
export const VISIBILITY_ALIAS_KEYS = ['visibleOn', 'visibility'] as const;

/** Object carrying the canonical key and/or its deprecated aliases. */
type WithVisibilityAliases = {
  visibleWhen?: unknown;
  visibleOn?: unknown;
  visibility?: unknown;
};

/**
 * Fold the deprecated `visibleOn` / `visibility` aliases into the canonical
 * `visibleWhen` and drop the aliases from the output (ADR-0089 D2). The
 * canonical key wins when present; otherwise the first defined alias is used.
 *
 * Designed to be used as a zod `.transform()` on any object schema that carries
 * a conditional-visibility predicate:
 *
 * ```ts
 * strictObject(VISIBILITY_STRICT_OPTIONS, { ..., visibleWhen: Expr.optional() })
 *   .transform(normalizeVisibleWhen)
 * ```
 */
export function normalizeVisibleWhen<T extends WithVisibilityAliases>(
  input: T,
): Omit<T, 'visibleOn' | 'visibility'> {
  const { visibleOn, visibility, ...rest } = input;
  const canonical =
    rest.visibleWhen !== undefined
      ? rest.visibleWhen
      : visibleOn !== undefined
        ? visibleOn
        : visibility;

  if (canonical === undefined) {
    // Nothing to fold — strip the (absent) aliases and return as-is.
    return rest as Omit<T, 'visibleOn' | 'visibility'>;
  }
  return { ...rest, visibleWhen: canonical } as Omit<T, 'visibleOn' | 'visibility'>;
}

// `VISIBILITY_STRICT_OPTIONS` — the shared `strictObject` options for the
// visibility-carrying view/page shapes — lives in `./visibility-strict-options`,
// beside its type (`StrictObjectOptions`, `./strict-object`) and OUTSIDE the
// `shared` barrel: a published const no consumer could annotate, spread or type
// a parameter with is not public API (the protocol-18 export batch; ADR-0087
// registers the removal).
