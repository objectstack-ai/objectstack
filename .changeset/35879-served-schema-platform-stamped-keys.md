---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the served type schemas no longer offer the keys the platform stamps

Clause-②: no (narrowing — a key leaves a served description; nothing a client could save before is refused)
Metadata-protocol: narrowed

`GET /meta/types` (and the MCP draft door's `contract: true` read of `list_metadata_items`, which answers from it) describes what an author may write for each metadata type. Every type spreads the ADR-0010 protection envelope, so the served JSON Schema listed `_lock`, `_lockReason`, `_lockSource`, `_provenance`, `_packageId`, `_packageVersion` and `_lockDocsUrl` among each type's properties, and again inside every schema embedded in one (an object's field entries, each arm of a view). Studio's panels and an MCP client told to write only the keys the contract shows read those as writable.

They are the platform's to write: a package's loader and the registration stamp them, and an author declares a lock through `protection` in a code package's source. The served schema now leaves them out, at every depth, the same way it already leaves out a retired key's tombstone.

- **What a client sends is unchanged.** The save door refuses and accepts exactly what it did, and the Zod schemas still declare the envelope, so a served body re-parses.
- **What changes is the description only.** A client that built a form or a key list from the served schema no longer shows these seven keys.

Nothing to migrate.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the Zod schemas keep declaring the envelope and the save door is unchanged. What moves is the served JSON Schema description, which stops listing seven keys only the platform writes; there is nothing for a migration to rewrite. -->
