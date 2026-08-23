// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineConfig, type Options } from 'tsup';
import type { Plugin } from 'esbuild';

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
  'src/ui/index.ts',
  'src/ai/index.ts',
  'src/security/index.ts',
  'src/contracts/index.ts',
  'src/integration/index.ts',
  'src/studio/index.ts',
  'src/cloud/index.ts',
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
  'src/cloud/index.ts',
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

// Generate DTS separately to avoid memory issues
const isDts = process.env.BUILD_DTS === 'true';

const mainConfig: Options = {
  entry: entries,
  splitting: false,
  sourcemap: true,
  clean: !isDts, // Only clean on main build, not on DTS pass
  dts: !isDts ? false : { only: true }, // Only generate DTS on explicit pass, without JS
  format: ['esm', 'cjs'],
  target: 'es2020',
  treeshake: true,
  esbuildPlugins: [pureSchemaConstruction],
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
};

// The DTS pass re-runs only the main config (declarations once, per entry);
// the JS pass emits the Node outputs and then the browser-conditioned ones.
export default defineConfig(isDts ? mainConfig : [mainConfig, browserConfig]);
