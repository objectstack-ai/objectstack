---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/plugin-security': minor
'@objectstack/objectql': minor
---

feat(spec, security): a `controlled_by_parent` object may declare an optional master, and a detail row with no master is read by its owner

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — #30907 (card 3/3 of the ruling: the docs and skills that teach `controlled_by_parent` still say the master is always required); this diff teaches the optional master in ADR-0055 §1 and §2 as amended, in `os explain relationship/master-detail-required` and `os explain security-controlled-by-parent-no-relation`, and in the semantic migration entry `cbp-optional-master-admitted`

A rule like "a rep sees the contacts of the accounts they own; a contact need not have an account" now has a declarative form. Declare the detail's only `master_detail` with `required: false`:

```ts
fields: {
  account: Field.masterDetail('crm_account', { label: 'Account', required: false }),
},
sharingModel: 'controlled_by_parent',
```

- **`@objectstack/spec`: the optional master.** A `controlled_by_parent` object whose only `master_detail` is declared `required: false` passes the parse and `ObjectSchema.create()` with that value kept. `controlledByParentMasterOf(fields)` is exported from `@objectstack/spec/data` beside `controlledByParentMasterRefusal`: it answers the one master's field and whether it is optional. `isControlledByParentMasterField` still means the required master. Every other refusal stands: two masters, a required `lookup` only, and a `readonly` or `system` master. `ObjectSchema.create()` still forces an omitted `required` to `true`, and still refuses `required: false` on a `master_detail` beside another one. A stored row the v18 upgrade listed because its master declared `required: false` is valid now and no longer listed (`os migrate meta`); the semantic entry `cbp-optional-master-admitted` records it. The raw parse reads an omitted `required` as `false` and so admits it as the optional master; `os lint` reports the omission (below).
- **`@objectstack/plugin-security`: the null-master read arm.** For an optional master, the controlled-by-parent read filter is the unchanged master arm OR a second arm for rows whose master reference is empty: every such row for a holder of View All on the detail, else the caller's own (`owner_id`), else none (an object without an `owner_id` column). A row with no owner (a queue row) is View All's alone. The two arms never share a row, and View All on the detail does not open the master arm. Every read door composes the one filter, so the data API, analytics, search, export, the parent gates of attachments, comments, activity and approvals, chains and delegated reads follow. A required master's filter is unchanged. `security/explain` names the null-master arm on a record read. Writes are unchanged: an insert or update that leaves the master reference empty is still refused with 422.
- **`@objectstack/lint`.** `relationship/master-detail-required` passes the optional master, still reports `readonly` / `system` on it, and reports an omitted `required` on the only `master_detail` at `error`, naming both spellings (`required: true`, or `required: false` for an optional master). `security-controlled-by-parent-no-relation` and `-ambiguous-relation` resolve the optional master as the parse does.
- **`@objectstack/objectql`.** The boot refusal of a master the engine cannot compose a read over now judges an optional master's detail too.
