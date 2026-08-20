// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';
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

// Generate DTS separately to avoid memory issues
const isDts = process.env.BUILD_DTS === 'true';

export default defineConfig({
  entry: entries,
  splitting: false,
  sourcemap: true,
  clean: !isDts, // Only clean on main build, not on DTS pass
  dts: !isDts ? false : { only: true }, // Only generate DTS on explicit pass, without JS
  format: ['esm', 'cjs'],
  target: 'es2020',
  treeshake: true,
  esbuildPlugins: [pureSchemaConstruction],
});
