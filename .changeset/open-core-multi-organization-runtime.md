---
'@objectstack/organizations': minor
'@objectstack/plugin-security': patch
'@objectstack/service-cluster': patch
'@objectstack/spec': patch
---

Ship the multi-organization runtime as open source: `@objectstack/organizations` is now an
Apache-2.0 package in this repository (ADR-0132).

Single-database, row-level organization isolation was already open — the tenant Layer 0 wall,
the three tenancy postures, the organization and invitation objects, better-auth's organization
plugin, and the `requiresService: 'org-scoping'` Setup gates. What was closed was the one
registrar of the `org-scoping` service, so an install that set `OS_TENANCY_POSTURE=isolated`
could not enforce it: `serve` refused the boot, and the only way past was
`OS_ALLOW_DEGRADED_TENANCY=1` — the wall configured but not enforced. This package is that
missing registrar.

It provides:

- **`organization_id` auto-stamp on insert**, from the caller's active organization. A supplied
  — possibly forged — value is overwritten, never trusted.
- **Per-organization seed replay** on `sys_organization` insert, from the app's own seed
  definitions. Never another organization's rows.
- **Default-organization bootstrap** for the platform admin, idempotent.
- **The walled-posture membership-policy gate**: a deployment that raises the wall must declare
  what a new user joins, or the boot is refused.

Only the commercial **entitlement** stays closed. The open class carries no licence check of any
kind and offers no hook for one; an enterprise deployment resolves the same package name to a
private, licence-gated subclass through its own `workspace:*` declaration, so which class is
mounted is decided by the manifest that declares the name.

⚠️ Shipping the registrar is not yet the same as an open install raising the wall: `objectstack
serve` still resolves the runtime from the served app's own declaration and is not yet wired to
mount this package off `OS_TENANCY_POSTURE`. That, and the isolation matrix run against a real
registrar rather than a posture stub, are tracked separately.
