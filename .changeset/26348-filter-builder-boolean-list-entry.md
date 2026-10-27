---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
---

fix(components)!: the filter builder's list value holds the spec list's entries, so an `equals true` row switched to In is a rule the spec accepts

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/components/src/custom/filter-builder.tsx#FilterBuilderRow) A published runtime TypeScript interface of a React component with no metadata surface: no Zod schema, no spec declaration and no stored representation, so `objectstack migrate meta` has nothing to rewrite; the affected party is a TypeScript consumer, reached by its own compiler. -->

**BREAKING** type-surface change, compile-time only. `FilterBuilderRow` is exported from `@object-ui/components`. Its `value` is now exactly `ViewFilterRule['value']` from `@objectstack/spec/ui`: the builder's own wider list member, which also admitted boolean entries, is gone. A writer that put a boolean into a list value no longer compiles.

The defect it fixes: in the filter builder, a row `equals true` on a select column switched to In emitted `value: [true]`, and `ViewFilterRuleSchema` refuses a boolean list entry, so the builder produced a rule the spec rejects. A boolean carried into a list or a range is now written as its string spelling, so the same switch emits `["true"]`. That is the conversion the builder already made for a boolean that reaches a text column, and every column that offers a list operator is one. The option whose value is `"true"` stays ticked, because the list controls compare entries as strings.

`UserFilters` (`@object-ui/plugin-list`) hands a lookup chip's selection to `LookupValuePicker` the same way. An authored `defaultValues` entry `true` on a lookup filter field used to reach the query beside a picked id as a boolean; it now arrives as `"true"`, still drawn as a chip the user can remove.

**Migration.** Code that writes a list into a `FilterBuilderRow` value writes strings and numbers only. Write a boolean entry as its string spelling, the way the builder does, or keep the boolean as a scalar under `equals`. Code that reads `row.value` needs no change: a list it reads already holds only strings and numbers.
