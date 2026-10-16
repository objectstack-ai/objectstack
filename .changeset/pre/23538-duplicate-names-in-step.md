---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `duplicatePackage` keeps a copied field's key and `name` in step, and gives a bare object's view item the copied object's `OBJECT.VIEWKEY` name

Clause-②: no

`duplicatePackage` (ADR-0070 D4, the package duplicate route's method) renames every copied object into the target namespace and rewrites the references to it. Three copied names fell out of step with what they name.

**FROM.**

- A field named after a prefixed object, or ending in its name, kept its `fields` key but had its `name` renamed. Duplicating `crm` into `crm2`, the field `crm_customer` of `crm_customer` was copied as `fields.crm_customer.name: 'crm2_customer'`, and `x_crm_customer` as `x_crm2_customer`. The data plane addresses the column by the key. The save door's FLS lint reads the `name`, so a copied permission set with a rule on such a field was refused at the copy with `security-fls-unknown-field`.
- A view item of an object whose name lacks the source prefix kept its name. `ticket.board` was copied under that name with `object: 'crm2_ticket'`, so a by-name read naming no package served the source's item. A view item of an object outside the package that carries the source prefix was renamed while its `object` stayed (`crm_ext.board` became `crm2_ext.board`, bound to `crm_ext`).
- A form action's `target` naming such a view item (`ticket.entry`) kept the source's name, so the copy's button opened the source's form.

**TO.**

- A field's `name` follows its key, and both are kept: `crm_customer` and `x_crm_customer` keep their names. Free text renames an object's name only as a whole identifier, so `x_crm_customer` stays in a description or a view's columns too.
- A view item's name takes its object's copy name and keeps its view key: `ticket.board` becomes `crm2_ticket.board`. An item of an object the copy does not rename keeps its name.
- A value that is a renamed view item's whole name follows it: the action's `target` becomes `crm2_ticket.entry`.

**Unchanged.** Object names, object references and a permission set's `objects` and `fields` keys are renamed as before. The source package is never modified. To bring an earlier copy in step, delete it and duplicate the source again.
