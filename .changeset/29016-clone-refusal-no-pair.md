---
'@objectstack/runtime': patch
---

fix(runtime): a flow clone the engine refuses no longer installs the source's empty `.custom` customization package

Clause-②: no
Metadata-protocol: none

`POST /api/v1/automation/:name/clone` without `package` lands the copy in the source's paired customization package `<base>.custom`, ensuring it if needed. The pair used to be ensured before the engine validated the copy, so a clone refused `400` for an illegal machine name (or any other definition the engine refuses) still left a newly installed, empty `<base>.custom` in the package list and in Studio. The pair is now ensured only after the engine has accepted the copy, so a refused clone changes nothing. Refusals that can only come later — the ensured pair judged not writable, or the store refusing the save — still leave the pair in place, which is its ordinary state: ensure is idempotent, an empty pair is valid, and the next clone reuses it.
