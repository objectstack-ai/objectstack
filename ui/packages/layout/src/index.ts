/**
 * ObjectUI Layout
 * Copyright (c) 2024-present ObjectStack Inc.
 */

import { createElement, type FC, type ReactNode } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { AppComponentSchema } from '@object-ui/types';
import { PageCard } from './PageCard';
import { AppSchemaRenderer, type AppSchemaRendererProps } from './AppSchemaRenderer';

export * from './PageHeader';
export * from './AppShell';
export * from './PageCard';
export * from './SidebarNav';
export * from './ResponsiveGrid';
export * from './NavigationRenderer';
export * from './AppSchemaRenderer';

/**
 * The component the `app-schema-renderer` TAG is registered against: the seam
 * that makes the registration's `schema` input true (objectui#11494, triage
 * ruling A `5958227972`), in the shape of `@object-ui/plugin-detail`'s
 * `DetailSectionNode`.
 *
 * `SchemaRenderer` strips a node's `schema` key out of the props it spreads,
 * and hands every registered component the NODE itself as its `schema` prop.
 * Registered directly, `AppSchemaRenderer` therefore took the node for its app
 * document: a document nested under `schema` drew an empty shell, and only app
 * keys written flat on the node, which nothing declares, drew (measured by
 * objectui#11440). This adapter reads the nested document off the node it is
 * handed and gives `AppSchemaRenderer` that, so the published input is the one
 * spelling that draws.
 *
 * Why HERE and not in `SchemaRenderer` or `AppSchemaRenderer`: the strip is
 * every node's, and `SchemaRenderer` already delivers the node, so reading
 * `node.schema` needs no change to it. `AppSchemaRenderer` is a published
 * component whose hosts pass `schema={appJson}` in JSX, and none goes through
 * the registry; teaching it a node shape would put a second dialect in front of
 * them (AGENTS.md #0.1).
 *
 * ⛔ No fallback to the node's own keys: a node's flat `navigation` / `title` is
 * the second spelling the ruling refuses (the strict face refuses it as an
 * unrecognized key), so it is not read. A node without `schema` hands the
 * component an empty `app` document: the input is optional, as the
 * registration declares it, and an omitted document draws the shell with no
 * branding and no navigation, which is what such a node drew before.
 * `mobileNavMode`, `basePath` and every other prop reach `AppSchemaRenderer`
 * unchanged.
 */
type AppSchemaRendererNodeProps = Omit<AppSchemaRendererProps, 'schema' | 'children'> & {
  /** The node, as `SchemaRenderer` hands it to every registered component. */
  schema?: { schema?: AppComponentSchema };
  children?: ReactNode;
};

/** The document an `app-schema-renderer` node without `schema` draws. */
const NO_APP_DOCUMENT: AppComponentSchema = { type: 'app' };

const AppSchemaRendererNode: FC<AppSchemaRendererNodeProps> = ({ schema: node, children, ...shellProps }) =>
  createElement(AppSchemaRenderer, { ...shellProps, schema: node?.schema ?? NO_APP_DOCUMENT, children });

