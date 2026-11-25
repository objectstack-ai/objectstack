// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where each metadata type sits in Studio's left menu: its order and its tier
 * (objectstack ADR-0084; epic #36890, ruling on #37192).
 *
 * One ordered list of `{ type, tier }`. It holds order and tier ONLY: a type's
 * group stays its served registry `domain`, so this table can never disagree
 * with the registry about a group.
 *
 * ## Tiers
 *
 *  - `common` (常用): always listed on a package, in this order — object ·
 *    app, page, dashboard, report · flow · permission · agent, tool, skill.
 *    The AI group is drawn last of the visible groups, above the fold.
 *  - `advanced` (高级): every other type the directory lists, in one collapsed
 *    fold under the common groups, still under its own group label. That
 *    includes picklist (选项列表) and email template.
 *
 * A type with no row here is drawn in `advanced`, at the end of its group. It
 * is never invisible; the menu applies that rule when it reads this list.
 *
 * ## Order
 *
 * A consumer sorts the entries of one group, within one tier, by the row's
 * index in {@link STUDIO_MENU_PLACEMENT}. The common rows come first, in the
 * ruled order; the advanced rows follow in the proposal's order, group by
 * group.
 *
 * ## Pins
 *
 * `studioMenuPlacement.test.ts` holds this list against
 * `DEFAULT_METADATA_TYPE_REGISTRY`: every type the directory can list has
 * exactly one row, and every row names a registered type. Nothing reads the
 * list yet; the menu reads it once `buildStudioMenu` orders by it.
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
  { type: 'app', tier: 'common' },
  { type: 'page', tier: 'common' },
  { type: 'dashboard', tier: 'common' },
  { type: 'report', tier: 'common' },
  { type: 'flow', tier: 'common' },
  { type: 'permission', tier: 'common' },
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
  { type: 'dataset', tier: 'advanced' },
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
  { type: 'position', tier: 'advanced' },
  { type: 'assignment_rule', tier: 'advanced' },
  { type: 'sharing_rule', tier: 'advanced' },
  { type: 'queue', tier: 'advanced' },
  { type: 'capability', tier: 'advanced' },
] as const satisfies readonly StudioMenuPlacementRow[]);
