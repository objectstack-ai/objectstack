// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'permission-set-profile-removed',
  surface: 'permissionSet.kind / permissionSet.isProfile',
  replacement: 'position-based assignment + permission-set grants (ADR-0090 D2)',
  reason:
    'The Profile concept was removed: `isProfile` is gone from ' +
    '`PermissionSetSchema` and the `profile` metadata kind folded into ' +
    '`position`. Mapping a profile onto positions and permission-set grants is ' +
    'an authorization-design decision, not a rename.',
  acceptanceCriteria:
    'No permission set declares `isProfile` or kind `profile`; the intended ' +
    'assignees hold equivalent grants via positions/permission sets. The access ' +
    'matrix (`os compile` access-matrix gate, where enabled) is reviewed and ' +
    '`objectstack validate` passes.',
};
