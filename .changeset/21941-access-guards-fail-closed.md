---
'@objectstack/runtime': minor
'@objectstack/plugin-auth': minor
---

fix(runtime, plugin-auth)!: two access guards refuse, instead of admitting, when their own read cannot answer

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime refusal narrowing on two access guards, not a metadata change: no spec key, export, option or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which requests the two guards admit: a request admitted only because the guard's own read faulted is now refused with 503, and every answer from a healthy read is unchanged. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers either guard and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention: a request that one of these two guards let through only because the guard's own read faulted is now refused. Nothing an author or caller writes changes shape.

- **`@objectstack/runtime` — the dispatcher's environment-membership gate.** When its `sys_environment_member` read throws, or no ObjectQL engine resolves on the request's kernel, the request is refused with `503 SERVICE_UNAVAILABLE` — the `AuthzStoreUnavailableError` answer the identity step and the domain gates already give an authorization input they could not read. Before, the gate logged at debug level and let the request through. A member is still admitted, and a non-member is still refused with `403 PROJECT_MEMBERSHIP_REQUIRED`. An engine whose registry does not register `sys_environment_member` declares the gate inapplicable, and nothing is read.
- **`@objectstack/plugin-auth` — the organization slug guard** (`organizationHooks.beforeUpdateOrganization`). When its `sys_organization` or `sys_environment` read throws, the organization update is refused with `503 SERVICE_UNAVAILABLE`. Before, the hook ended without refusing and the slug changed. A slug change while an active environment references the organization is still refused (`403 FORBIDDEN`), and any other change is still allowed. An engine that does not register `sys_environment` — the open-source composition, where it is a cloud-provided object — declares the guard inapplicable from its registry (`getSchema`): nothing is read and the update proceeds as before. Without a data engine the guard does not apply either.

What changes for you: nothing in what you write. A `503 SERVICE_UNAVAILABLE` on these doors is a store outage that used to be hidden behind an admitted request; it clears when the store answers again.
