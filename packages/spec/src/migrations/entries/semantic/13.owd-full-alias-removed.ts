// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'owd-full-alias-removed',
  surface: "object.sharingModel: 'full'",
  replacement: "'public_read_write' or explicit sharing rules",
  reason:
    "The legacy `'full'` OWD alias implied full access (including transfer/ " +
    'delete) — wider than any canonical OWD value, so it has no lossless ' +
    "target ('read'/'read_write' converted mechanically; this one did not). " +
    'Choosing between `public_read_write` and explicit sharing rules is a ' +
    'security-posture decision.',
  acceptanceCriteria:
    "No object declares sharingModel 'full'; the chosen replacement posture is " +
    'verified against the intended access (who can read/write/delete) for a ' +
    'representative fixture set.',
};
