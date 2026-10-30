---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

fix(spec): the permission-set form asks for the label first, and requires it

Clause-②: no
Metadata-protocol: none

The Identity section of `permissionForm` (the form `/meta/types` serves for the `permission` kind) listed `name`, the API name, before an optional `label`, so an administrator creating a permission set typed a machine name first and could save a set with no human label, while the Console's create form fills `name` from the label. The section now lists `label` first and required, then `name`, whose help says it is derived from the label when the set is created.

`required` on a form row is a layout flag the renderer reads: `PermissionSetSchema` is unchanged and still accepts a set with no label, and nothing changes in how `name` is derived.

`@objectstack/platform-objects` carries the regenerated metadata-form bundles: the `permission` form's `label` row now precedes `name` in every locale, the English `name` help is the new source text, and the zh-CN, ja-JP and es-ES `name` help is translated to match.
