---
'@objectstack/service-storage': patch
---

fix(storage)!: a record write claims or copies only a file its caller may read

The file-reference claim path (ADR-0104 D3: a file field holds a `sys_file` id, at most one record's field owns a file, and writing an id another record owns copies the bytes into a fresh file the writing record owns) now asks, before it copies or claims a referenced file, whether the write's caller may read that file. The question is the download door's own verdict, asked under the write's caller context: the uploader, a reader of the one record whose field owns the file (its object's `fileAccessDelegate` where one is declared), a member of the organization for a file no record owns, a reader of a parent record for an attachments-scope file, anyone for a `public_read` file. The door and the claim path now call one judgement, so one file has one access rule.

A file the caller may not read is answered as the organization-scoped lookup answers a file it cannot see: the value is kept as written, nothing is claimed or copied, and constraint verdicts no longer run ahead of the read check. A copy this write made is claimed by the same write without a second question. System writes and context-less programmatic calls have no caller to ask and reference files as before; so does a kernel with no `auth` service, where the download door binds no gate. An authorization-store outage fails the write with its declared envelope instead of reading as either answer.

Clause-②: no (narrowing) — a record write reaches fewer files: a file its caller may not read is no longer copied or claimed for it. Nothing that was refused becomes accepted.

Metadata-protocol: none (a write path's file bookkeeping; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which files the file-reference claim path copies or claims for a record write (those its caller may read). The remedy is a change of who writes the reference (a caller who may read the file), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a write that referenced a file its caller may not read, shipped as `patch` because the metadata protocol does not move.

- **Before.** The claim path copied or claimed a referenced file without asking whether the write's caller may read it.
- **Now.** Both happen only when the caller may read the file under the download door's rule. Otherwise the record keeps the id as written and owns nothing: the file's readers are unchanged, and the written record's readers gain no access to it through that record.
- **Fix.** Reference a file as a caller who may read it (its uploader, or a reader of the record that owns it), or upload the file again. A server-side process that copies files between records on purpose runs as a system write.
