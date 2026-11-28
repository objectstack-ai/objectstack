---
'@objectstack/service-knowledge': patch
'@objectstack/metadata-core': patch
---

fix(service-knowledge): a package duplicate that the knowledge service itself refuses is told the source cannot be copied and to duplicate the package again

Clause-②: yes (widening) — `@objectstack/service-knowledge`'s `KnowledgeService.admitAuthoredSource` takes an optional third input `options: { door?: 'save' | 'duplicate' }`; `@objectstack/metadata-core`'s `KnowledgeSourceSaveAdmitter.admitAuthoredSource` declares the same optional `options` input
Metadata-protocol: none

- **`@objectstack/service-knowledge`.** `admitAuthoredSource(item, ctx, { door: 'duplicate' })` words every verdict for the package duplicate's caller: the source "cannot be copied", a verdict that could not be judged ends "Duplicate the package again.", and a field the caller may not query is fixed by removing it and duplicating the package again, or by someone who may query it duplicating the package. It never says "save the source" or "Nothing was written". The status, code, object and field are the same as at a save. With no `door`, or `door: 'save'`, every sentence is byte-identical to before.
- **`@objectstack/metadata-core`.** `authoredKnowledgeSourceRefusal({ door: 'duplicate' })` hands the door on to the knowledge service's `admitAuthoredSource`, so the package duplicate's refusal says once, in its prefix, that nothing was copied. A save hands on no door: the service is asked with the item and the context alone, as before.
