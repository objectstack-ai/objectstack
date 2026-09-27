---
'@objectstack/spec': patch
---

docs(spec): the `organizationId` describes on `GetMetaItemRequestSchema`, `GetMetaItemLayeredRequestSchema` and `GetMetaItemCachedRequestSchema` no longer promise that a supplied organization is always consulted (#16524)

Clause-②: no

Each of the three published `describe()`s opened with "Selects the org partition in the ADR-0005 overlay read order" and closed with an absent-only statement ("Absent = environment-wide read …"). Read together, an integrator completes that as *present ⇒ consulted*, and it is not: on `getMetaItem`, `getMetaItemLayered` and `getMetaItemCached` a supplied organization is dropped for a metadata type that has no per-organization overlay, and the read resolves environment-wide exactly as if none had been sent.

The corrected text takes the same shape as the sibling `GetMetaItemsRequestSchema.organizationId` describe: the parameter selects the org partition **when an org partition applies**, and supplying a value "does not by itself guarantee an org partition is consulted; where none applies, and whenever it is absent, the read is environment-wide". On `GetMetaItemCachedRequestSchema` the ETag sentence ("Also folded into the ETag, so a scope switch never returns a stale 304 from another scope's cached representation") is true and is kept byte-for-byte.

Prose only. No key is added, removed or renamed, no export moves, no accept set changes and no runtime behaviour changes — a supplied `organizationId` is still accepted on all three requests, and the runtime still drops it where no org partition applies. What ships is the JSON-Schema `description` of the existing `organizationId` key on the three requests and the matching rows in the generated API reference.
