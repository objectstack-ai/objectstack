---
"@objectstack/plugin-webhooks": patch
---

fix(webhooks): refuse a malformed `sys_webhook.headers_secret` at the write door instead of at the next delivery (#8566)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
renamed, retired or tombstoned. This adds a runtime validation hook on one
plugin-owned object's existing column; the authoring envelope
(`webhook.zod.ts`), the field declaration and every stored shape are untouched.
The accept-set narrows, but only over values that were already unusable at
delivery time (see below), so there is no configuration for a migration to
prescribe a rewrite of. -->

`sys_webhook.headers_secret` is a `Field.secret()` whose plaintext is **not** an
opaque blob: it is a serialized header map with a required shape — a flat JSON
object of string values — and `parseStoredHeaders` is its only reader. Nothing
validated that shape on the way in. The ordinary data API accepted any string,
encrypted it like any other secret, minted a real `sys_secret` row, and left the
column holding a perfectly valid `secret:` ref that read back as the mask with
`active: true`.

Measured on a real engine through `engine.update()` — the ordinary data API, no
privileged access — every one of these was **accepted** and is a value the
plugin can never use: `{}`, `[]`, `{"X-Count": 5}`, a nested object, and
`{X-Team: crm}` (a typo). The field is directly admin-authorable and its own
description instructs the author to type a JSON object into it, which makes a
typo the *expected* failure rather than an exotic one.

**This is not an exposure fix and must not be read as one.** #8558/#8565 already
closed the consumer half: a webhook whose stored header map does not come back
as a flat string map parks the subscription and reports at `error`, rather than
delivering header-less with a valid signature. Nothing leaks, and nothing is
silently lost today. What this changes is **when the author finds out** — at the
write door where they typed it, instead of at the next matching record change,
an unbounded time later and in a different surface.

**What is refused:** a `headers_secret` plaintext that does not parse back as a
flat JSON object of string values with at least one entry, with a located
ADR-0112 `VALIDATION_ERROR` / 400 naming `sys_webhook.headers_secret`, quoting
the shape the field's own description asks for, and diagnosing the specific
spelling (invalid JSON / an array / an empty object / which key's value is not a
string). ⛔ The message never echoes the rejected value — this column carries
credentials, and quoting the input would print an `Authorization: Bearer …` into
logs and error bodies, re-opening in the diagnostic exactly the exposure #7986
moved this field onto the encrypted channel to close. It names header *keys* and
value *types* only.

**What stays accepted, byte for byte:** every valid flat string map (as JSON
text, or as an authored object the engine serializes into the same form); `null`
to clear; an omitted key to leave the stored value unchanged; and an **echoed
read-mask**, so the ordinary Setup-form round-trip (GET a row, edit an unrelated
field, PATCH it back) is untouched. `""` is deliberately passed through to
#8559's `EmptyCredentialWriteError` rather than re-refused here — one door, one
owner, one message.

**Where it runs, and why that is the whole mechanism:** a `beforeInsert` /
`beforeUpdate` hook on `sys_webhook`, bound by `WebhookOutboxPlugin` before its
first seeded write. It has to run *before* the engine's `encryptSecretFields` —
one step later the plaintext is gone and the column holds an opaque ref, so a
validator behind it would have nothing left to validate. The suite measures that
ordering rather than asserting it: every refusal pins that **no `sys_secret`
cipher row was minted**, which is only true if the gate ran first.

A hook rather than checks on the plugin's own write paths
(`bootstrapDeclaredWebhooks` / `headersPatch` / the migration sweep), because a
direct `PATCH /api/v1/data/sys_webhook` goes through none of them and that is
the measured trigger. Those paths inherit the validation through the hook and
deliberately carry no second check.

A general `secret`-channel plaintext validator — letting any `secret`-typed
field declare its own plaintext shape — is the principled generalization and is
recorded as the **promotion path**, not built here: it becomes the shape the
moment a second shaped-plaintext `secret` field exists (maintainer ruling
2026-08-13; one consumer does not justify a general capability).
