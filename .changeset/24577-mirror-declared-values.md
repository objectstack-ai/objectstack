---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approval status mirror writes only a value the field declares, so a recalled record whose status field is a select goes back to where it stood before it entered approval

Clause-②: no

**The rule:** when `approvalStatusField` is an option field (a `select`) whose options do not declare the status, a recall or the dead-run sweep writes the value the field held when the flow started (the request's submit snapshot), else the field's declared default, else empty, and every other transition writes nothing and logs a `warn` naming the object, field and value.

- **Before.** Each status was written verbatim. The engine checks a `readonly` field's value for shape only, and the spec advises a readonly status field, so a select that did not declare `recalled` ended up holding it after a recall. An app whose submit gate admits only the select's own values (for example `not_required` or empty) then never re-entered approval. On an editable select the engine refused the undeclared value, and the field kept reading `pending` with no request pending.
- **Now.** A recalled record, or one released by the dead-run sweep, reads its submit-time value again, so the app's own start condition decides whether it re-enters approval. A gate that admits that value re-admits the record at once, because the restore is itself an update.
- **Send-back keeps the field.** A select that does not declare `returned` keeps reading `pending` through the revise window. The run is still alive there (ADR-0044), and a restored pre-approval value would re-admit the start condition and open a second, parallel approval of the same record.
- **Unchanged.** A status the select declares is written as before. A field with no declared value set (text, or any type that is not an option type) gets every status verbatim, as before. The write's context is unchanged.
