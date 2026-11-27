---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

**Shipped in 19.0.0-next.0**, whose CHANGELOG missed this entry; listed here one prerelease late.

fix(lint)!: four publish-time checks for data-model metadata that saves and does not work — two refuse the publish, two warn

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up #37529

<!-- adr-0087: registered publish-refuses-data-model-fields-that-save-and-do-not-work -->

**BREAKING** for the publish of an object that carries one of the two errors below: it was accepted before and is refused now, with the fix named in the finding. The schema is unchanged and stored objects are not rewritten or refused at boot; the refusal comes at the next publish, and from `os validate` / `lint` / `compile` / `build`.

Two errors, run by the runtime publish gate and the CLI:

- `rollup/child-without-parent-reference`: a `summary` field whose child object has no `lookup` / `master_detail` field referencing the parent, or whose `summaryOperations.relationshipField` names no field of the child. With no foreign key the engine's summary index skips the summary with nothing logged; with a `relationshipField` that names no child field the summary is indexed and never recomputed. Either way the field reads 0 or empty on every parent while every child write reports success. Judged once the child resolves (a child the stack does not hold is still not judged), against the child's fields as served (an object extension may add the foreign key) and its injected columns (`owner_id`, `created_by` back to `sys_user`). Reported by `lintSummaryRollups`, beside its aggregand checks.
- `field/reference-on-non-reference-type`: `reference` on a field type that reads none — anything but `lookup`, `master_detail`, `user`, `tree` and `summary`. It links no record, and the record page edits a text, number or date field carrying it with a record picker that writes a record id into it. Judged on objects and on object extensions.

Two warnings, which refuse nothing and make `os validate --strict` exit 1 as any warning does:

- `field/count-named-lookup`: a `lookup` / `master_detail` field named like a count or a total (`contact_count`, `total_amount`); a relationship stores the id of one record, never a number.
- `approval-detail-editable-while-pending`: an approval step that locks its record (`lockRecord`, default `true`) on an object whose record page draws a `lookup` child as a table in its own body (`relatedList: 'primary'`); the approval lock covers `master_detail` children only, so those rows stay editable while the record waits. Reported by `validateApprovalApprovers`.

A formula reading a summary that has no configuration stays covered by `field/summary-without-operations`, which refuses the summary itself.

## FROM → TO

- `summaryOperations: { object: 'order_line', function: 'count' }` over an `order_line` with no field pointing at `order` → add `order: { type: 'master_detail', reference: 'order' }` to `order_line`.
- `summaryOperations: { ..., relationshipField: 'order_ref' }` naming no field of the child → name the child field that holds the parent id.
- `account: { type: 'text', reference: 'account' }` → `account: { type: 'lookup', reference: 'account' }`, or drop `reference`.

No new exports. `@objectstack/spec` adds only the upgrade-guide entry `publish-refuses-data-model-fields-that-save-and-do-not-work`.
