---
'@objectstack/metadata-protocol': patch
---

Remove the four dead `'objects'` spelling tolerances in the metadata protocol's object registry and storage seams.

`applyObjectRegistryMutation`, `applyRegistryWriteThrough`, `ensureObjectStorage` and `dropObjectStorage` each admitted a plural `'objects'` type key, and the first of them *registered under it* — the spelling-tolerant-lookup shape `canonicalMetaType`'s header rejects, and the one that previously let a plural registry entry shadow an entire code-authored listing.

All four are unreachable: every producer folds the type through `PLURAL_TO_SINGULAR` / `canonicalMetaType` before these seams see it. No behaviour changes for any caller that folds — which is all of them. What changes is the failure mode of a future caller that does *not* fold: it no longer silently registers an object under a plural key, so `assertObjectRegistered` fails closed with a loud, recoverable error instead.

Folding at the producer remains the rule; these guards were never a second line of defence.
