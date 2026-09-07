---
"@objectstack/driver-sql": patch
---

MySQL: a plain unique index over existing duplicate rows no longer takes the boot down when the index has to be carried by a hash shadow.

`syncDeclaredIndexes` handles a declared unique that the database refuses in one `catch`, and that `catch` has two arms: the DIRECT one, and the hash-shadow one MySQL takes when a key part is wider than the 768-char utf8mb4 ceiling. #14902 taught the direct arm that a uniqueness violation over existing rows is a durability degradation rather than a fatal — log it, name the conflicting rows and the remedy, let the boot continue. The shadow arm kept the older guard, which also required a NULL-safe organization key part, so a PLAIN unique (`tenancy: { enabled: false }`, or an explicit `unique: 'global'`) matched neither branch.

Measured on live MySQL 8.0.46: the boot died carrying `ER_BLOB_KEY_WITHOUT_LENGTH` — a refusal about an unkeyable TEXT column, telling the operator to declare a `maxLength` the field already declared — while the real cause was two duplicate rows it never mentioned. It named no rows and no remedy.

The two arms now agree, and they say different things because they mean different things. The NULL-safe arm keeps its wording (existing rows violate the NULL-safe key, duplicating what the previous void constraint admitted); the plain arm gets the direct arm's reviewed sentence, because neither of those clauses is true of a plain unique — nothing admitted the rows, and there is no NULL-safe key. Widening the guard alone would have shipped a factually false durability log, which is worse than the throw it replaces.

`os migrate plan` already reported this operation as `destructive` with the row report and is unchanged.
