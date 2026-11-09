---
'@objectstack/spec': patch
---

docs(spec): the semantic migration entry `cbp-optional-master-admitted` and `controlledByParentMasterOf` name how a raw parse reads an omitted `required` on the optional master

Clause-②: no
Metadata-protocol: none

- **Migration entry `cbp-optional-master-admitted`.** Its `replacement` and `acceptanceCriteria` said an omitted `required` on the only `master_detail` of a `controlled_by_parent` object keeps meaning required through `ObjectSchema.create()` and on stored rows, and stopped there. They now also name the raw-parse door, as the maintainer ruled on the optional master: through `ObjectSchema.safeParse`, an object written directly in `defineStack`, or a save door, `required` defaults to `false` before the object is judged, so the omission is admitted as the optional master. `os lint` still reports the omission at `error`. The entry's `id`, `surface` and `reason` are unchanged, and so is its paragraph's meaning in the protocol upgrade guide apart from that added clause.
- **`controlledByParentMasterOf` (JSDoc).** "One whose `required` is not written names no master" holds on a body read as written. On a parsed field map the omission has already defaulted to `false`, so there the field is the optional master.

Text only: no schema, type, export or runtime answer changes. A test now pins the three doors side by side on one omitted `required`: `ObjectSchema.create()` gives the required master, `ObjectSchema.safeParse` and `defineStack` give the optional master.
