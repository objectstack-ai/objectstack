---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `duplicatePackage` points a copied permission set's field-level rules at the copied objects

Clause-②: no

`duplicatePackage` (ADR-0070 D4, the package duplicate route's method) renames every copied object into the target namespace and rewrites the references to it. A permission set's field-level rules are a map keyed `<object>.<field>` (`PermissionSetSchema.fields`), and the security plugin applies an entry to the object its key names.

**FROM.** A copied permission set kept the source's `fields` keys: `crm_customer.full_name` stayed `crm_customer.full_name`, and `ticket.title` (an object whose name lacks the source prefix, copied as `crm2_ticket`) stayed `ticket.title`. The copy's `objects` map already named the copied objects, so the copied set granted access to the duplicate's objects while its field rules applied to the source's objects. A field the source set hides or locks was readable and editable on the duplicate's object for whoever held the copied set.

**TO.** In a copied set's `fields`, a key's object part takes the copied object's name: `crm_customer.full_name` → `crm2_customer.full_name`, `ticket.title` → `crm2_ticket.title`. The object part is everything before the key's first `.`, and it is rewritten only when it is exactly the name of an object the copy renamed. The field part is left as stored, even when it spells an object's name (`ticket.ticket` → `crm2_ticket.ticket`). A key naming an object outside the package keeps its name. If a rewritten key equals a key the set already holds (the source set also has a rule for an object, outside the package, named like the copy), the set is listed in `failed[]` with both keys, and nothing is written for it, because keeping either rule would drop the other.

**Unchanged.** The source set, the copied set's `objects` map, and every other copied item are unchanged.
