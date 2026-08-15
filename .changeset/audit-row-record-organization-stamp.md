---
"@objectstack/plugin-audit": patch
---

fix(audit): audit rows are stamped from the record's own organization, not the actor's active one (#8707)

`sys_audit_log` / `sys_activity` rows took their organization from
`sess.tenantId ?? recordOrgId` — the ACTING session's active organization in
preference to the organization of the record the row is about. A write
performed from a session whose active organization differs from the record's
therefore landed the audit row behind the wrong tenant's wall: unreadable to
the tenant admin it concerns, and readable by an organization with no claim to
the record. That is the invisible-audit-row defect the record-side fallback was
added to prevent, one layer down, and the maintainer's ruling on #8287 settles
it the other way — the stamp comes from the row's own organization.

The precedence is now `recordOrgId ?? sess.tenantId`. The RLS fallback is
preserved unchanged: an audit row must never be written with a NULL
organization, so the acting session's tenant still answers whenever the record
has no organization of its own (single-tenant stacks, platform-global objects,
a NULL column), and the record's organization still answers on the two cases
the fallback was written for — background/sudo paths with no `tenantId`, and
better-auth's `activeOrganizationId` cache miss right after sign-in.

Which column carries a record's organization is now resolved from the
REGISTERED SCHEMA rather than the hard-coded `organization_id` literal, with
the same precedence `SqlDriver.computeTenantField` already applies: an ADR-0066
`tenancy.enabled: false` opt-out resolves to no organization at all (so a
platform-global object's audit trail is not scoped into one tenant and hidden
from the platform admin who acted), then a declared `tenancy.tenantField` when
the object really has that field, then the canonical injected
`organization_id`.

Most deployments see no change: under the `isolated` posture the Layer 0 wall
makes a cross-organization write of a walled object impossible, so the two
sides agree by construction. The behaviour changes under the `group` and
`shared` postures, and on system paths that write another organization's row
while carrying a session.

Not addressed here: `sys_api_key.active_organization_id` is still not
reachable by this resolver, so revocation rows on that object continue to fall
back to the actor's organization. Its column is deliberately not the object's
tenant-scope column and must not become one, so closing that half needs a
read-neutral, stamp-only organization declaration in `packages/spec`. #8707
remains open for it.
