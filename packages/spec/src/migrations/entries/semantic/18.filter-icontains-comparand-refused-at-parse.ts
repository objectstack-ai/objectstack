// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// One entry for two doors on purpose: the two vocabularies spell one operator
// and the rows being answered are one pair. Splitting it would put half the
// prescription in front of an author who wrote the other spelling.
export const entry: SemanticMigration = {
  id: 'filter-icontains-comparand-refused-at-parse',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'the case-insensitive contains comparand, in BOTH authoring vocabularies — the $ dialect '
    + 'key $icontains inside FilterConditionSchema (query where clauses, read-scope rules, '
    + 'dashboard and analytics filters) and the infix spelling icontains on '
    + 'ViewFilterRuleSchema (view, tab, page and block filters) — where the comparand is the '
    + 'EMPTY STRING or is not a string at all',
  replacement:
    'a NON-EMPTY STRING, or no condition at all. A comparand that was empty is a predicate '
    + 'that constrains nothing, so the repair is to DROP the condition rather than to write '
    + 'something in it. A comparand that was a number, boolean or null is written as the '
    + 'string it was meant to match: value 42 becomes value "42" only if a substring match on '
    + 'the two characters is really what was meant, and if it is not, the operator was the '
    + 'wrong one. On a view rule an OMITTED value is untouched — absence is not a comparand '
    + 'and this rule says nothing about it',
  reason:
    '#19514, out of objectui#9050 ruling C-prime (maintainer 2026-09-20, verbatim, '
    + 'untranslated): 「the differences are the protocol\'s to close」. The platform already '
    + 'DECLARED both refusals, as data, in this package: FILTER_TEXT_CASES carries a '
    + 'REJECTION row for an empty comparand and one for a non-string comparand, each with '
    + 'code INVALID_FILTER and each requiring the refusal to name the operator. All five '
    + 'driver packages run both rows in their own suites, and the drivers re-run for this '
    + 'change (driver-sql on SQLite, driver-memory, driver-mongodb\'s translateFilter) each '
    + 'refuse both comparands with INVALID_FILTER / 400; the formula matcher does not refuse '
    + 'them, it answers false for every row. Nothing applied them at PARSE on either '
    + 'vocabulary, so the '
    + 'protocol declared the refusal and then admitted the document that would hit it — the '
    + 'declared-not-enforced shape ADR-0049 exists to close. '
    + 'The narrowing is DERIVED from the table, not transcribed beside it: both doors call '
    + 'the published predicate isRefusedTextComparand and the published reason text '
    + 'textComparandRefusalReason, the pair lifted into this package at #18113 for exactly '
    + 'this reason, so a row added to the table reaches both doors without an edit at either. '
    + '$contains, $startsWith, '
    + '$endsWith, $like and $ilike keep the answer they give today, '
    + 'because widening by analogy is the table\'s decision and not a door\'s. '
    + 'The two vocabularies differ on one point and it is a fact about them rather than an '
    + 'extra rule: a view rule\'s value key is OPTIONAL, so an absent comparand is left '
    + 'unjudged there; the $ dialect has no absent, so an explicit undefined in a comparand '
    + 'slot is the refused non-string shape — the same reading the comparand-type door '
    + 'already takes of that cell. '
    + 'Metadata AT REST is deliberately NOT rewritten and this entry adds no D2 conversion. '
    + 'An empty comparand has no lossless replacement (dropping a condition changes which '
    + 'rows a view returns, which is the author\'s decision) and a non-string one has no '
    + 'honest coercion (the platform refuses to answer a query nobody wrote). The read path '
    + 'does not re-validate stored rows, so a stored filter keeps loading; what changes is '
    + 'that RE-SAVING it is refused, with the reason text three shipped consumer faces '
    + 'already show at query time. ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep your authored filters for the case-insensitive contains operator in either '
    + 'spelling and read each comparand: an empty one means the condition was a placeholder '
    + 'and the repair is to delete it, and a non-string one means either a missing pair of '
    + 'quotes or the wrong operator. At this release neither comparand returns rows: each of '
    + 'the five driver packages answers both with INVALID_FILTER at query time, and the '
    + 'formula matcher answers false for every row. How earlier releases answered them was '
    + 'NOT measured, so re-check '
    + 'what the view is supposed to show rather than assuming the old result set was correct. '
    + 'Both refusals now arrive at the authoring path.',
};
