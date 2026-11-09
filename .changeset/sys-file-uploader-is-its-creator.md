---
'@objectstack/service-storage': patch
---

fix(service-storage)!: a stored file's uploader is the user who created it, as an attachment's and a comment's author are

Clause-②: no (narrowing) — a non-system create of `sys_file` records the session's user as `owner_id`, whatever the request carries, and one whose session names no signed-in user is refused. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime accept set on one platform-written column of one platform object, `sys_file.owner_id`, whose value is recorded once at creation; the remedy for a writer that needs another value recorded is a system-context write, which no ledger entry can derive. The other categories are closed on facts: the bumped package publishes (not unpublished); no ADR-0087 id covers this column and this diff adds none (not registered, not already-registered); no export is added, removed or retyped, so no interface or type narrows (not runtime-export-retired, runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing on `sys_file` creates (`@objectstack/service-storage`), served by every data door (REST, MCP, the console).

- **Now.** A stored file's uploader is the user who created it, as an attachment's (`sys_attachment.uploaded_by`) and a comment's (`sys_comment.author_id`) author are. A non-system create of `sys_file` records the session's user as `owner_id`, over whatever the request carries. The column was already read-only on update, so the stamp is the row's uploader for life.
- **Refused.** A non-system create of `sys_file` whose session names no signed-in user is refused with 403 `RECORD_NOT_ACCESSIBLE`, the answer an attachment or comment create with no signed-in user already gets: there is no user to record as the uploader.
- **Unchanged.** The upload doors (presigned, chunked, complete) already record the signed-in user under the system context, and keep doing so. System-context writes (seeds, imports, migrations) keep the `owner_id` they supply, as does a programmatic create with no session at all on a bare kernel. An update of `owner_id` is dropped and reported in `droppedFields`, as before. Stored rows keep what they were written with. The console needs no change: it never creates `sys_file` rows through the data API.

**The remedy.** None for the console or the upload doors. A client that creates a `sys_file` row through the data API gets the row recorded under its own user, whatever `owner_id` it sends; to record a different uploader, write from a system context (a migration or an import). A server-side caller that creates `sys_file` rows with no signed-in user runs as the system principal or names the user it acts for.
