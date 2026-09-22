// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-action-undoable-unfulfillable-refused',
  surface: '`action` documents declaring `undoable: true` on a shape no runtime fulfils — '
    + "`type: 'script'` (the default route) and `type: 'url'`, plus the dormant "
    + "`type: 'flow'` / `'modal'` / `'form'`, in each case WITHOUT `operation: 'update'`",
  replacement: "either of the two fulfilled shapes — `operation: 'update'` with a `patch`, "
    + 'where the framework runtime snapshots the prior value of every field in the merged '
    + "write bag, or `type: 'api'`, where the pinned console builds the undo envelope — or "
    + 'no `undoable` at all. ⛔ NOT mechanically convertible: which of the two the author '
    + 'meant is an intent no artifact records (a `script` action with an inline handler and '
    + 'an api action calling an endpoint are different dispatches, not two spellings of '
    + 'one), and dropping the flag silently would remove an Undo the author asked for. The '
    + 'refusal names both shapes and the drop, and the author chooses',
  reason:
    'The key was a plain optional boolean read by no refinement, so every combination '
    + 'parsed clean while only two of them ever produced an Undo — the declared-but-inert '
    + 'shape ADR-0078 refuses at author time. ⚠️ The obvious repair, requiring '
    + "`operation: 'update'`, was MEASURED WRONG and is deliberately not what this entry "
    + "records: the pinned console's two readers gate the undo envelope on "
    + '`action.undoable` alone with zero reads of `action.operation`, and those same two '
    + "files are the entire recorded evidence for this package's own liveness verdict "
    + '`action/undoable: live`. A blanket requirement would therefore have refused the '
    + 'published `ReassignLeadAction` skill example (`type: \'api\'` + `undoable: true`, no '
    + '`operation`) at import time, since `defineAction` IS `ActionSchema.parse`, and every '
    + 'console api action with undo along with it. So the accepted set is closed to the '
    + 'two shapes some runtime fulfils rather than to the one the framework runtime '
    + 'fulfils. Stating "`type: \'api\'` is fulfilled by the console" in the contract is '
    + 'the point, not a leak: the spec is the contract for every runtime including the '
    + 'console, and a closed table of fulfillable combinations is what the '
    + 'declared-is-delivered rule asks for.',
  acceptanceCriteria:
    "Every `action` document declaring `undoable: true` carries `operation: 'update'` or "
    + "`type: 'api'`. Both fulfilled shapes parse byte-identically to before — the "
    + 'published `ReassignLeadAction` example included — and an action with `undoable` '
    + 'absent or `false` is untouched on every type. An action declaring `undoable: true` '
    + 'on any other shape is refused with a per-key issue at `undoable` whose message names '
    + 'both fulfilling shapes and the runtime that fulfils each; the author adds the shape '
    + 'they meant or drops the flag.',
};
