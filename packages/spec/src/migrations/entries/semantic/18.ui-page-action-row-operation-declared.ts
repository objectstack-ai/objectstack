// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-operation-declared',
  surface: 'the `operation` of a page action row (`properties.operation` on an `action:button` or `action:icon`, '
    + 'and `operation` on each `action:group` / `action:menu` member of `properties.actions`): any value but '
    + '`\'update\'`. Also the `onSuccess` of a page action row that declares `operation: \'update\'`, whatever '
    + 'executor the row names (`actionType` on a node, `type` on a member, or none)',
  replacement: '`operation: \'update\'` with a `patch` for the declarative single-record write, or no `operation`. '
    + 'A row delete is the object\'s own delete affordance; a bulk def\'s `\'custom\'` has no row form, because the '
    + 'row is already the action. Beside `operation: \'update\'`, no `onSuccess`. ⛔ NOT mechanically convertible: '
    + 'whether a row meant the write or the hop is the author\'s call.',
  reason:
    'Every page action row forwards `operation` to the console\'s action runner beside its executor, and the runner '
    + 'reads it before any executor: `operation === \'update\'` performs the declarative write through the platform '
    + 'action route, and any other value falls through to the executor and does nothing. The rows typed the key as '
    + 'an open value, so such a value parsed clean, and they never carried `ActionSchema`\'s refusal of `onSuccess` '
    + 'beside `operation: \'update\'`: a row with an `api` or `script` executor, the write and a hop parsed, while '
    + 'the same action was refused. The rows now declare `ActionSchema`\'s own `operation` enum and refuse the '
    + 'pairing with the action\'s own text: the hop would follow the write, which runs no handler and no executor, '
    + 'so its success carries no result `${result.*}` could read. A page\'s `properties` is not parsed on the '
    + 'metadata save or load path; `os validate`\'s props gate parses it against these same rows and reports the '
    + 'refusal at the row\'s `operation` or `onSuccess`. Measured producers: none in this repository; none in '
    + 'objectui\'s action rows at its pin or main.',
  acceptanceCriteria:
    'Every page action row\'s `operation` is absent or `\'update\'`, and no row with `operation: \'update\'` carries '
    + '`onSuccess`; `os validate` reports no `component-props-invalid` finding at `properties.operation`, '
    + '`properties.actions.N.operation`, or at the `onSuccess` of an `operation: \'update\'` row, and every such row '
    + 'parses as before unless `ui-page-action-row-declarative-update-rules` refuses it.',
};
