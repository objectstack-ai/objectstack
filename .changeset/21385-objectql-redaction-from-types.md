---
'@objectstack/objectql': patch
---

refactor(objectql): the engine takes its driver-fault redaction from `@objectstack/types`

Clause-②: no

The redaction the engine applies to its write-path log lines, at its boundary, at the raw-statement door and in the lifecycle sweep now lives in `@objectstack/types`, so `@objectstack/driver-sql` calls the same cut. The engine calls it as before, with the same arguments, and its answers are unchanged. None of the moved names was exported from `@objectstack/objectql`'s entries, so its public surface does not move.
