// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20758 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `page-header-breadcrumb-removed` family (one D3 entry per retirement family,
// even when D2 is lossless). Registered key: `ui/PageHeaderProps:breadcrumb`.
// The strip changes no trail, because none was ever drawn; what it leaves is
// the one visible trace either value had, the empty slot's spacing.
export const entry: SemanticMigration = {
  id: 'page-header-breadcrumb-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface: 'page.component.page:header.breadcrumb — the page header\'s "Show breadcrumb" switch',
  replacement:
    'Nothing: delete the key, whether it was `true` or `false`. The navigation trail is drawn once, '
    + 'by the app shell\'s header, and is unchanged.',
  reason:
    'The D2 conversion `page-header-breadcrumb-removed` deletes `breadcrumb` from every page header, '
    + 'and no trail is lost: the renderer drew an empty slot for it and nothing ever filled that slot. '
    + 'The slot was the only thing either value changed — present for `true` and for an absent key, '
    + 'gone for `false` — so a header that said `false` reads as absent after the strip and shows the '
    + 'empty slot\'s spacing again until the renderer stops drawing it. What the conversion cannot '
    + 'decide is whether a page needs a trail of its own: inside an app the shell already draws one, '
    + 'and a page outside the shell that needs one is a feature to ask for, not a key to keep.',
  acceptanceCriteria:
    'No page header carries `breadcrumb`, and the props lint reports one with the prescription. Every '
    + 'page shows the same navigation trail in the app shell\'s header as before the upgrade, and each '
    + 'page header shows the same title, subtitle and actions.',
};
