// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cel-current-user-roles-to-positions',
  surface: 'CEL/formula: current_user.roles',
  replacement: 'current_user.positions',
  reason:
    'The EvalUser/CEL contract renamed `current_user.roles` to ' +
    '`current_user.positions`. The token lives inside free-form expression ' +
    'strings, where a blind textual substitution could corrupt string literals ' +
    'or comments — so the rewrite is delegated to the author.',
  acceptanceCriteria:
    'No expression references `current_user.roles`; formula validation and ' +
    '`objectstack validate` report no unknown-identifier errors; predicate ' +
    'behavior is unchanged for representative users.',
};
