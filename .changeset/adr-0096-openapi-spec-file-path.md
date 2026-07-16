---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/connector-openapi': minor
'@objectstack/cli': minor
---

feat(connector-openapi): resolve `providerConfig.spec` from a package-relative file path (#3016, ADR-0096 follow-up)

ADR-0096's canonical example authors an OpenAPI-backed instance as
`providerConfig: { spec: './billing-openapi.json' }`, but the landed `openapi`
provider factory only accepted an inline document object or an http(s) URL.
The spec union is now complete: **inline object | file path | remote URL**.

- **`@objectstack/spec`.** `ConnectorProviderContext` gains an optional
  host-injected `loadPackageFile(relativePath)` capability (pure type): reads a
  UTF-8 file resolved against the declaring stack/package root, confined to
  that root. `undefined` on hosts without a filesystem.

- **`@objectstack/service-automation`.** New `packageRoot` plugin option (the
  base for relative file refs; defaults to `process.cwd()`) and an exported
  `createPackageFileLoader(packageRoot)` that implements the confinement
  guard — absolute paths and `..`-escaping paths are rejected — with lazy
  `node:fs`/`node:path` imports so non-Node hosts only fail if a file ref is
  actually dereferenced. The materializer injects the capability into every
  provider factory's context. Failures follow the existing reconcile policy:
  **fatal at boot, entry skipped on reload**.

- **`@objectstack/connector-openapi`.** A string `providerConfig.spec` that is
  not an http(s) URL is now read via `ctx.loadPackageFile` and parsed as an
  OpenAPI JSON document (clear errors for missing/unreadable files, unparseable
  JSON, and hosts without package file access).

- **`@objectstack/cli`.** `serve`/`dev` pass the project folder (the
  `objectstack.config.ts` directory) as the automation service's `packageRoot`,
  mirroring how the standalone sqlite default is anchored.
