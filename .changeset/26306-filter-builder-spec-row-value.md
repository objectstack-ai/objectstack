---
'@object-ui/components': patch
---

fix(components): the filter builder's row takes the spec rule's value, so the authored group a `filter-builder` node carries reaches the builder as it is

Clause-②: yes (widening)
Metadata-protocol: none

`FilterBuilderRow.value` is now `ViewFilterRule['value']` from `@objectstack/spec/ui`, taken by reference, plus the builder's own list member `(string | number | boolean)[]`. Before, it was the builder's own `string | number | boolean | (string | number | boolean)[]`, and it was required. Measured against the spec's rule, that refused two shapes an authored row takes:

- **Value omitted.** The spec's value is optional, because a value-less operator (`is_null`, `is_empty`, …) carries none. The builder's was required, so the authored `FilterGroup` from `@object-ui/types` was not assignable to the builder's group. The member is optional now.
- **Value `null`.** The spec admits it; the builder's member did not. It does now.

The operator vocabulary needed no change: every spec operator id is a builder id.

Both cases also fix a field switch. Switching the field of a row with no value used to convert the absent value: on a number column it threw on `.trim()`, and on a text column it came back as the string `"undefined"`. A row with no value, or a `null` one, now keeps it through a field switch.

The `filter-builder` renderer now hands the authored `value` and `fields` to the builder with no cast. It declares `value` on its props, because a host that binds the node forwards the group it holds.

Code that reads `row.value` from a `FilterBuilderRow` now sees `undefined` and `null` in its type. The builder already passed both through at runtime.
