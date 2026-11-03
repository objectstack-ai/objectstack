---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit)!: a comment's display name is stamped from the caller's session, like its author id

Clause-②: no (narrowing) — on a `sys_comment` write by a non-system caller, an `author_name` / `author_avatar_url` the request carries is not stored: on create both are the session user's own, and on update both are read-only and dropped (reported in `droppedFields`). Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime accept set on two platform-written columns of one platform object, `sys_comment.author_name` and `author_avatar_url`, whose values now come from the user's own profile; the remedy for a user who wants another name or picture shown is editing that profile, which no ledger entry can derive. The other categories are closed on facts: the bumped package publishes (not unpublished); no ADR-0087 id covers these columns and this diff adds none (not registered, not already-registered); `installAuditWriters` gains a return value and `installCommentAccessHooks` an optional parameter, so no export is retired and no interface or type narrows (not runtime-export-retired, runtime-interface-only or type-surface-only). -->

**BREAKING** accept-set narrowing on `sys_comment` writes (`@objectstack/plugin-audit`), served by every data door (REST, MCP, the console).

- **Now.** A comment's display identity is the server's, the same as its `author_id`. On create, `author_name` and `author_avatar_url` are the session user's own display name and avatar, read from their `sys_user` profile (the title column and `image`) through the same resolution the record history's actor columns are written with, and assigned whether or not the request carries them. A user whose profile cannot be read is stored with neither. On update both fields are `readonly`: a non-system caller's value is dropped and reported in `droppedFields` and the `X-ObjectStack-Dropped-Fields` header, the rest of the write lands, and the write is never refused, so an edit, the author's or a parent editor's, never changes whose name a comment shows.
- **Unchanged.** `author_id` keeps its rules. System-context writes (seeds, imports, migrations) keep the values they supply, on create and on update. Comments already stored keep what they were written with. The console needs no change: the create payload it sends is accepted and its display fields are assigned over.
- **Also.** A comment posted without a display name (a REST, MCP or agent client that sends none) now shows its author's name, where it used to show none.
- **Hosts that compose the hooks themselves.** `installAuditWriters` now returns a handle whose `resolveActorSnapshot(api, userId)` is that resolution, and `installCommentAccessHooks` takes it as an optional sixth argument, `resolveAuthorIdentity(ctx, userId)`. `AuditPlugin` wires the two together. A host that installs the comment hooks without it stores no display identity on new comments (readers show them as unknown) and is told so once, at install, at `warn`.

**The remedy.** None for the console or for a client that sends no display identity. A user changes the name and picture their comments show by editing their own profile (`sys_user.name` / `image`); a comment keeps the values it was created with.
