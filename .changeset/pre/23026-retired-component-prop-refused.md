---
'@objectstack/lint': major
---

A retired page-component prop is refused at `objectstack validate`, `objectstack build` and `objectstack lint`. Before this change, a key that `ComponentPropsMap` tombstones with `retiredKey()` (`object-grid` `defaultFilters`, `element:record_picker` `displayField`, `page:header` `breadcrumb` and the rest) drew only a `component-props-invalid` warning. The command printed "✓ Validation passed" and built the artifact, while the conversion registry told authors the key is refused. It is now a `component-props-invalid` error carrying the tombstone's prescription, and the stack does not pass until the key is gone.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered object-grid-default-filters-removed, object-grid-default-sort-removed, object-grid-resizable-columns-removed, object-kanban-quick-add-removed, page-header-breadcrumb-removed, page-structure-inert-keys-removed, page-card-body-to-children, page-tabs-type-to-tab-style, record-details-layout-removed, record-picker-display-field-to-label-field, record-picker-inert-keys-removed, element-input-target-variable-removed, element-flat-data-binding-to-data-source, element-filter-removed, element-form-removed, object-master-detail-form-detail-sort-field-removed, list-view-navigation-view-retired, form-field-public-picker-retired, chart-config-aria-retired, ui-ai-chat-window-retired) Every key this refuses was retired, with its tombstone prescription and its ledger entry, before this change. This diff moves only the severity of the lint finding that carries the prescription, so it adds no entry and amends none. -->

**BREAKING**: an accept-set narrowing on a published authoring surface (the `component-props-invalid` rule of `objectstack validate`, `objectstack build` and `objectstack lint`).

**What is refused.** A value verdict a tombstone raises: the tombstone's own issue, wherever the key sits in the props bag, an array entry's key included. A tombstoned key inside a union member is refused when that member is the only one judging keys (`object-form` `sections[].fields[]` `publicPicker`). A retired element's props row (`user:profile`, `ai:chat_window`) raises the same issue and is refused the same way.

**What stays a warning.** Every other `component-props-invalid` finding: a wrong type, a missing required prop, a closed-set refusal (a url action's `target` scheme, a `record:details` section's `count`), a retired enum value and a missing `dataSource.object` binding. Every `component-props-unknown-key` finding also stays a warning.

**Not judged here.** The runtime publish door (the Studio, REST `/meta`, MCP) does not run this rule, so a page saved there is not refused for a retired prop. `defineStack` and the stack schema keep the open `properties` bag as written.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `object-grid` `properties: { defaultFilters: [...] }` with an empty `filter` | `properties: { filter: [...] }` |
| `element:record_picker` `properties: { displayField: 'title' }` | `properties: { labelField: 'title' }` |
| a retired prop whose prescription says to delete it, e.g. `page:header` `breadcrumb` | nothing: delete the key |

**The one-line fix: apply the prescription the error prints.** Where an ADR-0087 conversion covers the key, `objectstack migrate meta --from <N>` lists the mechanical edits for existing sources.

**Who is affected, measured.** At objectstack `21c86444e`, this rule ran over `examples/app-crm`, `app-todo`, `app-multi-package` and `app-showcase` (through `objectstack validate`), over the five shipped pages outside them (`@objectstack/platform-objects` ×3, `@objectstack/plugin-approvals`, `packages/qa/downstream-contract`) and over the `create-objectstack` template, which authors no page. Result: 0 newly refused, and 0 findings of this rule of any kind. Deployed metadata and other repositories were not measured.
