# Audit: DashboardSchema / DashboardWidgetSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/dashboard.zod.ts`. **Live path**: `objectui` `DashboardView`→`DashboardRenderer`→`DatasetWidget` (ADR-0021) / legacy inline `getComponentSchema()`. The `spec-bridge/bridges/dashboard.ts` path is **orphaned** (no `src` caller; its node types have no renderer).

## 🔴 The ADR-0021 cutover is half-done and the spec contradicts the code
`dashboard.zod.ts:153-156` declares `dataset`+`values` **required** and says the legacy `object/categoryField/valueField/aggregate` query "was removed." But `DashboardRenderer.getComponentSchema()` (`:423-723`) is built almost entirely on that **legacy inline shape**, and Studio's `WidgetConfigPanel.tsx:161-285` still authors `object/categoryField/valueField/aggregate` with **no dataset/dimensions/values controls**. → Studio emits widgets the current spec **rejects**; the dataset-required rule cannot hold. (Same debt that left the HotCRM dashboard seeds invalid.)

## DEAD — only the orphaned spec-bridge references them
Dashboard: `globalFilters`, `dateRange`, `aria`, `performance`. Widget: `responsive`, `aria`, `actionUrl`/`actionType`/`actionIcon`, `requiresService` (nav uses it; widgets don't). `chartConfig` is read by **CLI lint only** (`validate-widget-bindings.ts:239`), no runtime renderer. They appear in `dashboard.form.ts` so Studio shows editable fields that render nothing.

## Drift
- **`title` vs `label`**: renderer reads `schema.title` (`DashboardRenderer.tsx:856`, `DashboardView.tsx:358`), but `DashboardSchema` has only `label`. `header.showTitle/showDescription` gate on a non-spec field.
- **`refreshInterval` effectively dead**: interval logic exists (`:332`) but only fires if `onRefresh` is passed; `DashboardView` never passes it.
- **Renderer depends on undeclared props**: `component`, `data`, `rowField`, `columnField`, `searchable`, `pagination`, `categoryGranularity` are read but **not in `DashboardWidgetSchema`** (inverse of dead-spec-prop).

## LIVE & well-wired
`name`, `label`, `description`, `widgets`, `columns`, `gap`, `header.actions`, widget `id/title/description/type/colorVariant/filter→runtimeFilter/compareTo/layout.{w,h}/options/requiresObject`, and the canonical `dataset`/`dimensions`/`values` (DatasetWidget + framework `build-probes.ts` runtime probe + CLI lint). Plus the legacy `object/valueField/categoryField/aggregate` (LIVE-drift; spec says removed but renderer+Studio still depend on them).

## Recommendation
Finish ADR-0021: migrate `DashboardRenderer` + `WidgetConfigPanel` to dataset/dimensions/values, then remove the legacy inline shape (or un-deprecate it in the spec). Fix `title`↔`label`. Prune the orphaned-bridge-only props. Declare the undeclared-but-read props.
