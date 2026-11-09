---
'@objectstack/plugin-audit': patch
'@objectstack/metadata-protocol': patch
---

feat(audit): a package uninstall writes one `package_uninstall` row about the package itself

Clause-②: yes
Metadata-protocol: none

Uninstalling a package left a `sys_audit_log` row for each metadata item it removed, and nothing about the package: its `sys_packages` row is deleted with raw SQL, so no hook ever saw it. A package that shipped no stored metadata left no trace at all. The uninstall verb (`deletePackage`, the path `DELETE /api/v1/packages/:id`, the import rollback, the paired-customization undo and any in-process caller take) now writes one row per package it uninstalled, after the package's stored row is gone: `action: "package_uninstall"`, the actor the verb was called for (`user_id` and `actor`; a `svc:` principal is the `actor` only), no record and no organization (an uninstall is environment-wide, so the row is deployment-level and served to the platform administrator alone), and in `metadata` the package id, its installed version, the environment, whether the object tables were kept, the items removed and left behind, and `outcome` (`complete` or `partial`).

An uninstall the verb refuses writes no row, and neither does an id that is not installed. The writer lives on the `audit` service slot as `recordPackageLifecycleEvent`, beside `recordAuthEvent`; a kernel without the audit plugin uninstalls exactly as before, and a ledger write that fails is logged at `error` once per cause without changing the uninstall's answer.
