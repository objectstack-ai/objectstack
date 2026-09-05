# ADR-0071: Dataset semantic-layer depth — multi-hop joins

## Status

Proposed. (Refocused — see **Correction** below. The first merged draft also
proposed matrix/across pivoting; a code check found that already implemented, so
this ADR now covers only the remaining gap: multi-hop joins.) **Multi-hop to-one joins (≤3 hops / 4 objects) have since been implemented & are live — header pending formal update.**

## Correction (2026-06-24)

The first merged draft listed **matrix / across pivoting** as an open gap (a
proposed "P1"). That was wrong — a check of the current code found matrix
pivoting **already implemented end-to-end**:

- **Render** — `objectui:packages/plugin-report/src/DatasetReportRenderer.tsx` →
  `DatasetMatrixTable` does a true cross-tab: one dataset query over
  `[...rows, ...columns]`, pivoted client-side into row × column × measure cells,
  with server-supplied row/column subtotals + grand total and drill-down. Covered
  by `DatasetReportRenderer.test.tsx`.
- **Author** — `objectui:packages/app-shell/src/views/metadata-admin/inspectors/ReportDefaultInspector.tsx`
  offers `type: 'matrix'` and a dedicated "columns across" dimension editor;
  `packages/spec/src/ui/report.form.ts` reveals `columns` when `type == 'matrix'`.

The ADR-0021 D2 matrix follow-up is therefore **satisfied**; the stale "flattened"
note came from the ADR-0021 era and predates that renderer. This ADR is refocused
on the one follow-up that remains open: **multi-hop joins**.

## Context

ADR-0021 established the `dataset` semantic layer: a base `object`, relationships
to `include` (joins **derived** from the object graph — no hand-written `ON`
clauses), and named `dimensions` / `measures` that presentations bind by name.
RLS/tenant scoping is enforced per joined object at runtime (D-C, fail-closed).

**Single-hop joins only.** `Dataset.include` is `string[]` of relationship
**names** (lookup / master_detail fields on the *base* object), and a
dimension/measure `field` uses a one-dot `relationship.field` path.
`native-sql-strategy.ts qualifyAndRegisterJoin` splits on the **first** dot — the
code comment is explicit: *"Only the first dotted hop is supported (single-level
relation)"* (`const [alias, ...rest] = rawSql.split('.')`). So `account.region`
works, but a two-hop path like `account.owner.region` is parsed as
alias=`account`, column=`owner.region` → invalid SQL. You cannot group/aggregate
by a field two relationships away (e.g. `opportunity → account → owner → region`).

## Prior art / industry alignment

- **Curated join graph, not arbitrary SQL.** Salesforce *report types* pre-wire
  a primary object + up to 3 related objects; Looker *Explores* declare blessed
  joins; Power BI / Tableau model **relationships** and the engine resolves the
  path; Cube (this platform's runtime) resolves **transitive joins** from
  pairwise relationship declarations. All keep joins governed and derived from
  the object graph — ADR-0021's D-C stance. This ADR stays in that lane (no `ON`).
- **Spanning depth.** Salesforce report types reach 4 objects (≈3 to-one hops);
  SOQL allows 5 levels of parent traversal. A small fixed depth covers the vast
  majority of real reports.
- **The fan-out lesson.** Looker (*symmetric aggregates*) and Tableau
  (*relationships vs. joins*) exist because joining across a **to-many** edge and
  then aggregating **double-counts**. The robust answer for a governed,
  AI-authored, RLS-scoped layer is to **not** traverse to-many in the join chain
  (see Decision) rather than build symmetric-aggregate machinery now.

## Decision — multi-hop joins (framework: spec + compiler + strategy + RLS)

- **To-one only (the correctness boundary).** Multi-hop traversal is restricted
  to **to-one** relationships — `lookup` / `master_detail` (child→parent), which
  is exactly what `include` holds today. To-one chains **never fan out**, so
  existing `SUM`/`COUNT`/etc. stay correct with **zero** symmetric-aggregate
  machinery. Traversing a **to-many** (child) relationship inside a dataset's
  join chain is explicitly **out of scope** (it needs symmetric aggregates /
  sub-query rollups — a separate feature). The depth cap below is therefore a
  **performance/complexity** guard, not a correctness one.
- **Spec.** `Dataset.include` accepts relationship **paths** — dotted chains of
  to-one relationship field names from the base object (`'account'`,
  `'account.owner'`). A dimension/measure `field` may reference any field
  reachable along a **declared** path (`account.owner.region`). The dotted path
  **is** the join alias, so paths are **self-disambiguating** (no named-join
  disambiguation as in Power BI active/inactive or Looker aliased joins). A depth
  cap (default **3 hops** → 4 objects, Salesforce-report-type parity) bounds join
  count/perf; undeclared paths are still rejected (D-C unchanged).
- **Compiler** (`dataset-compiler`). Expand each `include` path into the ordered
  join chain; `cube.joins` keyed by the full path alias (`account.owner`),
  carrying `{ parentAlias, fkField, targetObject }` so the chain is reconstructable.
- **Strategy** (`native-sql-strategy.qualifyAndRegisterJoin`). For `a.b.c`,
  register the chain (`base → a` on alias `a`; `a → b` on alias `a.b`) and qualify
  the column as `"a.b"."c"`. Emit `LEFT JOIN`s (outer — base rows without a
  related record still appear, the report-friendly default) in dependency order.
  Base columns stay qualified with the base table so shared names stay unambiguous.
- **RLS (D-C, fail-closed).** Apply the tenant read-scope to **every** object in
  the chain, not just the first hop. The strategy already scopes per joined
  alias; generalize the loop to each hop's target object.
- **UI** (objectui). `useDatasetFieldCatalog` lazily expands a relationship's own
  **to-one** relationships (one more level on demand) so the field picker offers
  `account.owner.region`; the include editor shows/edits paths; the existing
  `missingRelationship` author-time validation generalizes to paths.

## Consequences

- New capability: analytics two-plus to-one hops deep.
- Cost/risk: multi-hop multiplies `LEFT JOIN`s (perf) and widens the RLS surface
  (each hop scoped) — bounded by the depth cap + declared-path allowlist. No
  fan-out risk by construction (to-one only).
- **Backward compatible.** Single-hop `include` keeps working unchanged; the
  depth cap default preserves current behaviour.

## Phasing

- **P1 — multi-hop (framework).** Spec path support + compiler chain + strategy
  chained joins + per-hop RLS, behind the depth cap, **to-one only**. Gated by
  the ADR-0021 reconciliation harness (old-vs-new numbers).
- **P2 — objectui catalog/UI.** Multi-hop field picker + include-path editor +
  path-aware author-time validation.

## Alternatives considered

- **Arbitrary join predicates / raw SQL** — rejected (ADR-0021 D-C: joins derived
  from the object graph, no `ON` clauses; reviewable and RLS-safe). Matches
  Salesforce/Cube/Power BI, not the developer-only Looker `sql_on`.
- **To-many traversal with symmetric aggregates** — deferred. Correct
  cross-to-many aggregation (Looker-style symmetric aggregates) is a separate,
  larger feature; the to-one boundary delivers the common case safely first.
- **Edge-graph + automatic path resolution** (Cube/Power BI style) — rejected for
  v1 in favour of explicit dotted paths: smaller delta, self-disambiguating, and
  per-path RLS-auditable.

## Related

- ADR-0021 (analytics dataset semantic layer) — the foundation; the matrix D2
  follow-up (now confirmed implemented) and the join follow-up this ADR addresses.
