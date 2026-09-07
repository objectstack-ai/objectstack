---
"@objectstack/spec": patch
"@objectstack/cli": patch
"@objectstack/core": patch
"@objectstack/types": patch
"@objectstack/metadata": patch
"@objectstack/metadata-core": patch
"@objectstack/metadata-fs": patch
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/runtime": patch
"@objectstack/lint": patch
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-cluster": patch
"@objectstack/service-cluster-redis": patch
"@objectstack/service-datasource": patch
"@objectstack/account": patch
"@objectstack/setup": patch
"@objectstack/studio": patch
---

Published `.js.map` files no longer embed the complete original source text (`sourcesContent`) — comments included. `sourcemap: true` was esbuild shorthand, and esbuild's own default for `sourcesContent` is `true`; nobody had decided to publish every package's full source (including `@internal`/test-only comments) to npm inside its source maps, it fell out of a default nobody had looked at. Measured before this change: 55 of 57 publishable packages shipped embedded source text, and maps were roughly half of `@objectstack/spec`'s published bytes.

`sourcesContent: false` is now set at one shared place (`scripts/tsup-drop-sources-content.mjs`, wired into every `tsup.config.ts` via tsup's `esbuildOptions` hook — most packages build through the repo-root config directly and pick this up with no config change of their own). `mappings` are untouched, so stack-trace positions still resolve correctly to the original file/line/column; only the embedded source text is gone.

`@objectstack/cli` (built with `tsc`, not `tsup`) never embedded source text to begin with — its maps' `sources` entries point at `src/**` paths that are not part of the published tarball either way. That is not a defect unique to `cli`: every `tsup`-built package's `sources` entries are `../src/**`-relative paths that are equally outside `files: ["dist", …]`, and were merely masked by the embedded content that just stopped shipping. Shipping `src/**` in `files[]` to make `sources` resolve was rejected — it would put most of the removed bytes straight back. So `cli`'s maps are left exactly as `tsc` emits them: this is now the fleet-consistent shape (accurate `mappings`, non-resolving-but-honest `sources` labels, no embedded text), not an outlier.

A new gate, `pnpm check:sourcemap-no-sources-content`, sweeps every built, non-private package's `dist/**/*.map` and fails if any of them carries a non-empty `sourcesContent` array — so a future `tsup.config.ts` that skips the shared hook, or a toolchain upgrade that changes esbuild's default back, is caught rather than silently re-publishing source text.
