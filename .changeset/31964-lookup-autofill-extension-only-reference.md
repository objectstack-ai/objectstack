---
'@objectstack/spec': patch
---

fix(spec): a `lookupAutofill` source on an object the stack knows only through an `objectExtensions` entry is no longer refused by `defineStack` / `os validate`

Clause-②: yes (widening)
Metadata-protocol: none

- **Before.** The stack's `lookupAutofill` cross-check merged `objectExtensions` into the objects it resolves by `extend`, so a lookup whose `reference` the stack does not declare but does extend had its pair's `source` judged against the extension's fields alone. A source the owning package declares (`list_price` on a `crm_product` another package owns) failed `defineStack` with "is not a field of 'crm_product'", although a pick fills it at runtime.
- **Now.** A referenced object the stack knows only through an extension is not judged, the same as one the stack does not mention at all. An object the stack declares and also extends is still judged against its declared fields plus the extension's, so an undeclared, `internal` or type-mismatched source there keeps its refusal.
- **One map.** The `lookupAutofill` check and the record-currency path check now build their field map and their set of declared objects through one shared helper, so the two cannot drift apart again.
