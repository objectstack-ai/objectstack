---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a stored flow under a name a managed package ships is no longer registered or listed as the package's flow (#20913)

Clause-②: no

`flow` is in ADR-0126's Regime C: a managed package's flow is sealed, and there is no overlay read path for it. Two places still treated a stored flow of a shipped name as an overlay of the package's flow:

- The startup hydration registered the stored flow carrying the package's provenance, so the automation engine could not tell it apart from the package's own flow. It is now registered as the tenant-authored row it is.
- The flattened flow list served the stored flow in the package's place, marked as the package's. That list is `GET /api/v1/meta/flow` and the execution view the automation engine binds flows from. For a name a managed package ships, the list now serves the package's flow.

The stored flow is not deleted, rewritten or refused. It stays in the store, and the automation engine reports it as a shadowed definition at startup. Every other metadata type, and every flow name no managed package ships, is listed as before. The by-name read, `GET /api/v1/meta/flow/:name`, is not changed.
