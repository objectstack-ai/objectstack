---
'@objectstack/lint': patch
---

lint: `dashboard-filter-field-unknown` resolves dotted dashboard-filter fields on the object graph, and answers system columns per object

A dashboard-level filter (`dateRange`, or a `globalFilters[]` entry) is ANDed into
**every** widget's analytics query, so its effective field — after any
`filterBindings` re-target — has to resolve on each bound widget's dataset object.
The rule that enforces that shipped with two holes, and this closes both by
migrating the check onto the shared `resolveFieldPath` / `joinablePrefixes` seam
the widget's own `filter` keys already use one position over.

- **Dotted paths are no longer skipped.** The branch carried
  `if (field.includes('.')) continue;`, accurate when nothing in the package could
  walk relationship hops and false since the object-graph seam landed. A filter
  re-targeted to `account.signed_at` was unjudged whether or not `account` existed,
  whether or not `signed_at` existed on it, and whether or not `account` was
  declared in the dataset's `include`. It is now walked hop by hop, and a miss
  names **which** hop failed.
- **System columns are resolved per object, not through the flat union.** The old
  test was `objectFields.has(field) || SYSTEM_FIELDS.has(field)`, which answers
  "could this be a system column *anywhere*". On an `ownership: 'none'` object the
  platform injects no `owner_id`, and on `systemFields: { audit: false }` no
  `created_at` — both were answered as resolvable and are now reported.

New error id **`dashboard-filter-field-not-included`**: the effective field
resolves, but its relationship prefix is not declared in the bound dataset's
`include`, so ADR-0021 compiles no join and the column is out of the broadcast
query's reach. It mirrors `widget-filter-field-not-included` one level down, and is
its own id because the fix is a different edit (declare the join, versus point the
filter at something real).

This **narrows the accept set of a shipped gating rule**. Both new answers are
error-tier, so like the rule's other errors they fail `os validate` / `os build`
and the runtime publish gate for `dashboard` writes. Measured over the shipped
dashboard corpus — the three example apps plus the platform's own
`system_overview` — the change is 0 findings before and 0 after; the
`dashboard-filter-field-unprovisioned` warning is unchanged and now travels with
the verdict, so it answers a dotted path landing on an ADR-0015 `external` object
too.
