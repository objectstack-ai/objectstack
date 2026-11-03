---
"@objectstack/objectql": patch
---

refactor(objectql): the registration door's `_packageId` refusal calls the shared spec judge

`collectionItemOwnerStampRefusal` now asks `judgeCollectionItemOwnerStamp` (`@objectstack/spec/kernel`) for the verdict and the words, the judge the stack schema runs at `defineStack`, `os validate` and `os build`, so the build door and the boot cannot disagree. Its `VALIDATION_ERROR` / 400 envelope with `issues[]` at `_packageId`, its words, and its exemption for a stamp a registration of this process wrote onto the caller's object are unchanged.

Clause-②: no (narrowing) — carried by `@objectstack/spec`'s `minor` in the same change: the build doors now refuse the body `_packageId` this door already refused. This package's own accept set is unchanged. Nothing is widened.

Metadata-protocol: narrowed (a collection item's `_packageId` is refused at the build doors as it already was at registration)

<!-- adr-0087: not-required (no-migration-prescription) This package changes no key, value or verdict: the registration door refuses exactly what it refused before, in the same words. The narrowing it travels with is the build doors', declared on `@objectstack/spec`. -->

**BREAKING** accept-set narrowing at the build doors, declared on `@objectstack/spec`'s `minor`; this `patch` carries the shared judge's caller only.

- **Before.** The registration door compared a body's `_packageId` with the registering package itself.
- **Now.** It calls the spec judge, which also runs at the build doors.
- **Unchanged.** Every verdict and every word at `registerApp`, the seed datasets, the `viewItems:` channel and the `manifest` service's residual registration.
- **Who sees it.** Nobody at this door; an author now hears the same refusal at `os validate`.

**The remedy.** Drop `_packageId` from the body.
