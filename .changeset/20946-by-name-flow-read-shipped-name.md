---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the by-name read of a flow name a managed package ships serves the package's flow, as the flow list does (#20946)

Clause-②: no

`flow` is in ADR-0126's Regime C: a managed package's flow is sealed, and there is no overlay read path for it. The flow list, `GET /api/v1/meta/flow`, and the execution view the automation engine binds flows from already serve the package's flow for a name a managed package ships (#20913). The by-name read, `GET /api/v1/meta/flow/:name`, did not: for such a name it served a stored flow of that name, marked as the package's flow. So the two read doors answered two different flows for one name.

The by-name read now applies the same rule the list applies, through the same checks. For a name a managed package ships, it serves the package's flow, with or without a package scope, whatever the stored flow's own package binding or markings say.

The stored flow is not deleted, rewritten or refused. It stays in the store, and the automation engine still reports it as a shadowed definition at startup. Pending drafts, flow names no managed package ships, organization-scoped rows and every other metadata type are read as before.
