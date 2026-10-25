// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Nav-leaf → design-surface resolution for the Studio Interfaces pillar.
 *
 * The Interfaces pillar's rail is NOT a per-type list (the Data / Automations /
 * Access rails are — `object` / `flow` / `permission`). It is the current
 * package's App `navigation` tree: every leaf is rendered, and the one that
 * `resolveSurface` can bind to a `{type,name}` opens that item's design surface
 * (`getMetadataPreview` canvas + `getMetadataInspector` / default inspector).
 * A leaf that resolves to `null` renders DISABLED — correct for the nav
 * variants whose target is not an authorable metadata item (`url` points out of
 * the product, `component` names a first-party UI shipped in code), and a dead
 * entry for any variant that does have one. A `separator` resolves to `null`
 * too, but it is no leaf row: the rail draws it as a divider (objectui#11791).
 *
 * Extracted from `StudioDesignSurface.tsx` so the binding is unit-testable
 * without mounting the pillar — the same reason `packageSurfaces.ts` lives
 * beside it.
 */

import type { I18nLabel, ObjectNavItem } from '@objectstack/spec/ui';
import type { NavTargetLabelResolver } from '@object-ui/layout';
import { navEntryLabelText } from '../metadata-admin/previews/navItemLabel.js';

/** One rail entry / canvas target. */
export interface Surface {
  type: string;
  name: string;
  /**
   * The nav item's DISPLAY text, resolved ONCE by `resolveSurface` in the
   * designer locale (objectui#11158). Every reader of a Surface (the rail, the
   * canvas caption, the breadcrumb, the copilot chip) prints this string; none
   * of them sees the authored label. An authored label reads as authored; an
   * ABSENT one is the text the entry inherits (objectui#11196): the runtime's
   * rule, so a label-less leaf is named here as the console's sidebar names it.
   * `''` only for a label that is present but resolves to nothing (an empty
   * locale map).
   */
  label: string;
  /** Lucide icon name from the object's metadata (`icon` field); falls back per getIcon. */
  icon?: string;
  /**
   * The nav entry's spec `id` (objectui#11774) — the entry's IDENTITY, which
   * `{type,name}` is not: an app may hold several entries that open one
   * object, each its own data slice (`filters`) or named view (`viewName`).
   * Compared through {@link isSameSurface}. Absent only for an entry with no
   * id, which the spec refuses (`id` is required on every nav item) and the
   * nav save backfills.
   */
  navId?: string;
  /**
   * An `object` entry's `filters`, carried as authored for the canvas preview
   * (objectui#11774). Interpreted only by the runtime's own nav reading (see
   * `studio-canvas-preview`), never here.
   */
  filters?: ObjectNavItem['filters'];
  /** An `object` entry's `viewName`, carried as authored for the canvas preview (objectui#11774). */
  viewName?: ObjectNavItem['viewName'];
}

/**
 * What a Surface is known by — a rail row, the open leaf, or a `?surface=`
 * deep-link target (whose `navId` is the link's `nav` param).
 */
export type SurfaceIdentity = Pick<Surface, 'type' | 'name' | 'navId'>;

/**
 * The one identity rule for two surfaces (objectui#11774): the nav entry's
 * `id` when both sides carry one, else `{type,name}` — the rule every reader
 * used before ids were carried, kept for an id-less side.
 *
 * `{type,name}` alone named the TARGET, not the entry, so every entry of one
 * object was the same surface: all of them highlighted at once, and a reload
 * landed on the first. The rail's `isActive` reads this; `findSurfaceInTree`
 * prefers an exact id the same way.
 */
export function isSameSurface(a: SurfaceIdentity, b: SurfaceIdentity): boolean {
  if (a.navId && b.navId) return a.navId === b.navId;
  return a.type === b.type && a.name === b.name;
}

export interface NavNode {
  id?: string;
  /**
   * The spec's `I18nLabel`: a plain string or an inline locale map. Typed as
   * the spec types it so the compiler refuses rendering it raw, which is how a
   * map crashed the rail (objectui#11158). Read it only through
   * `navItemLabelText`, the one helper the Studio's nav readers share.
   */
  label?: I18nLabel;
  type?: string;
  icon?: string;
  children?: NavNode[];
  /**
   * The surface-binding target keys — CANONICAL SPELLINGS ONLY (objectui#4881).
   *
   * Every `NavigationItemSchema` member is a
   * `strictObject(navItemSurface(variant), ...)`, and the bare spellings
   * `page` / `object` / `dashboard` / `report` / `view` sit in neither any
   * variant's shape nor `NAV_ITEM_ALIASES`. Measured on `@objectstack/spec`
   * 17.0.0: each of them comes back `unrecognized_keys` from
   * `NavigationItemSchema` and from `AppSchema` — so a node carrying one
   * cannot be saved, and reading it here would only ever accept a dialect the
   * schema refuses (Commandment #0.1). Same reading, same reason, as
   * `AppNavCanvas`'s `navKind` (objectui#3275).
   */
  pageName?: string;
  objectName?: string;
  dashboardName?: string;
  reportName?: string;
  /**
   * `ObjectNavItemSchema`'s list modifiers, typed as the spec types them
   * (objectui#11774). Carried onto an `object` Surface as authored; the
   * binding itself never reads them.
   */
  filters?: ObjectNavItem['filters'];
  viewName?: ObjectNavItem['viewName'];
  /**
   * The spec's nav-item `badge` / `badgeVariant`, typed as the spec types them
   * (objectui#11791). The rail draws them as the runtime sidebar does; the
   * binding never reads them.
   */
  badge?: ObjectNavItem['badge'];
  badgeVariant?: ObjectNavItem['badgeVariant'];
  /**
   * `ActionNavItemSchema.actionDef` — a `.strict()` object of exactly
   * `{ actionName, params? }`. The spec answers `action` / `name` / `args` /
   * `input` here as REJECTED spellings with a redirect (objectstack#4001), so
   * they are authoring errors, never second spellings to read (Commandment
   * #0.1): this type declares the canonical key alone.
   */
  actionDef?: { actionName?: string; params?: Record<string, unknown> };
  [k: string]: unknown;
}

/**
 * Resolve a leaf nav node → the surface {type,name} it binds to.
 *
 * Each case reads its variant's CANONICAL target key and nothing else. There
 * is deliberately no `view` case either: `NavigationItemSchema` is a
 * nine-member discriminated union (object / dashboard / page / url / report /
 * action / component / separator / group) with no `view` member, and
 * `viewName` is an optional key ON `ObjectNavItemSchema` ("which list view to
 * open"), not a navigation type. Measured on spec 17.0.0, `type: 'view'` fails
 * the discriminator outright (`invalid_union` at `type`), so such a leaf can
 * never reach a saved app and had no reachable branch to resolve.
 *
 * The label is resolved here, once, in `locale` (the designer locale), so the
 * Surface carries display text and its callers cannot disagree about it
 * (objectui#11158). It is the entry's display text through the shared
 * `navEntryLabelText`: an absent label inherits (objectui#11196), asked of
 * `targetLabel` — the console's own resolver, `useNavTargetLabel`, which every
 * caller in the Studio passes. Without one the runtime's rule answers its
 * machine-name rung, as the console does before its metadata loads. The
 * binding itself never reads the label, the locale or the resolver.
 *
 * objectui#11774 — the Surface also carries the entry it came from: its `id`
 * (`navId`) on every variant, and on `object` its `filters` / `viewName` as
 * authored. Neither changes the binding: the five showcase entries that open
 * `showcase_task` all bind `object:showcase_task`, and are told apart by id.
 */
export function resolveSurface(
  node: NavNode,
  locale: string,
  targetLabel?: NavTargetLabelResolver,
): Surface | null {
  const target = bindTarget(node);
  if (!target) return null;
  const surface: Surface = { ...target, label: navEntryLabelText(node, locale, targetLabel) };
  if (node.id) surface.navId = node.id;
  if (target.type === 'object') {
    if (node.filters) surface.filters = node.filters;
    if (node.viewName) surface.viewName = node.viewName;
  }
  return surface;
}

/** The `{type,name}` a leaf binds to, or `null` — the binding half of {@link resolveSurface}. */
function bindTarget(node: NavNode): { type: string; name: string } | null {
  switch (node.type) {
    case 'page':
      return node.pageName ? { type: 'page', name: String(node.pageName) } : null;
    case 'object':
      return node.objectName ? { type: 'object', name: String(node.objectName) } : null;
    case 'dashboard':
      return node.dashboardName ? { type: 'dashboard', name: String(node.dashboardName) } : null;
    case 'report':
      return node.reportName ? { type: 'report', name: String(node.reportName) } : null;
    // A nav action is a GLOBAL action by construction: `ActionNavItemSchema` is
    // `.strict()` with exactly `{ actionName, params? }` and carries no
    // `objectName`, so an object-scoped action is not addressable from the nav
    // (see `useNavActionDispatch`, which resolves the name against `action`
    // metadata at click time). That makes this leaf the design-time half of a
    // surface the running app already dispatches (framework#4509) — before
    // this case it rendered permanently disabled in the rail while the same
    // entry worked in the shipped sidebar.
    //
    // Object-scoped actions keep their own home, the object's Actions tab
    // (`ObjectActionsPanel`, objectui#2330) — this case cannot reach them and
    // must not try to.
    case 'action':
      return node.actionDef?.actionName ? { type: 'action', name: String(node.actionDef.actionName) } : null;
    default:
      return null;
  }
}

/**
 * Walk the nav tree for the leaf a `?surface=` deep-link names, returning its
 * resolved Surface (carrying the node's label so the canvas title / highlight
 * match). Backs the deep-link restore — a shared URL only names the target, so
 * we re-derive the label from the live tree. `locale` and `targetLabel` only
 * resolve the label of the leaf found.
 *
 * objectui#11774 — a target that names a nav id (`?nav=`) which still exists
 * opens THAT entry, wherever it sits in the tree. Otherwise — no id, or an id
 * no entry carries any more — the match is on `{type,name}` and the first such
 * leaf in tree order wins, exactly as every `<type>:<name>` link resolved
 * before ids were carried.
 */
export function findSurfaceInTree(
  nodes: NavNode[],
  target: SurfaceIdentity,
  locale: string,
  targetLabel?: NavTargetLabelResolver,
): Surface | null {
  if (target.navId) {
    const byId = findLeaf(nodes, (s) => s.navId === target.navId, locale, targetLabel);
    if (byId) return byId;
  }
  return findLeaf(nodes, (s) => s.type === target.type && s.name === target.name, locale, targetLabel);
}

/** The first leaf, in tree order, whose resolved Surface satisfies `match`. */
function findLeaf(
  nodes: NavNode[],
  match: (s: Surface) => boolean,
  locale: string,
  targetLabel?: NavTargetLabelResolver,
): Surface | null {
  for (const node of nodes) {
    if (node.type === 'group' || node.children?.length) {
      const hit = findLeaf(node.children ?? [], match, locale, targetLabel);
      if (hit) return hit;
    } else {
      const s = resolveSurface(node, locale, targetLabel);
      if (s && match(s)) return s;
    }
  }
  return null;
}
