---
'@objectstack/spec': minor
---

fix(spec): `composeStacks` refuses a stack whose `objects` is not an array, with the ADR-0112 envelope

**BREAKING** — `composeStacks`, a public root export, now refuses a class of input it used to crash on, skip in silence, or compose by accident.

Step 2 of `composeStacks` (`mergeObjects`) iterated each input's `objects` with no shape guard. The strict `defineStack` parse already rejects a non-array `objects`, so the reachable population is an input that bypassed it — a hand-built stack object, or `defineStack(config, { strict: false })`. Measured before this change, composing a well-formed stack with such an input:

| the second stack's `objects` | before | after |
| :--- | :--- | :--- |
| a map (`{ b_item: {…} }`) or a number | bare `TypeError: … is not iterable`, `code` and `status` both `undefined` | refused, `STACK_SCHEMA_INVALID`, `status: 422` |
| `null`, `''`, `0`, `false` | composed, the stack's objects silently absent | refused, `STACK_SCHEMA_INVALID`, `status: 422` |
| a `Set` of objects | composed as if it were an array | refused, `STACK_SCHEMA_INVALID`, `status: 422` |

A composed artifact is complete or it is refused: skipping a stack's objects composes an artifact that silently lacks them, so no non-array `objects` is skipped. An absent `objects` (`undefined`) is not malformed and composes as before. The refusal carries the code the strict parse raises for the same authored mistake — one code for one defect, whichever door catches it — with the zod issue on `issues` (`path: ['objects']`, `expected: 'array'`) and a message naming the stack by manifest id and position. The map form is an authoring spelling `defineStack` normalizes before any check runs; a stack that reaches composition without passing through `defineStack` never had it normalized, and is refused like any other non-array.

A non-object entry inside an array `objects` (`null`, a number) is skipped and reported once through the composer's malformed-collection warning, the shape step 3 gives a non-array collection; before, it raised a bare `TypeError` reading `name` off it. The artifact cross-reference pass skips such an entry too.

No code is added to the ADR-0112 ledger and no export changes: `STACK_SCHEMA_INVALID` is already registered under `@objectstack/spec`, and the error class stays module-local.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, Zod schema, export, config field or stored metadata shape is added, removed, renamed or re-spelled. The strict defineStack parse already refused every input this refuses, so an authored stack that passed its schema composes exactly as before; what narrows is the runtime behaviour of composeStacks on inputs that bypassed that parse, and objectstack migrate meta has no document to rewrite for it. -->

Clause-②: no (narrowing)
