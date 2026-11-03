// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The declared default of `ListView.userActions.hideFields` moved from `false`
// to `true` (maintainer ruling on #28912, 2026-11-02, verbatim:
// 「Fable 评估（核对后） 同意立卡」, confirmed 「#28911 和 #28912 都保留，按卡上写的做。」).
// A default move reaches every silent document with no parse error and nothing
// in the author's diff, so the upgrade path carries it as a TODO: only the
// deployment can say which list that never declared the key was relying on its
// columns being fixed for every reader. The same class as
// `list-view-edit-inline-default-on` and `view-pagination-page-size-default-50`:
// no key is removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row,
// and no D2 conversion exists — a mechanical pass writing `hideFields: false`
// into every silent view would preserve the old posture and defeat the ruling,
// and one writing `true` would add nothing the default does not already do.
// Where the reader's choice is kept is objectui#10694's and objectui#12505's
// rule in the console's list renderer, which this change leaves alone; the
// citations live here, not in the printed guidance, which carries no tracker
// number.
export const entry: SemanticMigration = {
  id: 'list-view-hide-fields-default-on',
  surface: 'ui.UserActionsConfig.hideFields — an OMITTED hideFields inside a list view\'s '
    + 'userActions block',
  replacement: 'nothing, to take the platform default: a reader can hide and show the list\'s '
    + 'columns for themselves. To withhold the control on a list whose columns must stay as '
    + 'authored for every reader, write it: `userActions: { hideFields: false }`',
  reason:
    'A RULED behaviour change on a default, so there is nothing to rewrite and nothing to '
    + 'refuse: the maintainer\'s ruling of 2026-11-02 made the Hide Fields control available on a '
    + 'list view by default, and the declared default of `UserActionsConfigSchema.hideFields` moved '
    + 'from `false` to `true`. The old `false` was copied from the list renderer\'s legacy read, not '
    + 'chosen as product; the renderer now reads an absent key as on. A `userActions` block that '
    + 'omits `hideFields` now parses to `true`, and the console\'s list offers the control. A view '
    + 'with no `userActions` block at all parses with none on either side; the renderer reads an '
    + 'absent key as the spec default. The control only subtracts from the columns the view draws, '
    + 'and the choice is the reader\'s own: stored on their own list state on a view that declares '
    + '`columns` or on a saved view, kept for the session only on a system view that declares no '
    + '`columns`, and never written into the shared view. An interface page reads the same '
    + 'default: a page whose `interfaceConfig.userActions` omits the key, or that has no block, '
    + 'offers the control, and `hideFields: false` withholds it. Not '
    + 'losslessly convertible because the question is intent, not text: only the deployment knows '
    + 'which silent lists were relying on fixed columns. The accept set is unchanged — a boolean — '
    + 'and every authored `hideFields` parses exactly as before. A document that serialised an '
    + 'earlier parse (an `os compile` artifact) carries a written `false` and keeps withholding the '
    + 'control; recompile it, or delete the key.',
  acceptanceCriteria:
    'An empty `userActions` block parses to `hideFields: true`, and a list view carrying '
    + '`userActions: {}` parses to `userActions.hideFields` true; an authored '
    + '`userActions: { hideFields: false }` still parses to `false`; a list view with no '
    + '`userActions` block still parses with none. In the console, a grid view that declares no '
    + '`hideFields` offers the Hide Fields control, and `userActions: { hideFields: false }` removes '
    + 'it. Hiding a column on a view that declares `columns`, or on a saved view, survives a reload '
    + 'for that reader only; on a system view with no `columns` it lasts for the session. Every list '
    + 'whose columns must stay as authored declares `userActions: { hideFields: false }` and shows '
    + 'no control.',
};
