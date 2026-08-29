---
'@objectstack/cli': minor
'@objectstack/plugin-hono-server': minor
---

feat(cli,plugin-hono-server): declare `exports` maps, and make "a published package declares one" a gate (#12879)

**BREAKING** removal of reachable subpaths, shipped as `minor` under the repo's
launch-window convention for breaking changes.

**FROM.** Both packages declared `main` + `files` and no `exports`. Under Node's
resolution that leaves every module under `dist/` importable from outside the
package, whatever the entry barrel names — `@objectstack/cli/dist/utils/lower-callables.js`
resolved, and so did every other `dist/**` path in either package. They were the
only two of the 69 publishable packages here in that shape.

**TO.** Each declares exactly the entry it means to offer, and nothing else:

```jsonc
// @objectstack/cli — ESM-only (tsc, "type": "module")
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }

// @objectstack/plugin-hono-server — dual build (tsup esm+cjs)
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.js" } }
```

The root entry resolves to exactly what `main` / `types` already pointed at, so
`import … from '@objectstack/cli'` and `require('@objectstack/plugin-hono-server')`
are byte-for-byte unchanged. `@objectstack/cli` uses `default` rather than `import`
on purpose: it is ESM-only, and an `import`-condition-only map would ALSO refuse
CJS `require()`, which is a second break this change is not making.

The CLI's `bin` is untouched. `exports` gates specifier resolution only, and the
executable is reached by path — the `objectstack` / `os` shims, or
`node node_modules/@objectstack/cli/bin/run.js` as the Dockerfiles and the
showcase Playwright config spell it.

**Migration.** A consumer that deep-imports `@objectstack/cli/dist/**` or
`@objectstack/plugin-hono-server/dist/**` now gets `ERR_PACKAGE_PATH_NOT_EXPORTED`.
Import the symbol from the package root instead. If it is not exported there, it
was never an offered surface — the deep path resolved by omission, not by
decision, and the fix is an issue naming the use case rather than a map entry
that would ratify it (ratifying accidental reachability prices every later
internal refactor of these packages at a minor bump — the trap this change
exists to close, in the other direction).

Measured before the maps were written: **one** in-repo deep importer,
`packages/qa/dogfood/test/build-shaped-artifact.ts`, which now reads the CLI's
`lowerCallables` as SOURCE by relative path — the shape the rest of that suite
already uses for package-internal reads, and one that keeps the util internal
(#6293: reach the goal without growing `@objectstack/cli`'s public entry).
`@objectstack/plugin-hono-server` had **zero**. ⚠️ Deep importers OUTSIDE this
repo cannot be measured from inside it; they are the residual risk of this
release, and they break at the import rather than silently.

**The class, not the two instances.** `pnpm check:published-files` gains a sixth
invariant — GATED: a publishable package declares an `exports` map — turning a
convention that held for 69 of 71 into a written ratchet. It carries the census
control the ruling requires: the gate reads a POSITIVE signal off every manifest,
so a broken reading (no members enumerated, a key read under the wrong name, a
parse that drops manifests) would make "nobody violates GATED" true and green.
A census that finds nobody declaring `exports` therefore fails as an INSTRUMENT
error, in its own words, and the self-test holds the floor inside a band against
the live tree in both directions.

<!-- adr-0087: not-required (no-migration-prescription) A packaging-resolution narrowing: no metadata key, spec property or authorable surface is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. The affected surface is a module specifier in a consumer's own source, the channel that reaches its author is Node's own `ERR_PACKAGE_PATH_NOT_EXPORTED` at the import, and the remedy (import from the package root, or ask for the surface) is a source edit no migration entry can perform. Measured in-repo population: one importer, changed in this PR; out-of-repo population is unmeasurable from here and is stated as the release's known risk. -->
