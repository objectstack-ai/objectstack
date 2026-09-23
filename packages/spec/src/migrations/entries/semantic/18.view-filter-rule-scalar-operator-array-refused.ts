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
    + 'between, so the entire scalar class was declared and, from #6227 until this change, '
    + 'not judged. '
    + '⚠️ This REVERSES a reading recorded in the sibling entry '
    + 'view-filter-rule-value-shaped-by-operator, which listed a scalar operator carrying an '
    + 'array as deliberately accepted because it 「lowers to a bare deep-equality comparand, '
    + 'which every backend answers」. The backends a lowered view rule reaches are four, and '
    + 'at this release they do not agree, so each is named rather than generalised. The SQL '
    + 'family REFUSES: the lowered node reaches driver-sql\'s bare field-value loop, which '
    + 'asserts the comparand against its own SCALAR_COMPARAND_OPERATORS set; an array is none '
    + 'of the six accepted comparand types the platform declares in '
    + 'ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE, so the comparand is refused with the withheld '
    + 'INVALID_FILTER / 400 envelope — and with it the driver-turso and driver-sqlite-wasm '
    + 'drivers built on driver-sql, and turso\'s remote transport. driver-memory REFUSES the '
    + 'same shape in the same envelope (its assertFilterConditionShape throws on an array in '
    + 'the implicit-equality position). The formula matcher EXCLUDES every row, a row whose '
    + 'stored value IS the array included. driver-mongodb ANSWERS: its translateFilter passes '
    + 'the array through unchanged and the engine\'s shared comparand doors '
    + '(normalizeFilterComparandTypes, assertListComparandShapes) both pass the shape, so the '
    + 'server applies MongoDB\'s equality rule for an array operand — a row matches when its '
    + 'stored array equals the value or holds the value as one of its elements, and a row '
    + 'storing the scalar does not match. That MongoDB reading is taken at the driver\'s '
    + 'compile face, at those engine doors and through mingo 7.2.4, which applies that rule; '
    + 'a live mongod instance was NOT measured. Method: driver-sql on SQLite, driver-memory, '
    + 'the formula matcher, driver-mongodb\'s translateFilter and mingo were each run on the '
    + 'lowered node beside a scalar and an $in control, and this change\'s review also ran '
    + 'driver-sql on a live PostgreSQL 16 (refused before any SQL statement was emitted), '
    + 'driver-sqlite-wasm, and turso\'s remote transport over the repository\'s libsql stub; '
    + 'MySQL and a live Turso server were NOT measured. None of the four reads the array as '
    + 'the SCALAR the operator declares, so the earlier reading was the one that widened the '
    + 'accept set past the query path: at this release a stored view carrying the shape gets '
    + 'a 400 from the SQL family and driver-memory and no rows from the formula matcher, and '
    + 'on MongoDB it selects by a predicate the rule never wrote. The narrowing refuses what '
    + 'the SQL family and driver-memory already refuse and goes no further, because a schema '
    + 'that refuses more than the query path does would reject stored metadata that runs '
    + 'correctly. '
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
    + 'Worth knowing before you rewrite, as each backend a lowered view rule reaches answers '
    + 'such a rule at this release: the SQL family and driver-memory answer it with 400 '
    + 'INVALID_FILTER, and the formula matcher excludes every row. driver-mongodb returns '
    + 'rows, but not the ones the operator declares: the array reaches the server unchanged, '
    + 'where MongoDB\'s equality rule for an array operand selects a row whose stored array '
    + 'equals the value or holds it as one of its elements, and not a row storing the scalar '
    + '— read at the driver\'s compile face and through mingo 7.2.4; a live mongod instance '
    + 'was NOT measured. If you are upgrading from 17.x, your release may have answered '
    + 'differently: driver-memory refuses the shape from 17.4.0, and its published 17.3.0 '
    + 'returned the row stored as the array (run in this change\'s review; which other rows '
    + 'it selected, nested arrays included, was NOT measured); whether any earlier SQL-family '
    + 'release answered the shape was NOT measured. Either way, re-check what the view is '
    + 'supposed to show rather than assuming the old result set was correct. A one-element '
    + 'array is the case to read closest: its two corrected spellings — value: "won" on '
    + 'equals, and operator: "in" with value: ["won"] — select the same rows, so the result '
    + 'set cannot tell you which the metadata meant, and only the author knows.',
};
