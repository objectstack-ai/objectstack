---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-security': patch
---

**Shipped in 19.0.0-next.0**, whose CHANGELOG missed this entry; listed here one prerelease late.

perf(sharing): a predicate update or delete asks record sharing for the write verdict of all its candidate rows at once, so its store reads no longer grow per row

Clause-②: yes (widening)
Metadata-protocol: none

`ISharingService` (`@objectstack/spec/contracts`) gains two optional members, `checkEditMany(object, recordIds, context)` and `checkDeleteMany(object, recordIds, context)`. Each answers, for every id it is handed and in the same order, the tri-state verdict `checkEdit` / `checkDelete` answer for that id (`allow`, `abstain` or `deny`), with the same bases, the same order and the same verb boundary: an `edit` share answers `allow` to `checkEditMany` and `deny` to `checkDeleteMany`. A chunk whose lookup fails answers `deny` for each of its records, as `checkEdit` answers `deny` for a record whose lookup fails.

`SharingService` (`@objectstack/plugin-sharing`) implements both, and `checkEdit` / `checkDelete` are now the one-record case of the same implementation. A list is read in chunks of 1,000 ids: one read of the chunk's rows and, for an update, one read of the caller's write-level shares on them. The caller's owner set, each queue membership and the Modify All probe are resolved at most once per call. A single record costs the reads it always did, except that an update of a record on an object with an ownership queue column now reads the row once instead of twice.

`SecurityPlugin` (`@objectstack/plugin-security`) asks the set form on a predicate (`multi: true`) update or delete, for the matched rows the platform ownership floor does not already admit, where the kernel's `sharing` service serves it, and asks `checkEdit` / `checkDelete` per row, 25 at a time as before, where it does not. Which rows are written is unchanged either way. Measured on SQLite over 10,000 rows owned by another user: a member's predicate update went from 20,004 store reads and 6.6 s to 24 reads and 0.27 s, the same delete from 10,003 reads to 13, and a Modify All holder's update of all 10,000 rows from 10,004 reads to 14.

Nothing to migrate. An `ISharingService` implementation that does not add the two members keeps working: callers ask it per record, with the same answers.
