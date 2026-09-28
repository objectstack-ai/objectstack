// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineConfig, type Options } from 'tsup';
import type { Plugin } from 'esbuild';

import { dropSourcesContent } from '../../scripts/tsup-drop-sources-content.mjs';

/**
 * [#10031] Annotate deferred schema construction as pure IN THE EMITTED
 * BUNDLES, so a CONSUMER's bundler may drop the schema consts its entry never
 * reaches (`sideEffects: false` in package.json is the other half — it lets a
 * wholly-unreached module go; this lets an unreached top-level const go).
 *
 * Why a load-time transform and not source annotations: esbuild PRESERVES
 * PURE-annotation comments (the at-double-underscore-PURE marker) from its
 * input into the output but does NOT re-emit them for calls marked via the
 * `pure` option (measured on esbuild 0.28.2 — `pure` only feeds its own
 * tree-shaking), so the annotation has to exist at parse time. Injecting it
 * here keeps the ~600 call sites out of the source diff and applies uniformly
 * — including to files a source sweep could not touch while sibling claims
 * hold them.
 *
 * Why the marked calls are really pure: `lazySchema(fn)` allocates a Proxy and
 * defers `fn` to first property access — dropping an unused one loses nothing
 * observable (per-entry runtime probe on #10031: no spec module mutates
 * globals/env/registries at module scope; the one former module-scope effect,
 * the metadata-url-spelling agreement assertion, is now the build-time
 * `check:meta-url-spelling` gate).
 *
 * The word-boundary regex cannot hit the import specifier (`lazySchema,` /
 * `lazySchema }` carry no paren), the declaration (its token is
 * `lazySchema<T…>(`), or strings/comments in any way that survives bundling
 * (non-annotation comments are dropped from the bundle output).
 */
