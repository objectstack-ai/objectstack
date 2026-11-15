---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a seed dataset of an object walled by a declared `tenancy.tenantField` replays per organization on that column

Clause-②: no
Metadata-protocol: none

A per-organization seed replay (AppPlugin's `seed-replayer` on a walled boot, or a `SeedLoaderService` load pinned to `config.organizationId`) matched the existing rows of every dataset on `organization_id`. A dataset of an object walled by a declared `tenancy.tenantField` with `systemFields.tenant: false` has no such column, so the replay threw the driver's `INVALID_FILTER` and seeded nothing for that organization.

- The existing-row match now runs on the column the object is walled by: `resolveTenantFieldName` on its definition, `organization_id` when that resolves none. This is the reading the reference probe already scopes a target by.
- The seed stamp uses the same column. A row of such an object is stamped with the seeding organization's id in its declared tenant column, which the tenant wall reads as the organization, as `organization_id` is stamped on every other tenant-scoped object. A load with no organization, pinned or derivable, refuses such a row with the loader's named refusal on that column, where the engine's write refusal answered before. A record that supplies its own value in the column keeps it, and its writes carry that organization.
- An object that declares a `tenancy.tenantField` and also carries `organization_id` is stamped on the declared column, the one the engine and the driver wall it by. The loader no longer writes `organization_id` on such a row.
