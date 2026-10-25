/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Navigation Component Zod Validators
 * 
 * Zod validation schemas for navigation components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/navigation
 * @packageDocumentation
 */

import { z } from 'zod';
import { handlerKeyRefusal, retirementTombstone } from './tombstone.zod.js';
import { BaseSchema, SchemaNodeSchema } from './base.zod.js';
import type { NavLink, NavigationMenuItem } from '../navigation.js';

/**
 * Nav Link Schema
 *
 * INPUT FACE: both type arguments carry this mirror's existing TypeScript
 * declaration (objectui#7760, maintainer ruling, decision batch #69) — the annotation
 * still breaks the recursion in the initializer below, but it no longer publishes
 * `unknown` as what an author may write here. ⛔ Runtime accept set unchanged; ⛔ the
 * declaration unchanged. The reasoning lives once, on `SchemaNodeSchema` in
 * `base.zod.ts` — read it there before changing this line.
 */
export const NavLinkSchema: z.ZodType<NavLink, NavLink> = z.lazy(() =>
  z.object({
    label: z.string().describe('Link label'),
    href: z.string().describe('Link URL'),
    icon: z.string().optional().describe('Link icon'),
    active: z.boolean().optional().describe('Whether link is active'),
    disabled: z.boolean().optional().describe('Whether link is disabled'),
    children: z.array(NavLinkSchema).optional().describe('Sub-navigation items'),
    badge: z.union([z.string(), z.number()]).optional().describe('Badge content'),
  })
);

/**
 * Breadcrumb Item Schema
 */
export const BreadcrumbItemSchema = z.object({
  label: z.string().describe('Breadcrumb label'),
  href: z.string().optional().describe('Link URL'),
  icon: z.string().optional().describe('Breadcrumb icon'),
  onClick: handlerKeyRefusal('onClick', 'retired', 'Click handler'),
  siblings: z.array(z.object({
    label: z.string().describe('Sibling label'),
    href: z.string().describe('Sibling URL'),
  })).optional().describe('Sibling items for dropdown navigation'),
});

/**
 * Header Bar Schema - Header/navigation bar component
 */
export const HeaderBarSchema = BaseSchema.extend({
  type: z.literal('header-bar'),
  title: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `title`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so an authored title rendered nothing — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. For the current page name use the last entry of `crumbs`.',
  ),
  logo: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `logo`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so an authored logo (URL or node) rendered nothing — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. For brand content use `rightContent` or `actions`.',
  ),
  nav: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `nav`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so an authored link list rendered nothing — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. For links use `crumbs`, or a `navigation-menu` / `sidebar` node.',
  ),
  crumbs: z.array(BreadcrumbItemSchema).optional().describe('Breadcrumb items'),
  search: z.object({
    enabled: z.boolean().describe('Whether search is enabled'),
    placeholder: z.string().optional().describe('Search placeholder text'),
    shortcut: z.string().optional().describe('Keyboard shortcut (e.g., "⌘K")'),
  }).optional().describe('Search configuration'),
  actions: z.array(SchemaNodeSchema).optional().describe('Right-side action slots'),
  rightContent: SchemaNodeSchema.optional().describe('Custom right content area'),
  left: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `left`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so an authored node rendered nothing — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. For custom content use `rightContent` or `actions`.',
  ),
  center: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `center`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so an authored node rendered nothing — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. For custom content use `rightContent` or `actions`.',
  ),
  right: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `right`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so an authored node rendered nothing — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. The right side is `actions` (a node list) and `rightContent` (one node).',
  ),
  sticky: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `sticky`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so true and false drew the same non-sticky header — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. To pin the header, make its parent layout sticky.',
  ),
  height: retirementTombstone(
    'REFUSED (objectui#10387, ADR-0049) — `header-bar` reads no `height`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so every value drew the same default-height header — '
    + 'no render-time error or warning and no element; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, '
    + '`rightContent`, `search`. To change the height, author `className` (e.g. `h-20 sm:h-20`); '
    + 'it is merged after the default `h-14` / `sm:h-16` the renderer sets.',
  ),
  variant: retirementTombstone(
    'REFUSED (objectui#10286, ADR-0049) — `header-bar` reads no `variant`: the key is not in '
    + '`@objectstack/spec`, and its renderer reads only `actions`, `crumbs`, `rightContent`, `search` and '
    + 'the inherited `className` off the node, and forwards to its root only what the shared DOM whitelist admits plus `style`, so every variant rendered the same header — '
    + 'no render-time error or warning and no class; only the parser tier\'s `unknown-prop` warning noticed it. What it renders instead: `actions`, `crumbs`, `rightContent`, '
    + '`search`.',
  ),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `header-bar` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `actions`, `crumbs`, `rightContent`, `search`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `header-bar` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `actions`, `crumbs`, `rightContent`, `search`.',
  ),
});

/**
 * The objectui#11465 retirement guidance for the `sidebar` node: the refusal
 * names the key, says why nothing honoured it, and prescribes what to write
 * instead. The TypeScript face carries the same keys as `?: never` tombstones.
 */
