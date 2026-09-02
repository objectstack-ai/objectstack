---
'@objectstack/spec': patch
---

`sys_license` is now registered in `CLOUD_PROVIDED_OBJECT_NAMES`
(`@objectstack/spec/system`), so `isPlatformProvidedObjectName('sys_license')`
returns `true` and a stack referencing it resolves instead of being flagged.

The object is real and shipping: `@objectstack/service-tenant` declares it in
the cloud repository (`packages/service-tenant/src/objects/sys-license.object.ts`),
alongside `sys_package_installation` and the other four names already on the
list. This repository has cited it repo-wide as the canonical
`tenancy.enabled: false` example — the driver tenant-scope suites, the
platform-global note on `ObjectSchema`, ADR-0066's worked example — while the
registry omitted it, which is exactly the stale-entry failure the registry's
maintenance contract warns about: consumers now trust the list, so a missing
name turns a real cross-reference into a probable-typo warning
(`object-reference-unregistered-platform`) rather than a resolved one.

No accept-set change and no behaviour change for any name already on the list.
