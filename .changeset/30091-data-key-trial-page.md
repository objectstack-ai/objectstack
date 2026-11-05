---
'@objectstack/cli': patch
'@objectstack/service-settings': patch
---

fix(service-settings): when two data-key files hold different keys, the boot judges the newest stored secrets as a page, not only the newest one, and reports a database split between the two keys

Clause-②: no — an internal boot heuristic and its notice text. The shapes it changes (`StoredSecretReader` now answers the page, `KeyFileChoice` gains the `mixed` reason and a `tally`, `DataKeyOpensNothingError` gains `judged`) were added by #30042, whose note is still pending, so they first ship together in this release; no released export changes.
Metadata-protocol: none

- **`@objectstack/service-settings`.** When the shared key file and the project's own key file hold different keys, the boot now trial-opens each of the newest stored `sys_secret` rows (up to ten) under both keys and reads with the key that opens more of them, on a tie the one that opens the newest. A row that opens under neither key (a corrupt or foreign row) no longer decides the boot: if an older row opens under one key, that key is used, and only a page where no row opens under either key keeps the production refusal. When each key opens some of the rows, the database holds secrets under both keys: the boot uses the key that opens more of them and prints an error naming both files, how many rows each key opened, and the fix. The boot's notices now say what was measured ("opens the 3 newest stored secrets", "opens 2 of the 3 newest stored secrets") instead of claiming the chosen file opens all of the database's stored secrets.
- **`@objectstack/cli`.** The one-shot commands (`os migrate`, `os secret rewrap`, `os secret orphans`, `os storage orphans`) share the same trial, so they make the same choice.

**The remedy for a split database.** Keep a copy of both files, then save again each secret that reads as unset: it is sealed under the key the boot uses. Once nothing reads as unset, put that key at the shared file (or set `OS_SECRET_KEY` to it).

Supersedes, in the same release: the note for #30042 says the boot opens the newest stored secret under each key and quotes the refusal as "neither data key opens this database's stored secrets". After this change the boot judges the newest rows as a page, and the refusal reads "neither data key opens any of the N newest stored secrets".
