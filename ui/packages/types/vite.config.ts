import path from 'path';
import { defineConfig } from 'vite';

// objectui#3240 — with the per-package `vitest.config.*` files gone, Vitest
// launched from THIS directory falls back to this file and uses it as its test
// config. Guard that entry point (route 4 in
// scripts/vitest-invocation-guard.mjs, which carries the mechanism and the
// measurement). Gated on `VITEST` because the same file is the BUILD config:
// Vitest sets that variable when it loads a config, `vite build` does not, so
// a test run is refused and a build never is.
import {
  assertCanonicalVitestInvocation,
  repoRootFrom,
} from '../../scripts/vitest-invocation-guard.mjs';

if (process.env.VITEST) {
  assertCanonicalVitestInvocation({ repoRoot: repoRootFrom(import.meta.url) });
}

/**
 * The `./zod` subpath, built as ONE module (objectui#8598).
 *
 * ## What this exists to close
 *
 * `packages/types` declares `"sideEffects": false`, and `src/zod/index.zod.ts`
 * fills the node recursion point (objectui#8344) as the initializer of its
 * `AnyComponentSchema` const. `tsc` emits that barrel as a module whose only
 * other content is re-exports — so a bundler resolving
 * `import { CardSchema } from '@object-ui/types/zod'` follows the re-export to
 * `dist/zod/layout.zod.js`, needs NOTHING from the barrel's own body, and the
 * flag lets it drop that body whole. The fill goes with it and every child slot
 * silently reverts to the pre-#8344 `BaseSchemaCore` arm. Measured on
 * `c4326fe0a1fe1de666cc81c793aed4e4722649b1` (Vite 8.2.1 / rolldown 1.2.3, `zod`
 * and `@objectstack/spec` external, es, unminified consumer entry): a barrel
 * entry importing only `CardSchema` ACCEPTED a nested off-spec `icon` node.
 *
 * Bundling the subpath removes the module boundary the drop needs. `CardSchema`
 * is then DEFINED in the module the consumer imports, so that module is included
 * rather than skipped, and the fill survives with it: `z.union` keeps its option
 * array by reference (the assumption `defineNodeComponentUnion` asserts at load),
 * the array is handed to an external `z.union` call, and the write into slot 0 is
 * therefore an effect the tree-shaker must keep.
 *
 * ## Why it overwrites `dist/zod/index.zod.js` in place
 *
 * `tsc` runs FIRST (`"build": "tsc && vite build && …"`) and emits every file in
 * `dist/`, typings included; this build then replaces exactly one of them. That
 * keeps the shape every gate already reads: `check:dist-completeness` derives its
 * expected set from tsconfig and only counts PRESENCE, the `./zod` typings stay
 * `tsc`'s own, and no `exports` / `files` / `sideEffects` field moves.
 *
 * ⛔ `emptyOutDir` MUST stay false — and what a flip actually costs is stated
 * here exactly, because this comment used to overstate it (objectui#8712).
 * `outDir` is INSIDE the project root, so Vite's default is to empty it, and
 * `tsc` has already written all of `dist/` by the time this runs. Measured on
 * `2596b1b85` with `vite build --emptyOutDir`: `dist/` went 128 files → 89, all
 * of the loss inside `dist/zod/` (40 → 1) — the `./zod` typings and every
 * per-category zod module. So the flip empties that ONE directory rather than
 * the published package as a whole, and it is not silent: `vite build` itself
 * exits 0, and the build script's third step then reds with
 * `missing 39 of 128 files tsc emits`. A gate one step later is still a
 * published package built wrong, so the setting stays false.
 */
export default defineConfig({
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/zod'),
    // ⛔ See above: this is not a formality.
    emptyOutDir: false,
    // `tsc` emits at the root tsconfig's `target` (ES2020). The bundle is a
    // replacement for one of its outputs, so it is emitted at the same level.
    target: 'es2020',
    sourcemap: false,
    // The rest of `dist/` is unminified `tsc` output. A minified barrel beside
    // it would be a published file no reviewer can read or diff, for bytes the
    // consumer's own bundler removes anyway.
    minify: false,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/zod/index.zod.ts'),
      formats: ['es'],
      fileName: () => 'index.zod.js',
    },
    rollupOptions: {
      // Everything this package declares as a dependency stays external, so the
      // bundle is this package's own bytes: `zod` and `@objectstack/spec` are
      // resolved by the consumer, exactly as they are in the `tsc` output.
      external: (id: string) => !/^[./]/.test(id) && !id.startsWith(import.meta.dirname),
    },
  },
});
