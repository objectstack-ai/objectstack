---
"@objectstack/spec": patch
"@objectstack/runtime": patch
---

fix(spec): every `defineStack` refusal carries an ADR-0112 envelope — six new `STACK_*` codes beside `STACK_CROSS_REFERENCE_INVALID` (#15963)

`defineStack` has seven refusal sites. After #14552 one of them — the cross-reference refusal — carried `code` / `status`; the other six still threw `new Error(message)` with both `undefined`. A consumer that had learned to branch on `error.code` from the cross-reference refusal read `undefined` from its six neighbours, which reads as "not a validation refusal" rather than "a refusal with no code yet" — the silent-tolerance shape ADR-0112's envelope exists to remove. Every site now throws an envelope, `status: 422`, one code per refusal, the findings the site collected on `issues`:

| Refusal (header text, unchanged) | Raiser | `code` |
|---|---|---|
| `defineStack validation failed` | `ObjectStackDefinitionSchema.safeParse` | `STACK_SCHEMA_INVALID` |
| `defineStack capability validation failed` | `validateKnownCapabilities` | `STACK_CAPABILITY_UNKNOWN` |
| `defineStack cross-reference validation failed` | `validateCrossReferences` | `STACK_CROSS_REFERENCE_INVALID` (#14552, unchanged) |
| `defineStack namespace-prefix validation failed` | `validateNamespacePrefix` | `STACK_NAMESPACE_PREFIX_INVALID` |
| `defineStack single-app validation failed` | `validateSingleApp` | `STACK_SINGLE_APP_VIOLATION` |
| `defineStack hierarchy-scope capability validation failed` | `validateHierarchyScopeCapability` | `STACK_HIERARCHY_SCOPE_CAPABILITY_REQUIRED` |
| `defineStack trigger capability validation failed` | `validateTriggerCapability` | `STACK_TRIGGER_CAPABILITY_REQUIRED` |

Message text is byte-for-byte unchanged at every site — this adds the machine-readable half, it does not reword a sentence; the message pins across the tree still read the prose they always did. One code per site rather than one shared `STACK_VALIDATION_FAILED`: the dispatcher vocabulary's `boot-refusal` class was already at one-row-per-refusal granularity (14 rows), and `STACK_CROSS_REFERENCE_INVALID` is an instance of that granularity, not an exception to it.

The schema arm was judged separately rather than copied from the five semantic cross-checks, because it is an aggregate of zod issues against the schema the stack declares, not a rule evaluated on a parsed stack. The reading: `@objectstack/spec` has no zod-failure envelope to reuse (`formatZodError` / `safeParsePretty` return prose); the two zod-shaped refusals the ledger already carries are both spelled `*_SCHEMA_INVALID` at 422 (`METADATA_SCHEMA_INVALID`, `FLOW_INPUT_SCHEMA_INVALID`); and the two other channels a zod failure travels on — `400 VALIDATION_ERROR` (request syntax) and `VALIDATION_FAILED` + `fields[]` (record validation, duck-typed on `name === 'ValidationError'`) — would each file an authored stack as something it is not. So it is its own code, and its `issues` carries the zod issues structurally (path, code, message per entry) rather than the formatted lines the message already renders.

Not narrowed, not widened: `defineStack` accepts and refuses exactly the inputs it did before, and no export changes — the error classes stay module-local, as `StackCrossReferenceError` did, because `packages/spec/src/index.ts` re-exports the module with `export *` and the ADR-0112 contract is the `code` / `status` pair read structurally. None of the six is registered in `ERROR_CODE_LEDGER`, for the reason the precedent was not: no wire door raises them — `defineStack` runs at authoring and boot time, and no HTTP domain handler calls it (re-measured: every non-test `defineStack` occurrence under `packages/runtime/src` and `packages/rest/src` is a docstring, a comment or the vocabulary table's own prose).

`@objectstack/runtime` carries one classification row per new code in the dispatcher error-code vocabulary (`door: 'none'`, `verdict: 'boot-refusal'` — the measured verdict), which `pnpm check:dispatcher-error-vocabulary` enforces in both directions.
