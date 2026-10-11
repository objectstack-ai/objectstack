---
'@objectstack/plugin-security': patch
---

`security/explain`'s record-grained `read` verdict for a `controlled_by_parent` record now equals the read door's answer on the master leg (ADR-0055).

- **What changed.** The read door scopes such a record by its master as well as by its own row-level security. explain's read branch modelled the record's own row-level security only. It now asks the read door's own by-id read, with the context it is explaining, wherever every other leg of the read's row story admits the record. A record the door does not return is reported not visible, decided by the `sharing` layer, to an asker who can read that record; a principal explaining itself a record it cannot read is told what an id no row carries is told. A record the door returns is reported exactly as before. A rejection of that read is reported fail-closed, as a dependency that throws already is. An `export` explanation, which streams the same find, answers the same way.
- **What is unchanged.** Every object that is not `controlled_by_parent`. Object-level reports (no `recordId`). The `allowed` field. Every write verb. The answer for an id no row carries. The `ExplainEngineDeps` type: the `recordAbsentToCaller` dependency keeps its signature and is now asked for such a read too.
