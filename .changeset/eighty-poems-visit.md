---
'@objectstack/objectql': patch
---

The boot-time action-governance audit now reaches a SCOPED `metadata` service.

`ObjectQLPlugin.runGovernanceInventory` acquired its metadata plane with
`ctx.getService('metadata')`, which reads only the two synchronous service maps.
A composition that registers `metadata` with `ServiceLifecycle.SCOPED` mints its
instances into `PluginLoader.scopedServices` instead, so the call threw
`Service 'metadata' is async - use await` before `loadMany`, `loadManyKeyed`,
`loadDiagnosed` or `load` could run, the plugin swallowed the throw into "no
metadata plane at all", and the ADR-0110 D5 inventory reported that scope's
`action` declarations as absent — silently, because an empty declaration set is
indistinguishable from a plane that holds nothing. On such a kernel a handler the
router dispatches was reported as "registered handler with NO declaration …
REFUSED at dispatch".

The plane is now resolved in the router's own order — `getServiceScoped('metadata',
environmentId)` first, then the synchronous lookup — so the audit holds the same
instance `HttpDispatcher.resolveService` hands the router. Statically registered
planes (every shipped composition today) resolve to the same object as before.
