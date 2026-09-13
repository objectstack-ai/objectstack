---
"@objectstack/spec": minor
---

feat(spec)!: `ListViewSchema.sort` retires the bare string clause — the PRODUCER half of the sort seam, so the contract stops minting documents its own consumer refuses (#17053; objectui#8221, decision batch #77 option B)

<!-- adr-0087: registered list-view-sort-string-clause-to-array -->

**BREAKING** accept-set narrowing at `view.sort` — the list-view doors
(`ListViewSchema`, and the `ObjectListViewSchema` copy behind `object.list` /
`object.listViews.*`) — shipped as `minor` under this repo's launch-window
convention for breaking changes, the same grade its sibling
`object-block-sort-item-array` took for the two `ComponentPropsMap` doors. The
mechanical prescription is registered under protocol major 18 as
`list-view-sort-string-clause-to-array`.

**Why this is graded on the seam, not on the string.** objectui ruled one sort
orthography platform-wide — the array (objectui#8221, decision batch #77,
2026-09-07, option B) — and objectui PR #8758 executes it: `convertSortToQueryParams`
refuses a runtime string and its diagnostic names the array form. `ListViewSchema`
is the producer of exactly those documents: `object.list.sort` is what
`deriveRelatedLists` reads. So until this release a view authored with
`sort: 'created_at desc'` **validated here, cleanly, and then failed downstream** —
the contract minting a shape its consumer rejects, with the author told off by
the wrong layer. Re-measured on this tree before the change, with `bogusProp`
refused by name on the same call as the firing control: `'name desc'`, `'-name'`
and the array form all returned `success: true`, and only a bare number was
refused (`sort/invalid_union`).

`sort` survives as a key, one union arm lighter, so this is a VALUE narrowing with
no `retiredKey()` tombstone to hang a prescription on. The surviving array member's
own `error` map carries it, keyed on `issue.input` being a string — the same shape
`view.type`'s retired `'page'` value and `view.exportOptions`' retired `'pdf'` value
already use in this schema. Every other invalid value (a number, an object, a
string reaching a *descendant* such as a misspelled `order`) keeps zod's default
report, so nobody is told a clause they never wrote "was removed".

**Migration** (`list-view-sort-string-clause-to-array`, a D2 conversion, not a
semantic TODO — the rewrite is lossless and wholly mechanical):
`sort: 'created_at desc'` becomes `sort: [{ field: 'created_at', order: 'desc' }]`;
a bare field name meant ascending, so `sort: 'created_at'` becomes
`sort: [{ field: 'created_at', order: 'asc' }]` — `order` is required on the entry
and is written out rather than omitted; a comma-separated clause becomes one array
entry per key, in the same order. `os migrate meta --from 17` lists these edits for
author sources, and stored rows replay them through `applyConversionsToStoredItem`.

**The narrowing was not free, and the population was measured rather than assumed.**
A tree-wide census over both the TS and JSON spellings of a string-valued `sort`,
read as STRUCTURES rather than counted as tokens, found the clause authored on
three live in-tree sites, all converted here: the shipped showcase list view
`examples/app-showcase/src/ui/views/task.view.ts` (`'estimate_hours desc'`, carried
since objectui#2601 as a deliberate live coverage fixture for the string form), the
frozen `packages/lint` snapshot of that same shipped shape, and the published
`skills/objectstack-ui` list-view rule. The census fired: it *found* documents, and
`tsc` independently reds on the first two the moment the arm is removed. Sites
deliberately NOT converted, having been read rather than grepped: ObjectQL
`query.sort` and the wire `normalizeSortNodes` (different doors, different
dialects), `packages/spec`'s `book`/`doc` field-mapping records whose `sort: 'order'`
is an unrelated key of the same name, and the `packages/lint` rule fixtures, which
feed the PRE-parse walker and never reach this schema.

**Not moved by this release.** `RecordRelatedListProps.sort` keeps its declared
string arm. That string is the `'field'` / `'-field'` dialect normalised by
objectui's own `RelatedList.normalizeSortSpec`; it never reaches
`convertSortToQueryParams`, and retiring it was not ruled. For the same reason the
conversion above declines any clause that does not parse as `<field> [asc|desc]`:
guessing a direction for `'-name'` would invent an ordering the author never wrote,
so on a list view it meets the door's prescription instead.
