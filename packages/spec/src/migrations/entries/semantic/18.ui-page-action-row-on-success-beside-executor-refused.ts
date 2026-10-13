// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-on-success-beside-executor-refused',
  surface: 'the `onSuccess` of a page action row (`properties.onSuccess` on an `action:button` or `action:icon`, '
    + 'and `onSuccess` on each `action:group` / `action:menu` member of `properties.actions`) whose effective '
    + 'executor is a console runner built-in other than `api` / `script`: `url`, `navigation`, `modal`, `flow` or '
    + '`form`, spelled by the executor key (`actionType` on a node, `type` on a member) or, with that key omitted '
    + 'or empty, by the row\'s `name`. Also the `onSuccess` of a row with no effective executor: no (or an empty) '
    + 'executor key and no `name`',
  replacement: 'the hop on an `api` or `script` row, whose success carries the result `${result.*}` reads; or no '
    + '`onSuccess`. On a `url` row, the destination is the row\'s `target` (with the tab in its `openIn`); on a '
    + '`form` row, where a submitted form goes is the form view\'s `submitBehavior`. A row with no executor '
    + 'declares the one whose success the hop follows (`actionType: \'api\'` or `\'script\'`, `type` on a '
    + 'member). A handler a host registers under another name keeps its `onSuccess`. ⛔ NOT mechanically '
    + 'convertible: whether the hop belongs on another action, in the target, or nowhere is the author\'s call.',
  reason:
    'The console\'s action runner performs the post-success hop after every executor that succeeds, so the rows\' '
    + '`onSuccess` was read beside every executor and judged beside none: `url`, `navigation` and `form` are '
    + 'themselves navigations, so the hop navigated a second time; a `modal` hop followed whatever the dialog\'s '
    + 'host answered and a `flow` hop the run\'s start, a run paused at its first screen included; and a row with '
    + 'no executor dispatches on nothing. `ActionSchema` already refuses `onSuccess` beside any `type` but `api` / '
    + '`script`; the rows now carry that rule on the vocabulary the action\'s closed `ActionType` can see, with '
    + 'the same refusal text. A name outside the runner\'s built-in table is a host-registered handler and stays '
    + 'open: the runner hops after it too, and only the host knows whether its handler navigates. A page\'s '
    + '`properties` is not parsed on the metadata save or load path; `os validate`\'s props gate parses it against '
    + 'these same rows and reports the refusal at the row\'s `onSuccess`. Measured producers: none in this '
    + 'repository or in hotcrm; objectui\'s one is a test row with no executor asserted accepted.',
  acceptanceCriteria:
    'Every `action:button` / `action:icon` `properties.onSuccess` and every `action:group` / `action:menu` member '
    + '`onSuccess` sits on a row whose effective executor is `api`, `script` or a name outside the runner\'s '
    + 'built-in table; `os validate` reports no `component-props-invalid` finding at `properties.onSuccess` or '
    + '`properties.actions.N.onSuccess` for the executor, and every such row parses as before.',
};
