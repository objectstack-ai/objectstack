---
"@objectstack/plugin-webhooks": patch
---

fix(plugin-webhooks): webhook custom `headers` are encrypted at rest instead of riding `definition_json` in cleartext (#7986)

`#7799` moved the webhook **signing secret** out of `sys_webhook.definition_json`
into an encrypted `signing_secret` column. It did not move the custom **headers**
map — and `headers` is the ordinary place an `Authorization: Bearer …` goes.

`sys_webhook` declares **no `enable` block at all**, so it keeps the full default
data API: an ordinary `GET /api/v1/data/sys_webhook` handed the whole header map,
credentials included, to every persona that can read the object. Unlike the
delivery table's copies, nothing ages this out — the configuration row is
retained for the life of the webhook.

This is a **scope-of-the-original-fix** finding, not a regression: the exposure
predates `#7799` and nothing that card did made it worse. What was wrong was the
conclusion a reader would reasonably draw from it — that webhook credentials are
no longer in a blob.

**What changed.** The authored `headers` map now lands in a new
`sys_webhook.headers_secret` column on the engine's encrypted credential channel,
exactly as `signing_secret` does: the engine encrypts it into `sys_secret`, the
row keeps only an opaque `secret:<id>` ref, and every read path returns a mask.
`definition_json` carries the same envelope minus both credential passengers. The
auto-enqueuer recovers the map server-side through `engine.resolveSecretField()`
on the **same** cache refresh that recovers the signing key, and the existing
boot sweep (`migrateLegacyWebhookSecrets`) now moves already-persisted cleartext
headers out of the blob in the same single, idempotent update it uses for the
key.

**Nothing about authoring changes.** Authors still write
`headers: { … }` on `defineWebhook()`, `webhook.zod.ts` is untouched, and every
authored header is still delivered on the wire byte-for-byte.

**The whole map moves, not just the credential-looking entries.** Only some
entries are credentials and the platform cannot tell which. Guessing from the
header name (`authorization`, `x-api-key`, …) is fail-**open** on exactly the
custom spellings — `X-Acme-Token` — most likely to be one, and a heuristic that
silently passes the header that mattered is worse than none because it reads as
coverage. Letting the author declare which are sensitive is a change to the
authoring envelope and belongs to the spec surface. The cost this shape is
accused of is measured and small: `definition_json` is a raw JSON textarea
pending a real builder, so what an admin loses is the ability to read back a
`Content-Type` they typed.

**Fail-closed, and symmetric with `#7799`.** With no CryptoProvider the engine
refuses the write rather than storing cleartext; a stored map that cannot be
decrypted **drops** the subscription rather than delivering it with its headers
silently missing. That drop is deliberately the same trade the signing secret
makes: against an endpoint that does not require the header, a delivery missing
its `Authorization` **succeeds** while quietly deviating from the configuration
the author wrote, and nothing records that it went out incomplete. Subscriptions
dropped this way re-arm on CryptoProvider registration exactly as `#8022` made
them — the header map is resolved on the same rebuilt cache as the key, so a
re-arm can never produce a correctly-signed delivery with no headers on it.

**This does not close the exposure end to end.** The same headers are still
written in cleartext to `sys_http_delivery.headers_json` at enqueue time, and
that table is readable over the data API (`apiMethods: ['get','list']`, 30-day
retention). Measured after this change: the credential is still recoverable
there. Closing that half needs a decision outside this package and is tracked on
#7986; `sys_email.headers_json` (the same shape, on the email delivery row) is
untouched here for the same reason.
