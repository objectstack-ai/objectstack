---
'@objectstack/lint': patch
---

fix(lint): `field-no-consumers` reads a field permission's row condition (`when`) as a read of the fields it names

Clause-②: no
Metadata-protocol: none

- **`@objectstack/lint`:** a field permission's `when` (`permissions[].fields["<object>.<field>"].when`) is a row condition the write gate judges on the stored row before an update and on the incoming row of an insert, so it reads every field it names. `field-no-consumers` now credits those fields as behaviour reads, on the object the entry's key names, the way it already credits a row-level security `using` / `check`. Before, a field that only such a condition read (a lock on `status in ['approved', 'active']`) was reported as having no consumers.
- The field the entry grants on is not credited by the grant: a field named only as a grant target is still reported. An unqualified key (no `<object>.` head) names no object, so its condition credits nothing, as the runtime applies it nowhere.
