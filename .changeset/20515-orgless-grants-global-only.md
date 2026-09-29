---
"@objectstack/core": minor
"@objectstack/plugin-security": minor
---

A grants resolution with no active organization now applies only the global grants. `resolveUserAuthzGrants` applies a grant scoped to an organization only while that organization is the active tenant, and one rule decides it for all three kinds of grant row it reads: position assignments (`sys_user_position`), permission-set grants (`sys_user_permission_set`) and the organization's own position rows whose bound permission sets it collects (`sys_position`).

**BREAKING** for a principal acting with no active organization. Before, "no organization" read as "every organization": each organization-scoped grant the user held anywhere applied, with no organization boundary left on it. That is the resolution a session falls back to when it names an organization its owner no longer belongs to, so a member removed from an organization kept the capabilities that organization had granted until someone revoked each grant by hand. Such a principal now holds its global grants and nothing scoped to an organization.

- **Unchanged:** a principal with an active organization resolves exactly as before, and a global grant (no organization) applies everywhere as before. Platform-admin standing is unchanged: it was only ever derived from the unscoped `admin_full_access` grant or the declared administrator list, never from an organization-scoped grant.
- **If a principal relied on it:** act in the organization. Select it as the active organization, or mint the API key from a session that has it active, or grant the permission set globally (no organization) when it is meant to apply everywhere.
- **No "every organization" mode.** No option asks the resolver for every organization's grants, and nothing falls back to that reading.
- **`@objectstack/plugin-security`:** `buildContextForUser(ql, userId, nowMs?, tenantId?)` takes the organization to resolve the user in. The access explainer (`explainAccessForCaller`) resolves the explained user in the caller's organization, and the delegator behind an on-behalf-of principal is resolved in the live principal's organization, so the delegated intersection counts the delegator's grants where the request actually runs.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves: no `packages/spec` schema, key or export changes, and no stored row changes shape, so `objectstack migrate meta` has nothing to rewrite and no conversion entry has anything to convert. What narrows is which already-stored grant rows apply to a resolution that names no organization; the remedy is operational (act in the organization, or grant globally) and is stated above. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers this (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration alone (not `runtime-interface-only` / `type-surface-only`). -->
