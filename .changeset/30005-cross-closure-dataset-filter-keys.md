---
'@objectstack/lint': minor
---

fix(lint)!: under a package closure, a dashboard widget `filter` or report `runtimeFilter` on another package's dataset is judged against that dataset's object, so a key the object lacks is refused at publish (#30005)

Clause-②: no (narrowing) — the runtime publish door, for a write that names its package, refuses a dashboard widget `filter` key or a report `runtimeFilter` key on a dataset outside the package's closure when the dataset's object has no such field, a body it accepted before. Nothing is widened: `narrowObjectsToPackageClosure` keeps its signature and its four-limb answer, and no export is added to any package entry.
Metadata-protocol: narrowed
Skills-docs: none in `skills/**`, which teaches neither rule nor the closure. `content/docs/deployment/validating-metadata.mdx` names the closure's four limbs and does not yet say that a dashboard or report write also carries the base objects of the datasets it binds; that page is outside this change and is reported to the owning seat. The rules' `os explain` entries are unchanged and still describe the verdict.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: DashboardWidgetSchema.filter and ReportSchema.runtimeFilter keep their shape and meaning, and a dataset outside the closure now gets the verdict a dataset inside it already got. A refused key never served the board or the report (every reader saw an empty tile or a Dataset query failed panel), so there is no rewrite that keeps what the author meant; the author names a real field, and the refusal says which. -->

**BREAKING** accept-set narrowing at the runtime publish door for `dashboard` and `report` writes (the per-item publish and the package draft publish; Studio, REST and MCP authors), for a write whose package is known. `os validate`, `os build` and `os lint` are unchanged: they never narrow to a closure.

- **Before.** The publish gate narrows the live `objects` to the written package's closure (the package, its declared dependencies, platform objects, rows with no package) but carries every dataset. A runtime package's dashboard on `showcase_task_metrics`, a dataset the showcase package ships over `showcase_task`, therefore found the dataset but not its object, and `widget-filter-field-unknown` and `report-filter-field-unknown` skipped the filter as "object not in this snapshot". `filter: { no_such_field: 'x' }` published `200`, and every reader saw an empty tile or an error panel.
- **Now.** A dashboard or report write also carries the base object of each dataset it binds (`widgets[].dataset`; a report's `dataset` and each joined block's `dataset`), which is the object the dataset query resolves the filter against at run time. The same key is refused `422 INVALID_METADATA` at `dashboards[0].widgets[0].filter.no_such_field` (or `reports[0].runtimeFilter.no_such_field`), the verdict the same key already got on a dataset inside the closure or with no closure in force.
- **Accepted, as before.** Every key the object has, a registry-injected system column, a dotted relationship path, every `$` operator. A dotted key whose hop lands on an object the snapshot still does not carry is not judged.
- **Not changed.** Only dashboard and report writes carry the extra objects. A flow trigger, a list view or a dataset base object outside the closure is still refused as before (`flow-trigger-unknown-object`, `list-view-object-outside-closure`, `object-reference-unknown`), and a list view's `chart.dataset` brings no object in.

**What an author does.** Nothing for a board or report whose filter keys name real fields. A refused key never filtered anything, so there is no rewrite that keeps what the author meant: name a field of the dataset's object. The refusal names the key and the nearest field.