const retiredSidebarKey = (key: string, why: string, instead: string) =>
  retirementTombstone(
    `RETIRED (objectui#11465, ADR-0049) — \`${key}\` on \`sidebar\` had no reader: ${why} Instead: ${instead}`,
  );

/** The one sentence the open-state keys share: the state is the provider's, never the node's. */
const SIDEBAR_OPEN_STATE_OWNER =
  'the open state belongs to the sidebar provider (the host\'s, such as the app shell\'s, or the one the node '
  + 'mounts when there is none), and the node hands it no state; React dropped the value with a warning.';

/**
 * Sidebar Schema - Sidebar component
 *
 * The node draws its `children` inside one shadcn sidebar region. It reads
 * `collapsible` (objectui#10859), and hands `side` (objectui#11070) and
 * `variant` to shadcn's `Sidebar` through the props it forwards. Nine keys
 * this mirror used to declare had no reader and are refused by name
 * (objectui#11465): the node composes what it draws through `children`, and
 * an app's navigation lives in its metadata, not on this node.
 */
export const SidebarSchema = BaseSchema.extend({
  type: z.literal('sidebar'),
  title: retiredSidebarKey(
    'title',
    'the node draws no title; the string reached the sidebar panel only as an HTML `title` attribute (a hover tooltip), never as a heading.',
    'compose the heading as a `text` node at the start of `children`, and delete the key.',
  ),
  nav: retiredSidebarKey(
    'nav',
    'the node draws no link list; the array reached the sidebar panel only as a meaningless attribute.',
    'declare navigation in the app\'s metadata (its `navigation` tree, which the app shell\'s sidebar draws; objectui#11441), '
    + 'and to draw items inside this node, compose them as `children`.',
  ),
  content: retiredSidebarKey(
    'content',
    'the node renders `children` and nothing else; the value reached the sidebar panel only as a meaningless attribute.',
    'move the node or nodes into `children`.',
  ),
  footer: retiredSidebarKey(
    'footer',
    'the node renders `children` and nothing else; the value reached the sidebar panel only as a meaningless attribute.',
    'compose the footer as the last entries of `children`.',
  ),
  position: retiredSidebarKey(
    'position',
    'every value drew the sidebar at the same edge; the value reached the sidebar panel only as an inert HTML attribute.',
    'delete the key. To draw the sidebar against the right edge, write `side: \'right\'` (objectui#11070).',
  ),
  collapsible: z.boolean().optional().describe('Whether sidebar is collapsible'),
  defaultCollapsed: retiredSidebarKey('defaultCollapsed', SIDEBAR_OPEN_STATE_OWNER, 'delete the key.'),
  collapsed: retiredSidebarKey('collapsed', SIDEBAR_OPEN_STATE_OWNER, 'delete the key.'),
  width: retiredSidebarKey(
    'width',
    'every value drew the same width; the value reached the sidebar panel only as an inert HTML attribute.',
    'delete the key. The in-flow form (`collapsible: false`) takes a width utility in `className`, for example `w-72`.',
  ),
  collapsedWidth: retiredSidebarKey(
    'collapsedWidth',
    'the node never collapses to a narrower width: its collapsible form slides out entirely, and the in-flow form '
    + '(`collapsible: false`) does not collapse.',
    'delete the key.',
  ),
  onCollapsedChange: handlerKeyRefusal('onCollapsedChange', 'retired', 'Collapsed change handler'),
  variant: z.enum(['sidebar', 'floating', 'inset'], {
    error: '`variant` on `sidebar` is `\'sidebar\'` (the default), `\'floating\'` or `\'inset\'`: the three shadcn '
      + 'sidebar variants its registration offers (objectui#11465). `\'default\'` and `\'bordered\'` are RETIRED: '
      + 'both drew exactly what `\'sidebar\'` draws, so write `\'sidebar\'` or delete the key.',
  }).optional().describe(
    "Sidebar variant: 'sidebar' (default), 'floating' or 'inset'. It shows on the collapsible form only; with "
    + "collapsible: false every value draws the same in-flow column. 'default' and 'bordered' are retired (objectui#11465)",
  ),
  // Declared locally and flat: `@objectstack/spec` has no `sidebar` row to take
  // it from. The values are the two the `sidebar` registration offers and
  // shadcn's `Sidebar` draws (objectui#11070).
  side: z.enum(['left', 'right'], {
    error: '`side` on `sidebar` is `\'left\'` (the default) or `\'right\'`: the two viewport edges shadcn\'s '
      + 'sidebar is drawn against, the values its registration offers (objectui#11070).',
  }).optional().describe(
    "Viewport edge the sidebar is drawn against: 'left' (default) or 'right'. It shows on the collapsible form "
    + 'only; with collapsible: false every value draws the same in-flow column (objectui#11070)',
  ),
});

/**
 * Breadcrumb Schema - Breadcrumb navigation
 */
