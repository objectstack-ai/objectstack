---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
"@objectstack/plugin-security": minor
---

fix(sharing)!: an edit-level share no longer grants delete (ADR-0111 D3, the verb boundary)

`update` and `delete` shared one `canEdit` gate, and `canEdit` accepts an
`edit`-level share — so one "edit" grant silently conferred delete, the
opposite error from the retired `full` level. A share widens *which rows* a
principal reaches, never *which verbs* they may use (Salesforce Read/Write
cannot delete; Dataverse `Delete` is a distinct privilege; Odoo splits
`write`/`unlink`).

- `ISharingService.canDelete(object, recordId, context)` — ownership (widened
  by write DEPTH) or the `modifyAllRecords` super-user bypass ONLY; an `edit`
  or legacy `full` share does not confer it. `canEdit` is unchanged (the
  update gate, share included).
- `SharingService.buildWriteFilter` takes a `verb` parameter: a bulk
  `delete({multi:true})` scopes to the owner/DEPTH set alone (no share
  widening), while a bulk `update` keeps it.
- The sharing middleware routes `delete` through `canDelete` and logs a
  specific fail-closed reason on denial (ADR-0111 D10).
- `/security/explain` consults `canDelete` for a `delete` operation, so the
  record-level explanation matches enforcement.

**Breaking**: a caller who could delete a record *only* through an edit-level
share (and holds object-level delete CRUD) can no longer delete it — delete now
requires ownership, write depth, or Modify All Data. No new delete access level
is introduced; a future per-record delete grant would be a capability mask
AND-ed with object CRUD, not a fourth share level.
