---
'@objectstack/spec': patch
---

Retirement prescriptions for shapes `@objectstack/spec` 17.7.0 still accepts now name 18 as the release that removed them

Clause-②: no

17.7.0, the newest published release, still accepts every shape below. No 17.x release removes them: the 18 line does. Their refusals, and their `[REMOVED]` JSON Schema descriptions, named a different release:

| Surface | Was | Now |
| --- | --- | --- |
| `element:number` `object` / `filter`; `element:record_picker` and `element:repeater` `object` / `filter` / `sort` / `limit` | removed in @objectstack/spec 17 | removed in @objectstack/spec 18 |
| `object-grid` `defaultFilters` | removed in @objectstack/spec 17 | removed in @objectstack/spec 18 |
| `email_template.category`, `email_template.isSystem` | removed in @objectstack/spec 17 | removed in @objectstack/spec 18 |
| a package manifest's `permissions` written as a list of permission strings | removed in @objectstack/spec 17 | removed in @objectstack/spec 18 |
| `public` in `StorageScope` | removed in @objectstack/spec 17.8.0 | removed in @objectstack/spec 18 |
| `MetadataTypeRegistryEntry.allowOrgOverride` → `allowEnvironmentOverlay` | renamed (no release named) | renamed in @objectstack/spec 18 |

The `os migrate meta --from 17` sentence in each prescription is unchanged and was already right: `--from 17` replays the protocol-18 conversions. A prescription for a key that a 17.x release already refuses keeps naming 17. Text only: no key, value or shape is accepted or refused differently.
