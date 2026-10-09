---
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': minor
'@objectstack/service-automation': minor
'@objectstack/spec': minor
---

feat(metadata-protocol,runtime,service-automation,spec)!: the metadata protocol refuses every organization-scoped write, and an uninstall is environment-wide (ADR-0131 D6/D12)

Clause-②: yes

<!-- adr-0087: registered metadata-write-organization-scope-refused, package-uninstall-environment-wide -->

**BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.

ADR-0131 D6 retires the per-organization overlay axis. The `/meta` doors already carry no organization; now the metadata protocol itself refuses an organization-scoped write from every door, and the per-organization write path behind it is deleted.

**What changes.**

- Every protocol write that names an organization is refused with `403 NOT_OVERRIDABLE`, before anything is read or written, for every metadata type and every tenancy posture. This covers `saveMetaItem` (draft and publish), `publishMetaItem`, `deleteMetaItem`, `rollbackMetaItem`, `revertCommit`, `rollbackToPackageCommit`, `publishPackageDrafts`, `discardPackageDrafts`, `revertStoredPackage`, `duplicatePackage` and `reassignOrphanedMetadata`. The message's first sentence names the tenancy posture in force. The five types that declared `allowOrgOverride` (`view`, `dashboard`, `report`, `translation`, `email_template`) and the `OS_METADATA_WRITABLE` hatch no longer open an organization scope.
- The audit ledger (`sys_metadata_audit`) and the commit ledger (`sys_metadata_commit`) record `organization_id` NULL.
- The `/packages` doors of the runtime dispatcher thread no organization into any verb: publish-drafts, discard-drafts, the commit list, commit revert, rollback, revert, adopt-orphans, duplicate, delete, and the package manifest read.
- `deletePackage` retires its `organizationId` and `allTenants` request keys and both `400 TENANT_SCOPE_REQUIRED` refusals. The dispatcher's `DELETE /api/v1/packages/:id` no longer refuses an operator with no active organization. An uninstall removes every row bound to the package in this environment. Who may uninstall is the door's operator gate, as before.
- A seed published with a package no longer takes the publisher's active organization: a seed dataset names the organization it populates (ADR-0131 D9).

**What moves for consumers.**

| From | To |
|:--|:--|
| `organizationId` on a `SaveMetaItem` / `PublishMetaItem` / `DeleteMetaItem` request (`@objectstack/spec`) | drop it: the write lands environment-wide; a request still naming one is refused `403 NOT_OVERRIDABLE` |
| `organizationId` on any other protocol write verb's request | drop it, same refusal |
| `deletePackage({ packageId, organizationId })` or `deletePackage({ packageId, allTenants: true })` | `deletePackage({ packageId })`; either retired key answers `400 INVALID_REQUEST` and removes nothing |
| `DeletePackageRequest.organizationId` / `.allTenants` (`@objectstack/metadata-protocol`) | gone from the type |
| `UninstallCleanup`'s `organizationId` argument | gone; a cleanup receives `{ packageId, actor? }` |
| `TENANT_SCOPE_REQUIRED` in the error-code ledger | retired; no producer emits it |
| `findPlatformScheduleOrgGaps`' `organizationId` input | gone: every write is platform-level |

**What a deployment observes.**

- Rows stored organization-scoped before this release are not touched by any write. `POST /meta/_migrate-stored` reports each one as `skipped` and names the promotion ceremony (ADR-0131 C7); the stored-flow credential move reports such a flow as not moved (`NOT_OVERRIDABLE`) and logs that its credential is still in cleartext in that row — rotate it. A legacy organization-scoped draft is no longer promoted, discarded or reverted by a package verb, a commit recorded in a legacy organization layer is refused by `revertCommit`, and `duplicatePackage` and adopt-orphans copy or adopt the environment's rows only.
- An uninstall removes the package's legacy organization-scoped rows with it, as the declared cross-tenant uninstall did.

**What does not change.** The protocol's reads still accept an organization and still serve legacy organization rows; that narrowing is a later stage. The anonymous form doors' read of the Default Organization's layer is unchanged.
