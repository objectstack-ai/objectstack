---
'@objectstack/spec': patch
'@objectstack/cloud-connection': patch
'@objectstack/service-push': patch
---

fix(cloud-connection): name the `cloud-binding` service once, in its contract, and read an empty `controlPlaneUrl` one way

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/spec/contracts` now exports `CLOUD_BINDING_SERVICE` (`'cloud-binding'`) beside `ICloudBindingService`, the way the sibling contracts export their service names. `@objectstack/cloud-connection` registers the binding under it and `@objectstack/service-push`'s relay sender reads it, so the registrar and the reader can no longer spell the name two ways. `@objectstack/service-push` keeps exporting `CLOUD_BINDING_SERVICE`, now a re-export of the contract's constant with the same value.

`CloudConnectionPlugin`'s routes now take their control-plane URL from the `cloud-binding` service they register, so the routes and the binding read the `controlPlaneUrl` option the same way:

- An explicit empty (or blank) `controlPlaneUrl` means "cloud not configured" for both: the routes answer `CLOUD_UNCONFIGURED` as before, and `controlPlaneUrl()` now answers `''` instead of the production default.
- A declined `OS_CLOUD_URL` (`off`, `none`, `local`, `disabled`) under an absent option is "cloud not configured" for the routes too, as it already was for the binding.
- An absent option falls through to `OS_CLOUD_URL`, then the ObjectStack-operated default, for the routes too, as it already did for the binding and for the marketplace plugins.

`objectstack serve` and the showcase app are unchanged: they compose the plugin only with `resolveCloudUrl()`'s non-empty answer, which both readings return as is.
