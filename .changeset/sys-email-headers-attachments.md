---
"@objectstack/platform-objects": minor
"@objectstack/plugin-email": minor
---

feat(plugin-email,platform-objects): `sys_email` carries headers and small attachments, so those messages become durably deliverable (#5177)

Durable email delivery works from the **row**, not from the in-memory message:
`send()` publishes an `{ rowId }` job (#5160), the boot sweep re-reads rows
(#5161), and both end at `rowToNormalized`. So anything a `sys_email` row could
not carry, a row-based delivery would have dropped — and custom headers and
attachments were exactly that. The honest workaround was to refuse: a message
with either was pushed back onto inline delivery so that it would at least go
out whole, which closed the durable path to precisely the mail most worth
making durable (a signed receipt, a `List-Unsubscribe` header, an invoice PDF).

`sys_email` now has two columns, and those messages are queueable.

**`headers_json`** — the custom headers, as a JSON object. Written in both
delivery modes (it is audit evidence as much as delivery input) and rebuilt on
read. Headers are no longer a reason to fall back to inline delivery.

**`attachments_json`** — attachments as a JSON array of
`{ filename, contentType?, size, hash, cid?, contentForm, inline?, storageKey? }`,
content base64 in `inline`. Written when the **combined raw size of one
message's attachments is within `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` (256 KiB,
exported from `@objectstack/plugin-email`)** — worst case ~350 KB of base64, so
a row stays bounded. Both arms of the declared `content: string | Buffer`
contract round-trip as the arm they were sent as: restoring a text attachment
as a Buffer would silently drop `charset=utf-8` from its MIME part and let the
recipient's client mis-decode a UTF-8 file, so `contentForm` records which one
it was. `cid` travels too — an inline `<img src="cid:…">` is unusable without
it.

**Over the limit, nothing changes.** The message is delivered inline exactly as
before, whole, and the row stores no attachment content; the reason is stated
at `info` (a bound, not a degradation — the worst outcome is today's
behaviour). Out-of-row storage for large attachments is #5172; `storageKey` is
declared now so that lands as a new *producer* rather than a data migration.

Rows written before these columns exist read exactly as they did. A column that
is present but does not describe what it claims — malformed JSON, a size or
hash that disagrees with the content, a missing `contentForm` — is **rejected**,
and the row lands at `failed` carrying the reason, rather than being delivered
with a part quietly missing.

The `sys_email` schema change is additive (two optional textarea columns); no
migration is required and default inline delivery is unchanged.
