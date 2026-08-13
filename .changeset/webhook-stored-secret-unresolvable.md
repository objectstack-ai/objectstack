---
"@objectstack/plugin-webhooks": patch
---

fix(plugin-webhooks): a stored signing secret that cannot be recovered parks the subscription instead of arming it and delivering UNSIGNED (#8542)

A webhook whose `sys_webhook.signing_secret` held a value that did not resolve
was treated as **authored unsigned**. The subscription armed, every matching
record change was delivered, and the HMAC signature — the receiver's only proof
the delivery came from us — was silently absent. Nothing logged, nothing
dropped, and `GET /api/v1/data/sys_webhook` kept reporting `active: true` with
the secret column masked, so both the operator and the Setup UI still read
"this webhook is signed".

The cause was one return value carrying two facts. `resolveWebhookSecret`
answered `undefined` both for *"the author configured this webhook unsigned"* —
legitimate, `secret` is optional on the envelope — and for *"a key is stored and
nothing came back"*. Its caller acts on the first reading, so the second became
the first. That is the #7799 signing invariant failing **open**, immediately
beside two adjacent failure modes that fail closed and loudly: a resolver that
throws, and an engine with no encrypted-field channel, both of which drop the
subscription and report at `error`.

Three states reach the silent path, all confirmed against a real engine:

- the `sys_webhook` row is deleted between the dispatcher's cache read and the
  per-row dereference;
- the column holds something that is not a `secret:` ref — reachable only
  through a write that bypasses the engine (a column edited in SQL, a dump
  restored without its `sys_secret` rows, a seed script writing at driver
  level). The engine's own write path defends the two obvious routes: an echoed
  read-mask is dropped and cleartext is re-encrypted;
- the stored value decrypts to an **empty string** — reachable through the
  ordinary data API, which accepts `signing_secret: ""`, encrypts it like any
  other value, and leaves the column holding a perfectly valid ref.

The fix is at the seam, so no consumer has to re-derive the rule: presence is
already decidable there (a set secret comes back from the generic read path as
the engine's mask, an unset one as `null`), and a stored key that does not
resolve now raises rather than answering `undefined`. It therefore reaches
`AutoEnqueuer.attachSecret` exactly the way a throwing resolver already did —
the subscription is parked, the discarded event lands in `sys_http_delivery`
with a cause (#8069), and the operator gets the existing remedy-bearing
say-once `error` carrying `INTERNAL_ERROR` / `500` (ADR-0112).

**Unchanged:** a webhook authored with no secret at all still arms and delivers
unsigned — that is a legitimate authored configuration, and it is pinned as the
control for this change. The redelivery guard (#8069) keeps its behaviour in
both directions: a stored-but-unresolvable key is still refused with its own
reason, and any other failure still propagates, because "we could not check"
must never read as "allowed".

**What an operator sees after upgrading.** A webhook that was quietly delivering
unsigned stops delivering and starts reporting. If the deliveries were meant to
be signed, re-save the secret so the column holds a fresh ref. If the webhook
was meant to be unsigned, **clear** the field to `null` — an empty secret is not
the same thing as no secret, and only the second one means "unsigned".
