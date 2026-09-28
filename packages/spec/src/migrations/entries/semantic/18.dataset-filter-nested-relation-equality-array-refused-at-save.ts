// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The analytics carriers' half of filter-equality-array-comparand-refused-at-save.
// That entry refuses an equality-slot list on save wherever the shared face
// refuses it, and names a list inside a nested-relation condition as a position
// it deliberately leaves to execution. This one closes that position on the two
// carriers the analytics where door charts — a dataset filter and a measure
// filter — because that door flattens a nested relation to a dotted member and
// refuses the list there. Recorded as its own entry because the surface is
// narrower (two carriers, one position) and the shared schema does not move.
export const entry: SemanticMigration = {
  id: 'dataset-filter-nested-relation-equality-array-refused-at-save',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'ui.Dataset filter and ui.DatasetMeasure filter — an ARRAY as an EQUALITY comparand on a '
    + 'field INSIDE a nested-relation condition, now refused when the dataset is PARSED: the '
    + 'implicit form { account: { region: [...] } } and the explicit form '
    + '{ account: { region: { $eq: [...] } } }, the empty array included, at any relation depth '
    + 'and under $and / $or / $not. Every other schema that carries a FilterCondition keeps the '
    + 'shared schema\'s reach',
  replacement:
    'the operator the list was standing in for, on the same field inside the same relation, '
    + 'exactly as in filter-equality-array-comparand-refused-at-save. "One of these values" is '
    + '$in: { account: { region: { $in: ["a", "b"] } } } (authoring spelling "in"). "The stored '
    + 'multi-value field holds this value" is $contains with ONE member (authoring spelling '
    + '"contains"), and an $or of those for any-of. A filter that meant a single value writes that '
    + 'value: { account: { region: "a" } }. The list operators keep their arrays, empty lists '
    + 'included; every scalar, null above all, is untouched; and $ne is NOT judged by this entry',
  reason:
    'Measured on origin/main 9e7824a445 before the change: DatasetSchema parsed a dataset whose '
    + 'filter was { account: { region: ["a"] } }, and one whose measure filter was '
    + '{ account: { region: { $eq: ["a"] } } }, GREEN — while the analytics where door, which '
    + 'charts both carriers on every path (the native-SQL and ObjectQL strategies and the draft '
    + 'preview), flattens the relation to the dotted member account.region and hands the list to '
    + 'the shared comparand-shape face, which refuses it with INVALID_FILTER / 400. So such a '
    + 'dataset saved clean and every chart built on it failed, for a different person, later. '
    + 'The shared FilterConditionSchema does not descend a field spec with no $ key, because the '
    + 'engine reads one as a deep-equality comparand; ruling A of 2026-09-24, which made the schema '
    + 'door refuse what the compile face refuses, drew the line there and it stays there. Triage on '
    + '2026-09-25 routed the fix to the two analytics carriers instead, rather than stop the '
    + 'analytics door descending, which would change what a nested list means: they refine their filter with the analytics door\'s own walk '
    + '($and / $or arrays and $not descended, other $ keys skipped, a plain object with no $ key '
    + 'descended as a nested relation at any depth) and refuse, inside a nested relation only, '
    + 'exactly what that door refuses there, in the face\'s words from the one builder both doors '
    + 'import. The one difference is that the door appends the location (at '
    + 'where.account.region) and the carrier does not, because its issue carries the location as '
    + 'its path (filter.account.region, measures.0.filter.account.region.$eq). A list outside a '
    + 'nested relation is the shared schema\'s refusal and is reported once. No filter changes '
    + 'meaning: the refusal moves from chart time to save. Metadata AT REST is not rewritten and '
    + 'this entry adds no D2 conversion, for the reason the runtime entry gives: an array on '
    + 'equality has no single honest value. The read path does not re-validate stored rows, so a '
    + 'stored dataset keeps loading; what changes is that re-saving it through the metadata '
    + 'protocol (422 INVALID_METADATA), defineStack or os validate is refused at the filter\'s '
    + 'path. Such a filter has failed every chart since the analytics door began refusing it, so '
    + 'the refusal is a repair and not a loss. In-repo census at 9e7824a445: no dataset or '
    + 'measure filter in examples, platform objects, docs or skills carries the shape; deployed '
    + 'datasets were NOT measured. ADR-0021 / ADR-0087.',
  acceptanceCriteria:
    'Validate every stack and re-save every stored dataset: os validate or defineStack, and a '
    + 'save through the metadata protocol, report each list in an equality slot inside a nested '
    + 'relation by path, with the field, the received list and both remedies, so the sweep of the '
    + 'two carriers is mechanical. Decide per filter what it meant — one of these values ($in), '
    + 'the stored list holds a value ($contains, an $or of them for several), or one value — and '
    + 're-check what each chart is supposed to show: the filter had been failing every chart. A '
    + 'filter that reaches the analytics door by any other route, such as a caller where or a '
    + 'dataset selection runtimeFilter, is still refused only when it is charted, with '
    + 'INVALID_FILTER / 400 naming the field and the path.',
};
