---
'@objectstack/spec': minor
---

The #11566 `maxLength` narrowing (shipped in 17.x: `z.number().int().min(1)`, refused outside `BOUNDED_STRING_FIELD_TYPES`) is now registered in the ADR-0087 migration ledger (#11950) — the enforcement PR deliberately deferred the entry because the registry file was serialized behind an in-flight change. Following the #8321 `scale`/`precision` template, the major-18 semantic entry carries both halves: the mechanical one (delete the key where it was misplaced — inert by construction outside the write-time validator's bounded-string branch) and the judgment one (a malformed value on a bounded-string type WAS consumed by the validator's raw comparison — `maxLength: 0` accepted only empty strings, a negative value refused every write — so only the author knows the bound they meant; the entry tells them to re-declare it). `objectstack migrate meta`, `spec-changes.json` and the upgrade guide surface the entry at the major boundary; no accept/reject behaviour changes in this release.

<!-- adr-0087: registered field-max-length-malformed-or-misplaced-refused -->
