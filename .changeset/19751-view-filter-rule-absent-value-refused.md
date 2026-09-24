---
"@objectstack/spec": minor
---

fix(spec): a stored view filter rule with no value on a value-taking operator is now refused at save instead of failing every query (#19751)

**BREAKING** — an accept-set narrowing on a published authoring surface, pulling `ViewFilterRuleSchema` back to what its own `value` description already declares: every operator outside `in` / `not_in` / `between` and the four unary operators takes a scalar, and only the unary operators ignore the key. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings: during the launch window a breaking change ships as `minor`, so the level alone does not signal the break — this banner and the ADR-0087 disposition below carry it. The hand-migration prescription is registered under protocol major 18 as `view-filter-rule-absent-value-refused`.

## What changes

A filter rule that omits `value` (or carries `value: undefined`) on `equals`, `not_equals`, `contains`, `not_contains`, `icontains`, `starts_with`, `ends_with`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before` or `after` used to parse green and then fail at query time: the rule lowers to `[field, operator]`, and the query path refuses that with `400 INVALID_FILTER` ("Filter comparand at … is undefined") — which failed the whole view, not just that rule. It is now refused when the view is saved, at the rule's `value` path, on every carrier of `ViewFilterRuleSchema` (`ListView.filter`, a tab filter, `Page.filterBy`, a related-list filter, a lookup picker filter):

```text
Filter comparand for operator "icontains" on field "name" is undefined. The rule carries no value, …
```

This reverses a carve-out the #19514 entry records: its statements that an **omitted** value still parses (`value` is optional) and that an **absent** `icontains` comparand is left unjudged on a view rule no longer hold for any operator that takes a value — such a rule is now refused once, with the message above.

## What stays accepted

- The unary operators `is_empty` / `is_not_empty` / `is_null` / `is_not_null`, with or without a value.
- `in` / `not_in` / `between` refused an absent value before this change and still do, with their own wording.
- `value: null` on a scalar operator is a value (the null predicate), not an absent one, and still parses.

## Migration

For each refused rule, decide what it meant:

```ts
// FROM — no value on an operator that takes one
{ field: 'status', operator: 'equals' }

// TO — a comparison: write the value
{ field: 'status', operator: 'equals', value: 'open' }

// TO — a test for "no value": use an operator that takes none
{ field: 'status', operator: 'is_empty' }
```

A rule that was an unfinished row is deleted. The console's filter builder never saved this shape (it drops a half-filled row before saving), so the rules to look for are hand-authored or written by another tool.

Clause-②: no (narrowing) — no key is added, removed or renamed and no exported symbol moves; the accept set of `ViewFilterRule.value` narrows back to what its published description declares.

<!-- adr-0087: registered view-filter-rule-absent-value-refused -->
