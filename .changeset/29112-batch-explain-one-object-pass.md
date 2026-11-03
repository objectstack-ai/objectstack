---
'@objectstack/plugin-security': patch
'@objectstack/rest': patch
---

perf(security): the batch form of `security/explain` runs its object-level pass once, not once per record

Clause-②: no
Metadata-protocol: none

`POST /api/v1/security/explain` with `recordIds` used to run a whole singular explanation for every id, one after another: the caller's admission, the explained principal's context (its grant rows read again), the principal's person row and the nine object-level layers were all redone per id before that id's record verdict was judged. A list page asking for its row menus' update and delete verdicts waited on that repetition.

- **What changed.** The REST door now hands the security service the whole batch. The service settles what no record id reaches once for the batch (the caller's admission, the explained context, the object-level pass) and then judges each distinct id with the record-grained pass alone. The sharing service's read filter, a question about the principal and the object, is also asked once per batch.
- **What did not change.** The answers. The batch is the object-level decision plus `records[i]`, the record verdict the singular explanation of `recordIds[i]` gives: same order, same length, a duplicated id answered at each position, a missing or unreadable record answered as before. A refusal of the object-level question refuses the batch as before.
- **A security service that predates this** answers a batch request with the object-level decision and no `records`; the door then asks each id singularly, as it always did.
