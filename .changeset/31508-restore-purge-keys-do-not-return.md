---
'@objectstack/spec': patch
---

docs(spec): the `allowRestore` / `allowPurge` migration texts stop promising the keys back with M2 and name the recycle bin's grants

Clause-②: no
Metadata-protocol: none

- **Conversion `permission-allow-restore-purge-removed`.** Its `summary`, which `os migrate meta` prints, said the keys "return with the M2 lifecycle initiative". It now says the keys do not return: the `restore` / `purge` operations exist with the recycle bin (ADR-0148), and their grants are `allowRestoreOwnDeleted` and `manageRecycleBin`. Its docblock says the same. The conversion's `id`, `toMajor`, `retiredAfter`, `surface`, transform and fixture are byte-identical.
- **Semantic entry `permission-restore-purge-bits-retired`.** Its `replacement` names the two grants instead of "the bits return together with the operations they gate". Its `reason` and `acceptanceCriteria` keep the history (the operations did not exist when the keys were retired) and no longer say a `restore` or `purge` request is denied for every principal: stripping the keys still changes no access decision, because nothing reads them.
- **Step 18's rationale and the four retired-key rows** for `allowRestore` / `allowPurge` (authoring and effective faces) say the same, so the protocol 17 → 18 upgrade guide no longer names M2 as their return path.
- **Liveness notes.** The two `dead` rows in `liveness/permission.json` and the file's note say the same; their status and evidence are unchanged.

Text only, matching the tombstone prescriptions PR #31438 rewrote: no schema, accepted set, conversion behaviour, tombstone or runtime answer changes.
