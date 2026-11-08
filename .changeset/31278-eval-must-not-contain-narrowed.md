---
'@objectstack/skills': patch
---

fix(skills): eval cases no longer forbid a string their own reference answer writes

Clause-②: no
Metadata-protocol: none

A `must_not_contain` assertion fails an answer that contains the string anywhere, including a sentence naming it as the form to avoid. Fourteen eval cases across `objectstack-api`, `objectstack-data`, `objectstack-query`, `objectstack-ui`, `objectstack-upgrade` and `objectui` forbade a string their own `expected_output` uses, so an answer written like the reference answer failed. Each entry is now the shape a wrong answer writes: a key with its colon (`fuzzy:`, `valueField:`, `submitLabel:`, `$or:`), a call with its paren (`definePage(`), a quoted literal (`'http.server'`, `type: 'many_to_many'`), the inline object form (`{ type: 'password'`, `slots: { tabs`, `distinct: true,` / `distinct: true }`), the path a request writes (`object?ids=`), the operator followed by its operand (`?? `), and the quoted `"props": {` envelope for `objectui`'s `props.value` / `props.label`. No skill text changes.
