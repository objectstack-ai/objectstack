---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/rest": minor
"@objectstack/runtime": patch
---

feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

- `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
- Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
- REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).
