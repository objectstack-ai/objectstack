---
'@objectstack/verify': minor
---

fix(verify)!: `hooks.run(object, 'delete', …)` resolves with what the engine's `delete` answers, not with a row

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-interface-only packages/verify/src/handle.ts#VerifyHandle) One TypeScript-only declaration moves, and it is not metadata: the `hooks.run` member of the published `VerifyHandle` interface, whose `delete` answer narrows from a row to the engine's own declared delete answer. No spec key, authorable spelling, Zod schema, export name or stored shape moves, and no runtime behaviour changes, so `objectstack migrate meta` has nothing to rewrite. The party affected is a TypeScript author who read a field of a delete's answer: the compiler names that read at their own call site, and the body says what to assert instead. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a test handle's return type, and this diff adds none (not `registered` / `already-registered`); and the member was typed with the named `EngineRow` at the merge base, which predicate 4 reads as concrete, not erased (not `type-surface-only`). -->

**BREAKING** for TypeScript code that reads the answer of a `hooks.run` delete. It ships as `minor` under the launch-window convention for breaking changes. No runtime behaviour changes.

`hooks.run(object, 'delete', { id }, opts)`, for a person (`{ as }`) and for the system (`{ system: true }`), was declared to resolve with a row (`Promise<EngineRow>`). The engine's `delete` answers `true` for the row it removed. So a test that read a field of the answer type-checked, and then read `undefined`.

**What `hooks.run` declares now.** Both overloads are generic over the operation.

- An `insert` or an `update` resolves with the row, as before.
- A `delete` resolves with the engine's own declared delete answer, `boolean | number`. It is read off `ObjectQL['delete']` rather than re-declared, and a `hooks.run` delete, which is always by id, answers `true`.
- A call whose operation is the union `'insert' | 'update' | 'delete'` still type-checks, and resolves with the union of the answers.

**If your code read a field of a delete's answer.** That read was always `undefined` at run time, and it is now a compile error. Assert the answer itself, `expect(await stack.hooks.run(object, 'delete', { id }, opts)).toBe(true)`. If the test needs the deleted row, read it with `stack.rows(object, { id })` before the delete.
