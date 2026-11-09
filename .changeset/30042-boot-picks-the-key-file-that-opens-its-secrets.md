---
'@objectstack/cli': patch
'@objectstack/service-settings': patch
---

fix(cli): when two data-key files hold different keys, `os start` and `os dev` read with the one that opens the project's stored secrets, or a production boot refuses

Clause-②: yes (narrowing) — a production `os start` / `os serve` boot whose two candidate key files (the shared `$HOME/.objectstack/dev-crypto-key` or `$OS_HOME`'s, and the project's `.objectstack/dev-crypto-key`) both fail to open the database's newest stored secret now refuses to start, naming both files; it used to start and serve every stored secret as unset. The widening half: `@objectstack/service-settings` gains new exports (`chooseKeyFileByTrialOpen`, `settleKeyFileChannel`, `storedSecretReaderOverEngine`, `deferredLocalCryptoProvider`, `DataKeyOpensNothingError`, `KEY_FILE_CANDIDATE_CHANNEL_ENV` and their types).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, export or stored row changes shape: the refusal is a boot posture over which key file opens existing ciphertext. No ciphertext is rewritten, so there is nothing at rest for a migration to move. -->

**BREAKING** boot narrowing (`@objectstack/cli`, `@objectstack/service-settings`): a production boot whose candidate data keys open none of the stored secrets refuses to start.

- **`@objectstack/cli`.** When the shared key file and the project's own key file (the one an earlier `os start` minted) hold different keys, the CLI no longer picks one. It hands the `serve` child both, and the child decides once the database is open: it opens the newest stored `sys_secret` value under each key and reads with the key that opens it, and the boot says which file it took. A project that only ever ran `os start`, on a machine whose home holds a key from `os dev` in another project, reads its secrets back again. With no stored secret yet, the shared file is used, as before. When neither key opens the stored secrets, a production boot (`os start`, `os serve`) refuses to start and names both files; a development boot (`os dev`) starts and prints a boot error naming both files. The one-shot commands (`os migrate`, `os secret rewrap`, `os secret orphans`, `os storage orphans`) now read the same file by the same rules: the project's own file when it alone holds a key, and the key that opens a stored secret when both do.
- **`@objectstack/service-settings`.** The settings service makes that choice in its `start()`, before any reader decrypts, when the CLI names a second candidate on the internal `OS_INTERNAL_CRYPTO_KEY_FILE_CANDIDATE` channel. A leading `~` in `OS_HOME` (or `OBJECTSTACK_HOME`) is now the home directory when the provider finds its key file, as `os start` already read it; it used to name a directory called `~` under the working directory.

**The remedy.** If a production boot refuses with "neither data key opens this database's stored secrets", find the key those secrets were sealed under (a backup of either file, or the `OS_SECRET_KEY` the deployment once ran with), keep a copy of both files, and put that key at the shared file the message names, or set `OS_SECRET_KEY` to it.

Supersedes, in the same release: the note for #29934 says that when the shared file and the project's file hold different keys, the shared one is used and a warning names both paths. After this change the boot uses whichever of the two opens the stored secrets, and refuses in production when neither does.
