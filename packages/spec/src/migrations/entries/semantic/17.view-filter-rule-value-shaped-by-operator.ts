// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'view-filter-rule-value-shaped-by-operator',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'ui.ViewFilterRule value — the third key of a view filter rule, on every carrier of '
    + 'ViewFilterRuleSchema: ListView.filter, a list view tab filter, Page.filterBy, a '
    + 'related-list component filter and a lookup picker filter. It accepted any declared '
    + 'scalar or array for EVERY operator; the accepted shape is now decided by the rule '
    + 'operator — in / not_in require an array, between requires exactly two bounds, and '
    + 'every other operator is unchanged',
  replacement:
    'an ARRAY for in / not_in (a single value becomes a one-element list: value: "won" '
    + 'becomes value: ["won"]), and a two-element [min, max] array for between. The empty '
    + 'list [] stays legal for in / not_in and keeps its meaning. Nothing else moves: a '
    + 'scalar operator carrying an array, a string operator carrying a number, and a unary '
    + 'operator carrying an ignored value all still parse',
  reason:
    'A publish-time gate catching up to a query-time one, not a new rule. #5869 / PR '
    + '#6209 closed the RUNTIME half: `assertListComparandShapes` '
    + '(@objectstack/objectql, filter-comparand-shape.ts) refuses a lowered '
    + '`{ stage: { $nin: "won" } }` with a named 400 INVALID_FILTER, and before that it '
    + 'was a 500. The authoring surface stayed silent, so the failure was two-stage: the '
    + 'view published cleanly and only broke when someone opened it. That file names this '
    + 'very schema as the reachable authoring source of the defect. The tightening MIRRORS '
    + 'that gate exactly — three constraints, one for one — and deliberately goes no '
    + 'further, because #5685 already ruled on the opposite error: a schema stricter than '
    + 'the runtime "in ways the runtime deliberately allows" was the WRONG side and was '
    + 'widened to match. So `in: []` is still accepted (a declared predicate both drivers '
    + 'implement), `equals: ["a","b"]` is still accepted (it lowers to a deep-equality '
    + 'comparand), and `is_empty: ""` is still accepted (the null predicates take their '
    + 'direction from the operator NAME — convertComparison ignores the value position, '
    + 'and the ObjectUI client deliberately sends a truthy placeholder there). '
    + '⚠️ Metadata AT REST is deliberately NOT rewritten, and there is no D2 conversion. '
    + 'A D2 entry replays a shape the platform once WROTE and renamed; this shape was '
    + 'never written by any first-party producer (every in / not_in rule in this repo, in '
    + 'objectui and in the cloud repo already carries an array — measured) and has never '
    + 'EXECUTED, since it 400s on first render today. Coercing it at load would be the '
    + 'platform guessing intent rather than replaying a rename, and it cannot guess '
    + 'honestly: value: "" would become the predicate [""] (a real filter on the empty '
    + 'string) rather than the "not filled in yet" a console row means, and between: 5 has '
    + 'no defensible second bound at all. The read path does not re-validate stored rows '
    + '(applyConversionsToStoredItem never validates, by its own contract), so no stored '
    + 'view becomes unreadable; what changes is that RE-SAVING such a view is refused at '
    + 'the write gate naming `value`, instead of storing a filter that 400s. '
    + 'ADR-0049 / ADR-0078 / ADR-0112.',
  acceptanceCriteria:
    'Grep your authored views, pages and related-list components for a filter rule whose '
    + 'operator is in, not_in or between (including the alias spellings nin / notIn / '
    + 'notin) and whose value is not an array of the right arity, then wrap or complete '
    + 'it. `os validate` / `os lint` now report each one by path with the operator, the '
    + 'received shape and the corrected shape, so the sweep is mechanical rather than by '
    + 'eye. Two checks are worth doing where it looks unnecessary: a rule reading '
    + '`operator: "in", value: ""` is an UNFINISHED row, not a filter — decide what it was '
    + 'meant to select rather than mechanically rewriting it to [""], which is a real and '
    + 'different predicate. And a view that already carried one of these shapes was never '
    + 'returning filtered rows: it answered 400 INVALID_FILTER on render (#5869), so '
    + 're-check what the view is supposed to show rather than assuming the old result set '
    + 'was correct.',
};
