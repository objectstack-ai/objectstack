---
"@objectstack/spec": minor
---

feat(spec)!: `object-grid` and `object-calendar` constrain the `sort` VALUE to the `SortItem` array — one sort orthography platform-wide reaches the last two unconstrained doors (#16553; objectui#8221, decision batch #77 option B)

<!-- adr-0087: registered object-block-sort-item-array -->

**BREAKING** accept-set change at two doors — `ComponentPropsMap['object-grid'].sort`
and `ComponentPropsMap['object-calendar'].sort` — shipped as `minor` under the
repo's launch-window convention for breaking changes; the migration prescription
is registered under protocol major 18 as `object-block-sort-item-array`.

One `sort` spelling platform-wide, the array (objectui#8221, decision batch #77,
2026-09-07, maintainer verbatim 「其他同意」, option B; the consumer half is
objectui PR #8758, which drops the legacy string arm from
`convertSortToQueryParams`). Item 4 of that ruling is this release's subject:
「`ComponentPropsMap` for `object-calendar` and `object-grid` constrains the
`sort` value to the array shape (today it accepts anything), so the spec, the
registrations and the helper agree; that is a pull-back to the declared contract,
ordinary tier」.

Until this release both doors declared `z.unknown()` — no orthography at all.
Measured on `@objectstack/spec` 17.2.0 and re-measured on this tree before the
change: an array, the legacy string clause and a bare NUMBER all returned
`success: true`, while `bogusProp` was refused by name on the same call. So key
checking was live and only the VALUE was unheld, and an author following
objectui's own registrations (`plugin-grid/src/index.tsx:222` has published
`type: 'array'` all along) and an author following the legacy string each got a
silent success receipt for a different shape — while objectui's html tier
answered `type-mismatch` on the second one. Both doors now declare
`z.array(SortItemSchema)`, the array `ElementDataSourceSchema.sort`,
`ListPageSchema.sort` and `element:record_picker`'s flat `sort` shorthand already
carry: one shared schema, not a third copy.

Sequenced measurement-first, as this family has to be. At the objectui pin this
repo builds against (`53ded82b`) the string is still lowered —
`ObjectGrid.tsx:1844-1851` carries an explicit `typeof === 'string'` arm onto
`$orderby` beside the array arm, and `ObjectCalendar.tsx:431` hands `schema.sort`
to `convertSortToQueryParams`, whose string arm is still present at
`sort-query.ts:66-70`. This declaration therefore lands ahead of the pinned
consumer, which the ruling permits explicitly — either order, since the
registrations already declare the array — and the next pin bump carries the
retirement in.

**Migration** (`object-block-sort-item-array`): `sort: 'created_at desc'` becomes
`sort: [{ field: 'created_at', order: 'desc' }]`; a bare field name
`sort: 'created_at'` meant ascending and becomes
`sort: [{ field: 'created_at', order: 'asc' }]` — `order` is required in
`SortItemSchema`, so it is written out rather than omitted; a comma-separated
clause becomes one array entry per key, in the same order. The string is refused
at `sort` (`invalid_type`, expected array), as is a bare number; a misspelled or
absent direction is refused at `sort.0.order`. Metadata AT REST is not rewritten
and this disposition adds no D2 conversion — a stored page carrying a string
`sort` keeps loading and still renders at the pinned `.objectui-sha`; what
changes is that RE-SAVING it is refused at the `sort` door.

**Not moved by this release.** `record:related_list.sort` keeps its declared
string arm: that string is the `'field'` / `'-field'` dialect read by
`RelatedList.normalizeSortSpec`, it never reaches `convertSortToQueryParams`, and
retiring it was not ruled — objectui#8221's own implementing round narrowed it,
established the dialect and reverted the narrowing byte-identically.
`object-grid.defaultSort` is a different key, already retired by #11805. Zero
authored `sort` values on either block exist in this repo (the two showcase pages
that author `object-grid` declare none), so nothing in-tree was converted.

Type aliases are unchanged: `SortItemSchema`'s input equals its infer, so neither
block's parsed state moves for this key, and both already take the
`…PropsParsed` route for `filter` (ADR-0122).
