// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-declarative-update-rules',
  surface: 'a page action row (`properties` of an `action:button` or `action:icon`, and each `action:group` / '
    + '`action:menu` member of `properties.actions`) that carries `patch` without `operation: \'update\'`, or '
    + 'that carries `operation: \'update\'` beside an executor other than `\'script\'` (`actionType` on a node, '
    + '`type` on a member), beside `target`, `method`, `bodyExtra`, `bodyShape` or (on `action:button`) '
    + '`recordIdField`, with nothing to write (no `name`: the row runs the declared action its `name` names), or '
    + 'with `list_toolbar` in `locations`. A row\'s own `patch` is retired outright '
    + '(`ui-page-action-row-patch-retired`)',
  replacement: 'Write the row as `ActionSchema` accepts the same action, except that its write is the declared '
    + 'action its `name` names: `operation: \'update\'` with that `name` (the action\'s own `patch` is the write, '
    + 'and the row carries none), no executor key or `\'script\'`, none of the dispatch keys, and record '
    + 'locations only. A row that meant a call of its own keeps its executor and its `target` and drops '
    + '`operation` instead. ⛔ NOT mechanically convertible: whether a row meant the '
    + 'declarative write or the executor is the author\'s call.',
  reason:
    'Every page action row forwards `operation`, `patch`, `params`, `target`, its executor key and `locations` '
    + 'to the console\'s action runner, and the runner reads `operation` before any executor: it posts the write '
    + 'through its `script` dispatch and runs no executor of its own, so beside it the executor and the keys '
    + 'that bind one are never read, a `patch` without it is never written, and a `patch` that is not a record '
    + 'is dropped before the write. `ActionSchema` refused each of these shapes on an action; the rows accepted '
    + 'them. The rows now apply the same judge, read from one place, with the action\'s own texts (the executor '
    + 'spelled as the row spells it). Two rules read the row\'s own surface: the route writes the `patch` of the '
    + 'declared action the row\'s `name` names, so the row\'s own `patch` is retired '
    + '(`ui-page-action-row-patch-retired`) and its nothing-to-write rule asks for that `name`. A page\'s '
    + '`properties` is not parsed by the page schema; the component-props gate parses it against these same rows, '
    + 'at `os validate`, `os build`, `os lint` and the metadata save door, and reports each refusal at the row\'s '
    + 'own key; the load path runs no such gate, so a stored page still loads and its next save meets the '
    + 'component-props gate at the metadata save door. Measured producers: none in this '
    + 'repository\'s examples, CLI corpus or tests outside these rows\' own pins; in objectui, at its pin and '
    + 'main, one renderer-test control mounts an `action:button` with `patch` and no `operation` to show nothing '
    + 'is written, and no spec parse judges it.',
  acceptanceCriteria:
    'No page action row carries `patch` without `operation: \'update\'`; every row with `operation: \'update\'` '
    + 'names no executor or `\'script\'`, carries none of `target`, `method`, `bodyExtra`, `bodyShape` and '
    + '`recordIdField`, names its declared action (`name`), and lists no `list_toolbar` location; '
    + '`os validate` reports no `component-props-invalid` finding at `properties.KEY` or '
    + '`properties.actions.N.KEY` for those keys, and every such row parses as before.',
};
