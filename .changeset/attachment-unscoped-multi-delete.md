---
"@objectstack/service-storage": patch
---

fix(service-storage): an UNSCOPED multi-delete of `sys_attachment` is refused instead of authorized (#4757)

`installAttachmentAccessHooks`'s `beforeDelete` gate resolved the rows a delete
matches in two ways — by `input.id`, or by `input.options.where` — and then
short-circuited with `if (!rows.length) return`. A delete carrying **neither**
an id **nor** a `where` took neither branch, so `rows` stayed empty and the gate
returned *allow*. That is not "nothing matched": nothing was ever queried.

The engine reads the same call as a bulk delete over everything — with no
single id it seeds the delete AST as `{ object }` and hands that to
`driver.deleteMany` — so `ql.delete('sys_attachment', { multi: true })` emptied
the whole attachment table with the record-level gate having authorized exactly
zero rows. Neither layer underneath catches it: plugin-sharing composes no
row-scoping predicate for an object with no owner field (`sys_attachment`'s
provenance column is `uploaded_by`), and plugin-security only refuses callers
whose grants lack the delete bit on `sys_attachment` — an app shipping the
domain grant the attachments panel requires passes RBAC and lands here.

The gate now fails **closed** on that shape: no id and no `where` is refused
with 403 `ATTACHMENT_DELETE_DENIED` ("Refusing an unscoped multi-delete of
attachments — scope the delete to the rows you mean"), the posture #4630 gave
`sys_comment` in `resolveTargetRows`. "Nothing to authorize" and "nothing was
ever queried" are different verdicts, and reading the second as the first is
fail-open.

Scoped deletes are unchanged: an id-bound delete, a `where`-bound multi-delete,
and even `where: {}` (which matches every row but is a real query) still resolve
their rows and authorize each one uploader-or-parent-editor as before — a delete
that legitimately matches no row still passes. Only the predicate-less call is
newly refused. If you were relying on `ql.delete('sys_attachment', { multi:
true })` to clear the table, pass a predicate (`{ multi: true, where: {} }`
authorizes row-by-row) or perform the sweep under a system context, which
bypasses the gate as before.
