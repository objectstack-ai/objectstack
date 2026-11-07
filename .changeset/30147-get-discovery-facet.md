---
'@objectstack/metadata-protocol': patch
---

refactor(metadata-protocol): `getDiscovery` hands its body to its facet

Clause-②: no
Metadata-protocol: none

- `ObjectStackProtocolImplementation#getDiscovery` keeps its signature and return type on the class and delegates in one line to `ProtocolDiscoveryAndBasesFacet.getDiscovery`, which holds the body, moved unchanged except for the search probe: the class reads `this.searchAll` on the instance and hands it in, so `capabilities.search` still answers whether this protocol instance serves search. No behaviour changes and nothing to do on upgrade.
- The published `index.d.ts` and `index.d.cts` carry the same public surface.
