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
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'node_modules'],
      // Relative specifiers in the EMITTED typings get their explicit extension
      // here — objectui#5365 / #5439. A NAMED re-export through an extensionless
      // hop still declares the name under `nodenext` and silently types it `any`.
      ...createDtsExplicitExtensions({ packageDir: __dirname }),
      // A type error the declaration program already found and printed used to
      // leave `vite build` exiting 0 — objectui#5370 / #5483. This makes it fatal.
      ...createDtsFailOnTypeErrors({ packageDir: __dirname }),
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@object-ui/core': resolve(__dirname, '../core/src'),
      '@object-ui/types': resolve(__dirname, '../types/src'),
      '@object-ui/react': resolve(__dirname, '../react/src'),
      '@object-ui/components': resolve(__dirname, '../components/src'),
      '@object-ui/fields': resolve(__dirname, '../fields/src'),
      '@object-ui/plugin-grid': resolve(__dirname, '../plugin-grid/src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.tsx'),
      name: 'ObjectUIPluginDashboard',
      fileName: 'index',
    },
    rollupOptions: {
      // External: any subpath of react/react-dom, all @object-ui packages,
      // and CJS deps that internally `require("react")` — letting them
      // through would inline a CJS wrapper whose require() calls hit
      // rolldown's runtime stub and throw at runtime.
      external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname),
      output: {
        inlineDynamicImports: true,
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-grid-layout': 'ReactGridLayout',
          '@object-ui/components': 'ObjectUIComponents',
          '@object-ui/core': 'ObjectUICore',
          '@object-ui/react': 'ObjectUIReact',
          '@object-ui/types': 'ObjectUITypes',
          '@object-ui/i18n': 'ObjectUII18n',
          '@object-ui/fields': 'ObjectUIFields',
        },
      },
    },
  },
});
