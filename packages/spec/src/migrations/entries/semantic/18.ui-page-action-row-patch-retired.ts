// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24394 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `page-action-row-patch-removed` family (one D3 entry per retirement family,
// even when D2 is lossless for the write). Registered keys:
// `ui/ActionButtonProps:patch`, `ui/ActionIconProps:patch`; the
// `action:group` / `action:menu` member carries the same tombstone and has no
// surface row of its own. The strip changes no write the platform performs;
// what it can change is the console's Undo snapshot, and what it cannot do is
// move the values onto the named action.
export const entry: SemanticMigration = {
  id: 'ui-page-action-row-patch-retired',
  surface: 'page.component.action:button.patch / page.component.action:icon.patch / '
    + 'page.component.action:group.actions[].patch / page.component.action:menu.actions[].patch — '
    + 'the static field values a page action row declared for its operation: update',
  replacement:
    'The `patch` of the declared action the row\'s `name` names. A row\'s `operation: \'update\'` runs that action, '
    + 'so write the values there (`defineAction({ name, operation: \'update\', patch })`), give the row that '
    + '`name`, and delete the row\'s `patch`. A row\'s static `params` are written only where that action '
    + 'declares them.',
  reason:
    'A page action row\'s `operation: \'update\'` posts through the console runner\'s server dispatch to the '
    + 'platform action route under the row\'s `name`, and the route resolves that declaration by name and '
    + 'writes the declaration\'s own `patch`, merged under the request\'s params, which it judges against the '
    + 'params the declaration declares. The row\'s `patch` was never sent: the runner posted the collected '
    + 'values alone and read the row\'s `patch` for its Undo snapshot only. So a row whose `patch` differed '
    + 'from its action\'s wrote the action\'s values and offered an Undo of the row\'s. The D2 conversion '
    + '`page-action-row-patch-removed` deletes the key and changes nothing the route writes. What it cannot '
    + 'decide is where the values belong: when the named action\'s own `patch` lacks a value the row carried, '
    + 'that value was never written, and adding it to the action is a change to what the action writes, '
    + 'which is the author\'s call. A row with `operation: \'update\'` and no `name` is now refused at `name`, '
    + 'because it has no declared action to run: the console\'s server dispatch refused it before any '
    + 'request. Measured producers: none in this repository\'s examples or apps; none among objectui\'s page '
    + 'rows at its pin or main.',
  acceptanceCriteria:
    'No page action row carries `patch`, and every row with `operation: \'update\'` names a declared '
    + '`operation: \'update\'` action whose `patch` holds the values the row is meant to write; `os validate` '
    + 'reports no `component-props-invalid` finding at `properties.patch`, `properties.actions.N.patch`, '
    + '`properties.name` or `properties.actions.N.name`, and clicking the row in the console writes the '
    + 'action\'s `patch` as before.',
};
