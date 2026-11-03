---
'@objectstack/runtime': patch
---

fix(runtime)!: `POST /packages/:id/publish-drafts` refuses a body that is not a JSON object (an array, a string, a number, a boolean) with `400 VALIDATION_ERROR`, instead of publishing with the default note (#28541)

Clause-②: no (narrowing) — a present body that is not a JSON object, which the door answered `200` with the default note, is refused `400 VALIDATION_ERROR` before anything is published. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the door now enforces the object body that PublishPackageDraftsRequestSchema already declares. Nothing was stored for the refused bodies (they carry no note or backfill), so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the publish-drafts door (`@objectstack/runtime`).

A body with no members to read used to publish every pending draft with the sentence naming the package as the note, and the caller never learnt its body was ignored. The door now refuses it with `PublishPackageDraftsRequestSchema`'s own whole-body issue (`(body): Invalid input: expected object, received array`), in the same envelope as the non-string `message` refusal: nothing is published and no history row is written.

Unchanged: no body (an absent or empty body, or JSON `null`) still publishes with the default note; an object body answers exactly as before, so a string note publishes with it, a non-string `message` keeps its refusal, unknown keys such as the SDK's deprecated `actor` are still ignored, and a malformed `backfill` is still refused once, by the protocol, with the same answer.

This narrows the sentence "no body, or no `message`, publishes with the default note" in the pending `28452-publish-drafts-message-refused` changeset: a body that is present but not an object is refused from this release.
