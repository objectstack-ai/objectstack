---
'@objectstack/cli': minor
'@objectstack/service-settings': minor
---

feat(cli): `os secret rewrap` re-wraps version-1 `sys_secret` ciphertext under the current AAD derivation, each row under its holder's producer scope (ADR-0128 §4.2, #21326 stage 2)

Clause-②: yes (widening)

A ciphertext sealed before ADR-0128 D1–D3 carries the older binding over
`(namespace, key)` alone, and still opens in this release. `os secret rewrap` moves
the stored values to the current binding through `rotateKey`, the seam ADR-0128 §4
names. It is an operator command: a dry run by default, `--apply` to write, and
nothing on any boot or upgrade path invokes it. It has no HTTP surface.

- **The scope comes from the holder.** `sys_secret` records no producer, and a
  version-1 ciphertext binds no scope, so each row is re-sealed under the scope of
  the producer whose holder references it: `settings` for a `sys_setting.value_enc`
  handle, `object_secret_field` for a `secret:` ref on a business row,
  `datasource_credential` for a `sys_secret:` `credentialsRef`. The holders come from
  the same cross-producer reference union `os secret orphans` reads. A row nothing
  references, a row whose holders belong to different producers, and every row while
  a holder family could not be read are left as they are and counted, never re-sealed
  under a guessed scope. `--apply` refuses an incomplete union and names the family.
- **Resumable.** A row already sealed under the current derivation is skipped as
  done, so a stopped run finishes the rest when re-run and a finished run writes
  nothing.
- **Safe against a live deployment.** Each row is written by one conditional update,
  keyed on its id and the ciphertext the run read. A row a producer changed in
  between is not overwritten, and a re-run picks it up. A driver with no
  `updateMany` is refused before any row is opened.
- **Fails closed.** A row that does not open, or whose re-seal does not open to the
  same plaintext under the same scope, is not written. The run finishes the rest and
  exits 1. The check happens before the write.
- **Output is classes and counts only.** It never prints a plaintext, a ciphertext
  or a row id.

The command resolves its data key from `OS_SECRET_KEY`, `OS_DEV_CRYPTO_KEY` or the
persisted key file, in the strict posture: it never mints a key, and it hands the
settings service it boots the same provider so that service does not mint one
either. With no key it refuses before opening any row.

`@objectstack/service-settings` publishes `ciphertextDerivationStatus` (and its
`CiphertextDerivationStatus` type). It is `LocalCryptoProvider`'s own reading of
which derivation sealed a stored ciphertext, read off its marker without opening it:
`current`, `superseded` or `unknown`. The re-wrap classifies rows with it rather than
restating the marker grammar.
