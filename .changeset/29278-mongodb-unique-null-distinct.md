---
'@objectstack/driver-mongodb': patch
---

fix(driver-mongodb): a unique field holding `null` in two records is admitted, as on driver-sql and driver-memory

Clause-②: yes (widening)
Metadata-protocol: none

A field-level `unique` index and a declared `indexes[]` entry carrying `unique` were built as `{ unique: true, sparse: true }`. A sparse index skips only documents that lack the field and still indexes an explicit `null`, so the second record whose optional unique field was cleared to `null` was refused with a duplicate-key error. driver-sql and driver-memory treat a `null` in any key part as exempt.

- **The index.** A unique index is now partial over every non-null BSON type (`partialFilterExpression: { FIELD: { $type: [...] } }`, one entry per key part), with no `sparse`. Two `null` values, two missing values, and in a multi-column index any row with a `null` part, are admitted. Every non-null duplicate is still refused with the server's `E11000` duplicate-key error, `''` included.
- **A read index beside it.** MongoDB's planner cannot use a partial index for an equality lookup on the field, so each unique index also gets a plain index over the same keys, named `idx_FIELDS` (the name a declared plain index over those columns already gets). Lookups by a unique field stay indexed.
- **Existing collections are migrated at the next schema sync.** A unique index this driver built before, matched exactly (`unique` and `sparse` over the same keys, no partial filter, under the driver's name for it), is dropped and created again in the new form. The new index constrains fewer documents than the old one, so the rebuild always succeeds on existing data. Any other index holding that name is left alone and the sync answers as before.
