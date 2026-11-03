---
'@objectstack/spec': patch
---

docs(spec): register the `user`-field `deleteBehavior` enforcement as a semantic migration entry, and stop the spec saying a `user` field never joins the delete walk (#29415)

Clause-②: no
Metadata-protocol: none

The enforcement itself shipped in `@objectstack/objectql` (#29253): a `deleteBehavior` declared on a `user` field now takes effect when the user is deleted. This change records it and corrects the spec text around it. Nothing an author can write, and nothing the runtime does, moves.

- **Migration entry.** A new semantic entry, `user-field-delete-behavior-enforced`, so `objectstack migrate meta` and the protocol upgrade guide reach the change. It names the one stored population that needs a look: objects saved while the parse still wrote `deleteBehavior: 'set_null'` on every field type can carry a `set_null` on a `user` field nobody wrote. On a field that is not `required` it clears the field when the user is deleted and is fine as it is; on a `required` field it now refuses the user delete with `409 DELETE_RESTRICTED`, so remove it or declare the outcome you want.
- **Spec text.** The `deleteBehavior` docblocks in `FieldSchema`, the `user`-field `reference` refusal message, the `user-field-foreign-reference-refused` entry, the `referentialFieldClear` and `referentialCascadeDelete` hook-context descriptions, the `getCascadeDeleteObjects` contract docblock and the `cascadeDeleteObjects` description on the metadata `object` read now say that a `user` field joins the delete walk when it declares a `deleteBehavior`, and stays out when it declares none.
- **Studio forms.** The field designer and the object form's field rows now show the `deleteBehavior` control on a `user` field, with all three outcomes, as they do on a `lookup`. A `user` field has no default, so the control writes a value only when you pick one.
