// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #17063 (maintainer ruling, decision batch #107 item 1) — the D3 entry of the
// `view-page-mount-removed` family (ruling B on #17152: one D3 entry per
// retirement family, even when D2 is lossless). Registered keys:
// `ui/ListView:pageName` and `ui/ObjectListView:pageName`, plus the `'page'`
// value of the list-view `type` enum. The strip lands every view on what it
// already drew — an empty grid — which is exactly why it cannot be the end of
// the migration.
export const entry: SemanticMigration = {
  id: 'list-view-page-mount-retired',
  surface: 'view.list / view.listViews.* — the list-view type page and its pageName binding',
  replacement: 'Publish the page and give the app a navigation item for it — '
    + '`{ type: \'page\', pageName: \'<page_name>\' }` under the app `navigation`, the page mount '
    + 'that has always rendered. Keep the list view only if it should draw rows of its object, as '
    + 'a `grid` or one of its siblings.',
  reason: 'The D2 conversion `view-page-mount-removed` deletes `type: \'page\'` (the schema default '
    + 'then parses the view as `grid`) and `pageName` from every view payload in `stack.views[]`, '
    + 'in all three persisted spellings, and the delete is lossless in pixels: no renderer ever '
    + 'routed the page member, so a page view has always drawn an empty grid, and it still does. '
    + 'The author wanted a PAGE in front of users at that place in the app, and the view never '
    + 'showed it. Whether to reach the page through a navigation item, and whether the now-plain '
    + 'grid view should exist at all, are the author\'s decisions. One boundary is theirs by '
    + 'construction: a page mount declared under `objects[].listViews` is reached by no '
    + 'conversion, so it is refused at its own door until edited by hand.',
  acceptanceCriteria: 'No list view in `stack.views[]` or in any object `listViews` map declares '
    + '`type: \'page\'` or `pageName`; the parse refuses both by name. For each view that did: the '
    + 'page it named is reachable from the app navigation and renders when opened, and the list '
    + 'view either draws rows of its object or has been deleted. No navigation entry points at a '
    + 'view that now renders an empty grid by accident.',
};
