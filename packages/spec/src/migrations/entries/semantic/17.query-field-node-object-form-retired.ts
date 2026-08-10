// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-field-node-object-form-retired',
  surface: 'data.query.fields',
  replacement: "expand (`expand: { owner: { object: 'user', fields: ['name'] } }`), or a dotted path for a single related column (`fields: ['owner.name']`)",
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
    'No caller puts an object in `fields[]`; related records are read through `expand` and '
    + 'single related columns through dotted paths. A `fields` entry that is not a string '
    + 'fails to parse with the removal prescription, and the list/query/export routes answer '
    + '400 INVALID_FIELD naming the retired form instead of the field `"[object Object]"`.',
};
