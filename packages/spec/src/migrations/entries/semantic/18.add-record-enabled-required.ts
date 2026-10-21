// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24692 (ADR-0049 enforce-or-remove; ruling letter B′) — the D3 entry of the
// `add-record-enabled-defaulted` conversion: `addRecord.enabled` becomes
// REQUIRED with no default, and `position` defaults to `top`. The conversion
// writes the old default (`true`) onto a stored block that omits `enabled`;
// what it cannot know is whether the author wanted the button the old default
// promised, since the renderer never drew one for such a block.
export const entry: SemanticMigration = {
  id: 'add-record-enabled-required',
  surface: 'view.list.addRecord.enabled — omitted (was `.default(true)`); view.list.addRecord.position — default `bottom` → `top`',
  replacement: 'Write `enabled` on every `addRecord` block: `enabled: true` shows the Add button, '
    + '`enabled: false` declares it off. `position` defaults to `top` (the toolbar); write '
    + '`position: \'bottom\'` or `\'both\'` to place it elsewhere.',
  reason: 'The 18.0 spec declared `enabled` `.default(true)` and `position` `.default(\'bottom\')`, '
    + 'while the renderer drew the Add button only for an explicit `enabled: true` and placed an '
    + 'absent position at the top. So `addRecord: {}` promised a button at the bottom and drew '
    + 'nothing. The spec now says what renders. The D2 conversion `add-record-enabled-defaulted` '
    + 'writes `enabled: true`, the declared default, onto a stored or built block that omits it, so '
    + 'such a block is not refused; the price is that the block now draws the button it always '
    + 'declared. A block meant to draw nothing must say `enabled: false`. `position` is not '
    + 'converted: an omitted position renders at the top before and after.',
  acceptanceCriteria: 'Every `addRecord` block declares `enabled`; the parse refuses a block '
    + 'without it with a prescription naming the key. A list that should show the Add button '
    + 'shows it where `position` says (the toolbar when omitted); a list that should not declares '
    + '`enabled: false` or drops the block.',
};
