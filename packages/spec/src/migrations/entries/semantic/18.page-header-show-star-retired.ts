// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23650 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `page-header-show-star-removed` family (one D3 entry per retirement family,
// even when D2 is lossless). Registered key: `ui/PageHeaderProps:showStar`.
// The strip changes nothing the reference console draws; what it can change
// is a third-party host that wires its own favorites toggle.
export const entry: SemanticMigration = {
  id: 'page-header-show-star-retired',
  surface: 'page.component.page:header.showStar — the follow star beside the record title',
  replacement:
    'Nothing: delete the key, whether it was `true` or `false`. The record\'s favorites entry is the '
    + 'header\'s ⋯ menu, and metadata does not control it.',
  reason:
    'The D2 conversion `page-header-show-star-removed` deletes `showStar` from every page header, and '
    + 'nothing the reference console draws changes: its record chip draws the follow star only where '
    + 'the host wires a favorites toggle into the record context, and the console wires none, so '
    + '`true` drew nothing and `false` hid nothing. What the conversion cannot decide is a host of '
    + 'your own: if it wires that favorites toggle, the star now draws on every record header, a '
    + 'header that said `false` included, and hiding it there is the host\'s call, not the page\'s.',
  acceptanceCriteria:
    'No page header carries `showStar`, and the props lint reports one with the prescription. Every '
    + 'record page shows the same header in the console as before the upgrade — title, copy-id '
    + 'button and actions — and the record\'s favorites entry is still in the header\'s ⋯ menu.',
};
