// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-joins-retired',
  surface: 'data.query.joins',
  replacement:
    "expand (`expand: { owner_id: { object: 'user', fields: ['name'] } }`), whose nested "
    + "query selects the related record's own columns — keeping the foreign key in your own "
    + "projection (`fields: ['title', 'owner_id']`), because the relation is carried by that "
    + 'column and projecting it away leaves expansion nothing to resolve. A dotted `fields` '
    + 'path is NOT a replacement: no driver ever resolved one, and the ingress refuses it '
    + '(`400 INVALID_FIELD`, #7532). Where the value is wanted on the queried object itself, '
    + 'denormalise it onto that object (a stored field, written when the source changes) — the '
    + 'same remedy the sort axis prescribes (#6924)',
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
    'No caller sends `joins`; related records AND single related columns are read through '
    + '`expand`, with the foreign-key column retained in the projection so expansion has '
    + 'something to resolve. A query that still carries `joins` fails to parse with the removal '
    + 'prescription (even as an empty array), and authoring it is a `tsc` error at the call site.',
};
