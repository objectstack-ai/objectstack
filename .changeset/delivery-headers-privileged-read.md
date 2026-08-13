---
'@objectstack/objectql': minor
'@objectstack/service-messaging': patch
---

Stop serving webhook/flow callout credentials through the generic data-API read of `sys_http_delivery` (#8118).

**What this closes.** `sys_http_delivery.headers_json` — the authored request-header map, the ordinary place an `Authorization: Bearer …` goes — was readable by every caller the data API admits (list, get, an explicit `?select=headers_json`). The column is now declared `internal: true`, so the engine omits it from every generic read with no system carve-out (#7728). The redaction sits at the row layer, so it covers the whole delivery population: `source: 'webhook'` rows (WebhookSchema-authored headers) and `source: 'flow'` rows (per-run interpolated headers that never pass through WebhookSchema at all). Deliveries are unaffected on the wire: the dispatcher's claim path recovers the map through the engine's privileged accessor and still sends every authored header verbatim — fail-closed, a delivery never goes out missing a header, and one that cannot recover its headers refuses loudly instead of going out incomplete. `IHttpOutbox.list()` and `redeliver()` now return the redacted view (`headers: undefined`) under a redacting engine; `claim()` results carry the map verbatim.

**New public API.** `ObjectQL.resolveInternalField(object, recordIds, field)` — the purpose-built privileged accessor #7728 itself named as the remedy for a legitimate system reader of an `internal: true` field: a batch, driver-level read of one flagged field, refusing (ADR-0112 `INVALID_FIELD`, status 400) any field not so declared. The sibling of `resolveSecretField`, batch-shaped because its consumer claims a batch per dispatcher tick.

**What this deliberately does NOT close.**

- The delivery row still holds the header map in cleartext at rest until the 30d telemetry retention ages it out. Encrypting it (`Field.secret()`) was measured and rejected on #8118: one orphan `sys_secret` row per delivery with no cascade or retention, a boot-window fail-open on the fire-and-forget enqueue, and a per-row decrypt on every dispatcher tick.
- `sys_email.headers_json` (#7986 ①-f) has the same shape; it follows this card's decision but is not part of this change.
