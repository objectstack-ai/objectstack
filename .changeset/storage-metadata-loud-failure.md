---
"@objectstack/service-storage": major
---

fix(service-storage)!: a `sys_file` / `sys_upload_session` write that never landed no longer reports success (#5216)

`StorageMetadataStore` wrapped **all eight** of its `IDataEngine` calls in
`try { … } catch { /* ignore */ }` — no logger, no rethrow, no degradation flag.
Because `if (this.engine)` had already separated "no data engine wired" out,
those catches could only ever fire on a **runtime** failure of an engine that is
wired: a constraint violation, a connection blip, an RLS refusal, a table that
was never migrated. Every one of them was swallowed, and the store returned the
record it had just put in a process-local `Map`.

The result on `sys_file` — mostly-permanent business truth with compliance value
(#5202) — was the shape AGENTS.md → "Degradation log levels" exists to forbid:
the bytes landed in the storage backend, the metadata row **never existed**, and
`POST /api/v1/storage/upload/presigned` answered `200 { success: true }` with a
`fileId` naming nothing. A read in the same process then found the Map shadow,
so even a self-check looked healthy — until the worker recycled and the
attachment became permanently unaddressable, with not one line of log pointing
at the cause. On `sys_upload_session` the same swallow made multi-worker chunked
uploads die as unexplained stalls instead of a diagnosable error.

**What changes.** With a data engine wired, the engine is now the only store:

- **Writes** (`createFile`, `updateFile`, `deleteFile`, `createSession`,
  `updateSession`, `deleteSession`) propagate the failure as a new
  `StorageMetadataStoreError` instead of returning a value. Nothing is mirrored
  into the `Map`, so there is no in-process shadow left behind to make a lost
  write look like a landed one.
- **Reads** (`getFile`, `getSession`) distinguish a **miss** from an **outage**.
  `findOne` returning nothing is still a miss and still returns `null` (the REST
  layer answers 404, unchanged). An engine that *throws* now propagates:
  substituting this process's `Map` for an unreachable engine would dress a
  stale or empty local guess up as the persisted answer, which under multiple
  workers is a different wrong answer per worker.
- The process-local `Map` is now exactly what the class doc always claimed —
  the stand-in for deployments with **no** engine wired (tests, dev). Behaviour
  of `new StorageMetadataStore(null)` is unchanged in every respect.

**Breaking, and where it shows.** No API signature changed; what changed is that
these calls can now reject. Requests that previously received `200` over a lost
write receive `500 INTERNAL` from the existing storage route handlers (they
already wrapped every handler in `catch → sendError(500, 'INTERNAL', …)`, so no
route needed editing), and a read attempted during an engine outage answers
`500` rather than a false `404 FILE_NOT_FOUND`. If you call
`StorageMetadataStore` directly, the six write methods and the two read methods
may now throw `StorageMetadataStoreError` — `error.objectName`
(`sys_file` / `sys_upload_session`), `error.operation`
(`insert` / `update` / `delete` / `findOne`) and `error.cause` (the engine's own
failure) identify it, and `error.message` states the consequence and the fix.

There is nothing to migrate: no deployment can have been *relying* on the old
behaviour, because the old behaviour produced no signal to rely on. What a
deployment may newly *see* is a 500 that was previously an undetected data loss.
`StorageMetadataStoreError` and the `StorageMetadataOperation` type are exported
from `@objectstack/service-storage` for callers that want to tell a metadata
outage apart from any other 500.
