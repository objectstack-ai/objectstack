---
"@objectstack/spec": patch
"@objectstack/platform-objects": patch
---

`permissionForm` stops teaching the Profile concept ADR-0090 D2 removed — in the shipped section description, and in all four locales.

The form's `Identity` section description read *"Permission Sets stack on top of a Profile to grant additional access. Profiles are the base set assigned 1:1 to each user."* That is the model ADR-0090 D2 retired: it deleted `isProfile` from `PermissionSetSchema` (removed, not deprecated), leaving permission sets as the only capability container. The same file's docstring claimed the form serves a `profile` metadata kind alongside `permission`, and carried a half-edited sentence — *"The only flags are minimal (ADR-0090 D2 removed the Profile concept) so admins can see and toggle it explicitly"* — that named no flag and whose `it` referred to nothing.

The description is the half that ships, and it shipped translated: `en`, `zh-CN`, `ja-JP` and `es-ES` all carried it. None of the three translated leaves has a recorded source hash (`metadataForms.permission.*` has zero entries in any of the three `*.source-hashes.generated.ts` tables, against 158/191/191 `metadataForms.*` entries overall), so they are legacy-trusted: changing the English alone would have left three languages teaching the retired concept under a green build, with nothing reporting it stale. All four move together here.

- **The description now states the v2 model**: permission sets are the only capability container, a user gets the union of every set they hold so sets only ever add access, and positions distribute sets to people — the same three facts `PermissionSetSchema`'s own header states (`packages/spec/src/security/permission.zod.ts`).
- **The docstring says what the tree enforces**: the form serves `permission` and only `permission`. `METADATA_FORM_REGISTRY` has no `profile` key, `MetadataTypeSchema` admits no `profile` kind, and `PermissionSetSchema` answers an authored `isProfile` or `profiles` with a retirement tombstone rather than a silent strip.
- **The subjectless sentence is replaced by a true one**: the form surfaces no flag, because `isDefault` (ADR-0090 D5) is the schema's only boolean and it records a boot-time binding hint, not a grant.
- **One further translated leaf moves**: the zh-CN label for the `permission` form group read `"权限集 / 配置文件"`, appending the retired concept to a source label that is plain `Permission Set` (`metadata-plugin.zod.ts`). `ja-JP` and `es-ES` already rendered the source faithfully.

No schema, key, registry entry or export moves — the accept set is byte-identical.
