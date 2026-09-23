---
'@objectstack/spec': minor
---

fix(spec): `defineStack(config, { strict: false })` refuses a non-array `objects` with the ADR-0112 envelope

**BREAKING** — `defineStack`, a public root export, now refuses under `strict: false` a class of input it used to crash on or hand on unusable.

The non-strict door skips the parse and hands the normalized input to the action merge that ends every `defineStack` call. That merge read `objects` with no shape guard. Measured before this change:

| `objects` under `strict: false` | before | after |
| :--- | :--- | :--- |
| a number or a string (`5`, `'abc'`) | bare `TypeError: config.objects.map is not a function`, `code` and `status` both `undefined` | refused, `STACK_SCHEMA_INVALID`, `status: 422` |
| `null`, `''`, `0`, `false` | returned untouched, refused one call later by `composeStacks` | refused, `STACK_SCHEMA_INVALID`, `status: 422` |
| an array holding `null` (`[null, obj]`) | bare `TypeError` reading `actions` off `null` | accepted: the entry is handed on as written, the objects beside it get their bound actions |

`strict: false` skips validation — cross-references and schema detail — and never promised to accept a shape the merge cannot read. The refusal carries the code the strict parse raises for the same authored mistake, with the zod issue on `issues` (`path: ['objects']`, `expected: 'array'`), the same line `composeStacks` draws for the same key. An absent `objects` (`undefined`) is not malformed and behaves as before; the map form (`{ name: { … } }`) is still normalized to an array first and accepted.

Fix: author `objects` as an array or in the map form, or drop `strict: false` to have every schema check run.

No code is added to the ADR-0112 ledger and no export changes: `STACK_SCHEMA_INVALID` is already registered under `@objectstack/spec`.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, Zod schema, export, config field or stored metadata shape is added, removed, renamed or re-spelled. The strict defineStack parse already refused every input this refuses, so an authored stack that passed its schema builds exactly as before; what narrows is the runtime behaviour of the strict: false door on inputs that bypassed that parse, and objectstack migrate meta has no document to rewrite for it. -->

Clause-②: no (narrowing)
