---
'@objectstack/service-automation': patch
---

fix(service-automation): no key a flow condition's scope or a dry run's payload is built from reaches a prototype

Clause-②: no
Metadata-protocol: none

The scope a flow's conditions, CEL value envelopes and `{{ }}` text holes read is built so that no variable key reaches a prototype, and the containers the builder creates have none. A variable key with a `__proto__` segment (`__proto__`, `__proto__.x`, `step.__proto__.x`) binds nothing in that scope. A dry run's outbound payload follows the same rule: an authored value-map key with such a segment is not written into the payload, and the payload walk descends through own properties only.

No CEL spelling read such a key before. Two edges nobody relies on do read differently: a head bound only by such a key (`x` in `x.__proto__.y`) is now unbound instead of an empty map; and a stdlib function that stringifies its argument (`trim`, `joinNonEmpty`, a date coercion) now faults on a builder-made container instead of returning placeholder text for it.

**Unchanged.** Every other key, dotted keys included: `step.result` still nests, and `step.result`, `vars.step.result` and `vars["$error"]` read as before. `constructor` and `prototype` stay ordinary keys: a variable named `prototype` is still read as `vars["prototype"]`, and a bare `constructor` and `step.prototype` still read. When a dotted key's head names a value the run holds, its tail is still written into that value. The run's variable map itself is untouched.
