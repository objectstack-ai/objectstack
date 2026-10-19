---
'@objectstack/spec': patch
---

docs(spec): the AI blueprint schema's composed-title example reads the lookup's name one hop through it

The `expression` and `nameField` descriptions on `BlueprintFieldSchema` / `BlueprintObjectSchema` and their strict twins gave `"record.order_no + ' · ' + record.customer"` and `"{order_no} · {customer}"` as a composed title. `customer` is a lookup, so those compose the stored id into the title. They now give `"record.order_no + ' · ' + record.customer.name"` and say that a formula reads a lookup's related record one hop through it, that a second hop is refused, and that a formula title is shown everywhere but cannot be sorted by or searched. No schema shape changes.