export const BreadcrumbSchema = BaseSchema.extend({
  type: z.literal('breadcrumb'),
  items: z.array(BreadcrumbItemSchema).describe('Breadcrumb items'),
  separator: z.string().optional().describe('Custom separator'),
  maxItems: z.number().optional().describe('Maximum items to display'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `breadcrumb` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `items`, `maxItems`, `separator`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `breadcrumb` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `items`, `maxItems`, `separator`.',
  ),
});

/**
 * objectui#6152 — ONE string for the retired `page` spelling, carried into both
 * author-facing channels (`retirementTombstone()` writes it into `.describe()` and
 * the parse message).
 */
const PAGINATION_PAGE_RETIRED =
  'RETIRED (objectui#6152, ADR-0049) — `page` was a second spelling of `currentPage`, read only as a '
  + 'fallback behind it, and no document authored it. Rename the key to `currentPage`.';

/**
 * Pagination Schema - Pagination component
 */
export const PaginationSchema = BaseSchema.extend({
  type: z.literal('pagination'),
  // objectui#6152 — `currentPage` is the one spelling: the renderer reads it, and it
  // is the spelling every authored pagination node writes. `page` is RETIRED in
  // lockstep with the `?: never` twin on the interface; a tombstone rather than a
  // deletion, because `BaseSchema` is `.passthrough()` and a key with no member here
  // would be KEPT unexamined, not refused.
  currentPage: z.number().optional().describe('Current page (1-indexed)'),
  page: retirementTombstone(PAGINATION_PAGE_RETIRED),
  totalPages: z.number().describe('Total number of pages'),
  siblings: z.number().optional().describe('Number of sibling pages to show'),
  showFirstLast: z.boolean().optional().describe('Show first/last page buttons'),
  showPrevNext: z.boolean().optional().describe('Show previous/next buttons'),
  onPageChange: handlerKeyRefusal('onPageChange', 'runtime-slot', 'Page change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `pagination` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `currentPage`, `totalPages`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `pagination` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `currentPage`, `totalPages`.',
  ),
});

/**
 * Navigation Menu Item Schema
 *
 * INPUT FACE: both type arguments carry this mirror's existing TypeScript
 * declaration (objectui#7760, maintainer ruling, decision batch #69) — the annotation
 * still breaks the recursion in the initializer below, but it no longer publishes
 * `unknown` as what an author may write here. ⛔ Runtime accept set unchanged; ⛔ the
 * declaration unchanged. The reasoning lives once, on `SchemaNodeSchema` in
 * `base.zod.ts` — read it there before changing this line.
 */
export const NavigationMenuItemSchema: z.ZodType<NavigationMenuItem, NavigationMenuItem> = z.lazy(() =>
  z.object({
    label: z.string().describe('Menu item label'),
    href: z.string().optional().describe('Link URL'),
    description: z.string().optional().describe('Item description'),
    icon: z.string().optional().describe('Item icon'),
    children: z.array(NavigationMenuItemSchema).optional().describe('Submenu items'),
  })
);

/**
 * Navigation Menu Schema - Navigation menu component
 */
export const NavigationMenuSchema = BaseSchema.extend({
  type: z.literal('navigation-menu'),
  items: z.array(NavigationMenuItemSchema).optional().describe('Menu items'),
  orientation: z.enum(['horizontal', 'vertical']).optional().describe('Menu orientation'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `navigation-menu` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `items`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `navigation-menu` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `items`.',
  ),
});

/**
 * Button Group Button Schema
 */
export const ButtonGroupButtonSchema = z.object({
  label: z.string().describe('Button label'),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link']).optional(),
  size: z.enum(['default', 'sm', 'lg', 'icon']).optional(),
  disabled: z.boolean().optional().describe('Whether button is disabled'),
  onClick: handlerKeyRefusal('onClick', 'retired', 'Click handler'),
  className: z.string().optional().describe('Button class name'),
});

/**
 * Button Group Schema - Button group component
 */
export const ButtonGroupSchema = BaseSchema.extend({
  type: z.literal('button-group'),
  buttons: z.array(ButtonGroupButtonSchema).optional().describe('Group buttons'),
  variant: z.enum(['default', 'secondary', 'destructive', 'outline', 'ghost', 'link']).optional().describe('Button group variant'),
  size: z.enum(['default', 'sm', 'lg', 'icon']).optional().describe('Button group size'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `button-group` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `buttons`, `className`, `size`, `variant`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `button-group` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `buttons`, `className`, `size`, `variant`.',
  ),
});

/**
 * Navigation Schema Union - All navigation component schemas
 */
const NavigationSchemaInferred = z.discriminatedUnion('type', [
  HeaderBarSchema,
  SidebarSchema,
  BreadcrumbSchema,
  PaginationSchema,
  NavigationMenuSchema,
  ButtonGroupSchema,
]);

/**
 * The TYPE of {@link NavigationSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface NavigationZodType extends NavigationSchemaInferredType {
  options: NavigationSchemaInferredType['options'];
}
type NavigationSchemaInferredType = typeof NavigationSchemaInferred;

/** The union above, typed by its named {@link NavigationZodType}. */
export const NavigationSchema: NavigationZodType = NavigationSchemaInferred;
