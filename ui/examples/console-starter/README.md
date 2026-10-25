# Console Starter — ObjectUI

A fork-ready **console scaffold** wired against a real ObjectStack backend.
`src/App.tsx` owns the routing tree and is the file you edit; everything the user
then sees inside it — objects, fields, views, relationships, dashboards — is
served by the backend, not defined here.

## What it demonstrates

The whole app is ~70 lines of JSX in [`src/App.tsx`](./src/App.tsx), assembled from
building blocks exported by `@object-ui/app-shell`
([`ConsoleShell.tsx`](../../packages/app-shell/src/console/ConsoleShell.tsx)):

| Piece | What it gives you |
|---|---|
| `ConsoleShell` | Top-level provider stack: theme, navigation, favorites, notifications, `Suspense`. Goes inside `BrowserRouter`, around `Routes`. |
| `AuthenticatedRoute` | `AuthGuard` + `ConnectedShell` + `RequireOrganization`, the guard for protected routes. `requireOrganization={false}` opts out (the `/organizations` route shows this). |
| `ConnectedShell` | The data layer — `AdapterProvider` (an `ObjectStackAdapter` at `VITE_SERVER_URL`) + `MetadataProvider`. |
| `SystemRedirect` | Legacy `/system/*` → `/apps/setup/*`. (`/` is routed by this file's own `<Route path="/">` — the package publishes no `/` element, objectui#10042.) |
| `Default*` pages | Drop-in login / register / forgot-password / home / organizations screens — replace any one with your own component. |
| `DefaultAppContent` | Mounted at `/apps/:appName/*`. This is the console proper: layout, command palette, and the object / record / dashboard / report / page routes. |

Auth is `AuthProvider` from `@object-ui/auth` pointed at
`${VITE_SERVER_URL}/api/v1/auth`. [`src/main.tsx`](./src/main.tsx) registers ten view
plugins by side-effect import (grid, kanban, calendar, charts, list, detail, view,
form, dashboard, report) and hands `I18nProvider` the loader in
[`src/loadLanguage.ts`](./src/loadLanguage.ts), which fetches the app's translations
from `${VITE_SERVER_URL}/api/v1/i18n/translations/:lang`. The server answers with a
spec `TranslationData` document; the loader namespaces it with `@object-ui/i18n`'s
`transformSpecTranslations` — the same branch `apps/console` takes — so
`useObjectLabel` reads your object and field labels. A payload that is already an
i18next namespace tree passes through unchanged.

[`vite.config.ts`](./vite.config.ts) aliases 29 `@object-ui/*` specifiers to
`packages/*/src` so plugin registration hits one `ComponentRegistry` singleton — a
monorepo detail. Drop the aliases when you consume published packages. The list is
**closed under its own import graph** — aliased source imports only aliased
packages — and [`test/vite-alias-closure.test.ts`](./test/vite-alias-closure.test.ts)
re-derives that graph on every run so the list cannot silently drift out of date
again.

## What it is **not**

- **Not a schema or relationship modelling example.** Nothing in this directory
  declares an object, a field or a relationship — there is no schema JSON here at
  all; those live on the server. If you came here to see how relationships are
  modelled, you want [`../schema-catalog/`](../schema-catalog/) and the docs
  ([`content/docs/fields/lookup.mdx`](../../content/docs/fields/lookup.mdx) for
  lookup / master-detail).
- **Not a bring-your-own-backend example.** The data layer is hardwired to
  `ObjectStackAdapter`. For your own REST/GraphQL API see
  [`../byo-backend-console/`](../byo-backend-console/).
- **Not an offline demo.** There is no mock server here; nothing past the login
  screen renders without a live backend.

## How to run

```bash
# from the monorepo root
pnpm install

cd examples/console-starter
pnpm dev                      # Vite; no server.port is set, so the default 5173
```

**`pnpm dev` needs no prior build.** Every workspace package the app reaches is on
the alias list, so Vite serves all of them from `src`. This was not always true:
five packages the aliased sources import — `@object-ui/mobile`,
`@object-ui/providers`, `@object-ui/sdui-parser`, `@object-ui/plugin-editor`,
`@object-ui/react-runtime` — were missing from the list, fell back to node
resolution onto `packages/*/dist`, and produced 500s behind an empty `#root` with
nothing on the page to say why (objectui#3528).

**`pnpm build` and `pnpm type-check` still need `pnpm -w build` first.** Those run
`tsc`, which resolves `@object-ui/*` through `node_modules` rather than through the
Vite aliases — and each package's `types` entry points at `dist/index.d.ts`, which
exists only after a build. Skip it and `tsc` reports `TS2307: Cannot find module
'@object-ui/app-shell' or its corresponding type declarations`:

```bash
# from the monorepo root
pnpm -w build

cd examples/console-starter
pnpm build
```

### Backend

`VITE_SERVER_URL` is the one setting that matters — the adapter, auth, i18n and
action endpoints all hang off it. An empty value means same-origin, for when the
ObjectStack server serves the console itself.

| File | Value |
|---|---|
| [`.env.development`](./.env.development) | empty (same-origin) |
| [`.env.production`](./.env.production) | empty (same-origin) |

Both files ship empty. In dev, the Vite server proxies `/api/*` to
`http://localhost:3000` by default; to point dev at a different backend while
keeping one origin, set `DEV_PROXY_TARGET`, e.g.
`DEV_PROXY_TARGET=https://demo.objectstack.ai pnpm dev`.

Point it at any ObjectStack server. If you need one locally, this repo's live-e2e
helper [`e2e/live/ci/start-backend.sh`](../../e2e/live/ci/start-backend.sh) boots a
real `objectstack dev` on port 4010 with a seeded admin — it is the CI lane's
script, so expect it to fetch the showcase app metadata and `npm install`
published `@objectstack/*` packages first.

(`VITE_USE_MOCK_SERVER` appears in both `.env` files, copied from `apps/console`.
Nothing in this repo reads it. There is no mock mode.)

### Without a backend

Measured with nothing listening on `:3000`, `pnpm dev` on a free port, headless
Chromium on `/`:

**`/` redirects to `/login`.** The root route is wrapped in `AuthenticatedRoute`
(objectui#4042), so the guard resolves the session before the landing redirect —
and the `/meta/*` reads behind it — ever mount. The branded boot screen (the product name
over "Opening your console…") still appears, but only as a *transient* frame
while `GET /api/v1/auth/get-session` is in flight; the redirect lands within a few
hundred milliseconds of that request being refused. `/login` then renders in full
but cannot sign in. The browser console shows `ERR_CONNECTION_REFUSED` for
`/api/v1/auth/get-session`, `/api/v1/auth/config` and
`/api/v1/i18n/translations/en`.

**A stored credential does not change this.** `isAuthenticated` is
`user !== null && session !== null`, and both come only from the server's
`get-session` answer — `localStorage` holds a bearer *token*, never a session — so
seeding `auth-session-token` and reloading `/` still lands on `/login`. With the
backend down no cold load reaches an authenticated state, so nothing below the
guard renders. (Not measured: a session signed in against a live backend that is
then killed under it; until the next reload that one still holds its in-memory
session.)

## Which example do I want?

Full table in the [examples catalog](../README.md). Short version:

- [`hello-world/`](../hello-world/) — the JSON → UI pipeline, one schema, no backend.
- [`byo-backend-console/`](../byo-backend-console/) — embed ObjectUI in your own app, against your own API.
- **`console-starter/`** (this one) — stand up a new ObjectStack console: fork it and edit `src/App.tsx`.
- [`schema-catalog/`](../schema-catalog/) — not an app; the canonical schema corpus used by the docs and tests.

`apps/console/src/App.tsx` is the same composition with more routes — read it when
you outgrow this one.
