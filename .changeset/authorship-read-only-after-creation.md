---
'@objectstack/plugin-audit': patch
'@objectstack/service-storage': patch
'@objectstack/platform-objects': patch
---

fix(plugin-audit, service-storage)!: a row's author or uploader is read-only after creation, like the comment's display name

Clause-②: no (narrowing) — on a write by a non-system caller, `sys_comment.author_id`, `sys_attachment.uploaded_by` and `sys_file.owner_id` are read-only on update and dropped (reported in `droppedFields`), and a comment or attachment create whose session names no signed-in user is refused. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime accept set on three platform-written columns of three platform objects, `sys_comment.author_id`, `sys_attachment.uploaded_by` and `sys_file.owner_id`, whose value is recorded once at creation; the remedy for a writer that needs another value recorded is a system-context write, which no ledger entry can derive. The other categories are closed on facts: the bumped packages publish (not unpublished); no ADR-0087 id covers these columns and this diff adds none (not registered, not already-registered); no export is added, removed or retyped, so no interface or type narrows (not runtime-export-retired, runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing on `sys_comment`, `sys_attachment` and `sys_file` writes (`@objectstack/plugin-audit`, `@objectstack/platform-objects`, `@objectstack/service-storage`), served by every data door (REST, MCP, the console).

- **Now.** A row's author or uploader is recorded once, at creation, and is read-only after it, like the comment's display name. `sys_comment.author_id`, `sys_attachment.uploaded_by` and `sys_file.owner_id` declare `readonly: true`. On update a non-system caller's value is dropped and reported in `droppedFields` and the `X-ObjectStack-Dropped-Fields` header, the rest of the write lands, and the write is not refused. This holds for every non-system caller: the author's or uploader's own edit, a parent editor's, and, on `sys_file.owner_id`, a holder of the ownership-transfer grant.
- **Refused.** A non-system create of a comment or an attachment whose session names no signed-in user is refused with 403 `RECORD_NOT_ACCESSIBLE`, as a comment reaction with no signed-in user already is: there is no user to record as its author or uploader. A signed-in create is unchanged: the session user is recorded, whatever the request carries.
- **Unchanged.** System-context writes (seeds, imports, migrations) and a historical import's update (`preserveAudit`, which only the system principal may start) keep the values they supply. The upload doors already refuse a request with no signed-in user. Stored rows keep what they were written with. The console needs no change: it never sends these columns on an edit.
- **Also.** `sys_comment.author_id` stays `required`, but as a `readonly` field its presence on a system-context create is the writer's to supply: the engine's record validator does not refuse a system create that omits it.

**The remedy.** None for the console. A client that sends one of these columns on an edit gets the same answer as before, with the column reported in `droppedFields`; to record a different author or uploader on an existing row, write it from a system context (a migration or an import). A server-side caller that creates comments or attachments with no signed-in user runs as the system principal or names the user it acts for.
