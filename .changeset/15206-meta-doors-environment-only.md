---
'@objectstack/metadata-core': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/plugin-email': minor
'@objectstack/spec': minor
---

feat(metadata-core,rest,runtime,plugin-email,spec)!: the `/meta` doors carry no organization; organization-admin metadata authoring closes and `manage_org_presentation` retires (ADR-0131 D6)

Clause-②: no (narrowing)

<!-- adr-0087: registered manage-org-presentation-retired, meta-doors-organization-scope-retired -->

**BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.

ADR-0131 D6 retires the per-organization overlay axis: environment metadata written by Studio belongs to the whole deployment. The `/meta` doors of both transports (`@objectstack/rest` and the runtime dispatcher's `/meta` branch) used to thread the caller's active organization into writes and reads of the five `allowOrgOverride: true` types (`view`, `dashboard`, `report`, `translation`, `email_template`). They no longer do, for any type, and the read and the write flip together.

**What changes.**

- **Writes land environment-wide.** `PUT`, `DELETE`, `POST …/publish` and `POST …/rollback` on `/api/v1/meta/:type/:name` hand the protocol no organization, so the row and its audit and history rows carry `organization_id` NULL, whatever the caller's active organization.
- **Reads are environment → code.** The item read (both cache arms), the list, the layered view (`/layers` and `?layers=true`), `/published`, `?state=draft`, `GET /meta/_drafts`, `/history`, `/diff`, `/audit` (the environment rows, `organizationId: null`), `GET /meta/diagnostics` and `/references` name no organization.
- **An organization admin's metadata write is refused.** `metaWriteCapabilityVerdict` admits `isSystem` or `manage_metadata` only. A caller holding `manage_org_presentation` and not `manage_metadata` is answered `403` on all four item doors (`FORBIDDEN` on REST, `PERMISSION_DENIED` on the dispatcher) with `… requires the \`manage_metadata\` capability.`, for every type and whatever its active organization.
- **`manage_org_presentation` retires** from `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`). A permission set naming it still parses and loads, and its other grants still apply; the grant itself admits nothing. The `sys_capability` row seeded for it earlier is not pruned (the seeder upserts only); an operator may delete it in Setup.
- **The email-template boot sweep** (`@objectstack/plugin-email`) reads the effective templates environment → code, as the door serves them; it no longer reads in the Default Organization.

**What moves for consumers.**

- FROM `import { organizationIdForMetaWrite } from '@objectstack/metadata-core'` TO nothing: a `/meta` write carries no organization. Delete the call and the `organizationId` it fed.
- FROM `import { ORG_PRESENTATION_AUTHORING_CAPABILITY } from '@objectstack/metadata-core'` TO nothing: delete the import.
- FROM `metaWriteCapabilityVerdict({ isSystem, systemPermissions, canonicalType, activeOrganizationId, operation })` TO `metaWriteCapabilityVerdict({ isSystem, systemPermissions, operation })`: drop the two members.
- FROM `import { metaReadOrganizationId } from '@objectstack/rest'` TO nothing: a `/meta` read carries no organization. `metaCallerOrganizationId` stays.
- FROM `bootstrapEffectiveEmailTemplates(engine, metadataService, { protocol, tenancy })` TO `{ protocol }`: the `tenancy` source is gone.
- A permission set granting `manage_org_presentation`: grant `manage_metadata` to whoever must author those five types, and delete the stale grant.

**What a deployment observes.** An overlay row an earlier release stored under an organization stays in `sys_metadata` untouched, and is no longer served by any `/meta` read or projected by the email-template sweep until the promotion ceremony (ADR-0131 C7) carries it to the environment layer. Under the `single` posture that is every earlier Studio save of the five types, because it was filed under the Default Organization: on the `/meta` doors such an edit reads as reverted to the environment or code definition. Re-save the item in Studio to make the edit live on the `/meta` doors now. Public forms are the one exception: until that ceremony the anonymous form doors read a form `view` in the Default Organization and prefer its overlay — body and withdrawal alike, fail-closed — so a legacy organization overlay of a public form keeps being served there, and a Studio re-save (an environment row) does not change what that public form serves.

**What does not change.** Saves of every other type were already environment-wide. Flow saves, the capability gate's answer for `manage_metadata` holders and `isSystem`, the protocol's own organization-scoped refusals, and the `/packages` doors are untouched by this change.
