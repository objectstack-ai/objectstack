---
"@objectstack/cli": patch
---

fix(cli): an `OS_CLOUD_URL=off` runtime now serves `/api/v1/runtime/config`, so its working install-local route is discoverable (#8389)

#8343 stopped `OS_CLOUD_URL=off` from unmounting
`/api/v1/marketplace/install-local`, but mounted it **alone**: the offline arm of
`serve`'s marketplace wiring shipped no `RuntimeConfigPlugin`, so an air-gapped
box served **no** `/api/v1/runtime/config` at all. From the Console's side that
is indistinguishable from "the feature does not exist" — it cannot learn the
route is there, and renders no install affordance for a capability that works.
The self-hosted EE deployment that #8343 was filed against ended up with a
working offline install endpoint and no UI able to reach it.

The omission was forced, not careless. `RuntimeConfigPlugin` hardcoded
`features.marketplace: true`, so reporting install-local truthfully would have
asserted a browse capability definitively absent on a proxy-less runtime —
trading the reported bug for its mirror image. #8356 removed that constraint by
deriving `features.marketplace` from the route table of the app serving the
response, which is what unblocks this mount.

**What changes for hosts.** A runtime booted with `OS_CLOUD_URL` set to a disable
sentinel (`off` / `none` / `local` / `disabled`) now also mounts
`RuntimeConfigPlugin`, and serves `/api/v1/runtime/config` reporting
`installLocal: true` **and** `marketplace: false` — the install affordance
appears, catalog browse does not. Nothing new dials out: the mount reports this
origin (`controlPlaneUrl: ''`), and the browse flag is an observation of what is
mounted, not a declaration. Runtimes with a resolved cloud URL, and the cloud
distribution's own host kernel, are untouched.

**A host that wires its own keeps it.** The mount is guarded by the same
presence check the neighbouring install-local mount already carries: `kernel.use`
keys plugins by name, so an unguarded mount would not double-mount but *replace*
a host's own `RuntimeConfigPlugin` — silently dropping the branding and the
`resolveFeatures` distribution policy it was constructed with. The two offline
guards are independent, so a host that provides only one of the two surfaces
still gets the other.
