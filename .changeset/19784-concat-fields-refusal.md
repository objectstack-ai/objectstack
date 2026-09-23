---
'@objectstack/spec': minor
---

fix(spec): `composeStacks` refuses a stack whose value for a concatenated collection (`permissions`, `data`, `views`, …) is not an array, with the ADR-0112 envelope

**BREAKING** — `composeStacks`, a public root export, now refuses a class of input it used to compose with that stack's content silently missing.

Step 3 of `composeStacks` concatenates every collection key the composer declares `concat` (`permissions`, `data`, `apps`, `views`, `flows`, `agents`, `packages`, … — every `'concat'` row of `COMPOSE_KEY_DISPOSITIONS`). It kept only the array values and announced the rest with a one-time `console.warn`. The strict `defineStack` parse already rejects a non-array value for any of these keys, so the reachable population is an input that bypassed it — a hand-built stack object, or `defineStack(config, { strict: false })`. Measured before this change, per key, composing a well-formed stack with one whose value for the key is a map:

| the second stack's value | before | after |
| :--- | :--- | :--- |
| a map, a number, a string, `null`, `false`, a `Set` | composed; the composed collection lacks every entry of that stack (e.g. its permission-set grants, its seed rows), one `console.warn` | refused, `STACK_SCHEMA_INVALID`, `status: 422` |
| the same, under `manifest: 'preserve'` | composed; the top-level collection lacks the entries, while that stack's package body still carries the malformed value — the artifact disagrees with itself | refused, `STACK_SCHEMA_INVALID`, `status: 422` |

A composed artifact is complete or it is refused, so no non-array value is skipped. An absent key (`undefined`) is not malformed and composes as before. The refusal is the one `composeStacks` already raises for a non-array `objects`: the code the strict parse raises for the same authored mistake, the zod issue on `issues` (`path: ['<key>']`, `expected: 'array'`), and a message naming the stack by manifest id and position and the key. For a key `defineStack` accepts in the map form, the message says so. A non-object entry inside an array is still concatenated as-is — the entry is carried, not lost.

The one-line fix: author the key as an array, or pass the stack through strict `defineStack` (which normalizes the map form and rejects every other shape where it is written).

No code is added to the ADR-0112 ledger and no export changes: `STACK_SCHEMA_INVALID` is already registered under `@objectstack/spec`, and the error class stays module-local.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, Zod schema, export, config field or stored metadata shape is added, removed, renamed or re-spelled. The strict defineStack parse already refused every input this refuses, so an authored stack that passed its schema composes exactly as before; what narrows is the runtime behaviour of composeStacks on inputs that bypassed that parse, and objectstack migrate meta has no document to rewrite for it. -->

Clause-②: no (narrowing)
