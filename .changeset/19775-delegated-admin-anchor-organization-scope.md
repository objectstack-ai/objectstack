---
"@objectstack/plugin-security": patch
---

The delegated-administration gate resolves a scope's business-unit anchor **inside the caller's own organization**. In a single-database multi-org posture (ADR-0105 D1 `group` / `isolated`) a unit name shared by two organizations no longer crosses the boundary in either direction (#19775).

`sys_business_unit.name` carries no uniqueness — the object's only unique index is `(code, organization_id)` — yet the gate looked the anchor up by name alone under a bare `{ isSystem: true }` context, which carries no tenant. The engine threads a tenant to the driver only when `execCtx.tenantId` is defined and `SqlDriver.applyTenantScope` returns early without one, so nothing scoped that read: a `limit: 1` lookup answered whichever id the driver ordered first, and which organization won was an id ordering. Measured on a real engine over a real SQL driver, with two organizations each holding a unit called `sales`, both directions were wrong at once — the delegate **lost its own subtree** (denied inside its own unit) while the gate **approved** a delegated write anchored in the other organization, and `describeDelegableScope` handed that organization's unit ids back to the caller.

- **What changed**: the anchor read, the descendant walk and the two catalog reads behind `describeDelegableScope` now carry the caller's organization — `organizationId ?? tenantId`, the same spelling the permission-set load already resolves a caller's authority with — and the candidates that come back are reduced to the caller's own rows. Both arms are load-bearing and each was measured to be: the driver's compatibility arm deliberately also returns organization-less rows, and a driver with no tenant scoping at all returns every organization's.
- **Fail closed**: an anchor that resolves to no unit of the caller's own organization now approves nothing, exactly as a misconfigured scope already did. Under a walled posture this also refuses an **organization-less** business unit, which that posture already treats as invalid state; a delegation anchored on one stops resolving and must be re-anchored on a unit the organization owns.
- **`group` posture**: the anchor resolves in the caller's **active** organization, not their whole membership set — the narrower of the two, and the one the caller's permission sets (and therefore the `adminScope` itself) were already loaded in.
- **Unchanged where there is no boundary to cross**: a caller carrying no organization (the `single` posture) keeps the by-name answer it had.

No exported symbol and no payload key was added: `describeDelegableScope` and `scopesCoverUser` take the caller's context as a new optional argument, and omitting it resolves exactly as before.
