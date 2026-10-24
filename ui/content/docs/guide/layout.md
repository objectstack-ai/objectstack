---
title: "Layout System"
description: "Understanding ObjectUI's layout components for building application shells and page structures"
---

# Layout System

ObjectUI provides a comprehensive layout system through the `@object-ui/layout` package. This guide explains how to use layout components to build professional application structures.

## Overview

The layout system provides:

- **AppShell** - Full application container with a top navbar, sidebar, and content areas
- **Page** - Individual page wrapper with header and body
- **PageHeader** - Consistent page headers with title and actions
- **SidebarNav** - Navigation sidebar with menu items

## Installation

The layout package is included in the core ObjectUI installation:

```bash
npm install @object-ui/react
```

Layout components are automatically registered when you import ObjectUI.

## AppShell Component

The `AppShell` provides a complete application structure with a top navbar, a sidebar, and
a main content area.

**`AppShell` is a React component, not an authorable JSON node.** Four of its seven props
are `React.ReactNode` slots — `sidebar`, `navbar`, `children` and `rightRail` — and a JSON
document has no way to put a node into any of them. Compose the shell in React, and render
your JSON pages *inside* it. `app-shell` is not a component key either — what a
`{ "type": "app-shell" }` node does now is measured under
[There is no `app-shell` node](#there-is-no-app-shell-node) below.

### Basic Usage

<!-- doc-snippet: fragment — `lucide-react` supplies the `NavItem.icon` COMPONENTS this example is about. It is a dependency of ten workspace packages (`@object-ui/layout` among them) but not a root one, so the specifier does not resolve in this gate's program (measured: TS2307 x1), and `pageSchema` is the reader's own page JSON (TS2304 x1). Probed with the icon import shimmed and `pageSchema` typed `BaseSchema`: the `NavItem[]` literal and the `AppShell` / `SidebarNav` props underneath are clean — 0 diagnostics -->
```tsx
import { AppShell, SidebarNav, type NavItem } from '@object-ui/layout';
import { SchemaRenderer } from '@object-ui/react';
import { LayoutDashboard, Settings, Users } from 'lucide-react';

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Users', href: '/users', icon: Users },
  { title: 'Settings', href: '/settings', icon: Settings },
];

<AppShell
  navbar={<span className="font-semibold">My Application</span>}
  sidebar={<SidebarNav items={navItems} />}
>
  <SchemaRenderer schema={pageSchema} />
</AppShell>
```

Top-bar content goes in `navbar`. `AppShell` renders the sticky `<header>` element itself
and `{navbar}` is the only thing that fills it — there is no `header` prop. Main content is
the component's `children`; there is no `body` prop either.

### Props

`AppShellProps` (`packages/layout/src/AppShell.tsx`) declares exactly these seven. The
component destructures that fixed key list with **no rest element**, so anything else you
pass is built and then dropped on the floor.

These are React props, passed in JSX. None of them is authorable in JSON — there is no
`app-shell` node to write them on.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `sidebar` | `React.ReactNode` | no | Left sidebar node, a flex sibling of the content. Pass `SidebarNav`, or your own node. |
| `navbar` | `React.ReactNode` | no | Top-bar content. `AppShell` supplies the sticky `<header>` around it, so pass only what goes inside. |
| `children` | `React.ReactNode` | yes | Main content, rendered inside the content element, within the shell's one `<main>` landmark. |
| `className` | `string` | no | Tailwind overrides for the content element — **not** for the outer container. |
| `defaultOpen` | `boolean` | no | Initial open state of the underlying Shadcn `SidebarProvider`. Defaults to `true`. |
| `branding` | `AppShellBranding` | no | App branding, applied by `useAppShellBranding`: `primaryColor` / `accentColor` become CSS custom properties on the document root, `favicon` sets the icon link's `href`, and `title` sets `document.title`. |
| `rightRail` | `React.ReactNode` | no | Optional right-side rail. It reflows the content beside it rather than overlaying it; absent → unchanged single-pane layout. |

### There is no `app-shell` node

`app-shell` is not a component key. `registerLayout()` (`packages/layout/src/index.ts`)
does not register it, and nothing else in this repo does either, so a
`{ "type": "app-shell" }` node resolves to nothing and says so. Measured on this tree:

- `SchemaRenderer` replaces the node with its error panel —
  `Unknown component type: app-shell`, error code `OBJUI-001`.
- `sdui-parser` reports it before render, as an `error`-severity diagnostic with code
  `unknown-component` and the message `<app-shell> is not a known component`.

It **was** registered until objectui#4841, and the registration could never produce a
shell. Four of the seven props are `React.ReactNode` slots that a JSON document cannot
fill, so a node had exactly two outcomes: `children` was stripped by `SchemaRenderer`
before a node's keys were spread as props — `AppShell` reads its `children` prop, never
`schema.children` — so the `<main>` element rendered **empty with nothing logged**; and a
schema written into `sidebar` / `navbar` / `rightRail` arrived as a plain object, which
React refuses to render, replacing the node with an error box. Only `className`,
`defaultOpen` and `branding` ever survived the JSON path, i.e. the best result JSON could
reach was a shell with no navigation, no top bar and an empty content area. The key was
retired under ADR-0049 (enforce-or-remove) so that this comes out as a named refusal
rather than a page that renders nothing.

Two doors remain, one per capability:

- **Compose in React** — `<AppShell>` as shown above, with your JSON pages rendered
  *inside* it through `SchemaRenderer`.
- **The whole shell from metadata** — the `app-schema-renderer` node, which renders
  `AppSchemaRenderer`. It builds the branding and the sidebar navigation from the app
  document it carries under `schema`, below. It draws no page content: the node's
  `children` are not rendered, and `objectui validate` refuses them on this node. Page
  content reaches the shell only as React `children`, when a host renders
  `AppSchemaRenderer` in JSX.

The node takes three inputs:

- `schema`: the app document, nested, with its own `"type": "app"`. It is validated as
  the app document, so the document's own refusals apply inside it: `mobileNavMode`
  there is refused, because the mode belongs on the node.
- `basePath`: the prefix of every href the shell generates.
- `mobileNavMode`: `"drawer"` (the default) or `"bottom_nav"`, which adds a fixed
  bottom bar.

```json
{
  "type": "app-schema-renderer",
  "basePath": "/apps/crm",
  "mobileNavMode": "bottom_nav",
  "schema": {
    "type": "app",
    "name": "crm",
    "title": "CRM",
    "navigation": [
      { "id": "home", "type": "page", "pageName": "home", "label": "Home" }
    ]
  }
}
```

The document has one spelling. Its keys written flat on the node (`"navigation"`,
`"title"` beside `"type": "app-schema-renderer"`) are not drawn, and the strict authoring
face (`StrictAnyComponentSchema` in `@object-ui/types/zod`) refuses them as unrecognized
keys. A node without `schema` draws the shell with no branding and no navigation.

### Features

- Responsive layout that adapts to mobile/tablet/desktop
- Collapsible sidebar with state management
- Sticky header
- Scroll management for content area
- Consistent spacing and structure

## Page Component

The `Page` component provides a consistent wrapper for individual pages with optional headers.

### Basic Usage

```json
{
  "type": "page",
  "pageType": "app",
  "title": "User Management",
  "description": "Manage users and permissions",
  "children": {
    "type": "container",
    "children": [
      { "type": "text", "content": "User list goes here" }
    ]
  }
}
```

`pageType` decides whether the page draws its own `title` and `description`. `app`, `list`,
`utility` and `home` draw both, unless a titled `page:header` block in the page takes over
the heading. A page with no `pageType` is a `record` page, which draws neither: its heading
is a `page:header` block, as [Detail Page with Actions](#detail-page-with-actions) shows.
So without `"pageType": "app"`, the page above renders only its children.
[Content Width](#content-width) covers what else each type changes.

### With Action Buttons

A `page` node has no action row of its own. Buttons are NODES, and they go in `children`.
This is a list of products, so the page is a `list` page, which draws its `title` itself:

```json
{
  "type": "page",
  "pageType": "list",
  "title": "Products",
  "children": [
    {
      "type": "flex",
      "properties": {
        "justify": "end",
        "gap": 2,
        "children": [
          {
            "type": "button",
            "label": "Add Product",
            "variant": "default",
            "icon": "plus"
          },
          {
            "type": "button",
            "label": "Export",
            "variant": "outline",
            "icon": "download"
          }
        ]
      }
    },
    {
      "type": "object-grid",
      "properties": { "objectName": "products" }
    }
  ]
}
```

`label` is the button's text key — `text` is not a `ButtonSchema` key. `objectui validate`
refuses it by name, but nothing on the render path does: `BaseSchema` is `.passthrough()`,
so the rendering face keeps the unknown key and `button.tsx`, which reads `schema.label`,
renders a button with no text.

> **⛔ `actions` on a `page` node is refused by name** (objectui#7926). This page used to
> teach `"actions": [ … ]` as a sibling of `title`, and it drew **nothing**: `PageRenderer`
> has never had a read point for the key, and `BaseSchema`'s `.passthrough()` kept the array
> rather than refusing it — so the author got a green validation and an empty page (before
> objectui#7933 it also reached the DOM as `actions="[object Object]"`). `PageNodeSchema`
> now declares the key as a refusal, so the same document fails with the remedy in the
> message instead of rendering silently short. Buttons in `children`, as above; on a record page,
> the `page:header` block's own `actions` — which are **action ids**, not nodes
> (see the [PageHeader reference](/docs/layout/page-header)).

> **⛔ `breadcrumbs` on a `page` node is refused by name** (objectui#8871). This page used
> to declare it in the Schema API block below and author it in two passages, and it drew
> **nothing**: no renderer has ever read the key, and `BaseSchema`'s `.passthrough()` kept
> the array rather than refusing it — the same silent-accept shape as `actions`, retired
> under the same ADR-0049 enforce-or-remove gate. The trail is a **node**, not a key: put
> a `breadcrumb` node in `children`, as [Breadcrumbs for Deep Navigation](#2-breadcrumbs-for-deep-navigation)
> shows. ⛔ Not the `page:header` block's `breadcrumb` either — that one is a singular
> **boolean** the renderer ignores, not a list of links.

### Schema API

<!-- doc-snippet: fragment — a SHAPE excerpt, not an expression — the keys carry `?` optional markers and trailing prose comments, so the object literal cannot parse as TypeScript (measured: TS1109 / TS1005 / TS1011) -->
```typescript
{
  type: 'page',
  
  // Header
  title?: string,               // Page heading; not drawn on a 'record' page, whose heading is a `page:header` block
  description?: string,         // Line under the heading; a 'record' page does not draw it
  icon?: string,               // Optional icon
  // NO `actions` — refused by name (objectui#7926); put the buttons in `children`
  // NO `breadcrumbs` — refused by name (objectui#8871); put a `breadcrumb` node in `children`

  // Content
  children: SchemaNode,            // Main page content

  // Layout
  pageType?: 'record' | 'home' | 'app' | 'utility' | 'list',  // default 'record'; sets the max width and who draws the heading
  // NO `maxWidth` — refused by name (objectui#11318); use `pageType`, or a `container` in `children`
  // NO `padding` — refused by name (objectui#11318); put a `container` with `padding` in `children`

  // Styling
  className?: string,
}
```

### Content Width

A `page` node has no `maxWidth` key. **`pageType`** sets how wide the page's content may
grow: `utility` is the narrowest and suits settings and forms, `record` (the default),
`list` and `app` share a wider cap, and `home` is the widest. `getPageMaxWidth` in
`packages/components/src/renderers/layout/page.tsx` holds the mapping.

```json
{
  "type": "page",
  "pageType": "utility",
  "title": "Settings",
  "children": {
    "type": "form",
    "fields": []
  }
}
```

A page laid out in `regions` can drop the cap altogether: a `main` region declared
`width: 'full'` makes the page full-bleed. That is the only `width` a `main` region takes.
The template decides how wide `main` is (the space `sidebar` and `aside` leave, or one grid
cell on `dashboard`), so `'small'`, `'medium'` and `'large'` on `main` are refused at that
region's `width`, as `@objectstack/spec` refuses them. Other regions keep all four values.

`pageType` is more than a width. A `record` page leaves its heading to a `page:header`
block, so a `title` on a page with no `pageType` draws no heading. That is one more reason
the settings page above says `utility`.

For a column narrower than the page's cap, wrap the content in a `container` and set
**its** `maxWidth`. That key is a `container` member, and the
[Container reference](/docs/components/layout/container) lists its values:

```json
{
  "type": "page",
  "pageType": "utility",
  "title": "Profile",
  "children": {
    "type": "container",
    "maxWidth": "2xl",
    "children": {
      "type": "form",
      "fields": []
    }
  }
}
```

> **⛔ `maxWidth` on a `page` node is refused by name** (objectui#11318). This page used to
> teach `"maxWidth": "lg"` beside `title`, with a list of sizes, and it changed **nothing**:
> `PageRenderer` has no read for the key and takes its width from `pageType`, while
> `BaseSchema`'s `.passthrough()` kept the value rather than refusing it. `PageNodeSchema`
> now declares the key as a refusal whose message names `pageType` and the `container`.

## Page Header (`page:header`)

`page:header` is a page's title bar: a title, an optional subtitle and, on a record page, the
record chip and the record's header actions. Its props contract is `PageHeaderProps`, the
`ComponentPropsMap['page:header']` row, and it is rendered by the record-aware
`PageHeaderRenderer` in `@object-ui/components`. The
[Page Header reference](/docs/layout/page-header) documents every key, both layouts and the
styling.

### Usage

```json
{
  "type": "page:header",
  "properties": {
    "title": "{first_name} {last_name}",
    "subtitle": "View and edit customer information",
    "actions": ["edit_customer", "send_email"]
  }
}
```

The props go in `properties`, which is where `PageHeaderProps` judges them: a misspelled or
removed key there is refused by name. `className` is the one key that belongs on the node
itself, beside `type`.

`title` and `subtitle` both interpolate `{field.path}` tokens against the surrounding
record context, so the title above resolves on a record page. Unresolvable tokens collapse to
an empty string rather than leaking the raw template.

`actions` holds action **ids**, resolved from the object's own `actions` metadata, which
keeps the definitions in one place. They are **not** `SchemaNode` nodes: the contract refuses
an entry that is not a string. Nor does the header draw `children`, so a button written there
does not render.

### Schema API

<!-- doc-snippet: fragment — a SHAPE excerpt, not an expression — its keys carry `?` optional markers and trailing prose comments, so the object literal cannot parse as TypeScript -->
```typescript
{
  type: 'page:header',
  className?: string,                 // on the node, beside `type`
  properties?: {
    title?: string | Record<string, string>,    // {field.path} tokens interpolated; derived from the record when omitted on a record page
    subtitle?: string | Record<string, string>, // secondary line; same interpolation
    actions?: string[],               // action ids, resolved against the object's own actions
    recordChrome?: boolean,           // default true — the record chip on a record page
    showCopyId?: boolean,             // default true
    maxVisible?: number,              // positive integer; inline action buttons (renderer default 3)
    mobileMaxVisible?: number,        // positive integer; the same on mobile (renderer default 1)
    aria?: { ariaLabel?, ariaDescribedBy?, role? },
  },
}
```

The favorites star beside the record title draws where the host wires a favorites toggle, and metadata does not control it.

> **Write `subtitle`; there is no `description` and no `icon`.** The contract refuses
> `description` on this node and names `subtitle` in its place. It refuses `icon` by name as
> an ADR-0087 D2 tombstone — "`page:header` property `icon` was removed in
> @objectstack/spec 17.0.0 (ADR-0087 D2) — no renderer ever read it … Delete the key." The
> header's identity comes from the record chip (`recordChrome`), and each action carries its
> own `icon`.

> **There is no `breadcrumbs` array, and `breadcrumb` draws nothing.** The contract still
> accepts a singular **boolean** `breadcrumb` until objectstack#20758 retires it; the renderer
> ignores it. A trail of links is a `breadcrumb` node — see
> [Breadcrumbs for Deep Navigation](#2-breadcrumbs-for-deep-navigation).

> **`page-header` is retired; author `page:header`.** `page-header` (and its namespaced form
> `layout:page-header`) is no longer registered (objectui#10859): a node written that way
> renders the "Unknown component type" panel, and `objectui validate` refuses it at `type`.
> Write `{ "type": "page:header", "properties": { "title": "…", "subtitle": "…" } }`; the
> secondary line is `subtitle`.

## SidebarNav Component

The `SidebarNav` provides a collapsible navigation sidebar with menu items.

**`SidebarNav` is a React component, and `sidebar-nav` is not a component key at all.**
`registerLayout()` (`packages/layout/src/index.ts`) registers two keys — `page:card` and
`app-schema-renderer` — and nothing in this repo registers `sidebar-nav`. What a
`{ "type": "sidebar-nav" }` node actually does is measured under
[There is no `sidebar-nav` node](#there-is-no-sidebar-nav-node) below. Compose the nav in
React, or declare it as the app's `navigation` metadata when the tree has to come from JSON.

### Basic Usage

`SidebarNav` renders a Shadcn `Sidebar`, so it must be inside a `SidebarProvider` —
`AppShell` supplies one. Its rows are `NavLink`s, so it also needs a router above it.

<!-- doc-snippet: fragment — `lucide-react` supplies the `NavItem.icon` COMPONENTS this example is about. It is a dependency of ten workspace packages (`@object-ui/layout` among them) but not a root one, so the specifier does not resolve in this gate's program (measured: TS2307 x1), and `pageSchema` is the reader's own page JSON (TS2304 x1). Probed with the icon import shimmed and `pageSchema` typed `BaseSchema`: the `NavItem[]` literal and the `AppShell` / `SidebarNav` props underneath are clean — 0 diagnostics -->
```tsx
import { AppShell, SidebarNav, type NavItem } from '@object-ui/layout';
import { SchemaRenderer } from '@object-ui/react';
import { BarChart3, LayoutDashboard, Users } from 'lucide-react';

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Users', href: '/users', icon: Users, badge: '12' },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    children: [
      { title: 'Sales', href: '/reports/sales' },
      { title: 'Analytics', href: '/reports/analytics' },
    ],
  },
];

<AppShell sidebar={<SidebarNav items={navItems} />}>
  <SchemaRenderer schema={pageSchema} />
</AppShell>;
```

Three things that block a copy-paste: `icon` is a **component**, not an icon name —
`SidebarNav` renders it as `<item.icon />`. Nested rows go in `children`; `items` is a key
on `NavGroup`, never on a `NavItem`. And `href` is **required** on every item, including
one that only expands children — it is the row's React key as well as its link target.

### Props

`SidebarNavProps` (`packages/layout/src/SidebarNav.tsx`) declares exactly these six.

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `items` | `NavItem[] \| NavGroup[]` | yes | The rows. A flat `NavItem[]`, or `NavGroup[]` for labelled sections — the array's first element decides which. |
| `title` | `string` | no | Group label shown above a flat, ungrouped `items` list. Defaults to `"Application"`. |
| `className` | `string` | no | Tailwind overrides for the `Sidebar` root. |
| `collapsible` | `"offcanvas" \| "icon" \| "none"` | no | How the sidebar collapses at or above 768px. Defaults to `"icon"`. Not a boolean. |
| `searchEnabled` | `boolean` | no | Show a search input that filters rows by title, children included. Defaults to `false`. |
| `searchPlaceholder` | `string` | no | Placeholder for that input. Defaults to `"Search…"`. |

#### `NavItem`

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | `string` | yes | The row's label. |
| `href` | `string` | yes | Link target, and the row's React key. |
| `icon` | `React.ComponentType<{ className?: string }>` | no | Rendered as `<item.icon />` — pass the Lucide component, not its name. |
| `badge` | `string \| number` | no | Trailing badge content. Rendered whenever it is not `null`/`undefined`, so `0` shows. |
| `badgeVariant` | `'default' \| 'destructive' \| 'outline'` | no | Badge styling. Defaults to `'default'`. |
| `children` | `NavItem[]` | no | One level of nested rows; the parent becomes a collapsible trigger. |

#### `NavGroup`

| Key | Type | Required | Description |
| --- | --- | --- | --- |
| `label` | `string` | yes | Section heading, shown in place of `title`. |
| `items` | `NavItem[]` | yes | The section's rows. |

There is no `active` key — the active row is derived from the router
(`pathname === item.href`), never declared. There is no `disabled` key either, and no
`defaultOpen`: that one is `AppShell`'s prop, not this component's.

### There is no `sidebar-nav` node

`sidebar-nav` was never registered, so the node does not resolve to anything. Rendering
`{ "type": "sidebar-nav", "items": [...] }` produces the renderer's red error box instead
of a sidebar:

```
Unknown component type: sidebar-nav
💡 Ensure the component is registered via registry.register() before rendering.
   Check for typos in the component type name. (OBJUI-001)
```

This is louder than the `app-shell` case above — nothing is silently dropped, because
nothing is parsed as props at all. The whole sidebar is replaced by the error panel.

When the navigation tree genuinely has to come from JSON, it is application metadata:
the app document's `navigation` items (`{ "type": "app", "navigation": [...] }`, which
`objectui validate` accepts), drawn by the shell — the console's sidebar, or
`AppSchemaRenderer` (the whole shell from metadata, above). Both hand the items to the
`NavigationRenderer` component, and its items are JSON-shaped: `icon` really is a string
name there, resolved by `resolveIcon`. There is no page node for navigation:
`navigation-renderer` was retired (objectui#11441), so a node written with that type
renders the same "Unknown component type" panel.

### Features

- Nested menu items (2 levels) with collapsible expand/collapse
- Active state highlighting via React Router
- Icon support (Lucide icons)
- Badge/counter support with variant styling (`default`, `destructive`, `outline`)
- NavGroup support for grouped navigation sections
- Built-in search filtering (`searchEnabled`) across all items and children
- Collapse/expand animation

## Common Layout Patterns

### Full Application Layout

The shell is React; the page inside it is your JSON.

<!-- doc-snippet: fragment — `lucide-react` supplies the `NavItem.icon` COMPONENTS this example is about. It is a dependency of ten workspace packages (`@object-ui/layout` among them) but not a root one, so the specifier does not resolve in this gate's program (measured: TS2307 x1), and `pageSchema` is the reader's own page JSON (TS2304 x1). Probed with the icon import shimmed and `pageSchema` typed `BaseSchema`: the `NavItem[]` literal and the `AppShell` / `SidebarNav` props underneath are clean — 0 diagnostics -->
```tsx
import { AppShell, SidebarNav, type NavItem } from '@object-ui/layout';
import { SchemaRenderer } from '@object-ui/react';
import { SidebarTrigger } from '@object-ui/components';
import { Home, Package, ShoppingCart } from 'lucide-react';

const navItems: NavItem[] = [
  { title: 'Home', href: '/', icon: Home },
  { title: 'Products', href: '/products', icon: Package },
  { title: 'Orders', href: '/orders', icon: ShoppingCart },
];

<AppShell
  navbar={
    <div className="flex w-full items-center gap-2">
      <SidebarTrigger />
      <span className="font-semibold">My App</span>
    </div>
  }
  sidebar={<SidebarNav items={navItems} />}
  defaultOpen
>
  <SchemaRenderer schema={pageSchema} />
</AppShell>
```

`AppShell` adds no controls of its own to the top bar — the sidebar toggle above is one
you render yourself, in `navbar`. There is no `sidebarCollapsible` prop: the sidebar's
collapse behaviour belongs to the sidebar node you pass (`SidebarNav`'s `collapsible`),
and `defaultOpen` is the shell's own initial-state prop.

### Landing Page (No Sidebar)

Omit `sidebar` and the content fills the width under the top bar.

<!-- doc-snippet: fragment — a JSX excerpt showing one prop — `AppShell`, `SchemaRenderer` and `landingSchema` all come from the Basic Usage block above, and restating its five setup lines here would bury the one line the section is about (measured: TS2304 x3) -->
```tsx
<AppShell navbar={<span className="font-semibold">Welcome</span>}>
  <SchemaRenderer schema={landingSchema} />
</AppShell>
```

### Settings Page with Tabs

A settings page is a `utility` page, which gives it the narrowest content width (see
[Content Width](#content-width)):

```json
{
  "type": "page",
  "pageType": "utility",
  "title": "Settings",
  "children": {
    "type": "tabs",
    "items": [
      {
        "label": "General",
        "value": "general",
        "content": { "type": "form", "fields": [] }
      },
      {
        "label": "Security", 
        "value": "security",
        "content": { "type": "form", "fields": [] }
      },
      {
        "label": "Notifications",
        "value": "notifications", 
        "content": { "type": "form", "fields": [] }
      }
    ]
  }
}
```

### Detail Page with Actions

Same rule as above, and it governs the trail too: the breadcrumb and the buttons are both
**nodes in `children`** — never a `breadcrumbs` or an `actions` key on the page.

A detail page is a `record` page. That is the default, and it is named below so the snippet
says so. A record page draws no `title` and no `description` of its own: its heading is
the [`page:header`](#page-header-pageheader) block, so the record's name goes in that
block's `properties.title`, not on the page.

```json
{
  "type": "page",
  "pageType": "record",
  "children": [
    {
      "type": "breadcrumb",
      "items": [
        { "label": "Home", "href": "/" },
        { "label": "Customers", "href": "/customers" },
        { "label": "Acme Corporation" }
      ]
    },
    {
      "type": "page:header",
      "properties": { "title": "Acme Corporation" }
    },
    {
      "type": "flex",
      "properties": {
        "justify": "end",
        "gap": 2,
        "children": [
          {
            "type": "action:button",
            "properties": {
              "name": "edit_record",
              "label": "Edit",
              "variant": "default",
              "icon": "pencil",
              "actionType": "editRecord"
            }
          },
          {
            "type": "action:button",
            "properties": {
              "name": "delete_record",
              "label": "Delete",
              "variant": "destructive",
              "icon": "trash",
              "actionType": "deleteRecord"
            }
          }
        ]
      }
    },
    {
      "type": "card",
      "children": [
        { "type": "text", "content": "Record details..." }
      ]
    }
  ]
}
```

A button that RUNS something is an `action:button` node, not a `button` carrying an
`onClick`. Its props — `actionType` and the rest of the block's row — go in the node's
`properties` bag, as `@objectstack/spec` declares them; the spec's strict page component
refuses them written flat on the node, and `SchemaRenderer` hoists the bag onto the node
before the renderer reads it. `ButtonSchema.onClick` is declared as a runtime slot for a host-supplied
function and the zod mirror refuses it BY NAME — JSON has no function value, and no
handler key consumes a declarative action object. The refusal is not the whole cost:
`onClick` is on `SDUI_DOM_PASS_THROUGH_KEYS`, so an authored string or object is
forwarded to the real DOM listener slot, and React throws the moment anyone clicks.
Measured, React's own error: "Expected `onClick` listener to be a function, instead got
a value of `object` type."

The handler name goes in `actionType`, which `action:button` forwards to the action
runner as the action's type; the runner dispatches to the handler registered under it.
Same spelling as [Record Edit Modes](./record-edit-modes.md).

The rest of the action is authored on the same node. `action:button` and `action:icon`
evaluate `visible` and `disabled` themselves (a boolean, a CEL string, or a
`{ dialect, source }` envelope), and forward the action-definition keys to the runner:
`params`, `confirmText`, `successMessage`, `errorMessage`, `toast`, `bodyExtra`,
`bodyShape`, `operation`, `onSuccess`, `objectName` and the others each
registration's `inputs` lists, with a `description` per key. For an `api` action, write
the request URL in `target`: `endpoint` is not published, because the console's `api`
handler never reads it.

An `operation: update` node runs the declared action its `name` names: the platform
action route writes that declaration's `patch` under the collected params. A `patch`
written on the node itself is not forwarded and writes nothing.

`undoable: true` on an `operation: update` makes the success toast offer Undo, which
writes back the prior values of the fields the update wrote: the named declaration's
`patch` fields and the collected params. `action:button` reads those values off the
record in scope: the record page's record, or the row the host binds through `data`. A
button with no record in scope offers no Undo, because there is no row to restore;
neither does one whose `recordId` names a record other than the one in scope.

## Responsive Behavior

The shell has exactly **one** layout breakpoint, at **768px** — Tailwind's `md`, and
`MOBILE_BREAKPOINT` in `packages/components/src/hooks/use-mobile.tsx`. There is no
separate tablet tier: nothing in `AppShell`, `SidebarNav` or the Shadcn sidebar underneath
them reads `lg` (1024px), so 800px and 1400px get the same layout.

### Sidebar, at or above 768px

- Rendered inline, as a flex sibling of the content — not an overlay.
- How it collapses is the sidebar node's own `collapsible` prop: `"icon"` (the `SidebarNav`
  default) leaves an icon rail, `"offcanvas"` slides it fully out, `"none"` pins it open.
- `AppShell`'s `defaultOpen` picks the initial state, and defaults to `true`.

### Sidebar, below 768px

- It leaves the layout entirely and becomes a `Sheet` overlay (18rem) above the content,
  which is why the content is full-width there.
- **Nothing opens it for you.** `AppShell`'s header renders `{navbar}` and nothing else —
  it adds no controls of its own, in particular **no sidebar toggle**. Render a
  `SidebarTrigger` inside `navbar` yourself; otherwise the only way in is the
  `SidebarProvider` keyboard shortcut, `Cmd/Ctrl + B`, which no touch device has.

### Header and content

- The header is `h-12` (3rem / 48px) at **every** breakpoint — there is no compact
  variant — and spans the full viewport width at every size. The only thing about it that
  responds is horizontal padding, and it turns at `sm` (640px), not 768: `px-2 sm:px-4`.
- Content padding steps three ways — `p-3`, `sm:p-4` (640px), `md:p-6` (768px) — with a
  taller `pb-20` below `sm` only.

## Styling and Customization

### Custom Classes

Add Tailwind classes to layout components:

<!-- doc-snippet: fragment — a JSX excerpt showing the `className` / `navbar` / `sidebar` slots — `AppShell`, `SidebarNav`, `SchemaRenderer`, `navItems` and `pageSchema` all come from the blocks above (measured: TS2304 x6) -->
```tsx
<AppShell
  className="bg-background"
  navbar={
    <div className="flex w-full items-center bg-primary text-primary-foreground">
      My App
    </div>
  }
  sidebar={<SidebarNav className="bg-muted" items={navItems} />}
>
  <SchemaRenderer schema={pageSchema} />
</AppShell>
```

`className` is the only class hook `AppShell` itself takes, and it lands on the content
element (a `<div>` inside the shell's one `<main>` landmark) — not on the outer container. There is **no** per-slot className:
`headerClassName`, `sidebarClassName` and `contentClassName` do not exist. The top bar and
the sidebar are nodes you build, so style them where you build them, as above.

### Page Padding

A `page` node has no padding switch. Its wrapper always insets the content: `p-3`, then
`md:p-4`, then `lg:p-6`. The padding you control is a `container`'s. Its `padding` is a
step on the container's spacing scale: one of 0 to 8, 10, 12 or 16, and `0` means none.
Any other number is refused:

```json
{
  "type": "page",
  "children": {
    "type": "container",
    "maxWidth": false,
    "padding": 8,
    "children": []
  }
}
```

`"maxWidth": false` keeps the container as wide as the page. Leave it out and the container
also caps its own width at its default, `xl`. The
[Container reference](/docs/components/layout/container) lists both scales.

> **⛔ `padding` on a `page` node is refused by name** (objectui#11318). This page used to
> teach `"padding": false` here, and it removed **nothing**: the page wrapper kept its inset,
> because `PageRenderer` has no read for the key and `BaseSchema`'s `.passthrough()` kept the
> value rather than refusing it. The refusal's message names the `container` and its `padding`.

## Best Practices

### 1. Consistent Structure

Compose the shell once and let the page JSON change per route:

<!-- doc-snippet: fragment — a JSX excerpt showing one shell reused across routes — `AppShell`, `SidebarNav`, `SchemaRenderer`, `navbar`, `navItems` and `pageSchema` all come from the blocks above (measured: TS2304 x6) -->
```tsx
// One shell for the whole app; `pageSchema` is whatever the route resolves to.
<AppShell navbar={navbar} sidebar={<SidebarNav items={navItems} />}>
  <SchemaRenderer schema={pageSchema} />
</AppShell>
```

### 2. Breadcrumbs for Deep Navigation

Add a breadcrumb trail to help users navigate. It is a **node in `children`**, not a key on the
page — `breadcrumb`, singular, is the registered renderer:

```json
{
  "type": "breadcrumb",
  "items": [
    { "label": "Home", "href": "/" },
    { "label": "Products", "href": "/products" },
    { "label": "Electronics", "href": "/products/electronics" },
    { "label": "Laptops" }
  ],
  "separator": "/",
  "maxItems": 3
}
```

`separator` defaults to `/`, and `maxItems` collapses the middle of a long trail behind an
ellipsis while keeping the first crumb and the current page. See the
[Breadcrumb reference](/docs/components/data-display/breadcrumb) for the per-key face.

⛔ Not `"breadcrumbs"` on the `page` node — that key has no reader and is refused by name
(objectui#8871), the same way `actions` is. ⛔ Nor the `page:header` block's `breadcrumb`,
a **boolean** the renderer ignores rather than a list of links.

### 3. Action Buttons at the Top of the Body

Place primary actions in the first `children` node, so they sit above the content. A list
of orders is a `list` page, which draws its `title` as the heading above them:

```json
{
  "type": "page",
  "pageType": "list",
  "title": "Orders",
  "children": [
    {
      "type": "flex",
      "properties": {
        "justify": "end",
        "gap": 2,
        "children": [
          { "type": "button", "label": "New Order", "variant": "default" }
        ]
      }
    }
  ]
}
```

⛔ Not `"actions"` on the `page` node — that key has no reader and is refused by name
(objectui#7926). A record page has a second door: the `page:header` block, whose `actions`
are **action ids** resolved from the object's own actions metadata, not nodes
(see the [PageHeader reference](/docs/layout/page-header)).

### 4. Constrained Width for Forms

Give forms and reading content a narrow column: a `container` with its own `maxWidth`,
inside the page. ⛔ Not `maxWidth` on the `page` node, which is refused by name
(objectui#11318); the page's own cap comes from `pageType` (see [Content Width](#content-width)).

```json
{
  "type": "page",
  "pageType": "utility",
  "children": {
    "type": "container",
    "maxWidth": "2xl",
    "children": {
      "type": "form",
      "fields": []
    }
  }
}
```

### 5. Sidebar Organization

Group related items with `NavGroup`. Pass groups instead of a flat list and `SidebarNav`
labels each section and draws the separator between them itself — there is no `divider`
item, and a row is either a link or a group, never both:

<!-- doc-snippet: fragment — `lucide-react` supplies the `NavItem.icon` COMPONENTS this example is about. It is a dependency of ten workspace packages (`@object-ui/layout` among them) but not a root one, so the specifier does not resolve in this gate's program (measured: TS2307 x1). Probed with the icon import shimmed: the `NavGroup[]` literal and the `SidebarNav` props underneath are clean — 0 diagnostics -->
```tsx
import { SidebarNav, type NavGroup } from '@object-ui/layout';
import { DollarSign, Home, Settings } from 'lucide-react';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ title: 'Dashboard', href: '/', icon: Home }],
  },
  {
    label: 'Sales',
    items: [
      {
        title: 'Sales',
        href: '/sales',
        icon: DollarSign,
        children: [
          { title: 'Orders', href: '/orders' },
          { title: 'Invoices', href: '/invoices' },
        ],
      },
    ],
  },
  {
    label: 'System',
    items: [{ title: 'Settings', href: '/settings', icon: Settings }],
  },
];

<SidebarNav items={navGroups} />;
```

## Related Documentation

- [Components Overview](/docs/components) - All available components
- [Schema Rendering](/docs/guide/schema-rendering) - How schemas work
- [Architecture Overview](/docs/guide/architecture) - System architecture
