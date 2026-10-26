/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Navigation Component Schemas
 * 
 * Type definitions for navigation and menu components.
 * 
 * @module navigation
 * @packageDocumentation
 */

import type { BaseSchema, SchemaNode } from './base.js';

/**
 * Navigation link
 */
export interface NavLink {
  /**
   * Link label
   */
  label: string;
  /**
   * Link URL/href
   */
  href: string;
  /**
   * Link icon
   */
  icon?: string;
  /**
   * Whether link is active
   */
  active?: boolean;
  /**
   * Whether link is disabled
   */
  disabled?: boolean;
  /**
   * Submenu links
   */
  children?: NavLink[];
  /**
   * Badge content
   */
  badge?: string | number;
}

/**
 * Header bar component
 */
export interface HeaderBarSchema extends BaseSchema {
  type: 'header-bar';
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` reads no `title`.
   *
   * Not in `@objectstack/spec`, so the objectui#7759 ruling makes the read
   * site the truth, and there is none: the renderer's one function reads
   * `actions`, `crumbs`, `rightContent`, `search` and the inherited
   * `className` off `schema`, and forwards to its root only what the shared DOM whitelist (`toDomProps`) admits plus `style` (objectui#10496). Through the real `SchemaRenderer` an authored title drew the
   * header byte-identical to its absence. For the current page name, use the
   * last entry of `crumbs`.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  title?: never;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` reads no `logo`.
   *
   * No read site and no spec declaration. The two faces had also drifted
   * apart: this declaration said an image URL `string`, the zod mirror a node
   * or node array, and neither ever rendered. For brand content use
   * `rightContent` or `actions`.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  logo?: never;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` reads no `nav`.
   *
   * Not in `@objectstack/spec`, so the objectui#7759 ruling makes the read
   * site the truth, and there is none: the renderer's one function reads
   * `actions`, `crumbs`, `rightContent`, `search` and the inherited
   * `className` off `schema`, and forwards to its root only what the shared DOM whitelist (`toDomProps`) admits plus `style` (objectui#10496). Through the real `SchemaRenderer` an authored link list drew
   * the header byte-identical to its absence. No in-tree document authored it.
   * For links, use `crumbs` here, or a `navigation-menu` / `sidebar` node.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  nav?: never;
  /**
   * Breadcrumb items
   */
  crumbs?: BreadcrumbItem[];
  /**
   * Search configuration
   */
  search?: { enabled: boolean; placeholder?: string; shortcut?: string };
  /**
   * Right-side action slots
   */
  actions?: SchemaNode[];
  /**
   * Custom right content area
   */
  rightContent?: SchemaNode;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` has no left slot.
   *
   * Not in `@objectstack/spec`; the renderer reads only `actions`, `crumbs`,
   * `rightContent`, `search` and the inherited `className`, and forwards to its root only what the shared DOM whitelist (`toDomProps`) admits plus `style` (objectui#10496),
   * so an authored node rendered nothing. No in-tree document authored it. For custom content use
   * `rightContent` or `actions`.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  left?: never;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` has no center slot.
   *
   * Same reading as `left`: no read site, no spec declaration, no in-tree
   * author. For custom content use `rightContent` or `actions`.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  center?: never;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` has no `right` slot.
   *
   * No read site and no spec declaration; the right side of the header is
   * `actions` (a node list) and `rightContent` (one node), both read. An
   * authored `right` rendered nothing.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  right?: never;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` reads no `sticky`.
   *
   * No read site and no spec declaration: `true` and `false` both drew the
   * same, non-sticky header. To pin it, give the parent layout the sticky
   * positioning.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  sticky?: never;
  /**
   * RETIRED (objectui#10387, ADR-0049) — `header-bar` reads no `height`.
   *
   * No read of this key exists, and no in-tree document authored it. Not in
   * `@objectstack/spec`. The renderer's own classes set the height (`h-14`, and
   * `sm:h-16` from the `sm` breakpoint); to change it, author `className` (for
   * example `h-20 sm:h-20`), which is merged after them (objectui#10397).
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  height?: never;
  /**
   * RETIRED (objectui#10286, ADR-0049) — `header-bar` reads no `variant`.
   *
   * The key is not in `@objectstack/spec`, so the objectui#7759 ruling makes
   * the read site the truth, and the read site has none: the renderer's one
   * function reads `actions`, `crumbs`, `rightContent`, `search` and the
   * inherited `className` off `schema`, and forwards to its root only what the shared DOM whitelist (`toDomProps`) admits plus `style` (objectui#10496), so every
   * spelling rendered the same header. The two faces had also drifted apart on the way there — this
   * declaration offered `floating`, the zod mirror `transparent` — and
   * neither word had ever reached a class name.
   *
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  variant?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `header-bar` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `actions`, `className` (since objectui#10397), `crumbs`, `rightContent`,
   * `search` (in `packages/components/src/renderers/navigation/header-bar.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `header-bar` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `header-bar` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `actions`, `className` (since objectui#10397), `crumbs`, `rightContent`,
   * `search` (in `packages/components/src/renderers/navigation/header-bar.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `header-bar` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Sidebar component
 *
 * The node draws its `children` inside one shadcn sidebar region. It reads
 * `collapsible`, and hands `side` and `variant` to shadcn's `Sidebar` through
 * the props it forwards. It composes what it draws through `children`; an
 * app's navigation lives in the app's metadata, not on this node.
 *
 * Nine keys this declaration used to offer had no reader and are RETIRED
 * (objectui#11465, ADR-0049): `title`, `nav`, `content`, `footer`,
 * `position`, `defaultCollapsed`, `collapsed`, `width` and `collapsedWidth`.
 * Each is a `?: never` tombstone below, so `tsc` refuses it by name, and the
 * zod mirror refuses it with the reason and what to write instead. The
 * renderer never named any of them: `SchemaRenderer` spreads unread keys onto
 * shadcn's `Sidebar`, which put them on the panel element as HTML attributes
 * (`title` as a hover tooltip, the arrays and nodes as `[object Object]`) or
 * React dropped them with a warning.
 */
export interface SidebarSchema extends BaseSchema {
  type: 'sidebar';
  /**
   * RETIRED (objectui#11465, ADR-0049) — the node draws no title; the string
   * reached the sidebar panel only as an HTML `title` attribute (a hover
   * tooltip). Compose the heading as a `text` node at the start of `children`.
   * @deprecated Nothing renders it as a title; the zod mirror refuses it by name.
   */
  title?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — the node draws no link list.
   * Navigation lives in the app's metadata (its `navigation` tree, which the
   * app shell's sidebar draws; objectui#11441); to draw items inside this
   * node, compose them as `children`.
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  nav?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — the node renders `children` and
   * nothing else. Move the node or nodes into `children`.
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  content?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — the node renders `children` and
   * nothing else. Compose the footer as the last entries of `children`.
   * @deprecated Nothing renders it; the zod mirror refuses it by name.
   */
  footer?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — every value drew the sidebar at the
   * same edge. Delete the key. To draw the sidebar against the right edge,
   * write `side: 'right'` (objectui#11070).
   * @deprecated Nothing reads it; the zod mirror refuses it by name.
   */
  position?: never;
  /**
   * Whether sidebar is collapsible
   * @default true
   */
  collapsible?: boolean;
  /**
   * RETIRED (objectui#11465, ADR-0049) — the open state belongs to the
   * sidebar provider (the host's, such as the app shell's, or the one the node
   * mounts when there is none), and the node hands it no state. Delete the key.
   * @deprecated Nothing reads it; the zod mirror refuses it by name.
   */
  defaultCollapsed?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — as `defaultCollapsed`: the open state
   * is the sidebar provider's, never the node's. Delete the key.
   * @deprecated Nothing reads it; the zod mirror refuses it by name.
   */
  collapsed?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — every value drew the same width.
   * Delete the key. The in-flow form (`collapsible: false`) takes a width
   * utility in `className`, for example `w-72`.
   * @deprecated Nothing reads it; the zod mirror refuses it by name.
   */
  width?: never;
  /**
   * RETIRED (objectui#11465, ADR-0049) — the node never collapses to a
   * narrower width: its collapsible form slides out entirely, and the in-flow
   * form (`collapsible: false`) does not collapse. Delete the key.
   * @deprecated Nothing reads it; the zod mirror refuses it by name.
   */
  collapsedWidth?: never;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `sidebar` renderer spreads it onto `<Sidebar>`, which has no such prop
   * (React attaches nothing). The zod twin refuses it by name; author behaviour
   * as a node type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onCollapsedChange?: never;
  /**
   * Sidebar variant — shadcn's three, the values the `sidebar` registration
   * offers (objectui#11465). `sidebar` draws the edge-bordered column;
   * `floating` a padded, rounded, bordered panel; `inset` a padded panel with
   * no edge border. It shows on the collapsible form only: with
   * `collapsible: false` every value draws the same in-flow column.
   *
   * `'default'` and `'bordered'` are RETIRED: both drew exactly what
   * `'sidebar'` draws. Write `'sidebar'` or delete the key.
   * @default 'sidebar'
   */
  variant?: 'sidebar' | 'floating' | 'inset';
  /**
   * The viewport edge the sidebar is drawn against — shadcn's two, the values
   * the `sidebar` registration offers (objectui#11070). `left` pins the panel
   * to the left edge with its border on its right; `right` pins it to the
   * right edge with its border on its left, and on a narrow viewport the
   * sheet slides in from the right. It shows on the collapsible form only:
   * with `collapsible: false` the node draws an in-flow column, placed by the
   * page's layout, and every value draws the same.
   *
   * Declared here, flat: `@objectstack/spec` has no `sidebar` row to take it
   * from (`pnpm check:component-surface-parity --type ui:sidebar` prints the
   * spec entry it reads).
   * @default 'left'
   */
  side?: 'left' | 'right';
}

/**
 * Breadcrumb item
 */
export interface BreadcrumbItem {
  /**
   * Item label
   */
  label: string;
  /**
   * Item URL/href
   */
  href?: string;
  /**
   * Item icon
   */
  icon?: string;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `breadcrumb` renderer renders items as links and never reads it. The zod
   * twin refuses it by name; author behaviour as a node type (`{ "type":
   * "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onClick?: never;
  /**
   * Sibling items for dropdown navigation (e.g., quick-switch between objects)
   */
  siblings?: Array<{ label: string; href: string }>;
}

/**
 * Breadcrumb component
 */
export interface BreadcrumbSchema extends BaseSchema {
  type: 'breadcrumb';
  /**
   * Breadcrumb items
   */
  items: BreadcrumbItem[];
  /**
   * Separator character/icon
   * @default '/'
   */
  separator?: string;
  /**
   * Maximum items to display before collapsing
   */
  maxItems?: number;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `breadcrumb` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `items`, `maxItems`, `separator` (in
   * `packages/components/src/renderers/data-display/breadcrumb.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `breadcrumb` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `breadcrumb` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `items`, `maxItems`, `separator` (in
   * `packages/components/src/renderers/data-display/breadcrumb.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `breadcrumb` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Pagination component
 */
export interface PaginationSchema extends BaseSchema {
  type: 'pagination';
  /**
   * Current page (1-indexed). The one spelling of the current page: the
   * `pagination` renderer reads it, and it is the spelling every authored
   * pagination node writes.
   */
  currentPage?: number;
  /**
   * RETIRED (objectui#6152, ADR-0049) — a second spelling of
   * {@link PaginationSchema.currentPage}.
   *
   * It was declared here as the "legacy page property", and the renderer read it
   * only as a fallback behind `currentPage`. No document authored it: the
   * authored census over every tracked JSON file, Markdown JSON fence and
   * `type: 'pagination'` object literal found `currentPage` three times and `page`
   * none. Honouring both would keep one fact writable two ways (AGENTS.md #0.1),
   * so it is retired at once, with no alias window. `?: never` rather than
   * deleted: this interface carried `BaseSchema`'s index signature, so a deleted
   * member would type-check silently (since objectui#8347, through a widened
   * value only), while a tombstone makes presence a `tsc`
   * error, and the zod twin refuses the key by name.
   *
   * @deprecated RETIRED (objectui#6152) — rename the key to `currentPage`.
   */
  page?: never;
  /**
   * Total number of pages
   */
  totalPages: number;
  /**
   * Number of sibling pages to show
   * @default 1
   */
  siblings?: number;
  /**
   * Show first/last buttons
   * @default true
   */
  showFirstLast?: boolean;
  /**
   * Show previous/next buttons
   * @default true
   */
  showPrevNext?: boolean;
  /**
   * Page change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * called by the `pagination` renderer as `props.onPageChange(page)` after
   * `SchemaRenderer` spreads it.
   */
  onPageChange?: (page: number) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `pagination` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `currentPage`, `totalPages` (in
   * `packages/components/src/renderers/basic/pagination.tsx`; it also read the
   * retired `page` until objectui#6152 dropped that read).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `pagination` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `pagination` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `currentPage`, `totalPages` (in
   * `packages/components/src/renderers/basic/pagination.tsx`; it also read the
   * retired `page` until objectui#6152 dropped that read).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `pagination` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Navigation menu item
 */
export interface NavigationMenuItem {
  /**
   * Item label
   */
  label: string;
  /**
   * Item href/link
   */
  href?: string;
  /**
   * Item description
   */
  description?: string;
  /**
   * Item icon
   */
  icon?: string;
  /**
   * Child items
   */
  children?: NavigationMenuItem[];
}

/**
 * Navigation menu component
 */
export interface NavigationMenuSchema extends BaseSchema {
  type: 'navigation-menu';
  /**
   * Navigation menu items
   */
  items?: NavigationMenuItem[];
  /**
   * Navigation menu orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `navigation-menu` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `items` (in
   * `packages/components/src/renderers/basic/navigation-menu.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `navigation-menu` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `navigation-menu` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `className`, `items` (in
   * `packages/components/src/renderers/basic/navigation-menu.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `navigation-menu` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Button group button
 */
export interface ButtonGroupButton {
  /**
   * Button label
   */
  label: string;
  /**
   * Button variant
   */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  /**
   * Button size
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /**
   * Whether button is disabled
   */
  disabled?: boolean;
  /**
   * RETIRED (objectui#6124, ADR-0049) — JSON has no function value, and the
   * `button-group` renderer renders each `<Button>` without a click handler and
   * never reads it. The zod twin refuses it by name; author behaviour as a node
   * type (`{ "type": "toast" }`, an `action:button` node) instead.
   * @deprecated Not part of this contract — the value was inert.
   */
  onClick?: never;
  /**
   * Button CSS class
   */
  className?: string;
}

/**
 * Button group component
 */
export interface ButtonGroupSchema extends BaseSchema {
  type: 'button-group';
  /**
   * Button group buttons
   */
  buttons?: ButtonGroupButton[];
  /**
   * Default button variant
   * @default 'default'
   */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  /**
   * Default button size
   * @default 'default'
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `button-group` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `buttons`, `className`, `size`, `variant` (in
   * `packages/components/src/renderers/basic/button-group.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `button-group` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `button-group` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `buttons`, `className`, `size`, `variant` (in
   * `packages/components/src/renderers/basic/button-group.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `button-group` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Union type of all navigation schemas
 */
export type NavigationSchema =
  | HeaderBarSchema
  | SidebarSchema
  | BreadcrumbSchema
  | PaginationSchema
  | NavigationMenuSchema
  | ButtonGroupSchema;
