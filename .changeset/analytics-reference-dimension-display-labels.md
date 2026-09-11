---
"@objectstack/service-analytics": patch
---

A dataset dimension over a `user` or `tree` field renders the referenced record's display name, the same way a `lookup` dimension already did. A "by person" chart's axis is people's names, not a column of user ids.

`packages/spec` declares one reference class — `REFERENCE_VALUE_TYPES` = `lookup`, `master_detail`, `user`, `tree`, "value points at another record … a record-id string in stored form" — and this service already treated it as one class where it annotates measure result types (`measure-result-type.ts` imports that very set). The label resolver, one file away, hand-wrote a two-member subset of it (`lookup`, `master_detail`), so within a single dataset query one axis came back as a name and the other as a raw id, for two fields that differ in one word:

```
Field.user({ label: 'Person' })            -> { type: 'user',   reference: 'sys_user' }
Field.lookup('sys_business_unit', { … })   -> { type: 'lookup', reference: 'sys_business_unit' }
```

- **The subset is gone, not extended.** The resolver now asks `referenceTargetOf` (`@objectstack/spec/data`) — the declared single arbiter of "what does this reference field point at" — at all three sites that classified a dimension: the display pass, the `#3680` sort-key hook's `isLabelBearing`, and its `resolveLabels`. Adding two literals to a private `Set` would have left the next member of the class to be re-reported by the next user.
- **A `user` field authored without `reference` resolves too.** `sys_user` is a constant of the type, which `referenceTargetOf` materializes; requiring an author to restate it is exactly the disagreement between two readers of one field that arbiter exists to end.
- **The label read stays scoped (`#3602`).** Turning a user id into a name is a read of `sys_user`, and it travels the same `LabelScopeResolver` path every other member of the class travels — the referenced object's own RLS is resolved and ANDed into the lookup, and an unresolvable scope still fails closed to the raw id rather than fetching unscoped. This is the half of the change that had to land with it, not after it.
- **Nothing degrades into an error or a blank.** An orphaned or RLS-hidden user id, a `sys_user` with no display field, and a user object unknown to the engine all leave the raw id in place and answer the query, which is the pre-existing contract for an unresolved lookup id.

No new authorable key and no new export: `DatasetDimensionSchema` is untouched, and a dimension's own declared `type` still does not decide this — the resolver reads the object field's type, as it always has.
