import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

import { createDtsExplicitExtensions } from '../../scripts/vite-dts-explicit-extensions.ts';
import { createDtsFailOnTypeErrors } from '../../scripts/vite-dts-fail-on-type-errors.ts';

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

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      // Clear the inherited tsconfig `paths` so the dts type program resolves
      // `@object-ui/*` to each dependency's published `dist/*.d.ts` (external)
      // instead of following the workspace `src` aliases into files outside
      // this package's `rootDir` — which would emit TS6059 rootDir errors.
      compilerOptions: { rootDir: resolve(__dirname, 'src'), paths: {} },
      aliasesExclude: [/^@object-ui\//],
      include: ['src'],
      // Relative specifiers in the EMITTED typings get their explicit
      // extension here — objectui#5365. `tsc` copies a module specifier into
      // the declaration verbatim, so `export * from './ui'` shipped
      // extensionless and no consumer on `moduleResolution: nodenext` could
      // follow it; every named export of this package read as missing. The
      // `.js` never had the defect because rolldown resolves the same
      // specifier away, which is also why `pnpm check:esm-specifiers` — a
      // verdict about specifier-preserving `.js` builds — correctly never
      // scanned this package. See the module header for the full argument.
      ...createDtsExplicitExtensions({ packageDir: __dirname }),
      // A type error the declaration program already found and printed used to
      // leave `vite build` exiting 0 — objectui#5370. This makes it fatal.
      // Disjoint hooks from the factory above (`afterDiagnostic` vs
      // `beforeWriteFile`/`afterBuild`), so the two spreads cannot overwrite
      // each other; a future factory that overlaps must be composed, not
      // spread, because a duplicate key silently keeps the last one.
      ...createDtsFailOnTypeErrors({ packageDir: __dirname }),
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ObjectUILayout',
      fileName: 'index',
    },
    rollupOptions: {
      external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
