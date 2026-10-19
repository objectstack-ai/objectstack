---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: an organization-scoped seed load refuses a row whose natural key a row with no organization already holds, by name in the seed result, instead of inserting a twin of it

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes, and no stored shape, is added, removed, renamed or converted: the change is which rows a seed load writes. The refused rows are ones with a NULL organization_id, and attributing them to an organization is the `os migrate organization-ownership` ceremony's job, so there is nothing for `objectstack migrate meta` to rewrite. The result keeps its shape: the refusal is one more entry in the existing `errors` array (`ReferenceResolutionError`), and no spec schema changes. -->

**BREAKING** (a seed load writes fewer rows), shipped as `minor` under the launch-window convention for breaking changes.

An organization-scoped seed load (`SeedLoaderService` with `config.organizationId`: the per-organization replay, the marketplace walled install and the sample-data reseed) looked up existing rows by natural key among that organization's rows only. A row holding the same natural key with `organization_id` NULL, as a database whose rows predate organization stamping holds them, was invisible to that lookup, so the upsert inserted a twin beside it that carried the organization. Nothing was reported: 0 errors, nothing logged. On a HotCRM 4.0.1 → 5.0.0 upgrade this doubled every seeded event, task, attendee and line item.

- **FROM:** in `upsert` or `ignore` mode, with `config.organizationId` set, a seed record whose natural key no row of that organization holds, but a row with no organization does, was inserted as a new row for the organization.
- **TO:** that record is refused. The load reports it in `errors` with the existing `ReferenceResolutionError` shape: `field: 'organization_id'`, `targetObject` the seeded object itself, `targetField` the natural key, `attemptedValue` its value, and a message that names the row holding the key and the remedy. It counts as errored, the load answers `success: false`, and the refusal is logged at `error`, once per dataset. The row with no organization is left exactly as it is: the loader never adopts it. Every other record still loads.
- **Unchanged:** a key the organization's own row holds is matched as before, even when an unowned row also holds it. Another organization's rows stay invisible to the lookup. A fully stamped database loads with 0 inserts. `update` mode (which never inserts) and the `insert` / `replace` modes are unchanged, and so is a load with no `config.organizationId` (the single-posture boot), which still matches the unowned row.

What to do. Attribute the rows that have no organization with `os migrate organization-ownership` (plan, then `--apply`), then run the seed again: each row is then the organization's own, and the upsert matches it.
