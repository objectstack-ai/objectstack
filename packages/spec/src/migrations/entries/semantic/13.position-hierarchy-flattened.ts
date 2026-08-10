// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'position-hierarchy-flattened',
  surface: 'position.parent / sharingRule recipient role_and_subordinates',
  replacement: 'business-unit tree + `unit_and_subordinates` (ADR-0090 D3)',
  reason:
    'Positions are flat in v2 — `parent` was removed and the ' +
    '`role_and_subordinates` recipient with it; hierarchy lives on the ' +
    'business-unit tree, which expands a DIFFERENT structure than the retired ' +
    'role tree. Re-homing an org hierarchy is a judgment call.',
  acceptanceCriteria:
    'No position declares `parent`; former `role_and_subordinates` rules are ' +
    're-expressed with `unit_and_subordinates` over an equivalent business-unit ' +
    'tree. Row visibility is unchanged for a representative fixture set.',
};
