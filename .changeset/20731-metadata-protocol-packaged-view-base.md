---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol): `getPackagedViewBase(name)` answers the view a code package ships, before any overlay (#20731)

`ObjectStackProtocolImplementation` gains `getPackagedViewBase(name)`, the view twin of `getPackagedDashboardBase`. It returns the packaged (code-layer) declaration of a view, which is the `packagedBase` that `translateView` compares a served view against, so that a tenant's published overlay is not overwritten by the packaged translation catalog.

`name` is the view's registry identity, the qualified `<object>.<viewKey>` that each view of a `defineView` container is registered under and that the overlay row and both reads carry. The bare view key that the catalog uses under its object is not an identity (another object may ship a view with the same key), and it answers `undefined`.

It reads the artifact registry's code-package entry only, through the same lookup as `getPackagedDashboardBase`. An overlay that was hydrated under the plain registry key can therefore never be returned as the base it is compared against. It returns `undefined` for a view that no code package ships, for an unknown or empty name, and for a registry that cannot answer. A caller treats `undefined` as "no base known", and the catalog applies as before.

The method is additive. No existing read changes answer, and `getPackagedDashboardBase` answers exactly as before. Nothing is removed or renamed.
