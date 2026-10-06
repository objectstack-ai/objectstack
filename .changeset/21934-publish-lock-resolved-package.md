---
'@objectstack/metadata-protocol': patch
---

A metadata publish consults the item lock at the package key it resolved

- A publish that states no package promotes the draft row it resolves, under that row's own package. Its ADR-0010 lock lookup now uses that same resolved key (the stated package, else the draft row's own), the key the gate reads the draft under and the promotion writes under, instead of only the package the request stated. Where several packages' rows declare the strictest lock, the refusal now carries the lock of the package whose draft is being promoted.
- The authoring gate's package narrowing is unchanged: it still uses only the package the caller stated.
