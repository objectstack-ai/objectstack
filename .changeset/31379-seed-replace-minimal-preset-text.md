---
'@objectstack/skills': patch
---

docs(skills): the platform skill's Seed Data line no longer marks seed mode `replace` as data loss

Clause-②: no
Metadata-protocol: none

`replace` inserts every record with no match and deletes nothing, so a replay over a table nobody cleared leaves the existing rows as they are and adds the dataset's records again. The platform skill now says so (never deletes, duplicates), as the `SeedMode` comment and the data skill's seeds reference already did. The `PLATFORM_ALWAYS_ON_CAPABILITIES` comment in `@objectstack/spec` also says what `--preset minimal` still mounts: `job` and `queue` when `email`, `approvals` or `auth` is present, and `email` when `auth` is.
