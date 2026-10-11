---
'@objectstack/core': minor
---

fix(core): an import reads WHICH fields are references through the spec's arbiter, so a `user` field written without `reference` resolves against `sys_user` (#22785)

Clause-②: yes (widening)

A `user` field's target is fixed by its type: the spec's arbiter `referenceTargetOf` gives `{ type: 'user' }` the target `sys_user` whether or not `reference` is written (`Field.user()` writes it; hand-written JSON, a form or an AI author may not), and the data door's `$expand` already reads it that way. `buildFieldMetaMap`, the field map behind the import, export and import-template doors, counted a field as a reference only when it carried a `reference` string, so those doors disagreed with the arbiter for such a field. It now asks the arbiter both whether a field is a reference and what its target is.

**FROM → TO, door by door.** Measured on a real boot, as an administrator and as a member, on a fixture object holding a `user` field written without `reference` beside a `Field.user` one; the connector pull through its executor over a stub protocol.

- **Import: `POST /api/v1/data/:object/import`, `POST /api/v1/data/:object/import/jobs`, and a mapping's `connectorSource` pull (same runner).**
  - FROM: a cell holding a user's email or name was written as the field's id, so the row failed `reference_not_found` ("no sys_user record has id …") and nothing was stored.
  - TO: the cell is matched against `sys_user` exactly as on a `Field.user` field, so an email or a name stores the user's id. A pasted id of a user the caller can see still stores. A value matching no user still fails `reference_not_found`, now in the import's own words ("no record matches …"), and a name matching several users fails `reference_ambiguous`.
  - `sys_user` is asked its declared exposure first, as every lookup target is: where its `enable` declaration refuses `list`, the cell is refused.
- **The one population that narrows, to `Field.user`'s answer.** A pasted id of a user the caller's row scope hides (a user outside the caller's organizations) used to store, since the write's own reference check runs elevated. It now fails `reference_not_found`, as it already did on a `Field.user` field. The data door's `POST /api/v1/data/:object` is unchanged and still accepts that id.
- **Export: `GET /api/v1/data/:object/export`.** FROM: the column carried the stored user id (JSON and CSV). TO: it is expanded like a `Field.user` column and renders the user's name, so an exported file imports back through the name.
- **Import template: `GET /api/v1/data/:object/export?template=true`.** FROM: the column's instructions named no target ("The name of a  record, or its id."). TO: they name `sys_user` by its label ("The name of a User record, or its id.").
- **Unchanged:**
  - `Field.user` and every field declaring `reference`.
  - A `lookup`, `master_detail` or `tree` field without `reference`: the arbiter names no target for it.
  - A non-reference type declaring `reference`: still no target.
  - A present `reference` that is not a string: still no target, and no throw.
  - plugin-auth's identity import, which reads `sys_user`'s own map. That map has no reference-typed field without `reference`, so it is identical.

**Fix, if a pipeline relied on the old answer:** none is needed for one that wrote visible user ids. A pipeline that imported ids of users outside the caller's organizations runs as a caller who can see them, as a `Field.user` field already required.
