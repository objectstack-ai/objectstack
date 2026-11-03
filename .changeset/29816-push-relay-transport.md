---
'@objectstack/spec': minor
---

feat(spec): the push channel's hosted relay transport — `PushServiceConfigSchema` becomes `transport: 'relay' | 'direct'`, with the relay as the default, and the server-to-relay wire shape is declared (`api/push-relay.zod.ts`)

Clause-②: yes (widening)
Metadata-protocol: added

Nothing here is read or served yet: every new or touched schema keeps or carries a `[PLANNED — not yet read]` or `[PLANNED — not yet served]` marker, and no stack key, route or reader is added. Every push configuration that parsed before still parses.

- **`PushServiceConfigSchema`** is now a discriminated union on `transport`, built from two strict blocks:
  - `PushRelayTransportConfigSchema`, `{ transport: 'relay', endpoint? }`, the default. The hosted relay holds the APNs and FCM credentials of the store-published app and authenticates the server by its cloud binding credential, so the block carries no credential. `endpoint` is an https URL for a staging relay; absent means the production relay. A vendor block or a credential key (`credentialRef`, `token`, `apiKey`, …) written into a relay block is refused by name, pointing at `transport: 'direct'`.
  - `PushDirectTransportConfigSchema`, `{ transport: 'direct', apns?, fcm? }`: the shape this schema had, for a white-label build signed with the operator's own credentials. It needs at least one vendor block, so a direct block with no `credentialRef` is refused; `endpoint` on it is refused, pointing at the relay.
  - A block without `transport` keeps parsing: `{}` reads as the relay, and a block with an `apns` or `fcm` block reads as direct, exactly the configuration it described before. Parsing fills `transport` in, so `PushServiceConfigParsed`, `PushRelayTransportConfigParsed` and `PushDirectTransportConfigParsed` are declared beside the author types.
- **`PushRelayRequestSchema`** (new) is what a server POSTs to the relay: `{ deliveries: [{ token, vendor, payload, priority }] }`, at least one delivery, with the binding credential as the request's bearer and none in the body. `payload` (`PushRelayPayloadSchema`) is ID-only: `data` is the push delivery data (`PushDeliveryDataSchema`) and `text` is one generic visible line; `title`, `body`, `subtitle`, `message` and `content` are refused by name. `priority` is `high` or `normal` (`PushRelayPrioritySchema`).
- **`PushRelayResponseSchema`** (new) answers one result per delivery, in request order: `{ token, status }` with `status` `ok`, `invalid` (the vendor reports the token dead; stop delivering to it) or `retry` (transient; send again later).
- **`PushRelayErrorResponseSchema`** (new) is the house `ErrorResponseSchema` envelope around `PushRelayErrorSchema`, a union on `code` of the house `EnhancedApiErrorSchema`: `UNAUTHENTICATED` (401, with `details.reason` `binding_invalid` or `binding_revoked`), `RATE_LIMIT_EXCEEDED` (429, with `retryAfterSeconds`) and `QUOTA_EXCEEDED` (429). Each requires `helpText`, the next step. No new error code is added.
