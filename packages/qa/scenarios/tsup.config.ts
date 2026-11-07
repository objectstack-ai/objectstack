// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { basename } from 'node:path';

import { defineConfig, type Options } from 'tsup';

import { dropSourcesContent } from '../../../scripts/tsup-drop-sources-content.mjs';

/**
 * The build of the published package (#30915 first built it for a linked
 * consumer; it is published since the standalone CLI). A consumer that bundles
 * its own entry with tsup leaves `@objectstack/scenarios` external, so plain
 * Node must be able to load it. The `.ts` sources import with `.js`
 * specifiers, which only a TypeScript resolver follows: `dist/` is what Node
 * loads (ESM `.js`, CJS `.cjs`).
 *
 * One entry per export-map subpath. `score` is the narrow scorer
 * (`src/score/narrow.ts`): it reads `@objectstack/core` and `@objectstack/spec`
 * only. `score-full` is the whole scorer (`src/score/index.ts`), whose
 * capability-tag checks read `@objectstack/objectql` and
 * `@objectstack/plugin-sharing`. `splitting: false` keeps each entry one file,
 * so an entry's external imports are exactly the ones its own graph reaches.
 * `bin` is the command line (`src/bin.ts` over `src/runner/cli.ts`), which
 * `bin/objectstack-scenarios.js` loads; it is not an `exports` subpath. Its
 * one import of the runner CLI is lazy (`run` only) and is kept OUT of the
 * bundle: {@link binLoadsBuiltCli} points it at the built `cli` entry, so
 * `help` and `version` load `dist/bin.js` alone. The build's next step copies
 * the open card library into `dist/library/` (`scripts/pack-library.mjs`).
 *
 * Dependencies stay external (tsup's default for `dependencies`; `export`'s
 * `playwright-core` included, which it loads with a dynamic `import()`); the source
 * suites and `run-scenarios` keep reading `src/` and never this output.
 */
type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

/** `src/bin.ts`'s `import('./runner/cli.js')` → the built `./cli.js` / `./cli.cjs`, external. */
const binLoadsBuiltCli: EsbuildPlugin = {
  name: 'bin-loads-built-cli',
  setup(build) {
    const ext = build.initialOptions.format === 'cjs' ? '.cjs' : '.js';
    build.onResolve({ filter: /^\.\/runner\/cli\.js$/ }, (args) =>
      basename(args.importer) === 'bin.ts' ? { path: `./cli${ext}`, external: true } : undefined,
    );
  },
};

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    score: 'src/score/narrow.ts',
    'score-full': 'src/score/index.ts',
    runner: 'src/runner/index.ts',
    export: 'src/export/index.ts',
    bin: 'src/bin.ts',
    cli: 'src/runner/cli.ts',
  },
  esbuildPlugins: [binLoadsBuiltCli],
  tsconfig: 'tsconfig.build.json',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: !process.env.OS_SKIP_DTS,
  format: ['esm', 'cjs'],
  target: 'es2020',
  shims: true,
  esbuildOptions: dropSourcesContent,
});
