---
"@objectstack/service-storage": patch
"@objectstack/spec": patch
---

fix(service-storage): a predicate update writing a file field is refused, instead of giving N records one file id (#7102)

`file-reference-lifecycle.ts` states **exclusive ownership** in its module
header: at most one `(object, record, field)` slot owns a `sys_file`, so
copying an already-owned id into a second slot copies the bytes rather than
sharing the row. The property that buys is that read authorisation for a
file's bytes derives from exactly one parent record — writing a private
record's file id into a world-readable one cannot widen who can read it.

**Before.** A predicate update
(`engine.update(obj, { avatar: 'fileX' }, { multi: true, where: … })`) had one
payload for N matched rows — `driver.updateMany` takes one `SET` clause — so
`beforeUpdate` resolved ONE copy and the driver wrote it to **all** matched
records. `afterUpdate` then claimed it for the first row; `claimFile` never
steals, so the rest logged `already owned by …` and moved on. Three matched
records ended up referencing one file that one of them owned, with read
authorisation for those bytes decided by a third record — exactly the
widening the design exists to prevent. Two log warnings were the only signal,
and nothing failed.

**After.** That write is refused, in `beforeUpdate`, before the driver runs:

```
FILE_FIELD_BULK_WRITE_REFUSED / 400  (FileFieldBulkWriteError)
```

an ADR-0112 envelope error carrying a registered `code` and a 4xx `status`, so
the REST layer answers `400` rather than promoting a bare `Error` to a `500`.
Nothing is written, nothing is copied, and no `sys_file` row is read. The
remedy is the caller's: update each record separately, so each one gets a file
it owns.

**Scope of the refusal.** It fires only when a file **id token** reaches a
file-class field through a predicate update — the one shape that produces the
shared id, decided by `isFileIdToken`, the same arbiter copy-on-claim and the
read resolver already use. Three predicate writes that own nothing are
deliberately unaffected and keep working per row: clearing a file field
(`{ avatar: null }`), writing an external URL, and writing a legacy inline
blob — each releases the file its own row's slot owned. Single-record updates,
inserts and every delete path are byte-identical to before.

`FILE_FIELD_BULK_WRITE_REFUSED` is registered in `@objectstack/spec`'s
`ERROR_CODE_LEDGER` under `@objectstack/service-storage` (ADR-0112 D3), so the
code is a catalogued wire value rather than an unregistered string the REST
layer would mint by side effect.
