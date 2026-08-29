---
"@objectstack/metadata-core": minor
"@objectstack/service-cluster": minor
---

fix: the `./testing` subpaths are ESM-only — they no longer advertise a `require` condition vitest refuses to serve (#12985)

Both packages published their test-harness subpath as a dual entry point:

```jsonc
// FROM — @objectstack/metadata-core and @objectstack/service-cluster
"./testing": {
  "types": "./dist/testing.d.ts",
  "import": "./dist/testing.js",
  "require": "./dist/testing.cjs"
}

// TO
"./testing": {
  "types": "./dist/testing.d.ts",
  "import": "./dist/testing.js"
}
```

The `require` half was a promise neither package could keep. Both subpaths
re-export `vitest`, and vitest **refuses** to be loaded from CommonJS by
design — its CJS entry is a single `throw`:

```
node -e "require('@objectstack/metadata-core/testing')"
Error: Vitest cannot be imported in a CommonJS module using require(). Please use "import" instead.
```

The emitted bytes parse; the load fails inside vitest's own entry, for every
consumer and every code path. So the condition could never resolve to working
code, on any release, since it was first declared. It is removed rather than
repaired because the failure is not ours to fix: a test harness has no business
advertising a `require` condition when the test runner it re-exports does not
serve one.

**Nothing that worked stops working**, and that is why this is not filed as a
breaking removal. A CJS consumer that resolved through the old condition got a
hard `Error` at load; it now gets a resolution error from node instead — a
different message for the same non-working call, and an earlier and clearer
one. The `import` condition, the types and the runtime API are untouched, and
every in-repo consumer already reaches these subpaths through `import`
(`@objectstack/metadata-fs`, `@objectstack/metadata-protocol`,
`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/service-cluster-redis`).

**If you did spell it as `require`** — `require('@objectstack/metadata-core/testing')`
or `require('@objectstack/service-cluster/testing')` — switch the call to
`await import('@objectstack/metadata-core/testing')`, or move the calling
module to ESM. That is the same change the old condition already forced on
you, one error message earlier.

`dist/testing.cjs` is still emitted (both packages build every entry in both
formats) and still parsed by `pnpm check:dual-build-cjs-loads`; it is simply no
longer reachable through the manifest. Removing it from the build is a
tsup-config change with its own risks and is not folded in here.
