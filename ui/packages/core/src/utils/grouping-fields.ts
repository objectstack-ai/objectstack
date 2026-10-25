/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The THIRD half of a view's field appetite (objectui#7179).
 *
 * A list view projects what it DISPLAYS — `$select` is built from `columns`.
 * `predicate-fields.ts` covers the fields a view's PREDICATES read. This covers
 * the fields it GROUPS BY, which is a third, independent source of demand: the
 * spec's `grouping` block is a sibling of `columns`, not a subset of it, so a
 * view may legitimately group by a field it never shows.
 *
 * ## Why it needed a fix rather than a gate
 *
 * `GroupingConfigSchema` accepts `grouping` with no matching column, and the
 * neighbouring view kinds (kanban / gantt / timeline) already union their
 * `groupByField` into the projection with no column required. Grouping by a
 * field you do not want on screen is an ordinary thing to want. Refusing it at
 * author time would make the grid the odd one out and reject working intent.
 *
 * ## The failure this closes
 *
 * With the grouping field absent from `$select` the server never returns it,
 * so `useGroupedData` reads `undefined` on every row and `buildSegmentLabel`
 * answers `(empty)` for all of them: ONE group holding every record, with no
 * error, no warning and no empty state. It reads as "these records have no
 * value for this field" — a plausible, wrong, actionable conclusion about the
 * data rather than a visible bug in the view.
 *
 * ## ⛔ THE RESULT IS CANDIDATES, NOT VERIFIED FIELDS — the caller MUST gate it
 *
 * `GroupingFieldSchema.field` is a string that refuses a padded name
 * (objectui#7347 — `grouping-field-padded-refused-7347.test.ts` in
 * `@object-ui/types` pins it on every face declaring `grouping`; the trim below
 * stays as defence for blocks that skipped that parse). Nothing in the schema
 * requires it to name a field the object declares, and the whole premise of
 * this harvest is that it has NOT been through column validation. Some backends
 * answer an unknown `$select` key with an EMPTY RESULT SET rather than ignoring
 * it — the cloud multi-tenant runtime does exactly that — so a single unknown
 * grouping field put in the projection unguarded silently zeroes the whole
 * list. That would convert this card's bug (one `(empty)` group holding every
 * row) into a strictly worse one (no rows at all, still silent).
 *
 * So every caller intersects this result with the object's declared fields —
 * {@link isProjectableField}, or the caller's equivalent known-field set —
 * exactly as {@link collectPredicateFieldRefs}'s callers do, and for the same
 * measured reason. Callers additionally FLS-gate it: a grouping field names a
 * field just as capable of being denied as a column is, and the projection is
 * what goes on the wire (objectui#6898).
 *
 * @param grouping - The view's `grouping` block in any authored state
 *   (`undefined`, malformed, or the spec shape). Anything that is not an entry
 *   carrying a non-empty string `field` contributes nothing, so a malformed
 *   block yields an empty harvest instead of a plausible wrong name.
 * @returns Grouping field names in first-seen order, deduplicated.
 */
export function collectGroupingFieldRefs(grouping: unknown): string[] {
  const fields = (grouping as { fields?: unknown } | null | undefined)?.fields;
  if (!Array.isArray(fields)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of fields) {
    // The spec shape is `{ field, order, collapsed }`. A bare string is NOT
    // accepted here even though it would be a natural shorthand: `grouping` is
    // a `$strict` object schema in `@objectstack/spec`, so a bare string is
    // off-spec metadata, and reading it anyway would be exactly the lenient
    // renderer-side alias AGENTS.md #0.1 forbids — it fossilizes a second
    // de-facto contract instead of having the producer rejected at publish.
    const name = (entry as { field?: unknown } | null | undefined)?.field;
    if (typeof name !== 'string') continue;
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
