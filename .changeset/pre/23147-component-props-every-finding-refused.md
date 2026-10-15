---
'@objectstack/lint': major
'@objectstack/spec': patch
---

Every finding of the component-props gate is now an error at `objectstack validate`, `objectstack build` and `objectstack lint`. A page component whose `properties` carry a key its `ComponentPropsMap` row does not declare, a value that row rejects, or no `dataSource.object` binding where the element reads only that binding drew a warning: the command printed "✓ Validation passed" and built the artifact, and the renderer ignored the key or drew nothing. Each is now a `component-props-unknown-key` or `component-props-invalid` error, and the stack does not pass until it is fixed. A retired prop was already refused, and still is.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered element-data-source-and-object-block-filter-rule-array, element-flat-data-binding-retired, element-text-variant-heading-subheading-retired, ui-action-group-menu-member-params-array-only, ui-action-group-menu-members-typed, ui-object-block-grouping-config-typed, ui-object-form-custom-fields-typed, ui-object-form-fields-names-typed, ui-object-form-members-typed, ui-object-form-sections-typed, ui-object-gantt-markers-typed, ui-object-grid-columns-typed, ui-object-grid-export-options-closed, ui-object-grid-kanban-calendar-list-members-typed, ui-object-grid-page-size-positive-integer-refused, ui-object-grid-row-members-typed, ui-object-kanban-conditional-formatting-typed, ui-object-map-gantt-tree-navigation-typed, ui-object-master-detail-form-details-closed, ui-object-metric-aggregate-trend-typed, ui-object-metric-compare-to-typed, ui-object-metric-drill-down-report-typed, ui-object-metric-drill-down-typed, ui-object-timeline-items-typed, ui-object-timeline-mapping-typed, ui-record-line-items-props-closed) Every props shape this refuses on was declared, and each narrowing of one recorded in its own D3 entry, before this change; the entries named here are the step's narrowings whose refusal the gate carries, and this diff amends the reason text of each one that called that refusal advisory, to say it is now an error. It moves only the severity of the lint findings, so it adds no entry, and no conversion: nothing on the load path refuses a page's `properties`. -->

**BREAKING**: an accept-set narrowing on a published authoring surface (the `component-props-invalid` and `component-props-unknown-key` rules of `objectstack validate`, `objectstack build` and `objectstack lint`).

**What is refused now.** Every verdict of the gate:

- `component-props-unknown-key`: a key the component's props row does not declare, at the bag's own level, on a strict object or union arm below it, or on a strip-mode object below it.
- `component-props-invalid`: a value the props row rejects (a wrong type, a missing required prop, a closed-set refusal such as a url action's `target` scheme or a `record:details` section's `count`, a retired enum value), and a missing `dataSource.object` on `element:record_picker`, `element:number` and `element:repeater`.

**Not judged here.** `defineStack` and the stack schema keep the open `properties` bag as written. A component `type` that `ComponentPropsMap` carries no row for (a `custom.*` or plugin type) is not judged.

`ComponentPropsSeverity`, the type `@objectstack/lint` exports for these findings, narrows from `'error' | 'warning'` to `'error'`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `page:header` `properties: { titel: 'Deals' }` | `properties: { title: 'Deals' }`, the declared spelling the error names |
| `record:related_list` `properties: { limit: 'five' }` | `properties: { limit: 5 }`, the type the error names |
| `element:number` with no `dataSource` | `dataSource: { object: 'deal' }` on the component node, beside `type` |
| a key the component does not read | nothing: delete the key |

**The one-line fix: apply what the error names.** An unknown-key error names the declared spelling when one is close, a value error names what the row expects, and the binding error names where the object goes. If the component really does read the key or value, the props row is what is wrong: correct the declaration in `@objectstack/spec`, not the page.

The `@objectstack/spec` change is text only: the reason of each D3 migration entry named above said the gate reported its refusal as an advisory finding, and now says it is an error.

**Who is affected, measured.** At objectstack `8323cad97`, this rule ran at its own input tier over `examples/app-crm`, `app-todo`, `app-multi-package` and `app-showcase`, and over the eight shipped pages outside them (`@objectstack/platform-objects` ×3, `@objectstack/plugin-approvals`, `packages/qa/downstream-contract`, `@objectstack/cloud-connection` ×2, `@objectstack/mcp`): 37 pages, 177 components judged. It also ran over `objectstack-ai/hotcrm` at `0f84c9c72`: 8 pages, 50 components judged. Result: 0 findings of every class in both. A planted undeclared key and a planted wrong-typed prop each drew one finding on every population. The `create-objectstack` template authors no page. Deployed metadata and other repositories were not measured.
