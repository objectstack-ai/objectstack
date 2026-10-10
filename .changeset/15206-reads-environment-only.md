---
'@objectstack/metadata-protocol': minor
'@objectstack/metadata-core': minor
'@objectstack/objectql': minor
'@objectstack/rest': minor
'@objectstack/plugin-security': minor
'@objectstack/spec': minor
---

feat(metadata-protocol,metadata-core,objectql,rest,plugin-security,spec)!: every metadata read is environment → code; legacy organization rows and overlays of sealed managed content are reported at boot, not served (ADR-0131 D6)

Clause-②: no (narrowing)

<!-- adr-0087: registered metadata-read-organization-scope-retired -->

**BREAKING (narrowing).** No read that is refused today is admitted. Graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.

ADR-0131 D6 retires the per-organization overlay axis. The doors carry no organization and the protocol refuses every organization-scoped write; now every protocol read is environment → code as well.

**What changes.**

- The item, list, layered, cached (ETag), history, diff, audit, drafts and commit-timeline reads, the `_lock` gate's overlay layer, search's page sweep, diagnostics and references serve the environment's stored row, else the code packages' definition — whatever organization a caller names. A row stored organization-scoped by an earlier release is served by no read and loaded by no boot.
- `overlayScope` on the layered read is `'env'` or `null`; `'org'` is gone.
- `listDrafts` lists the environment's drafts only, and its rows carry no `organizationId`.
- `listCommits` lists the environment's commits only, for every caller: a legacy organization commit is not shown, so an operator on the packages door no longer sees every organization's legacy commits, and a rollback plan never contains one.
- [Triage ruling Q1 → C] An environment row that overlays an item a managed package ships, on a type sealed against overlays (any type whose registry entry admits no overlay — a managed flow, action, hook, object or datasource, for example — written through the `OS_METADATA_WRITABLE` hatch before the seal), is not served: the package's definition is. An `object` such row is not loaded at boot either, so the engine keeps the packaged schema. A stored fork of a code-declared permission set keeps its own ruling (detection reading and Discard Overlay) and is still served.
- `@objectstack/objectql` binds the environment's authored hook and action rows only; a legacy organization-scoped hook or action row is no longer bound.
- Boot names both populations, once each: `[metadata_org_scoped_unserved]` lists every legacy organization row per type (active and draft), plus the legacy rows of `sys_metadata_commit`, `sys_metadata_history` and `sys_metadata_audit`, and names the v18 migration ceremony (`os migrate`, ADR-0131 D10) that carries them; `[metadata_sealed_overlay_unserved]` lists the sealed overlays per type with the two remedies. Nothing is deleted or rewritten.
- The anonymous public-form doors keep reading the Default Organization's legacy `view` layer, fail-closed, until that ceremony (triage ruling Q3 A) — through the protocol-internal `legacyFormOrganizationId` key, which no spec request declares and which the protocol honours for `view` alone.
- The seed loader's refusal of an unowned record now prescribes `organization_id` on the record first: a seed published through a package carries no caller organization.

**What moves for consumers.**

| From | To |
|:--|:--|
| `organizationId` on a `GetMetaItems` / `GetMetaItem` / `GetMetaItemLayered` / `AuditMetaItem` / `HistoryMetaItem` / `GetMetaItemCached` request (`@objectstack/spec`) | drop it: the read is the environment's. The key is stripped at a spec parse (the schemas are not strict) and no longer type-checks |
| `organizationId` on a `listDrafts` / `listCommits` / `diffMetaItem` / `getMetaDiagnostics` / `findReferencesToMeta` request (`@objectstack/metadata-protocol`) | drop it |
| `ListDraftsResponse` draft `organizationId` | gone: every listed draft is the environment's |
| `overlayScope: 'org'` (`GetMetaItemLayeredResponse`) | only `'env'` or `null` |
| `declaresOrgOverride`, `organizationIdForMetaRead` (`@objectstack/metadata-core`) | removed — no read takes an organization. Read `allowOrgOverride` off `DEFAULT_METADATA_TYPE_REGISTRY` where a type's overlay channel is the question |
| `MetadataAuthoringGateContext.organizationId` (`@objectstack/metadata-protocol`) | removed — no write is organization-scoped, and no gate read it |
| a legacy organization-scoped `sys_metadata` row a deployment relied on | re-save the item in Studio to make it environment-wide now, or wait for the v18 migration ceremony, which promotes it |
| an environment overlay of a managed item on a sealed type (flow, action, hook, object, datasource …) | re-express the change as a new item under a new name (a linkage-free clone), then delete the stored row; or delete the row |

**What does not change.** No stored row is deleted, rewritten or migrated. The anonymous form doors' read of organization-layer withdrawals is unchanged.
