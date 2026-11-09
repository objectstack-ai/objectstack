---
'@objectstack/objectql': patch
---

fix(objectql): a by-id delete the driver answers as removing nothing leaves no recycle-bin entry

Clause-②: no
Metadata-protocol: none

The recycle bin writes its entry before the record's row is removed, so a bin that cannot take the entry refuses the delete before anything goes. When the driver then answers that it removed nothing (`false`, or a count of `0`: the row was already gone, filtered out, or lost a race), the entry used to stay, naming a record that is still live. Admins saw it in the recycle-bin list, and a restore of it was refused `409 RESTORE_UNIQUE_VALUE_TAKEN`, until the retention sweep reaped it. The engine now removes that entry in the same unit of work, inside the delete's transaction when one covers the bin, so the recycle-bin list no longer shows such entries. A delete the driver confirms still writes exactly one entry, its `recycleBinEntryId` answer is unchanged, and the snapshot, restore and purge are untouched. If the entry cannot be removed, the engine logs it once at `error` and the delete's answer stays the same.
