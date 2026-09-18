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
// registered under 18. The D2 conversion
// `cube-join-sql-and-relationship-removed` strips this key too, and it is owed
// for the mirror-image reason: the key was DEFAULTED, so the value was
// MATERIALIZED into every cube artifact the old schema ever parsed, whether or
// not its author typed it.
export const entry = 'data/CubeJoin:relationship';
