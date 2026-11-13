---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals)!: an approval decision or comment attaches only files its caller uploaded

Clause-②: no (narrowing) — an approve, reject or comment that carries `attachments` accepts an id only when it names a file of the request's organization that the caller uploaded; every other value is refused before anything is written, with one `VALIDATION_FAILED` answer. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and nothing at rest is rewritten: what moves is the approvals service's verdict on the attachments of one decision or comment, so there is nothing for a migration to rewrite. -->

**BREAKING** fail-closed narrowing at the approvals service's decision and comment doors (`ApprovalService.decide` / `decideNode` and `ApprovalService.comment`, reached through the REST approvals routes and every caller of the service).

- **The rule.** Every id in `attachments` must name a file of the request's organization that the caller uploaded. Anything else is refused with `VALIDATION_FAILED` (`400` on the REST door) before anything is written, and every refusal is the same answer: a file someone else uploaded, an id that names no file, a file the caller uploaded in another organization, and a value that is not a list of ids.
- **Unchanged.** A decision or comment with no attachments, and the caller's own uploads (the Console's decision dialog uploads the file first, so it is unaffected). A system caller is not judged, and a composition with no file store (no `sys_file` object) is untouched.
- **Who moves.** A client that attached a file it did not upload itself (for example, one already on the record) now gets `400 VALIDATION_FAILED`: upload the file as the deciding user, then attach that upload.
