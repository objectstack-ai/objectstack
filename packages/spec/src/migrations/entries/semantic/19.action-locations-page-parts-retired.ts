// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #36495 — maintainer rulings 7213534162 and 7213827153 — the D3 entry of the
// action-location vocabulary move. The data half is mechanical (the D2
// conversion `action-locations-acted-on` rewrites every location it can
// rewrite losslessly); what it cannot do is the four sites it leaves as stored,
// and code: a plugin or a hand-written page that compares a location to an old
// word.
export const entry: SemanticMigration = {
  id: 'action-locations-page-parts-retired',
  surface: 'action.locations / page component location — `list_toolbar`, `list_item`, `record_header` and '
    + '`record_more` left the enum; `list`, `record`, `record_page` and `record_row` joined '
    + '`record_related` and `record_section`',
  replacement:
    'name what the action acts on: `list` for no record (the list page toolbar), `record` for one record on the '
    + 'record page and on each list row, `record_page` or `record_row` for one of the two only. A '
    + '`record_more`-only action keeps its fold into the record page\'s ⋯ menu with `component: \'action:menu\'`; '
    + 'the order and the buttons of an object\'s actions are its `actionLayout`',
  reason:
    'With the object\'s `actionLayout` deciding which actions are buttons and in what order, a location only '
    + 'says what the action acts on. The D2 conversion `action-locations-acted-on` maps every old word to its new '
    + 'one, in a source the migration edits and in a stored row it reads, and every action is drawn where it '
    + 'was drawn before. It leaves four sites as stored, each with a TODO: an action in the ⋯ menu only that '
    + 'is on the list toolbar too without `component: \'action:menu\'` (the fold would reach the toolbar), an '
    + 'action at `record_header` with an authored `component: \'action:menu\'` (the header folded it while a '
    + '`record:quick_actions` bar drew it as a button, and `record_page` has one state for both), a block whose '
    + 'own `location` is `record_more`, and an `action:group` at `record_header` with a ⋯-only member (the ⋯ '
    + 'menu has no location of its own now). A site left as stored keeps its old word, which a protocol-19 '
    + 'runtime matches to no surface: that action or block draws nothing until it is rewritten by hand. Code '
    + 'is the other part no conversion reaches: a '
    + 'plugin or a hand-written component that compares a location to an old word no longer matches anything, '
    + 'silently',
  acceptanceCriteria:
    'No action, page row or page block names `list_toolbar`, `list_item`, `record_header` or `record_more`; '
    + 'each is refused at parse with the word that replaced it. Every TODO the migration reports is rewritten '
    + 'by hand, and no plugin code compares a location to an old word.',
  conversionIds: ['action-locations-acted-on'],
  relevantWhen: { kind: 'stack-declares', keys: ['actions', 'objects', 'pages'] },
};
