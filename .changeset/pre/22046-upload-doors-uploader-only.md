---
'@objectstack/service-storage': minor
---

fix(service-storage)!: the upload commit, chunked-completion and progress doors act only for the user who started the upload

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime authorization narrowing at three storage upload doors, not a metadata change: no spec key, export, option, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers those doors act for: a caller who is not the file's uploader is now refused, while the uploader is answered as before. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these doors and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`POST /api/v1/storage/upload/complete`, `POST /api/v1/storage/upload/chunked/:uploadId/complete` and `GET /api/v1/storage/upload/chunked/:uploadId/progress` now act only for the user who started the upload. The rule is declared once and each of the three doors consults it: the signed-in user must be the file's `owner_id`, which both upload-start doors already stamp from the session. A chunked upload reaches its uploader through its file.

- **Refused now:** every other caller, with `403 PERMISSION_DENIED`. The answer is the same whichever organization the caller acts in, and it comes before anything is written or returned. There is no administrator exception. A file with no recorded uploader, or a chunked upload whose file is gone, is refused the same way rather than given a guessed owner.
- **Unchanged:** the uploader's own calls, who may start an upload, who may download a file (the download doors' own authorization), the organization the doors stamp and scope by, and the not-found answers. A deployment with no `auth` service, whose upload routes run without a session resolver, keeps them open as before.

What changes for you: complete and poll an upload as the same signed-in user who started it. An upload left pending with no recorded uploader cannot be committed; start it again.
