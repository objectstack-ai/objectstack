// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #28450 — an app's `landing` entry may not name a `url` navigation entry.
// The console's app-root landing is an in-app redirect and a `url` entry opens
// an external address, so such an entry landed nobody and the reader opened on
// the first navigation item with no word said. The spec now refuses it at
// parse beside `group`, `separator` and `action`. Semantic only: which in-app
// entry that audience should open on is the author's choice, so no conversion
// maps it. `landing` arrived after `@objectstack/spec` 18.2.0, so only an app
// written against an unreleased build can carry one.
export const entry: SemanticMigration = {
  id: 'app-landing-url-item-refused',
  surface: 'an app\'s `landing[N].item` naming a navigation entry of `type: \'url\'` (in the app\'s own '
    + '`navigation` or any `areas[].navigation`, at any depth)',
  replacement: 'name an in-app entry the app declares instead: an `object`, `page`, `dashboard`, `report`, '
    + '`component` or `doc` entry, e.g. `{ item: \'nav_help_site\', visible: … }` naming a `url` entry becomes '
    + '`{ item: \'nav_help\', visible: … }` naming a `page` entry that carries the same help; or drop the '
    + 'landing entry, and that audience opens on the first navigation item by `order`.',
  reason: 'A landing decides where a reader opens inside the app, and the console\'s app-root landing is an '
    + 'in-app redirect: a `url` entry opens an external address, so the console found no in-app route for it and '
    + 'passed the entry over in silence, which is the silent fallback `landing` was designed to refuse. '
    + '`checkAppLandingItems` now refuses a `url` target at `landing.N.item`, on `AppSchema` and on objectui\'s '
    + '`app` node, and its message no longer lists `url` among the entries that open something. No conversion is '
    + 'registered: which in-app entry the audience should open on is the author\'s choice.',
  acceptanceCriteria: 'Run `objectstack validate`: it reports no finding at any app\'s `landing.N.item`. Sign in '
    + 'as a member of each audience the landing names, open the app root, and confirm each opens on its entry.',
};
