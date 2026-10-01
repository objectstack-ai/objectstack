---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the layered read of a flow name a managed package ships reports the package's flow as the effective layer, as the by-name read and the flow list do (#21002)

Clause-②: no

`flow` is in ADR-0126's Regime C: a managed package's flow is sealed, and there is no overlay read path for it. The flow list, `GET /api/v1/meta/flow`, and the by-name read, `GET /api/v1/meta/flow/:name`, already serve the package's flow for a name a managed package ships (#20913, #20946). The layered read, `GET /api/v1/meta/flow/:name/layers`, did not: for such a name it reported a stored flow of that name as the effective layer, while its lock and provenance flags named the package. So the layered read and the other two read doors answered two different flows for one name.

The layered read now decides the effective layer with the same check the other two doors use. For a name a managed package ships, the effective layer is the package's flow, with or without a package scope, whatever the stored flow's own package binding or markings say. The stored flow is still reported, as a separate layer of its own scope that does not take effect. The deprecated layers flag on the by-name read answers the same.

The stored flow is not deleted, rewritten or refused. Flow names no managed package ships, organization-scoped rows and every other metadata type are read as before.
