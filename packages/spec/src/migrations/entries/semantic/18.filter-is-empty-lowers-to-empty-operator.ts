// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20446 — the last step of ruling A on #20399: `$empty` joins FILTER_OPERATORS
// and the view operators is_empty / is_not_empty lower to it instead of `$null`.
// Nothing stored is rewritten; a stored 「is empty」 rule is re-read under the new
// meaning, which widens on text and multi-value fields and refuses where no face
// holds the column's declared type. The changeset declares Clause-② yes
// (narrowing); this entry is where the prescription reaches os migrate meta,
// the upgrade guide and spec-changes.json.
export const entry: SemanticMigration = {
  id: 'filter-is-empty-lowers-to-empty-operator',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'data.FilterCondition — the view operators is_empty / isempty / is_not_empty / isnotempty '
    + '(a ViewFilterRule, a sharing rule, any filter array), and a $empty object written as a '
    + 'record field value',
  replacement:
    'Nothing to rewrite for a rule on a declared field: is_empty now lowers to { field: { $empty: '
    + 'true } } and is_not_empty to { field: { $empty: false } }, answered by the field\'s declared '
    + 'type — a text-like field is empty when it is null or the empty string, a multi-value field '
    + 'when it is null or the empty list, every other type only when it is null. Where no face holds '
    + 'the column\'s declared type the rule is refused: on the built-in id, write is_null / '
    + 'is_not_null; on a federated object whose driver does not implement external-object '
    + 'registration (driver-memory, driver-mongodb), bind it on a driver that implements federation '
    + '(the boot error names the object); on an AnalyticsService built without sourceFieldMeta, pass '
    + 'sourceFieldMeta or write is_null / is_not_null; on a multi-value column over a SQL dialect '
    + 'driver-sql does not model, write is_null / is_not_null. A record write that carries a $empty '
    + 'object as a field value writes the value itself instead; a filter belongs in where',
  reason:
    'Ruling B on #20311 (record 5861435168) set what 「is empty」 means once, per field type, and '
    + 'ruling A on #20399 (record 5865693155) spelled it as the $empty operator, expanded by each '
    + 'compile face from the field\'s declaration. It was staged out of FILTER_OPERATORS (the '
    + 'maintainer\'s amendment, record 5868169573) until every face had its arm (#20444, #20445); '
    + '#20446 added it and flipped the lowering in one change, after measuring that no face drops '
    + 'it. Two consequences reach stored metadata. A stored 「is empty」 on a text or multi-value '
    + 'field finds more rows: the ones holding the empty string or the empty list, which the $null '
    + 'lowering missed while the three builders already showed them as empty. And the rule is '
    + 'refused, loudly and with the $null prescription, where the face that answers it holds no '
    + 'declaration for the column — the four compositions the replacement names — where the $null '
    + 'lowering compiled IS NULL. The same change made the write door refuse a $empty object as a '
    + 'field value, because that door refuses every filter operator the protocol enforces as a '
    + 'value (#5922): before, a text-like field stored it. Metadata AT REST is deliberately NOT '
    + 'rewritten and this entry adds no D2 conversion: the stored spelling is unchanged, and its '
    + 'new meaning is the ruled one. ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep your stored views, sharing rules and filter arrays for is_empty / is_not_empty. On a text '
    + 'or multi-value field, re-check what the view or rule is supposed to select: it now also '
    + 'selects the rows holding the empty string or the empty list. On the built-in id, rewrite it '
    + 'to is_null / is_not_null. If a federated object on driver-memory or driver-mongodb, or an '
    + 'AnalyticsService host without sourceFieldMeta, carries such a rule, the query now fails with '
    + 'INVALID_FILTER instead of answering — bind the object on a federation-capable driver, or pass '
    + 'sourceFieldMeta. No insert or update payload carries a $empty object as a field value.',
};
