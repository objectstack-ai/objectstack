---
'@objectstack/types': minor
'@objectstack/verify': patch
---

`createHostImporter`: resolve the undeclared fallback from the CALLER, not from `@objectstack/types`

The helper's documented contract said the undeclared case "falls back to the importing
package's own resolution". It did not. The fallback was a bare `import()` written inside
`@objectstack/types`, and Node ESM resolves a bare specifier against the module that
CONTAINS the call — so it resolved from `@objectstack/types`, which under a pnpm-isolated
layout can see only its own single dependency, `@objectstack/spec`. Measured from an app
declaring nothing: `@objectstack/plugin-auth`, `@objectstack/plugin-audit` and `chalk` all
resolve from `packages/cli` and all failed through the helper. Under a hoisted npm/yarn
layout the same fallback usually does find the caller's dependencies, so the claim was
green in some installs and absent in others.

`createHostImporter(hostRoot, options)` now takes the caller's resolution base as
`options.fallbackImport` — the caller's own `import()`, written in the calling module:

```ts
createHostImporter(hostRoot, { fallbackImport: (s) => import(s) })
```

**minor, not patch, and not major.** New exported API (`HostImporterOptions`,
`FallbackImport`, a second parameter) makes it additive rather than a fix-only patch. It
is not a breaking change because the parameter is optional and omitting it keeps the
previous resolution base exactly — an existing caller compiles and behaves as before. The
`undeclared` failure text now names that retained default when a caller has not passed a
base, so the gap reports itself instead of being rediscovered by measurement.

`@objectstack/verify` (patch) passes its own base from `bootStack`. Measured: this changes
nothing for `@objectstack/organizations`, the only specifier it routes through the helper —
that package is cloud-private and resolves from nowhere in the framework workspace. It is
what stops the next app-supplied package added to that path from silently missing
`packages/verify`'s own dependencies.

A string `parentURL` / `import.meta.url` base was measured on Node v22.22.2 and rejected in
both spellings: `import.meta.resolve`'s parent argument is silently ignored without
`--experimental-import-meta-resolve` (a change that would have compiled, run, and pinned
green while ignoring the base), and `createRequire(parentURL)` is CJS resolution, which
honours `NODE_PATH` — the hole the declaration gate exists to close, re-opened on the
fallback path.
