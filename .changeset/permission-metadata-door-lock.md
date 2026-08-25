---
'@objectstack/plugin-security': minor
---

The packaged-permission-set lock now guards the metadata door as well as the data door. The pre-persistence authoring-gate seam gains a `permission` registration (`registerPackagedPermissionSetLockGate`, new export) that consults the same `classifyPackagedPermissionSet` classifier and throws the same `PackagedPermissionSetLockedError` the `sys_permission_set` write door already uses — one spelling of "package-declared", two doors, one refusal.

What stops working, and for whom: an operator using the `OS_METADATA_WRITABLE=permission` escape hatch to save a permission set that an installed package declares now gets `403 NOT_OVERRIDABLE` (the refusal names the sanctioned clone path) instead of silently minting a `sys_metadata` overlay whose grants win at read over the package's declaration. This applies hatch open or closed, draft and publish saves alike, and also means stored-overlay maintenance passes (e.g. stored-item migration) report a per-row refusal for such grandfathered forks rather than rewriting them.

What keeps working unchanged: hatch writes to any name no installed package declares — the hatch's documented per-org/env override capability — land exactly as before, and package-door authoring of workspace-owned sets (definitions living in `sys_metadata`; ADR-0070, ADR-0094 D5-R) stays editable. Package publishes travel the `package-author` channel, which this seam exempts by contract.
