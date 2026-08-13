---
'@objectstack/lint': minor
---

feat(lint): the unprovisioned-anchor warning reaches filter and page-binding surfaces (#8340)

#8116 taught the two rules that resolve fields **per object** (`validate-expressions`,
`validate-semantic-roles`) to warn when a reference resolves to an injected system column
that an ADR-0015 `external` object registers with no storage behind it. The
filter-position and page-binding checks could not reach that class at all: they judge a
field name against the object-independent `SYSTEM_FIELDS` union, which by design answers
"could this name be a system column anywhere" and therefore never flags a system name. A
`filter: [['owner_id', '=', '…']]` on a view, widget, page or flow bound to a federated
object linted clean while the runtime degraded exactly as #8116 describes (on SQLite:
constant-false, HTTP 200, zero rows, no error).

Four rules now ask the provenance question on the path where the existence check stays
silent, each with its own surface-specific consequence wording, all advisory
(`warning`, never gating) on #8116's severity reasoning — this pass knows the platform
provisions no storage, not what the deployment's remote schema holds:

- `dashboard-filter-field-unprovisioned` — a dashboard filter (`dateRange` /
  `globalFilters[]`, after any `filterBindings` re-target) is ANDed into a widget's
  analytics query, so the widget renders empty instead of crashing. Suppressible per
  widget via `suppressWarnings`.
- `page-field-unprovisioned` — a page/react component field binding. Names the QUERY
  degradation in filter positions and the blank-column one in display positions.
- `react-chart-field-unprovisioned` — `<ObjectChart aggregate>`'s `field` / `groupBy`.
- `flow-template-field-unprovisioned` — a `{record.<anchor>}` token in a record-change
  flow whose trigger object is external; inside a filter-guarded CRUD node's `filter`
  the token erases the authored condition and the node refuses to run (framework#3810).

`SYSTEM_FIELDS` keeps owning every existing pass/fail decision — no existence finding
changes severity or wording, and an author-declared column of the same name remains the
author's (#7859) and is never warned.
