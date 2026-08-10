// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'rls-sql-predicate-to-cel',
  surface: 'security.rls.predicate',
  replacement: 'CEL predicate',
  reason:
    'SQL-ish RLS predicates were deprecated in favor of canonical CEL. Translation ' +
    'is not a pure token rename — operators, functions, and null semantics differ — ' +
    'so it cannot be applied losslessly by the chain.',
  acceptanceCriteria:
    'Every RLS predicate parses as CEL and `objectstack validate` reports no ' +
    'expression errors; row visibility is unchanged for a representative fixture set.',
};
