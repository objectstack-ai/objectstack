/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // ⚡️ DX: Fix Shadcn component imports in the monorepo source
      "@/ui": path.resolve(__dirname, "../../packages/components/src/ui"),
      "@/lib/utils": path.resolve(__dirname, "../../packages/components/src/lib/utils"),
      "@/hooks": path.resolve(__dirname, "../../packages/components/src/hooks"),
      
      "@": path.resolve(__dirname, "./src"),

      // ⚡️ DX: Map imports to source code for Hot Module Replacement
      //
      // This table IS the mechanism that lets runner boot straight from the
      // monorepo sources with NO `pnpm -w build` first — exactly what
      // `content/docs/utilities/runner.mdx` "From Source" documents
      // (`pnpm install` → `pnpm dev`). Any `@object-ui/*` specifier NOT listed
      // here falls back to Node resolution and lands on `packages/<pkg>/dist`,
      // which does not exist in a fresh install-only checkout — Vite then
      // reports "Failed to run dependency scan" and serves HTTP 500 for every
      // module on that import chain (objectui#3575).
      //
      // ⚠️ INVARIANT — the table must be the *transitive* closure, not just
      // runner's own direct imports: every `@object-ui/*` specifier imported
      // anywhere under the `src` of a package that is itself aliased here must
      // also be aliased. Adding only the directly-missing packages just moves
      // the hole one layer down (that is how #3575 happened: `plugin-kanban`
      // was aliased, but the `fields` / `plugin-detail` it imports were not).
      //
      // Re-derive the closure — run from the repo root and re-run until it
      // prints nothing; every package you add brings its own src into the
      // sweep, so this reaches a fixpoint by iteration:
      //
      //   comm -13 \
      //     <(grep -oP '"\K@object-ui/[a-z0-9-]+(?=":)' packages/runner/vite.config.ts | sort -u) \
      //     <(grep -rhP "(?<![@\w])(?:from|import)\s*\(?\s*['\"]@object-ui/" \
      //         packages/runner/src \
      //         $(grep -oP 'packages/\K[a-z0-9-]+(?=/src")' packages/runner/vite.config.ts \
      //           | sort -u | sed 's|^|packages/|;s|$|/src|') \
      //       | grep -vP '^\s*(\*|//)' \
      //       | grep -oP "['\"]\K@object-ui/[a-z0-9-]+" | sort -u)
      //
      // Anything it prints is a package importable from the aliased sources but
      // missing below — add it, then run again. Notes on the filters, each of
      // which suppresses a real false positive in this repo:
      //   - the `(?<![@\w])` lookbehind skips CSS `@import`, so doc comments
      //     quoting `@import '@object-ui/app-shell/styles.css'` are not hits;
      //     a real CSS `@import` of a workspace package must be swept for
      //     separately (there are none today);
      //   - `grep -vP '^\s*(\*|//)'` drops JSDoc/line-comment examples such as
      //     `* () => import('@object-ui/plugin-grid')` in react/LazyPluginLoader
      //     and core/registry/Registry.ts, which are documentation, not edges;
      //   - stderr is deliberately NOT redirected to /dev/null. The inner
      //     `grep -r` walks exactly the dirs this table names, so a
      //     `No such file or directory` from it is not noise: it means the
      //     *other* direction of the invariant is broken — an entry below points
      //     at a package dir that does not exist. Fix the table; never silence
      //     the message. (objectui#3593: a `data-objectql` entry outlived its
      //     package because a `2>/dev/null` here kept it quiet.)
      //
      // That second direction, checkable on its own — prints nothing when the
      // table is clean, one line per dead entry otherwise:
      //
      //   grep -oP 'packages/\K[a-z0-9-]+(?=/src")' packages/runner/vite.config.ts \
      //     | sort -u | sed 's|^|packages/|;s|$|/src|' \
      //     | while read -r d; do [ -d "$d" ] || echo "dead table entry: $d"; done
      //
      // Type-only imports are invisible to Vite's esbuild dependency scan but
      // still belong in the table — see `data-objectstack` below.
      "@object-ui/components": path.resolve(__dirname, "../../packages/components/src"),
      "@object-ui/react": path.resolve(__dirname, "../../packages/react/src"),
      "@object-ui/core": path.resolve(__dirname, "../../packages/core/src"),
      // Subpath before bare package — see the note in `apps/console/vite.config.ts`.
      "@object-ui/types/zod": path.resolve(__dirname, "../../packages/types/src/zod/index.zod.ts"),
      "@object-ui/types": path.resolve(__dirname, "../../packages/types/src"),
      "@object-ui/plugin-kanban": path.resolve(__dirname, "../../packages/plugin-kanban/src"),
      "@object-ui/plugin-charts": path.resolve(__dirname, "../../packages/plugin-charts/src"),

      // Reached transitively through the packages above — see the closure note.
      // `@object-ui/i18n`          <- react/src/index.ts, components/src/lib/close-label.tsx
      "@object-ui/i18n": path.resolve(__dirname, "../../packages/i18n/src"),
      // `@object-ui/sdui-parser`   <- components/src/renderers/layout/page.tsx
      "@object-ui/sdui-parser": path.resolve(__dirname, "../../packages/sdui-parser/src"),
      // `@object-ui/react-runtime` <- components/src/renderers/layout/react-page.tsx
      "@object-ui/react-runtime": path.resolve(__dirname, "../../packages/react-runtime/src"),
      // `@object-ui/fields`        <- plugin-kanban/src/ObjectKanban.tsx
      "@object-ui/fields": path.resolve(__dirname, "../../packages/fields/src"),
      // `@object-ui/plugin-detail` <- plugin-kanban/src/ObjectKanban.tsx
      "@object-ui/plugin-detail": path.resolve(__dirname, "../../packages/plugin-detail/src"),
      // `@object-ui/providers`     <- fields/src/widgets/{FileField,ImageField}.tsx (2nd layer)
      "@object-ui/providers": path.resolve(__dirname, "../../packages/providers/src"),
      // `@object-ui/permissions`   <- plugin-detail/src/DetailView.tsx et al. (2nd layer)
      "@object-ui/permissions": path.resolve(__dirname, "../../packages/permissions/src"),
      // `@object-ui/data-objectstack` <- react/src/context/AppShellContext.tsx, `import type`
      // only. esbuild erases it, so Vite's dependency scan never flags it — it is
      // in the closure by the invariant above, and aliased so that the day the
      // import turns into a value import the dev server does not break.
      "@object-ui/data-objectstack": path.resolve(__dirname, "../../packages/data-objectstack/src"),
    },
  },
  build: {
    // The alias table above is NOT scoped by `command`, so it applies to
    // `vite build` too. That is deliberate and matches apps/console: resolving
    // the plugin packages to src keeps the ComponentRegistry singleton
    // single-instanced, which importing their prebuilt dist/ bundles does not
    // guarantee (duplicate registries surface as "Unknown component type").
    //
    // Measured consequence of completing the table (objectui#3575): once
    // `@object-ui/fields` & co. are bundled from src, the per-icon chunks that
    // `components/src/lib/lazy-icon.tsx` creates via `lucide-react/dynamic.mjs`
    // stop being inlined — this build goes from 10 assets to 1776, ~1761 of
    // them sub-2KB icon micro-chunks. That is exactly the shape apps/console
    // has ("1700+ icon chunks", see its build config).
    //
    // Vite's default `modulePreload: true` then emits a preload link for every
    // one of them: index.html measured 546 B -> 145 KB with 1765
    // `rel="modulepreload"` links, so the browser eagerly fetches all the icon
    // chunks on first paint and the lazy split becomes a pessimisation.
    // apps/console disables it for this exact reason; runner needs the same.
    modulePreload: false,
  },
})
