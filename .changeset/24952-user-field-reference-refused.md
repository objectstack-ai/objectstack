---
'@objectstack/spec': minor
---

feat(spec)!: a `user` field whose `reference` names an object other than `sys_user` is refused at parse, and every `user` field resolves to `sys_user`

Clause-②: no (narrowing)

<!-- adr-0087: registered user-field-foreign-reference-refused -->

**BREAKING** (the accept set of `FieldSchema` narrows), shipped as `minor` under the repo's launch-window convention for breaking changes.

- **What was wrong.** The spec declares a `user` field's target fixed to `sys_user`, and nothing enforced it. `{ type: 'user', reference: 'probe_account' }` parsed, and `referenceTargetOf` resolved it to `probe_account`. Readers that follow the target (`$expand`, imports, seed loading, field paths) treated the field as a link to `probe_account`, while readers that branch on the type (the person picker, a `current_user` default, a sharing rule over the users a field holds) treated its values as users.
- **FROM:** a `user` field with `reference` naming any object but `sys_user` parsed, and resolved to the named object.
- **TO:** `FieldSchema` refuses it with an issue at `reference` that names the replacement, so `ObjectSchema`, `ObjectExtensionSchema`, `defineStack`, `os validate` and the metadata save door refuse it too. `referenceTargetOf` answers `sys_user` for every `user` field, whatever `reference` says, so a stored body saved before this release resolves to `sys_user` as well. `Field.user()`'s config types `reference` as `'sys_user'` and writes `sys_user` after the config spread.
- **Unchanged:** a `user` field without `reference`, with `reference: 'sys_user'` or with a blank `reference`, and `Field.user()`'s output for every typed call.
- **Fix:** change such a field to a `lookup` on the object it names, `{ type: 'lookup', reference: 'TARGET' }` (`Field.lookup('TARGET', …)`), and choose its `deleteBehavior` on purpose: a `lookup` defaults to `'set_null'` when the target record is deleted, which a `user` field never did. A `current_user` default is not legal on a `lookup` to an object other than `sys_user`. If a person was meant, drop `reference`.
- **Why no automatic rewrite.** No ADR-0087 conversion can carry the change losslessly: a `lookup` joins the referential delete walk and `deleteBehavior` has no value that means "leave it". `objectstack migrate meta` reports the semantic entry `user-field-foreign-reference-refused` instead.
- **Also:** the `@objectstack/lint` advisory `user-field-foreign-reference`, added for 18.x and never published, is withdrawn: the parse refusal replaces it. No published `@objectstack/lint` export changes.
