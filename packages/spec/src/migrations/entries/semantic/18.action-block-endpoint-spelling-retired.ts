// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21005 — the D3 entry of the `action-block-endpoint-to-target` family (ruling
// B on #17152: one D3 entry per retirement family, even when D2 is lossless).
// The `action:button` / `action:icon` rows declared `endpoint` while
// `ActionSchema` refused it with the rename to `target`; the console's `api`
// handler reads `target` only. The rename is lossless on an `api` action and is
// declined, as a TODO, everywhere else — and it cannot reach code.
export const entry: SemanticMigration = {
  id: 'action-block-endpoint-spelling-retired',
  surface: 'page.component.action:button.endpoint / page.component.action:icon.endpoint — the '
    + 'endpoint an `api` action button calls, on the two page blocks that run an action',
  replacement: '`target` — the one key the action runner dispatches an executor on, and the key '
    + '`ActionSchema` already renames `endpoint` to.',
  reason: 'The D2 conversion `action-block-endpoint-to-target` renames `endpoint` to `target` in '
    + 'author sources and on every stored-row rehydration, for a block whose `actionType` is '
    + '`api` — the one meaning the key declared, and the rename is lossless there. Three things '
    + 'are left. A block that carries `endpoint` with no `actionType` was called through the '
    + 'action runner\'s legacy API fallback, which a `target` with no type does not reach, so the '
    + 'author has to add `actionType: \'api\'` as well. A block with another `actionType` never read '
    + '`endpoint`, so only the author can say whether its value should become the `target` or be '
    + 'deleted. And a block carrying both spellings with different values is left for the author '
    + 'to keep one. Each is left as stored and reported as a TODO. Code is out of reach: a custom '
    + 'action handler that read `endpoint` off the action it was handed reads nothing once the '
    + 'block carries `target`.',
  acceptanceCriteria: 'No `action:button` or `action:icon` block carries `endpoint` in source or '
    + 'at rest; each block that called an endpoint names it as `target` with `actionType: \'api\'`. '
    + 'Pressing such a button in the console sends one request to that endpoint, and `os validate` '
    + 'reports no `component-props-unknown-key` finding for `endpoint`. No custom action handler '
    + 'reads `endpoint` from an action dispatched by either block.',
};
