---
'@object-ui/components': patch
---

fix(components)!: the filter builder's row takes the spec rule's value, so the authored group the `filter-builder` node carries reaches the builder as it is

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (type-surface-only ui/packages/components/src/custom/filter-builder.tsx#FilterBuilderRow) A TypeScript annotation change on a published component type: no metadata key, accepted value, export or error code is removed or renamed, and `objectstack migrate meta` has nothing to rewrite. The affected party is a TypeScript consumer, reached by its own compiler. -->

**BREAKING** type-surface change, compile-time only for well-formed rows.

`FilterBuilderRow.value` is now `ViewFilterRule['value']` from `@objectstack/spec/ui`, taken by reference, instead of the builder's own `string | number | boolean | (string | number | boolean)[]`. Measured against the spec's rule, the old member diverged in three value cases:

- **Value omitted.** The spec's value is optional, because a value-less operator (`is_null`, `is_empty`, …) carries none. The builder's was required, so the authored `FilterGroup` a `filter-builder` node holds was not assignable to the builder's group. The member is optional now.
- **Value `null`.** The spec admits it; the builder's member did not. It does now.
- **A boolean inside a list or pair.** The spec's list holds strings and numbers. The builder's admitted booleans and emitted them: an `equals true` row switched to `in` came back as `[true]`, which the spec's rule schema refuses. A boolean carried into a list or pair is now spelled as its string (`['true']`), the key a static option already compares on.

The operator vocabulary needed no change: every spec operator id is a builder id.

Two runtime fixes ride on the first two cases. Switching the field of a row with no value used to convert the absent value: on a number column it threw on `.trim()`, and on a text column it came back as the string `"undefined"`. A row with no value, or a `null` one, now keeps it through a field switch.

The `filter-builder` renderer hands the authored `value` and `fields` to the builder with no cast.

**Migration.** Code that reads `row.value` from a `FilterBuilderRow` now handles `undefined` and `null`, which the builder already passed through at runtime. Code that writes a boolean into a row's list value writes its string instead.
