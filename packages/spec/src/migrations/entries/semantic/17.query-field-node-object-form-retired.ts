// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-field-node-object-form-retired',
  surface: 'data.query.fields',
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
    'The `FieldNode` union declared a nested-select object form `{ field, fields, alias }` that '
    + 'was inert end to end: no producer emitted it, and no consumer read `.fields` or `.alias` '
    + '— objectql\'s formula projection and known-field filters, driver-sql\'s `select()` and '
    + 'driver-memory\'s projection all treat the list as `string[]`, driver-mongodb keyed its '
    + 'projection with the entry itself, and the REST ingress stringified it. Nested selection '
    + 'is `expand`, which the engine resolves via batch `$in` queries. This is a REQUEST '
    + 'surface — `QueryAST` is never stored in stack metadata (no view, dataset or report '
    + 'authors one), so there is no source for the chain to rewrite: the schema narrows to '
    + '`z.string()` and callers move their own select lists. ADR-0049 / ADR-0078, #4196.',
  acceptanceCriteria:
    'No caller puts an object in `fields[]`; related records AND single related columns are '
    + 'read through `expand`, with the foreign-key column retained in the projection so '
    + 'expansion has something to resolve. A `fields` entry that is not a string '
    + 'fails to parse with the removal prescription, and the list/query/export routes answer '
    + '400 INVALID_FIELD naming the retired form instead of the field `"[object Object]"`.',
};
