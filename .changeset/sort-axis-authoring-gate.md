---
"@objectstack/lint": minor
---

feat(lint): refuse a list-view `sort` that names a formula field, or no field at all, at authoring time (#9257)

<!-- adr-0087: not-required (already-registered engine-find-formula-order-by-refused)
This rule refuses no shape the runtime accepts — it moves an EXISTING refusal
earlier. `engine-find-formula-order-by-refused` (semantic, protocol 17) already
registers the condition and carries the identical FROM → TO prescription
("denormalise the value onto the object — a stored field, written when the
source changes — and sort by that", with `summary` explicitly unaffected); the
FROM → TO block below restates that entry's remedy for the list-view position
rather than prescribing a second, different one. The `sort-field-unknown` half
is covered by `assertSortFieldsExist` (#6994), a REST ingress refusal already
shipped. Nothing authorable is renamed, retired or tombstoned, and no
`sys_metadata` row changes shape, so there is no new conversion to register —
what changes is only WHEN the author is told. -->

**BREAKING** accept-set narrowing on a published authoring surface, shipped as
`minor` under the same lockstep launch-window convention the sibling
`filter-preset-comparand` refusal used. Measured against the shipped corpus
before landing at `error`: **56 reachable `sort` declarations across
`examples/app-showcase`, `examples/app-crm`, `examples/app-todo` and
`packages/platform-objects`, 0 violations** — so this narrows the accept set
without failing any metadata that ships today.

The SORT axis had a runtime refusal on both doors and no authoring gate. This
adds the missing half, which is the exact shape #6674 closed for the SEARCH
axis one axis over.

**What was broken.** `ListViewSchema.sort` is
`z.union([z.string(), Array<{ field, order }>])`, so the field name is a bare
string and Zod validates only the shape. A list view authored with
`sort: 'expected_revenue desc'` — a `formula` field — validated, published, and
reported valid, then answered `400 INVALID_SORT` on **first load and every
load**: the declared sort is the view's initial fetch, not an optional
interaction, so the whole view fails with a status the author cannot connect to
the declaration. Both runtime doors already refuse it — `assertSortFieldsExist`
(`@objectstack/metadata-protocol`, #6994) at the REST ingress and
`assertOrderByIsMaterializable` (`@objectstack/objectql`, #7095) on the engine's
own boundary — and neither can reach the author.

**What is refused**, at `error`, on every list-view sort a stack declares
(`objects[].listViews.*.sort`, `views[].list.sort`, `views[].listViews.*.sort`):

- `sort-field-unknown` — the name resolves to no field on the bound object.
  Judged on the head segment, matching the ingress gate's own rule so the two
  doors cannot disagree about which names are unknown.
- `sort-field-unsortable` — the name is a real field whose type is **virtual**:
  computed on read, no stored column, nothing for any driver to `ORDER BY`. An
  unrefused sort on one returns `asc` and `desc` in byte-identical order.

**What stays accepted, and this is the load-bearing half:** `summary` and
`autonumber` sorts. Virtuality is judged by `isVirtualSearchField` /
`SEARCH_VIRTUAL_TYPES` (`@objectstack/spec/data`), pinned to `formula` alone —
the same spec storage fact the search ingress gate, the engine's search
resolution and the FILTER axis' dotted-head classifier already read. It is
deliberately **not** the spec's `COMPUTED_VALUE_TYPES`: that set is the WRITE
contract ("never client-written") and gating a sort with it would refuse the two
types that sort correctly — `summary` is a `table.float` the engine maintains,
`autonumber` a `table.string` the engine assigns. Both directions are pinned by
test, and the predicate boundary itself is pinned alongside them so the two
"must not flag" cases cannot quietly stop meaning anything.

Registry-injected system columns (`created_at`, `owner_id`, …) are skipped:
they are real at runtime, never appear in authored `fields`, and `created_at` is
the single most common ordering in the platform's own list views.

## FROM → TO

```ts
// before — parsed green, published, then 400 INVALID_SORT on every load
listViews: {
  forecast: { type: 'grid', sort: [{ field: 'expected_revenue', order: 'desc' }] },
}

// after — refused at authoring time, naming the field, the position and the fix
listViews: {
  // denormalise the computed value onto a stored column and sort by that
  forecast: { type: 'grid', sort: [{ field: 'expected_revenue_stored', order: 'desc' }] },
}
```

The rule joins `REFERENCE_INTEGRITY_RULES`, so it runs on `os validate`,
`os lint` and `os compile` at once rather than being wired per command.
