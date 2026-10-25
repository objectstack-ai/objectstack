import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import path from 'path';

import { createDtsExplicitExtensions } from '../../scripts/vite-dts-explicit-extensions.ts';

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
      compilerOptions: { rootDir: path.resolve(__dirname, 'src'), paths: {} },
      aliasesExclude: [/^@object-ui\//],
      // Relative specifiers in the EMITTED typings get their explicit extension
      // here — objectui#5365 / #5439. A NAMED re-export through an extensionless
      // hop still declares the name under `nodenext` and silently types it `any`.
      ...createDtsExplicitExtensions({ packageDir: __dirname }),
      // Deliberately NOT spreading `createDtsFailOnTypeErrors` here, unlike the
      // other 21 `dts(` call sites — objectui#5483. This package's build script is
      // `tsc && vite build && node scripts/build-css.mjs`, and that leading `tsc` is
      // not redundant: it is what makes a type error fatal for this package, and it
      // exits non-zero BEFORE `vite build` ever runs, so a dts-leg exit code could
      // never be what decides this build. Drop the `tsc &&` prefix and this package
      // owes the factory instead — `scripts/__tests__/vite-dts-wiring-ratchet.test.ts`
      // reads that script and fails here if the prefix goes away.
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@object-ui/core': path.resolve(__dirname, '../core/src'),
      // Subpath before bare package — see the note in `apps/console/vite.config.ts`.
      '@object-ui/types/zod': path.resolve(__dirname, '../types/src/zod/index.zod.ts'),
      '@object-ui/types': path.resolve(__dirname, '../types/src'),
      '@object-ui/react': path.resolve(__dirname, '../react/src'),
      '@object-ui/components': path.resolve(__dirname, '../components/src'),
      '@object-ui/fields': path.resolve(__dirname, './src'), // Self-reference for vitest.setup.tsx
      '@object-ui/plugin-dashboard': path.resolve(__dirname, '../plugin-dashboard/src'),
      '@object-ui/plugin-grid': path.resolve(__dirname, '../plugin-grid/src'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      name: 'ObjectUIFields',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname),
      output: {
        inlineDynamicImports: true,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          '@object-ui/components': 'ObjectUIComponents',
        },
      },
    },
  },
});
