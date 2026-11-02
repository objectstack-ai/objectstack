// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29037 (ruling of record 6570568131 on #28971, letter C) — the D3 entry of
// the `view-personal-declarations-removed` family: one entry for the two
// declarations, because they leave for one reason — nothing ever made a view
// personal — and share one replacement, the user-owned personal view the same
// ruling records. `scope: 'personal'` is a value-level retirement (no
// RETIRED_KEYS_BY_MAJOR row); `sharing.type` is a key, registered as
// `ui/ViewSharing:type`.
export const entry: SemanticMigration = {
  id: 'ui-view-personal-declarations-retired',
  surface:
    "view.scope — the value 'personal' left ViewScopeSchema (a view item record and a flattened overlay; "
    + "'package' and 'shared' are unchanged) / view.list.sharing.type — the key left ViewSharingSchema with "
    + "both its values, on every list view, object listViews entry and list view item; sharing.lockedBy is "
    + 'unchanged',
  replacement:
    'nothing on the view: delete `scope: \'personal\'` (omit `scope`, or write `shared` for a runtime-authored '
    + 'view) and delete `sharing.type`. A view is visible to everyone who can read its object. Personal named '
    + 'views are a user-owned record, not view metadata, and do not reuse either key',
  reason:
    'Neither declaration was ever enforced. Both switcher read paths list every view bound to the object, so a '
    + 'view an author marked `scope: \'personal\'` or `sharing: { type: \'personal\' }` was listed for every user '
    + 'who can read the object, and the console list toolbar badge, the one reader of `sharing.type`, told them '
    + 'it was a personal view. With `personal` refused, `type` would carry one value that describes every view, '
    + 'so the key leaves whole. The D2 conversion `view-personal-declarations-removed` makes each stored or '
    + 'existing source parse: it DELETES the `personal` member and the `type` key, which changes what no reader '
    + 'could see. What it cannot decide is what the author meant by a personal view: keep it as a view every '
    + 'reader sees, delete it, or rebuild it as a personal view once the user-owned personal view ships',
  acceptanceCriteria:
    'No view item or overlay declares `scope: \'personal\'` and no list view declares `sharing.type`; each is '
    + 'refused at parse with its prescription, and TypeScript rejects each at the authoring site (a '
    + '`collaborative` value an older toolchain wrote out is accepted and stripped). Every view the conversion '
    + 'changed is kept, deleted or rebuilt by the author\'s decision. The console list toolbar no longer labels '
    + 'any view personal or shared; a view with `sharing.lockedBy` still shows who locked it.',
  conversionIds: ['view-personal-declarations-removed'],
};
