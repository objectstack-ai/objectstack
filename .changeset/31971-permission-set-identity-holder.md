---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-approvals': patch
---

fix(security): read every administrator identity and every grant gate by the permission set's package, not its name alone

Clause-②: no
Metadata-protocol: none

When another package ships a permission set under one of the platform's names (`admin_full_access`, `organization_admin`, `organization_admin_no_bypass`), a grant of that package's set is now granted like any other set and confers no administration. Platform standing, the tenant-administrator rung, the approvals override, the access explainer's posture, the break-glass guard's administrator count, the Default Organization's owner binding, the role-change answer and the upgrade report's recipients all read the platform's own set: the holder whose package declares the kernel namespace `sys`. The deployment-config administrator is given the platform's `admin_full_access` even beside another package's set of that name.

The delegated-admin gate compares `(package, name)`. A scope's allowlist names a holder: each name resolves from the package of the set that carries the scope, so a delegate allowed to grant one package's `sales_rep` cannot grant another package's `sales_rep`, by a direct grant or through a position. A grant is judged at the holder its package column names, and at the holder the write seam will stamp from the name.

The security plugin's evaluator, when no security catalog is bound, no longer picks the first of two sets that share a name: such a name grants nothing and is logged, naming every holder.

A deployment where every set name has one holder sees no change.
