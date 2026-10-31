---
'@objectstack/spec': minor
---

feat(spec): the body of `POST /packages/:id/publish-drafts` is declared, so the change note a publish carries is part of the published API contract

Clause-②: yes (widening)
Metadata-protocol: added

`@objectstack/spec/api` gains `PublishPackageDraftsRequestSchema` and its type `PublishPackageDraftsRequest`, beside the door's existing `PublishPackageDraftsResponseSchema`. It declares the two body members the door reads:

- **`message`** (optional string): the author's change note. The package commit records it, and so does every item history row the publish writes (`change_note`, read back as each history event's `message`). Absent or empty, those rows record the sentence naming the package.
- **`backfill`** (optional array of `{ object, field }`, both non-empty strings, nothing else in an entry): fields the publish adds whose literal `defaultValue` is written into existing rows, as the signed-in caller. A malformed, repeated or unhonourable entry refuses the whole request `400 VALIDATION_ERROR` before anything is published.

The object is not strict: other members are stripped, not refused. `actor` is deliberately not declared, since the door records the authenticated caller; `@objectstack/client`'s `packages.publishDrafts` still sends its deprecated `opts.actor`, and that call keeps working unchanged. Nothing changes on the wire: the door reads the body as it did before this declaration.
