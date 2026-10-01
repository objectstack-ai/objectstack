---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the nested-relation filter `{ relation: { field: value } }` gets the engine's answer on every analytics face — the related object read as the caller, capped

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a change of what the analytics query doors answer for one filter form, the nested-relation condition `{ relation: { field: value } }`: it is now answered by the data engine, which reads the related object as the caller and refuses past its cap, where the analytics layer used to join the related table itself. No authorable key, spelling, export or stored shape moves: `@objectstack/service-analytics` exports nothing new and nothing less, `FilterCondition`, `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every value they parsed, and no stored row is read or rewritten. What a stored dashboard or dataset filter carrying the form now gets is the engine's own answer for the same filter on `find()`, so there is no older meaning to preserve or rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a filter's analytics semantics (not `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what the analytics query doors answer for the nested-relation filter form — a plain object with no `$` key beneath a field, `{ owner: { region: 'NA' } }` — on the native-SQL path, and widens it everywhere else. It holds on `POST /api/v1/analytics/query`, on `POST /api/v1/analytics/dataset/query`, and on their dry run `POST /api/v1/analytics/sql`, on every SQL driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What an author sees now.** The same answer `find()` gives for the same filter. The data engine reads the related object with the condition as the caller — that object's row scope and field permissions apply — and matches the relation against the ids it returns: `$in` on a single-valued relation, any member on a multi-valued one. It is the one rule, in the engine; the analytics layer holds no copy of it.

- A condition on a field of the related object the caller cannot read is refused with `403 PERMISSION_DENIED`, naming the field — never answered.
- A condition matching more than 1,000 related records is refused with `400 INVALID_FILTER`, naming the two-step route — never run over a cut-off list.
- At a measure's own `filter` the form is refused with `400 INVALID_FILTER`, as the engine refuses it at an aggregation's own `filter`: put the condition in the query's `where`.
- `POST /api/v1/analytics/sql` refuses a `where` carrying the form with `400 INVALID_FILTER`: no statement it could print reproduces a read of the related object as the caller. The query itself is answered by `POST /api/v1/analytics/query`.

**Why.** Measured on the base before the field-level gate (#20917) and the relationship-path admission (#20933) landed, over one fixture with the real security layer (a related field the caller may not read, a related row scope, 1,001 matching related records). The native-SQL strategy flattened the form to a dotted member and joined the related table: through a dataset that `include`d the relationship it answered rows for a condition on a field the caller cannot read, answered a match past the engine's cap, and counted a measure filter carrying the form; without the declared join it named a table that does not exist (500), and a multi-valued relation was refused. The engine-aggregate strategy refused the form as a cross-object filter (400). The engine serves the form since the nested-relation filter landed in `where`.

**How.** The native-SQL strategy declines a query in which the form appears in the `where`, the dataset's own `filter` or a requested measure's `filter`, so the query runs on the engine-aggregate path, which hands the form to the engine as written.

**A read scope carrying the form.** Unchanged in outcome: where a read scope is compiled to SQL (`compileScopedFilterToSql`, on the native-SQL path and in both SQL echoes) it is still refused fail-closed with `500 READ_SCOPE_COMPILE_FAILED`, the policy withheld — that compile holds no data engine to read the related object with. Its words now name the route that serves the form. On the engine-aggregate path the scope reaches the engine as written, and the engine serves it as the caller, as before.

**Who is affected.** A dashboard, dataset or caller that wrote the nested form in an analytics filter on a SQL driver and read the joined answer: a condition on a related field the caller may not read, a match past 1,000 related records, a measure filter carrying the form, or a query that needs the native-SQL strategy for another part (a cross-object measure, a multi-hop dimension), which the engine-aggregate path refuses in its own words.

**Unchanged.** The dotted cube member (`{ 'owner.region': 'NA' }`), a traversal through the cube's declared join; an empty object beneath a field (`{ owner: {} }`), still refused as a field constraint with no operator; every filter without the form.
