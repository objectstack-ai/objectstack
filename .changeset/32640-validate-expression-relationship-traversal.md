---
'@objectstack/mcp': patch
---

fix(mcp): `validate_expression` refuses a relationship read both through a reference and as a plain value, as the publish gate does

Clause-②: no
Metadata-protocol: none

At `site: 'validation'` and `site: 'formula'` the tool now runs the shared validator with the same relationship-traversal checks the save/publish gate runs at a validation rule's condition and a formula field's `expression`, the two places the engine loads one relationship hop. An expression such as `has(record.balance) && record.days > record.balance.remaining`, where `balance` is a lookup, used to answer `ok: true` and then be refused at publish (`expression-invalid`); the tool now refuses it with the gate's own sentence and code `traversal-bare-and-traversed`, and a read through more than one hop with `traversal-multi-hop`. `flow_condition` and `template` are unchanged: nothing loads a hop there, and the gate does not run these checks there either.
