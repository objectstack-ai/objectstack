---
'@objectstack/spec': minor
---

feat(spec): every `composeStacks` conflict refusal carries an ADR-0112 envelope — six new `STACK_COMPOSE_*` codes beside the `defineStack` family

`composeStacks` refuses six authored-entity conflicts, and until now every one of them threw
`new Error(message)` with `code` and `status` both `undefined`. The `defineStack` family in the
same file has carried the envelope since #15963, so `packages/spec/src/stack.zod.ts` held two
refusal families that are the same thing to an author — a stack refused at authoring time,
through the same callers — and two different things to a consumer branching on `error.code`.

Every message in the family carries the literal `composeStacks conflict:` prefix, which is how it
is located: FIVE of the six raise inside helper functions 300-800 lines above `composeStacks`'
own body, so reading the function the defect is named after finds one of them.

| refusal | raised by | code |
| :--- | :--- | :--- |
| a single-valued top-level key declared with different values by two stacks | `composeSingleValue` | `STACK_COMPOSE_KEY_CONFLICT` |
| `functions` authored in the map form by one stack, the array form by another | `composeFunctions` | `STACK_COMPOSE_FUNCTIONS_SHAPE_CONFLICT` |
| two stacks defining one handler name | `composeFunctions` | `STACK_COMPOSE_FUNCTION_CONFLICT` |
| under `objectConflict: 'merge'`, an object-level collection other than `fields` declared differently | `refuseUnmergeableCollections` | `STACK_COMPOSE_COLLECTION_CONFLICT` |
| the same object name in two stacks under the default `objectConflict: 'error'` | `mergeObjects` | `STACK_COMPOSE_OBJECT_CONFLICT` |
| a cross-stack action key collision | `collectComposedActionKeyCollisions` | `STACK_COMPOSE_ACTION_KEY_COLLISION` |

Each carries `status: 422` — an unprocessable authored entity, not a server fault — and the
findings the site collected in `issues`, one entry per finding. **Message text is byte-for-byte
unchanged at every site**: this adds the machine-readable half, it rewords no sentence, and the
message pins across the repo read the prose they always did.

One code per refusal site rather than a shared `STACK_COMPOSE_CONFLICT` catch-all — the
granularity the `defineStack` family landed with, and the granularity the ADR-0112 ledger's
boot-refusal class already had before it. The `STACK_COMPOSE_*` spelling says what the
per-stack family's spellings cannot: the defect is a disagreement BETWEEN stacks, each of which
is legal on its own, so the fix is in the composition rather than in one malformed stack.
`STACK_CROSS_REFERENCE_INVALID` stays the deliberate exception in the other direction — its
per-stack and artifact passes share one code because they are one rule family over two scopes.

All six are registered in `ERROR_CODE_LEDGER` under `@objectstack/spec`, under the ruling that
every code shipped in `dist` is the published face, door or no door. No wire door raises them:
`composeStacks` runs at authoring and boot time, and the reading was re-measured here — zero
`composeStacks` call sites under `packages/runtime/src` + `packages/rest/src` (7 non-test
occurrences, all doc comments or message prose in one file), with `defineStack` lighting the
same probe 31 times across 8 files as the positive control.

Not narrowed: `composeStacks` accepts and refuses exactly the inputs it did before, and no export
changes — the error classes stay module-local, as every member of the `defineStack` family is,
because `packages/spec/src/index.ts` re-exports the module with `export *` and the ADR-0112
contract is the `code` / `status` pair read structurally.

⛔ The seventh bare `Error` in that file is deliberately untouched:
`composeStacks internal error: no source stack recorded for composed object …` is the code
discovering its own bookkeeping is inconsistent, not an authored entity being refused. Filing it
at 422 would tell an author their stack is invalid when the defect is ours. Whether it takes a
500-class envelope of its own is a separate decision.

Clause-②: yes
