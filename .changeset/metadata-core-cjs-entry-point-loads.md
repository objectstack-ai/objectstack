---
"@objectstack/metadata-core": patch
---

fix(metadata-core): the CJS entry point loads again — `import.meta` is no longer emitted into `dist/index.cjs` (#12971)

`@objectstack/metadata-core` declares `"type": "module"` with a dual `exports`
map, so `require('@objectstack/metadata-core')` is a published, supported entry
point. Since 17.2.0 it was **unloadable**: `resolveInstalledSpecVersion()`
anchors its `@objectstack/spec` lookup with `createRequire(import.meta.url)` —
correct for the ESM output — and tsup emitted that identifier **verbatim** into
`dist/index.cjs`. `import.meta` outside an ES module is a **parse-time** error,
so the module never began executing:

```
node -e "require('@objectstack/metadata-core')"
SyntaxError: Cannot use 'import.meta' outside a module
```

The failure was total, not partial. Neither the `typeof require === 'function'`
fast path above the line nor the `try`/`catch` around it ever ran, so **every**
CJS consumer and **every** code path in the package was affected, not just
callers of `resolveInstalledSpecVersion()`. Measured downstream: a walled
enterprise runtime refused to boot because `@objectstack/organizations`
resolves through this condition and the fail-closed tenancy wall correctly
refuses to serve when the organization wall cannot load.

**The fix** is `shims: true` in this package's `tsup.config.ts` — the same one
line, for the same measured reason, already carried by `@objectstack/runtime`
and `@objectstack/metadata-protocol`. tsup rewrites `import.meta.url` in the
CJS output to a real `__filename`-derived URL, so both formats anchor on the
module's own file and resolve the same `@objectstack/spec/package.json`. Both
conditions now load and `resolveInstalledSpecVersion()` returns the identical
value in each.

No API, type or behaviour change: the ESM output is byte-identical apart from
the source comment, and nothing an author writes moves.

**The class is now gated.** `pnpm check:dual-build-cjs-loads` (a step in the
required **Build Core** job) parses every emitted CommonJS file and `require()`s
every published `require` entry point in the workspace — 105 entries across 67
packages — so the next package to leak ESM-only syntax into its CJS output
fails at the commit that introduces it rather than in a consumer's release.
