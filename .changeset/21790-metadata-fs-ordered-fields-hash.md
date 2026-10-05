---
'@objectstack/metadata-fs': patch
---

`FileSystemRepository` hashes each item as its metadata type, so a reorder of an object's `fields` is a change (#21790). A reordered object is written, and an external edit that only reorders `fields` is reported as an update.

Clause-②: yes

Event-log entries written before this release carry the order-blind hash. For an object whose `fields` are not in sorted key order, `get()` and `list()` no longer find that entry until the item next changes. They fall back to the defaults: no parent hash, sequence `0`, the filesystem actor, and the epoch timestamp. The body and the version hash are unaffected.
