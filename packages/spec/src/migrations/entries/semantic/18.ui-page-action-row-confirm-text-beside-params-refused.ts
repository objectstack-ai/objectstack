// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-confirm-text-beside-params-refused',
  surface: 'the `confirmText` of a page action row beside a non-empty array `params`: `properties.confirmText` '
    + 'beside a non-empty array `properties.params` on an `action:button` or `action:icon`, and `confirmText` '
    + 'beside a non-empty array `params` on each `action:group` / `action:menu` member of `properties.actions`. '
    + 'Not `params: []`, not an object `params` (an `action:button` / `action:icon` row\'s static parameter '
    + 'values, a `type: \'api\'` member\'s request payload), and not a row with no `params`',
  replacement: 'the confirm question on the row\'s `description`, which the param dialog draws under its title, '
    + 'and no `confirmText`: one dialog that asks the question and collects the inputs. A row that collects '
    + 'nothing keeps its `confirmText` and drops the `params`. ⛔ NOT mechanically convertible: whether the '
    + 'confirm sentence reads as the param dialog\'s description line, or should be reworded, is the '
    + 'author\'s call.',
  reason:
    'The console\'s action runner awaits the confirm dialog and only then opens the param dialog for an array '
    + '`params`, and all four rows forward both keys to it (an array `params` as `actionParams`), so a row '
    + 'carrying both showed the user TWO dialogs for one decision: a confirm that already read as "the action '
    + 'ran" while nothing had been sent, then the param prompt. `ActionSchema` and `InlineActionSchema` already '
    + 'refuse the pair; the four page rows now carry that rule with the same predicate and the same refusal '
    + 'text. On an `action:icon` with no `label`, `description` is also the tooltip text, so moving the '
    + 'question there changes the hover text too; give the icon a `label` to keep them apart. A page\'s '
    + '`properties` is not parsed on the metadata load path, so a stored page keeps loading; `os validate`\'s '
    + 'props gate, which the metadata save door also runs on the next save of the page, parses it against '
    + 'these same rows and reports the refusal at the row\'s `confirmText`. Measured producers: none shipped '
    + 'in this repository; the one carrier was a spec test fixture, respelled.',
  acceptanceCriteria:
    'No `action:button` / `action:icon` `properties` and no `action:group` / `action:menu` member declares '
    + '`confirmText` beside a non-empty array `params`; `os validate` reports no `component-props-invalid` '
    + 'finding at `properties.confirmText` or `properties.actions.N.confirmText` for the pair, and every row '
    + 'with no `params`, `params: []` or an object `params` parses as before.',
};
