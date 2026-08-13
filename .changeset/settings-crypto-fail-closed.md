---
"@objectstack/service-settings": patch
---

fix(service-settings): refuse to persist a secret through the base64 `NoopCryptoAdapter` — the settings write path now fails closed like the engine's (#8026)

`SettingsService` constructed without a `cryptoProvider` + `secretStore` fell
back to `NoopCryptoAdapter`, whose `encrypt()` is `'b64:' + base64(plaintext)`.
That is **encoding, not encryption**: trivially reversible, and it leaves
`sys_setting.value_enc` populated — so the row reads as protected to the next
author and to the next audit while being plaintext with extra steps.

The engine's `Field.secret()` path has always taken the opposite posture: with
no `CryptoProvider` registered it throws rather than store cleartext. The
platform therefore had two credential-encryption paths with **opposite failure
modes**. This aligns the settings side onto the engine's.

**Not a live leak, and not written as one.** The shipped plugin path wires a
real `LocalCryptoProvider` at `kernel:ready` once an `objectql` engine resolves,
so a default deployment never took the base64 branch. What this closes is the
fail-open *direction* on a path an engine-less deployment can still reach.

**What changed.** A write of a declared-encrypted key (`encrypted: true` or the
manifest's `type: 'password'`, which means "encrypt this") is now refused with
`SettingsCryptoUnavailableError` when the `sys_secret` path is not wired *and*
the inline `CryptoAdapter` declares no confidentiality. The whole batch is
rejected — a plain sibling key in the same patch is not half-written — and one
operator-actionable line is reported through the deployment logger, deduped per
key, so a caller that swallows the error still leaves a trace. Over REST the
refusal answers `500` on the declared envelope, carrying the fix in the message.

**What did not change.**

- `NoopCryptoAdapter` remains exported (public API) and its `decrypt()` is
  untouched: existing `b64:` rows stay readable, reportable and migratable. The
  refusal is write-only — refusing the reads too would strand exactly the data
  worth surfacing.
- Injected adapters (`SettingsServicePluginOptions.crypto`) are unaffected. An
  adapter declares itself fit to hold a secret with the new optional
  `CryptoAdapter.confidential`; **absent means yes**, so every adapter written
  before this flag keeps working, and only the base64 default declares `false`.
  The exported `providesConfidentiality(adapter)` is the predicate the write
  path uses.
- Clearing an encrypted key (writing `null`) is still allowed: there is no
  plaintext to protect, and an operator must always be able to REMOVE a value on
  a deployment that cannot store one.
- Validation still runs first, so a caller submitting a bad value on a namespace
  that happens to carry a secret still gets the field-level diagnostic they can
  act on rather than a deployment fault they cannot.