export function registerLayout() {
  // ⛔ The `page-header` node type key is RETIRED (objectui#10859 batch 8,
  // phase 2c, the seat's fork ruling on that card, by the objectui#10393 /
  // objectui#8760 route). The page header authors write is `page:header`,
  // which `@object-ui/components` registers and the spec's `PageHeaderProps`
  // declares (its secondary line is `subtitle`). `PageHeader` itself stays a
  // named export of this package.
  //
  // What was here: a registration of `PageHeader` under the kebab key
  // `page-header` in the `layout` namespace, so it stored `layout:page-header`
  // and the bare `page-header` fallback, with `isContainer: true` and five
  // declared inputs (`title`, `subtitle`, `icon`, `actions`, the `children`
  // slot). (Described rather than quoted, for the reason the `app-shell` note
  // below gives: the pins that read this file take a verbatim call in a comment
  // for a live registration.) No `@object-ui/types` arm claims the key, so
  // `objectui validate` refused a `page-header` node at `type` while the
  // registry mounted it.
  //
  // Why unregistering is the whole retirement: no source, doc, example or
  // catalog document in this repository authors the node, and nothing emits
  // it. objectstack's ADR-0087 conversion `page-header-subtitle-alias` renames
  // the KEY `description` → `subtitle` on both header spellings; its own
  // docblock says it does not rewrite the type, and that this registration "is
  // objectui's to retire, on its own schedule". Its fixtures are test data, not
  // producers. The opt-in `PROTOCOL_COMPONENTS` placeholder entry for the same
  // spelling (`@object-ui/components`) went in the same change, so no host can
  // bring the bare key back. The `subtitle ?? description` fallback this alias
  // once carried was already gone (objectui#3789); the conversion-reach pin in
  // `__tests__/page-header-subtitle-conversion-coverage.test.ts` stays, because
  // it guards `page:header`.

  // Page Card — register ONLY as `layout:page:card`. `skipFallback` keeps this
  // thin div from clobbering the bare `page:card` key, which belongs to the
  // record-aware PageCardRenderer in @object-ui/components (it renders
  // title/body/children; this one only renders React children and would
  // otherwise leak schema props onto the DOM). The retired `page-header` alias
  // above made the same choice the other way round, by never claiming
  // `page:header`.
  ComponentRegistry.register('page:card', PageCard, {
    namespace: 'layout',
    skipFallback: true,
    label: 'Page Card',
    category: 'Layout',
    isContainer: true
  });

  // NOTE: `app-shell` is deliberately NOT a component key (objectui#4841,
  // ADR-0049 enforce-or-remove, remove side; maintainer ruling 2026-08-16).
  //
  // It used to be registered here — key `app-shell`, component `AppShell`,
  // `namespace: 'layout'`, `label: 'App Shell'`, `category: 'Layout'`, and no
  // `inputs` — and that registration could never produce an app shell.
  //
  // (The call is described rather than quoted on purpose: the pins that read
  // this file ask it for the registered key list with a regex over
  // `ComponentRegistry` + `.register(`, and a verbatim copy in a comment reads
  // to them as a live registration. Same reason the file's other notes name
  // keys in prose.)
  //
  // Four of `AppShellProps`' seven keys are `React.ReactNode` slots (`sidebar`,
  // `navbar`, `children`, `rightRail`) and a JSON document can fill none of
  // them. Measured on `378dc920b`, a node had exactly two outcomes, neither of
  // them a shell:
  //
  //   - `children` is dropped in SILENCE. `SchemaRenderer` strips `children`
  //     (and `body`) out of a node before spreading the remaining keys as
  //     props, and `AppShell` reads its `children` PROP, never
  //     `schema.children`. The `<main>` element rendered empty, console.error
  //     count 0.
  //   - a schema in `sidebar` / `navbar` / `rightRail` reaches the component as
  //     a plain object and React refuses to render it, so the node became the
  //     renderer's error box ("Objects are not valid as a React child").
  //
  // Only `className` / `defaultOpen` / `branding` — the three plain-data keys —
  // ever survived the JSON path, i.e. the best result JSON could reach was a
  // shell with no navigation, no top bar and an empty content area. With no
  // `inputs` declared, `sdui-parser`'s unknown-prop check had nothing to compare
  // a node against either, so neither outcome was diagnosed (same family as
  // objectui#3972).
  //
  // Removing the key does not remove a capability — it replaces a
  // parse-succeeds-renders-nothing middle state with a NAMED refusal:
  // `{ "type": "app-shell" }` now resolves to nothing, so `SchemaRenderer`
  // renders its OBJUI-001 panel ("Unknown component type: app-shell") and
  // `sdui-parser` reports `unknown-component`. Loud beats silent.
  //
  // The two survivors carry the two real capabilities, and this is the whole
  // point of the split:
  //   - `AppShell` stays EXPORTED (above) as a React composition primitive —
  //     compose the shell in React and render JSON pages inside it.
  //   - `app-schema-renderer` (below) stays the ONE JSON door for "render a
  //     whole shell from a schema": it declares `inputs` and builds branding and
  //     sidebar navigation out of an `AppSchema` document.
  //
  // Re-registering `app-shell` is not a one-line revert: it needs `inputs` AND a
  // rendering adapter that turns the schema values in `sidebar`/`navbar`/
  // `rightRail` into nodes and wires `schema.children` to `children` (option B
  // on objectui#4841), plus an answer to how it then differs from
  // `app-schema-renderer`. `__tests__/app-shell-not-a-component-key.test.tsx`
  // pins the current state and says the same thing where it fails.

  // ⛔ The `responsive-grid` node type key is RETIRED (objectui#11441, the
  // maintainer's ruling `5950208338`, letter B, executed as an objectui#10859
  // batch by the objectui#10393 / objectui#8760 route). A breakpoint grid has one
  // spelling: the `grid` node from `@object-ui/components` with a breakpoint
  // `columns` object (`{ "type": "grid", "columns": { "xs": 1, "md": 2 },
  // "gap": 4 }`), which both validator faces accept and which refuses an unknown
  // breakpoint key as an unrecognized key (`unrecognized_keys` on `columns`).
  // `ResponsiveGrid` stays a named export of this package for hosts that
  // compose it in React, and so does the
  // `BreakpointColumnMap` it is typed by: the same ruling keeps objectui#7580's
  // vocabulary half and retires only this registration.
  //
  // What was here: a registration of `ResponsiveGrid` under the kebab key
  // `responsive-grid` in the `layout` namespace, so it stored
  // `layout:responsive-grid` and the bare `responsive-grid` fallback, with
  // `isContainer: true` and two declared inputs (`columns` as an object, `gap`
  // as a number). (Described rather than quoted, for the reason the `app-shell`
  // note above gives.) No `@object-ui/types` arm claimed the key, so
  // `objectui validate` refused a `responsive-grid` node at `type` while the
  // registry mounted it.
  //
  // Why unregistering is the whole retirement: no source, doc, example or
  // catalog document in this repository or in objectstack authors the node, and
  // nothing emits it. A node written with this type now renders the OBJUI-001
  // "Unknown component type" panel.

  // ⛔ The `navigation-renderer` node type key is RETIRED (objectui#11441, the
  // same ruling, letter B, by the same route). Navigation has one home:
  // application metadata, the app's `navigation` items plus what plugins
  // contribute (ADR-0029 D7), drawn by the shell. In this package that is
  // `AppSchemaRenderer`, the whole-shell door below (objectui#4841); in the
  // console it is `UnifiedSidebar`, which mounts `NavigationRenderer` itself.
  // `NavigationRenderer` stays a named export of this package; only the page
  // node spelling goes.
  //
  // What was here: a registration of `NavigationRenderer` under the kebab key
  // `navigation-renderer` in the `layout` namespace, so it stored
  // `layout:navigation-renderer` and the bare `navigation-renderer` fallback,
  // with two declared inputs: `items`, a required array (objectui#3972 corrected
  // its type from `object`; objectui#3987 made it required, because the
  // renderer has no default and a node without it crashed on render), and
  // `basePath`, an optional string. (Described rather than quoted, as above.)
  // No `@object-ui/types` arm claimed the key, so `objectui validate` refused a
  // `navigation-renderer` node at `type` while the registry mounted it.
  //
  // Why unregistering is the whole retirement: no source, doc example or
  // catalog document in this repository or in objectstack authors the node, and
  // nothing emits it; every host that draws navigation mounts the component. A
  // node written with this type now renders the OBJUI-001 "Unknown component
  // type" panel: a loud refusal, not a second source of navigation.

  // Registered against `AppSchemaRendererNode` (above), NOT `AppSchemaRenderer`:
  // the adapter is what hands the component the `schema` input (objectui#11494).
  ComponentRegistry.register('app-schema-renderer', AppSchemaRendererNode, {
    namespace: 'layout',
    label: 'App Schema Renderer',
    category: 'Layout',
    isContainer: true,
    inputs: [
      // The app document the shell draws (`@object-ui/types/zod`'s
      // `AppComponentSchema`, which `AppSchemaRendererNodeSchema` declares by
      // reference). Optional: a node without it draws the shell with no document.
      { name: 'schema', type: 'object' },
      { name: 'basePath', type: 'string' },
      // Declared as the vocabulary the renderer implements, not as free text
      // (objectui#3985). `type: 'string'` judged only `typeof value ===
      // 'string'`, so a hyphenated misspelling of `bottom_nav` passed every
      // gate and then failed the renderer's one equality check in silence —
      // the author got drawer behaviour and no diagnostic. As an `enum`,
      // `sdui-parser`'s `checkType` raises an error-level `invalid-enum`
      // instead, which is where an AI author finds the typo.
      {
        name: 'mobileNavMode',
        type: 'enum',
        enum: ['drawer', 'bottom_nav'],
        description:
          'Mobile navigation mode. "drawer" (default) puts the sidebar in the mobile sheet overlay; "bottom_nav" additionally renders a fixed bottom bar. These are the only two modes the renderer implements.',
      },
    ],
  });

  // NOTE: 'page' registration is handled by @object-ui/components PageRenderer.
  // That renderer supports page types (record/home/app/utility), named regions,
  // and PageVariablesProvider. Do NOT re-register 'page' here to avoid conflicts.
  //
  // This package used to ALSO export a `page`-node renderer (`PageNodeRenderer`,
  // `./Page`) that this note kept unregistered — so it had no call site and
  // never ran, while still advertising itself from the public API as if
  // `@object-ui/layout` were where page rendering lives. Deleted in
  // objectui#3223 under ADR-0049 (enforce-or-remove): one key, one renderer. If
  // the `page` node needs something layout owns, add it to the components
  // renderer — do not reintroduce a second one here.
}

// Keep backward compatibility for now if called directly
try {
  registerLayout();
} catch (e) {
  // Ignore registration errors during build/test cycles
}
