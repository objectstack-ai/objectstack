// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'rest-requireauth-default-flip',
  surface: 'api.requireAuth',
  replacement: "explicit `api: { requireAuth: false }` (intentionally-public deployments only)",
  reason:
    'The global default flipped from `false` to `true` in protocol 12: anonymous ' +
    'requests to the `/data/*` CRUD and batch endpoints are rejected with 401 ' +
    'unless the stack opts out. Whether anonymous access was intentional (demo / ' +
    'kiosk) or an accident is a security judgment no transform can make.',
  acceptanceCriteria:
    'A deployment that relies on anonymous data access declares ' +
    '`api: { requireAuth: false }` on the stack config (and accepts the boot ' +
    'warning); every other consumer verifies its clients authenticate. ' +
    '`objectstack validate` and the consumer test suite pass.',
};
