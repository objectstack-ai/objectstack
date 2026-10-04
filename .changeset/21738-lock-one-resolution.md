---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the item reads take an item's ADR-0010 `_lock` from the same resolution the write doors enforce, so the read envelope and the doors agree on the artifact layer too (#21738)

Clause-②: no

The `_lock` gate of the write doors (save, publish, rollback, delete) resolves an item's lock from two layers in order: the packaged artifact's `_lock`, unless it is `'none'`, then the stored `sys_metadata` row's. The two item reads did not use that resolution. `getMetaItem` took the lock from its served document, onto which `mergeArtifactProtection` had copied any declared artifact `_lock`, `'none'` included. `getMetaItemLayered` (`GET /api/v1/meta/:type/:name/layers`) took it from the code layer whenever one existed. Now the gate, both reads' envelopes, the served body's lock fields and the `getMetaDiagnostics` per-type `locked` count all call one resolution, `resolveItemLock`.

**Read answers that change**, on both kernel topologies:

- An artifact that declares `_lock: 'none'` over a stored row that declares a lock (env-wide, or the organization's own row) now reads with the stored row's lock in `getMetaItem` and `getMetaItemLayered`. Under `'full'`, that is `editable: false` and `deletable: false`. The served body's `_lock`, the `getMetaItems` list item's `_lock` and the diagnostics `locked` count say the same. The doors already refused these writes with `403 ITEM_LOCKED`. An artifact's `'none'` declares no lock; it does not override an administrator's stored lock.
- `getMetaItemLayered` for a packaged item whose artifact declares no `_lock`, under a stored row that declares one, now reads the stored row's lock, as `getMetaItem` and the doors already did. Before, it read `lock: 'none'`, `editable: true`.
- `lockReason`, `lockSource` and `lockDocsUrl` are the binding layer's. When no layer binds, they are absent: a reason explains a refusal, and there is none. Before, they were whatever the served document carried, so an explicit `'none'` artifact's reason was reported. For the same reason, an explicit `'none'` artifact's `_lock`, `_lockReason`, `_lockSource` and `_lockDocsUrl` are no longer copied onto a stored row's served body.
- A `_lock` that only a copy the doors never read declares is no longer reported as binding. Examples are a MetadataService copy the dev watcher reloaded after boot, and an item registered at runtime with no package. Such an item now reads as the doors answer it.

**Unchanged.** Every write-door verdict, refusal code and refusal text: the gate still reads the stored row only when the artifact's lock does not bind, so a packaged lock is still answered without a store read. `provenance`, `packageId` and `packageVersion` on both reads, and the artifact's `_packageId`, `_packageVersion` and `_provenance` on served bodies. Which stored row each read serves. The one declared difference between the reads and the gate also stays: the reads still serve a row stored under the type's other (plural) spelling when no canonical row is in scope, and the gate does not read it. No export, accepted input, key or error code changes.
