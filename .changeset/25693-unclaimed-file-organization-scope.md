---
'@objectstack/service-storage': patch
---

fix(storage)!: an unclaimed file is served only within its organization

The two download doors (`GET /api/v1/storage/files/:fileId/url` and `GET /api/v1/storage/files/:fileId`) now serve a file with neither an attachments scope nor a field owner (an upload no record has claimed yet, or one whose record let it go) only within its organization. The signed-in check comes first, as before. The download authorizer then judges the file as every other organization-scoped row is read: the organization wall's verdict for the tenancy posture in force, and the driver's tenant scope for the reach. A caller outside that reach is refused `403 FILE_DOWNLOAD_DENIED`, the status and code the doors already give a file the caller may not read, with a message that names no record. No error code is added.

What does not change: the uploader is still served their own upload, as for every other private file. Under the `single` posture every signed-in caller is served as before. A file marked `acl: 'public_read'` stays anonymous. Attachments-scope and field-owned files keep their parent-derived verdicts. An anonymous caller still gets `401 AUTH_REQUIRED`. A kernel with no auth service still serves these files without a check.

Clause-②: no (narrowing) — the download doors serve an unclaimed file to fewer callers under a walled posture (`isolated`, `group`); nothing is widened.

Metadata-protocol: none (how two storage download doors authorize a request; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is which callers the storage download doors serve an unclaimed file to under a walled tenancy posture. The remedy is operational (act in the file's organization, or have a record claim the file, or mark it `acl: 'public_read'`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a walled deployment (`isolated` or `group` posture) whose users download unclaimed files from outside the file's organization, shipped as `patch` because the metadata protocol does not move.

- **Before.** The download doors did not apply the organization wall to an unclaimed file.
- **Now.** A signed-in caller is served an unclaimed file when they uploaded it, or when the file is in their organization's reach under the posture in force (their active organization under `isolated`, any organization they belong to under `group`). Anyone else gets `403 FILE_DOWNLOAD_DENIED`. A caller with no organization under a walled posture is in no organization's reach.
- **Fix.** Download the file while acting in its organization. Have a record claim it (a file field or an attachment), so that the record's access decides. Or, for a file that must be readable by everyone, mark its stored file record `acl: 'public_read'`.
