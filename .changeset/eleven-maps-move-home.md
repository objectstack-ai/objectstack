---
"@objectstack/spec": minor
"@objectstack/core": patch
---

Restore the #10096 standing invariant (「浏览器可达的 spec 导出面必须
schema-free」) for `@objectstack/core`'s plural→singular store-key fold.

`@objectstack/spec`: the `defineStack()` manifest-collection vocabulary
(`PLURAL_TO_SINGULAR`, `SINGULAR_TO_PLURAL`, `pluralToSingular`,
`singularToPlural`) moved to a schema-free module and is now ALSO exported
from the sanctioned schema-free entry `@objectstack/spec/meta-spelling`
(widened per the #10096 ruling's reference pattern). `@objectstack/spec/shared`
keeps the same four symbols as re-exports — no consumer-visible removal. The
manifest map and `META_URL_TO_SINGULAR` remain deliberately distinct contracts
(#8424).

`@objectstack/core`: `canonicalMetadataServiceType`'s one value import moves
from `@objectstack/spec/shared` to `@objectstack/spec/meta-spelling`, so
browser consumers of `@objectstack/core` (every `@objectstack/client` bundle)
no longer link the zod schema closure through the store-key fold.
