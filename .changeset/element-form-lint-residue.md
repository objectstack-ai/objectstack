---
"@objectstack/lint": patch
---

fix(lint): drop the `element:form` entry from `COMPONENT_FIELD_SPECS` (#9249)

The whole `element:form` element retired at element grain (ADR-0049 — no
renderer ever shipped for it; the #9220 shape one element over), so every
`ElementFormProps` key is a `retiredKey()` tombstone and no spec-conformant
page carries `fields` on it. The field-binding rule's job (resolve a field
NAME against the object) is not the question a retired key raises: an authored
key is already reported by name with the element-retirement prescription —
which names the live replacement, the object-bound `object-form` block —
through the #5068 props gate, and the binding entry would only add a second
finding about a key that no longer exists — the #5775/#6629 residue class the
package's own `component-field-specs-liveness` gate refuses.
