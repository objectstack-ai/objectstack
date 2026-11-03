---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime)!: `POST /packages/:id/publish-drafts` refuses a change note that is not a string with `400 VALIDATION_ERROR` naming `message`, instead of publishing with the default note (#28452)

Clause-②: no (narrowing) — a body whose `message` is not a string (a number, an object, an array, `null`), which the door answered `200` with the default note, is refused `400 VALIDATION_ERROR` before anything is published. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the door now enforces the `message?: string` that PublishPackageDraftsRequestSchema already declares. Nothing was stored for the refused bodies (the note was dropped), so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the publish-drafts door (`@objectstack/runtime`).

The door parses `message` with `PublishPackageDraftsRequestSchema`'s own member. A note the declaration refuses used to be dropped silently: the publish went ahead, every history row recorded the sentence naming the package, and the caller never learnt its note was ignored. Now the request is refused, nothing is published and no history row is written, and the same drafts publish once the note is sent as a string.

Unchanged: a string note (empty too) publishes with that note; no body, or no `message`, publishes with the default note; unknown keys are still ignored, so `@objectstack/client`'s `packages.publishDrafts` still works when it sends its deprecated `opts.actor`; a malformed `backfill` is still refused once, by the protocol's own judgement, with the same answer as before.

This supersedes the sentence "Nothing changes on the wire: the door reads the body as it did before this declaration" in the pending `@objectstack/spec` changeset for `PublishPackageDraftsRequestSchema`: from this release the door refuses a non-string `message`. The `@objectstack/spec` patch is that declaration's docblock, which now says so.
