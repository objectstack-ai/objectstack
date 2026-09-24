---
'@objectstack/spec': patch
---

fix(spec): `composeStacks` refuses a malformed `actions` with the ADR-0112 envelope instead of crashing in its action-key collision pass

`composeStacks` checks the composed stacks for cross-stack action-key collisions before it binds each standalone action to its object. That check read every input's top-level `actions` entries, and every composed object's own `actions`, with no shape guard. On a hand-built input stack it therefore crashed before the bound-action merge could refuse the same input. `defineStack` already refuses these shapes at its own door, with or without `strict: false`, so a stack it built never reached this crash. Measured before this change:

| malformed input stack | before | after |
| :--- | :--- | :--- |
| top-level `actions: [null]` or `[undefined]` | bare `TypeError` reading `objectName`, `code` and `status` both `undefined` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, issue at `['actions', index]` |
| an object's `actions: 5` (or `'abc'`, `{}`, `true`) | bare `TypeError: (obj.actions ?? []).entries is not a function` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, issue at `['objects', i, 'actions']` |
| an object's `actions: [null]` or `[undefined]` | bare `TypeError` reading `name` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, issue at `['objects', i, 'actions', index]` |
| two stacks that each carry a non-object top-level entry (`['x']`) | refused as `STACK_COMPOSE_ACTION_KEY_COLLISION` on the key `global:undefined` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, one issue per entry |

The collision check now skips anything that declares no action key: a non-object entry, and an object's `actions` that is not an array. It does not word a refusal of its own. Every such input still reaches the bound-action merge, whose existing guard gives the one refusal for this condition. The index in each issue path is the entry's index in the composed artifact. Nothing that used to be accepted is refused now, and nothing that used to be refused is accepted. Well-formed stacks compose exactly as before, and a real cross-stack collision is still refused with `STACK_COMPOSE_ACTION_KEY_COLLISION`, including one that sits beside a skipped entry.

Fix: author every `actions` as an array of action definitions, or run each stack through strict `defineStack` to have the shape refused where it is written.

No code is added to the ADR-0112 ledger and no export changes: `STACK_SCHEMA_INVALID` is already registered under `@objectstack/spec`.

Clause-②: no
