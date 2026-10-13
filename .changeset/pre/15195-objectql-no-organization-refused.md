---
'@objectstack/objectql': minor
---

A system-context insert under the `single` tenancy posture is refused when the install holds no organization, instead of landing with no owner

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at the engine's system-insert door: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. The runtime TypeScript surface moves with it, and is described below rather than prescribed: `resolveSystemWriteOrganization` takes a required `organizationObjectRegistered`, its `no-organization-yet` answer is gone and `no-organization-object` answers the composition with no organization object, and `SystemWriteOrganizationRequiredError.reason` gains `no-organization`. The package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered). -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D9).

- **Before.** Under the `single` posture, in a composition that registers the organization object, a system-context insert on a tenant-scoped object with no organization anywhere landed with `organization_id` NULL when the install held no organization yet. That was the normal state of a first boot: the organization arrived with the first sign-up.
- **Now.** The Default Organization is a boot invariant under `single` (ADR-0131 D3): `@objectstack/plugin-auth` creates it before the application seeds load and before the server accepts a request. An install that registers the organization object and holds none of it therefore has no owner to derive, and the insert is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (status 500, `reason: 'no-organization'`). The message names the missing organization. Nothing is written.
- **Unchanged.** Exactly one organization is derived and stamped. Several organizations, or a walled posture, are refused as before. A write that carries an organization, on the execution context or on the record, is never refused. Objects with no organization column, objects declaring `tenancy: { enabled: false }`, and federated objects are outside the rule. The platform-namespace objects the tenancy inventory has not admitted keep their per-object exclusion; ADR-0131 C8 retires it. A composition that registers no organization object at all (a lean embedding) still lands the write unstamped.

**The remedy.** On a `single` deployment, the refusal means the Default Organization is missing: restart, and the auth plugin recreates it at boot, or carry the organization on the write (`{ context: { isSystem: true, tenantId } }`, or `organization_id` on the record). A TypeScript caller of `resolveSystemWriteOrganization` passes whether its composition registers the organization object.
