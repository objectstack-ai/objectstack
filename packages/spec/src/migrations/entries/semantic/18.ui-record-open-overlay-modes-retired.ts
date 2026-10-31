// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #26677 (maintainer ruling 2026-10-27, record-page-v2 epic ruling 1) — the D3
// entry of the `navigation-mode-overlay-values-removed` family: one entry for
// the four retired members (`navigation.mode` 'modal' / 'split' / 'popover',
// `interfaceConfig.recordAction` 'modal'), because they leave for one reason —
// an object opens its records one way — and share one replacement channel.
// Value-level retirements, so nothing lands in RETIRED_KEYS_BY_MAJOR: no
// authorable KEY changed, and the four surface ratchets stay byte-identical.
// The same release flips `navigation.mode`'s default from `page` to `drawer`;
// this entry carries that judgement too, because it is the same model.
export const entry: SemanticMigration = {
  id: 'ui-record-open-overlay-modes-retired',
  surface:
    "view.list.navigation.mode — the values 'modal', 'split' and 'popover' left NavigationModeSchema "
    + "(every list view, object listViews entry and page list block), and 'modal' left "
    + "page.interfaceConfig.recordAction; 'drawer', 'page', 'new_window' and 'none' are unchanged, and "
    + "an omitted navigation.mode now defaults to 'drawer' instead of 'page'",
  replacement:
    'the drawer, which is the default and expands to the full page: delete the retired value. Declare '
    + '`mode: \'page\'` (or `recordAction: \'page\'`) only for an object whose record should open as a '
    + 'full page. A side-by-side pane is a reader\'s own preference in the list\'s Display menu, not '
    + 'metadata',
  reason:
    'The maintainer\'s record-page model: an object has one default way to open a record — the drawer, '
    + 'which expands to the full page, the same record page at two widths — and `page` only for an '
    + 'object that declares it. A centred dialog and a popover were extra surfaces for the same record, '
    + 'and a split pane is a choice each reader makes, not one an author fixes for every reader. The D2 '
    + 'conversion `navigation-mode-overlay-values-removed` makes each stored or existing source parse: '
    + 'it DELETES a retired member, which lands the block on the drawer default. What it cannot decide '
    + 'is whether an object that opened as a centred dialog, or one whose list sat beside its record, '
    + 'should now declare `page` instead of taking the drawer. The default flip needs the same look: a '
    + 'navigation block that omitted `mode` used to parse to `page`, and an artifact or stored row built '
    + 'by a released toolchain carries that `page` written out, so it keeps opening as a full page until '
    + 'the author deletes it',
  acceptanceCriteria:
    'No `navigation.mode` declares `modal`, `split` or `popover`, and no `interfaceConfig.recordAction` '
    + 'declares `modal`; each is refused at parse with its prescription, and TypeScript rejects each at a '
    + '`NavigationMode` position. Every object whose block the conversion changed either takes the drawer '
    + 'or declares `page`, by the author\'s decision. A list of an object with no authored navigation '
    + 'opens a clicked record in the drawer; an object or view that declares `page` still navigates to '
    + 'the record route.',
  conversionIds: ['navigation-mode-overlay-values-removed'],
};