const pureSchemaConstruction: Plugin = {
  name: 'pure-schema-construction',
  setup(build) {
    // The three marked constructors, each with its purity argument:
    //  - `lazySchema(fn)` allocates a Proxy, defers `fn` to first use;
    //  - `strictObject(shape, …)` builds a closed zod object (construction
    //    only — the unknown-key error closure runs at parse time, not now);
    //  - `defineForm(cfg)` parses STATIC author-time data through
    //    `FormViewSchema` — pure computation whose only observable effect is a
    //    throw on invalid static input, which this package's own build
    //    (`gen:schema` under OS_EAGER_SCHEMAS) and tests still exercise.
    const PURE_CALL = /\b(lazySchema|strictObject|defineForm)\(/g;
    build.onLoad({ filter: /src[\\/].*\.(ts|mts)$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      PURE_CALL.lastIndex = 0;
      if (!PURE_CALL.test(source)) return undefined;
      // Line-based on purpose: a marked name mentioned inside a JSDoc block
      // must NOT receive an annotation — a comment injected inside a comment
      // terminates the outer one and breaks the parse (measured on
      // shared/strict-object.ts:48). Comment lines start with `*`, `//` or
      // `/*` after indentation; every real call site in the tree starts with
      // code (surveyed: 1731 code lines vs 9 comment mentions), and no code
      // line carries a marked token in a trailing comment.
      const contents = source
        .split('\n')
        .map((line) => {
          const lead = line.trimStart();
          if (lead.startsWith('*') || lead.startsWith('//') || lead.startsWith('/*')) return line;
          return line.replace(PURE_CALL, '/* @__PURE__ */ $1(');
        })
        .join('\n');
      return { contents, loader: 'ts' };
    });
  },
};

const entries = [
  'src/index.ts',
  'src/data/index.ts',
  'src/system/index.ts',
  'src/kernel/index.ts',
  'src/automation/index.ts',
  'src/api/index.ts',
  // The API-protocol declarations that embed the ASSEMBLED package body, split
  // off `./api` so the browser-facing entry stops linking the whole metadata
  // vocabulary and the datasource/driver validators (maintainer ruling on
  // #18576, letter B). See `src/api-assembled/index.ts`.
  'src/api-assembled/index.ts',
  'src/ui/index.ts',
  'src/ai/index.ts',
  'src/security/index.ts',
  'src/contracts/index.ts',
  'src/integration/index.ts',
  'src/studio/index.ts',
  'src/marketplace/index.ts',
  'src/qa/index.ts',
  'src/identity/index.ts',
  'src/shared/index.ts',
  // [#10096] Schema-free fine-grained entry for the `/meta` URL-spelling
  // contract — per-entry self-contained bundling is unchanged (#8133 stays on
  // hold); this entry's whole graph is two pure modules, so "self-contained"
  // costs a few hundred bytes here by construction.
  'src/meta-spelling/index.ts'
];

/**
 * [#11072] The entries whose module graph reaches the driver-config
 * validators, i.e. the entries whose Node bundles statically import
 * `pg-connection-string` (measured per bundle head; `./shared` left the set
 * when its graph stopped reaching the driver schemas). Each gets a SECOND,
 * `browser`-conditioned output under `dist/browser/` in which the postgres
 * URL refinement's pg-grammar arm is swapped for its dependency-free browser
 * twin — `pg-connection-string`'s `parse` statically resolves `require('fs')`
 * and breaks every browser bundler that reaches it (maintainer ruling
 * 2026-08-22, Option A: declare the boundary in the exports map; Node-side
 * behaviour and the Node outputs are untouched).
 *
 * Keep this list equal to the poisoned set: `check:browser-reachable-entries`
 * refuses a `browser`-conditioned bundle that still links the parser or any
 * Node builtin, refuses a NON-conditioned bundle that links either (a browser
 * bundler resolves those very files), and carries a positive control on the
 * Node side — so both drift directions go red at this producer.
 */
const browserConditionedEntries = [
  'src/index.ts',
  'src/data/index.ts',
  'src/system/index.ts',
  'src/kernel/index.ts',
  // `./api-assembled` carries the package read API's assembled-stage
  // declarations: their record body reaches the datasource declaration, and
  // with it the driver-config validators. Same seam, same swap, same
  // degradation the 2026-08-22 ruling accepted — not a second mechanism.
  //
  // ⛔ `./api` is NOT here any more, and must not come back. It joined this set
  // when those declarations lived in it; the #18576 ruling (letter B) moved
  // them to `./api-assembled`, so `./api`'s graph no longer reaches the pg
  // grammar and its ordinary bundles are what a browser bundler loads — which
  // `check:browser-reachable-entries` rule 2 now judges directly.
  'src/api-assembled/index.ts',
];

/**
 * [#11072] Resolve the pg-grammar arm to its browser twin — the whole
 * mechanism by which the `browser`-conditioned bundles exclude the
 * driver-config validators' Node-only dependency.
 *
 * Keyed to the seam module's specifier, NOT to `pg-connection-string`
 * itself, on purpose: a blanket alias of the package would silently degrade
 * any FUTURE import site nobody audited, whereas this swap covers exactly
 * the one audited seam and a new direct import lands in the browser bundles
 * where `check:browser-reachable-entries` refuses it at this producer.
 */
const swapServerOnlyGrammarArm: Plugin = {
  name: 'swap-server-only-grammar-arm',
  setup(build) {
    build.onResolve({ filter: /[\\/]pg-url-grammar\.server$/ }, (args) => ({
      path: join(dirname(args.importer), 'pg-url-grammar.browser.ts'),
    }));
  },
};

/**
 * Generate DTS separately to avoid memory issues — this pass is by far the
 * heaviest thing this package's build does, and `package.json` runs it under an
 * explicit `--max-old-space-size` for a reason worth stating where the next
 * author will look.
 *
 * ⚠️ THE HEAP CEILING MUST FIT THE SMALLEST CONTAINER THIS BUILD RUNS IN.
 * `--max-old-space-size` is a promise to V8 that the memory is there: below it,
 * V8 defers major GCs and lets the resident set grow. A ceiling ABOVE the
 * container's memory therefore does not "allow a big build", it converts a
 * recoverable JS heap error into a kernel SIGKILL — the process is killed at
 * the container limit long before V8 ever considers the ceiling reached, and
 * exit 137 carries no diagnostic at all.
 *
 * That is not hypothetical: at a 12288 ceiling this pass was killed on every
 * Vercel docs deploy for two days (`@objectstack/spec:build` exit 137), because
 * the docs site is built by `turbo run build --filter=@objectstack/docs` inside
 * one fixed-memory build container and this package is its only workspace
 * dependency — so this pass meets the container's limit ALONE, with no
 * parallelism to cap.
 *
 * 6144 is the largest ceiling whose WORST case still fits: V8 cannot exceed
 * it, and the pass's non-heap overhead measures ~250 MB, so the bound is
 * ~6.4 GB inside an 8 GB container.
 *
 * WHY THE PASS IS THIS HEAVY: ONE `ts.Program` PER ENTRY. tsup 8.5.1 runs the
 * pass through its bundled rollup-plugin-dts 6.1.1, whose `createPrograms`
 * groups entries by a directory key. tsup always passes the tsconfig path, and
 * on that path every entry after the first is keyed by its OWN directory (the
 * same code is in rollup-plugin-dts 6.5.1). So each entry above gets its own
 * program, which parses, binds and emits its whole reachable graph again: the
 * peak grows with entries × graph, not with the graph. ⇒ Every entry added to
 * `entries` adds a program to this pass.
 *
 * `noCheck`: rollup-plugin-dts forces `noEmitOnError`, which made every one of
 * those programs also semantically CHECK each file it emitted — a type check
 * the `typecheck` script (`tsc --noEmit` over this same tsconfig, run by the
 * required `TypeScript Type Check` job) already performs once. `noCheck` drops
 * only that duplicate. Syntactic, option, global and declaration diagnostics
 * still fail the pass, so a declaration that cannot be emitted still stops the
 * build; a plain type error in `src/` is `typecheck`'s to report, not this
 * pass's.
 *
 * Measured on 8cdbe0c6e5's source, DTS pass alone at the 6144 ceiling, inside a
 * cgroup capped at 8192 MB. Live heap is the largest heap V8 kept after a
 * mark-compact (`--trace-gc`); peak RSS is the peak anonymous RSS of the whole
 * process tree:
 *
 *     pass                              live heap   peak RSS   wall
 *     duplicate check on (before)         5658 MB    6177 MB    181-194s
 *     noCheck (this config)               5083 MB    5889 MB    134s
 *     one program, grouping patched       1379 MB    3749 MB     53s
 *     `tsc --noEmit`, whole package       1103 MB    1149 MB     18s
 *
 * The third row was measured with the grouping patched in a copy of tsup
 * outside this tree. It shows what cutting the program count is worth.
 *
 * NOT BYTE-STABLE: this pass does not emit the same bytes twice. TypeScript
 * prints union members, and the members of object types derived from them, in
 * type-creation order, and that order follows emit order. Three runs of the
 * same commit gave three different trees, and rollup's content-hashed chunk
 * names moved with them. Once union and property-signature order are
 * normalised, all three runs and the `noCheck` run are the same tree (128
 * files, 30389539 bytes). ⇒ Compare two declaration trees in such an
 * order-insensitive form, never by a byte digest.
 *
 * If this pass starts failing with `ERR_WORKER_OUT_OF_MEMORY`, the live type
 * graph has outgrown 6144 — that is a loud, actionable failure and the point of
 * the ceiling. ⛔ Do not "fix" it by raising the number past what the build
 * container has; that trades this error back for the silent exit 137. Cut the
 * program count, shrink the graph, or split the pass across entries. Cutting
 * the count moves statement order and one chunk name beyond the noise above. A
 * split redraws the shared chunks. Either one changes what publishes, so it
 * needs that reviewed first.
 */
const isDts = process.env.BUILD_DTS === 'true';

const mainConfig: Options = {
  entry: entries,
  splitting: false,
  sourcemap: true,
  clean: !isDts, // Only clean on main build, not on DTS pass
  // Only generate DTS on the explicit pass, without JS; `noCheck` per the docblock above.
  dts: !isDts ? false : { only: true, compilerOptions: { noCheck: true } },
  format: ['esm', 'cjs'],
  target: 'es2020',
  treeshake: true,
  esbuildPlugins: [pureSchemaConstruction],
  esbuildOptions: dropSourcesContent,
};

/**
 * The `browser`-conditioned outputs (#11072) — same entry shapes, same
 * formats, same target as the main pass, differing ONLY in the grammar-arm
 * swap and the `dist/browser/` outDir. No DTS pass of its own: the browser
 * build's public API is identical by construction (the swapped module keeps
 * the contract), so the exports map points its `browser.types` at the main
 * build's declarations.
 */
const browserConfig: Options = {
  entry: browserConditionedEntries,
  outDir: 'dist/browser',
  splitting: false,
  sourcemap: true,
  clean: false, // dist was cleaned (or preserved) by the main pass
  dts: false,
  format: ['esm', 'cjs'],
  target: 'es2020',
  treeshake: true,
  esbuildPlugins: [pureSchemaConstruction, swapServerOnlyGrammarArm],
  esbuildOptions: dropSourcesContent,
};

// The DTS pass re-runs only the main config (declarations once, per entry);
// the JS pass emits the Node outputs and then the browser-conditioned ones.
export default defineConfig(isDts ? mainConfig : [mainConfig, browserConfig]);
