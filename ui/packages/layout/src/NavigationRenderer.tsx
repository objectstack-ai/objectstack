/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/layout - Navigation Renderer
 *
 * Renders a `NavigationItem[]` tree from AppSchema JSON into a Shadcn sidebar.
 * Supports every `NavigationItemType` — object, dashboard, page, report, url,
 * component, action, doc and group — plus separators, badges, visibility
 * expressions, and RBAC permission guards.
 *
 * Enhanced with:
 * - Search filtering across navigation tree
 * - Pin/favorite navigation items (pinned items in "Favorites" section)
 * - A host control on every entry in place of the pin action, and host rows
 *   in the Favorites section (objectui#12427)
 * - The pinned section in the user's order, rearranged by dragging a row
 *   (via @dnd-kit). The app's own menu is never reorderable here: its order
 *   is authored in Studio (objectui#12059).
 *
 * @module NavigationRenderer
 */

import React, { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronRight,
  FileText,
  Pin,
  PinOff,
  Star,
} from 'lucide-react';
import { getLazyIcon } from '@object-ui/components';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useDndContext,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  type KeyboardSensorOptions,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Badge,
  Separator,
  cn,
  useIsMobile,
} from '@object-ui/components';
import type { NavigationItem, KeyedI18nLabel } from '@object-ui/types';
import { isElementApiDataSourceShape } from '@object-ui/react';
// Aliased on import, following PR #4169's convention (as `AppSchemaRenderer`
// does): this file has its OWN `resolveLabel` over the KEYED vocabulary, and
// the spec's resolver reads the INLINE locale map — neither accepts the other's
// shape.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
// Internal module, not re-exported by `index.ts` (objectui#11395). ⛔ Do not
// re-export `byNavOrder` from this file: `index.ts` re-exports it whole.
import { byNavOrder } from './navOrder';

/**
 * The class this file's sidebar group labels carry so that, once the sidebar
 * collapses to icons, a hidden label takes no pointer events (objectui#12744).
 *
 * In the collapsed icon sidebar the `SidebarGroupLabel` primitive hides its
 * label with `opacity-0` and `-mt-8` and nothing else, so the invisible label
 * stays hit-testable: it lies over the lower half of the row just above its
 * group, and a click on that row's icon lands on the label instead. A
 * collapsible group's label is its disclosure button, so the click toggles the
 * group and the row does not navigate. The variant here is the primitive's own
 * hiding condition, so the label stops taking pointer events exactly while it
 * is hidden; in the expanded sidebar it is visible, and a collapsible group's
 * label still toggles its group. Keyboard focus is unaffected.
 *
 * The primitive is a Shadcn-synced file, never edited here (AGENTS.md #7), so
 * the fix rides on the `className` each call site passes, which `cn` merges
 * over the primitive's classes (it sets no `pointer-events` class).
 * Module-local on purpose: `index.ts` re-exports this file whole.
 */
const HIDDEN_ICON_LABEL_NO_POINTER =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:pointer-events-none';

/**
 * The classes this file's sidebar group labels carry so that, once the sidebar
 * collapses to icons, a hidden label is no keyboard focus stop and nothing a
 * screen reader announces (objectui#12795).
 *
 * The primitive draws the label at `opacity-0` there, which leaves it in the
 * tab order and in the accessibility tree. A collapsible group's label is its
 * disclosure button, so Tab from the row above it landed on an invisible
 * button and Enter toggled a group the user could not see. `invisible`
 * (`visibility: hidden`) takes the label out of both, under the primitive's
 * own hiding condition, so in the expanded sidebar every label is focusable
 * and toggles as before. Visibility would switch at once and cut the label's
 * fade-out short, so under the same condition `visibility` joins the
 * primitive's transition list: the label stays visible while it fades and is
 * hidden when the fade ends. On expand the variant no longer applies, so the
 * label is visible at once and fades in as before.
 *
 * Module-local for the same reason as the constant above. Every
 * `SidebarGroupLabel` call site carries this pair; a pin enumerates them.
 */
const HIDDEN_ICON_LABEL_NOT_FOCUSABLE =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:invisible ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:transition-[margin,opacity,visibility]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callback to evaluate a visibility expression.
 * Return `true` if the item should be visible.
 * When not provided, all items default to visible.
 *
 * The parameter is the item's own `visible` type, so the spec's
 * `{ dialect, source }` envelope reaches the evaluator as authored
 * (objectui#13075).
 *
 * `entry` is the navigation entry whose `visible` this is (objectui#13029).
 * The item guard always passes it. An entry may declare the spec's API
 * `dataSource` (`{ provider: 'api', read: { url }, path? }`), whose selected
 * value its `visible` reads as `data`; reading that binding is the host's job,
 * so an evaluator that answers such an entry reads it through `entry`. The
 * default evaluator reads no binding, so it hides an entry that declares one:
 * a value nobody read is unknown, and an unknown navigation gate is closed.
 */
export type VisibilityEvaluator = (
  expression: NavigationItem['visible'],
  entry?: NavigationItem,
) => boolean;

/**
 * Callback to check whether the current user satisfies **all** of the
 * given permission strings.  Each string is opaque — the consumer decides
 * the format (e.g. `"object:action"` or a named role).
 * When not provided, all items default to permitted.
 */
export type PermissionChecker = (permissions: string[]) => boolean;

/**
 * Callback to check whether the runtime advertises the named capabilities.
 *
 * Used to gate navigation entries that target objects or services which
 * may not exist in every runtime (e.g. `sys_app` / `sys_package` only
 * live in the cloud control-plane). When `requiresObject` or
 * `requiresService` is set on a navigation item and the checker returns
 * `false`, the item is hidden — preventing the 404-when-clicked trap.
 *
 * When not provided, capability gates default to *pass* (i.e. always
 * shown) so navigation works in environments that haven't wired up a
 * runtime capability probe yet.
 */
export type CapabilityChecker = (kind: 'object' | 'service', name: string) => boolean;

/** What a `type: 'doc'` navigation entry opens: a book, a page, or that page in that book. */
export interface DocNavTarget {
  book?: string;
  doc?: string;
}

/**
 * Answers whether the signed-in member may read what a `type: 'doc'` entry
 * opens (objectui#10188). `false` hides the entry.
 *
 * The server is the enforcer (ADR-0046 §6.7): its app read already drops a
 * `doc` entry the caller may not read (objectstack#19790), and this checker is
 * the renderer's defence in depth behind it (that ruling's point 2). This layer
 * holds no audience rules, so the host answers from the member's own doc / book
 * reads and never re-derives an audience. Kept apart from
 * {@link CapabilityChecker} on purpose: that one asks whether the RUNTIME has a
 * target, this one whether the MEMBER may read it.
 *
 * When not provided, `doc` entries pass — the server's answer stands.
 */
export type DocTargetChecker = (target: DocNavTarget) => boolean;

/**
 * What an UNLABELLED navigation entry inherits its text from (objectui#9868).
 *
 * `@objectstack/spec` 17.5.0 made a nav entry's `label` optional with a
 * declared semantic: absent ⇒ the entry shows, at RENDER time, the CURRENT label
 * of what it opens — the view's label when it names a view and that view is
 * labelled, else the object's / dashboard's label. These are the three targets
 * that sentence names; `resolveNavItemLabel` walks them in that order and asks a
 * {@link NavTargetLabelResolver} about each one.
 */
export type NavLabelTarget =
  | { kind: 'view'; objectName: string; viewName: string }
  | { kind: 'object'; objectName: string }
  | { kind: 'dashboard'; dashboardName: string };

/**
 * Answers the CURRENT display label of a nav target from the host's metadata —
 * the object schema's `label`, the named view's `label`, the dashboard's
 * `label` — or `undefined` when the target carries none (or is not loaded).
 *
 * This layer holds no metadata, so the host supplies it: the console shell
 * reads the metadata cache it already loads (`useNavTargetLabel` in
 * `@object-ui/app-shell`). Because it is asked on every render and nothing is
 * stored, a renamed target shows its new name on the next render. Without it,
 * an unlabelled entry falls through to its target's machine name.
 */
export type NavTargetLabelResolver = (target: NavLabelTarget) => string | undefined;

/**
 * What a host's per-entry control is told about the row it sits in
 * (objectui#12427, {@link NavigationRendererProps.renderItemAction}).
 */
export interface NavItemActionContext {
  /**
   * The row's href, as its link renders it ({@link resolveHref}). Absent for an
   * `action` entry, which runs something and navigates nowhere, and for an
   * entry whose target resolves to no address (`#`).
   */
  href?: string;
  /** `href` leaves the console: the row opens it in a new tab. */
  external: boolean;
  /** The text the row shows ({@link resolveNavItemLabel}). */
  label: string;
  /** The renderer's `basePath`. */
  basePath: string;
}

export interface NavigationRendererProps {
  /** Navigation items to render */
  items: NavigationItem[];

  /**
   * Base URL prefix prepended to generated hrefs.
   * @example "/apps/crm"
   */
  basePath?: string;

  /** Optional visibility evaluator for `visible` expressions */
  evaluateVisibility?: VisibilityEvaluator;

  /** Optional permission checker for `requiredPermissions` */
  checkPermission?: PermissionChecker;

  /** Optional runtime-capability checker for `requiresObject` / `requiresService` */
  checkCapability?: CapabilityChecker;

  /** Optional member-readability checker for `doc` entries — see {@link DocTargetChecker} */
  checkDocTarget?: DocTargetChecker;

  /**
   * Called when an `action`-type item is clicked.
   *
   * A shell that renders `action` items MUST supply this: the renderer has no
   * dispatcher of its own and never reads `item.actionDef` — unpacking
   * `actionName` / `params` and invoking the action is the host's job (see
   * `useNavActionDispatch` in `@objectstack/app-shell`). Omitting it does not
   * degrade to an inert button; action items are **not rendered at all**,
   * because a nav entry that looks clickable and silently does nothing is worse
   * than an absent one (framework#4509 — every shipped sidebar omitted this
   * prop, so `actionDef.actionName` reached no dispatcher and every such item
   * dead-clicked).
   */
  onAction?: (item: NavigationItem) => void;

  // --- P1.7 Navigation Enhancements ---

  /** Search query to filter navigation items by label */
  searchQuery?: string;

  /** Enable pin/favorite toggle on navigation items */
  enablePinning?: boolean;

  /**
   * Called when a navigation item is pinned or unpinned. The optional
   * `item` and `basePath` arguments are passed so consumers can synthesize
   * a portable favorite record (with a real label/href) instead of storing
   * only the raw nav id. Older consumers that ignore the extra args keep
   * working unchanged.
   */
  onPinToggle?: (
    itemId: string,
    pinned: boolean,
    item?: NavigationItem,
    basePath?: string,
  ) => void;

  /**
   * The host's control for one entry (objectui#12427), drawn on every leaf and
   * `action` row where the pin action sits, IN PLACE of it: a row this fills
   * draws no pin action, so the host's control owns pinning (the console's ⋯
   * menu offers Add to / Remove from favorites, through the same pin store).
   * The control is a `SidebarMenuAction` (or renders one), so it sits where the
   * pin action sat and follows the row's hover.
   *
   * Drawn whatever `enablePinning` says, which keeps deciding the Favorites
   * section alone: a host that wants no control on a screen (a phone) does not
   * pass this there. Omitted ⇒ the pin action under `enablePinning` +
   * `onPinToggle`, as before. Groups and separators get none.
   */
  renderItemAction?: (item: NavigationItem, context: NavItemActionContext) => React.ReactNode;

  /**
   * Rows the host appends to the Favorites section, after the pinned entries
   * (objectui#12427): favorites that are not navigation entries, such as a
   * record. Each row is a `SidebarMenuItem`; the renderer lists them in a
   * `SidebarMenu` of their own, outside the pinned entries' drag order. The
   * section renders when it has a pinned entry (under `enablePinning`) or one
   * of these rows; `null`, `false` and an empty array are no rows. Omitted ⇒
   * the section holds pinned entries only, as before.
   */
  extraFavorites?: React.ReactNode;

  // RETIRED (objectui#12059): `enableReorder` / `onReorder`, drag-to-reorder of
  // the app's menu. A menu's order is authored in Studio and every user sees
  // that order (maintainer ruling on objectui#12059, reversing objectui#11626).
  // Personal ordering lives in the pinned section only — `pinnedOrder` /
  // `onPinnedReorder` below. Do not re-add a menu reorder here.

  /**
   * The ids of the pinned entries in the user's order (objectui#12059). The
   * pinned section draws its entries in this order; a pinned entry it does not
   * name follows, in menu order. Omitted ⇒ the pinned section follows the menu.
   */
  pinnedOrder?: string[];

  /**
   * Makes the pinned section reorderable (objectui#12059): a pinned row is
   * dragged by the row itself, with no grip at rest (`cursor: grab`, and an
   * insertion line while dragging), or from the keyboard with dnd-kit's
   * keyboard sensor (Space picks the focused row up, the arrow keys move it,
   * Space drops it, Escape cancels). Called on a drop with the ids of the rows
   * the section draws, in their new order. Only the pinned section reorders;
   * the menu itself never does.
   */
  onPinnedReorder?: (pinnedIds: string[]) => void;

  // RETIRED (objectui#11299): `resolveObjectLabel` / `resolveDashboardLabel` /
  // `resolveViewLabel`, the three convention resolvers of the retired
  // translate-if-equal-to-name rule. objectui#11201 (ruling B) stopped
  // consulting them; they were kept as inert no-ops and are gone now. A present
  // label renders as authored and an absent one inherits through
  // `resolveTargetLabel`, which is where a target's localized name comes from.
  // Do not re-add them.

  /**
   * The viewer's locale (a BCP-47 tag such as `zh-CN`), for a PRESENT label
   * written as an inline locale map (`{ en: 'Accounts', 'zh-CN': '客户' }`,
   * the spec's `I18nLabel`): the map renders this locale's entry, through the
   * spec's own `resolveI18nLabel`. When the map has no entry for this locale,
   * the fallback order is that resolver's and is not restated here
   * (objectui#11299).
   *
   * Injected, like `t`: this layer carries no i18n dependency, so the host that
   * knows the language passes it (the console passes its active UI language,
   * the same value its sidebar resolves area labels in). Omitted ⇒ the
   * resolver's documented no-locale default, `en`. A plain-string label and an
   * absent one are unaffected.
   */
  locale?: string;

  /**
   * Resolver for the text an entry with NO `label` inherits (objectui#9868):
   * the current label of its view / object / dashboard, read from the host's
   * metadata at render time. Consulted ONLY for an absent `label` — an authored
   * label is never replaced by the target's metadata label, not even one
   * spelled like the target's machine name (the ruling refused that sentinel).
   * See {@link NavTargetLabelResolver} and {@link resolveNavItemLabel}.
   */
  resolveTargetLabel?: NavTargetLabelResolver;

  // RETIRED (`9c60144b5`): `resolveGroupLabel` / `resolveItemLabel`, the two
  // id-keyed label resolvers. They were unreachable by construction: they sat
  // behind a text comparison of the label against the node's own `id`
  // (`Workspace` vs `grp_workspace`), which never matched. App-navigation
  // localization is owned solely by the server-side `/meta` boundary (rung 1
  // of `resolveNavItemLabel`'s order). Do not re-add them; a sidebar label that
  // needs translating is translated there.

  /**
   * Optional i18n translation function for resolving KEYED label objects
   * (`{ key, defaultValue }`, see {@link resolveLabel}). When provided, labels
   * are translated through i18next; otherwise falls back to `defaultValue`.
   * An inline locale map (`{ en, 'zh-CN' }`) is not keyed and never reaches
   * it — {@link resolveNavItemLabel} reads a map itself, in {@link locale}.
   */
  t?: (key: string, options?: any) => string;

  /**
   * Optional template-variable context for resolving `recordId` on
   * `object`-type nav items that target a specific record. The shell
   * passes the signed-in user id / active org id; authors write
   * `{current_user_id}` / `{current_org_id}` in `recordId`.
   *
   * When omitted (or a referenced variable is missing), affected items
   * fall back to opening the list view so the link is still functional.
   */
  templateContext?: NavTemplateContext;
}

// ---------------------------------------------------------------------------
// Icon Helper
// ---------------------------------------------------------------------------

/**
 * Resolve a Lucide icon component by name string.
 * Delegates to the shared `getLazyIcon` utility (lucide-react `DynamicIcon`
 * under the hood) so each icon ships as a separate micro-chunk.
 */
export function resolveIcon(name?: string): React.ComponentType<any> {
  if (!name) return FileText as any;
  return getLazyIcon(name) as any;
}

// ---------------------------------------------------------------------------
// I18nLabel resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a NavigationItem label to a plain string.
 *
 * Handles both plain strings and the KEYED i18n form
 * `{ key, defaultValue?, params? }` — named `KeyedI18nLabel` in
 * `@object-ui/types` since #4581, which is what this signature now states
 * instead of a third inline copy of the same object literal. When a `t`
 * function is provided the key is translated via i18next.
 *
 * "Keyed", not the spec's `I18nLabel`: that one is the INLINE LOCALE MAP
 * (`{ en: 'Owner' }`) resolved against a BCP-47 locale, and the two answer
 * wrongly for each other's input, silently (objectui#4167).
 */
export function resolveLabel(
  label: string | KeyedI18nLabel,
  t?: (key: string, options?: any) => string,
): string {
  if (typeof label === 'string') return label;
  if (t) {
    const result = t(label.key, { defaultValue: label.defaultValue, ...label.params });
    if (result && result !== label.key) return result;
  }
  return label.defaultValue || label.key;
}

/**
 * Resolve a navigation item's display text, in the spec's one order
 * (`@objectstack/spec` `BaseNavItemSchema.label`, objectstack#20849):
 *
 * 1. The id-keyed bundle entry `apps.APP.navigation.ID.label`. That rung runs
 *    UPSTREAM of this function, at the server-side `/meta` boundary:
 *    `translateApp` in `@objectstack/spec` (`src/system/i18n-resolver.ts`)
 *    rewrites a node's `label` by its `id` before the metadata reaches this
 *    renderer. App-navigation localization has that one owner — localize nav
 *    labels there, never here.
 * 2. A PRESENT label, as authored ({@link presentNavItemLabel}): an inline
 *    locale map reads the entry for `locale` (the viewer's), and a string
 *    renders verbatim.
 * 3. An ABSENT label inherits its target's CURRENT label (objectui#9868 —
 *    `@objectstack/spec` 17.5.0 made it optional, cloud#2021 letter-A ruling),
 *    resolved here at render time and never written back — see
 *    {@link inheritedNavItemLabel} for the ladder. That arm is keyed on
 *    ABSENCE alone, so an authored label is never swapped for the target's
 *    metadata label, however it is spelled.
 *
 * ⛔ Nothing here matches a label's text against a name (objectui#11201,
 * ruling B). A present label equal to its target's machine name (`account`)
 * renders `account` in every locale: text cannot tell a deliberate `account`
 * from a machine-written one, so translation is keyed on identity (rung 1) or
 * comes through inheritance (rung 3). The three convention resolvers that
 * the retired rule consulted, and the three arguments that carried them, are
 * gone (objectui#11299).
 *
 * EXPORTED since `969ba84f4`, for the same reason {@link resolveHref} is: a
 * second surface now renders the same `NavigationItem[]`. `nav:menu` is the
 * app's navigation tree as PAGE CONTENT (`app-shell/src/views/nav-menu-renderer.tsx`),
 * and it cannot mount `NavigationRenderer` itself — that renders through
 * `SidebarMenuButton`, whose `useSidebar()` throws outside the shell's
 * `SidebarProvider`. Re-deriving the label rules there would put one nav entry
 * under two names on two surfaces of one app, which is exactly the drift the
 * "single source of truth" note on `resolveHref` exists to prevent. Nothing
 * about the behaviour changed with the keyword.
 */
export function resolveNavItemLabel(
  item: NavigationItem,
  t?: (key: string, options?: any) => string,
  targetLabel?: NavTargetLabelResolver,
  locale?: string,
): string {
  // A separator carries no `label` (objectui#10867): there is nothing to name.
  if (item.type === 'separator') return '';
  // Absent ⇒ inherit (objectui#9868).
  if (item.label === undefined) return inheritedNavItemLabel(item, targetLabel);
  return presentNavItemLabel(item.label, t, locale);
}

/**
 * The text of a PRESENT navigation label, as authored (rung 2 of
 * {@link resolveNavItemLabel}'s order).
 *
 *  - A string renders verbatim.
 *  - An inline locale map — the spec's `I18nLabel`, `{ en, 'zh-CN' }` — reads
 *    through the spec's own `resolveI18nLabel` in `locale`, the viewer's locale
 *    the host injects (objectui#11299; this layer carries no i18n dependency,
 *    so it is handed the locale rather than reading one). The fallback order
 *    when the map has no entry for that locale is the resolver's own, never
 *    restated here; with no `locale` at all it is the resolver's documented
 *    no-locale default (`en`). A map with no text at all reads `''`: it is
 *    present, so it inherits nothing.
 *  - objectui's KEYED reference `{ key, defaultValue?, params? }` resolves
 *    through `t` ({@link resolveLabel}), as before. The two object shapes do
 *    not overlap: the spec's inline-locale key pattern excludes both `key` and
 *    `defaultValue`.
 */
function presentNavItemLabel(
  label: unknown,
  t: ((key: string, options?: any) => string) | undefined,
  locale: string | undefined,
): string {
  if (typeof label === 'string') return label;
  if (isKeyedLabel(label)) return resolveLabel(label, t);
  return resolveInlineI18nLabel(label as Parameters<typeof resolveInlineI18nLabel>[0], locale) ?? '';
}

/** objectui's keyed label reference, told apart from an inline locale map by the two member names a map can never carry. */
function isKeyedLabel(label: unknown): label is KeyedI18nLabel {
  return typeof label === 'object' && label !== null && ('key' in label || 'defaultValue' in label);
}

/**
 * The text of a navigation ENTRY whose `label` is absent (objectui#9868).
 *
 * The spec's declared default, walked in the spec's order and resolved on every
 * render (nothing is stored, so a rename shows on the next render):
 *
 *  - `object` naming a view → the VIEW's label, else the OBJECT's label, else
 *    the `viewName` it names;
 *  - `object` → the object's label, else `objectName`;
 *  - `dashboard` → the dashboard's label, else `dashboardName`.
 *
 * The labels come from `targetLabel` — the host's metadata; this layer holds
 * none. The final rung is the MACHINE-NAME backstop: an entry always shows text
 * (the spec's own rule: identity is the target, text is inherited), including
 * before the host's metadata has loaded and in a host that supplies no
 * resolver.
 *
 * The ruling names inheritance for those three targets only. Every other entry
 * type shows its target's machine name — `pageName`, `reportName`, `url`,
 * `componentRef`, `actionDef.actionName`, a `doc` entry's `doc` else its
 * `book` — and an entry with no target of its
 * own (a `group`), or with its target missing, shows its `id`, which the
 * validator requires of every entry.
 */
function inheritedNavItemLabel(
  item: Exclude<NavigationItem, { type: 'separator' }>,
  targetLabel: NavTargetLabelResolver | undefined,
): string {
  const ask = (target: NavLabelTarget): string | undefined => {
    const text = targetLabel?.(target);
    return typeof text === 'string' && text.trim() !== '' ? text : undefined;
  };
  switch (item.type) {
    case 'object':
      if (!item.objectName) break;
      if (item.viewName) {
        return (
          ask({ kind: 'view', objectName: item.objectName, viewName: item.viewName })
          ?? ask({ kind: 'object', objectName: item.objectName })
          ?? item.viewName
        );
      }
      return ask({ kind: 'object', objectName: item.objectName }) ?? item.objectName;
    case 'dashboard':
      if (!item.dashboardName) break;
      return ask({ kind: 'dashboard', dashboardName: item.dashboardName }) ?? item.dashboardName;
    case 'page':
      if (item.pageName) return item.pageName;
      break;
    case 'report':
      if (item.reportName) return item.reportName;
      break;
    case 'url':
      if (item.url) return item.url;
      break;
    case 'component':
      if (item.componentRef) return item.componentRef;
      break;
    case 'action':
      if (item.actionDef?.actionName) return item.actionDef.actionName;
      break;
    case 'doc':
      // The page it opens, else the book (objectui#11197).
      if (item.doc) return item.doc;
      if (item.book) return item.book;
      break;
    default:
      break;
  }
  return item.id;
}

// ---------------------------------------------------------------------------
// Default evaluators (always-visible, always-permitted)
// ---------------------------------------------------------------------------

const defaultVisibility: VisibilityEvaluator = (expr, entry) => {
  // objectui#13029 — this default reads no API binding, so an entry that
  // declares one is hidden: its `visible` is about a value never read.
  if (entry && isElementApiDataSourceShape(entry.dataSource)) return false;
  if (expr === false || expr === 'false') return false;
  return true;
};

const defaultPermission: PermissionChecker = () => true;

const defaultCapability: CapabilityChecker = () => true;

// ---------------------------------------------------------------------------
// Derived area visibility (objectui#3311)
// ---------------------------------------------------------------------------

/** Guard callbacks for {@link hasVisibleNavigationItems}. */
export interface NavigationVisibilityOptions {
  /** Evaluator for item `visible` expressions. Defaults to always-visible. */
  evaluateVisibility?: VisibilityEvaluator;
  /** Checker for item `requiredPermissions`. Defaults to always-permitted. */
  checkPermission?: PermissionChecker;
  /** Checker for `requiresObject` / `requiresService`. Defaults to pass. */
  checkCapability?: CapabilityChecker;
  /** Checker for what a `doc` entry opens ({@link DocTargetChecker}). Defaults to pass. */
  checkDocTarget?: DocTargetChecker;
  /**
   * Whether the host wires an `onAction` dispatcher. Without one, `action`
   * items are not rendered at all (framework#4509 — a nav entry that looks
   * clickable and silently does nothing is worse than an absent one), so
   * they cannot carry an area's visibility either. Defaults to `false`,
   * matching a renderer with no `onAction` prop.
   */
  hasActionHandler?: boolean;
}

/**
 * The per-item guard sequence, in ONE place.
 *
 * `visible`, then `requiredPermissions`, then the `requiresObject` /
 * `requiresService` runtime-capability gates, then — for a `doc` entry — the
 * host's member-readability answer (objectui#10188). It answers only "does this NODE
 * itself survive" — whether a surviving `group` has anything inside it is
 * `hasVisibleNavigationItems`'s question, and whether an `action` item has a
 * dispatcher is the caller's.
 *
 * Extracted because the sequence had been written out three times — in
 * `NavigationItemRenderer`, in `hasVisibleNavigationItems`, and nowhere at all
 * in `collectPinnedItems`, which is how the Favorites section came to render an
 * entry out of a subtree the same guards had already removed (`73a3c89af`).
 * A gate that holds on one path into a subtree and not on another is the
 * authoring trap this predicate exists to prevent, so the three callers share
 * the statement rather than agreeing about it.
 *
 * What it does NOT ask: whether the member may read the object a `type:
 * 'object'` entry opens. This layer holds no permissions and none of its
 * callbacks answers that question ({@link CapabilityChecker} asks whether the
 * RUNTIME has the object), so a host that knows prunes such an entry from the
 * tree before handing it here, which reaches all three callers at once. The
 * console does (`withoutUnreadableObjectEntries` in `@object-ui/app-shell`,
 * objectui#12109).
 */
function passesNavItemGuards(
  item: NavigationItem,
  options: NavigationVisibilityOptions,
): boolean {
  const {
    evaluateVisibility = defaultVisibility,
    checkPermission = defaultPermission,
    checkCapability = defaultCapability,
    checkDocTarget,
  } = options;

  // The entry rides along so an evaluator can bind its API `dataSource` as
  // `data` (objectui#13029); the decision about that binding is the evaluator's.
  if (!evaluateVisibility(item.visible, item)) return false;
  if (item.requiredPermissions?.length && !checkPermission(item.requiredPermissions)) return false;
  const requiresObject = (item as { requiresObject?: string }).requiresObject;
  const requiresService = (item as { requiresService?: string }).requiresService;
  if (requiresObject && !checkCapability('object', requiresObject)) return false;
  if (requiresService && !checkCapability('service', requiresService)) return false;
  // objectui#10188 — defence in depth behind the server's app read, which
  // already drops a `doc` entry the caller may not read (objectstack#19790).
  if (item.type === 'doc' && checkDocTarget && !checkDocTarget({ book: item.book, doc: item.doc })) return false;
  return true;
}

/**
 * Whether a navigation tree contains at least one item that would actually
 * render under the given guards — the exact guards `NavigationItemRenderer`
 * applies per item: the `visible` expression, `requiredPermissions`, the
 * `requiresObject` / `requiresService` runtime-capability gates, and (for
 * `action` items) the presence of an action dispatcher.
 *
 * Non-content nodes never count: a `separator` is a visual divider, and a
 * `group` counts only through its children — a group whose children are all
 * gated away contributes nothing a user can navigate to.
 *
 * This is the predicate behind DERIVED area visibility (objectui#3311).
 * `@objectstack/spec` 17.0.0 retired the authorable area-level `visible` /
 * `requiredPermissions` (`AREA_VISIBLE_RETIRED` /
 * `AREA_REQUIRED_PERMISSIONS_RETIRED`): an area is a layout grouping, not an
 * access boundary. What replaces those keys is not a new key but this
 * derivation: an area is visible iff something inside it is. Because it is
 * computed from the same guards that decide what renders, it can never
 * disagree with the rendered navigation — and there is nothing for a
 * metadata author to get wrong. An area with no items at all derives the
 * same way (no visible item → hidden).
 */
export function hasVisibleNavigationItems(
  items: NavigationItem[],
  options: NavigationVisibilityOptions = {},
): boolean {
  const { hasActionHandler = false } = options;

  for (const item of items) {
    // The same guard statement NavigationItemRenderer runs, not a copy of it.
    if (!passesNavItemGuards(item, options)) continue;

    if (item.type === 'separator') continue;
    if (item.type === 'group') {
      if (hasVisibleNavigationItems(item.children ?? [], options)) return true;
      continue;
    }
    if (item.type === 'action' && !hasActionHandler) continue;

    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internal helper: resolve href from NavigationItem
// ---------------------------------------------------------------------------

/**
 * Lightweight template-variable context for nav items that target a
 * specific record / org. The shell injects the signed-in user id and
 * active org id; the schema author writes `{current_user_id}` /
 * `{current_org_id}` in `recordId` and the renderer substitutes.
 *
 * Kept intentionally small — anything beyond this should be a Page or
 * a `component`-type nav, not encoded in metadata strings.
 */
export interface NavTemplateContext {
  currentUserId?: string | null;
  currentOrgId?: string | null;
  /**
   * Active values for app-level context selectors (e.g. the Studio
   * package scope). Keyed by the selector's `id`; referenced in nav
   * items as `{<id>}` (e.g. `{active_package}`). Empty/absent values
   * are treated as "no scope" and dropped from the resolved URL.
   */
  contextValues?: Record<string, string | null | undefined>;
}

const TEMPLATE_VAR_RE = /\{(current_user_id|current_org_id|[a-z][a-z0-9_]*)\}/g;

function applyNavTemplate(
  raw: string,
  ctx: NavTemplateContext | undefined,
): string | null {
  if (!raw.includes('{')) return raw;
  let missing = false;
  const out = raw.replace(TEMPLATE_VAR_RE, (_, name: string) => {
    let v: string | null | undefined;
    if (name === 'current_user_id') v = ctx?.currentUserId;
    else if (name === 'current_org_id') v = ctx?.currentOrgId;
    else v = ctx?.contextValues?.[name];
    if (!v) {
      missing = true;
      return '';
    }
    return v;
  });
  return missing ? null : out;
}

/**
 * The wire encoding of the declared `runAction` nav slot — ONE definition,
 * sited with `resolveHref` because that is the only thing that writes it.
 *
 * `ObjectNavItemSchema.runAction` (objectstack#7253) declares WHICH action an
 * object nav entry auto-runs on arrival; the URL is how that declaration
 * survives the navigation, because the list surface mounts in a fresh render
 * tree with nothing but the location to read. Naming the param after the slot
 * is deliberate: the slot owns the name, so producer and consumer cannot drift.
 *
 * Before this constant existed, the name was a bare `'runAction'` literal
 * hand-written at both ends — a private convention no schema declared, so
 * `objectui validate` could not see it, `RESERVED_URL_PARAMS` did not list it,
 * and a page could have repurposed the name with nothing to catch the
 * collision. Import this; never re-spell it. `@object-ui/app-shell`'s
 * `urlParams` re-exports it into the reserved registry rather than restating
 * it, so there is still exactly one definition.
 */
export const NAV_RUN_ACTION_PARAM = 'runAction';

/**
 * Encode a declared `runAction` onto a LIST-surface href.
 *
 * Applied to the two list landings (`filters` slice and bare/named view) and
 * deliberately NOT to the record deep-link above it: the spec defines the slot
 * as running "on arrival at the object's list surface", and a `recordId` entry
 * arrives at a record detail page, which has no list toolbar to answer to it.
 * Encoding it there would put an unanswerable param on the URL that the
 * consumer would then have to decide whether to strip — a one-shot intent spent
 * on a surface that never had the action. The installed `@objectstack/spec@17.0.0`
 * still ACCEPTS `runAction` + `recordId` together (measured — the parse-level
 * exclusivity the card describes is not in this pin), so this precedence is
 * load-bearing rather than merely defensive.
 *
 * An empty string is treated as absent: the spec's `z.string()` accepts `''`
 * (measured), and no action can be named it, so encoding it would produce a
 * param that arms nothing.
 */
function withRunAction(href: string, item: NavigationItem): string {
  const name = (item as { runAction?: unknown }).runAction;
  if (typeof name !== 'string' || name === '') return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}${NAV_RUN_ACTION_PARAM}=${encodeURIComponent(name)}`;
}

/**
 * The docs-portal href of a `doc` entry (ADR-0046 §6, objectui#11197), under the
 * `basePath` the entry renders in — `/apps/<package id>` in an app, which is the
 * package-container docs tree `AppHeader`'s "This app's docs" entry opens, and
 * `''` on home navigation, which is the top-level `/docs` portal. It uses the
 * portal's own two route shapes, `/docs/:slug` and `/docs/:slug/:name`:
 *
 *  - `{ doc }` → `…/docs/<doc>`: the portal's flat-doc permalink, which
 *    redirects to the doc's canonical in-book URL — so it resolves for any
 *    installed doc, book or no book;
 *  - `{ book }` → `…/docs/<book>`: the book landing, which opens the book at
 *    its first readable page;
 *  - `{ book, doc }` → `…/docs/<book>/<doc>`: that page, in that book's
 *    context.
 *
 * `book` is the book's NAME (what the entry names and the CLI's docs lint
 * checks), and the link carries it as written. The portal addresses a book by
 * its `slug` (default: the name), and resolves a segment that is a book's NAME
 * rather than its slug to that book, redirecting to the canonical slug URL —
 * after the lookups that answer today, so a slug or an installed doc's name
 * keeps its meaning (`bookNamedBy` in the console's `book-nav.ts`,
 * objectui#11197). So both `book` shapes reach a book that authors a `slug`,
 * and a package's implicit book, keyed by its package id, as before. The
 * audience gate is the server's (`/meta/doc`, ADR-0046 §6.7): the entry carries
 * no gate of its own beyond the base keys every sibling has.
 *
 * `#` when the entry names no target — the validator refuses that entry, so this
 * is a host that never parsed, not a route.
 */
function resolveDocHref(book: string | undefined, doc: string | undefined, basePath: string): string {
  const segment = (name: string) => encodeURIComponent(name);
  if (book && doc) return `${basePath}/docs/${segment(book)}/${segment(doc)}`;
  if (doc) return `${basePath}/docs/${segment(doc)}`;
  if (book) return `${basePath}/docs/${segment(book)}`;
  return '#';
}

/**
 * Resolve a NavigationItem to an absolute href (relative to `basePath`).
 *
 * Single source of truth for nav → URL mapping across the shell. Other
 * surfaces that need to navigate to a nav item (command palette,
 * pinned rail, search results, recent items, etc.) MUST use this helper
 * instead of constructing URLs ad-hoc — otherwise features like
 * `recordId` / `recordMode` / `componentRef` will silently regress.
 */
export function resolveHref(
  item: NavigationItem,
  basePath: string,
  templateContext?: NavTemplateContext,
): { href: string; external: boolean } {
  switch (item.type) {
    case 'object': {
      const objectPath = `${basePath}/${item.objectName ?? ''}`;
      // `recordId` (optionally templated) takes precedence over `viewName`:
      // when set, jump straight to the record detail page instead of the
      // list view. Used by self-service nav entries like "My Profile"
      // (`recordId: '{current_user_id}'`).
      const rawRecordId = (item as any).recordId as string | undefined;
      if (rawRecordId) {
        const resolved = applyNavTemplate(rawRecordId, templateContext);
        if (resolved) {
          const recordHref = `${objectPath}/record/${encodeURIComponent(resolved)}`;
          const mode = (item as any).recordMode as 'view' | 'edit' | undefined;
          return { href: mode === 'edit' ? `${recordHref}/edit` : recordHref, external: false };
        }
        // Template variable couldn't be resolved (e.g. logged-out
        // pre-render). Fall through to the list view so the link is
        // still well-formed rather than a dead `#`.
      }
      // `filters` (#2251) targets the parameterized bare data surface
      // (`/:objectName/data`) instead of a saved view: each entry becomes a
      // `filter[<field>]=<value>` search param. Values pass through the same
      // template substitution as `recordId`; entries whose template can't be
      // resolved are dropped so the link stays well-formed. Precedence:
      // recordId → filters → viewName.
      const navFilters = (item as any).filters as Record<string, string> | undefined;
      if (navFilters && typeof navFilters === 'object' && !Array.isArray(navFilters)) {
        const usp = new URLSearchParams();
        for (const [field, raw] of Object.entries(navFilters)) {
          if (raw === undefined || raw === null || field === '') continue;
          const resolved = applyNavTemplate(String(raw), templateContext);
          if (resolved !== null) usp.set(`filter[${field}]`, resolved);
        }
        const qs = usp.toString();
        return {
          href: withRunAction(qs ? `${objectPath}/data?${qs}` : `${objectPath}/data`, item),
          external: false,
        };
      }
      return {
        href: withRunAction(
          item.viewName ? `${objectPath}/view/${item.viewName}` : objectPath,
          item,
        ),
        external: false,
      };
    }
    case 'dashboard':
      return { href: item.dashboardName ? `${basePath}/dashboard/${item.dashboardName}` : '#', external: false };
    case 'page': {
      if (!item.pageName) return { href: '#', external: false };
      // Forward `params` as querystring so the page can read them via
      // `useSearchParams()` (PageView already does this). String values
      // additionally pass through `applyNavTemplate` so nav entries can
      // refer to `{current_user_id}` / `{current_org_id}` — exactly like
      // the `recordId` substitution above for object-typed nav items.
      const pageParams = item.params;
      let url = `${basePath}/page/${item.pageName}`;
      if (pageParams && typeof pageParams === 'object') {
        const usp = new URLSearchParams();
        for (const [k, v] of Object.entries(pageParams)) {
          if (v === undefined || v === null) continue;
          if (typeof v === 'string') {
            const resolved = applyNavTemplate(v, templateContext);
            if (resolved !== null) usp.set(k, resolved);
          } else {
            usp.set(k, JSON.stringify(v));
          }
        }
        const qs = usp.toString();
        if (qs) url += `?${qs}`;
      }
      return { href: url, external: false };
    }
    case 'report':
      return { href: item.reportName ? `${basePath}/report/${item.reportName}` : '#', external: false };
    case 'url':
      return { href: item.url ?? '#', external: item.target === '_blank' };
    case 'component': {
      // Phase 3b: `componentRef` is colon-joined (e.g. `metadata:resource`).
      // We map it to `/component/<ns>/<name>` so URLs stay clean and
      // React Router can pull the segments via :ns/:name params.
      // Any `params` on the nav item are serialised as querystring so
      // the same component can be reused across many nav entries with
      // different inputs (e.g. `params: { type: 'object' }` vs
      // `params: { type: 'field' }`).
      const ref = item.componentRef;
      if (!ref) return { href: '#', external: false };
      const segs = ref.split(':').filter(Boolean);
      if (segs.length === 0) return { href: '#', external: false };
      const navParams = item.params;
      // Special-case metadata refs: route to nested REST-style /metadata paths.
      //   metadata:directory                  → /metadata
      //   metadata:resource (+ params.type)   → /metadata/:type
      //   metadata:resource (+ type + name)   → /metadata/:type/:name
      if (segs[0] === 'metadata') {
        const kind = segs[1];
        const type = navParams && typeof navParams.type === 'string' ? navParams.type : undefined;
        const name = navParams && typeof navParams.name === 'string' ? navParams.name : undefined;
        // Forward any extra params (e.g. `package: '{active_package}'`) as
        // querystring so an app-level context selector transparently scopes
        // every metadata surface. `type`/`name` are encoded in the path, so
        // they're excluded here. Template vars that don't resolve (no active
        // scope) are dropped, leaving a clean unscoped URL.
        let metaQs = '';
        if (navParams && typeof navParams === 'object') {
          const usp = new URLSearchParams();
          for (const [k, v] of Object.entries(navParams)) {
            if (k === 'type' || k === 'name') continue;
            if (v === undefined || v === null) continue;
            if (typeof v === 'string') {
              const resolved = applyNavTemplate(v, templateContext);
              if (resolved) usp.set(k, resolved);
            } else {
              usp.set(k, JSON.stringify(v));
            }
          }
          const qs = usp.toString();
          if (qs) metaQs = `?${qs}`;
        }
        if (kind === 'directory' || !kind) {
          return { href: `${basePath}/metadata${metaQs}`, external: false };
        }
        if (kind === 'resource' && type) {
          const tail = name
            ? `/${encodeURIComponent(type)}/${encodeURIComponent(name)}`
            : `/${encodeURIComponent(type)}`;
          return { href: `${basePath}/metadata${tail}${metaQs}`, external: false };
        }
        return { href: `${basePath}/metadata${metaQs}`, external: false };
      }
      let url = `${basePath}/component/${segs.join('/')}`;
      if (navParams && typeof navParams === 'object') {
        const usp = new URLSearchParams();
        for (const [k, v] of Object.entries(navParams)) {
          if (v === undefined || v === null) continue;
          usp.set(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        const qs = usp.toString();
        if (qs) url += `?${qs}`;
      }
      return { href: url, external: false };
    }
    case 'doc':
      return { href: resolveDocHref(item.book, item.doc, basePath), external: false };
    default:
      return { href: '#', external: false };
  }
}

// ---------------------------------------------------------------------------
// Active-state matching — the inverse of resolveHref (#2272)
// ---------------------------------------------------------------------------

/**
 * Match-specificity ranks. The whole tree elects EXACTLY ONE active item:
 * every leaf gets a score against the current location and the highest
 * score wins (ties break to tree order). This replaces the old per-item
 * `computeIsActive` prefix heuristics, whose independent per-item decisions
 * needed a special case for every "two rows light up at once" report and
 * could not see search params at all (a `filters` item's href carries
 * `?filter[...]`, so exact-pathname matching never fired — the item never
 * highlighted while its bare-object sibling wrongly claimed `/data`).
 *
 * Ranking, most→least specific:
 *   record deep-link > filters slice > named view > exact non-object href
 *   ≈ exact bare object > object sub-route (weak claim) > boundary prefix.
 *
 * A bare object item weak-claims ALL of its object's sub-routes (`/record`,
 * `/new`, `/view/*`, `/data`) so the user keeps orientation even when no
 * more-specific sibling is registered; when one is, its higher rank wins.
 */
const MATCH_RECORD = 50;
const MATCH_FILTERS = 40;
const MATCH_VIEW = 30;
const MATCH_EXACT = 25;
const MATCH_OBJECT_SUBROUTE = 10;
const MATCH_PREFIX = 5;

/** Collect `filter[<field>]=<value>` search params into a map. */
function parseFilterParams(search: string): Map<string, string> {
  const out = new Map<string, string>();
  new URLSearchParams(search).forEach((value, key) => {
    const m = /^filter\[(.+)\]$/.exec(key);
    if (m && m[1] && value !== '') out.set(m[1], value);
  });
  return out;
}

/**
 * Canonical view ids are qualified (`<object>.<key>`, see MetadataProvider)
 * while nav items usually carry the short key — compare both in short form.
 */
function stripViewQualifier(objectName: string, view: string): string {
  return view.startsWith(`${objectName}.`) ? view.slice(objectName.length + 1) : view;
}

function itemMatchScore(
  item: NavigationItem,
  pathname: string,
  filterParams: Map<string, string>,
  basePath: string,
  ctx: NavTemplateContext | undefined,
): number {
  const { href, external } = resolveHref(item, basePath, ctx);
  if (external || href === '#') return 0;

  if (item.type === 'object' && item.objectName) {
    const objectPath = `${basePath}/${item.objectName}`;
    if (pathname !== objectPath && !pathname.startsWith(`${objectPath}/`)) return 0;
    const segs = pathname === objectPath ? [] : pathname.slice(objectPath.length + 1).split('/');

    // Record deep-link — exact record only. An unresolved template
    // (logged-out pre-render) falls through to the list-style checks,
    // mirroring resolveHref's fallback.
    const rawRecordId = (item as any).recordId as string | undefined;
    if (rawRecordId) {
      const resolved = applyNavTemplate(rawRecordId, ctx);
      if (resolved) {
        return segs[0] === 'record' && decodeURIComponent(segs[1] ?? '') === resolved
          ? MATCH_RECORD
          : 0;
      }
    }

    // Filters slice — active only on `/data` with the SAME filter param
    // set (template-resolved, order-insensitive).
    const navFilters = (item as any).filters as Record<string, string> | undefined;
    if (navFilters && typeof navFilters === 'object' && !Array.isArray(navFilters)) {
      if (segs[0] !== 'data') return 0;
      const want = new Map<string, string>();
      for (const [field, raw] of Object.entries(navFilters)) {
        if (raw === undefined || raw === null || field === '') continue;
        const resolved = applyNavTemplate(String(raw), ctx);
        if (resolved !== null) want.set(field, resolved);
      }
      if (want.size !== filterParams.size) return 0;
      for (const [field, value] of want) {
        if (filterParams.get(field) !== value) return 0;
      }
      return MATCH_FILTERS;
    }

    if (item.viewName) {
      if (segs[0] !== 'view' || !segs[1]) return 0;
      const got = stripViewQualifier(item.objectName, decodeURIComponent(segs[1]));
      const want = stripViewQualifier(item.objectName, item.viewName);
      return got === want ? MATCH_VIEW : 0;
    }

    return segs.length === 0 ? MATCH_EXACT : MATCH_OBJECT_SUBROUTE;
  }

  // Non-object types match against their canonical href (metadata component
  // hrefs may carry a query string — compare pathnames only).
  const hrefPath = href.split('?')[0];
  if (pathname === hrefPath) return MATCH_EXACT;

  // Directory/index components (e.g. `metadata:directory`) link to a parent
  // route that also hosts more-specific child items (`metadata:resource`
  // pointing at `/metadata/:type`) — the index never claims sub-routes.
  const ref = (item as any).componentRef as string | undefined;
  if (ref && ref.split(':')[1] === 'directory') return 0;

  return pathname.startsWith(`${hrefPath}/`) ? MATCH_PREFIX : 0;
}

/**
 * Resolve the SINGLE active navigation item for the current location — the
 * inverse of {@link resolveHref}. Surfaces that need "which menu am I in"
 * (sidebar highlight, breadcrumbs, recents, designer deep-links) MUST use
 * this instead of comparing URL strings ad-hoc; the two functions are
 * round-trip tested together.
 */
export function resolveActiveNavItem(
  items: NavigationItem[],
  pathname: string,
  search: string,
  basePath: string,
  templateContext?: NavTemplateContext,
): NavigationItem | null {
  const filterParams = parseFilterParams(search);
  let best: NavigationItem | null = null;
  let bestScore = 0;
  const visit = (nodes: NavigationItem[] | undefined) => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type === 'group') {
        visit(node.children);
        continue;
      }
      const score = itemMatchScore(node, pathname, filterParams, basePath, templateContext);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
  };
  visit(items);
  return best;
}

/**
 * The elected active item id, provided once at the tree root by
 * {@link NavigationRenderer} — per-item active state is a plain id
 * comparison, so at most one row can ever highlight.
 */
const ActiveNavIdContext = React.createContext<string | null>(null);

// ---------------------------------------------------------------------------
// Search filter helper
// ---------------------------------------------------------------------------

/**
 * Recursively filter navigation items by search query (case-insensitive label match).
 * Groups are kept if any child matches, with non-matching children pruned.
 *
 * Matches the text the row SHOWS: `labelOf` defaults to
 * {@link resolveNavItemLabel} with no resolvers, and `NavigationRenderer` passes
 * its own resolvers and locale so an unlabelled entry is found by the label it
 * inherits (objectui#9868), not by a `label` it does not have, and a map-valued
 * one by its entry in the viewer's locale (objectui#11299).
 */
export function filterNavigationItems(
  items: NavigationItem[],
  query: string,
  labelOf: (item: NavigationItem) => string = (item) => resolveNavItemLabel(item),
): NavigationItem[] {
  if (!query.trim()) return items;
  const lowerQuery = query.toLowerCase().trim();

  return items.reduce<NavigationItem[]>((acc, item) => {
    // Separators are excluded during search
    if (item.type === 'separator') return acc;

    // Groups: recursively filter children
    if (item.type === 'group' && item.children?.length) {
      const filteredChildren = filterNavigationItems(item.children, query, labelOf);
      if (filteredChildren.length > 0) {
        acc.push({ ...item, children: filteredChildren });
      }
      return acc;
    }

    // Leaf items: match the label the row shows
    if (labelOf(item).toLowerCase().includes(lowerQuery)) {
      acc.push(item);
    }
    return acc;
  }, []);
}

// ---------------------------------------------------------------------------
// The pinned section's own order (objectui#12059)
// ---------------------------------------------------------------------------

/** Minimum pointer travel, in pixels, before a press on a pinned row becomes a drag; less is a click. */
const DRAG_ACTIVATION_DISTANCE = 5;

/**
 * The keyboard drag of a pinned row: Space picks the focused row up and drops
 * it, the arrow keys move it, Escape cancels. Not Enter, which dnd-kit binds
 * too by default: a pinned row is a link (or an action entry's button), and
 * Enter is how the keyboard follows it.
 */
const PINNED_KEYBOARD_SENSOR: KeyboardSensorOptions = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
};

/** The other rows hold still while a pinned row is dragged; the insertion line shows where it lands. */
const holdRowsStill: SortingStrategy = () => null;

/** Whether a drag was started from the keyboard; any other drag was started by a pointer. */
const startedByKeyboard = (event: { activatorEvent: Event | null }) =>
  event.activatorEvent?.type === 'keydown';

/**
 * Swallows the click that ends a pointer drag of a pinned row. The dragged row
 * follows the pointer, so the button is released over the row's own link and
 * the browser clicks it. dnd-kit stops that click's propagation, so the
 * router's `Link` never handles it, but nothing prevents its default: the
 * browser would follow the link with a full page load. The guard lasts as long
 * as dnd-kit's own (50ms after the drop).
 */
function swallowClickAfterPointerDrag(): void {
  const swallow = (event: MouseEvent) => event.preventDefault();
  window.addEventListener('click', swallow, { capture: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
}

/** The props every row renderer takes besides its `item`. */
interface NavRowProps {
  basePath: string;
  evalVis: VisibilityEvaluator;
  checkPerm: PermissionChecker;
  checkCap: CapabilityChecker;
  checkDocTarget?: DocTargetChecker;
  onAction?: (item: NavigationItem) => void;
  enablePinning?: boolean;
  onPinToggle?: (itemId: string, pinned: boolean, item?: NavigationItem, basePath?: string) => void;
  renderItemAction?: NavigationRendererProps['renderItemAction'];
  resolveTargetLabel?: NavTargetLabelResolver;
  locale?: string;
  t?: NavigationRendererProps['t'];
  templateContext?: NavTemplateContext;
}

/**
 * The pinned section as a sortable list: its own `DndContext`, so a pinned row
 * moves among the pinned rows only. A drop reports the ids of the rows drawn
 * here, in their new order.
 */
function PinnedNavigationList({
  items,
  onReorder,
  rowProps,
}: {
  items: NavigationItem[];
  onReorder: (pinnedIds: string[]) => void;
  rowProps: NavRowProps;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor, PINNED_KEYBOARD_SENSOR),
  );
  const ids = items.map((item) => item.id);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!startedByKeyboard(event)) swallowClickAfterPointerDrag();
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };

  const handleDragCancel = (event: DragCancelEvent) => {
    if (!startedByKeyboard(event)) swallowClickAfterPointerDrag();
  };

  return (
    <DndContext
      id="nav-pinned"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={ids} strategy={holdRowsStill}>
        <SidebarMenu>
          {items.map((item) => (
            <PinnedNavigationRow key={`fav-${item.id}`} item={item} rowProps={rowProps} />
          ))}
        </SidebarMenu>
      </SortableContext>
    </DndContext>
  );
}

/**
 * What a sortable row hands the element that starts its drag, the row's own
 * link (or an action entry's button): dnd-kit's activator ref, the listeners
 * of both sensors, and the id of dnd-kit's keyboard instructions. No grip and
 * no extra focus stop: the element a user already reaches is the handle.
 */
interface NavDragActivator {
  ref: (element: HTMLElement | null) => void;
  listeners: DraggableSyntheticListeners;
  describedBy: string;
}

/**
 * The props that make a row's own link or button its drag activator. dnd-kit's
 * `role="button"` / `tabIndex` are left off, so a link stays a link. Releasing
 * Space is held back: Space picks the row up and drops it, and on an action
 * entry's button its release would also press the button.
 */
function dragActivatorProps(activator: NavDragActivator) {
  return {
    ref: activator.ref,
    ...activator.listeners,
    'aria-describedby': activator.describedBy,
    onKeyUp: (event: React.KeyboardEvent) => {
      if (event.code === 'Space') event.preventDefault();
    },
  };
}

/** What a sortable list hands the row it wraps: dnd-kit's node ref and transform for the row's own `<li>`, and the insertion line. */
interface NavRowNode {
  ref: (element: HTMLElement | null) => void;
  style: React.CSSProperties;
  /** Where the dragged row would land, drawn as a line on this row's edge. */
  dropIndicator: 'before' | 'after' | null;
}

/** One pinned row, sortable by the row itself. */
function PinnedNavigationRow({ item, rowProps }: { item: NavigationItem; rowProps: NavRowProps }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    activeIndex,
    index,
  } = useSortable({ id: item.id });
  const { activatorEvent } = useDndContext();

  // A pointer drag carries the row under the pointer. A keyboard drag leaves
  // it in place, dimmed, so it never covers the row it is over: the insertion
  // line alone shows where it lands.
  const heldInPlace = isDragging && activatorEvent?.type === 'keydown';
  const style: React.CSSProperties = {
    transform: heldInPlace ? undefined : CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 10 : undefined,
  };
  const dropIndicator =
    isOver && !isDragging && activeIndex !== -1 ? (activeIndex < index ? 'after' : 'before') : null;

  return (
    <NavigationItemRenderer
      item={item}
      {...rowProps}
      dragActivator={{
        ref: setActivatorNodeRef,
        listeners,
        describedBy: attributes['aria-describedby'],
      }}
      row={{ ref: setNodeRef, style, dropIndicator }}
    />
  );
}

/** The insertion line on a row's edge while a pinned row is dragged over it. */
function DropIndicator({ at }: { at: 'before' | 'after' }) {
  return (
    <span
      aria-hidden="true"
      data-drop-indicator={at}
      className={cn(
        'pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary',
        at === 'before' ? '-top-px' : '-bottom-px',
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// NavigationItemRenderer (recursive)
// ---------------------------------------------------------------------------

function NavigationItemRenderer({
  item,
  basePath,
  evalVis,
  checkPerm,
  checkCap,
  checkDocTarget,
  onAction,
  enablePinning,
  onPinToggle,
  renderItemAction,
  dragActivator,
  row,
  inList = true,
  resolveTargetLabel,
  locale,
  t: tProp,
  templateContext,
}: {
  item: NavigationItem;
  basePath: string;
  evalVis: VisibilityEvaluator;
  checkPerm: PermissionChecker;
  checkCap: CapabilityChecker;
  checkDocTarget?: DocTargetChecker;
  onAction?: (item: NavigationItem) => void;
  enablePinning?: boolean;
  onPinToggle?: (itemId: string, pinned: boolean, item?: NavigationItem, basePath?: string) => void;
  renderItemAction?: NavigationRendererProps['renderItemAction'];
  /** The row's own link or button starts its drag, when the pinned section's sortable list draws it. */
  dragActivator?: NavDragActivator;
  /** The sortable node this row is, when the pinned section's sortable list draws it. */
  row?: NavRowNode;
  /**
   * Whether this entry is drawn as a child of a menu `<ul>` — every entry
   * is, except a top-level group, which is a section of its own. A list's
   * children must be `<li>`s (objectui#11690), so in a list every arm roots
   * at one: a separator and a nested group included, not just a row.
   */
  inList?: boolean;
  resolveTargetLabel?: NavTargetLabelResolver;
  locale?: string;
  t?: (key: string, options?: any) => string;
  templateContext?: NavTemplateContext;
}) {
  // iOS-native mobile drawer polish: >=44px tap targets, larger text and
  // icons, rounder rows. Desktop (>=768px) keeps the compact rail untouched.
  const isMobile = useIsMobile();
  const mobileBtnClass = isMobile ? 'min-h-[44px] text-[15px] gap-3 rounded-xl' : undefined;
  const navIconClass = cn('shrink-0', isMobile ? 'h-5 w-5' : 'h-4 w-4');
  // Resolve the initial open state (objectui#13336):
  //
  // 1. A group that holds the current route opens, whatever it declares —
  //    a closed group would hide the active item and the user would lose
  //    orientation.
  // 2. Otherwise the author's declaration decides. `expanded` is the spec
  //    field name; `defaultOpen` is the legacy objectui field name. Either
  //    one, when set, is honoured as written.
  // 3. A group that declares neither opens. Its length does not decide:
  //    collapsing an undeclared group because it is long hid entries the
  //    navigation never asked to hide, so a group is closed on first view
  //    only when it says `expanded: false` (or `defaultOpen: false`).
  const explicitOpen = (() => {
    if (typeof item.expanded === 'boolean') return item.expanded;
    if (typeof item.defaultOpen === 'boolean') return item.defaultOpen;
    return undefined;
  })();
  const activeNavId = React.useContext(ActiveNavIdContext);
  const hasActiveDescendant = React.useMemo(() => {
    if (item.type !== 'group' || !activeNavId) return false;
    const visit = (nodes: NavigationItem[] | undefined): boolean =>
      !!nodes?.some(
        (node) => node.id === activeNavId || (node.type === 'group' && visit(node.children)),
      );
    return visit(item.children);
  }, [item, activeNavId]);
  const initialOpen = hasActiveDescendant ? true : (explicitOpen ?? true);
  const [isOpen, setIsOpen] = useState(initialOpen);

  // --- Per-item guards: `visible`, `requiredPermissions`, and the
  // runtime-capability gates (an entry whose required object/service is not
  // registered in this runtime — e.g. `sys_app` only exists when the tenant
  // service is loaded — is hidden). One statement, shared with the area
  // derivation and the Favorites collection so none of the three can drift.
  const guardOptions: NavigationVisibilityOptions = {
    evaluateVisibility: evalVis,
    checkPermission: checkPerm,
    checkCapability: checkCap,
    checkDocTarget,
    hasActionHandler: !!onAction,
  };
  if (!passesNavItemGuards(item, guardOptions)) return null;

  // --- Separator --- a rule, not an entry: its item is hidden from assistive
  // tech, so a screen reader neither counts it in the list nor reads an empty
  // item (objectui#11690).
  if (item.type === 'separator') {
    return (
      <li aria-hidden="true">
        <Separator className="my-2" />
      </li>
    );
  }

  // --- Group (collapsible) ---
  if (item.type === 'group') {
    const children = (item.children ?? []).slice().sort(byNavOrder);

    // A group survives only through its children (`73a3c89af`). Without
    // this the group's own label rendered as a disclosure that opens onto
    // nothing once every child was gated away — and it contradicted
    // `hasVisibleNavigationItems`, which already scores such a group as
    // contributing nothing and is the predicate the area switcher elects
    // areas by. The same statement decides both, so the sidebar and the area
    // list can no longer disagree about what the user can reach. A group
    // authored with no children at all derives the same way, as it already
    // does for area election.
    if (!hasVisibleNavigationItems(children, guardOptions)) return null;

    const groupLabel = resolveNavItemLabel(item, tProp, resolveTargetLabel, locale);

    const rowProps: NavRowProps = {
      basePath,
      evalVis,
      checkPerm,
      checkCap,
      checkDocTarget,
      onAction,
      enablePinning,
      onPinToggle,
      renderItemAction,
      resolveTargetLabel,
      locale,
      t: tProp,
      templateContext,
    };

    const group = (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <SidebarGroup>
          <SidebarGroupLabel asChild className={cn(HIDDEN_ICON_LABEL_NO_POINTER, HIDDEN_ICON_LABEL_NOT_FOCUSABLE)}>
            <CollapsibleTrigger className={cn('flex w-full items-center justify-between', isMobile && 'min-h-[44px] text-[15px] rounded-xl')}>
              {groupLabel}
              <ChevronRight
                className={cn('ml-auto transition-transform', isMobile ? 'h-5 w-5' : 'h-4 w-4', isOpen && 'rotate-90')}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>
                {children.map((child) => (
                  <NavigationItemRenderer
                    key={child.id}
                    item={child}
                    {...rowProps}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    );
    // A plain `<li>`, not a `SidebarMenuItem`: that one is a `group/menu-item`,
    // and every row inside the nested group would show its hover-only pin
    // action whenever the pointer is anywhere over the group.
    return inList ? (
      <li>
        {group}
      </li>
    ) : (
      group
    );
  }

  // --- Action ---
  if (item.type === 'action') {
    // No dispatcher, no button (framework#4509). This mirrors the capability
    // guards above: an item the host cannot actually serve is hidden, not
    // rendered dead. It also makes the omission visible to whoever adds a new
    // shell — a missing `onAction` shows up as "my action item vanished",
    // which leads to the prop, instead of "clicking does nothing", which for
    // three releases led nowhere.
    if (!onAction) return null;
    const Icon = resolveIcon(item.icon);
    // Through `resolveNavItemLabel`, not `resolveLabel`: an action entry's
    // `label` may be absent too (objectui#9868), and that is where the absent
    // arm lives — as is the inline-locale-map read (objectui#11201), which
    // `resolveLabel` does not do.
    const actionLabel = resolveNavItemLabel(item, tProp, resolveTargetLabel, locale);
    return (
      <SidebarMenuItem ref={row?.ref} style={row?.style}>
        {row?.dropIndicator && <DropIndicator at={row.dropIndicator} />}
        <SidebarMenuButton
          tooltip={actionLabel}
          onClick={() => onAction?.(item)}
          className={cn(mobileBtnClass, dragActivator && 'cursor-grab')}
          {...(dragActivator ? dragActivatorProps(dragActivator) : {})}
        >
          {/* eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable icon component from a static registry, not a component created during render */}
          <Icon className={navIconClass} />
          <span>{actionLabel}</span>
          {item.badge != null && (
            <Badge variant={item.badgeVariant ?? 'default'} className="ml-auto text-[10px] px-1.5 py-0">
              {item.badge}
            </Badge>
          )}
        </SidebarMenuButton>
        {renderItemAction
          ? renderItemAction(item, { external: false, label: actionLabel, basePath })
          : enablePinning && onPinToggle && (
          <SidebarMenuAction
            showOnHover
            onClick={() => onPinToggle(item.id, !item.pinned, item, basePath)}
            aria-label={
              tProp
                ? tProp(item.pinned ? 'console.nav.unpinItem' : 'console.nav.pinItem', {
                    defaultValue: item.pinned ? `Unpin ${actionLabel}` : `Pin ${actionLabel}`,
                    name: actionLabel,
                  })
                : (item.pinned ? `Unpin ${actionLabel}` : `Pin ${actionLabel}`)
            }
          >
            {item.pinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
          </SidebarMenuAction>
        )}
      </SidebarMenuItem>
    );
  }

  // --- Leaf items (every entry that navigates: object / dashboard / page / report / url / component / doc) ---
  const Icon = resolveIcon(item.icon);
  const { href, external } = resolveHref(item, basePath, templateContext);
  const isActive = activeNavId !== null && item.id === activeNavId;
  const itemLabel = resolveNavItemLabel(item, tProp, resolveTargetLabel, locale);

  const content = (
    <>
      {/* eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable icon component from a static registry, not a component created during render */}
      <Icon className={navIconClass} />
      <span>{itemLabel}</span>
      {item.badge != null && (
        <Badge variant={item.badgeVariant ?? 'default'} className="ml-auto text-[10px] px-1.5 py-0">
          {item.badge}
        </Badge>
      )}
    </>
  );

  // A pinned row in a sortable pinned section is dragged by its own link: no
  // grip at rest, a grab cursor, and the link stays the row's one focus stop.
  const activatorProps = dragActivator ? dragActivatorProps(dragActivator) : {};

  return (
    <SidebarMenuItem ref={row?.ref} style={row?.style}>
      {row?.dropIndicator && <DropIndicator at={row.dropIndicator} />}
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={itemLabel}
        className={cn(mobileBtnClass, dragActivator && 'cursor-grab')}
      >
        {external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" {...activatorProps}>
            {content}
          </a>
        ) : (
          <Link to={href} {...activatorProps}>
            {content}
          </Link>
        )}
      </SidebarMenuButton>
      {renderItemAction
        ? renderItemAction(item, { href: href === '#' ? undefined : href, external, label: itemLabel, basePath })
        : enablePinning && onPinToggle && (
        <SidebarMenuAction
          showOnHover
          onClick={() => onPinToggle(item.id, !item.pinned, item, basePath)}
          aria-label={
            tProp
              ? tProp(item.pinned ? 'console.nav.unpinItem' : 'console.nav.pinItem', {
                  defaultValue: item.pinned ? `Unpin ${itemLabel}` : `Pin ${itemLabel}`,
                  name: itemLabel,
                })
              : (item.pinned ? `Unpin ${itemLabel}` : `Pin ${itemLabel}`)
          }
        >
          {item.pinned ? (
            <PinOff className="h-3.5 w-3.5" />
          ) : (
            <Pin className="h-3.5 w-3.5" />
          )}
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  );
}

// ---------------------------------------------------------------------------
// NavigationRenderer (main export)
// ---------------------------------------------------------------------------

/**
 * Renders a `NavigationItem[]` tree into Shadcn Sidebar components.
 *
 * Features:
 * - Every navigation item type + separators
 * - Nested collapsible groups
 * - Badge indicators
 * - Visibility expression evaluation
 * - RBAC permission guards
 * - Active-route highlighting
 * - Search filtering across navigation tree
 * - Pin/favorite items with dedicated "Favorites" section, in the user's
 *   order and reorderable by dragging a pinned row (objectui#12059)
 * - A host control on every entry in place of the pin action
 *   (`renderItemAction`), and host rows after the pinned ones in the Favorites
 *   section (`extraFavorites`) (objectui#12427)
 *
 * @example
 * ```tsx
 * <NavigationRenderer
 *   items={appSchema.navigation}
 *   basePath="/apps/crm"
 *   evaluateVisibility={(expr) => evaluateVisibility(expr, evaluator)}
 *   checkPermission={(perms) => perms.every(p => can(p))}
 *   searchQuery={searchTerm}
 *   enablePinning
 *   onPinToggle={(id, pinned) => updatePin(id, pinned)}
 *   pinnedOrder={pinnedIds}
 *   onPinnedReorder={(ids) => savePinOrder(ids)}
 * />
 * ```
 */
export function NavigationRenderer({
  items,
  basePath = '',
  evaluateVisibility: evalVis = defaultVisibility,
  checkPermission: checkPerm = defaultPermission,
  checkCapability: checkCap = defaultCapability,
  checkDocTarget,
  onAction,
  searchQuery,
  enablePinning,
  onPinToggle,
  renderItemAction,
  extraFavorites,
  pinnedOrder,
  onPinnedReorder,
  resolveTargetLabel,
  locale,
  t: tProp,
  templateContext,
}: NavigationRendererProps) {
  // --- Active item election (#2272) — computed ONCE for the whole tree
  // against the full (unfiltered) item list, so search filtering never
  // changes what counts as active. Per-item state is an id comparison.
  const location = useLocation();
  const activeNavId = useMemo(
    () =>
      resolveActiveNavItem(items, location.pathname, location.search, basePath, templateContext)
        ?.id ?? null,
    [items, location.pathname, location.search, basePath, templateContext],
  );

  // --- Search filtering --- against the label each row SHOWS, so an
  // unlabelled entry is found by the text it inherits (objectui#9868).
  const filteredItems = useMemo(
    () =>
      searchQuery
        ? filterNavigationItems(items, searchQuery, (item) =>
            resolveNavItemLabel(item, tProp, resolveTargetLabel, locale),
          )
        : items,
    [items, searchQuery, tProp, resolveTargetLabel, locale],
  );

  // --- Pinned items (favorites section) --- in the user's order when the
  // host passes one (objectui#12059), else in menu order.
  const pinnedItems = useMemo(
    () =>
      orderPinnedItems(
        collectPinnedItems(filteredItems, {
          evaluateVisibility: evalVis,
          checkPermission: checkPerm,
          checkCapability: checkCap,
          checkDocTarget,
        }),
        pinnedOrder,
      ),
    [filteredItems, evalVis, checkPerm, checkCap, checkDocTarget, pinnedOrder],
  );

  // --- Sort top-level items by order --- (the one comparator the tab bar uses too, objectui#11395)
  const sorted = filteredItems.slice().sort(byNavOrder);

  // --- Shared renderer props ---
  const itemProps: NavRowProps = {
    basePath,
    evalVis,
    checkPerm,
    checkCap,
    checkDocTarget,
    onAction,
    enablePinning,
    onPinToggle,
    renderItemAction,
    resolveTargetLabel,
    locale,
    t: tProp,
    templateContext,
  };

  const hasGroups = sorted.some((i) => i.type === 'group');

  // --- Favorites section (pinned items) --- the one place a user orders the
  // sidebar (objectui#12059): sortable when the host stores the order. The
  // host's own favorite rows follow the pinned ones (objectui#12427), outside
  // that order, and the section draws when either kind is there.
  const showPinned = !!enablePinning && pinnedItems.length > 0;
  const hasExtraFavorites = React.Children.toArray(extraFavorites).length > 0;
  const favoritesSection = showPinned || hasExtraFavorites ? (
    <SidebarGroup>
      <SidebarGroupLabel className={cn('flex items-center gap-1.5', HIDDEN_ICON_LABEL_NO_POINTER, HIDDEN_ICON_LABEL_NOT_FOCUSABLE)}>
        <Star className="h-3.5 w-3.5" />
        {tProp ? tProp('console.nav.favorites', { defaultValue: 'Favorites' }) : 'Favorites'}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        {showPinned && (onPinnedReorder ? (
          <PinnedNavigationList items={pinnedItems} onReorder={onPinnedReorder} rowProps={itemProps} />
        ) : (
          <SidebarMenu>
            {pinnedItems.map((item) => (
              <NavigationItemRenderer
                key={`fav-${item.id}`}
                item={item}
                {...itemProps}
              />
            ))}
          </SidebarMenu>
        ))}
        {hasExtraFavorites && (
          <SidebarMenu className={cn(showPinned && 'mt-1')}>
            {extraFavorites}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  ) : null;

  // --- No explicit groups → wrap in a single SidebarGroup ---
  if (!hasGroups) {
    return (
      <ActiveNavIdContext.Provider value={activeNavId}>
        {favoritesSection}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {sorted.map((item) => (
                <NavigationItemRenderer
                  key={item.id}
                  item={item}
                  {...itemProps}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ActiveNavIdContext.Provider>
    );
  }

  // Mixed content: render groups inline, wrap consecutive leaf items
  const fragments: React.ReactNode[] = [];
  let leafBuffer: NavigationItem[] = [];

  const flushLeaves = (key: string) => {
    if (leafBuffer.length === 0) return;
    const leaves = leafBuffer;
    leafBuffer = [];
    fragments.push(
      <SidebarGroup key={key}>
        <SidebarGroupContent>
          <SidebarMenu>
            {leaves.map((item) => (
              <NavigationItemRenderer
                key={item.id}
                item={item}
                {...itemProps}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>,
    );
  };

  sorted.forEach((item, idx) => {
    if (item.type === 'group') {
      flushLeaves(`leaf-${idx}`);
      fragments.push(
        <NavigationItemRenderer
          key={item.id}
          item={item}
          inList={false}
          {...itemProps}
        />,
      );
    } else {
      leafBuffer.push(item);
    }
  });

  flushLeaves('leaf-end');

  return (
    <ActiveNavIdContext.Provider value={activeNavId}>
      {favoritesSection}
      {fragments}
    </ActiveNavIdContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Helper: the pinned entries in the user's order (objectui#12059)
// ---------------------------------------------------------------------------

/**
 * The pinned entries, each once: those `order` names first, in its order, then
 * any it does not name, in menu order. Without an order, menu order.
 */
function orderPinnedItems(pinned: NavigationItem[], order: string[] | undefined): NavigationItem[] {
  const unique: NavigationItem[] = [];
  const seen = new Set<string>();
  for (const item of pinned) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  if (!order?.length) return unique;
  const rank = new Map(order.map((id, i) => [id, i]));
  return unique
    .map((item, i) => ({ item, key: rank.get(item.id) ?? order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

// ---------------------------------------------------------------------------
// Helper: collect all pinned items (leaf-only) from a navigation tree
// ---------------------------------------------------------------------------

function collectPinnedItems(
  items: NavigationItem[],
  options: NavigationVisibilityOptions,
): NavigationItem[] {
  const pinned: NavigationItem[] = [];
  for (const item of items) {
    // A gated-away node takes its whole subtree with it (`73a3c89af`).
    // This walk is a SECOND path into the same children, so without the guard
    // an author who gated a group watched a pinned descendant keep rendering
    // under Favorites — the group's `visible` predicate evaluated, answered
    // false, and changed nothing the excluded user could see. Guarding here
    // rather than leaving it to the per-item render also means a Favorites
    // section whose every entry is gated away is not rendered at all, instead
    // of a "Favorites" heading over an empty list.
    if (!passesNavItemGuards(item, options)) continue;

    if (item.type !== 'group' && item.type !== 'separator' && item.pinned) {
      pinned.push(item);
    }
    if (item.children?.length) {
      pinned.push(...collectPinnedItems(item.children, options));
    }
  }
  return pinned;
}
