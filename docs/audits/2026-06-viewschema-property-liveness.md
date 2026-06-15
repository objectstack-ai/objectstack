# Audit: ViewSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/view.zod.ts` (list family common + per-variant blocks + form family). **Method**: consumer cross-reference in objectui renderers (`plugin-{grid,list,view,kanban,calendar,gantt,charts,timeline,form}`, `fields`, `app-shell`) + framework `rest`/`objectql` for query effects. File:line below are in `objectui/packages/` unless prefixed `framework/`.

## Data-flow note
`plugin-list/src/ListView.tsx` normalizes spec (camelCase) into `plugin-grid`'s internal `object-grid` schema, then `ObjectGrid.tsx` consumes it. The server (`framework/packages/rest`) only persists/serves view items — **no** list-render prop reaches the query server-side; all filter/sort/column shaping is client-side.

## 🔴 Highest-impact: the `chart` list variant is dead-on-arrival vs its own spec
Post-ADR-0021 the spec exposes only `dataset` / `dimensions` / `values`, but **both** renderers (`ListView.tsx:1413-1428`, `app-shell/.../ObjectView.tsx:754-768`) still read the **removed legacy** `xAxisField` / `yAxisFields` / `valueField` / `aggregation` inline shape. A chart view authored to the *current* spec renders nothing meaningful (`chartType` is the only surviving key). This is the same ADR-0021 migration debt that left dashboard/report seeds invalid — **the chart renderers were never migrated either**.

## Form variants are mostly aspirational on the mainstream path
Variant routing (`tabbed/wizard/split/drawer/modal`) exists in `plugin-form/ObjectForm.tsx:135-242`, but the real entry points bypass it: `app-shell/.../RecordFormPage.tsx:273` **hardcodes `formType:'simple'`**, and `ObjectView.tsx`'s form adapter never forwards `form.type`/`sections`. The spec `FormView` is genuinely honored only on the metadata-admin **schema-provider** path (`SchemaForm.tsx:539`), and even there only `simple` vs `tabbed` differ — wizard/split/drawer/modal **degrade to stacked sections**. Net: **only `grid` and `simple`-form are fully wired end-to-end; `tabbed` partial; the other form variants are showcase-only.**

## Fully-wired (thick, correct) — keep
- **List common**: `name/label/type`, `columns` (legacy + rich), `filter`, `sort`, `searchableFields`, `filterableFields`, `userFilters{element,fields,tabs,showAllRecords}`, `selection`, `pagination`, `grouping`, `rowColor`, `rowHeight`, `hiddenFields/fieldOrder`, `rowActions`, `conditionalFormatting`, `inlineEdit`, `exportOptions`, `virtualScroll`, `tabs{icon,visible,pinned,filter}`, `emptyState`, `aria`, `appearance.allowedVisualizations`, `resizable/striped/bordered`, `showRecordCount`, `allowPrinting`. (evidence: `ObjectGrid.tsx`/`ListView.tsx`/`UserFilters.tsx`/`TabBar.tsx`)
- **List variants** (all field-by-field wired, with deprecated flat aliases as fallback): **kanban** (`KanbanImpl.tsx:682`), **calendar** (`calendar-view-renderer.tsx:147`), **gantt** (`ObjectGantt.tsx:236`), **gallery** (`ObjectGallery.tsx:209`), **timeline** (`ObjectTimeline.tsx:179`).
- **Form (where reachable)**: `sections`, FormField {`field,type,label,placeholder,required,readonly,hidden,options,reference,widget,colSpan,helpText,language,dependsOn,visibleOn,keyField,immutable`}, FormSection {`collapsible,collapsed,columns,visibleOn`}, `subforms` (master-detail, fully wired: `deriveMasterDetail.ts:338`, `LineItemsPanel.tsx:45`).

## DEAD — no consumer anywhere
`userActions.buttons`, `addRecord.mode`, `addRecord.formView`, `sharing.lockedBy`, list-level `responsive`, list-level `performance`, FormView `submitBehavior{thankYou,redirect,continue,nextRecord}`, FormView `defaultSort`, FormView `sharing` (renderer side), `ViewData` providers `api` & `schema` in the **list** path, `tab.order` (not used for sorting).

## Drift / structure issues (silent no-op risk)
- `bulkActions` works **only** because `ListView.tsx:1318` remaps it to `batchActions` (ObjectGrid's real key) — a direct `object-grid` caller using `bulkActions` silently no-ops.
- `groups` vs `sections` — both alive but on different code paths, not aliased in one place.
- Inverse problem: `ObjectView.tsx:809-823`'s form adapter reads keys (`layout,showSubmit,submitText,customFields,title,initialValues,className`) that **don't exist in `FormViewSchema`** — renderer-invented surface with no spec backing.

## Recommendation (for ADR)
1. **Migrate the chart renderers to `dataset`/`dimensions`/`values`** (ADR-0021) — pairs with the dashboard/report seed migration; currently the entire chart view variant is dead against the spec.
2. **Decide form-variant scope**: either wire `wizard/split/drawer/modal` through `RecordFormPage`/`ObjectView`, or demote them in the spec to "metadata-admin / showcase only" so authors aren't misled.
3. Normalize the `bulkActions`/`batchActions` and `groups`/`sections` key drift at one boundary; reconcile `ObjectView` form-adapter keys with `FormViewSchema`.
4. Prune the confirmed-dead props.
