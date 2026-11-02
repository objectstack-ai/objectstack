---
'@objectstack/objectql': patch
---

fix(objectql): a read answers a selected declared column the driver did not return as `null`, so one record reads the same on every driver (#29408)

Clause-②: no — nothing a request may send is refused or newly admitted; measured on base and head, every read returns the same rows and the same values, and only a record body gains a `null` key for a stored declared column the read selected and the driver returned no key for.
Metadata-protocol: none

- **Before.** driver-sql answered a declared field that was never written as `null` (its table has the column), while driver-mongodb and driver-memory answered no key at all (they store only the columns a write touched). The same record read `{ title: 'x', note: null }` on SQL and `{ title: 'x' }` on mongo or memory.
- **Now.** The engine answers every stored declared column the read selected as `null` when the driver returned no key for it, in `find` and `findOne`, so every door on them (`GET /data/:object/:id`, the list route and `POST /data/:object/query`, export, search, `expand` sub-reads, a hook's or a flow's in-process read) answers alike on every driver. Selected means the whole declared record when the read names no `fields`, else the declared columns its `fields` name.
- **Still absent.** A column the read's `fields` do not name; a column field-level security refuses the caller (the security mask still deletes it); a `formula` field ahead of its formula (it keeps its computed value); a name outside the declared set; and an injected platform column a federated (`external`) object has no storage for.
- **Who sees it.** A client of an object served by driver-mongodb or driver-memory whose records have unwritten declared fields. Such a field now arrives as a key holding `null` instead of a missing key: a client-side `has(record.x)` is now `true` for it, as it already was on SQL, so test emptiness with `record.x != null`. A write's stored row is unchanged; the record a write answers (insert or update echo) is unchanged.
