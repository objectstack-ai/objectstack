// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23650 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `page-header-show-star-removed` family (one D3 entry per retirement family,
// even when D2 is lossless). Registered key: `ui/PageHeaderProps:showStar`.
// The strip changes nothing the reference console draws: the console draws
// the record's star from the host's favorites toggle, never from metadata.
export const entry: SemanticMigration = {
  id: 'page-header-show-star-retired',
  surface: 'page.component.page:header.showStar — the follow star beside the record title',
  replacement:
    'Nothing: delete the key, whether it was `true` or `false`. The console draws the record\'s star '
    + 'from the host\'s favorites toggle, never from metadata, so the page draws the same star without it.',
  reason:
    'The D2 conversion `page-header-show-star-removed` deletes `showStar` from every page header, and '
    + 'nothing the reference console draws changes: the console draws the record\'s star from the '
    + 'host\'s favorites toggle, never from metadata. Its record chip draws the star beside the record '
    + 'name wherever the host wires that toggle into the record context, and the console wires it on '
    + 'its record pages, so `true` and `false` draw the same star. A host of your own works the same '
    + 'way: the star draws where it wires the favorites toggle, a header that said `false` included, '
    + 'and hiding it there is the host\'s call, not the page\'s.',
  acceptanceCriteria:
    'No page header carries `showStar`, and the props lint reports one with the prescription. Every '
    + 'record page shows the same header in the console as before the strip — title, copy-id button, '
    + 'actions and the record\'s star beside the record name — and the header\'s ⋯ menu holds no '
    + 'favorites entry (only a print page, which draws no header, keeps one in its ⋯).',
};
