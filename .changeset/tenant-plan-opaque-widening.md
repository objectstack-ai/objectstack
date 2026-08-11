---
"@objectstack/spec": minor
---

Widen `TenantPlanSchema` / `TenantPlan` (`packages/spec/src/cloud/tenant.zod.ts`) from a
closed 5-value enum (`free`/`starter`/`pro`/`enterprise`/`custom`) to an opaque plan
identifier (any string). The vocabulary — which plan strings exist and what each one
unlocks — is control-plane config owned by the cloud distribution, not protocol; the
schema's `.describe()` states this ownership and the shared empty/unknown-⇒-free-tier
convention.

This is a pure widening: every value the old enum accepted is still accepted, and nothing
in the framework, console, or spec package parses this field against the enum at runtime
(measured in cloud#1216 / objectstack#7513 — the only branching readers are the cloud
distribution's own entitlement modules). No migration is required; `sys_environment.plan`
and the other embedding schemas (`TenantContext`, `TenantDatabase`,
`ProvisionTenantRequest`, `ProvisionEnvironmentRequest`, `ProvisionOrganizationRequest`)
keep their field-level shape and defaults unchanged.
