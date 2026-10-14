---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

The metadata save door runs the two page component rules that `objectstack validate`, `objectstack build` and `objectstack lint` run. A page saved through Studio, REST `/meta` or an MCP/AI author whose components carry an undeclared, wrong-typed or retired property (`component-props-unknown-key`, `component-props-invalid`), or a component `type` inside a spec-reserved namespace that the platform does not declare (`component-type-unknown`), is refused with `422 INVALID_METADATA`, and each issue carries the fix the CLI already prints. Before, the save answered `200` and the renderer ignored the property or drew a placeholder.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered element-data-source-and-object-block-filter-rule-array, element-flat-data-binding-retired, element-text-variant-heading-subheading-retired, ui-action-group-menu-member-params-array-only, ui-action-group-menu-members-typed, ui-object-block-grouping-config-typed, ui-object-form-custom-fields-typed, ui-object-form-fields-names-typed, ui-object-form-members-typed, ui-object-form-sections-typed, ui-object-gantt-markers-typed, ui-object-grid-columns-typed, ui-object-grid-export-options-closed, ui-object-grid-kanban-calendar-list-members-typed, ui-object-grid-page-size-positive-integer-refused, ui-object-grid-row-members-typed, ui-object-kanban-conditional-formatting-typed, ui-object-map-gantt-tree-navigation-typed, ui-object-master-detail-form-details-closed, ui-object-metric-aggregate-trend-typed, ui-object-metric-compare-to-typed, ui-object-metric-drill-down-report-typed, ui-object-metric-drill-down-typed, ui-object-timeline-items-typed, ui-object-timeline-mapping-typed, ui-record-line-items-props-closed) Every props shape the save door now refuses was declared, and each narrowing of one recorded in its own D3 entry, before this change; the entries named here are the step's narrowings whose refusal the component-props gate carries, and this diff amends each one whose text said a stored page still saves, to say its next save meets that gate at the metadata save door. The change moves an existing rule onto one more door; it removes no key and rewrites no shape, so it adds no entry and no conversion: nothing on the load path refuses a page. -->

**BREAKING**: an accept-set narrowing on the metadata save door (`PUT /api/v1/meta/page/:name`, the draft promotion `POST /api/v1/meta/page/:name/publish`, the package publish, and every in-process `saveMetaItem` caller on an environment's authoring channel), shipped as `minor` under the launch-window convention for accept-set narrowings (`.changeset/pre.json` is open in `next` pre mode).

**The next save of a stored page whose components carry an undeclared, wrong-typed or retired property, or a reserved-namespace type the platform does not declare, is refused with the fix; stored pages keep serving until then.** The door judges writes only: a stored page row is not re-judged at boot, loads and is served as before, and a draft save is not judged until it is published.

## FROM → TO

| you saved | the door now answers | write instead |
|:--|:--|:--|
| `page:header` with `properties: { titel: 'Deals' }` | `422`, `component-props-unknown-key` at `…properties.titel`, offering `title` | `properties: { title: 'Deals' }` |
| `record:related_list` with `properties: { limit: 'five' }` | `422`, `component-props-invalid`, naming the expected type | `properties: { limit: 5 }` |
| a component typed `page:headr` | `422`, `component-type-unknown`: "Rename `page:headr` → `page:header`." | `type: 'page:header'` |
| a component typed `acme:pipeline_board` (outside the reserved namespaces) | unchanged: saved | nothing |

**The one-line fix: apply what the issue names, then save again.** If a component really does read the key, the props row in `@objectstack/spec` is what is wrong, not the page.

**Who is affected.** A deployment whose stored pages carry such a finding: those pages keep loading and serving, and only their next save is refused until the finding is fixed. `objectstack migrate meta --stored` does not list these findings. The authored pages measured when the props findings became errors (37 pages in this repository and 8 in `objectstack-ai/hotcrm`) carried none, and the in-repo page corpus carries no `component-type-unknown` finding; deployed rows were not measured. Two live-window ADR-0087 D2 aliases on page component properties are converted at `objectstack validate` and at load but not at this door, so a save that spells one is refused with the canonical key: `page:header` `description` (write `subtitle`) and an `element:button` inline `type: 'api'` action's object `params` (write `bodyExtra`).

The `@objectstack/spec` change is text only: the reason of each D3 migration entry named above (and the matching step-18 summaries) said a stored page still saves and loads, and now says it still loads and that its next save meets the component-props gate at the metadata save door.
