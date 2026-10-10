// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The declared default of `ListView.userActions.editInline` moved from `false`
// to `true` (maintainer ruling 2026-10-10, the v18 line, verbatim:
// 「乙 v18 把 spec 默认翻成 true,editInline: false 变成关法。」). A default move
// reaches every silent document with no parse error and nothing in the
// author's diff, so the upgrade path carries it as a TODO: only the deployment
// can say which list that never declared the key was relying on read-only
// cells. The same class as `view-pagination-page-size-default-50` and
// protocol 12's `rest-requireauth-default-flip`: no key is removed, so there
// is no tombstone and no RETIRED_KEYS_BY_MAJOR row, and no D2 conversion
// exists — a mechanical pass writing `editInline: false` into every silent
// view would preserve the old posture and defeat the ruling, and one writing
// `true` would add nothing the default does not already do.
export const entry: SemanticMigration = {
  id: 'list-view-edit-inline-default-on',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface: 'ui.UserActionsConfig.editInline — an OMITTED editInline inside a list view\'s '
    + 'userActions block, or a page interfaceConfig.userActions block',
  replacement: 'nothing, to take the platform default: the list is editable in place by a user who '
    + 'may update the object, under the permission gate that already exists. To keep a list '
    + 'read-only in place — a log, an audit trail, a history, a report roll-up — write it: '
    + '`userActions: { editInline: false }`',
  reason:
    'A RULED behaviour change on a default, so there is nothing to rewrite and nothing to '
    + 'refuse: the maintainer\'s ruling of 2026-10-10 made a list view editable in place by '
    + 'default on the v18 line, and the declared default of `UserActionsConfigSchema.editInline` '
    + 'moved from `false` to `true`. A `userActions` block that omits `editInline` now parses to '
    + '`true` — the renderer offers the inline-edit toggle, and a user who may `update` the object '
    + 'edits a cell in place with the field\'s type-aware widget; a user without `update` sees no '
    + 'toggle, because the permission gate is untouched. A view with no `userActions` block at all '
    + 'parses with none on either side; the renderer reads an absent key as the spec default. The '
    + 'one-vocabulary rule of objectui#5144 stands: a boolean view-level `inlineEdit` folds into '
    + '`editInline` (`true` reads on and opens the grid in edit mode), and an explicit `editInline` '
    + 'wins. Not losslessly convertible because the question is intent, not text: only the '
    + 'deployment knows which silent lists were relying on read-only cells. The accept set is '
    + 'unchanged — a boolean — and every authored `editInline` parses exactly as before. A '
    + 'document that serialised an earlier parse (an `os compile` artifact) carries a written '
    + '`false` and stays read-only in place; recompile it, or delete the key.',
  acceptanceCriteria:
    'An empty `userActions` block parses to `editInline: true`, and a list view carrying '
    + '`userActions: {}` parses to `userActions.editInline` true; an authored '
    + '`userActions: { editInline: false }` still parses to `false`; a view-level `inlineEdit: true` '
    + 'still parses as before, with no `userActions` block materialised. In the console, a grid view '
    + 'that declares neither key offers the inline-edit toggle to a user with `update` on the object '
    + 'and not to a user without it; `userActions: { editInline: false }` removes it; '
    + '`inlineEdit: true` still opens the grid in edit mode. Every list that must stay read-only in '
    + 'place declares `userActions: { editInline: false }` and shows no toggle.',
};
