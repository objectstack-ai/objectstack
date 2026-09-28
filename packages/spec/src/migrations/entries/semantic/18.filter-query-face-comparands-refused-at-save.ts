// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The SCHEMA door's half of every comparand refusal the query faces already
// give. The shared comparand-shape face and the query faces' boolean-flag checks
// refuse these slots on every query; this entry records that the same slots are
// now refused where a filter is SAVED, so a stored filter stops publishing clean
// and failing later for someone else. The face itself is the judge at the save
// door, so the two doors cannot drift apart.
export const entry: SemanticMigration = {
  id: 'filter-query-face-comparands-refused-at-save',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.FilterCondition — every comparand slot the query faces refuse, now refused when the '
    + 'document is PARSED: a $null or $exists flag that is not a boolean (a string such as '
    + '"false", null, a number); a null $gt / $gte / $lt / $lte comparand; an $in or $nin '
    + 'comparand that is not a list, or a list holding null; a $between comparand that is not a '
    + 'two-element list, or whose endpoint is null, blank or a { $field } reference; and an '
    + 'array under $ne. On every schema that carries a FilterCondition: a dataset filter and a '
    + 'dataset measure filter, a dashboard widget filter and an options-source filter, a report '
    + 'and joined-report-block runtimeFilter, a field relatedListFilter and a rollup '
    + 'summaryOperations filter, a solution-blueprint summary filter, an analytics query where, '
    + 'a dataset selection runtimeFilter, a query where and having, the data-engine aggregate '
    + 'call\'s having, an aggregation filter and a query-filter where; and, on a dataset filter '
    + 'and a dataset measure filter only, the same slots INSIDE a nested-relation condition',
  replacement:
    'the spelling the refusal prescribes, which is the one the query faces already prescribe. '
    + 'A flag is the boolean itself: $null true is "has no value", $null false is "has a value", '
    + 'and $exists is the inverse. Absence is the null predicate, never null in an ordering or '
    + 'list position: $eq null is "has no value", $ne null is "has a value", and "one of these '
    + 'values OR has no value" is an $or of an $in and a $null true. A single value for $in is a '
    + 'one-member list, or plain equality. A range is two bounds in a two-element list; a range '
    + 'bounded on one side is a $gte or a $lte; a column-to-column range is a $gte and a $lte '
    + 'whose comparands are { $field } references. "None of these values" is $nin, never $ne '
    + 'with a list. The null predicate itself, a { $field } reference as a whole comparand, '
    + 'an empty $in or $nin list and a whitespace endpoint are untouched',
  reason:
    'The save door narrows to exactly what the query faces already refuse (the family of '
    + 'comparand shapes the save door accepted and the query faces refused; the $ne member is '
    + 'route A, the same reach and the same one '
    + 'sentence as the equality slot of filter-equality-array-comparand-refused-at-save). The '
    + 'shared comparand-shape face refuses on every query a null ordering comparand (ruled '
    + '2026-09-01), a non-list $in / $nin and a malformed $between range, a null list member or '
    + 'endpoint (ruled 2026-08-31), a blank endpoint (ruled 2026-09-20), a { $field } endpoint '
    + '(ruled 2026-08-11) and an array under $ne (ruled 2026-09-24); every query face refuses a '
    + 'non-boolean $null / $exists flag, because the backends read one in opposite directions. '
    + 'Measured on origin/main af32cf9a before the change: a dataset filter, a dataset measure '
    + 'filter, a dashboard widget filter and a report runtimeFilter each parsed GREEN for one '
    + 'instance of every shape the surface names, while the face refused each one with '
    + 'INVALID_FILTER / 400 and the analytics where door refused every one of them, the flags '
    + 'included. So such a document published clean and then failed every chart built on it. '
    + 'The save door now asks the face itself about each slot, so it refuses exactly what the '
    + 'face refuses and passes what the face passes; the words are the face\'s, or the '
    + 'sentence the enforced operator slot already prints for the same comparand, never the '
    + 'face\'s location clause, which the issue\'s path carries instead. The reach is the '
    + 'face\'s and no wider: the field entries of a condition and of every $and / $or / $not '
    + 'member, and NOT a field spec with no $ key (a nested-relation condition), which neither '
    + 'the face nor the drivers\' flag checks descend. The analytics where door DOES descend '
    + 'one (it flattens the relation to dotted members and judges each), so the two dataset '
    + 'carriers, whose own nested-relation walk already refused an equality list there '
    + '(dataset-filter-nested-relation-equality-array-refused-at-save), now ask the same '
    + 'judge about every slot inside a relation. ⚠️ So one position still refuses only at '
    + 'execution: a refused shape INSIDE a nested-relation condition on a dashboard widget '
    + 'filter or a report runtimeFilter, which reach the analytics where door too but carry '
    + 'the shared schema\'s reach only. Metadata AT REST is not rewritten and this entry adds no D2 '
    + 'conversion: none of these shapes has a single honest meaning (that is why each was '
    + 'refused), and a conversion would have to pick one. The read path does not re-validate '
    + 'stored rows, so a stored document keeps loading; re-saving it through the metadata '
    + 'protocol (422 INVALID_METADATA), defineStack or os validate is refused at the filter\'s '
    + 'path. Such a filter has failed every query since the runtime refusal of its shape, so '
    + 'the refusal is a repair and not a loss. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Validate every stack and re-save every stored document that carries a filter: os validate '
    + 'or defineStack, and a save through the metadata protocol, report each refused slot by '
    + 'path with the operator, the field and the prescription, so the sweep is mechanical for '
    + 'the carriers the surface lists. Decide per filter what it meant and write that spelling; '
    + 'on most backends the filter had been failing every query, so re-check what the surface '
    + 'is supposed to show rather than assuming the old rows were right. One producer was '
    + 'measured before the change: a filter builder that writes "is empty" / "is not empty" as '
    + 'an $in / $nin list holding null and the empty string (the Studio filter-condition widget, '
    + 'at the console pin of that date); what it wrote is refused on its next save. ⛔ A clean '
    + 'save is NOT a complete sweep for the one position the reason names: search dashboard '
    + 'widget filters and report runtimeFilters for a nested-relation condition whose inner '
    + 'field carries one of these shapes, and chart it, where the analytics where door refuses '
    + 'with INVALID_FILTER / 400 naming the field and the path.',
};
