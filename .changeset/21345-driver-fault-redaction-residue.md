---
'@objectstack/objectql': patch
---

fix(objectql): a raw statement's driver fault, and a lifecycle sweep's direct-driver fault, no longer carry the statement or the caller's values

Clause-②: no

Two paths the engine-boundary cut did not reach now take it.

- **`ObjectQL.execute`.** The cut ran on a driver error's message only when the shared leak predicate recognised a statement in it, and the predicate recognises four leading verbs. A raw statement opening with any other word, such as a common-table-expression form or a dialect's own upsert or merge verb, kept the statement and the bound values on the declared fault's `cause` (its `message` and `stack`), where any logger that prints an error's cause chain wrote them out. The door now tells the cut that it sent a statement, so the cut runs whatever word the statement opens with. The predicate's list is unchanged.
- **The lifecycle sweep.** The Archiver copies rows to the cold store and deletes them from the hot store through the drivers directly, not through an engine door. A driver fault there, such as a cold write the archive store refused, put the archived row's values into the sweep's warning line and its `report.errors` entry. The sweep now cuts the fault the same way before it reports or logs it.
- **What stays.** The error's class, `code`, `status` and the database's own diagnostic, on the fault and on its `cause`. A raw statement opening with one of the four recognised verbs is cut exactly as before. A sweep failure that is not a driver error is reported word for word as before.
- **What changes for a caller.** Code that read the statement or a value out of a raw statement's fault, or out of a lifecycle sweep's error entry, now gets a `[statement and bound values redacted]` marker followed by the diagnostic. Branch on the error's class and `code` instead.
