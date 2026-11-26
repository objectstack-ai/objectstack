---
'@objectstack/spec': minor
---

feat(spec): `PublishMetaItemRequestSchema` declares `draftVersion`, the per-item publish's pin on the draft it promotes

Clause-②: yes (widening)
Metadata-protocol: added

`PublishMetaItemRequestSchema` (the request of `POST /api/v1/meta/:type/:name/publish`) gains one optional member, `draftVersion`: the version token of the pending draft the caller wrote or read and means to publish (a draft save's receipt `version`, or the strict draft read's `version`). On the REST door it is the `draftVersion` member of the publish body, beside `message`. A token that is not the current draft row's is refused `409 METADATA_CONFLICT`, whose `currentVersion` names the draft's current token (`null` when no draft is pending), and nothing is promoted. Absent, the publish promotes whichever draft is pending, as before.

`parentVersion` (`If-Match` on the REST door) keeps its meaning: it pins the active row the promotion replaces. The two judge different rows and may be sent together.

Nothing to migrate: a caller that does not send the member is unaffected.
