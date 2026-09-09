// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16581] Lower `ViewFilterRule` rows to the filter grammar the data ingress
 * actually parses.
 *
 * ## The gap this closes
 *
 * `FormFieldPublicPickerSchema.filter` declares the object dialect in so many
 * words — *"Same `{ field, operator, value }` dialect as list-view filters"* —
 * and `GET /forms/:slug/lookup/:field` put those rows straight onto the
 * `findData` filter slot. That slot is read by
 * `@objectstack/metadata-protocol`'s normalizer, which accepts a
 * `FilterCondition` object or a `FilterArray` (`[field, operator, value]`, a
 * logical node, or a list of those) and refuses anything else with
 * `400 INVALID_FILTER`. An array of `{field, operator, value}` OBJECTS is none
 * of those, so the route answered 400 for **every** non-empty search — the
 * declared pre-filter and the route's own `q` predicate alike, since the `q`
 * branch builds the same object shape. Only the degenerate empty-filter call
 * could succeed.
 *
 * ⛔ The repair is NOT a second dialect on `findData`. Two filter grammars in
 * the data layer would be maintained forever and would spread the object shape
 * to every `findData` caller; the declaring side already promises the object
 * dialect on the AUTHORING surface, so what has to change is the side that
 * failed to honour it. This module is that side: authoring dialect in,
 * parser grammar out, at the one door that speaks both.
 *
 * ## The operator fold is the spec's own, not a second table
 *
 * {@link normalizeFilterOperator} (`@objectstack/spec/ui`) is the fold
 * `ViewFilterRuleSchema.operator` itself runs as its `z.preprocess`, exported
 * precisely so "producers and renderers can normalize stored metadata against
 * the SAME canonical map the schema uses, instead of inventing a second
 * dialect". ⛔ Never hand-write an alias table here: a stored row predating a
 * spelling's canonicalisation (`notEquals`, `isNotEmpty`, `gt`) must fold the
 * way the schema folds it, and `AST_OPERATOR_MAP`'s coverage of that vocabulary
 * is what `filter-view-operator-parity.test.ts` holds.
 *
 * ## An unlowerable row is FORWARDED, never dropped
 *
 * A row this function cannot read as a rule passes through verbatim, so the
 * ingress refuses the whole request exactly as it did before. That direction is
 * deliberate and it is the fail-CLOSED one: a picker's static filter is often
 * the only thing keeping an anonymous visitor's search inside the rows a form
 * is allowed to expose (`filter: [{ field: 'status', … 'published' }]`).
 * Skipping a row we did not understand would turn a loud 400 into a 200 over an
 * UNFILTERED table on an unauthenticated surface — a widening, delivered
 * silently, by the code that was supposed to be repairing a refusal.
 */

import { normalizeFilterOperator } from '@objectstack/spec/ui';

/**
 * One rule → one `FilterArray` comparison node, or the input verbatim when it
 * is not a readable `{ field, operator, value }` row (see the module header:
 * that is the fail-closed path, not a fallback).
 *
 * `value: undefined` emits the two-element form the grammar declares
 * (`[field, operator]`) rather than a triple with an `undefined` in comparand
 * position. That is the shape a unary rule authors as — `ViewFilterRuleSchema`
 * documents `is_empty` / `is_not_empty` / `is_null` / `is_not_null` as taking
 * their direction from the operator NAME and ignoring `value` — and it needs no
 * local list of which operators are unary, which would be a third copy of a
 * vocabulary the spec already owns.
 */
function lowerViewFilterRule(rule: unknown): unknown {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return rule;
    const { field, operator, value } = rule as { field?: unknown; operator?: unknown; value?: unknown };
    if (typeof field !== 'string' || field.length === 0) return rule;
    if (typeof operator !== 'string') return rule;
    const op = normalizeFilterOperator(operator);
    return value === undefined ? [field, op] : [field, op, value];
}

/**
 * Lower a list of `ViewFilterRule` rows to the value the filter slot takes.
 *
 * - no rows → `[]`, which every path already reads as "no filter". ⛔ Not
 *   `['and']`: a logical node with nothing to join is itself refused (the one
 *   shape that used to return every row silently), and "the author declared no
 *   pre-filter" must not become a rejected request.
 * - one or more rows → an explicit `['and', …]` node. The route ANDs its
 *   static rows with the visitor's search predicate, so the conjunction is
 *   written down rather than left to the list form's implicit AND.
 */
export function lowerViewFilterRules(rules: readonly unknown[]): unknown[] {
    if (rules.length === 0) return [];
    return ['and', ...rules.map(lowerViewFilterRule)];
}
