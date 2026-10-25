---
'@objectstack/rest': patch
'@objectstack/service-storage': patch
---

fix(rest)!: an anonymous public-form submission carries no file

`POST /api/v1/forms/:slug/submit` (and its environment-scoped twin) now refuses a submission that carries a value in a field whose declared type is a file type (`file`, `image`, `avatar`, `video` or `audio`, the spec's `FILE_REFERENCE_TYPES`). The refusal comes before anything is written. It is the door's existing envelope, `400 VALIDATION_FAILED`, with one `fields[]` entry per file field, coded `invalid_value` (the ADR-0114 field catalog) and naming the field by its label. A missing `required` field in the same submission is reported in the same envelope. An empty or absent file field submits exactly as before. Only the fields the form declares are judged, so the refusal names nothing the form does not already publish.

This is the server half of the rule "an anonymous public-form submission carries no file". A visitor who needs to provide a file registers and signs in, then submits through a signed-in surface that uploads through the authenticated upload doors. The anonymous door has no upload door of its own, and none is added. The protocol half, refusing at publish a guest-facing form that declares a file field, is separate. This door also judges forms published before that refusal exists.

`@objectstack/service-storage`: the file-reference claim path now looks a referenced file up within the organization the write acts in. It uses the same channel that already stamps a copied file for that organization, so the driver's tenant scope for the posture in force decides what the lookup sees. A referenced file id outside that scope is kept as written and is neither claimed nor copied, exactly as an id the platform does not manage. A write that carries no organization, and the `single` posture, look files up as before.

Clause-②: no (narrowing) — the anonymous public-form submit door refuses a request shape it used to accept (a value in a declared file field), and the file-reference claim path reaches only files within the writing organization's tenant scope. Nothing is widened.

Metadata-protocol: none (a request's handling at an anonymous door and a write path's file bookkeeping; nothing a metadata author writes changes. The publish-time refusal of a guest-facing form with a file field is the protocol half, and ships separately)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is how the anonymous public-form submit door handles a request body (a value in a declared file field is refused) and which files the file-reference claim path can reach for a write (those within the writing organization's tenant scope). The remedy is a change of how a visitor submits (register and sign in to provide a file), never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a public form that collected files anonymously, shipped as `patch` because the metadata protocol does not move.

- **Before.** A value in a file field the form declares was written with the anonymous submission.
- **Now.** That submission is refused with `400 VALIDATION_FAILED`, naming each file field that carries a value. A submission that leaves every file field empty is accepted as before.
- **Fix.** A public form that collected files: have the submitter register and sign in, then provide the file from their account. Remove the file field from the guest-facing form, or leave it for the visitor to leave empty.
