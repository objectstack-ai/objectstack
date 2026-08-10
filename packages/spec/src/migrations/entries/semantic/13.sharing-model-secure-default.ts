// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sharing-model-secure-default',
  surface: 'object.sharingModel (absent, custom object with owner field)',
  replacement: 'an explicit `sharingModel` declaration',
  reason:
    'ADR-0090 D1 secure default: a custom object with an owner field and NO ' +
    '`sharingModel` now resolves `private` (it used to fall through to fully ' +
    'public). Restoring the old exposure must be a deliberate, visible ' +
    'declaration — the chain must not silently re-open data.',
  acceptanceCriteria:
    'Every custom object that relied on the implicit public posture declares ' +
    'an explicit `sharingModel`; row visibility is verified for a ' +
    'representative fixture set (owners, non-owners, admins).',
};
