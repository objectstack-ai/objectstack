// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio builder component registration.
 *
 * Binds the `studio:builder` registry key (referenced from the framework's
 * Studio app navigation — the 「应用构建」 entry) to the builder landing page,
 * so the application builder is reachable from the moment a user logs in:
 * Home → Studio app → 应用构建 → pick/create a writable package → the
 * full-screen pillar builder at `/studio/:packageId/:tab`.
 *
 * URL shape resolved by `ComponentNavView`:
 *   studio:builder → /apps/<app>/component/studio/builder
 *
 * The standalone `/studio` route renders the same landing full-screen.
 *
 * ## Why `BuilderLanding` arrives through `lazy()`, and why that is real now
 *
 * This registration used to read `lazy(() => import('@object-ui/app-shell')
 * .then((m) => ({ default: m.BuilderLanding })))`, and that laziness never
 * existed (objectui#5486): the `import()` named the barrel this file and
 * `App.tsx` already imported statically, so it could not move a module into
 * another chunk. objectui#5486 made the registration truthful by importing the
 * component directly, and left making the builder GENUINELY lazy to a separate
 * measured card, because it meant taking the `/studio` route off the static
 * import too.
 *
 * objectui#11798 is that card. The route and this entry now both reach the
 * builder through `./components/studioBuilder`, a console-local module that
 * nothing imports statically, so the `import()` is a boundary the bundler
 * honours: `BuilderLanding`, `StudioDesignSurface` and what only they reach load
 * when a Studio screen first renders. The PR records the eager closure before
 * and after, read from the build's own `dist/eager-closure.json`.
 *
 * The registry still holds `studio:builder` from the moment the console boots,
 * so `ComponentNavView` finds it as before; the entry renders a loading line
 * until the chunk arrives, the way the sibling `registerAccountComponents.tsx`
 * does for its lazy profile page.
 */

import { lazy, Suspense } from 'react';
import { registerAppComponent } from '@object-ui/app-shell';

import { StudioBuilderLoading } from './components/StudioRoute';

const BuilderLanding = lazy(() =>
  import('./components/studioBuilder').then((m) => ({ default: m.BuilderLanding })),
);

registerAppComponent({
  ref: 'studio:builder',
  label: '应用构建',
  source: '@object-ui/console',
  // `BuilderLanding` takes no props, so the query props `ComponentNavView`
  // passes are not forwarded; it ignored them when it was registered directly.
  component: () => (
    <Suspense fallback={<StudioBuilderLoading />}>
      <BuilderLanding />
    </Suspense>
  ),
});
