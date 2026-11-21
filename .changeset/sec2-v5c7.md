---
'@objectstack/objectql': patch
---

fix(objectql): a state machine judges every write from the stored state, a clear included

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: what moved is that the engine judges a write clearing a state_machine field against the machine's transitions. A state meant to be clearable lists the empty value among its targets; that is the one-line fix, and it is in the refusal's from/to pair. -->

A `state_machine` validation judges an update from the record's stored state, and clearing the state field — writing `null` or `''` — is now a transition like any other: a transition to the empty value. So no sequence of writes leaves a state the machine would refuse to leave in one write.

**BREAKING**: on an update, clearing the state field of a record whose stored state has a key in `transitions` is refused unless that state lists `''` among its targets. The refusal is the existing transition refusal — `VALIDATION_FAILED` / 400 with field code `invalid_transition` and `constraint: { from, to: '' }` — on every write path (by id, multi-row, REST, MCP), for every caller, elevated ones included. Before, such a clear was not judged. To keep a state clearable, add `''` to its targets, e.g. `paused: ['open', '']`. It ships `patch` because no metadata an author writes changes (`Metadata-protocol: none`): every existing declaration parses and means what its `transitions` say; the write that now meets the declared graph is a runtime write.

**Unchanged.** A write that does not touch the state field, an unchanged value, a declared transition, a stored state with no key in `transitions` (still lenient), inserts and their `initialStates` check, and seed and historical-import writes (still exempt).
