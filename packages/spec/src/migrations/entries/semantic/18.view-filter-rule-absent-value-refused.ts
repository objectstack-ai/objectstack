// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The absent-value half of the coupling #6227 declared, recorded beside its
// array half (`view-filter-rule-scalar-operator-array-refused`) rather than
// amended onto it: that entry's own replacement prose told an upgrading author
// "an omitted value is still an omitted value", and an upgrade guide that
// quietly rewrites a shipped prescription leaves the reader who followed it with
// no trace of why their metadata now fails.
export const entry: SemanticMigration = {
  id: 'view-filter-rule-absent-value-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'ui.ViewFilterRule with NO value on an operator that takes one — the value key omitted, '
    + 'or present and undefined, on equals, not_equals, contains, not_contains, icontains, '
    + 'starts_with, ends_with, greater_than, less_than, greater_than_or_equal, '
    + 'less_than_or_equal, before or after (an alias spelling of any of them included), on '
    + 'every carrier of ViewFilterRuleSchema',
  replacement:
    'the value the rule compares against — value: "open" on equals, value: "2026-01-01" on '
    + 'after. A rule that meant "the field has no value" becomes one of the four operators that '
    + 'take none — is_empty / is_not_empty / is_null / is_not_null — which read their direction '
    + 'from their name and still parse with or without a value. A rule that was an unfinished '
    + 'row is deleted. The list operators (in / not_in) and the range operator (between) '
    + 'refused an absent value before this change and still do, in their own words',
  reason:
    '#19751. The value key\'s own published description has declared since #6227 that every '
    + 'operator outside the list, range and unary sets takes a scalar, and that only the unary '
    + 'operators ignore the key; the refinement implementing the coupling returned early on an '
    + 'absent value for every operator, so a rule with no value parsed green on all thirteen '
    + 'scalar operators. The query path refuses the same rule: both lowerings of a stored rule — '
    + 'the console\'s and the REST lookup-picker route\'s — emit it as the two-element '
    + '[field, operator] node, which the filter-AST lowering reads as an undefined comparand '
    + 'and refuses with INVALID_FILTER / 400, measured for all thirteen operators. Nothing '
    + 'between storage and the query drops the rule, so one such rule failed every query that '
    + 'read its view, the view\'s other rules included. The first-party producer does not write '
    + 'the shape: the console filter builder drops a row whose operator takes a value and whose '
    + 'value is missing before it saves, and the drill-down save-as-view path checks each rule '
    + 'against this schema before persisting it (read at the pinned objectui commit). '
    + 'Metadata AT REST is deliberately NOT rewritten and this entry adds no D2 conversion: '
    + 'there is no value to infer, and writing a value, switching to a unary operator and '
    + 'deleting the rule are three different predicates only the author can choose between. '
    + 'The read path does not re-validate stored rows (the reading the sibling entry '
    + 'view-filter-rule-scalar-operator-array-refused records), so a stored view keeps loading '
    + '— and keeps failing its queries, as it did before this change; what changes is that '
    + 'RE-SAVING it is refused at the value path, naming the operator and the field. '
    + 'ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep your authored views, pages and object-* blocks for a filter rule that has no value '
    + 'key and whose operator is none of the four unary operators, then decide per rule which '
    + 'of three things it meant: a comparison (write the value), a test for emptiness (switch '
    + 'to is_empty / is_not_empty / is_null / is_not_null), or an unfinished row (delete it). '
    + 'os validate reports each one by path with the operator and the field, so the sweep is '
    + 'mechanical rather than by eye. A view carrying one of these rules was refusing every '
    + 'query before this change, so re-check what it is supposed to show rather than assuming '
    + 'any earlier result set.',
};
