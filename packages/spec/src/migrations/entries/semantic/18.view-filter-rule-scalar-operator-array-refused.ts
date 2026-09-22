// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The scalar half of the coupling #6227 declared and did not judge. Recorded
// here rather than amended onto `view-filter-rule-value-shaped-by-operator`
// because that entry's own prose states the OPPOSITE reading as accepted, and
// an upgrade guide that quietly rewrites a shipped prescription leaves the
// reader who followed it with no trace of why their metadata now fails.
export const entry: SemanticMigration = {
  id: 'view-filter-rule-scalar-operator-array-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'ui.ViewFilterRule value on a SCALAR operator — an ARRAY where the operator takes one '
    + 'value (equals, not_equals, contains, not_contains, icontains, starts_with, ends_with, '
    + 'greater_than, less_than, greater_than_or_equal, less_than_or_equal, before, after), on '
    + 'every carrier of ViewFilterRuleSchema: ListView.filter, a list view tab filter, '
    + 'Page.filterBy, a related-list filter, a lookup picker filter, and the filter and '
    + 'defaultFilters keys of the object-* page blocks',
  replacement:
    'one scalar — a string, number, boolean or null. A rule written '
    + 'value: ["won"] on equals becomes value: "won"; a rule that really did mean membership '
    + 'of a list becomes operator: "in" with the array unchanged. The list operators (in / '
    + 'not_in) and the range operator (between) are untouched and still take their arrays. '
    + 'The unary operators (is_empty / is_not_empty / is_null / is_not_null) are untouched '
    + 'too: they take their direction from the operator NAME and their value position is '
    + 'discarded, so whatever sits there still parses, array included. An omitted value is '
    + 'still an omitted value',
  reason:
    '#19514, closing the protocol half of objectui#9050 ruling C-prime (maintainer '
    + '2026-09-20, verbatim, untranslated): 「the differences are the protocol\'s to close」. '
    + 'The value key\'s own published description has declared this rule since #6227 — '
    + '「every other operator takes a scalar」 — and the refinement that implements the '
    + 'coupling returned early for every operator that is neither a list operator nor '
    + 'between, so the entire scalar class was declared and never judged. '
    + '⚠️ This REVERSES a reading recorded in the sibling entry '
    + 'view-filter-rule-value-shaped-by-operator, which listed a scalar operator carrying an '
    + 'array as deliberately accepted because it 「lowers to a bare deep-equality comparand, '
    + 'which every backend answers」. Re-measured at source for this entry: the lowered node '
    + 'reaches driver-sql\'s bare field-value loop, which asserts the comparand against its '
    + 'own SCALAR_COMPARAND_OPERATORS set; an array is none of the six accepted comparand '
    + 'types the platform declares in ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE, so the '
    + 'comparand is refused with the withheld INVALID_FILTER / 400 envelope, and every '
    + 'in-memory matcher excludes every row for the same reason. So the earlier reading was '
    + 'the one that widened the accept set past the query path, and a stored view carrying '
    + 'this shape PASSED the protocol and then selected nothing. The narrowing mirrors the '
    + 'query path exactly and goes no further, which is the #5685 boundary this family has '
    + 'held since it was written. '
    + 'Metadata AT REST is deliberately NOT rewritten and this entry adds no D2 conversion: a '
    + 'SemanticMigration converts nothing by its own type, and the stored-row pass replays D2 '
    + 'conversions only. Coercing at load would be the platform guessing intent — an array of '
    + 'two on equals has no honest single value, and picking the first is a different '
    + 'predicate. The read path does not re-validate stored rows, so a stored view keeps '
    + 'loading; what changes is that RE-SAVING it is refused at the value path, instead of '
    + 'storing a filter that 400s. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep your authored views, pages and object-* blocks for a filter rule whose operator is '
    + 'none of in / not_in / between / the four unary operators and whose value is an array, '
    + 'then decide per rule which of the two things it meant: one value, or membership. '
    + 'os validate and os lint report each one by path with the operator, the received shape '
    + 'and both corrected spellings, so the sweep is mechanical rather than by eye. '
    + 'Worth knowing before you rewrite: such a rule has never returned filtered rows — it '
    + 'answered 400 INVALID_FILTER on the SQL family and excluded every row on the in-memory '
    + 'matchers — so re-check what the view is supposed to show rather than assuming the old '
    + 'result set was correct. A one-element array is the case to read closest: '
    + 'value: ["won"] on equals and operator: "in" with value: ["won"] select the same rows '
    + 'today, and only the author knows which the metadata meant.',
};
