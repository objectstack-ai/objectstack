---
'@objectstack/service-messaging': patch
---

fix(service-messaging)!: the in-app message door counts only the people a delivery was accepted for, and a send that reached nobody is refused instead of answering success

Clause-②: no (narrowing) — `POST /api/v1/messaging/in-app-messages` answered `200` when `emit()` accepted no delivery at all; it now answers `503 SERVICE_UNAVAILABLE` or `409 RESOURCE_CONFLICT` there. A picked recipient id longer than 255 characters, which no member can carry, is refused `400 VALIDATION_ERROR` where it was read. No export, route or body key is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answers are runtime outcomes of one HTTP door, so nothing is stored for a migration to rewrite and nothing needs a tombstone. -->

**BREAKING** for a caller that read a `200` from `POST /api/v1/messaging/in-app-messages` as "sent" when no one received the message. The success answer keeps its shape, `{ notificationId, recipients, delivered, enqueued, failed }`, and now means at least one person:

- `recipients` counts a person only when a delivery to them was accepted (delivered, or handed to the outbox). A recipient whose every delivery failed is counted in `failed`, not in `recipients`. Before, it counted every recipient a delivery was attempted for, failed ones included, so the Setup action's "Message sent. Recipients: N" could count people who got nothing.
- When no delivery was accepted, the door no longer answers `200` with `recipients: 0`, which the Setup action showed as "Message sent". The notification event is still written as the record of the attempt; no inbox row is. The answer is:
  - `503 SERVICE_UNAVAILABLE` when every delivery attempted failed (for example, no inbox channel is registered on the server, or the outbox write failed). The delivery errors go to the server log, not into the response.
  - `503 SERVICE_UNAVAILABLE` naming the reason when the inbox channel answers that it is unavailable in the organization.
  - `503 SERVICE_UNAVAILABLE` for a message to everyone that reached nobody: either the organization's members could not be read, or every member has turned the `org.announcement` topic off. The send result cannot tell these apart, so the door gives the answer a failure needs.
  - `409 RESOURCE_CONFLICT` for picked recipients who have all turned the `org.announcement` topic off. Their membership is checked first, so for picked recipients nothing else can explain an empty send.
- A picked recipient id longer than 255 characters is refused `400 VALIDATION_ERROR` by its position in `recipients`, and the id is not repeated in the refusal. Before, such an id was read and refused as a non-member, with the whole id repeated in the message. `sys_member.user_id` stores at most 255 characters, so such an id can never name a member.

Unchanged: who may send, the body's closed key set and its other bounds, the `everyone` and picked-recipient rules, and every refusal answered before the send. The door still has no send rate. The ruling that opened it asked for none, each request is bounded (request-body limit, at most 1000 picked recipients, title, body, link and per-id lengths, and a sender holding `setup.write` in the organization they message), and how often an administrator may message their organization is a product decision for later.

What to do: a program or agent that sends through this door should handle `503` and `409` as "nobody received it". A `503` can be retried. A `409` means the picked recipients have turned these messages off, so pick other recipients. The Setup action needs no change: it shows the refusal's message instead of "Message sent".
