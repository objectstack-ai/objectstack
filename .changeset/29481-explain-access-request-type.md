---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `SecurityPlugin#explainAccessForCaller` takes the contract's `ExplainAccessRequest`, so a typed caller passes `recordIds` without a cast

Clause-②: no
Metadata-protocol: none

The method's request was declared inline as `{ object; operation; userId?; recordId? }`, while the body it delegates to already honours the batch form `recordIds` and the published `ExplainAccessRequest` (`@objectstack/spec/contracts`) declares it. The parameter is now typed as that contract interface, so the declared type carries every member the method honours and follows the contract from here on. Type-only: no runtime behaviour changes.
