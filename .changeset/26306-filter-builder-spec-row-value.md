---
'@object-ui/components': patch
---

fix(components)!: the filter builder's row takes the spec rule's value, so the authored group a `filter-builder` node carries reaches the builder as it is

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/components/src/custom/filter-builder.tsx#FilterBuilderRow) A published runtime TypeScript interface of a React component with no metadata surface: no Zod schema, no spec declaration and no stored representation, so `objectstack migrate meta` has nothing to rewrite; the affected party is a TypeScript consumer, reached by its own compiler. -->

**BREAKING** type-surface change, compile-time only. `FilterBuilderRow` is exported from `@object-ui/components`. What the builder accepts widens, and what a reader of `row.value` may assume narrows: the member is now optional and admits `null`. Nothing changes at runtime for a reader: the builder already passed both through.

`FilterBuilderRow.value` is now `ViewFilterRule['value']` from `@objectstack/spec/ui`, taken by reference, plus the builder's own list member `(string | number | boolean)[]`. Before, it was the builder's own `string | number | boolean | (string | number | boolean)[]`, and it was required. Measured against the spec's rule, that refused two shapes an authored row takes:

- **Value omitted.** The spec's value is optional, because a value-less operator (`is_null`, `is_empty`, …) carries none. The builder's was required, so the authored `FilterGroup` from `@object-ui/types` was not assignable to the builder's group. The member is optional now.
- **Value `null`.** The spec admits it; the builder's member did not. It does now.

The operator vocabulary needed no change: every spec operator id is a builder id.

Both cases also fix a field switch. Switching the field of a row with no value used to convert the absent value: on a number column it threw on `.trim()`, and on a text column it came back as the string `"undefined"`. A row with no value, or a `null` one, now keeps it through a field switch.

The `filter-builder` renderer now hands the authored `value` and `fields` to the builder with no cast. It declares `value` on its props, because a host that binds the node forwards the group it holds.

**Migration.** Code that reads `row.value` from a `FilterBuilderRow` (a host's `onChange` handler, for instance) handles `undefined` and `null` before using the value, or narrows first with an unset check (`value === undefined || value === null || value === ''`). Code that only writes rows needs no change.
