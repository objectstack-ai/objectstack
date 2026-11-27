// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where each metadata type sits in Studio's left menu: its order and its tier
 * (objectstack ADR-0084; epic #36890, ruling on #37192; amended 2026-11-26,
 * "Placements, and what moves to Setup", objectstack#37564).
 *
 * One ordered list of `{ type, tier }`. It holds order and tier ONLY: a type's
 * group stays its served registry `domain`, so this table can never disagree
 * with the registry about a group.
 *
 * ## Tiers
 *
 *  - `common` (常用): always listed on a package, in this order — object,
 *    dataset · app, page, dashboard, report · flow · permission, position ·
 *    agent, tool, skill. The AI group is drawn last of the visible groups,
 *    above the fold.
 *  - `advanced` (高级): every other type the directory lists, in one collapsed
 *    fold under the common groups, still under its own group label. That
 *    includes picklist (选项列表) and email template.
 *
 * A type with no row here is drawn in `advanced`, at the end of its group. It
 * is never invisible: `buildStudioMenu` (`studioMenuModel.ts`) applies that
 * rule when it reads this list (objectstack#37201).
 *
 * ## Placements by name
 *
 * The rule that sorts a type into a tier has three tests (ADR-0084, amended
 * 2026-11-25). Where the maintainer places a type by name, the name decides,
 * and the row says so beside it. `dataset` and `position` are two such rows:
 * the rule alone would sort each of them `advanced`.
 *
 * ## Order
 *
 * `buildStudioMenu` sorts the entries of one group by the row's index in
 * {@link STUDIO_MENU_PLACEMENT} and stamps each entry with the row's tier;
 * the menu then draws each tier's entries in that order. The common rows come
 * first, in the ruled order; the advanced rows follow in the proposal's order,
 * group by group.
 *
 * ## Pins
 *
 * Three pins hold this list, all in `studioMenuPlacement.test.ts`:
 *  - the registry: against `DEFAULT_METADATA_TYPE_REGISTRY`, every type the
 *    directory can list has exactly one row, and every row names a
 *    registered, listable type;
 *  - the ruled order: the rows, in order, with their tiers, as literals
 *    (ruling on #37192, and the placements by name of 2026-11-26), so a
 *    reordered or re-tiered row fails there;
 *  - ADR-0084: its type-to-group table's Order and Tier columns equal this
 *    list, group by group.
 *
 * The menu's reading of the list is pinned in `studioMenuModel.test.ts` and
 * `StudioMenu.test.tsx`.
 */

/** A type's tier in Studio's left menu. */
export type StudioMenuTier = 'common' | 'advanced';

/** One row: a metadata type and its tier. Its position in the list is its order. */
export interface StudioMenuPlacementRow {
  readonly type: string;
  readonly tier: StudioMenuTier;
}

/** Every listable metadata type, in menu order, with its tier. */
export const STUDIO_MENU_PLACEMENT: readonly StudioMenuPlacementRow[] = Object.freeze([
  // 常用 — in the ruled order.
  { type: 'object', tier: 'common' },
  // Placed by name, directly after `object`: a dataset is the semantic layer
  // that charts and an AI's data questions both read. Its schema requires one
  // object, so the rule's first test alone would sort it 高级.
  { type: 'dataset', tier: 'common' },
  { type: 'app', tier: 'common' },
  { type: 'page', tier: 'common' },
  { type: 'dashboard', tier: 'common' },
  { type: 'report', tier: 'common' },
  { type: 'flow', tier: 'common' },
  { type: 'permission', tier: 'common' },
  // Placed by name, directly after `permission`: a position is one slot per
  // name in the environment, not in the package (ADR-0150 D7), so the rule's
  // third test alone would sort it 高级.
  { type: 'position', tier: 'common' },
  { type: 'agent', tier: 'common' },
  { type: 'tool', tier: 'common' },
  { type: 'skill', tier: 'common' },
  // 高级 — data
  { type: 'picklist', tier: 'advanced' },
  { type: 'hook', tier: 'advanced' },
  { type: 'mapping', tier: 'advanced' },
  { type: 'object_extension', tier: 'advanced' },
  { type: 'seed', tier: 'advanced' },
  // 高级 — ui
  { type: 'view', tier: 'advanced' },
  { type: 'action', tier: 'advanced' },
  // 高级 — automation
  { type: 'job', tier: 'advanced' },
  // 高级 — system (平台)
  { type: 'doc', tier: 'advanced' },
  { type: 'book', tier: 'advanced' },
  { type: 'email_template', tier: 'advanced' },
  { type: 'translation', tier: 'advanced' },
  { type: 'api', tier: 'advanced' },
  { type: 'datasource', tier: 'advanced' },
  { type: 'external_catalog', tier: 'advanced' },
  // 高级 — security (访问)
  { type: 'assignment_rule', tier: 'advanced' },
  { type: 'sharing_rule', tier: 'advanced' },
  { type: 'queue', tier: 'advanced' },
  { type: 'capability', tier: 'advanced' },
  // 高级 — ai
  { type: 'ai_context', tier: 'advanced' },
  { type: 'knowledge_source', tier: 'advanced' },
] as const satisfies readonly StudioMenuPlacementRow[]);
