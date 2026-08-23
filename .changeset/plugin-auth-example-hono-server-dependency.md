---
"@objectstack/plugin-auth": patch
---

Declare `@objectstack/plugin-hono-server` and put the published auth example in a
tsc program (#10869).

`packages/plugins/plugin-auth/examples/basic-usage.ts` — the file
`content/docs/permissions/authentication.mdx` publishes as "Basic Auth Example" —
imports `HonoServerPlugin` from `@objectstack/plugin-hono-server` on line 12, and
this package declared that dependency in **none** of `dependencies`,
`devDependencies` or `peerDependencies`. (It declares `hono`, which is a different
package.) So the example could not resolve, compile or run for anyone who copied
it out of the docs:

```
examples/basic-usage.ts(12,34): error TS2307: Cannot find module
'@objectstack/plugin-hono-server' or its corresponding type declarations.
```

The declaration is now there (`devDependencies`, `workspace:*` — the example is
development material, and `files` ships only `dist`, so nothing new reaches a
published tarball).

**The dependency alone would have been unverifiable, which is the other half of
this change.** `tsconfig.json` selects `include: ["src/**/*"]`, so `examples/` sat
in no tsc program at all — the type-check-coverage census's only instance of that
— and a manifest edit does not change an `include`. The fix would have had no
compile behind it and the defect could return unseen. So the directory now has a
program: `packages/plugins/plugin-auth/tsconfig.examples.json`, a non-emitting
sibling named in the package's `typecheck` script, following the precedent
`packages/spec/tsconfig.scripts.json` and `packages/objectql/tsconfig.scripts.json`
set. Strictness is inherited, not relaxed, and the directory enters with zero
recorded debt — the example type-checks clean under `strict`, which also measures
that every API it demonstrates (`ObjectKernel.use`/`bootstrap`/`getService`,
`HonoServerPlugin({ port })`, and every `AuthPluginOptions` key it passes) still
exists as written, so it is a working reference rather than a stale one.

Because the directory is now read, `packages/plugins/plugin-auth/examples` leaves
`UNCHECKED_SOURCE_DEBT` in `scripts/check-type-check-coverage.mjs` — the ratchet
shrinks because the thing was repaired, and `RECONCILED` required the deletion in
the same change.
