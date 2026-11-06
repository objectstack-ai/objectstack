---
'@objectstack/service-settings': patch
---

feat(service-settings): the namespace read lists what is stored beneath a field an `OS_*` variable pins, so Setup can tell whether "clear the saved value" has anything to clear

Clause-②: yes (widening)
Metadata-protocol: none

- **Now.** `getNamespace()`, the read `GET /api/settings/:namespace` serves, answers a key whose `OS_*` override is in force with the same `value`, `source: 'env'`, `locked: true` and `lockedReason` as before, and its `cascadeChain` now lists, below the `env` entry, the entries the key's read carries with no override in force: the stored rows the caller's cascade draws on (`global`, `tenant`, `user`, each with its own lock), then `default`. The `env` entry stays first and is still the only one flagged `effective`. An entry at the key's declared scope with a non-null value is the value a clear (`null`, accepted through a pin since the ADR-0007 D6 amendment) removes; after that clear the entry reads `null`.
- **Secrets.** A secret key's entries beneath a pin carry the read mask when a value is stored and `null` when none is, in process too; the stored secret is never decrypted for them, so a key pinned because its stored secret no longer decrypts still reads.
- **Unchanged.** `get()` and `getMany()` still answer an override in force from the env alone, without reading the store: they are the reads request paths call. An override whose value coerces to `null` keeps its single `env` entry, because any non-null entry listed below it would read as the effective one.
- **Cost.** A pinned key joins the namespace read's existing grouped row load, so the read costs one more load only when every key of a group is pinned.
