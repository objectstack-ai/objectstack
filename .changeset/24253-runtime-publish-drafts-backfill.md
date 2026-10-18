---
"@objectstack/runtime": minor
---

feat(runtime): `POST /packages/:id/publish-drafts` accepts a `backfill` body key and passes it to the protocol with the caller's execution context

Clause-②: yes (widening)

- The body's `backfill` (`[{ object, field }]`) reaches `publishPackageDrafts` as sent, together with the request's own execution context, so the backfill writes run as the signed-in caller, never as the system. A body without the key sends neither.
- The protocol's request refusal answers `400 VALIDATION_ERROR` with its `issues[]`, before anything is published, flipped or announced. The `backfillApplied` receipt rides the `200` body.
