---
"@objectstack/platform-objects": patch
---

fix(platform-objects): remove invalid `unique` validation rule on sys_user

`sys_user` declared a `validations: [{ type: 'unique', ... }]` rule, but #1485
removed `'unique'` from the enforceable validation-rule types (uniqueness is an
index concern, not a validation rule). The stray rule slipped onto `main` as a
semantic merge conflict and failed schema parse at registration (ZodError:
invalid discriminator value), breaking Test Core. Email uniqueness is already
enforced by the unique index (`indexes: [{ fields: ['email'], unique: true }]`),
so the redundant validation block is removed.
