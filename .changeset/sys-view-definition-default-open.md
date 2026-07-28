---
"@objectstack/metadata-core": patch
---

refactor(metadata-core): drop `sys_view_definition`'s all-six `apiMethods` whitelist (#3026)

#3745 completed this object's boilerplate CRUD-five whitelist to all six
primitives so its batch routes stopped 405-ing. A whitelist naming all six is
equivalent to no whitelist — except it stops tracking primitives the enum grows
later — so the #3543 audit rule applies and the declaration is removed.

No behaviour change: `undefined` resolves to `unrestricted`, whose effective
operation set is identical to `restricted` holding all six.

Removing it is safe HERE specifically because the object has no `managedBy`:
`reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
`apiMethods`, so for a managed object an absent whitelist would take the
managed-write backstop with it. That is why the RBAC objects reclaimed by #3745
keep their explicit arrays and this one does not.
