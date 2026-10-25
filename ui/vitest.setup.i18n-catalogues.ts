/**
 * ObjectUI — make every built-in locale catalogue RESIDENT for DOM tests.
 *
 * ## Why this file exists (objectui#7479)
 *
 * `@object-ui/i18n` used to re-export all ten catalogues from its entry, so any
 * test that imported `I18nProvider` had every language in hand and could mount
 * in `zh` and assert `保存` on the same tick. objectui#7479 made nine of them
 * `import()`ed per locale — that is ~400 KB gzipped off every console page load
 * — and with it those assertions started reading the `en` fallback, correctly
 * and uselessly: a suite whose subject is "does the `ru` pack render Russian"
 * is not a suite about catalogue loading.
 *
 * Measured, across the DOM projects: 49 test files, 199 assertions, in 8
 * packages. Asking each of them to declare the seam would be a large diff of
 * pure ceremony AND a standing trap — the next locale test anyone writes fails
 * for a reason nothing in its own file explains.
 *
 * ## What it does, and why it is honest rather than convenient
 *
 * It puts the DOM projects back in the state a REAL production host reaches:
 * `apps/console/src/main.tsx` awaits `preloadBootstrapLocale()` before
 * `createRoot().render()` precisely so its first paint is already in the user's
 * language. This makes the catalogues resident the same way, synchronously,
 * before any test mounts anything.
 *
 * ⛔ It is not the mechanism that keeps the payload claim honest, and must
 * never be read as one. Three other things do, and none of them can be
 * satisfied by a test harness:
 *
 *   - `scripts/check-eager-locale-catalogues.mjs` — the BUILT console bundle
 *     may hold exactly one eager catalogue;
 *   - `packages/i18n/src/__tests__/entry-locale-shape-7479.test.ts` — the
 *     published entry's export shape;
 *   - `packages/i18n/src/__tests__/lazy-locale-catalogues-7479.test.tsx` —
 *     the lazy runtime itself, which takes a FRESH module graph
 *     (`vi.resetModules()`) precisely so this file cannot reach it.
 *
 * ## Cost
 *
 * ⚠️ Approximately zero against `main`, and that is the reason this lives in
 * the two DOM setups rather than in `vitest.setup.base.ts`. Every DOM test that
 * renders through `@object-ui/i18n` ALREADY loaded all ten catalogues before
 * objectui#7479 — this restores that and nothing more. `vitest.setup.base.ts`
 * is shared with the `unit` project, whose header asks it to stay cheap for
 * pure-logic node tests that pull no i18n at all; putting ~1.8 MB of
 * translation data in their path would be new cost, paid by files that never
 * render a string.
 *
 * ⇒ the ONE unit-project file that needs this calls
 * `registerBuiltInLocales()` itself, at its own module scope, and says why.
 */

import { registerBuiltInLocales } from '@object-ui/i18n/locales';

/**
 * Called from each DOM setup's own body rather than run on import, mirroring
 * `installI18nGlobalReset()`: vitest re-executes a setup FILE per test file
 * while a module it imports is evaluated once per worker, and a repo that has
 * been bitten by that distinction twice (objectui#4514, objectui#8537) should
 * not rely on it a third time. Registration is idempotent, so per-file is free.
 */
export function installBuiltInLocaleCatalogues(): void {
  registerBuiltInLocales();
}
