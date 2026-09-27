// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The SCHEMA door's half of filter-equality-array-comparand-refused. That entry
// refuses the shape at the runtime filter doors, where a query is compiled; this
// one refuses the same shape where a filter is SAVED, in the same words, so a
// stored filter stops publishing clean and failing later for someone else.
// Recorded as its own entry because the surface is different (every schema that
// carries a FilterCondition, and the $eq operator slot) and because what an
// upgrading author sees changes at a different moment: on save, not on query.
export const entry: SemanticMigration = {
  id: 'filter-equality-array-comparand-refused-at-save',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.FilterCondition and the $eq slot of data.FieldOperators — an ARRAY as an EQUALITY '
    + 'comparand, now refused when the document is PARSED: the implicit form { field: [...] } and '
    + 'the explicit form { field: { $eq: [...] } }, the empty array included, on every schema '
    + 'that carries a FilterCondition — a dataset filter and a dataset measure filter, a '
    + 'dashboard widget filter and an options-source filter, a report and joined-report-block '
    + 'runtimeFilter, a field relatedListFilter and a rollup summaryOperations filter, a '
    + 'solution-blueprint summary filter, an analytics query where, a dataset selection '
    + 'runtimeFilter, a query where and having, the data-engine aggregate call\'s having, an '
    + 'aggregation filter and a query-filter where '
    + '— plus FieldOperatorsSchema.$eq, its documentation copy EqualityOperatorSchema.$eq, and '
    + 'the NormalizedFilter AST that validates against it',
  replacement:
    'the operator the list was standing in for, exactly as in '
    + 'filter-equality-array-comparand-refused. "One of these values" is $in: '
    + '{ field: { $in: ["a", "b"] } } (authoring spelling "in"). "The stored multi-value field '
    + 'holds this value" is $contains with ONE member: { field: { $contains: "a" } } (authoring '
    + 'spelling "contains"), and an $or of those for any-of. A filter that meant a single value '
    + 'writes that value: { field: "a" }. The list operators ($in / $nin / $between) keep their '
    + 'arrays, empty lists included; every scalar equality comparand, null above all, a Date and '
    + 'a { $field } reference are untouched; and $ne is NOT judged by this entry',
  reason:
    'Ruling on #19889 (record 5805248669, letter A): FilterConditionSchema (implicit equality) '
    + 'and FieldOperatorsSchema.$eq refuse an array comparand at parse, with the SAME remedy '
    + 'text the shared compile face emits — one constant, two doors; a stored filter carrying '
    + 'the shape is refused loudly on its next save, and never silently dropped, because a '
    + 'dropped filter shows MORE rows than intended. Measured on origin/main a0920b42dc before '
    + 'the change: a dataset whose filter was { stage: ["won", "lost"] }, and one whose measure '
    + 'filter was { stage: { $eq: ["won", "lost"] } }, both parsed GREEN, as did '
    + 'FilterConditionSchema and FieldOperatorsSchema on the bare shapes, while the shared '
    + 'comparand-shape face refused both with INVALID_FILTER / 400. So such a document '
    + 'published clean and then failed every query that used it, for a different person, '
    + 'later. The schema door now prints the face\'s own sentence, from one builder both doors '
    + 'import; the only difference is that the face appends the location (at where.stage) and '
    + 'the schema door does not, because its issue carries the location as its path '
    + '(filter.stage, measures.0.filter.stage.$eq). The reach is the face\'s and no wider: the '
    + 'field entries of a condition and of every $and / $or / $not member, but NOT a field spec '
    + 'with no $ key (a nested-relation or deep-equality condition), which the face never '
    + 'descends either. ⚠️ Three positions therefore still refuse only at execution. (1) A list '
    + 'inside a nested-relation condition, { account: { region: ["a"] } }: the analytics where '
    + 'door flattens that to the dotted member account.region and refuses it when a dataset or '
    + 'measure filter is charted. (2) The where option of the data-engine calls (find, count, '
    + 'update, delete, aggregate, vector find): its type is a union whose first arm is an open '
    + 'record, so it parses and the face refuses it when the call runs. (3) $ne carrying a '
    + 'list, which no ruling has decided. Two request doors parse these carriers and now answer '
    + 'the shape before the analytics compiler does: the REST dataset selection (its '
    + 'runtimeFilter) and the analytics query body (its where) refuse with VALIDATION_FAILED / '
    + '400 and this sentence at the field, one step ahead of the compiler\'s INVALID_FILTER / '
    + '400. Metadata AT REST is not rewritten and this entry adds no D2 conversion, for the '
    + 'reason the runtime entry gives: an array on equality has no single honest value. The '
    + 'read path does not re-validate stored rows, so a stored document keeps loading; what '
    + 'changes is that re-saving it through the metadata protocol (422 INVALID_METADATA), '
    + 'defineStack or os validate is refused at the filter\'s path. Such a filter has failed '
    + 'every query since the runtime entry, and on the SQL family before it at the top level, '
    + 'so the refusal is a repair and not a loss. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every stored document that carries a filter: os validate '
    + 'or defineStack, and a save through the metadata protocol, report each array in an '
    + 'equality slot by path with the field, the received list and both remedies, so the sweep '
    + 'is mechanical for the carriers listed in the surface. Decide per filter what it meant — '
    + 'one of these values ($in), the stored list holds a value ($contains, an $or of them for '
    + 'several), or one value — and re-check what the surface is supposed to show rather than '
    + 'assuming the old rows were right: on most backends the filter had been failing every '
    + 'query. ⛔ A clean re-save is NOT a complete sweep for the three positions the reason '
    + 'names: grep nested-relation conditions and data-engine where options for a field whose '
    + 'value is a list, and exercise them, where the runtime doors refuse with INVALID_FILTER '
    + '/ 400 naming the field and the path.',
};
