---
"@objectstack/rest": patch
---

`GET /api/v1/meta/:type/:name/references`: both of the door's 501 refusals now answer the same ADR-0112 nested envelope, and the unanswerable-target refusal keeps the prescriptive message ADR-0110 D3 requires of it.

The route can refuse in two ways, and the two answers agreed on neither the envelope nor the message:

```
A  the protocol cannot answer for this TARGET type (a `field`)
   501 {"error":"Internal server error","code":"NOT_IMPLEMENTED"}
B  the resolved kernel has no `findReferencesToMeta` at all
   501 {"error":{"code":"NOT_IMPLEMENTED","message":"protocol.findReferencesToMeta() is not available in this kernel"}}
```

A now answers in B's shape, carrying the producer's own sentence:

```
501 {"error":{"code":"NOT_IMPLEMENTED","message":"[unanswerable_target] References to a 'field' item cannot be computed. … Ask the owning object instead: GET /api/v1/meta/object/account/references."}}
```

Why the message matters more than it looks. This door backs the admin "Used by" panel, whose empty case renders "Nothing in the metadata graph points at this item. Safe to delete." to an operator whose next click is a delete. A `field` target can never MATCH a reference site — fields are addressed by the composite `<object>.<field>` key while every property naming one holds the bare name — so the protocol refuses instead of answering an empty list, and its message names the question that IS answerable: ask the owning object. Relayed as "Internal server error", that instruction never reached the operator.

Two consequences for a caller:

- `body.error.code` now reads `NOT_IMPLEMENTED` on **both** refusals; the top-level sibling `body.code` this route used to answer on refusal A is gone. `@objectstack/client` reads either position, so `err.code` is unchanged for SDK callers; `err.message` improves from `Internal server error` to the prescriptive sentence. A raw HTTP caller branching on `body.code` for this route's 501 should read `body.error.code`, which is what the route's other refusal has always answered.
- Nothing else on the door moves. A genuine server fault reaching this route — the 503 a `sys_metadata` outage raises — keeps its withheld generic message and its flat body, and 200 answers are untouched.
