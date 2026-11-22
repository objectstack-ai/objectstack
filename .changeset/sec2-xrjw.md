---
'@objectstack/service-automation': patch
---

fix(service-automation): the scope a flow condition reads keeps every variable key inside the run's own scope object

Clause-②: no
Metadata-protocol: none

The scope a flow's conditions, CEL value envelopes and `{{ }}` text holes read is built so that no variable key can write outside the run's own scope object: every container the builder creates has no prototype, and a variable key with a `__proto__` segment (`__proto__`, `__proto__.x`, `step.__proto__.x`) binds nothing in that scope. No CEL spelling read such a key before, so no expression that evaluated reads differently.

**Unchanged.** Every other key, dotted keys included: `step.result` still nests, and `step.result`, `vars.step.result` and `vars["$error"]` read as before. `constructor` and `prototype` stay ordinary keys: a variable named `prototype` is still read as `vars["prototype"]`, a bare `constructor` and `step.prototype` still read. The run's variable map itself is untouched.
