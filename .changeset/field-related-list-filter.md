---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec): field-level `relatedListFilter` — a declarative default filter for auto-derived related lists (#8704)

<!-- adr-0087: not-required (no-migration-prescription) Pure accept-set
widening: one new optional key joins the existing field-level related-list
family. Nothing is renamed, retired, narrowed or tombstoned, so there is no
conversion to register and no retirement registry entry. -->

The field-level related-list family (`relatedList` / `relatedListTitle` /
`relatedListColumns`) gains its fourth member, `relatedListFilter` — closing the
gap where the only way to filter an auto-derived related list was to abandon the
auto-derived record page for a hand-written `record:related_list` page
(maintainer ruling 2026-08-15 on #8704).

- **No new filter dialect**: the key carries the canonical Query-DSL
  `FilterCondition` (the same authoring face as a query `where`, dataset scope
  filters, and `summaryOperations.filter`). The FILTER-axis doors therefore
  apply automatically — the schema door refuses bare date-range preset
  comparands in ordering positions at parse (#8793), and the engine doors judge
  the composed query at run time (`formula` keys refused `INVALID_FIELD`,
  #8296).
- **Contract semantics, pinned**: the declared constraint is AND-composed with
  the parent-relationship condition `{ [referenceField]: parentId }` — an
  authored constraint, never a user-editable suggestion — and the related-list
  tab badge count honors the same composed filter, so counts match visible
  rows. Both clauses are normative in the key's contract text and pinned by
  tests.
- **`@objectstack/lint`**: the shared authored-filter walk (`FILTER_KEYS`) now
  recognizes `relatedListFilter`, extending the filter-token, empty-combinator
  and preset-comparand rules to the new position.

The consumption half (RecordDetailView auto-derivation + tab badge) is
objectui#4664, `Blocked-by:` this change; until it lands the key is ledgered
`planned` with an author warning.
