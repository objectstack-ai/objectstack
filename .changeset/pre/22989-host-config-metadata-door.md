---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

`os serve` of a host config serves the stack's declared `apis` endpoints, and a composition that still cannot serve them says so once

Clause-②: no

A host config is a stack whose `plugins` holds plugin instances: `examples/app-showcase` and every `create-objectstack` scaffold. On `os serve objectstack.config.ts` (and on `os start`, whose `serve` child boots the same way) such a config never got `@objectstack/metadata`'s `MetadataPlugin`, so its `metadata` service was the kernel's in-memory fallback, which has no endpoint matcher. Every declared `apis` path answered `404 ENDPOINT_NOT_FOUND` there, while `os dev` of the same stack matched it. Measured on the showcase with no session: `GET /api/v1/apps/showcase/tasks` answered 404 and now answers `401 UNAUTHENTICATED`; an undeclared path under the same namespace still answers 404.

`os serve` now composes a `MetadataPlugin` with no artifact on a host-config boot that has none (when `os dev`'s artifact door does not compose and `plugins` holds no `MetadataPlugin` of its own). What an upgrading host author meets on that boot, measured on the showcase before and after:

- `GET /api/v1/meta/TYPE` answers byte-for-byte the same for every type it served before (22 types read, including `app`, `view`, `page`, `dashboard`, `flow`, `position` and `permission`).
- `GET /api/v1/openapi.json` now documents the declared endpoints the boot serves; before, it listed none of them.
- No new database table: the `sys_metadata` storage tables were already provisioned, and no row is written at boot.
- The door writes nothing into the project directory at boot. Its metadata repository is rooted at the served app's directory, not at the directory the command was run from.
- The door reads none of the stack and primes nothing from the filesystem (`bootstrap: 'lazy'`), so `positions` / `permissions` / `capabilities` / `sharingRules` keep exactly one registrar.
- The dev-only `GET /api/v1/dev/metadata-events` stays unmounted unless `NODE_ENV=development`. Under `os serve --dev` with no compiled artifact it is now mounted, as it is on every other config's dev boot.
- With a remote cluster driver, the metadata service's cross-node cache invalidation (`metadata.changed`) now attaches; the boot warning that it was disabled is gone.
- Boot time and memory did not measurably move (median of 7 boots each: 8.47 s → 8.41 s to listening, 461 MB → 459 MB resident).

A composition that still has no endpoint matcher (for example a kernel composed without `MetadataPlugin`) now logs one warning at boot per app that declares `apis`, with the count, naming the remedy: compose `@objectstack/metadata`'s `MetadataPlugin`.
