---
"@objectstack/objectql": patch
---

fix(objectql): the credential write door refuses `""` — a secret/password field can no longer be set to an empty credential that every read reports as present (#8559)

`ObjectQL.encryptSecretFields` treated the empty string as an ordinary value: it
encrypted `""`, minted a real `sys_secret` row whose ciphertext decrypts to
nothing, and rewrote the business column to a perfectly valid `secret:` ref.
From that moment every read surface reported "a secret is set" (the field masks
as `••••••••`) while `resolveSecretField` returned `""` — the contradictory
state the webhook seam (#8542) and its siblings had to defend consumers
against. A `password`-typed field stored `""` verbatim, producing the same
contradiction without the cipher row.

**Both arms now refuse `""` at the write door** (maintainer ruling on #8559,
option 2 — loud refusal over silent reinterpretation):

- `secret` fields refuse in `encryptSecretFields`, before any crypto side
  effect — no cipher row is minted, no CryptoProvider is consulted.
- `password` fields refuse at their own write seam
  (`refuseEmptyPasswordFields`), guarding the same doors (single/bulk insert,
  single-id update, multi update) without routing plaintext-at-rest fields
  through the encryption path. `managedBy: 'better-auth'` objects are exempt,
  mirroring the read mask's scope — their credential writes belong to the auth
  subsystem.

The refusal is a located ADR-0112 envelope: `EmptyCredentialWriteError` with
`code: 'VALIDATION_ERROR'`, `status: 400`, and a message naming the field
(`object.field`) and the correct spellings — **write `null` to clear the stored
credential; omit the field to leave it unchanged**. The class and its
`EMPTY_CREDENTIAL_REFUSAL_CODE` / `EMPTY_CREDENTIAL_REFUSAL_STATUS` pair are
exported from `@objectstack/objectql`, as is `collectMaskedPasswordFields`, so
consumers branch on `code`/`status` rather than message text. On the per-row
outcome path (`insertMany`), the refusal is reported per row and surviving rows
land normally.

Everything else at the door is pinned unchanged: echoing the read mask back
still means "unchanged" (the key is dropped), cleartext still re-encrypts into
a fresh ref, and `null` still clears — after which reads truthfully report "not
set". Rows that already hold an empty credential are untouched: this closes the
door, it does not migrate history, and the consumer-side defenses (#8542,
#8558) remain load-bearing for those.

If a client meant "clear this credential" and sent `""` (the natural form-
control spelling), send `null` instead — the refusal message says exactly that.
