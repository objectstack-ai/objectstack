// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio builder component registration.
 *
 * Binds the `studio:builder` registry key, referenced from the framework's
 * Studio app navigation (the 「应用构建」 entry,
 * `/apps/<app>/component/studio/builder`), to Studio's entry.
 *
 * It used to draw the Studio home's package cards inside the app shell. That
 * home was removed (objectstack#36908, epic #36890 decision 9): Studio is
 * entered from an app or from Setup → Packages. The entry stays reachable from
 * this nav item by forwarding to bare `/studio`, whose ONE owner
 * (`StudioRoute`) decides where it opens: the package the author was last in,
 * else the package list. A second copy of that decision here would drift from
 * it.
 *
 * The registry holds `studio:builder` from the moment the console boots, so
 * `ComponentNavView` finds it as before. Forwarding costs no chunk: the
 * builder loads with the `/studio` route (objectui#11798).
 */

import { Navigate } from 'react-router-dom';
import { registerAppComponent, studioLandingPath } from '@object-ui/app-shell';

registerAppComponent({
  ref: 'studio:builder',
  label: '应用构建',
  source: '@object-ui/console',
  // Takes no props: the query props `ComponentNavView` passes are not forwarded.
  component: () => <Navigate to={studioLandingPath()} replace />,
});
