---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): `getPackagedDashboardBase(name)` answers the dashboard a code package ships, before any overlay (#20680)

`ObjectStackProtocolImplementation` gains `getPackagedDashboardBase(name)`, the dashboard twin of `getPackagedObjectBase`. It returns the packaged (code-layer) declaration of a dashboard, which is the `packagedBase` that `translateDashboard` compares a served dashboard against, so that a tenant's published overlay is not overwritten by the packaged translation catalog.

It reads the artifact registry's code-package entry only. An overlay that was hydrated under the plain registry key can therefore never be returned as the base it is compared against. It returns `undefined` for a dashboard that no code package ships, for an unknown or empty name, and for a registry that cannot answer. A caller treats `undefined` as "no base known", and the catalog applies as before.

The method is additive. No existing read changes answer: the item and list reads already serve a published org overlay by the same identity the write stored (`type`, name, `package_id`, organization). Nothing is removed or renamed.
