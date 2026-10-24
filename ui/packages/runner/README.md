# @object-ui/runner

Universal Object UI Application Runner - A standalone development server and runtime for testing Object UI schemas.

## Features

- **Schema Development** - Test and debug Object UI schemas in isolation
- **No-Restart Edits** - Under `src/app-data/` the dev server picks metadata changes up
  without a restart, because that JSON is part of Vite's module graph; behind `?api=` it
  cannot, because Vite never sees your backend ([Metadata Loading](#metadata-loading))
- **Plugin Support** - Pre-configured with the Kanban and Charts plugins
- **Development Ready** - Built-in Vite development server
- **Production Build** - Optimized build for deployment

## Running the Runner

The runner is an application, not a library: `package.json` declares no `main`,
`module`, `exports` or `types`, so there is nothing to `import` from
`@object-ui/runner`. You run it from a checkout of this repository:

```bash
git clone https://github.com/objectstack-ai/objectui.git
cd objectui
pnpm install

# Start the dev server on http://localhost:5173
pnpm --filter @object-ui/runner dev
```

Inside `packages/runner`, the same scripts are available directly:

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Pre-installed Plugins

The runner comes with these two plugins pre-configured, registered by the imports in
`src/App.tsx`:

- **@object-ui/plugin-kanban** - Kanban board components
- **@object-ui/plugin-charts** - Chart visualization components

Adding any other plugin means editing the runner's own sources and rebuilding — a
dependency in `package.json`, a registration import in `src/App.tsx`, and the
`vite.config.ts` alias and `src/index.css` `@source` entries the two above have. There
is no runtime plugin installation.

## Metadata Loading

The runner picks its metadata loader when it mounts, from the `api` query parameter of
the page URL (`src/App.tsx`). This is its only API base URL setting — it reads no
environment variables and no config file:

| URL | Loader | Where metadata comes from |
| --- | --- | --- |
| `http://localhost:5173/` | `LocalBundleLoader` | JSON bundled from `src/app-data/` at build time |
| `http://localhost:5173/?api=/api` | `NetworkLoader` | `fetch`ed from the base URL you passed |

With `?api=<base>`, the value is used verbatim as a base URL and fixed paths are
appended to it, so a backend only has to serve two kinds of JSON document:

```text
GET <base>/app.json                 # the app document, loaded once at startup
GET <base>/pages/index.json         # route "/"
GET <base>/pages/customers.json     # route "/customers"
GET <base>/pages/crm/accounts.json  # route "/crm/accounts"
```

A relative base (`?api=/api`) keeps the requests same-origin; an absolute one needs
CORS on the backend. `fetch` is called with no options, so no credentials or custom
headers are sent, and any non-2xx status or network error becomes `null` — which the
runner renders as a 404 rather than surfacing the status.

Without the parameter, `LocalBundleLoader` resolves `src/app-data/app.json` and
`src/app-data/pages/**/*.json` through Vite's `import.meta.glob`. That directory is
git-ignored and absent from a fresh checkout, so every load returns `null` until you
copy or symlink your own metadata directory into it.

In-app navigation carries the query string across, so `?api=…` stays in the address
bar and the URL you copy or reload reaches the same backend.

Full details — route resolution order and error handling — are in the
[Metadata Loading](https://www.objectui.org/docs/utilities/runner#metadata-loading)
section of the docs.

## Configuration

There is no runner config file and no runner environment variables. The two surfaces
that do configure it are:

- **`vite.config.ts`** — build options and the workspace alias table that lets the runner
  boot straight from the monorepo sources. The dev server takes Vite's own defaults
  (port 5173); change them with Vite's flags, e.g. `pnpm dev --port 3000`.
- **The `api` query parameter** — the metadata base URL, described under
  [Metadata Loading](#metadata-loading) above.

## Development Workflow

1. Author the metadata as JSON — both loaders resolve fixed `.json` paths, and JSON is
   the only shape either of them can load. Pick one of the two routes described under
   [Metadata Loading](#metadata-loading):
   - **Bundled** — create `packages/runner/src/app-data/` and put `app.json` plus one
     `pages/<route>.json` per route in it (route `/` is `pages/index.json`). That
     directory is git-ignored, absent from a fresh checkout, and no script in this repo
     creates it, so making it is a step you do by hand — until it exists, every load
     returns nothing and the page renders as a 404.
   - **Served** — run a backend that answers `<base>/app.json` and
     `<base>/pages/<route>.json`, then open the runner with `?api=<base>`.
2. Start the runner with `pnpm dev`
3. Edit the metadata. Under `src/app-data/` the dev server picks the change up without a
   restart, because that JSON is part of Vite's module graph; behind `?api=` it cannot,
   because Vite never sees your backend. Reload the page if the view still shows the
   previous document.
4. Test your UI in the browser
5. Build for production with `pnpm build`

## Example Schema

```json
{
  "type": "page",
  "pageType": "home",
  "title": "Dashboard",
  "children": {
    "type": "grid",
    "columns": 3,
    "gap": 4,
    "children": [
      {
        "type": "card",
        "title": "Total Users",
        "children": {
          "type": "statistic",
          "value": 1234,
          "trend": "up"
        }
      },
      {
        "type": "card",
        "title": "Revenue",
        "children": {
          "type": "statistic",
          "value": "$56,789",
          "trend": "up"
        }
      },
      {
        "type": "card",
        "title": "Orders",
        "children": {
          "type": "statistic",
          "value": 432,
          "trend": "down"
        }
      }
    ]
  }
}
```

## Documentation

For detailed documentation, visit the [Object UI Documentation](https://www.objectui.org/docs/utilities/runner).

## Links

- 📚 [Documentation](https://www.objectui.org/docs/utilities/runner)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/runner)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
