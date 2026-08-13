---
"@objectstack/plugin-webhooks": patch
---

fix(plugin-webhooks): a stored header map that cannot be recovered parks the subscription instead of arming it and delivering the headers MISSING (#8558)

A webhook whose `sys_webhook.headers_secret` held a value that did not come back
as a header map was treated as **authored without custom headers**. The
subscription armed, every matching record change was delivered, and the entire
authored map — the ordinary place an `Authorization: Bearer …` goes — was
silently absent. Nothing logged, nothing dropped, and
`GET /api/v1/data/sys_webhook` kept reporting `active: true` with the header
column masked, so both the operator and the Setup UI still read "custom headers
are configured".

Measured end to end against a real engine, what reached the receiver was worse
than "a delivery with something missing": the request SUCCEEDED
(`sys_http_delivery.status = 'success'`) carrying a byte-correct
`X-Objectstack-Signature`. The signature is the receiver's proof the request is
genuinely ours, so a receiver that authenticates by signature had every reason
to accept a request that no longer matched the configuration its operator wrote.
Against an endpoint that requires the credential the result is a 401 nobody
attributes correctly; against one that does not — a routing `X-Tenant-Id`, an
`X-Environment: staging` — the delivery is simply wrong and nobody finds out.

The cause was one return value carrying two facts. `resolveWebhookHeaders`
answered `undefined` both for *"the author configured no custom headers"* —
legitimate, `headers` is optional on the envelope — and for *"a map is stored
and did not come back as one"*. Its caller acts on the first reading, so the
second became the first. This is the sibling of the signing-secret collapse
(#8542) on the same seam's other credential, and the file's own header comment
already promised the opposite: *"It does not deliver partially. A row whose
stored headers cannot be resolved DROPS the subscription."*

**This path is wider than the signing-secret one, not symmetric to it.** A
signing secret is an opaque scalar, so any non-empty answer is a usable key and
only the empty string collapsed. A header map's CONTENT decides, and
`parseStoredHeaders` answers `undefined` — correctly, for its own job — for every
string that is not a flat JSON object of string values. Four states reach the
seam, all confirmed against a real engine:

- the `sys_webhook` row is deleted between the enqueuer's cache read and the
  per-row dereference;
- the column holds something that is not a `secret:` ref — reachable only
  through a write that bypasses the engine (a column edited in SQL, a dump
  restored without its `sys_secret` rows, a seed script writing at driver level);
- the stored value decrypts to an **empty string**;
- the stored value decrypts to a perfectly readable string that is **not a flat
  string map** — `{}`, `[]`, `{"X-Count": 5}`, a nested object, or any typo.
  This is the widest road rather than an exotic one: `headers_secret` is an
  admin-authorable field whose own description instructs the author to type a
  JSON object into it, and every one of these spellings is accepted by the
  ordinary data API, encrypted like any other value, and left behind a
  perfectly valid ref that reads back as the mask.

The fix is at the seam, so no consumer has to re-derive the rule: presence is
already decidable there (`headers_secret` is a map only in the plaintext — at
the storage layer it is an ordinary scalar `secret` column, so a set map comes
back from the generic read path as the engine's mask and an unset one as `null`),
and stored headers that do not come back as a map now raise rather than
answering `undefined`. They therefore reach `AutoEnqueuer.attachHeaders` exactly
the way a throwing resolver already did — the subscription is parked, the
discarded event lands in `sys_http_delivery` with a cause (#8069), and the
operator gets the existing remedy-bearing say-once `error` carrying
`INTERNAL_ERROR` / `500` (ADR-0112) and naming `headers_secret`, so it cannot be
confused with the signing secret's identical-looking drop.

**Unchanged:** a webhook authored with no custom headers at all still arms and
delivers — that is a legitimate authored configuration, and it is pinned as the
control for this change, as is a webhook whose stored map resolves normally and
still delivers every header including the credential entry.

**What an operator sees after upgrading.** A webhook that was quietly delivering
without its headers stops delivering and starts reporting. Re-save the headers
as a flat JSON object of string values so the column holds a fresh ref, or
**clear** the field to `null` if the webhook is meant to send no custom headers
— an empty or unparseable header map is not the same thing as no header map,
and only the second one means "send nothing extra".
