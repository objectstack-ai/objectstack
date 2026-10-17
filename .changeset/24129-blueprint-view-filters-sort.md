---
'@objectstack/spec': minor
---

feat(spec): a solution blueprint view declares `filters` and `sort`, so a view named by a condition can carry that condition

Clause-②: yes (widening)

`BlueprintViewSchema` and the strict structured-output mirror `SolutionBlueprintStrictSchema.views[]` gain two keys. Before this, a blueprint could say "overdue only" in a view's name and nowhere else, and the built view showed every record.

- **`filters`** — which records the view shows, as list-view filter rules `[{ field, operator, value }]`, ANDed.
  - Lenient (`BlueprintViewSchema`): optional, and the array element IS `ViewFilterRuleSchema` (the rule `ListView.filter` declares), so it takes the same operators, folds the same legacy spellings, and refuses the same operator/value-shape mismatches (`in` without an array, `between` without `[min, max]`, `icontains` without a non-empty string).
  - Strict (`SolutionBlueprintStrictSchema`): required and nullable (null = a view over every record). Each rule carries the same three keys, every one present: `operator` is the canonical vocabulary only (`VIEW_FILTER_OPERATORS`, no legacy shorthand such as `eq`), and `value` is nullable (null for the unary operators). The operator/value-shape coupling is not in the strict mirror's JSON Schema; the lenient parse refuses it.
- **`sort`** — the default record order, `[{ field, order }]` with `order` `asc` or `desc`, the first entry sorting first. Lenient: optional, the element is the shared `SortItemSchema` (the `{ field, order }` pair `ListView.sort` declares; array only, a `"field desc"` string is refused). Strict: required and nullable, `{ field, order }` with both keys present.
- Both describes tell the model that a view whose name or label states a condition ("overdue", "my open") must carry the matching filter, with worked rules using the platform tokens `{today}` and `{current_user_id}`.
- Additive only: every blueprint that parsed before still parses with the lenient schema. A producer of the STRICT shape must now send `filters` and `sort` on each view (null when it has none), as with every other key in that mirror.
