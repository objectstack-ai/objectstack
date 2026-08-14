---
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": minor
---

fix(filter): a `where` on a virtual `formula` field is refused, not answered with zero rows (#8296)

**BREAKING** — this is a public API contract change on the query engine, not a
plain bug fix: a `where` on a `formula` field used to succeed (with the wrong
answer) and now throws. Every call site that reaches `assertFilterIsMaterializable`
— `engine.find`, `findOne`, `count`, `aggregate`, `update`, `delete` — can newly
raise `400 INVALID_FIELD` for input it previously accepted with a `200`. Graded
`minor`, not `major`: every publishable package sits in the Changesets `fixed`
lockstep group during the launch window (`scripts/check-changeset-no-major.mjs`),
so a `major` here would promote the whole ~70-package stack for one engine seam.
See "What to change if this refuses one of your queries" below for the fix.

`formula` is the one field type no driver materialises a column for. Three query
axes can name a field; until now only two of them said so.

| axis | verdict for a `formula` field |
|:---|:---|
| SORT | `400 INVALID_SORT`, ingress (#6994) and engine (#7095) |
| SEARCH | `400 INVALID_FIELD`, refused by name (#6674) |
| **FILTER** | **accepted — 200, 0 rows, no error** |

`assertFilterFieldsExist` computed exactly one verdict — is this name a field of
the object — and a `formula` field IS one, so the predicate cleared the door and
reached a driver with no column behind it. Measured on a real `ObjectQL`, with
`is_open` a `formula` over the stored `status` column:

```
where { is_open: true  }              ->  0 rows, no error
where { is_open: false }              ->  0 rows, no error
CONTROL where { status: 'open' }      ->  4 rows
CONTROL where { subtask_total: 5 }    ->  1 row     (`summary` HAS a column)
```

Both directions are wrong and the `false` one is the dangerous one: the same
predicate against a STORED boolean returns every row, so a filter meaning "not
yet done" silently became "no records at all" — a row SET changed under a 200,
which no amount of inspecting the response can reveal. The formula READS
correctly in that very same response, so the field is visibly populated and
simultaneously unfilterable.

Both doors now refuse it with `400 INVALID_FIELD`, naming the offending key path
and prescribing the remedy the sort and search axes already share:

- **ingress** — `assertFilterFieldsExist` grows a second verdict, after
  `unknown`, covering everything that reaches `findData`: the list route,
  `POST /data/:object/query`, the export route and the RPC dispatcher, in every
  filter spelling (`where` / `filter` / `filters` / `$filter`, the array sugar,
  and nested `$and` / `$or`);
- **engine** — `assertFilterIsMaterializable` closes the half the ingress cannot
  reach. It is author-reachable, not merely internal: a saved report's
  `query.filter` is forwarded verbatim into `engine.find`, exactly as #7095
  measured for `query.orderBy`. It runs at the engine's one filter-lowering
  seam, so `find`, `findOne`, `count`, `aggregate`, `update` and `delete` all
  answer alike, and it judges the CALLER's `where` only — a middleware-injected
  RLS or sharing predicate is the platform's own and is never refused.

Both doors judge the field by the same `@objectstack/spec/data` predicate the
search axis uses (`isVirtualSearchField` / `SEARCH_VIRTUAL_TYPES`) rather than a
locally minted type list, so a gate and the drivers cannot disagree about which
types have a column.

**`summary` and `autonumber` are unaffected and still filter** — both get real
stored columns; the set is exactly `formula`. Reading, projecting and computing a
formula field are untouched; only the predicate is refused.

**What to change if this refuses one of your queries:** denormalise the value
onto the object (a stored field, written when the source changes) and filter
that. There is no mechanical rewrite in either direction — the platform cannot
invent the stored column, and it must not filter post-hoc after the formulas are
evaluated, because the driver has already applied `limit` / `offset`, so a
post-hoc predicate would filter an arbitrary PAGE. Grep your saved reports,
flows, dashboards and view filters for a filtered field whose object declares it
as a `formula`.

**In-tree sweep — source AND tests.** No shipped example app's *metadata* filters
a formula field: the ones the examples declare (`crm_contact.full_name`,
`crm_opportunity.expected_revenue` / `days_to_close`, `crm_lead.is_closed`,
`showcase_project.budget_remaining`, `showcase_field_zoo.f_formula`) appear only
as view columns, form fields, permission entries and record-level CEL
predicates — never in a `where` / `filter`. One in-tree TEST did filter one and
is updated in this change: `examples/app-todo/test/derived-flag-removal.test.ts`
registers a test-local formula-shaped object to record *why* two inert flags were
removed rather than derived, and pinned the behaviour this refusal abolishes —
filtering a formula answering 0 rows with no error. It now asserts the
`400 INVALID_FIELD` envelope instead; its conclusion is unchanged, because a
formula still cannot be filtered. The first sweep read app source only, which is
the wrong half: current behaviour is pinned in tests, so a behaviour change lands
there first.

<!-- adr-0087: not-required (no-migration-prescription) this is a runtime query-validation behavior change, not a spec/metadata key rename or removal -- no field, key or stored value moves, so there is nothing for the migration ledger or `objectstack migrate meta` to register. The guidance above (denormalise onto a stored field and filter that) is behavioral advice for API consumers, not a mechanical rewrite of stored metadata. -->
