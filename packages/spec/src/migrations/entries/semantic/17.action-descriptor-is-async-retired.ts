// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'action-descriptor-is-async-retired',
  surface: 'ActionDescriptor.isAsync (the descriptor an executor publishes via `registerNodeExecutor` / `defineActionDescriptor`)',
  replacement:
    'nothing to re-declare — delete the key. Suspension is `execute()` RETURNING '
    + '`suspend: true`, and permission to suspend is `supportsPause: true` on the same '
    + 'descriptor (with the `resumeAuthority` its pauses need)',
  reason:
    'ADR-0049 enforce-or-remove. `isAsync` declared "this action suspends the flow '
    + 'awaiting an external reply" and NOTHING read it: a fresh three-repo measurement '
    + '(#6748, re-run at pickup) found zero property reads across objectstack, objectui '
    + 'and cloud — every hit was the declaration itself, a generated baseline, one of '
    + 'five shipped descriptors WRITING it, a test fixture pinning the shape, or prose. '
    + 'So declaring it never made a node suspend and omitting it never stopped one, '
    + 'which is the silently-inert declaration ADR-0049 exists to end. It was always a '
    + 'second, weaker spelling of the capability `supportsPause` states, and the two '
    + 'diverged in exactly the way a duplicated declaration does: `screen` declared '
    + 'both, `map` and `wait` declared `isAsync` alongside `supportsPause`, and nothing '
    + 'anywhere reconciled them. The sibling took the ENFORCE leg of the same ruling in '
    + '#6667 — `AutomationEngine` now refuses a suspension whose type does not declare '
    + '`supportsPause: true` — so the capability this key gestured at is now a real, '
    + 'enforced fact under one name. This one had no consumer to grow into and takes '
    + 'the remove leg. '
    + 'Why D3 semantic and not a D2 conversion: an ActionDescriptor is published from '
    + "an executor's TypeScript, never stored in stack metadata — no stack, example or "
    + 'template carries the key — so there is no source for the chain to rewrite and '
    + '`os migrate meta` cannot reach it. The schema tombstones it via `retiredKey()` '
    + 'and descriptor authors delete the key themselves; that rejection (a `tsc` error '
    + 'at the authoring site, and a parse error inside `defineActionDescriptor`) is the '
    + 'channel a third-party plugin author actually meets. The '
    + '`EnhancedApiError.fieldErrors` disposition, one layer down.',
  acceptanceCriteria:
    'No descriptor declares `isAsync` — not the five that shipped it (`screen`, `map`, '
    + '`wait`, `approval`, `approval_revise`), not a plugin\'s. Every node type that '
    + 'returns `suspend: true` from `execute()` declares `supportsPause: true` on its '
    + 'descriptor together with a `resumeAuthority`, and its runs still pause and resume '
    + 'as before: the behaviour never depended on `isAsync`, so deleting the key changes '
    + 'no run. Authoring `isAsync` fails `tsc` at the descriptor literal and fails '
    + '`defineActionDescriptor()` at runtime with the prescription, instead of parsing '
    + 'clean and being stripped.',
};
