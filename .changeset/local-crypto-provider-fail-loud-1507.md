---
"@objectstack/service-settings": minor
"@objectstack/cli": patch
"@objectstack/spec": patch
---

Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

The default `ICryptoProvider` backs every secret-at-rest in the platform —
encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
runtime datasource credentials. Its key resolution previously fell back,
**silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
new on-disk key on every boot) when no stable key was available. In an
ephemeral-FS container or a multi-node cluster, each restart / each node then
encrypts under a different key, and every previously-written `sys_secret` value
becomes undecryptable. The failure was invisible at encrypt and boot time and
only surfaced later as "all my saved passwords / API keys / DB credentials
fail to decrypt".

- **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
  implied an ephemeral key when the provider in fact persists one.
  `InMemoryCryptoProvider` stays as a deprecated alias for backward
  compatibility.
- **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
  hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
  remains the dev convenience key.
- **Fail-loud in production.** When `NODE_ENV=production` and no stable key
  source (env var or a pre-existing persisted file) is available, the provider
  now throws an actionable error at construction instead of generating a key —
  turning silent data-loss into a config error at boot. It never auto-mints a
  key in production. Development and test keep the ergonomic fallback
  (persisted dev key / ephemeral test key).
- `serve` surfaces the production-key error verbatim and refuses to wire an
  unstable provider for `secret` fields.

KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
"your stored secret is still there after a reboot" stays open-source.
