---
"@objectstack/connector-openapi": patch
---

Clause-②: no
Metadata-protocol: none

fix(connector-openapi): send each parameter by its declared `style` / `explode`

A query, path or header parameter value was passed through `String()`, so an object went out as `[object Object]`
and an array as a comma list whatever the OpenAPI document declared — Stripe's `created: { gte: 1700000000 }`
(`style: deepObject`) was sent as `created=[object Object]` and the run answered 200. Each value is now encoded by its
Parameter Object's `style` / `explode`, or by the OpenAPI 3.x default for its location when it declares none (`form`,
exploded, for query; `simple` for path and header): `deepObject` → `created[gte]=1700000000`, an exploded `form`
array → `id=a&id=b`, plus `spaceDelimited`, `pipeDelimited`, `label` and `matrix`. `deepObject` on an array brackets
each index (`expand[0]=a&expand[1]=b`). Scalar values are sent byte-for-byte as before.

Two new refusals, both loud: an operation whose parameter declares a `style` OpenAPI 3.x does not define for its
location (`deepObject` on a path parameter, `form` on a header), or a non-boolean `explode`, fails materialization
naming the operation and parameter — correct the document, or leave the operation out of `include`; and an input
value the declared style has no encoding for (an array of objects for `form`, an object for a `content`-typed
parameter) fails the dispatch before anything is sent. `OpenApiParameter` gains the optional `style`, `explode` and
`content` fields.
