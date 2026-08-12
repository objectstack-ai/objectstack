---
"@objectstack/plugin-webhooks": patch
"@objectstack/objectql": patch
---

fix(webhooks): the subscriber's HMAC signing secret is no longer readable from `sys_webhook` over the data API (#7799)

`bootstrapDeclaredWebhooks` persisted the whole validated `Webhook` envelope —
**`secret` included** — as `definition_json: JSON.stringify(wh)`, and
`AutoEnqueuer.parseRow` read `defn.secret` straight back out to sign deliveries.
`definition_json` is an ordinary textarea on an admin-authorable object with no
restrictive `enable.apiMethods`, so a plain `GET /api/v1/data/sys_webhook`
returned the key to **every persona that can read the object**. That key is the
receiver's only proof that a delivery came from us.

This is the remaining half of #7722, which removed the same secret's per-attempt
copies from `sys_http_delivery`. Unlike the delivery table, no retention window
ever aged these out.

**What changed.** The authored key now lands in `sys_webhook.signing_secret`, a
new `type: 'secret'` column: the engine encrypts it into `sys_secret` on write,
keeps only an opaque `secret:<id>` ref on the row, and returns a mask on every
read path. `definition_json` carries the same envelope **minus** `secret`. The
auto-enqueuer recovers the plaintext server-side when it refreshes its
subscription cache.

**Nothing about authoring changes.** `packages/spec/src/automation/webhook.zod.ts`
is untouched — `defineWebhook({ secret })` is written exactly as before, and the
delivered `X-Objectstack-Signature` is byte-identical, so no receiver has to
change anything.

**Existing rows are migrated.** A boot sweep moves any cleartext
`definition_json.secret` into the encrypted column — including the rows the
seeder deliberately never rewrites (`managed_by: 'admin'`, and package rows an
admin froze with `customized: true`), which are the ones most likely to hold a
real production key. The sweep is idempotent and stores the encrypted copy in
the same update that strips the blob, so a failure can never leave a webhook
stripped *and* unsigned. Until a row is swept, signing keeps working from the
legacy blob and the enqueuer warns that the value is still exposed.

**Fail-closed.** With no `ICryptoProvider` wired the engine refuses the write
rather than storing cleartext, so a secret-bearing webhook is skipped — and a
legacy row is left intact — with an actionable log line carrying an ADR-0112
`code`/`status` pair. It is never seeded with an exposed key in a new column.

Also adds `ObjectQL.resolveSecretField(object, recordId, field)` — the privileged,
driver-level dereference of one row's `secret`-typed field. `resolveSecret()` was
already documented for "privileged consumers … against the stored ref", but the
read mask meant no consumer could obtain that ref; this is why the webhook key
can live in the encrypted channel at all. It refuses any field not declared
`type: 'secret'`, so it cannot become a mask bypass over a `password` field
(plaintext at rest by design — ADR-0100).
