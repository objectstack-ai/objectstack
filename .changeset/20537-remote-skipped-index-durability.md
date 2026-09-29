---
'@objectstack/driver-turso': patch
---

fix(driver-turso): a declared index the remote face skips because a key column never materializes is logged at `error`, not `warn`

Clause-②: no

In remote mode (a `libsql://` URL), schema sync skips a declared index whose key column is not
a stored column: a name that is not a field of the object (a misspelling), or a virtual
`formula` field, which is computed on read and has no column. The skip itself is unchanged, since
DDL naming a missing column would fail the whole sync. It used to be reported through the
driver's `warn` diagnostics, so a skipped UNIQUE index left duplicates accepted while the log
said `warn`.

The skip is now logged at `error`, on the same channel the remote face already uses for a
declared index it could not create, and the local face uses for the same skip. There is one
line per skipped index per sync. It names the object, the index and the missing column, says
whether the index was UNIQUE, states what is not enforced (duplicates for a UNIQUE index, a full
table scan for a plain one), and says how to fix it: make every key column a stored field of
the object, or remove the index.

No DDL, accept set or refusal changes: the same indexes are created and the same ones are
skipped.
