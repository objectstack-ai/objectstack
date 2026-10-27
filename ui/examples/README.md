# ObjectUI Examples

Runnable examples that show how to consume ObjectUI in different scenarios. Pick the one that matches your starting point.

## Which example should I use?

| Example | Use it when… | Backend | Bundle | What it gives you |
|---|---|---|---|---|
| [`hello-world/`](./hello-world) | You want the smallest possible `<SchemaRenderer>` demo to see the JSON → React pipeline. | None (in-memory schema) | Tiny | A single `App.tsx` rendering one schema. |

> The console itself is `apps/console`, built for ObjectOS. `@object-ui/app-shell`, the
> package its shell and views live in, is private and no longer published to npm, so there
> is no host-console example to fork.

### Also under `examples/`

| Directory | What it is |
|---|---|
| [`schema-catalog/`](./schema-catalog) | **Not a runnable app** — a data package (`@object-ui/example-schema-catalog`) holding the canonical JSON schemas consumed by the docs site (`<SchemaExample id="…" />`), by the smoke test that mounts every entry, and by AI agents as a few-shot corpus. See [its README](./schema-catalog/README.md) for how to add one. |

## Running an example

Neither directory is a dev server: `hello-world` is a snippet to drop into
your own Vite/Next.js app, and `schema-catalog` is a data package verified with
`pnpm --filter @object-ui/example-schema-catalog test`.

## Adding a new example

1. Create `examples/<name>/` with `package.json` named `@object-ui/example-<name>`.
2. Mark it `private: true`.
3. Add an entry to the table above and link its README.
4. Reference workspace packages with `workspace:*`.
5. Keep the dependency footprint aligned with the example's purpose — heavy plugins belong in `apps/console`, not in lightweight integration demos.
