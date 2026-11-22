---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a seed resolves a lookup that another package adds through `objectExtensions` to the target's id

Clause-②: no
Metadata-protocol: none

A package can add a lookup to another package's object through `objectExtensions`. A seed that set that lookup by the target's natural key (`externalId`) used to store the raw key in the foreign-key column on a boot that loads a compiled artifact (`os dev`, `os serve`, the cloud runtime). The record then linked to nothing, and the console showed "Restricted record". The same seed resolved correctly under the in-process test harness.

The cause was the seed loader's object read. It took the metadata service's copy of the object, which on an artifact boot is the object as its own package wrote it, without the fields an extension adds. Now the loader reads the object as the engine serves it, with its extensions included. It falls back to the metadata service's copy only when the engine has no schema for the object. So a lookup an extension adds is treated exactly like one the owner wrote, in every mode (`upsert`, `ignore`, `update`):

- it adds a dependency, so the target dataset loads first;
- its natural key is resolved to the target's id;
- it waits for the second pass when the target loads later in the same load;
- an unknown key is refused with the same error.

The same read now drives the loader's other per-field decisions for such a field: the required-on-insert check, the tenant column, the replay compare and the undeclared-column warning.

Rows an earlier load stored with the raw key are not rewritten. Run the seed again (in `update` or `upsert` mode) to store the target's id in place of the key.
