---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

`ObjectQL.find()` now guarantees the array it declares: an `afterFind` hook that replaces the result container is refused with `FIND_HOOK_RESULT_NOT_ARRAY`.

`find()` is declared `Promise<any[]>`, but on the hook path it returned `hookContext.result` with nothing re-checking the value after the `afterFind` dispatch. A handler assigning `ctx.result = { records: [ … ] }` therefore made a read declared to resolve to an array resolve to an envelope instead — silently, with no throw, no diagnostic and no log, while roughly 140 call sites read the answer as an array on the strength of the declaration.

The engine now refuses that, immediately after the `afterFind` dispatch and ahead of the two consumers that already assume the array (secret-field masking and the `__search` companion strip). The refusal is a named error, `FindHookResultNotArrayError`, carrying the registered ADR-0112 code `FIND_HOOK_RESULT_NOT_ARRAY` and HTTP `500`; its message names the hook event and the object, and `developerMessage` carries the remedy.

**Shaping stays legal, and nothing about it changes.** A handler may still mutate rows in place, delete keys, filter rows out, or assign a *different array* built from them — `Array.isArray` is the whole predicate, deliberately, so that `ctx.result = ctx.result.map(…)` keeps working. Only the container is protected.

What to do if this refusal fires:

- to answer no rows, assign `[]`;
- to refuse the read, `throw` from the handler — the supported way for any hook guard to say no;
- to hand a caller a different structure, build it in the caller, not in the hook.

`@objectstack/spec` widens by one member: `FIND_HOOK_RESULT_NOT_ARRAY` joins `ERROR_CODE_LEDGER` under `@objectstack/objectql`, so the generated `ErrorCode` union — and therefore `ApiErrorSchema.code` — accepts it. Additive: no existing code is removed or renamed.

Scope: this closes the one `return hookContext.result` site in the engine with a concrete declared shape to violate. `findOne`, `update` and `delete` declare `Promise<any>` and carry no enforceable declaration; that is a separate question about those declarations and is deliberately not answered here.
