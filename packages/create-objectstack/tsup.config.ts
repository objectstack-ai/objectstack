// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'tsup';
import { cpSync } from 'fs';

export default defineConfig({
  // `index.ts` is the CLI entry point — executed for its side effects via
  // `bin/create-objectstack.js` — and stays undeclared. `created-summary.ts`
  // is the one file this package exposes as a library subpath (see the
  // `exports` map in package.json) so `@objectstack/cli`'s `init` command can
  // reuse the same "walk the finished directory" summary renderer instead of
  // carrying a second copy of it.
  entry: ['src/index.ts', 'src/created-summary.ts'],
  format: ['esm'],
  clean: true,
  shims: true,
  dts: { entry: ['src/created-summary.ts'] },
  onSuccess: async () => {
    // Copy template files to dist/ so they sit alongside the bundled JS
    cpSync('src/templates', 'dist/templates', { recursive: true });
  },
});
