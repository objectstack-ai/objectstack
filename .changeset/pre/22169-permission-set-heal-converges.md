---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the boot heal of drifted `sys_permission_set` rows converges on duplicated names, stops paying a discarded metadata read per row, and a refused existence read no longer inserts a duplicate (#22169)

Clause-②: no

**The heal writes the row it read, by its id.** `reconcilePermissionSetProjection` heals every overlay-less, env-authored record that drifted from its metadata definition. It used to hand each drifted record to a by-name upsert, which re-read the first record of that name (lowest id). On a table holding more than one record per name, only that one was ever written: every other record was logged "re-projected" and left drifted, on every boot. Now each drifted record is updated by its own id, facets only (label, description and the permission columns; identity, `active` and provenance are never touched). The drift line is logged after the write and names the record's id; a refused write is logged as refused instead of as re-projected. On a real engine with 8 names × 3 records, the boot after the healing one went from 116 statements and 16 drift warnings to 4 statements and none.

**The layered metadata read is lazy, once per name.** The heal awaited `getMetaItemLayered` (four statements on the protocol) for every candidate record before deciding whether it needed it, and it does not need it while a `SchemaRegistry` is readable. It is now read only when no registry answers, and once per name per pass.

**A refused existence read declines the insert.** `bootstrapPlatformAdmin` reads each default permission set by name and inserts when it finds none. A refused read answered as "none", so on a table without the per-organization unique index the boot inserted a second record of a set that already existed. A refused read now inserts nothing, and the pass says so once, naming the sets. When `admin_full_access` is one of them, the promotion half reports `admin_permission_set_unreadable` instead of `admin_permission_set_missing`.

**Unchanged.** Existing duplicate records are healed, never deleted: removing them is an operator repair. The live single-mutation projection keeps its per-item read.
