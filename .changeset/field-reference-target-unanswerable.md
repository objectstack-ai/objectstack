---
"@objectstack/metadata-protocol": patch
---

Refuse `GET /api/v1/meta/field/<object>.<field>/references` instead of clearing it for deletion

A `field` metadata item is addressed by the composite key `<object>.<field>` (e.g. `account.owner`), but every metadata property that names a field holds the **bare** field name — `view.list.columns[].field`, `dataset.dimensions[].field`, `object.validations[].field`, `object.fields{}` and 150 further non-recursive paths across nine source types. The two sides are drawn from disjoint vocabularies, so the reference scan answered `{ references: [] }` for every field, on every deployment, regardless of real usage.

The admin "Used by" panel renders that empty answer verbatim as *"Nothing in the metadata graph points at this item. Safe to delete."* — an unanswerable question shown as a positive clearance, on the screen where someone decides to delete.

`findReferencesToMeta` now refuses a `field` target with `501 NOT_IMPLEMENTED` in the ADR-0112 envelope, carrying the answerable alternative (`GET /api/v1/meta/object/<object>/references`). Per ADR-0110 D3, a miss and a fault are different facts. Nothing is added to the success response, and no new error code is introduced — this is the same code the route already returns when the protocol cannot compute the graph at all.

Every other target type is unaffected: a genuine "nothing points at this item" still answers `{ references: [] }`.
