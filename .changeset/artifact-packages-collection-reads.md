---
"@objectstack/core": patch
"@objectstack/runtime": patch
---

fix(runtime): a multi-package artifact's collections are read from `packages[]`, not only from the flattened top level

A release artifact composed with `manifest: 'preserve'` carries every
definition twice — flattened at its top level, and again under
`packages[]` (ADR-0130 D4). Only two readers had ever learned the second
half: `ObjectQLPlugin`'s manifest service and the metadata artifact door.
Every other reader said `artifact.<collection>` and nothing else, so an
artifact that carried a collection under `packages[]` alone reached them
EMPTY — and nothing threw. The app booted clean having lost its
declarative actions, its scheduled jobs, its seed data, its object routing
or its default permission set.

`resolveArtifactCollections` (`@objectstack/core`) is now the one way to
read a top-level collection out of an artifact in either shape. It takes
the artifact's own top-level value first and whole, then adds from each
package body — in `resolveArtifactPackageOrder`'s dependency order — the
items the top level did not already claim. A bundle that carries no
`packages[]` is returned unchanged, by identity: every single-package
artifact and every `defineStack()` config reads exactly as before.

Taught to use it, in `@objectstack/runtime`:

- `AppPlugin` — declared datasources and their auto-connect, the
  `datasourceMapping` object routing, the objects handed to the connection
  service and to the hot-reload seeder, scheduled jobs, seed datasets,
  translation bundles, and the ADR-0057 security collections
  (`positions` / `permissions` / `capabilities` / `sharingRules`). A job
  handler's `ctx.bundle` is now the resolved view too, so
  `ctx.bundle.objects` answers on a multi-package artifact.
- `collectBundleActions`, `collectBundleHooks` and
  `collectBundleFunctionEntries` — including the object-EMBEDDED actions
  that ride on `objects[]` and disappeared with it.
- `mergeRuntimeModule` — the declaration half. The sibling ESM module
  re-supplies every callable regardless of shape, so `functions` was not
  absent: a function declared `effect: 'writes'` simply came back as a bare
  callable and defaulted to `'pure'`. It registered, it ran, and its writes
  were counted as none.
- `createStandaloneStack`'s surfaced `requires` / `objects` /
  `permissions` / `positions`, which drive the CLI's tier resolution, its
  engine and storage-driver auto-registration, and the ADR-0056 D7 default
  permission set.
- `resolve-project-database`'s project-database tier, which opens the
  artifact itself and runs before any stack exists (`os dev`, `os start`,
  `os db clean`). Without this a multi-package project silently fell
  through to the unified default database instead of the datasource it
  declared.

Nothing about what the platform EMITS changes: `composeStacks` and the
artifact format are untouched, and the flattened top level is still
written. This is the reader half of the option-B program (#14512).
