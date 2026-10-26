// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * view-item-normalize — list-shaping helpers for the Studio View admin.
 *
 * The framework exposes each view as a canonical first-class **ViewItem**
 * (ADR-0017, "Object has-many View"), addressed as `<object>.<viewKey>`:
 *
 *   {
 *     name: "crm_campaign.campaign_calendar",
 *     object: "crm_campaign",
 *     viewKind: "list",            // list-family | form-family discriminant
 *     label: "Launch Calendar",
 *     scope: "package",
 *     config: {                    // ← the single-view spec lives here
 *       type: "calendar",
 *       data: { object: "crm_campaign" },
 *       columns: ["name", "channel", "status"],
 *       calendar: { startDateField: "start_date", … },
 *     },
 *   }
 *
 * The View editor (inspector + preview) reads this canonical shape directly
 * (`draft.config`), so there is no load/save shape adapter. These helpers only
 * shape the metadata LIST: hide the legacy aggregated container row and derive
 * a display "type" for the list column.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * True when `item` is a **bare aggregated view container** — the legacy
 * per-object `defineView({ list, form, listViews, formViews })` document
 * the framework still registers under the bare `<object>` key for runtime
 * back-compat (dual-read). It carries NO `viewKind` discriminant and holds
 * at least one of the aggregate buckets.
 *
 * Studio expands every such container into independent `<object>.<viewKey>`
 * ViewItems (including the defaults), so the container row is fully
 * redundant in the metadata list and should be hidden there.
 *
 * Re-exported from `@objectstack/spec`, which owns this predicate and pairs it
 * with `expandViewContainer` — the expansion Studio performs. What used to sit
 * here was a verbatim, line-for-line copy of the spec's implementation
 * (objectstack#4115): the two agreed today only because nobody had touched
 * either, and a copy of a predicate is the one thing that cannot be caught by
 * comparing values.
 */
export { isAggregatedViewContainer } from '@objectstack/spec';

/**
 * Derive the display "type" of a view list row. Expanded ViewItems keep
 * their display type under `config.type` (`grid` / `calendar` / `kanban`
 * / …) and only the list/form *family* at the top level (`viewKind`); a
 * legacy flat view carries `type` directly. Returns `undefined` when
 * nothing is resolvable (e.g. an aggregated container).
 */
export function viewDisplayType(item: unknown): string | undefined {
  if (!isPlainObject(item)) return undefined;
  const config = item.config;
  if (isPlainObject(config) && typeof config.type === 'string') return config.type;
  if (typeof item.type === 'string') return item.type;
  if (item.viewKind === 'form') return 'form';
  if (item.viewKind === 'list') return 'list';
  return undefined;
}
