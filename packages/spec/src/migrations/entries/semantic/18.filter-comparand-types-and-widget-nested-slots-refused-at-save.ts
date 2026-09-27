// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The second half of the schema door's parity with the query faces. The first
// (filter-query-face-comparands-refused-at-save) asked the comparand-SHAPE face
// and the flag rule; this one asks the comparand-TYPE face too, and makes a
// dashboard widget filter an analytics carrier, so the slots inside a nested
// relation that the analytics where door judges are judged on save there as on
// a dataset filter. The faces stay the judges; the save door only asks them.
export const entry: SemanticMigration = {
  id: 'filter-comparand-types-and-widget-nested-slots-refused-at-save',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.FilterCondition — a comparand the comparand-type face refuses, now refused when the '
    + 'document is PARSED: a plain object where a single value belongs (an $eq, $ne, ordering, '
    + 'text or flag comparand such as { a: 1 }, including a { $field } whose name is not a '
    + 'string), a Map, a class instance, a function, a Symbol, undefined, or a bigint beyond '
    + 'plus or minus 2^53, whether it is the comparand itself, an implicit-equality comparand '
    + 'or an $in / $nin / $between list member. On every schema that carries a FilterCondition, '
    + 'at the reach the save door already had (the field entries of a condition and of every '
    + '$and / $or / $not member); and, on a dataset filter, a dataset measure filter and now a '
    + 'dashboard widget filter, INSIDE a nested-relation condition as well, for these shapes and '
    + 'for every shape the earlier entry names — so ui.DashboardWidget.filter gains the '
    + 'nested-relation reach of the two dataset carriers',
  replacement:
    'a value of one of the six accepted comparand types — a string, number, bigint within plus '
    + 'or minus 2^53, boolean, null or Date — or a { $field: "column" } reference where a column '
    + 'is meant. A value set belongs in $in; an absent value is the null predicate ($eq null / '
    + '$ne null) or an omitted key, never undefined; a bigint beyond 2^53 is compared as a '
    + 'string or within range. Inside a nested relation on a widget filter, write the same '
    + 'spelling the top-level refusal prescribes. A Date, a { $field } reference, a {placeholder} '
    + 'string resolved at request time (such as {current_user_id} or {today}) and a bigint '
    + 'within 2^53 are untouched, and the save door keeps a bigint as written',
  reason:
    'The save door narrows to exactly what the query faces already refuse (#20116, stage 2 of '
    + 'the collector). The comparand-type face (normalizeFilterComparandTypes, the #7872 '
    + 'ruling\'s accepted set) refuses these values on every query: parseFilterAST, the engine '
    + 'seam, the analytics where door and the read-scope compiler all run it. Measured on '
    + 'origin/main 17bd3187 before the change: FilterConditionSchema, a dataset filter, a '
    + 'dataset measure filter, a dashboard widget filter, a report runtimeFilter and a joined '
    + 'report block runtimeFilter each parsed GREEN for { stage: { $eq: { a: 1 } } }, '
    + '{ stage: { $in: [{ a: 1 }] } } and a Map comparand, top level and nested, while the type '
    + 'face and the analytics where door refused each with INVALID_FILTER / 400. And a '
    + 'dashboard widget filter parsed GREEN for { acct: { stage: { $in: ["won", null] } } } and '
    + 'for a list in a nested equality slot, which the analytics where door refuses when the '
    + 'widget is charted, because only the two dataset carriers had the nested-relation walk. '
    + 'The save door now asks the type face itself, read-only, after the shape face, so it '
    + 'refuses exactly what the face refuses and passes what it passes; one slot raises one '
    + 'refusal, in the query doors\' order (shape, then type, then the flag rule), in the face\'s '
    + 'own words less its location clause. The widget filter declares the same analytics-carrier '
    + 'filter as the dataset carriers, so its nested-relation slots are judged by the same walk. '
    + '⚠️ One position still refuses only at execution: a refused shape INSIDE a nested-relation '
    + 'condition on a report runtimeFilter or a joined report block runtimeFilter, which reach '
    + 'the analytics where door too but carry the shared schema\'s reach only; each adopts the '
    + 'carrier in one line. Metadata AT REST is not rewritten and this entry adds no D2 '
    + 'conversion: none of these values has a single honest meaning as a comparand, which is why '
    + 'each was refused. The read path does not re-validate stored rows, so a stored document '
    + 'keeps loading; re-saving it through the metadata protocol (422 INVALID_METADATA), '
    + 'defineStack or os validate is refused at the filter\'s path. A JSON document can carry '
    + 'only the plain-object cells; the others arrive only from TypeScript authoring. Such a '
    + 'filter has failed every query since the type face\'s ruling, so the refusal is a repair '
    + 'and not a loss. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every stored document that carries a filter: os validate '
    + 'or defineStack, and a save through the metadata protocol, report each refused slot by '
    + 'path, for example widgets.0.filter.acct.stage.$in.1 or filter.stage.$eq, with the type '
    + 'face\'s sentence and the accepted set. A producer census before the change — a literal '
    + 'scan with a lit control per shape over examples, the non-test packages of this repository, '
    + 'the console repository at its pin and the cloud repository, plus a runtime walk of every '
    + 'filter in the example stacks — found no authored filter carrying one of these values and '
    + 'no dashboard widget filter with a nested-relation condition. ⛔ A clean save is NOT a '
    + 'complete sweep for the one position the reason names: search report runtimeFilters for a '
    + 'nested-relation condition whose inner field carries one of these shapes, and chart it, '
    + 'where the analytics where door refuses with INVALID_FILTER / 400 naming the path.',
};
