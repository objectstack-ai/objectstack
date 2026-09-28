---
'@objectstack/spec': minor
---

feat(spec)!: a view filter rule's `operator` is typed as the canonical `ViewFilterOperator`, not `unknown`

**BREAKING for TypeScript code that writes a view filter rule through a published type**: `ViewFilterRule`, and every carrier of it — `ListView.filter`, a view tab's `filter`, `InterfacePageConfig.filterBy`, and the related-list, record-picker and `object-*` block filter doors. A narrowing of a published TYPE, landing as `minor` (the bump level is not the carrier; this banner and the disposition below are). The runtime accept set does not move at all: no schema's parse, no value and no export changes.

`operator` is a `z.preprocess` over the alias fold, and zod types a preprocess's input from its function's parameter. That parameter was `unknown`, so `ViewFilterRule['operator']` was `unknown`: `{ field: 'status', operator: 42 }` compiled as a rule on every carrier, and was refused only when the schema parsed it. The input type is now `ViewFilterOperator`, the vocabulary the alias table's own contract says new producers emit, so an alias spelling or a non-string is refused by the compiler.

What does not change:

- **The runtime.** `ViewFilterRuleSchema` still folds every legacy spelling it folded before (`eq`, `gt`, `notIn`, `isNull`, …) to its canonical id, and still refuses a non-string at `operator` with the enum's own issue. Stored `sys_metadata` rows, YAML and JSON bodies and plain-JS producers that carry an alias parse exactly as before, and `os validate` answers as before.
- **`normalizeFilterOperator`.** Its parameter stays `unknown`: it exists to fold untyped stored metadata, and its callers pass raw strings by design.
- **The parsed type.** `ViewFilterRuleParsed['operator']` was already the canonical enum.

## FROM → TO

| Wrote (TypeScript) | Write instead |
| --- | --- |
| `{ field: 'status', operator: 'eq', value: 'open' }` | `{ field: 'status', operator: 'equals', value: 'open' }` |
| `{ field: 'amount', operator: 'gte', value: 100 }` | `{ field: 'amount', operator: 'greater_than_or_equal', value: 100 }` |
| `{ field: 'stage', operator: 'notIn', value: ['lost'] }` | `{ field: 'stage', operator: 'not_in', value: ['lost'] }` |
| `operator: someString` (a value typed `string`) | type the unvalidated rule `unknown` and `ViewFilterRuleSchema.safeParse` it, or fold it with `normalizeFilterOperator` and check it against `VIEW_FILTER_OPERATORS` first |

The one-line fix: write the canonical id. Every alias maps to exactly one, and `VIEW_FILTER_OPERATOR_ALIASES` is that map; the rewritten rule selects the same rows, because the schema already folded the alias to that id.

Clause-②: no (narrowing)

<!-- adr-0087: registered view-filter-rule-operator-input-canonical -->
