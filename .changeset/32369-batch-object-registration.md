---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a batch metadata writer no longer stores an object the registry refuses and reports it written

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The refusal is the registry's existing INVALID_METADATA for a currency pair it refuses (ADR-0144 D2 and D6), now heard by the batch writers; a stored row boots exactly as before, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the batch metadata writers of `@objectstack/metadata-protocol` (`duplicatePackage`, `importUnmanagedPackage`, `publishPackageDrafts`, `migrateStoredMetadata`) and at the `external-import` save face.

Each batch writer asks the registry about a row's body alone while it writes, because a later row of the same batch can still complete a currency pair (#29673). The registration refusal of a row whose pair the registry refuses was then only logged at the write-through: ADR-0144 D6's roll-up door left the row stored and unregistered, the follow door (a record-mode amount following no code field on its parent, a `record` roll-up over an amount that follows nothing) was never asked, and the batch answered the row copied, imported, published or rewritten.

Each batch now registers its object rows together once they are all written, asks each one the registry's questions that read other objects (D6's roll-up half and the follow door), and answers a refused row in its own shape, with nothing of it left stored as written:

- `duplicatePackage` (`POST /packages/:id/duplicate`): the row moves from `copied[]` to `failed[]` with the registry's refusal, and its copy is taken back (removed, or restored to the copy it overwrote). Was: `copied[]`, `success: true`, the copy stored.
- `importUnmanagedPackage`: the import is refused with the row's `INVALID_METADATA` / 422 and rolled back like any refused write (the base is removed). Was: imported, the row stored.
- `publishPackageDrafts`: the publish is refused with the row as its cause in `failed[]` (the rest `BATCH_ABORTED`) and every promotion is rolled back. A runtime that cannot roll back asks the same question before it promotes any draft, so nothing is promoted; a refusal only the promoted bodies provoke is undone. Was: published, the row live.
- `migrateStoredMetadata` (`os migrate meta --stored`, `POST /meta/_migrate-stored`): the row is reported `failed` with the refusal, and its rewrite is restored to the row the pass read. Was: `rewritten`.
- The `external-import` face (a datasource table imported as an object, REST and MCP) saves one object, so it now asks against the registry like a single save: a refused pair is answered `INVALID_METADATA` / 422 and nothing is stored. Was: stored, answered success.

A row whose pair a later row of the same batch completes still succeeds, and is registered in an order the unit admits, so a roll-up published before the draft that makes its child amount follow the parent is registered, not left unregistered.

What an author does: correct the refused object as the refusal says (name a code field of the parent in `currencyField`'s second segment; declare `currencyMode: 'record'` on a roll-up only over amounts that follow the parent; use `function: 'count'` for a D6 refusal), then run the batch again.

What does not change: the boot, the stored-row hydration and a code package installed or reloaded on a running server (`registerApp`) register every object they registered before, a draft save is judged when it is published, and a pair whose other end is not registered is still no verdict.
