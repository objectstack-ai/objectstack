---
'@objectstack/platform-objects': patch
---

Fix `sys_user` load failure after the validation-rule type trim (#1485)

#1485 trimmed the unenforceable validation-rule types (`unique`, `async`,
`custom`) from the `ValidationRuleSchema` discriminated union, but `sys_user`
still declared an `email_unique` rule with `type: 'unique'`. Loading the object
then threw a `ZodError` ("Invalid discriminator value … at validations[0].type"),
failing `platform-objects.test.ts` and turning `main` red.

The rule was redundant: `sys_user` already declares a unique index on `email`
(`indexes: [{ fields: ['email'], unique: true }]`), and the user table is
managed by better-auth which enforces email uniqueness at the source. Removed
the unenforceable validation rule; uniqueness remains enforced by the index.
No other object uses a trimmed validation type.
