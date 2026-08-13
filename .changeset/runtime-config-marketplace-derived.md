---
"@objectstack/cloud-connection": patch
---

fix(cloud-connection): `features.marketplace` is derived from what is mounted, not hardcoded `true` (#8356)

`GET /api/v1/runtime/config` built its response with `marketplace: true` as a
literal, so **every** runtime that mounted `RuntimeConfigPlugin` told the Console
the package catalog was browsable — including runtimes where
`MarketplaceProxyPlugin` was never mounted because no control plane resolved. The
SPA rendered a browse affordance the runtime could not serve. That is the same
declared-is-not-enforced shape as #8343, one key over.

It was a live constraint, not a hypothetical: it is why #8343 mounts install-local
**alone** on a cloud-less runtime and deliberately does not also mount
`RuntimeConfigPlugin` there. Doing so would have restored the Console's knowledge
of install-local at the cost of asserting a browse capability that is definitively
absent — trading the reported bug for its mirror image.

The flag is now **observed** per request, off the route table of the app serving
the response: `true` when a marketplace browse surface is mounted on it, `false`
when none is. `/api/v1/marketplace/install-local` is deliberately excluded — it is
the offline install half, mounted precisely on the runtimes that have no catalog,
and counting it as browse would recreate the defect one key over.

Reading the route table rather than a proxy-specific signal is what makes one
derivation true for every distribution: `MarketplaceProxyPlugin` registers no
service (it announces itself only by mounting its routes), the `IHttpServer`
mount-introspection members exclude framework-native `getRawApp()` mounts by
construction, and the ObjectStack Cloud control plane serves the catalog
**natively** with no proxy at all. The route table is the union that covers all
three.

**What changes for hosts.** A runtime that mounts a marketplace browse surface
reports exactly what it did before. A runtime that mounts none now reports
`marketplace: false` instead of `true` — the correction — and its Console stops
offering catalog browse it cannot serve. A cloud-less runtime can therefore report
`installLocal: true` truthfully without also claiming browse. No config knob was
added: a knob would repeat one layer up the every-host-must-remember failure that
propagated the original defect into the self-hosted EE image, where both the host
config and this package's README kept a hand-maintained flag out of step with
their own mounting.

**Escape hatch, unchanged.** The derivation is the base value, not a veto: the
open-core `resolveFeatures` seam still merges over it, so a host on an adapter
whose raw app exposes no route ledger (where the flag conservatively reports
`false`, with a warning logged at mount time) can still declare the capability it
knows it serves.
