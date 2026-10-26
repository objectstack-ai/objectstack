---
'@objectstack/service-storage': patch
---

fix(storage)!: a file its record lets go keeps that record's read rule

ADR-0104 D3 promises one file, one owning record and one access rule. That rule now holds after the owning record lets the file go: until a writer who may read that record claims the file again, or the platform collects it, the file is read by that record's rule. The download door and the record-write claim path ask the same verdict, so both follow it. A file no record has owned is read as before, within its organization. The uploader still reads their own file.

`sys_file` gains two nullable fields, `released_ref_object` and `released_ref_id`, naming the record that last owned the file. The platform writes them when a record lets a file go and clears them when a record claims it. Existing rows hold NULL and are read as before.

Clause-②: no (narrowing) — a file read that a record's rule refuses is now refused after the record lets the file go. Nothing that was refused becomes accepted.

Metadata-protocol: none (a file read rule and two platform-managed bookkeeping fields; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata author's surface moves: no spec key or authorable spelling is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. The platform object `sys_file` gains two nullable bookkeeping fields that only the platform writes; schema sync adds the columns and existing rows read NULL, which is the shape every row had before. What changes is which callers a file read admits after the file's owning record lets it go. The remedy is reading the file as a reader of that record, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a reader the owning record's rule refuses, shipped as `patch` because the metadata protocol does not move.

- **Before.** The owning record's rule did not hold for the file once the record let it go.
- **Now.** It is read by the rule of the record that let it go, until it is claimed again or collected.
- **Fix.** Read or claim such a file as a reader of that record.
