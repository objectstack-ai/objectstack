---
"@objectstack/cli": patch
---

fix(cli): drop stale `ownership` key from the `os init` scaffold object template

The `app` and `plugin` scaffold templates emitted `ownership: 'own'` on the starter object. `ownership` is no longer a valid `ObjectSchema` field (it's not in `ObjectSchemaBase`, and `ObjectSchema.create()` rejects unknown top-level keys per ADR-0032 / #1535), so a user migrating the scaffolded object into `ObjectSchema.create({...})` would hit a validation error. Removed the key from both templates; the rest of the scaffold output is unchanged.
