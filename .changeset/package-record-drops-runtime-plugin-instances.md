---
"@objectstack/runtime": patch
---

fix(runtime): register the package record without the bundle's runtime instances so the package read doors can serialize it (#14442)

`AppPlugin.init` flattens its bundle into `{ ...bundle.manifest, ...bundle }`
and hands that to `manifest.register()`; `SchemaRegistry.installPackage` stores
it RAW as the package record's `manifest`. A code-defined stack's `plugins:
[new ConnectorOpenApiPlugin(), …]` are instantiated kernel plugins, and a
booted one holds the engine — which refers back to itself. The stored record
therefore contained a cycle, and every door that serves a package row runs it
through `JSON.stringify`, so all four answered
`Converting circular structure to JSON`:

- `GET /api/v1/packages` (dispatcher list) — HTTP 500
- `GET /api/v1/packages/:id` (dispatcher detail) — HTTP 500
- `GET /api/v1/meta/package` — HTTP 500
- `POST /api/v1/packages/:id/duplicate` — its `sys_packages` persist threw

Studio's package picker reads the list door, so it was wholly unavailable on
any app whose stack declares plugin instances (`examples/app-showcase`). Purely
declarative apps (`examples/app-todo`, `hotcrm`) were never affected.

The registration payload now drops the instantiated kernel plugins from
`plugins[]` and nothing else. The discriminator is the kernel's own —
`Plugin.init` is a required member of the `Plugin` interface, the same
predicate `@objectstack/cli`'s `isHostConfig` already uses to answer this
question about this array. Manifest-shaped nested plugins are kept, so the
metadata they contribute (`ObjectQL.registerApp` → `registerPlugin`) still
registers under the parent package's ownership; `datasources` are declarative
(`DatasourceSchema`) and are untouched, so the external-datasource index and
the ADR-0015 write gate are unchanged. A payload with nothing to strip is
returned by reference, so every stack without plugin instances reaches the
registry as the exact same object as before and the ADR-0130 D7 single-manifest
bit-identity contract is untouched.
