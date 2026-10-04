---
'@objectstack/objectql': patch
---

`LifecycleService` asks the registry whether `sys_organization` is registered before its governance tenant scan reads it, so a composition that registers no `sys_organization` sweeps single-tenant again instead of aborting every sweep

Clause-②: no

- The engine's in-process verbs refuse an object name the registry does not resolve (`OBJECT_NOT_FOUND`, 404) before any driver is asked. Take a composition with a settings service and lifecycle-declared objects but no `sys_organization` object. Its tenant scan got that refusal instead of a missing table, so every sweep aborted before applying any policy. The scan now asks `engine.registry.getObject('sys_organization')` first, the same shape `ObjectQL.probeInstallOrganizations` takes. An unregistered object answers "no tenant overrides", and the sweep runs one global pass on each declared window.
- A registered `sys_organization` is read as before. A missing table is still the one benign driver cause. Every other failure still aborts the sweep and is reported through `report.errors`, an `OBJECT_NOT_FOUND` from that read included.
- `LifecycleEngineLike['registry']` now declares the optional `getObject?(name)` member the scan reads. A registry without it cannot be asked, and the scan then reads exactly as before. No new export and no change to the sweep report's shape.
