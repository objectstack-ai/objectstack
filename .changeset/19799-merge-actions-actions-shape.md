---
'@objectstack/spec': minor
---

fix(spec): `defineStack(config, { strict: false })` refuses a malformed `actions` — top-level or an object's own — with the ADR-0112 envelope

**BREAKING** — `defineStack`, a public root export, now refuses under `strict: false` a class of input it used to crash on or hand on unusable: a non-array `actions`, or an `actions` array holding an entry that is not an object, at the top level or on an object.

The non-strict door skips the parse and hands the normalized input to the action merge that ends every `defineStack` call. That merge stable-sorts every `actions` array by `order` and read each one with no shape guard. Measured before this change:

| `actions` under `strict: false` | before | after |
| :--- | :--- | :--- |
| top-level, a number or a string (`5`, `'abc'`) | bare `TypeError: actions.some is not a function`, `code` and `status` both `undefined` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, issue at `['actions']` |
| top-level, an array holding `null` (`[null]`) | bare `TypeError` reading `order` of `null` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, one issue per entry at `['actions', index]` |
| top-level, an array holding another non-object (`[5]`) | returned with the entry in place | refused, `STACK_SCHEMA_INVALID`, `status: 422`, one issue per entry at `['actions', index]` |
| an object's own, a non-array (`5`, `'abc'`, `{}`) | bare `TypeError: actions.some is not a function` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, issue at `['objects', i, 'actions']` |
| an object's own, an array holding a non-object (`[null]`, `[7]`) | bare `TypeError` reading `order` of `null`, or returned with the entry in place | refused, `STACK_SCHEMA_INVALID`, `status: 422`, one issue per entry at `['objects', i, 'actions', index]` |

A falsy non-array (`null`, `false`) at either site, which the merge used to hand on untouched, is refused the same way. `strict: false` skips validation — cross-references and schema detail — and never promised to accept a shape the merge cannot read. Each refusal carries the code the strict parse raises for the same authored mistake, with the zod issues on `issues` at the strict parse's own paths, all findings in one refusal; the top-level line is the one `composeStacks` already draws for a non-array `actions`. The same merge ends `composeStacks`, so a hand-built input stack whose `actions` carries a non-object entry is now refused there with the same code instead of being carried into the artifact. Every row narrows: nothing that used to be refused is accepted now. An absent `actions` (`undefined`) is not malformed and behaves as before, and the top-level map form is still normalized to an array first.

Fix: author every `actions` as an array of action definitions (the top-level one may also use the map form), or drop `strict: false` to have every schema check run.

No code is added to the ADR-0112 ledger and no export changes: `STACK_SCHEMA_INVALID` is already registered under `@objectstack/spec`.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, Zod schema, export, config field or stored metadata shape is added, removed, renamed or re-spelled. The strict defineStack parse already refused every input this refuses, so an authored stack that passed its schema builds exactly as before; what narrows is the runtime behaviour of the strict: false door, and of composeStacks on hand-built inputs, on inputs that bypassed that parse, and objectstack migrate meta has no document to rewrite for it. -->

Clause-②: no (narrowing)
