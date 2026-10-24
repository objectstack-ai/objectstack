---
name: objectui
description: Universal Server-Driven UI (SDUI) engine for building JSON-driven React interfaces with Shadcn design quality. Use for schema-driven page building, plugin development, expression bindings, data integration, testing, auth/permissions, i18n, mobile responsiveness and project setup with the `@object-ui/*` packages. Triggers on ObjectUI, SchemaRenderer, JSON UI schemas, SDUI, metadata-driven UIs, `@object-ui/*`. Do NOT use for server-side ObjectStack concerns (data modelling, API endpoints, automation, formulas, agents) — those belong to the `objectstack-*` skills.
license: Apache-2.0
compatibility: Tracks the @objectstack/spec range each @object-ui/* package declares in its own manifest; read it there. This file states no version literal, per the doc-version-claims ratchet.
metadata:
  author: objectstack-ai
  version: "2.0"
  domain: ui
  tags: sdui, schema-renderer, json-ui, react, shadcn, tailwind, plugin, expression
user-invocable: false
---

# ObjectUI

A server-driven UI engine: it renders JSON metadata from the `@objectstack/spec`
protocol into React interfaces built on Tailwind and Shadcn — dashboards,
kanbans, CRUDs, forms, grids.

## Where to go

| Your task | Guide |
|---|---|
| Build or debug a page schema — nodes, layout, plugin widgets, common traps | [`guides/page-builder.md`](./guides/page-builder.md) |
| An expression is not evaluating, or you need the syntax / scope / formula functions | [`guides/schema-expressions.md`](./guides/schema-expressions.md) |
| Feed a page from a backend — `DataSource`, `QueryParams`, `bind`, mocking | [`guides/data-integration.md`](./guides/data-integration.md) |
| Package a custom renderer or field widget as a plugin | [`guides/plugin-development.md`](./guides/plugin-development.md) |
| Node shape, `ComponentRegistry`, the renderer recursion, which integration package to install | [`guides/architecture.md`](./guides/architecture.md) |
| Which URL a navigation item resolves to (the *choice* of construct is `objectstack-ui`'s) | [`guides/app-composition.md`](./guides/app-composition.md) |
| Start a new project — CLI, Vite, Tailwind, config files | [`guides/project-setup.md`](./guides/project-setup.md) |
| Write unit / DOM / E2E tests for components, schemas and plugins | [`guides/testing.md`](./guides/testing.md) |
| Responsive behaviour, breakpoints, touch gestures | [`guides/mobile.md`](./guides/mobile.md) |
| Auth, roles, tenants, client-side permission guards | [`guides/auth-permissions.md`](./guides/auth-permissions.md) |
| Multi-language text and formatters | [`guides/i18n.md`](./guides/i18n.md) |

**Rules — read before writing schemas.** These are the non-negotiables, and they
are the anchor for every rule the guides only cue:

- **JSON protocol** — what is evaluated, what is read raw, why keys live on the
  node and not under `props`, layout responsiveness → [`rules/protocol.md`](./rules/protocol.md)
- **Styling & Tailwind** — the two published stylesheets, the `@theme` /
  `@source` split, recolouring → [`rules/styling.md`](./rules/styling.md)
- **Component composition** → [`rules/composition.md`](./rules/composition.md)

## Scope

**In scope:** authoring and debugging JSON schemas rendered by `SchemaRenderer`,
and using the `@object-ui/*` packages — core, components, fields, layout,
react, providers, app-shell, plugins, CLI.

**Out of scope** (defer to the sibling skill):

| Concern | Skill |
|---|---|
| Objects, fields, validations, hooks, field conditional rules | `objectstack-data` |
| App navigation, views, dashboards, pages — *which construct to author* | `objectstack-ui` |
| CEL formulas and predicates | `objectstack-formula` |
| REST/GraphQL endpoints, auth providers, route guards | `objectstack-api` |
| Flows, workflows, triggers, approvals | `objectstack-automation` |
| Bootstrap, plugins, kernel hooks, drivers | `objectstack-platform` |
| ObjectQL query construction | `objectstack-query` |

## Core Principles

### 1. Strict adherence to `@objectstack/spec`

All component schemas, JSON structures and data types follow `@objectstack/spec`.
Do not invent schema properties — if the spec says `columns`, do not write
`fields`. Check the spec before writing any `interface` or `type`.

### 2. Protocol agnostic (the universal adapter)

Never hardcode `objectql.find()` or any specific backend call. Go through the
`DataSource` interface, injected via `<SchemaRendererProvider dataSource={...} />`.
An app may back ObjectUI with REST, GraphQL, ObjectQL or a local JSON file.

### 3. "Shadcn native" aesthetics

ObjectUI is serializable Shadcn. A component follows Shadcn's DOM structure
(`CardHeader` / `CardTitle` / `CardContent`) and always exposes `className` so
styles can be overridden from JSON.

### 4. The action system (interactivity)

Actions are data, not functions — and a control that RUNS something is its own
node type, `action:button`. Its props go in the node's `properties` bag, the spec's
row for the block: `actionType` names the executor the action runner dispatches
to, and the row's other keys carry that executor's arguments. ⛔ Never flat on the
node — the spec's strict page component refuses a node-level `actionType` /
`target` as mis-layered (ADR-0089 D3a), and so does objectui's strict authoring face:

<!-- os:check -->
```json
{
  "type": "action:button",
  "properties": {
    "label": "Open details",
    "actionType": "url",
    "target": "/users/ada"
  }
}
```

⛔ There is no `events` bag: nothing declares or reads `schema.events`, and the node
is `.passthrough()`, so one authored there is kept and run by nothing.

### 5. Layout as components

Layouts are components that render children. Responsive column counts go on the
node as `columns` — a number, or a breakpoint object ([`rules/protocol.md`](./rules/protocol.md)
has the six keys the renderer reads and the release that still drops `2xl`).

### 6. Type safety over magic

- **No `any`** — use strict generics.
- **Registry** — map type strings (`"type": "button"`) to React components via
  `ComponentRegistry`.
- **No `eval()` or runtime dynamic imports** for component resolution.

## Tech stack (strict constraints)

- **Core:** React 18+ (hooks), TypeScript 5.0+ (strict).
- **Styling:** Tailwind CSS. Required: `class-variance-authority` for variants,
  `tailwind-merge` + `clsx` (`cn()`) for overrides. Forbidden: inline styles
  (`style={{}}`), CSS Modules, styled-components.
- **UI primitives:** Shadcn UI (Radix) + Lucide icons.
- **State:** Zustand (global), React Context (scoped).
- **Testing:** Vitest + React Testing Library + Playwright.

## Common mistakes to avoid

- Writing large bespoke React JSX trees before defining a schema.
- Hardcoding API calls inside visual renderers.
- Introducing package coupling (a UI package depending on business logic).
- Registering components without a namespace in plugin-heavy projects.
- Expecting a `${...}` on a top-level `value` / `label` to evaluate, or "fixing"
  it by moving it under `props` — the first renders the literal, the second
  renders nothing at all. Resolve the value in the host, or carry it on a `text`
  node's `content` ([`rules/protocol.md`](./rules/protocol.md)).
- Missing the published stylesheet imports — `@object-ui/components/style.css`
  then `@object-ui/fields/style.css`, in that order. Components render but look
  completely unstyled ([`rules/styling.md`](./rules/styling.md)).
