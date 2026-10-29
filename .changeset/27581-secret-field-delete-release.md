---
'@objectstack/objectql': patch
---

fix(objectql): deleting a record releases the `sys_secret` row its `secret` field named (#27581)

Clause-②: no
Metadata-protocol: none

- **Released when the record goes.** A committed delete now removes the `sys_secret` row each deleted record's `secret` field named: a delete by id, a predicate delete (`multi: true`, and so the bulk `deleteMany` door, which deletes by id), and every detail record a cascade deletes, since those go through the by-id delete. The handles come from the rows the delete already reads before its statement (the by-id pre-image, the predicate path's matched rows), plus one narrow `id` + secret-columns read on a predicate delete that read no rows otherwise; an object with no `secret` field reads nothing new.
- **One release rule.** The removal goes through the same verified release a committed update uses when it clears a `secret` field: no remaining row of that column may still name the handle (a predicate update shares one handle across every row it matched), the handle must be that column's own, and the removal rides the record's transaction where one is open. It runs after the `afterDelete` hooks, so a hook can still read the value and a delete that is refused or rolled back keeps the row. A removal that cannot be confirmed keeps the row and logs one `error` line naming the column; `os secret orphans` reports such rows.
- **Unchanged.** What a delete answers, and what reads return. There is no soft-delete or recycle-bin path to cover. Credential rows left behind before this release are not swept; they stay report-only through `os secret orphans`.
