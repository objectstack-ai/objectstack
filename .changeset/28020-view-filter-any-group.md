---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
---

feat(spec): a stored view filter list can hold an any-of group, `{ any: [rule, ...] }`

Clause-②: yes (widening)
Metadata-protocol: added

A view filter list (`ListView.filter`, a view tab's `filter`, `Page.interfaceConfig.filterBy`, an element data source's `filter`, the related-list and picker filters and the component `filter` doors) was an AND list of flat `{ field, operator, value }` rules, so a view whose natural filter is an any-of ("open, or completed in the last 7 days") could not be stored. The list now takes one more element kind beside the rule: `{ any: [rule, ...] }`, a non-empty array of flat rules of which ANY may match. The list still ANDs its elements.

```ts
filter: [
  { any: [
    { field: 'status', operator: 'equals', value: 'open' },
    { field: 'completed_at', operator: 'after', value: '{7_days_ago}' },
  ] },
  { field: 'owner', operator: 'equals', value: '{current_user_id}' },
]
```

- New exports from `@objectstack/spec/ui`: `ViewFilterAnyGroupSchema`, `ViewFilterElementSchema` (rule or group — what every carrier holds now), their `ViewFilterAnyGroup` / `ViewFilterElement` types and `...Parsed` twins, and `isViewFilterAnyGroup(value)`, the one test that tells the two element kinds apart.
- A group's members are `ViewFilterRuleSchema` itself, so the operator vocabulary, the legacy-alias fold, the operator/value-shape coupling and the `icontains` comparand check apply inside a group exactly as at the top level.
- Refused at parse: an empty group (`too_small` at `filter.N.any`), a group inside a group (one level only; `unrecognized_keys` naming `any` on the inner element), a member that is not a rule, and a rule key written beside `any`. `$or`, `or`, `anyOf`, `logic` and `conditions` written on a rule are answered with the group shape.
- Every filter stored before this change parses exactly as it did: the same output for an accepted rule, and the same issues (code, path, message) for a refused one — the element union reports only the branch the element claims.
- The wire door strips the console's row `id` inside a group as on a plain rule.
- `ViewFilterRule` (the type) is unchanged and still means one flat rule. A reader typed against a carrier's element now sees `ViewFilterElement`, and must step into a group (`isViewFilterAnyGroup`) rather than read `field` off every element.
- `solution-blueprint` view `filters` deliberately stay flat rules: the model writes them through a strict mirror that cannot carry a union.
- `[PLANNED — not yet rendered]`: no console applies the group yet. The list query build reads flat rules only, so until it reads this element a view that stores a group is refused when it loads (the server answers the passed-through group with a malformed-filter error and the list shows no rows); it fails closed, and the group's describe says so.

Readers updated: `@objectstack/lint`'s filter field-key walk (`filter-walk.ts`, used by the list-view, dataset and widget field-reference rules), the preset-comparand rule, and the page field-binding rule (`filterBy` and a related list's `filter`) step into a group, so a field inside one is checked and `any` is never reported as a field. `@objectstack/metadata-protocol`'s `computeViewReferenceDiagnostics` checks the fields inside a group in a preset tab's filter.
