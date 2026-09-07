---
"@objectstack/spec": patch
"@objectstack/runtime": patch
---

fix(spec): `defineStack`'s cross-reference refusal carries an ADR-0112 envelope, so the five REFUSED ADR-0130 item classes are machine-readable (#14552)

`validateCrossReferences` — reached through `defineStack` — refuses a stack whose items name an object the stack does not define. That refusal was `new Error(message)` with `code` and `status` both `undefined`, so all five REFUSED item classes of the ADR-0130 matrix (action `objectName`, view `data.object`, permission-set `objects`, seed dataset `object`, import mapping `targetObject`) plus the `hooks[].object` rule (#14122 §4 rule R4) were distinguishable only by MESSAGE TEXT. It now throws `StackCrossReferenceError`, carrying `code: 'STACK_CROSS_REFERENCE_INVALID'`, `status: 422`, and one entry per finding in `issues`. The message text is byte-for-byte unchanged: this adds fields rather than rewriting a sentence, and five message-substring pins in the tree read that prose.

ADR-0112 makes `code` / `status` the machine-readable half of every refusal. Without them `os validate`, `os build` and any AI author reading the refusal could only pattern-match prose — the fragile shape the envelope exists to remove, made worse here because the message had already become load-bearing for those pins.

Why ONE code rather than five: there is exactly one raise site. `validateCrossReferences` returns every finding as a `string[]` and `defineStack` throws the collected set at once, so a single refusal can carry findings from several classes together and a per-class code would have to pick one of several true answers. The classes stay machine-readable in `issues`. The family is also wider than "undefined object" — the same aggregate carries the duplicate-action-key, global-`update`-action and mapping `javascript`-transform findings — so a `…_UNDEFINED_OBJECT` spelling would have been false for those.

Not narrowed, not widened: no accept-set changes and no export changes. `defineStack` accepts and refuses exactly the inputs it did before, and `StackCrossReferenceError` is deliberately module-local — `packages/spec/src/index.ts` re-exports that module with `export *`, so exporting the class would widen the published api-surface of the contract package, and the ADR-0112 contract is the `code` / `status` fields, which every reader reads structurally rather than by `instanceof`. No ledger registration either, for the same reason its two precedents (`ObjectOwnershipConflictError` #14367, `NamespaceConflictError` #14474) carry none: no wire door raises it. `defineStack` runs at authoring and boot time, and no HTTP domain handler calls it.

`@objectstack/runtime` carries the classification row for the new code in the dispatcher error-code vocabulary (verdict `boot-refusal`, door `none` — the measured verdict, not the expected one).
