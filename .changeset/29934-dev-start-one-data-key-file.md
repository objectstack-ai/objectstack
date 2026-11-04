---
'@objectstack/cli': patch
'@objectstack/service-settings': patch
---

fix(cli): `os dev` and `os start` share one data-key file, so a secret saved under `npm run dev` reads back under `os start`

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/cli`.** Both commands open the same project database, but `os start` used to mint its own data key under its own home (`<project>/.objectstack/dev-crypto-key` in project mode) while `os dev` kept the key at `$HOME/.objectstack/dev-crypto-key` (or `$OS_HOME`'s). Every secret written during development then read back as unset under `os start`. Both commands now resolve the key file the way `os dev` always has (`os start --home` counts as `OS_HOME`) and hand it to their `serve` child on the internal `OS_INTERNAL_CRYPTO_KEY_FILE` channel. The project-local file an earlier `os start` minted is not orphaned: when it alone holds a key it is still read, and the boot says which file; when it and the shared file hold different keys, the shared one is used and a warning names both paths. An explicit `OS_SECRET_KEY` / `OS_DEV_CRYPTO_KEY` still wins, unchanged.
- **`@objectstack/service-settings`.** New exports `resolvePersistedKeyFile` (the one resolution both commands take, beside the provider's own key-file path) and `KEY_FILE_CHANNEL_ENV`; the local crypto provider's file tier reads the file that channel names, ahead of `OS_HOME`.
