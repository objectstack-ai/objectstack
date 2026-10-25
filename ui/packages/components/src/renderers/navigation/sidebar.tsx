/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
// `SidebarSchema` types the one entry point the registry maps to a schema
// (`'sidebar'` — see `@object-ui/types`' registry map).
import type { SidebarSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import { SidebarProvider, Sidebar, useOptionalSidebar } from '../../ui';

// The authored child list is put on the page through `renderChildren`, so the
// slot is declared as `{ name: 'children', type: 'slot' }` (objectui#9910): that
// input is the ONLY thing `sdui-parser`'s `not-a-container` reads.
// ⛔ Not `isContainer`: objectui#6804 ruled that flag means LAYOUT containment
// (the react-page JSX scope, the public layout ledger), and the sidebar is
// chrome, not a layout region.
const CHILDREN_SLOT = { name: 'children', type: 'slot' } as const;

/**
 * The spec's boolean `collapsible` (`SidebarSchema.collapsible`) mapped onto
 * shadcn's `collapsible` prop (objectui#10859 batch 8, phase 2d — the seat's
 * fork ruling, "declared means enforced").
 *
 * The node used to forward the authored value verbatim into shadcn's ENUM prop
 * (`'offcanvas' | 'icon' | 'none'`), so the spec-legal `true` / `false` reached
 * the DOM as `data-collapsible="true"` / `"false"`, which no rule matches: the
 * declared key was inert. Now:
 *
 *   - `false` → `'none'`: not collapsible. shadcn draws its in-flow form, a
 *     plain column in the page, independent of the open state;
 *   - `true` or absent → no prop, so shadcn keeps the default it applied before
 *     this change (`'offcanvas'`).
 *
 * Any other value is forwarded unchanged, as before: it is not a value the spec
 * declares, so `objectui validate` refuses it (`invalid_type` at `collapsible`),
 * and narrowing what the renderer forwards is not this ruling's job.
 */
function toShadcnCollapsible(collapsible: unknown): unknown {
  if (collapsible === false) return 'none';
  if (collapsible === true || collapsible === undefined) return undefined;
  return collapsible;
}

/**
 * The `sidebar` node: the one app-level sidebar region (the seat's ruling on
 * objectui#10859 — no author-composable parts; the ten `sidebar-*` primitives
 * are retired, see below).
 *
 * ⭐ It supplies its own `SidebarProvider` ONLY when none is above it. shadcn's
 * `Sidebar` reads `useSidebar()`, which throws outside a provider, and the only
 * authored provider was the retired `sidebar-provider` primitive — so a bare
 * node threw ("useSidebar must be used within a SidebarProvider.") in any host
 * that did not mount one itself. `useOptionalSidebar()` (a declared local patch
 * on the Shadcn primitive, `scripts/shadcn-local-patches.mjs`) answers `null`
 * exactly where `useSidebar()` would throw:
 *
 *   - a host that mounts a provider (the app shell through `@object-ui/layout`'s
 *     `AppShell`, the docs site's demo hosts) keeps exactly ONE provider, and
 *     its state still drives the node;
 *   - a host that mounts none gets one here, wrapped around this node alone.
 *     `min-h-0` overrides the provider wrapper's `min-h-svh`, so an embedded
 *     node does not claim a full viewport of height.
 *
 * ⛔ Never wrap unconditionally: a second provider would shadow the host's, and
 * the host's trigger and keyboard shortcut would stop reaching this node.
 */
function SidebarNode({
  schema,
  collapsible,
  ...props
}: {
  schema: SidebarSchema;
  collapsible?: unknown;
  [key: string]: any;
}) {
  const hostSidebar = useOptionalSidebar();
  const shadcnCollapsible = toShadcnCollapsible(collapsible);
  const node = (
    <Sidebar
      {...props}
      {...(shadcnCollapsible === undefined ? {} : { collapsible: shadcnCollapsible as never })}
    >
      {renderChildren(schema.children)}
    </Sidebar>
  );
  return hostSidebar ? node : <SidebarProvider className="min-h-0">{node}</SidebarProvider>;
}

ComponentRegistry.register('sidebar', SidebarNode, {
  namespace: 'ui',
  label: 'Sidebar',
  inputs: [
    // The spec's declaration (`SidebarSchema.collapsible`, a boolean), which
    // `SidebarNode` now honours. This was an enum of shadcn's three mode names,
    // which the spec does not declare and `objectui validate` refuses.
    { name: 'collapsible', type: 'boolean', description: '`false` draws the sidebar in the page flow, not collapsible; `true` or omitted keeps the collapsible app-region form.' },
    { name: 'side', type: 'enum', enum: ['left', 'right'] },
    { name: 'variant', type: 'enum', enum: ['sidebar', 'floating', 'inset'] },
    CHILDREN_SLOT
  ],
  // `collapsible` is no longer named here. Its old `'icon'` was never read at
  // render (`SchemaRenderer` does not read a registration's `defaultProps`; an
  // omitted `collapsible` drew shadcn's `'offcanvas'` default), and `'icon'` is
  // not a value the spec's boolean declares.
  defaultProps: {
    side: 'left',
    variant: 'sidebar'
  }
});

/**
 * ⛔ The ten `sidebar-*` node type keys are RETIRED (objectui#10859 batch 8,
 * phase 2d, the seat's fork ruling on that card, by the objectui#10393 /
 * objectui#8760 route): `sidebar-provider`, `sidebar-header`,
 * `sidebar-content`, `sidebar-group`, `sidebar-menu`, `sidebar-menu-item`,
 * `sidebar-menu-button`, `sidebar-footer`, `sidebar-inset` and
 * `sidebar-trigger`. The shadcn components behind them (`SidebarProvider`,
 * `SidebarHeader`, `SidebarMenuButton`, `SidebarTrigger` and the rest) stay
 * exported from `../../ui` for JSX composition; only the node keys went.
 *
 * ## What was here, and why it went
 *
 * Ten registrations in the `ui` namespace, one per shadcn part, each storing
 * `ui:KEY` and the bare `KEY` fallback. (Described rather than quoted: source
 * readers such as `@object-ui/types`' node-slot test take a quoted call in a
 * comment for a live one.) Nine rendered their child list into the matching
 * shadcn part; `sidebar-group` also drew a resolved `label`,
 * `sidebar-menu-button` passed `size` / `tooltip` through the form-control DOM
 * declaration, and `sidebar-trigger` rendered the collapse button and no child
 * list. No `@object-ui/types` arm claims any of them, so `objectui validate`
 * refused each at `type` while the registry mounted it.
 *
 * ## Why unregistering is the whole retirement
 *
 * The mainstream ships one app-level sidebar region, not author-composable
 * parts (the seat's ruling), and nothing wrote these nodes except the four
 * `components-basic-sidebar` catalog documents, rewritten in the same change to
 * the `sidebar` node above, which now supplies its own provider. Re-measured
 * for phase 2d: 0 other producers in source, docs, examples or objectstack, and
 * 0 runtime emission.
 */
