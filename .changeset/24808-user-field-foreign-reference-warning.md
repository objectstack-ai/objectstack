---
'@objectstack/lint': patch
'@objectstack/spec': patch
---

feat(lint,spec): `os validate`, `os build` and `os lint` warn on a `user` field whose `reference` names an object other than `sys_user`, and `Field.user()` marks `reference` deprecated

Clause-②: no

- **What was wrong.** The spec declares a `user` field's target fixed to `sys_user`, and nothing enforced it. `{ type: 'user', reference: 'probe_account' }` parsed, `os validate` passed it, and `referenceTargetOf` resolved it to `probe_account`. So every reader that follows the target (`$expand`, imports, seed loading, the object graph) treated the field as a link to `probe_account`, while every reader that branches on the type (the person picker, the `current_user` default, a sharing rule over the users a field holds) treated its values as users.
- **What changed.** A new advisory, `user-field-foreign-reference`, fires on such a field on an object or an object extension. It names the field and the target, and its hint is the canonical spelling: `{ type: 'lookup', reference: '<target>' }` (`Field.lookup('<target>', …)`), or drop `reference` if a person was meant. It is a warning, so no command's exit code changes. `Field.user()`'s config now types `reference` as `@deprecated`. The accepted values are unchanged.
- **Why only a warning in 18.x.** A narrowing ships its refusal in an 18.x minor only when an ADR-0087 conversion can rewrite the old shape. This one cannot, because the rewrite is not lossless. A `user` field is outside the referential delete walk, while a `lookup` gets `deleteBehavior: 'set_null'` and joins it. `deleteBehavior` has no value that means "do nothing", so a converted field would start clearing child columns when its target record is deleted, which a `user` field never does. The refusal is planned for the next major.
- **Unchanged.** Parsing, the runtime's resolution of such a field (it still follows the authored `reference`), `Field.user()`'s output, and `user` fields written without `reference` or with `reference: 'sys_user'`.
- **What to do.** Change a `user` field that points at another object to a `lookup` on that object. No in-repo app or package wrote this shape. Two test fixtures did: one is now a `lookup`, and the other deliberately pins the 18.x resolution.
