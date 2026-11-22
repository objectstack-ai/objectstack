---
'@objectstack/service-automation': patch
---

fix(service-automation): the scope a flow condition reads keeps every variable key inside the run's own scope object

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moved is which run variable keys the expression scope binds. A flow that read a variable named `constructor` or `prototype` (or a node output key with such a segment) renames it, or reads a record field of that name through its record (`record.prototype`); that is the one-line fix. -->

The scope a flow's conditions, CEL value envelopes and `{{ }}` text holes read is built so that no variable key can write outside the run's own scope object: every container the builder creates has no prototype, and a variable key with a `__proto__`, `constructor` or `prototype` segment (`constructor`, `step.prototype`, `__proto__.x`) binds nothing in that scope.

**BREAKING**: a variable whose key is, or has a dotted segment, `constructor` or `prototype` — a flow variable, an assignment target, a node output key, or a record field flattened into the run — is no longer readable by that key from a condition, a value envelope or a text hole (before, a bare `constructor`, `vars['prototype']` and `step.prototype` read). A reader faults loudly as any unbound name does (`No such key` / `Unknown variable`), raised as the attributed flow failure. Rename the variable, or read a record field through its record (`record.prototype`), which is unchanged. It ships `patch` because no metadata an author writes changes (`Metadata-protocol: none`): every declaration still parses; the run variable map itself is untouched.

**Also fixed.** A variable named `constructor` (or a `step.constructor` output key) no longer makes every `vars.*` (or `step.*`) read fault with `Unsupported type: object`.

**Unchanged.** Every other key, dotted keys included: `step.result` still nests, and `step.result`, `vars.step.result` and `vars["$error"]` read as before.
