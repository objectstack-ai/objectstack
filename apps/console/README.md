# @objectstack/console

Opinionated, fork-ready ObjectStack runtime console built on
[`@object-ui/app-shell`](https://www.objectui.org/docs/layout/app-shell) with the
full ObjectUI plugin set wired up (grid, kanban, calendar, charts, list, detail,
view, form, dashboard, report, chatbot).

This app mirrors the upstream
[`console-starter`](https://github.com/objectstack-ai/objectui/tree/main/examples/console-starter)
template, repackaged as a first-party app inside the framework monorepo so it
can be served alongside `apps/objectos` / `apps/cloud`.

> Renamed from `apps/dashboard` to avoid confusion with the spec-level
> `Dashboard` metadata type. The Console is the runtime UI shell that *renders*
> dashboards (and views/pages/reports), it is not itself a dashboard.

## Develop

```bash
# from the repo root
pnpm install
pnpm dev:console            # runs on http://localhost:5175/_console/
```

By default the dev server proxies `/api` and `/.well-known` to
`http://localhost:3000`, which is where `pnpm dev` (the `apps/objectos` server)
listens. Override the upstream server with `VITE_SERVER_URL` in
`.env.development` if you point the console at a remote ObjectStack instance.

> Pair it with the CRM example server: `pnpm dev:crm` (port 3001) and launch
> with `VITE_SERVER_URL=http://localhost:3001 VITE_PROXY_TARGET=http://localhost:3001 pnpm dev:console`.

### Workspace alias requirement

`vite.config.ts` aliases every `@object-ui/*` import to the **source** folders
in the sibling [`objectui`](https://github.com/objectstack-ai/objectui) checkout
(`../../../objectui/packages/<name>/src`). This is required: the published
`@object-ui/plugin-*` rolldown bundles inline their own private
`ComponentRegistry` instance per package, which breaks cross-plugin component
lookup (e.g. `plugin-list` cannot find `object-grid` registered by
`plugin-grid`). Building from source guarantees a single shared
`ComponentRegistry` singleton — the same trick used by the upstream
`examples/console-starter` template.

Make sure you have `objectui` cloned next to this repo:

```
GitHub/
├── framework/        # this repo
└── objectui/         # https://github.com/objectstack-ai/objectui
```

## Customise

`src/App.tsx` owns the routing tree — fork and edit it. The building blocks
imported from `@object-ui/app-shell` (`ConsoleShell`, `AuthenticatedRoute`,
`RootRedirect`, `Default*` pages) encapsulate the provider stack and auth guard
so you only write JSX.

Common edits:

- **Add a route**: drop a `<Route path="/billing" ... />` inside `<Routes>`
- **Swap auth UI**: replace `<DefaultLoginPage />` with your own component
- **Skip orgs**: `<AuthenticatedRoute requireOrganization={false}>`
- **Add/remove plugins**: edit the side-effect imports at the top of `src/main.tsx`
