---
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

`security/explain` decides whether a record-grained explanation may say a record exists by the read access of whoever asked for it, not by the explained principal's.

Clause-②: no

- **An asker who cannot read the record** gets, for every operation, exactly the answer an id no row carries gets: `record` is `{ recordId, visible: false }` with no `decidedBy`, and every layer's per-record attribution is the missing record's.
  - An asker explaining another user (`manage_users`, or a delegated administrator's scope) cannot read a record its own by-id read finds no row for, or refuses (a declared 4xx, such as no read grant on the object).
  - A principal explaining itself cannot read a record its own by-id read finds no row for. A refused read does not count, so the explanation shows what that principal's own doors answer: a principal that may edit a record it may not read is told what its edit does.
  - Before, a principal explaining itself a `read` of a row its read finds no row for was told the row's verdict and why, and an administrator with no read grant on the object was told any row's story; the by-id write verbs already answered a self-explanation of such a row as missing.
- **An asker who can read the record** gets the explained principal's full record story. For a `read`, that is the principal's own verdict, decider included, so the `controlled_by_parent` read verdict on the master leg (not visible, decided by the `sharing` layer) is what such an asker is told. For a by-id `update`, `delete` or `transfer` of a row the principal cannot read, the verdict stays `visible: false`, the answer that principal's write gets, and now names the layer that decided the principal's read; each row-scoped layer's `record` carries that read's attribution, prefaced with the write's `404 RECORD_NOT_FOUND`. Before, such an asker was told the missing record's answer.
- A system asker reads every record. The batch form (`recordIds`) answers each id as the singular form does.
- `@objectstack/spec`: the `record` verdict's description and the `recordIds` "Missing records" clause in `explain.zod.ts` now say which ids an asker cannot read, by asker, and that those answer as missing. Description text only; no schema shape changes.
- Nothing you author changes, and no exported type or signature moves. Object-level explanations (no `recordId`) are unchanged.
