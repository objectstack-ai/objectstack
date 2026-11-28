---
'@objectstack/knowledge-turso': patch
---

fix(knowledge-turso): a table the store did not make is never dropped by a rebuild or a source drop, and a foreign `knowledge_generation` makes the store unavailable

Clause-②: no
Metadata-protocol: none

A Turso store that shares its database with object tables (an object's table is named for the object) no longer drops a table it did not make. Before, three places dropped a generation's passage table by the name its generation row gives, without looking at what held that name: `beginBuild` replacing an unfinished build of another fingerprint, `completeBuild` replacing the active generation, and `dropSource`. Each now reads the table's columns first, as opening a generation already did, and drops only one of the store's own passage tables. Any other table under that name is left as it is and the call is refused `SERVICE_UNAVAILABLE` (503), the message naming the table; nothing of the call is removed. Rename or remove that table, or keep the store in a database of its own.

The store's generation table is checked the same way when the store gets ready. A table named `knowledge_generation` whose columns are not the generation table's (before, `CREATE TABLE IF NOT EXISTS` passed over it, and the store's two indexes could be added to it) now makes the store not ready: `healthCheck` answers `ok: false` and every call answers `SERVICE_UNAVAILABLE`, the reason naming the table, which is left untouched.

A store in a database of its own behaves as before: its own tables are dropped by a rebuild and by `dropSource`, and a table of the package's earlier releases is still dropped by the first complete reindex.
