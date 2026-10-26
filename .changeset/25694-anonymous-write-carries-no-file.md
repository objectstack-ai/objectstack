---
'@objectstack/service-storage': patch
---

fix(storage)!: an anonymous write carries no file

Ruling C ("an anonymous submission carries no file") now holds at every anonymous write door of ADR-0138 D2, not only at the public form door. A record write whose caller has no user, such as the guest an `authRequired: false` endpoint executes as under the grants a deployment binds to the guest, may not put a value in a file field (`file`, `image`, `avatar`, `video`, `audio`). It is refused before anything is written, with the form door's envelope: `400 VALIDATION_FAILED`, one `fields[]` entry per refused field carrying the ADR-0114 field code `invalid_value` and the field's label. An empty or absent file field is written as before. Signed-in callers, system writes and context-less programmatic writes are unchanged. No error code is added.

Clause-②: no (narrowing) — an anonymous write that carried a value in a file field is refused. Nothing that was refused becomes accepted.

Metadata-protocol: none (a write path's file rule; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which record writes the file-reference path accepts (an anonymous caller's write carrying a file value is refused). The remedy is a change of who provides the file (a signed-in caller), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for an anonymous write that carried a file value, shipped as `patch` because the metadata protocol does not move.

- **Before.** Only the public form door refused a file value from an anonymous caller.
- **Now.** Every write whose caller has no user is refused with `400 VALIDATION_FAILED` when a file field carries a value.
- **Fix.** Leave file fields empty in an anonymous write. A file is provided by a signed-in caller, through the authenticated upload doors.
