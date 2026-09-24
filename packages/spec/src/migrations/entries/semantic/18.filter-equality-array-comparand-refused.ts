// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The RUNTIME door's half of the question the sibling entry
// view-filter-rule-scalar-operator-array-refused answered at the view-rule
// schema door: that entry refuses an array on a scalar view operator when the
// rule is authored; this one refuses the lowered shape itself, at the shared
// comparand-shape face every query crosses, whichever vocabulary produced it.
// Recorded as its own entry because the surface is different (the $ dialect
// and the FilterArray sugar, not ViewFilterRule) and because its scope stops at
// the EQUALITY slot, where the view entry covers every scalar operator.
export const entry: SemanticMigration = {
  id: 'filter-equality-array-comparand-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.FilterCondition — an ARRAY as an EQUALITY comparand, at the runtime filter doors (the '
    + 'shared comparand-shape face that parseFilterAST and the engine lowering seam both run): the '
    + 'implicit form { field: [...] } — which the FilterArray sugar ["field", "equals", [...]] '
    + 'lowers to, and likewise "=", "==" and "eq" — and the explicit form { field: { $eq: [...] } }, '
    + 'at any depth under $and / $or / $not, the empty array included',
  replacement:
    'the operator the list was standing in for. "One of these values" is $in: '
    + '{ field: { $in: ["a", "b"] } } (authoring spelling "in"). "The stored multi-value field '
    + 'holds this value" is $contains with ONE member: { field: { $contains: "a" } } (authoring '
    + 'spelling "contains"), and an $or of those for any-of. A filter that meant a single value '
    + 'writes that value: { field: "a" }. The list operators ($in / $nin / $between) keep their '
    + 'arrays, empty lists included; every scalar equality comparand, null above all (the '
    + 'has-no-value predicate), is untouched; and $ne is NOT judged by this entry',
  reason:
    'Maintainer ruling on #19757 (record 5793368540, batch 217 item 3, letter 乙, 「217 同意」): '
    + 'an array in the implicit-equality slot is refused at the shared face, for every driver at '
    + 'once — no alias, no grace window. The comparand-shape face declared that moving a rule '
    + 'to it 「closes that door for every driver at once」, and before this change it judged '
    + 'only the list-operator slot; the equality slot passed both shared doors and each backend '
    + 'answered it alone. Measured on the lowered node { tags: ["a"] } at this release, beside a '
    + 'scalar and an $in control. driver-sql on SQLite REFUSED it with INVALID_FILTER / 400 at '
    + 'the top level, and nested under $and / $or / $not answered 500 DATABASE_ERROR instead '
    + '(driver-turso and driver-sqlite-wasm are built on driver-sql and were not run separately). '
    + 'driver-memory REFUSED it with INVALID_FILTER / 400 at every depth. The formula matcher '
    + 'returned no row, including a row storing exactly ["a"]. driver-mongodb ANSWERED it: its '
    + 'translateFilter emits the array unchanged, and MongoDB equality on an array operand '
    + 'selects a stored array equal to ["a"] or holding ["a"] as an element — mingo 7.2.4, the '
    + 'named proxy, over ["a"], "a", ["a","b"], ["b","a"], [["a"],"x"], [["a"]], "b" and [] '
    + 'selected ["a"], [["a"],"x"] and [["a"]]. The service-analytics filter normalizer read the '
    + 'FilterArray form as MEMBERSHIP: ["stage", "=", ["won", "lost"]] charted as stage IN '
    + '(won, lost); that form now gets the refusal too, while its OBJECT form, which that '
    + 'normalizer does not route through the shared face, still reads as membership. A live mongod, MySQL, PostgreSQL and a live '
    + 'Turso server were NOT measured. So one stored filter was a 400 on most backends and a '
    + 'silent, differently-shaped row set on one. The shared face now refuses it with '
    + 'INVALID_FILTER / 400 before any driver runs, naming the field, the path and both remedies. '
    + 'The ruling records the hosted product as running on the SQL family, where the top-level '
    + 'shape was already a 400, so the population that can observe a change is self-hosted '
    + 'driver-mongodb, plus any filter nested under a combinator on the SQL family (a 500 '
    + 'becomes a 400). $ne carrying an '
    + 'array measured the same split and is deliberately left to its own ruling. Metadata AT '
    + 'REST is not rewritten and this entry adds no D2 conversion: an array on equality has no '
    + 'single honest value, and choosing between $in and $contains is the author\'s call, not '
    + 'the platform\'s. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep stored filters, dataset and widget filters, flow node filters and code that builds '
    + 'a where for a field whose value is an array — { field: [...] }, { field: { $eq: [...] } }, '
    + 'or a FilterArray triple on =, ==, eq or equals carrying an array — then decide per filter '
    + 'what it meant: one of these values ($in), the stored list holds a value ($contains, an '
    + '$or of them for several), or one value. Each is refused at query time with INVALID_FILTER '
    + '/ 400 naming the field and the path, so a test suite that exercises the query finds '
    + 'every one. A dashboard or dataset filter written as the FilterArray sugar with an array on '
    + 'equality charted as membership through the analytics normalizer; $in is the spelling that '
    + 'charts the same rows. On driver-mongodb re-check what the query is supposed to return rather than '
    + 'assuming the old rows were right: the old answer was MongoDB array equality, which '
    + 'neither $in nor $contains reproduces.',
};
