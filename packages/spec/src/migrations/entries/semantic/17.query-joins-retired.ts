// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-joins-retired',
  surface: 'data.query.joins',
  replacement:
    "expand (`expand: { owner: { object: 'user', fields: ['name'] } }`), or a dotted "
    + "`fields` path for a single related column (`fields: ['owner.name']`)",
  reason:
    'The `joins` array was declared-but-inert: no engine or driver read `query.joins` '
    + 'anywhere on the query path, so a query carrying it behaved exactly as if the key were '
    + 'absent — while the name squatted on the reserved REST parameter set. Related-record '
    + 'retrieval already has a live spelling (`expand`, resolved by the engine via batch '
    + '`$in` queries), so the removal deletes the second, broken spelling rather than the '
    + 'capability, and the orphaned `JoinNode`/`JoinType`/`JoinStrategy` cluster goes with '
    + 'the key. A REQUEST surface — `QueryAST` is never stored in stack metadata — so there '
    + 'is no source for the chain to rewrite; callers move their own queries. '
    + 'ADR-0049 / ADR-0078, #4286.',
  acceptanceCriteria:
    'No caller sends `joins`; related records are read through `expand` and single related '
    + 'columns through dotted `fields` paths. A query that still carries `joins` fails to '
    + 'parse with the removal prescription (even as an empty array), and authoring it is a '
    + '`tsc` error at the call site.',
};
