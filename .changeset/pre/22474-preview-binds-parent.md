---
'@objectstack/objectql': minor
---

A `validate()` preview binds the master-detail header the write binds, so an import dry run of a detail row whose field rule reads `parent` admits the rows the import admits (#22474)

Clause-②: yes

The preview's accept set widens: rows it refused, and the write admits, are now admitted. No key, export or error code is added, removed or renamed.

- **Before.** A preview (`engine.validate(object, rows, { mode })`, `validateData`, and the import dry run) bound no master-detail header. A field `requiredWhen` that reads the header, such as `parent.status == 'sent'` on an invoice line, faulted there and the preview refused the row with `rule_violation` / `unevaluable`, in both modes, although the insert and the update resolve the header and admit it under a draft header.
- **Now.** The preview binds `parent` as the write binds it: from the row's master-detail reference on an insert, and on an update from the reference the patch carries, else from the stored row the row's `id` names. An update that moves the row to another header also binds the header the stored row hangs off, which the write reads to decide whether the stored row already violated the rule. So a row under a draft header is admitted and a row that leaves the field empty under a sent header is refused with `required`, as the write refuses it. Only an object that declares a field `requiredWhen` reading `parent` reads a header, as on the write.
- **Read under the caller's access.** The write reads the header with system access, kept to the caller's organization. The preview first reads it through the engine's read door, under the caller's own context: a header the caller cannot read gets the verdict a missing header gets. A header column is judged only where the read door served this caller that very value. A column the read door hid, or served transformed (a partially masked field, a masked secret), is judged as empty, so the verdict never depends on a header value the caller could not read in full. For such a caller the preview can therefore answer differently from the write, which judges the stored header.
- **Unchanged.** An object with no field `requiredWhen` reading `parent` reads no header and gets the verdict it got before. The preview still runs no `readonlyWhen` strip, so an update whose `readonlyWhen` would keep the row on its stored header is judged against the header the patch names.
