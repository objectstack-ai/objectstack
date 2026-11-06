// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';

import { dropSourcesContent } from '../../../scripts/tsup-drop-sources-content.mjs';

/**
 * A minimal build for a PRIVATE package (#30915): it is never published, but a
 * consumer that links the framework tree and bundles its own entry with tsup
 * leaves `@objectstack/scenarios` external, so plain Node must be able to load
 * it. The `.ts` sources import with `.js` specifiers, which only a TypeScript
 * resolver follows: `dist/` is what Node loads (ESM `.js`, CJS `.cjs`).
 *
 * One entry per export-map subpath. `score` is the narrow scorer
 * (`src/score/narrow.ts`): it reads `@objectstack/core` and `@objectstack/spec`
 * only. `score-full` is the whole scorer (`src/score/index.ts`), whose
 * capability-tag checks read `@objectstack/objectql` and
 * `@objectstack/plugin-sharing`. `splitting: false` keeps each entry one file,
 * so an entry's external imports are exactly the ones its own graph reaches.
 *
 * Dependencies stay external (tsup's default for `dependencies`; `export`'s
 * `playwright-core` included, which it loads with a dynamic `import()`); the source
 * suites and `run-scenarios` keep reading `src/` and never this output.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    score: 'src/score/narrow.ts',
    'score-full': 'src/score/index.ts',
    runner: 'src/runner/index.ts',
    export: 'src/export/index.ts',
  },
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
