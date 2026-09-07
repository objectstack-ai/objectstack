---
"@objectstack/spec": patch
---

The tenant-scope and owning-business-unit system columns now render a localised display name on the `/meta` read exits, as the other platform-injected columns already did.

`translateObject` carries a built-in label table for the columns the platform injects onto every eligible object, applied while a column still carries its injected English default, so a `zh-CN` / `ja-JP` / `es-ES` request never sees the English label on a custom object that ships no translation entries of its own. The table covered `owner_id`, `created_at`, `created_by`, `updated_at` and `updated_by` but not the two remaining injected columns, `organization_id` (`Organization`) and `owning_business_unit_id` (`Owning Business Unit`), so those two leaked English on every locale. Both rows are added, with the wording the platform bundles already use for the same columns on platform objects. The identity-stable column definitions are untouched, no new authorable key is introduced, and a label a tenant or author customised is still never overridden.
