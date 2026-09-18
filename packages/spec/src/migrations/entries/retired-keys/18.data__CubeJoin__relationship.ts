// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18612 — ADR-0049 enforce-or-remove, the same ruling and the same diff as
// `data/CubeJoin:sql`. `CubeJoin.relationship` carried a
// `.default('many_to_one')` and nothing dispatched on the cardinality, so
// `one_to_many` parsed, changed no SQL, and the aggregate silently kept the
// many-to-one arithmetic. Two service-analytics fixtures authored
// `relationship: 'belongsTo'` — a value the enum never declared — which is its
// own evidence that nothing validated or read the key.
//
// Same route and same registration reasoning as the `sql` entry beside this
// one: strict deletion plus a `guidance` prescription on the `strictObject`,
// registered under 18, no D2 conversion, the judgement carried by the D3
// semantic entry `cube-join-sql-and-relationship-retired`.
export const entry = 'data/CubeJoin:relationship';
