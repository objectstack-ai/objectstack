---
'@objectstack/service-storage': patch
---

fix(storage)!: a record write naming a file its caller may not read is refused at the field

A record write that names a file its caller may not read is now refused at that field, instead of saving the id as written. The answer is one `400 VALIDATION_FAILED` whose `fields[]` names each such field with the ADR-0114 code `invalid_value`, the same envelope the public form door gives an anonymous submission that carries a file. It names the field only. An id that names no file of the acting organization gets the same answer, so the write cannot tell the two apart. Nothing is claimed, copied or written. System writes and writes with no caller context reference files as before, and an authorization-store outage still fails the write with its declared envelope.

Clause-②: no (narrowing) — a record write that names a file its caller may not read, or an id no file of the organization has, was saved and is now refused. Nothing that was refused becomes accepted.

Metadata-protocol: none (a write-time refusal on file fields; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata author's surface moves: no spec key or authorable spelling is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which record writes the file-reference lifecycle accepts: a write naming a file its caller may not read is refused at the field. The remedy is naming a file the caller may read, or leaving the field empty, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that writes a file id it may not read, shipped as `patch` because the metadata protocol does not move.

- **Before.** The write saved, and the field kept an id its readers could not use.
- **Now.** The write is refused with `400 VALIDATION_FAILED`, naming the field with `invalid_value`.
- **Fix.** Name a file the caller may read (upload it, or choose one they can open), or leave the field empty.
