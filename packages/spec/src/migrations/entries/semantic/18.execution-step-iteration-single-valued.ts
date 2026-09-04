// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'execution-step-iteration-single-valued',
  surface:
    '`ExecutionStepLog.iteration` on a step whose `regionKind` is '
    + '`parallel-branch` — the per-step records under `ExecutionLog.steps`, as '
    + 'the automation run endpoints return them — and the new optional '
    + '`ExecutionStepLog.branch` key',
  replacement:
    'Read the parallel branch index from `branch`. `iteration` is now '
    + 'single-valued: the zero-based iteration of the enclosing `loop`, carried '
    + 'through any nesting, so a branch step of a `parallel` node that sits '
    + 'inside a loop body carries BOTH keys — `iteration` for the row and '
    + '`branch` for the branch. A consumer that grouped or labelled steps by '
    + '`iteration` under `regionKind: parallel-branch` moves that read to '
    + '`branch`; a consumer reading `iteration` on `loop-body`, `try` or '
    + '`catch` steps changes nothing.',
  reason:
    'The key was declared as the zero-based loop iteration OR the parallel '
    + 'branch index of the enclosing region — one field, two meanings, told '
    + 'apart only by reading `regionKind` first. The engine tagged each step '
    + 'with its innermost region only, so for a `parallel` node inside a `loop` '
    + 'body every branch step recorded the branch index and no step of that '
    + 'branch recorded the loop iteration: a per-row failure inside a branch '
    + 'was attributable to a branch, never to the row the sweep was processing. '
    + 'The sibling try/catch rule had already settled the containment case — a '
    + 'try/catch region has no index of its own, so it carries the loop '
    + 'iteration — and deliberately left `parallel` open, because there the '
    + 'two indexes genuinely compete for one field. The maintainer ruling of '
    + '2026-09-03 took option A: `iteration` always means the enclosing loop '
    + 'iteration and the branch index moves to its own optional key, so a '
    + 'reader no longer has to branch on `regionKind` to know which number it '
    + 'holds, and getting that wrong no longer silently books a failure against '
    + 'the wrong row. Option B — keep the overload and add a second index whose '
    + 'presence depends on nesting shape — was not taken. This is not a '
    + 'mechanical conversion: a step record written before this change carries '
    + '`iteration` under `parallel-branch` with the branch-index meaning, and '
    + 'only its producer knows whether the parallel node sat inside a loop. The '
    + 'measured corpus held zero `loop { parallel }` nestings and one consumer '
    + 'reading the key — a grouping key in the objectui flow-runs panel — so '
    + 'the migration is a consumer-side read move, not a data rewrite. The '
    + 'engine tagger that writes both keys follows this contract change as its '
    + 'own card; until it lands, `branch` is declared and unwritten, and '
    + '`iteration` on a `parallel-branch` step written by an older engine still '
    + 'holds the branch index.',
  acceptanceCriteria:
    'No consumer reads `iteration` as a branch index: every read of a '
    + '`parallel-branch` step\'s index goes through `branch`, and every read of '
    + 'the enclosing loop iteration goes through `iteration` regardless of '
    + '`regionKind`. A step record carrying `regionKind: parallel-branch`, '
    + '`iteration: 3`, `branch: 1` parses under `ExecutionStepLogSchema` with '
    + 'both numbers intact, and a negative or fractional `branch` is refused at '
    + 'the `branch` path. A record written before the engine follow-on carries '
    + 'no `branch` key; treat its `iteration` under `parallel-branch` as the '
    + 'legacy branch index only when the record predates the engine build that '
    + 'writes `branch`.',
};
