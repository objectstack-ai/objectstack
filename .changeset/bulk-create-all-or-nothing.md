---
"@objectstack/driver-memory": patch
---

fix(driver-memory): `bulkCreate` refuses before writing, so a rejected batch leaves no surviving prefix (#13340)

`InMemoryDriver.bulkCreate` was `Promise.all(dataArray.map(data => this.create(...)))`, and
`create` writes into the table synchronously. So a batch was **not atomic**: when any row was
refused, every row accepted *before* it stayed in the store, and the caller got a rejection
describing a batch that had partly landed. Measured on a two-row table, a refused two-row
batch left **three** rows behind, which made retrying the same array unsafe for reasons that
had nothing to do with constraints.

`bulkCreate` now builds and checks every row — against the table **and against the rest of
the batch** — before pushing any of them. That is the posture `updateMany` has had since
#13197, one method over, and the one `driver-sql` gets from sending a batch as a single
insert; the two batch doors of this driver no longer give opposite answers to "is a batch
atomic?".

`create`'s own single-row path is unchanged, and this does not give the store a primary key:
an undeclared duplicate `id` is still not a constraint violation, so such a batch still lands
in full.
