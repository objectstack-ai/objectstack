/**
 * ObjectUI — heavy DOM test setup (the `dom-heavy` project + apps/console)
 *
 * For tests that render through the ComponentRegistry. Pulls in
 * @object-ui/components, @object-ui/fields, @object-ui/plugin-dashboard and
 * @object-ui/plugin-grid for their side-effect registrations — and registers
 * nothing itself, so what a test sees is what the app boots with.
 *
 * This graph is expensive (~3.3s/file under `isolate: true`), so it is NOT the
 * default. Most `dom` tests use the trimmed `vitest.setup.dom-light.tsx`; only
 * the files listed in `heavyDomTests` (vitest.config.mts) run here. Pure-logic
 * unit tests use `vitest.setup.base.ts`.
 */

import './vitest.setup.base';
import { installBuiltInLocaleCatalogues } from './vitest.setup.i18n-catalogues';
import '@testing-library/jest-dom';
// objectui#7479 — the nine non-`en` locale catalogues are `import()`ed on
// demand now, so a suite that mounts a provider in `zh` and asserts on the same
// tick would read the `en` fallback. This puts the DOM projects in the state
// `apps/console/src/main.tsx` reaches by awaiting `preloadBootstrapLocale()`
// before its first render. ⛔ Read the setup module's header before treating
// this as the thing that keeps the payload claim honest — it is not, and it
// names the three mechanisms that are.
installBuiltInLocaleCatalogues();
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// With `pool: 'threads'` + `isolate: false`, modules (including
// @testing-library/react) are cached across test files in the same worker. RTL
// installs its auto-cleanup `afterEach` only on first import, which means only
// the first file in each worker gets cleaned up — subsequent files accumulate
// DOM nodes between tests, producing the cascade of "Found multiple elements"
// failures. Registering cleanup here ensures every test gets an unmount.
afterEach(() => {
  cleanup();
});

// jsdom does not implement Element.prototype.scrollIntoView; some components
// (e.g. LookupField keyboard navigation) call it inside effects. Polyfill as
// a no-op so component tests don't throw inside React's commit phase.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Import packages to register components (side-effect imports)
import '@object-ui/components'; // Register all ObjectUI components
import '@object-ui/fields'; // Register field widgets
import '@object-ui/plugin-dashboard'; // Register dashboard components
import '@object-ui/plugin-grid'; // Register grid components

// This file used to re-register `text`, `email`, `password`, `textarea`,
// `image`, `html`, `avatar`, `select`, `slider` and `grid` by hand — ~380 lines
// of renderer copied from @object-ui/components — to undo bare-name fallbacks
// that @object-ui/fields and the plugins were claiming as a side effect of
// loading after it.
//
// Both sides now register those under their own namespace with
// `skipFallback: true`, so nothing overwrites the `ui:` originals and the
// re-registration is obsolete. Keeping it was not free: the copies carried no
// `inputs` and no `defaultProps`, so inside this environment four curated
// public blocks (`text`, `image`, `html`, `grid`) reported an empty
// configuration surface while the real registrations declare one. Any
// assertion about the contract read that as fact.
//
// If a bare name needs overriding again, override it — but carry the original
// meta across, or the registry that tests see stops matching the one that
// ships.

