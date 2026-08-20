# @objectstack/service-storage

## 17.1.0

### Patch Changes

- bbd86ed: Attachment access hooks: read the caller's org under the blessed `organizationId` name
  
  `callerContext()` in the `sys_attachment` access kit built its fallback
  execution envelope from `session.tenantId` — an alias removed from the
  hook/action session surface in v11 (#3290). `HookContextSchema` strips a
  `tenantId` key and the engine's `buildSession` only ever emits
  `organizationId`, so on every call that reached the session fallback (no
  execution context riding along) the envelope handed to
  `ISharingService.canEdit` carried **no organization at all**. Parent-record
  access for attachments was therefore evaluated without the caller's active
  org on that path. It now reads `session.organizationId`, matching the
  `sys_comment` kit, which already did.
  
  The `sys_comment` kit's own `callerContext()` had the same read as a dead
  first arm (`s.tenantId ?? s.organizationId`); the arm is removed. That half
  is behaviour-neutral — the fallback already carried the value.
  
  Both kits gain coverage of the session-fallback path in both directions: the
  blessed name is read, and a stray removed-alias key does not become the org.
- 593c4bf: feat(spec): `storage` becomes the canonical `CoreServiceName` slot; `file-storage` stays a deprecated v17 alias (#9683)
  
  <!-- adr-0087: not-required (no-migration-prescription) A service-registry slot
  name is not authorable metadata — nothing in a stack definition spells it — so
  there is no conversion-layer entry to register. Compatibility is carried by the
  enum keeping the old member and by @objectstack/service-storage registering the
  same instance under both names; the alias retires through the standard
  retirement flow at the next major. -->
  
  Maintainer ruling, 2026-08-18, verbatim: 「9683 file-storage 可以叫 storage」.
  The `file-storage` slot was the only `CoreServiceName` member whose spelling
  diverged from its documented accessor (`services.storage`), with no recorded
  reason anywhere in the tree.
  
  - `CoreServiceName` gains `storage` as the canonical member; `file-storage`
    stays an accepted, deprecated alias within v17 (it is a published enum
    member — existing `getService('file-storage')` callers keep working).
    `CORE_SERVICE_PROVIDER` and `ServiceRequirementDef` carry both.
  - `@objectstack/service-storage` registers the **same instance** under both
    names (the `http.server` / `http-server` pattern), pinned by an
    alias-equivalence test.
  - Every internal consumer resolves `storage`: the HTTP dispatcher, the email
    plugin's attachment store, and `os migrate files-to-references`. Discovery
    reports the service under the canonical `storage` key and mirrors the row
    verbatim under the `file-storage` key for the alias's v17 lifetime, so
    existing discovery readers (e.g. the console endpoint catalog) keep
    working.
  - Docs (`kernel/runtime-services`, `kernel/contracts`) now document the
    canonical slot; a custom v17 provider for this slot should register both
    names.
- 1258dca: Restore the #4757 unscoped multi-delete refusal on `sys_attachment` through the wired engine (#9719).
  
  `ObjectQL.registerHook` gains an opt-in `dispatchUnscopedMultiDelete` declaration (valid on `beforeDelete` registrations only — anything else is refused at registration): when a `multi: true` delete arrives with no `where` at all (absent or `null`), the engine's predicate path dispatches the whole-operation context ONCE to declaring registrations — before any matched row is resolved, zero-match included — so a guard about the operation's shape can refuse it. Binding `input.id` on that context is refused (`HookTargetRebindError`, path `'unscoped-multi'`). Undeclared registrations, scoped deletes (including the match-all `where: {}`), and by-id deletes see no new dispatch.
  
  The `sys_attachment` access guard declares the flag, so its documented refusal of a predicate-less multi-delete fires again with its declared envelope (`ATTACHMENT_DELETE_DENIED`, HTTP 403): since the per-row dispatch contract (#5038/#5574) that branch was unreachable, and a predicate-less `multi: true` delete quietly removed every row the caller happened to be entitled to. System-context and context-less programmatic deletes bypass the guard exactly as before.
- 4639cec: **Behaviour change:** an unscoped `multi: true` UPDATE of `sys_comment` is now refused, where it previously succeeded for a caller entitled to every row (#9974).
  
  This is not the restoration of a guard that used to work — it is a deliberate narrowing of what the engine accepts, ruled by the maintainer on 2026-08-19. If you issue `ql.update('sys_comment', data, { multi: true })` with **no `where` at all**, that call works today and will start failing with `RECORD_NOT_ACCESSIBLE` / 403. **The fix at the call site is to say which rows you mean** — pass a `where`. The explicit match-all `where: {}` is still accepted and still authorizes every matched row individually; only an *absent* or `null` predicate is refused.
  
  Why the accept set narrowed rather than the declaration: `resolveTargetRows` has declared this refusal for both write verbs since #4630, but on update it could only ever fire by accident — when the sweep happened to touch a row the caller lacked rights to, and then with a per-row message (`Cannot update comment c2: …`) naming a row rather than the shape. A caller who owned every row had the whole table rewritten, and a zero-match probe resolved silently. A guard that fires by accident reads as enforcement while enforcing nothing. The ruling weighed recoverability: a delete leaves a trace of who removed what, an overwrite leaves none — the old value is gone on the spot with nothing to restore from — and a forgotten `where` is the mistake generated code makes most often.
  
  **Engine (`@objectstack/objectql`).** #9719's opt-in whole-operation dispatch now covers `beforeUpdate`'s predicate path as well as `beforeDelete`'s, and the registration flag is **renamed** `dispatchUnscopedMultiDelete` → **`dispatchUnscopedMultiWrite`** (one flag generalized to both events rather than a second flag; it is per-registration and per-event, so a delete-only guard still says "delete only" by declaring it on `beforeDelete` alone). Declaring it on any other event is still refused at registration time. Binding `input.id` on the whole-operation context is refused on both verbs (`HookTargetRebindError`, path `unscoped-multi`), and the error now names the caller's event.
  
  **Blast radius.** The dispatch is delivered ONLY to registrations that declare the flag, so `sys_comment` is the only object whose update accept set changes; every other object's unscoped `multi: true` update behaves exactly as before. `sys_attachment` keeps its delete-only declaration and is unaffected on update. A repo-wide structural sweep of 4 663 source files found no in-tree caller — none in `examples/`, none in the dogfood apps, none in `packages/` source — that issues an unscoped `multi: true` update against a declaring object.
  
  **`@objectstack/service-storage`** is a rename-only follow: its `sys_attachment` guard declares the renamed flag on the same event, with the same behaviour.
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [66beee0]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
- Updated dependencies [899052a]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [04f8fdb]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [6158146]
- Updated dependencies [84cb121]
- Updated dependencies [ca19ee8]
- Updated dependencies [a675b4d]
- Updated dependencies [b887013]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [b3f9831]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/platform-objects@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/observability@17.1.0

## 17.0.0

### Major Changes

- 718b229: fix(service-storage)!: a `sys_file` / `sys_upload_session` write that never landed no longer reports success (#5216)

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
    layer answers 404, unchanged). An engine that _throws_ now propagates:
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

  There is nothing to migrate: no deployment can have been _relying_ on the old
  behaviour, because the old behaviour produced no signal to rely on. What a
  deployment may newly _see_ is a 500 that was previously an undetected data loss.
  `StorageMetadataStoreError` and the `StorageMetadataOperation` type are exported
  from `@objectstack/service-storage` for callers that want to tell a metadata
  outage apart from any other 500.

### Minor Changes

- 99736a0: feat(storage): exclusive field-reference file ownership — ADR-0104 D3 wave 2 (PR-3)

  A `file`/`image`/`avatar`/`video`/`audio` field that holds a `sys_file` id now
  records its owner on the file: `sys_file.ref_object` / `ref_id` / `ref_field`
  name the single `(object, record, field)` slot that references it, maintained on
  the engine write path — claimed on insert, reconciled on update, released when
  the owning record is deleted.

  **Field references are exclusive, unlike attachments.** The attachments surface
  deliberately shares one file across many `sys_attachment` join rows; a field
  reference is owned by at most one slot, and writing an already-owned id into a
  second slot **copies the bytes into a fresh `sys_file`** rather than sharing the
  row. That keeps a file's read authorisation derived from exactly one parent
  record instead of the union of every referrer's — so copying a private record's
  file id into a world-readable one cannot silently widen access — and it removes
  reference counting from the lifecycle entirely: a file is released because its
  one owner let go, never because a count came back zero.

  **Deletes nothing.** This records and releases ownership; it never tombstones,
  and the `scope === 'attachments'` guardrail that keeps field-referenced files
  out of the reap is untouched. Collection is a separate, gated change that must
  also extend the reap guard's sweep-time re-verify in the same commit.

  Also exports `isFileIdToken` from `@objectstack/spec/data` as the single arbiter
  of "is this stored string an opaque file id, or a legacy/external URL?", now
  shared by the read resolver and the write claimer so the two cannot drift.

  Dormant until a field actually holds an id token: objects without file-class
  fields, inline-blob values and URL-shaped values all exit before any I/O.

- 134df4f: feat(storage): governed download for field-owned files — ADR-0104 D3 wave 2 (PR-4)

  A file owned by a record's field (`sys_file.ref_object` / `ref_id`, set by
  PR-3) is now authorized on download the same way an attachment is: the caller
  must be able to READ the file's parent record, or be its uploader. Previously
  only `attachments`-scope files were gated and every field file kept an
  anonymous capability URL.

  **Parent resolution differs by surface, and that asymmetry is the point.** An
  attachment may hang off many records, so its readable-by set is the union over
  its `sys_attachment` join rows. A field-owned file belongs to exactly one
  record, so its readable-by set is that one record's — nothing more. Under a
  shared reference model the field case would have had to union too, which is
  what makes copying a file id into a more public record silently widen access.

  Denials are reported as `FILE_DOWNLOAD_DENIED` (403), distinct from the
  attachments path's `ATTACHMENT_DOWNLOAD_DENIED`, since the file _belongs to_ one
  record rather than being _attached to_ several.

  **`acl: 'public_read'` is the opt-out**, and now an explicit declaration rather
  than the silent default every field file used to get. Genuinely public images —
  anything embedded in an `<img src>`, which cannot carry a bearer token — must
  declare it.

  **Dual-mode safe, gates nothing that is open today.** A pre-cutover field holds
  an inline blob or an external URL, never a `sys_file` id, so no existing file
  has an owner recorded and none of them start being gated. The gate engages only
  for files a record's field has actually claimed, and disengages again when
  ownership is released.

  ***

  Also adds `verifyFileReferences()` — the executable form of ADR-0104's R4
  acceptance gate. It compares ground truth (what records' file fields actually
  hold) against recorded ownership, and classifies disagreements by whether they
  could cause data loss once collection is enabled:

  - **blocking** — `unowned_reference` (a held file nothing owns), `foreign_owner`
    (a record holds a file owned by another slot), `shared_reference` (one file
    held by two slots, i.e. exclusivity was violated). Each would let a later reap
    delete bytes a record still points at.
  - **advisory** — `stale_owner` (owned but no longer held; fails toward
    retention) and `unreferenced_file` (storage cost, not a correctness problem).

  The scan is read-only — it never writes, tombstones, or deletes. A ledger may
  not be given authority over irreversible deletes until it has been shown to
  agree with reality, so this must report zero blocking discrepancies on real
  tenant data, on consecutive runs, before the gated collection change may merge.

- fe67e34: feat(spec)!: media fields declare accept/maxSize, and the stored form is a file reference — ADR-0104 D3 wave 2 (PR-5a)

  **`accept` and `maxSize` are now declared on `FieldSchema`, and enforced on the
  server.** Both were already read by the upload widgets — `field.accept`,
  `field.maxSize` — while the spec did not declare them, so an author who wrote
  them had the keys silently stripped at parse and the constraint simply never
  existed. That is exactly the ADR-0104 failure class (a declaration accepted in
  source, dropped from the contract, with no feedback).

  Now that the platform owns the file, `sys_file` carries the authoritative MIME
  type and byte size, so a record write is re-checked against the declaration
  where it actually binds rather than only in the browser — a client-side check is
  a convenience, not a control, since any caller talking to the API directly
  bypasses it. Violations raise `FileConstraintError` and fail the write. An entry
  is only judged against metadata the file actually reports: a file with no
  recorded MIME type cannot fail an `accept` test, and one with no recorded size
  cannot fail `maxSize` — "we don't know" must not become "not permitted".

  **The stored form of a media field narrows to an opaque `sys_file` id.**
  `valueSchemaFor(field, 'stored')` now yields an id for `file`/`image`/`avatar`/
  `video`/`audio`; the inline `{url, name, size, …}` blob becomes the `'expanded'`
  read form, which also still admits an unresolved id (storage service absent,
  file not committed) exactly as an unexpanded lookup id stays valid.

  Two legacy forms therefore stop conforming, both deliberately:

  - the **inline blob**, which is no longer stored but derived;
  - an **external URL**, which was never a managed file — ADR-0104 R7 retires it
    toward an explicit `url` field, and under AI authoring that is the point: it
    stops "managed file" and "external link" being the same declaration.

  **Not a breaking change today.** Value-shape checking is warn-first
  (ADR-0104 R1/R2): a not-yet-backfilled row still writes and the author gets a
  warning naming the field. Hard rejection arrives only when a deployment opts
  into `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` — which it should do after running the
  backfill and confirming reconciliation. The `!` marks the contract change for
  the v17 window, not a runtime break on upgrade.

- b1863a5: feat(storage): released field files enter collection on deployments that verified their file migration — ADR-0104 D3 wave 2 PR-5b (#3459)

  The gated, final step of the file-as-reference sequence. On a deployment whose
  `adr-0104-file-references` flag is verified (`os migrate files-to-references
--apply`, #3617), releasing a field file's ownership — clearing the field, or
  deleting the owning record — now also tombstones the file
  (`status='deleted'` + `deleted_at`), which starts the `sys_file` lifecycle's
  declared 30-day grace window and, at its end, hands the row to the reap sweep.
  Re-referencing the id inside the window revives it, exactly like re-attaching
  an attachment.

  **The two halves ship together, deliberately.** The same change extends the
  reap guard's sweep-time re-verify beyond `sys_attachment` join rows to the
  ownership columns: a tombstoned file whose `ref_*` columns name a current
  owner (re-claimed in the window, or a release/claim race) is un-tombstoned and
  vetoed. Tombstoning released files without that re-verify would have turned
  every release into a _guaranteed_ byte delete — the guard's old check consults
  a table that is always empty for field files. This pairing was the standing
  hard constraint on #3459, locked by regression tests on both halves.

  **Nothing changes for a deployment that has not migrated.** Release keeps
  clearing the ownership columns only, and released files are retained forever.
  Every way of not knowing — no flag row, an unreadable table, an engine that
  cannot be asked — reads as "not verified": the gate fails closed, toward
  retention. And the guard re-reads the flag _fresh_ at sweep time (not the
  release path's memoized read), so a later failing migration run — a database
  that has drifted — closes the gate for already-written tombstones too, without
  a restart. Attachments-scope collection is unchanged and needs no flag.

  The irreversible moment is therefore per deployment: day 30 after _that_
  deployment verified its migration and released a file — never the upgrade
  itself.

- 3d3fddf: feat(storage): legacy file-value backfill — ADR-0104 D3 wave 2 (PR-6)

  `backfillFileReferences()` converts the pre-reference forms a `file`/`image`/
  `avatar`/`video`/`audio` field may hold — an inline metadata blob
  (`{url, name, size, …}`) or a bare URL string — into the reference form: an
  opaque `sys_file` id, owned by the record's field.

  What it will and will not convert:

  - **A URL naming this platform's own resolver** (`…/storage/files/:id`) already
    identifies a `sys_file`; the field is rewritten to the bare id and no bytes
    move.
  - **A `data:` URI** carries its bytes inline; they are uploaded, a `sys_file` is
    registered, and the field is rewritten to its id.
  - **An external URL** is reported, never converted. Re-hosting third-party
    content is a bandwidth, licensing and privacy decision that is not a
    migration's to make — ADR-0104 R7 retires these toward an explicit `url`
    field, which under AI authoring is the point: it stops "managed file" and
    "external link" being the same declaration.

  **Dry run by default** — nothing is written unless `apply` is set, and the
  dry-run report has the same shape as the applied one so the plan can be reviewed
  and diffed. **Idempotent** — a value already in reference form is recorded and
  left alone, so a partially-completed run is safe to repeat.

  The backfill never writes the ownership columns itself: it rewrites the record,
  and the claim hooks observe that write and record ownership. One claiming path,
  so there is nothing that can disagree with itself. Run
  `verifyFileReferences()` afterwards to confirm the two agree — that
  reconciliation is the gate the irreversible collection change must pass.

- fdb4f50: feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

  The ADR-0104 file-as-reference migration ships as a command a deployment runs
  against its own database, and the deployment-level flag it records is what may
  later authorise irreversible behaviour — never the platform version.

  ```bash
  os migrate files-to-references           # dry run: reports, writes nothing
  os migrate files-to-references --apply   # converts, verifies, records the flag
  ```

  The run backfills legacy file-field values (inline metadata blobs, own-resolver
  URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
  ledger against what records actually hold, and — only on an `--apply` run whose
  reconciliation reports **zero blocking discrepancies** — records
  `sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

  **Why a flag rather than a release note.** ObjectStack is a development
  platform: third-party deployments upgrade on their own schedule and their data
  is not observable by anyone else, so no release-side soak can vouch for them.
  The evidence has to be produced where the data is. Consequences:

  - Installing a new version never starts deleting bytes. Running the migration
    and passing its self-check is the consent.
  - Not run, or not passed → files are retained forever. Wasted storage, zero
    data loss.
  - A later failing run **clears** `verified_at`: a deployment whose data has
    drifted closes its own gate.
  - A dry run writes nothing at all — not the conversions, and not the flag,
    even when the self-check would pass.
  - External URLs stay advisory. They are not `sys_file`s, so they can never
    enter collection; whether to remodel them as a `url` field is the app
    author's decision (ADR-0104 R7), not a gate.

  Ships alongside:

  - `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
    and the single `isDataMigrationFlagVerified` predicate both future consumers
    (collection #3459, strict value-shape #3438) read, so the two gates cannot
    disagree about the same fact.
  - `@objectstack/platform-objects` — the `sys_migration` object plus
    `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
    Reads fail toward "not verified": a gate that cannot read its evidence stays
    closed.
  - `@objectstack/objectql` — a read may now opt out of file-reference expansion
    via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
    bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
    their expanded form before the reconciliation sees them, which reports held
    references as absent — noisy `stale_owner` findings, and a missed
    `unowned_reference` would have been a false pass of the collection gate.

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- 06be54e: fix(objectql): a value admitted by an `OS_ALLOW_LAX_*` escape hatch stops released field files from being collected (#4797)

  `recordDataMigrationRun`'s contract says a deployment whose data has regressed
  since it last verified closes its own gate. That only happened when a migration
  was re-run — nothing told the ledger when the data actually regressed.

  Normally nothing has to. Once `sys_migration` records a verified ADR-0104
  migration the write path is strict, a non-conforming value is refused, and the
  certificate cannot go stale. **The operator escape hatches are the exception,
  and they exist precisely to relax a deployment that has already verified.** With
  `OS_ALLOW_MEDIA_VALUES` / `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`
  on, a non-conforming value is admitted and persisted while the row still reads
  `verified_at` non-null, `blocking: 0`. Turn the switch off — or let any other
  process or machine run without it — and strict returns to reject the very data
  this deployment stored. Meanwhile the `adr-0104-file-references` row also governs
  reclamation of released field files, so the reap guard kept **deleting bytes** on
  the strength of a certificate that was no longer true, with nothing in the ledger
  saying so.

  **A lax-admitted write now records a deviation.** The engine's admit path — the
  same sink that already tallies counterexamples for #4769 — stamps
  `sys_migration.deviation_observed_at` (plus a `deviation_detail` naming the
  object, field, type and parse issue) on the migration whose contract the value
  broke.

  **The marker gates the irreversible path, and only that.** Authority is withdrawn
  in proportion to reversibility:

  | behaviour                                 | reversible?                 | predicate                      | while a deviation stands |
  | ----------------------------------------- | --------------------------- | ------------------------------ | ------------------------ |
  | strict value-shape enforcement (#3438)    | a rejected write is retried | `isDataMigrationFlagVerified`  | continues                |
  | tombstoning a released file (#3459 PR-5b) | lifted on re-attach         | `isDataMigrationFlagVerified`  | continues                |
  | reap guard's byte delete                  | **never**                   | `authorisesIrreversibleAction` | **refuses**              |

  A certificate is not a boolean; it is authority over a set of behaviours, and the
  two halves are withdrawn on different evidence. One admitted write is a complete
  disproof of "nothing here violates this contract" — enough to stop deleting data
  forever. It is _not_ evidence of the same order as the full-store scan that
  earned the certificate, so it does not revoke it: doing that would turn an
  explicitly temporary switch into a one-way door, forcing a full re-migration on
  anyone who used the escape hatch once.

  Recording without gating was rejected for the opposite reason — a marker no code
  consumes is a declared-but-unenforced field, and the bytes get deleted regardless.

  **Getting back to full authority is the documented route.** A real
  `os migrate files-to-references --apply` / `os migrate value-shapes --apply` run
  walks the whole store again, which _is_ evidence of the same order, and clears
  the marker.

  Additive and backward compatible. A `sys_migration` row written before these
  columns existed reads as "no deviation observed", so upgrading never retroactively
  closes a gate a deployment earned — the marker only ever closes it on an observed
  deviation. `isDataMigrationFlagVerified` is unchanged and keeps its existing
  consumers; the new `authorisesIrreversibleAction` (spec) and `mayActIrreversibly`
  (platform-objects) are the stronger pair, and the reap guard is their one caller.

- 20526f5: feat(spec,service-storage): restore prefix enumeration cursor-shaped — `IStorageService.list(prefix, { cursor, limit })` (#6781)

  `list?(prefix): Promise<StorageFileInfo[]>` was retired in #5540 / #5541 on the
  measurement "nothing in the repo calls either". True for this repo, false one repo
  over: `cloud` has two production callers — tenant attachment reclamation on
  environment delete (cloud#935 is the incident where that sweep silently did nothing)
  and marketplace snapshot GC. Both retirement notes reserved exactly one route back,
  word for word, and this is it (maintainer ruling on cloud#1203, option B).

  **The new member is the reserved shape, not the old one restored.**

  ```ts
  list?(prefix: string, options?: StorageListOptions): Promise<StorageListPage>;

  interface StorageListOptions { cursor?: string; limit?: number }
  interface StorageListPage { items: StorageFileInfo[]; nextCursor?: string }
  ```

  The two defects #5266 measured in the old signature are now unrepresentable:

  | #5266 defect                            | Why it cannot recur                                                                                                                                                      |
  | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | S3 truncated at 1000 objects, no signal | A page carries `nextCursor` **iff** more remains. The 1000 is now the default `limit`, and a capped page says so instead of looking complete.                            |
  | local listed one level, S3 recursed     | One prescribed semantics — raw key-string prefix, matched recursively — asserted against **both** backends from one table in `storage-adapter-list.conformance.test.ts`. |

  **Semantics every adapter must implement** (`IStorageService.list` carries the full
  text): raw key prefix, so `list('a')` returns `a/b/c` _and_ `ab.txt` and a trailing
  slash is what scopes to a folder; files only, with filesystem directories and S3
  zero-byte directory markers both skipped; ascending key order; pages full except the
  last; `nextCursor` iff more remains; no duplicates and no gaps across a run.

  **`limit` and `cursor` are refused, never coerced** — `VALIDATION_ERROR` / 400
  (ADR-0112). The validator and the cursor codec live on the _contract_
  (`resolveStorageListLimit`, `encodeStorageListCursor`, `decodeStorageListCursor`), not
  in each adapter, so two backends cannot answer the same bad argument two ways. A
  consequence worth knowing: a cursor means one thing everywhere — "resume after this
  key" — so both shipped adapters issue byte-identical cursors and a
  `SwappableStorageService` adapter swap mid-sweep resumes instead of restarting.

  **Additive.** `list` stays OPTIONAL, like every other capability on this contract: a
  third-party adapter that cannot enumerate is unaffected and still compiles. Making it
  required would be a major-version act, and enumeration is genuinely optional for a
  backend.

  Shipped with it: the S3 adapter loops `ListObjectsV2` with `ContinuationToken` inside a
  single call so a `limit` past the 1000-key `MaxKeys` ceiling is served in full, and
  resumes across calls with `StartAfter`; the local adapter emulates the S3 key space with
  a pruned walk whose memory is bounded by `limit` rather than by the size of the tree;
  `SwappableStorageService` forwards it. `storage-adapter-list-retirement.test.ts` is
  renamed to `storage-adapter-list-contract.test.ts` and **flipped** rather than deleted —
  it used to hold "the retired shape has not crept back", it now holds "both adapters
  carry the restored member, in the cursor shape and not the array one".

  ADR-0087 note: the `storage-service-list-retired` ledger entry is amended, not withdrawn.
  The single-argument `list(prefix)` stays retired and a call written against it still
  fails to compile; what changed is the entry's `replacement`, which said "no replacement"
  and would otherwise have shipped in the same release as the replacement — sending an
  upgrader to hand-roll S3 pagination, which is precisely the option the ruling rejected.

### Patch Changes

- 37b1346: feat(storage): surface the sys_file id on upload-complete — ADR-0104 D3 wave 2 (PR-1)

  `POST /api/v1/storage/upload/complete` now returns the opaque `sys_file` id
  (`data.fileId`), and `client.storage.upload()` surfaces it on the returned
  `FileMetadata`. Previously the commit response omitted the id — the caller
  could not learn which id to persist after committing an upload, so a file
  field could never store a reference.

  Additive and non-breaking (new optional `fileId` on `FileMetadataSchema`; the
  client falls back to the presigned id when talking to an older server). This is
  the enabling foundation for file-as-reference; the storage model itself is
  unchanged in this PR.

- 2e4274d: fix(service-storage): forward the caller's full execution envelope to the `sys_attachment` sharing gates (#7145)

  `callerContext()` in `attachment-access-hooks.ts` rebuilt a five-field
  projection of the caller's `ExecutionContext` (`userId` / `tenantId` /
  `positions` / `permissions` / `isSystem`) before handing it to
  `ISharingService.canEdit`, whose contract declares the **full** envelope and
  whose doc block tells callers they "MUST NOT rebuild a subset of it" (#6523 /
  the #6206 ruling). This is the same defect PR #7143 fixed for the `sys_comment`
  kit (#7141), one package over — the attachment kit is what the comment kit was
  derived from.

  The projection was doing two jobs at once and only one of them was correct:

  - **Dropping the middleware-private keys was correct**, and is preserved.
    plugin-security's middleware stamps the access DEPTH it resolved for the
    object of the operation in flight — `sys_attachment` here — onto the context
    in place (`sc.__readScope = …`), while these gates ask the sharing service
    about the **parent record's** object. Forwarding that whole would hand one
    object's widening to another object's owner-match, the stale-scope leak
    `resolveWriteScopeForSharing` was extracted to prevent. The keys are now
    dropped by the `__` **prefix** rather than by name, which also covers the
    engine's other operation-private markers on that channel (`__expandRead`
    waives the object-level CRUD check, `__referentialFieldClear` the
    referential-clear write) and cannot go stale when a fifth key is added.
  - **Dropping the principal fields was the defect.** Two of them decide the
    verdict these gates then trust:

    - `onBehalfOf` — `ISecurityService.hasWriteBypass`, the `modifyAllRecords`
      probe `SharingService.canEdit` consults last, is documented to fail CLOSED
      on a delegated context and implements that by reading exactly
      `context?.onBehalfOf?.userId`. Stripped, the guard could never fire on the
      attachment path, and the `/mcp` OAuth agent principal that
      `resolve-execution-context` builds _with_ the delegation link reached the
      bypass probe looking like an ordinary direct call.
    - `principalKind` — `resolvePermissionSetsForContext` keys the ADR-0090 D10
      rule "an agent's grants are EXACTLY its scope-derived ceiling" on
      `principalKind === 'agent'`. Stripped, the additive human baseline was
      appended to an agent's ceiling here, so the sets the bypass probe evaluated
      were a superset of what the user consented to.

    `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
    `rlsMembership` were dropped by the same projection and are forwarded now for
    the same reason.

  Both `canEdit` call sites are covered — the `beforeInsert` parent gate and the
  `beforeDelete` per-row authorization loop — and the same
  envelope-minus-private-keys rule is applied to the read middleware's
  parent-visibility probe, which spread the whole operation context into a `find`
  on a different object.

  No access depth is synthesised for the parent object: absent depth leaves the
  sharing owner-match at its narrowest (`own`), which is the safe direction and
  byte-for-byte what the projection produced. Resolving the parent's own depth
  would WIDEN these gates and is deliberately left to the separate decision
  tracked as #7144.

  Enforcement effect: a delegated (`onBehalfOf`-carrying) principal is now refused
  where the contract says it is refused. No caller gains access.

- 941dec4: fix(service-storage): an UNSCOPED multi-delete of `sys_attachment` is refused instead of authorized (#4757)

  `installAttachmentAccessHooks`'s `beforeDelete` gate resolved the rows a delete
  matches in two ways — by `input.id`, or by `input.options.where` — and then
  short-circuited with `if (!rows.length) return`. A delete carrying **neither**
  an id **nor** a `where` took neither branch, so `rows` stayed empty and the gate
  returned _allow_. That is not "nothing matched": nothing was ever queried.

  The engine reads the same call as a bulk delete over everything — with no
  single id it seeds the delete AST as `{ object }` and hands that to
  `driver.deleteMany` — so `ql.delete('sys_attachment', { multi: true })` emptied
  the whole attachment table with the record-level gate having authorized exactly
  zero rows. Neither layer underneath catches it: plugin-sharing composes no
  row-scoping predicate for an object with no owner field (`sys_attachment`'s
  provenance column is `uploaded_by`), and plugin-security only refuses callers
  whose grants lack the delete bit on `sys_attachment` — an app shipping the
  domain grant the attachments panel requires passes RBAC and lands here.

  The gate now fails **closed** on that shape: no id and no `where` is refused
  with 403 `ATTACHMENT_DELETE_DENIED` ("Refusing an unscoped multi-delete of
  attachments — scope the delete to the rows you mean"), the posture #4630 gave
  `sys_comment` in `resolveTargetRows`. "Nothing to authorize" and "nothing was
  ever queried" are different verdicts, and reading the second as the first is
  fail-open.

  Scoped deletes are unchanged: an id-bound delete, a `where`-bound multi-delete,
  and even `where: {}` (which matches every row but is a real query) still resolve
  their rows and authorize each one uploader-or-parent-editor as before — a delete
  that legitimately matches no row still passes. Only the predicate-less call is
  newly refused. If you were relying on `ql.delete('sys_attachment', { multi:
true })` to clear the table, pass a predicate (`{ multi: true, where: {} }`
  authorizes row-by-row) or perform the sweep under a system context, which
  bypasses the gate as before.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- deb538f: fix(storage): let an object delegate file-read authorization to its service

  Fixes a regression from the governed-download change (ADR-0104 D3 wave 2): a
  **legitimate approver could see a decision attachment's filename but got 403
  opening it**, found by driving app-showcase in a browser as a real non-admin
  approver.

  Cause: a field-owned file's download was authorized by testing whether the
  caller can READ the owning row. For an ordinary business object that is right —
  row readability _is_ the access rule. For `sys_approval_action` it is the wrong
  authority: the audit table is deliberately closed to ordinary approver
  positions (`operation 'find' … is not permitted for positions [auditor,
everyone]`), so the test denied the very approver the attachment was filed for.
  The approvals _service_ has always had the real rule, which is why the timeline
  listing the attachment returned 200 while the bytes returned 403.

  An object may now name a service to answer the question instead:

  - `ObjectSchema.fileAccessDelegate` — a kernel service that authorizes
    downloads of files owned by that object's media fields.
  - `IFileAccessDelegate.authorizeFileRead(recordId, context)` — the contract.
  - `sys_approval_action` declares `'approvals'`; `ApprovalService.authorizeFileRead`
    reuses the _same_ gate `listActions` applies (visibility of the parent
    request) rather than inventing a second, looser rule for the bytes.

  **Fails closed**: a declared delegate that is missing or does not implement the
  method denies, rather than silently reverting to the raw read it was declared to
  replace. Objects without the declaration are unchanged.

  Verified in the browser against app-showcase, both sides of the gate: the
  approver now downloads the real PDF (200), and an anonymous request is still
  refused (401) — the anonymous capability URL the original change closed stays
  closed. A decision attachment ends up exactly as readable as the decision it
  hangs off: never more, and no longer less.

- 2c19383: fix(service-storage): stop handing out `_local/file/:key`, a URL nothing mounts (#3641)

  Three call sites built `${basePath}/_local/file/<key>`. No registrar has ever
  mounted it, so anyone who followed one got a 404. Found by the tranche-3
  storage ledger (#3636), which recorded the URL as deliberately absent and filed
  this; now nothing builds it either.

  Each site is fixed according to what it could honestly do:

  - **`LocalStorageAdapter.getPresignedUpload()`** simply omits `downloadUrl`
    (optional on the descriptor). It cannot construct the real capability URL —
    that is keyed by `sys_file.id`, and an adapter only ever sees the storage
    key. Nothing read the field anyway, which is how it survived: the
    presigned-upload route builds its own `downloadUrl`
    (`${basePath}/files/:fileId/url`) and ignores this one, while all three real
    readers of `desc.downloadUrl` take it from `getPresignedDownload`, whose URL
    _is_ mounted (`_local/raw/<token>`).

  - **`GET /files/:fileId/url` and `GET /files/:fileId`** answer **501
    `NOT_IMPLEMENTED`** when the adapter has neither `getPresignedDownload` nor
    `getSignedUrl`, instead of returning (or redirecting to) the unmounted URL.
    The caller now learns the adapter is the limitation rather than chasing a
    broken link.

  Behaviour change is confined to adapters implementing neither capability —
  `LocalStorageAdapter` and the S3 adapter both implement `getPresignedDownload`,
  so no shipped path changes. A 200/302 pointing at a 404 becomes a 501 that says
  why.

  Two conformance cases added for the new branches, and mutation-checked:
  restoring either dead URL fails them.

- db59e9c: hooks: drop the last three `doc` / `previousDoc` alias reads on a hook context — read the engine's own keys only

  Behaviour is unchanged: every one of these limbs guarded against a producer that
  has never existed, so none of them could be reached.

  - `service-storage` attachment lifecycle read `ctx.result ?? ctx.input.doc ?? ctx.input.data`
  - `plugin-sharing` primary-BU projection read `(ctx.input.data ?? ctx.input.doc).user_id`
  - `runtime`'s hook sandbox read `engineCtx.input ?? engineCtx.doc` and `engineCtx.previous ?? engineCtx.previousDoc`

  Every ObjectQL write context spells the payload `data` — measured and pinned by
  `hook-input-shape-contract.test.ts` in `@objectstack/objectql` ("insert carries
  `data` — never `doc`", #5273). The top-level pair is the same family one level
  up: `HookContextSchema` declares `input` / `result` / `previous` and neither a
  `doc` nor a `previousDoc`, and `engine.ts` — the sole producer of a HookContext
  — builds neither. The limbs survived only because the old `HookContext.input`
  contract table documented insert as `{ doc, options }`; that table was corrected
  in #5668, and the same alias was removed from `trigger-record-change` in #5671.
  These are the remainder (#5906), removed rather than left as a second de-facto
  contract (PD #12).

- fc3a36a: fix(spec,objectql,sharing,storage): a hook can tell a per-row bulk dispatch from a single-record write again (#6966)

  A predicate (`multi: true`) write dispatches its lifecycle hooks **once per
  matched row** — `after*` since #5038, `before*` since #5574 — on a context
  deliberately indistinguishable from a single-id write's, so a handler written
  for one record works unchanged on a batch. That indistinguishability is the
  feature, and it also erased the only signal several handlers had.

  Before #5574 a bulk `before*` fired once with `input.id` present-but-`undefined`,
  so "`input.id` is empty" meant "this call stands for N rows". Guards across the
  platform were written on it. Every one of them **silently inverted** rather than
  failing: a per-row context has an id, so the guard now answers "single write" for
  every row of a batch. Two further assumptions broke with it — that the engine
  reuses one `HookContext` across a write's before/after pair, and that `after*`
  work keyed on the write's row set runs once.

  ### New: `HookContext.dispatch`

  The engine now states the fact rather than leaving it to be inferred:

  ```ts
  ctx.dispatch; // { mode: 'record' | 'per-row', index: number, scope: object } | undefined
  ```

  - `mode` — `'record'` when the call is the caller's whole write; `'per-row'`
    when it is one of N.
  - `index` — position in the fan-out. `index === 0` is how a handler does
    batch-scoped work once instead of N times.
  - `scope` — scratch shared by **every** dispatch of one write, both phases, same
    object identity. This is the seam handlers used to get by stashing on the
    context itself, which only ever worked because a single-id write reuses one
    context across its pair.

  Bound at every write dispatch site — insert, update, delete, both phases.
  Optional, and an absent marker reads as "not a per-row dispatch", so a handler
  reads `ctx.dispatch?.mode === 'per-row'` and existing code keeps its behaviour.
  Reads carry no marker: a read has no fan-out.

  It is deliberately **not** the `isPredicateBulkWrite` discriminator #5574
  retired. That one was removed under ADR-0049 for having neither a producer nor a
  reachable consumer — it inferred "bulk" from `input.id` and `options.multi` at
  the consumer, which is exactly what `asScalarId` stays unexported to prevent
  (#4434 / #4550). This one is produced by the engine at the point the dispatch
  ladder is decided, and the platform's own handlers read it.

  ### Behaviour fixed

  **Sharing rules and the record-share cascade (`@objectstack/plugin-sharing`).**
  The `before*` hook stashes the write's affected row set for the `after*` hook to
  act on. On a predicate write that stash was landing on a per-row context the
  `after` phase never saw, so `readAffectedRows` answered `resolve-failed` and both
  subscribers took their safe branch: every bulk update or delete on a ruled object
  revoked **all** of that object's rule grants and queued a full asynchronous
  re-grant — once per matched row, with the repeats racing each other's re-grants.
  Access was never widened (the trade is the ruling's "over-granting is an
  incident, under-granting is a wobble" direction), but a bounded write now takes
  the bounded path again: the rows are unioned as the engine hands them over, the
  cap still applies to the union, and the `after*` work runs once per write.

  **File-reference ownership (`@objectstack/service-storage`).** The `beforeDelete`
  hook that pre-resolved ids for a `where`-shaped delete was dead on every path,
  and `afterDelete` was falling back to one `sys_file` lookup **per row** where the
  batch fits one `$in`. Both are fixed by the marker, and the pre-resolution query
  is gone entirely — the engine has already matched the rows and hands them over.
  The `beforeUpdate` copy-on-claim pass no longer runs once per row against a
  batch-scoped payload, which also removes a row-conditioned rewrite of a shared
  `SET` clause (out of contract under ADR-0058 Addendum II D3).

  No authored metadata changes, and no write's result, event or return contract
  changes.

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- a5302c7: fix(service-storage): a predicate update writing a file field is refused, instead of giving N records one file id (#7102)

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

- f1a8114: fix(client,service-i18n): ledger the autonomously-mounted service routes, and repair the two i18n calls that reached nothing (#3636)

  Tranche 3 of the #3563 route audit — the last un-audited server surface. The
  dispatcher ledger (#3563) and the REST ledger (#3587) each stop at their own
  package boundary, and two services mount routes outside both: they reach for
  the `http-server` service and register straight on `IHttpServer`, so neither
  `RouteManager` nor `RestServer.getRoutes()` has ever seen them. That left the
  SDK's entire storage surface, plus all of i18n, in the pre-#3563 posture:
  expressed, working, guarded by nothing.

  **Ledgers + guards.** `storage-route-ledger.ts` (10 routes) and
  `i18n-route-ledger.ts` (3) sit next to the registrars that mount them, each
  enumerated for real — the registrar runs against a capturing mock
  `IHttpServer` and its registration calls _are_ the route set, so a new route
  lands with a reviewed disposition or fails CI. The client half is
  `packages/client/src/service-route-ledger-coverage.test.ts`; ledgers cross the
  boundary as relative source imports, never a service→client package edge.

  **Two wire-level 404s fixed.** `i18n.getTranslations` sent
  `/i18n/translations?locale=xx` and `i18n.getFieldLabels` sent
  `/i18n/labels/:object?locale=xx`, while every serving surface — service-i18n's
  mounts, the dispatcher's HTTP mounts, and the `plugin-rest-api.zod.ts`
  contract — mounts only the path form. Neither call could ever be answered.
  Both had carried a green `sdk` row in the dispatcher ledger since tranche 1,
  because that guard asks whether the client _method_ exists, not whether it
  speaks a URL anything mounts. The client now sends the path dialect, the same
  resolution #3611 gave `meta.getView`, and a new suite drives the real client
  at a real router so a revert cannot pass quietly.

  **One response-shape fix.** service-i18n's success bodies omitted the
  `success` flag that `ObjectStackClient.unwrapResponse` keys on, so the SDK
  returned the raw `{ data: … }` wrapper against that provider while returning
  the declared unwrapped shape against the dispatcher — one method, two shapes,
  decided by which plugin mounted the route. Its three handlers now emit the
  `{ success: true, data }` envelope the `i18n` route group declares. `data` did
  not move, so direct body readers are unaffected.

  Storage audited clean: 7 routes SDK-expressed, 3 reviewed `server-only` (the
  browser capability URL objectql stamps into file-field payloads, and the two
  local-driver loopbacks). The chunked-upload family, flagged for triage, turned
  out fully expressed. Both ledgers ratchet `gap` and `mismatch` at zero.

  Filed, not fixed: `GET {base}/_local/file/:key` is built by three call sites
  and mounted by none (#3641); the cross-surface URL conformance guard that would
  have caught all of the above mechanically is the capstone (#3642).

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- bd68f08: fix(service-storage,service-i18n): emit the declared error envelope, not a bare `{ error }` (#3675)

  #3636 aligned the **success** bodies of the autonomously-mounted service
  routes because those were the ones breaking `ObjectStackClient.unwrapResponse`.
  The error bodies were left alone and stayed a bare `{ error: '<message>' }` —
  with the code, where one existed at all, as a _sibling_ of `error` rather than
  a field of it — against a contract (`BaseResponseSchema` + `ApiErrorSchema`)
  that declares `{ success: false, error: { code, message } }`.

  So the same SDK method returned two different error shapes depending on which
  provider mounted the route: a caller reading `body.error.message` got the real
  message from the dispatcher and `undefined` from these services. All 32 sites
  (27 in `storage-routes.ts`, 5 in `i18n-service-plugin.ts`) now go through a
  single `sendError` helper per module — the nested-`error` shape the sibling
  services already use (`settings-routes.ts`, `share-link-routes.ts`), plus the
  `success` flag those two still omit and the contract requires.

  **Codes moved, and that is the breaking part.** `AUTH_REQUIRED`,
  `ATTACHMENT_DOWNLOAD_DENIED` and `FILE_DOWNLOAD_DENIED` used to sit at
  `body.code`; they now sit at `body.error.code`. The SDK is unaffected — it
  already reads `errorBody?.code || errorBody?.error?.code`, one of the four
  shapes its error path sniffs for, which is the consumer-side shim Prime
  Directive #12 says to cure at the producer. The console's attachment panel
  was NOT: it read the top level only, so every gated download would have
  degraded from "You don't have access to download this attachment." to
  "Download failed (403)". Fixed in objectui to read both dialects, since a
  console build ships independently of the server it talks to.

  **Guarded both ways.** New `error-envelope.conformance.test.ts` in each
  service drives every distinct error branch through the real registrar and
  parses the body against the real `BaseResponseSchema` imported from
  `packages/spec` — not a local restatement of it — and scans the module source
  so a new route cannot quietly reintroduce the bare shape. The route ledgers
  (#3563 → #3656) could never have caught this: they audit which routes exist
  and whether the SDK can address them, not what comes back.

  Measured and left alone: the dispatcher does not conform either — it puts the
  HTTP status in `error.code`, where the contract declares a semantic string,
  and parks the real code in `details` to work around its own occupied field.
  That deviation is now pinned to exactly one field by a test in
  `http-dispatcher.test.ts` rather than described in prose. Also unchanged:
  service-storage's success bodies are still three shapes of their own
  (`{ data }`, bare `{ url }`, `{ ok, key }`, none with `success: true`) — a
  non-additive change that needs its own issue, not a quiet ride along with this
  one.

- 6633337: fix(service-storage): emit the declared success envelope on all eight routes (#3689)

  #3675 moved the **error** bodies of the autonomously-mounted `/api/v1/storage/*`
  routes into the declared `{ success: false, error: { code, message } }`
  envelope and deliberately stopped there: unlike the errors, the success bodies
  were not an additive fix. They were three shapes, none of them carrying the
  `success` flag `BaseResponseSchema` declares and
  `ObjectStackClient.unwrapResponse` keys on —

  | Route(s)                                                                                                                     | Was                 | Now                                |
  | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- |
  | the six upload routes (`/upload/presigned`, `/upload/complete`, `/upload/chunked`, `…/chunk/:i`, `…/complete`, `…/progress`) | `{ data: {…} }`     | `{ success: true, data: {…} }`     |
  | `GET /files/:fileId/url`                                                                                                     | `{ url }`           | `{ success: true, data: { url } }` |
  | `PUT /_local/raw/:token`                                                                                                     | `{ ok: true, key }` | `{ success: true, data: { key } }` |

  — while `storage.zod.ts` declared every one of them as
  `BaseResponseSchema.extend({ data })`, and `PresignedUrlResponse` and friends
  are `z.infer`red from those schemas and published as the SDK's return types.
  The declaration said `success: boolean`; the wire said nothing. It broke
  nothing only because the storage SDK methods returned `res.json()` raw —
  `any`, so TypeScript could not see the gap and nothing relied on the
  declaration. That is the posture i18n was in before #3636, right up until
  something did rely on it.

  **The payload moved on two routes, and that is the breaking part.** A direct
  HTTP caller reading `body.url` from `GET /files/:fileId/url` must now read
  `body.data.url`; one reading `body.ok`/`body.key` from the local adapter's
  `PUT /_local/raw/:token` loopback must read `body.success`/`body.data.key`.
  `ok` is dropped rather than kept beside `success` — it was a second, private
  word for the same thing. The six upload routes are additive: callers already
  destructure `.data`, and a new sibling key changes nothing.

  Every in-repo consumer was fixed first, so the two repos are not coupled by
  merge order:

  - `client.storage.getDownloadUrl()` now reads through `unwrapResponse`, the
    SDK's one standard envelope seam — which strips the envelope when present
    and returns the body untouched when not, so a client either side of this
    server change resolves the same URL. The other storage methods hand back the
    whole envelope by design and were already correct.
  - The console's two attachment openers (`RecordAttachmentsPanel`,
    `ApprovalsInboxPage`) already read `body?.url ?? body?.data?.url`; objectui
    gains tests pinning that tolerance as deliberate.

  Two schemas that were missing are now declared — `FileDownloadUrlResponse` and
  `RawUploadResponse` — and `getDownloadUrl` joins `StorageApiContracts`, which
  it had never been in. That absence is how its shape drifted outside the
  envelope unnoticed. The two `_local/raw/:token` routes stay out of the
  registry on purpose: they are the local adapter's own presign loopback,
  ledgered `server-only` and addressed as an opaque signed URL rather than as an
  API.

  `success-envelope.conformance.test.ts` holds the new shape in place the way
  `error-envelope.conformance.test.ts` holds the error one: every route is
  driven and its body parsed against the **declared schema** it answers to — not
  a restatement — the retired shapes are asserted dead, and the module source is
  scanned so a new route cannot bypass the `sendOk` helper. As with #3675, the
  route ledgers cannot catch this class of drift: they audit which routes exist
  and whether the SDK can address them, not what comes back.

- 93be029: test(service-storage): resolve `@objectstack/core` from source, so a stale dist can no longer decide a pin (#7668)

  `packages/services/service-storage` had no `vitest.config.ts`, so its unit suite
  resolved `@objectstack/core` through the workspace link to
  `packages/core/dist/index.js` — a **build artifact**. The verdict of every unit
  pin in the package was therefore a function of build state rather than of the
  source in the checkout.

  #7668 is what that costs. All 17 cases of `attachment-access-hooks.test.ts` —
  the only executable guard on the #4757 predicate-less unscoped-multi-delete
  refusal, which cannot be expressed over REST (`deleteMany` with no `ids`/`where`
  is rejected with 400 before the hook is reached) — errored with
  `TypeError: withoutOperationPrivateKeys is not a function` against a tree whose
  prebuilt core predated that export. The source was correct throughout
  (`packages/core/src/security/operation-private-keys.ts`), so #4757 was left
  unguarded by anything runnable while nothing was actually broken.

  The loud error is the mild half. A core dist that is merely **behind** rather
  than missing the symbol lets a pin run **green** against core's old behaviour —
  a passing test that is not testing the code in the checkout, with nothing in the
  output saying so.

  **Not a task-ordering bug.** `turbo.json` already declares `test` `dependsOn`
  `^build`, and `pnpm turbo run test --filter=@objectstack/service-storage` builds
  core first and passes 352/352; it needed no change. The paths that broke are the
  ones turbo does not mediate — `pnpm test` inside the package, `vitest run <file>`,
  an editor runner, or a QA agent in a tree built at an older commit — and those
  are exactly the paths a pin is re-run on while someone is changing core, i.e.
  when it most needs to be telling the truth. Ordering cannot fix that; taking the
  artifact out of the resolution path can.

  A `vitest.config.ts` now aliases `@objectstack/core` to `packages/core/src`,
  matching what `service-knowledge`, `plugin-audit`, `runtime`, `metadata` and six
  other packages already do. Aliasing is graph-wide, so the dependencies still
  loaded from dist (`spec`, `observability`, `platform-objects`, `objectql`)
  resolve to the same single core instance rather than a second copy; the shared
  tsup config externalizes workspace deps, so none of them inline one. No product
  code and no test assertions changed.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- 1f1edc0: refactor(service-storage): drop `list(prefix)` from the local and S3 adapters — the implementation half of the #5540 contract retirement (#5541)

  `IStorageService.list?(prefix)` was removed from the contract in `@objectstack/spec` 5.x
  (#5540, ADR-0049 enforce-or-remove; analysis #5266). This removes what it left behind:
  the two shipped adapters' own implementations, the tests that pinned them, and the
  `'list'` label in each adapter's metrics vocabulary.

  **Nothing in this repository ever called them.** The only in-repo call site was the
  `SwappableStorageService` pass-through, deleted with the contract member in #5540. After
  that deletion the surviving references were the two adapter methods and their own tests —
  four sites, all inside `@objectstack/service-storage`, all of them producers. REST, the
  CLI, the storage routes, the attachment/file-reference lifecycles and the backfill
  tooling never called `list` on either adapter, on the swappable proxy, or on the
  `file-storage` service. #5172 came closest and walked away: it planned to reclaim email
  attachments by listing `EMAIL_ATTACHMENT_KEY_PREFIX`, found the local adapter could not
  see one level down, and switched to queue-driven deferred work instead.

  **What the two implementations actually did**, which is why aligning them was rejected:

  | Adapter               | Answered `list('a')` with                                                                                                                                                                                                      |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `LocalStorageAdapter` | one level of `readdir` — a nested key `a/b/c` was invisible, you got `a/b` — and every subdirectory `stat` succeeded on was returned as if it were a file, so `size` was a directory inode and `download()` could not fetch it |
  | `S3StorageAdapter`    | a recursive `ListObjectsV2` that read neither `IsTruncated` nor `ContinuationToken`, so past 1000 objects the "all files under this prefix" you got was the first page, indistinguishable from a complete answer               |

  One contract method, two dialects, both silently incomplete, no signal on either.

  **Migration.** Callers holding the contract type were already migrated by #5540 — the
  member is gone from `IStorageService`, so `storage.list(...)` stops type-checking there.
  This release also removes the method from the **concrete** classes, so a caller holding a
  `LocalStorageAdapter` or `S3StorageAdapter` directly loses it too:

  | Wrote                                                    | Write instead                                                                                                                                               |
  | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `new LocalStorageAdapter(...).list('attachments/task/')` | query the records you wrote — `sys_file` / file-reference rows carry the storage key and page deterministically through ObjectQL                            |
  | `new S3StorageAdapter(...).list(prefix)`                 | same; for a genuine bucket sweep, call `ListObjectsV2` through the AWS SDK yourself and handle `ContinuationToken`, which is the part the adapter never did |
  | a custom adapter of your own with `list?(prefix)`        | nothing breaks — an extra method on a class is not a type error; delete it whenever it suits you                                                            |

  Querying your own records is not a workaround for the missing method. It is the only form
  that was ever correct on both backends and past 1000 objects: the bucket was never the
  system of record for "which files exist" — the rows are.

  **If enumeration ever comes back, it comes back cursor-shaped.** Not this signature. A
  prefix listing that cannot paginate is the wrong shape to inherit, so a future
  first-party need returns `list(prefix, { cursor, limit })` — a page plus a continuation
  token — with adapter-conformance cases (nested keys, directory entries, more than 1000
  objects) proving both backends agree _before_ either ships. Maintainer ruling 2026-08-05
  on #5266 chose this over aligning the two adapters, which would have grown a conformance
  surface nobody walks.

  Patch rather than major: the contract break was #5540's and shipped there. `tsc` cannot
  see this one — a class may carry members its interface does not declare, which is exactly
  why the #5540 changeset told adapter authors that leaving an implementation in place
  still compiles — so the absence is held by a runtime pin,
  `storage-adapter-list-retirement.test.ts`, instead.

- efcd68c: **The storage adapter stops being rebuilt and re-pointed on every boot, and the
  "files may be unreachable" warning stops firing at a healthy server (#4096).**

  Every `os dev` / `os serve` boot printed:

  ```
  WARN StorageServicePlugin: storage adapter swapped (LocalStorageAdapter →
  LocalStorageAdapter). Existing files were NOT migrated and may be unreachable
  through the new adapter.
  ```

  The warning was telling the truth. `serve` constructed the plugin with
  `{ driver: 'local', root }` — and `StorageServicePluginOptions` declares
  neither key. Both were dropped silently, so the plugin applied its own
  `./storage` default, `OS_STORAGE_ROOT` changed nothing, and uploads landed in a
  directory nobody named. The `storage` settings namespace then corrected the root
  on its first read (its manifest default is `./.objectstack/data/uploads`),
  genuinely moving the backing store — every boot, forever.

  Three fixes, because there were three defects:

  - **`serve` now passes options the plugin reads** — `{ adapter: 'local',
local: { rootDir } }`. `OS_STORAGE_ROOT` takes effect, and local uploads land
    under `.objectstack/data/uploads` from the first byte instead of `./storage`.
    Extracted as `resolveStorageCapabilityArg` so the option SHAPE is pinned by
    tests: a mismatch like this type-checks fine and does nothing at runtime.
  - **A swap is skipped when nothing changed.** The plugin records what the
    running adapter points at and compares resolved configurations, instead of
    rebuilding whenever the settings namespace held any value at all — which is
    every boot once that namespace has persisted its own defaults.
  - **The warning now means what it says.** It fires when the BACKING STORE moved
    (kind change, different root, different bucket/region/endpoint), not merely
    when the adapter object was replaced. A credential rotation swaps the adapter
    so the new key takes effect and logs at info: same bucket, nothing stranded.
    A swap from a caller that resolved no target still warns — ignorance must not
    silence it.

  Path spellings are normalised, so the platform writing the same default two ways
  (`./.objectstack/data/uploads` in the settings manifest,
  `.objectstack/data/uploads` in the CLI) is no longer read as a migration between
  a directory and itself.

  Verified on `examples/app-todo`: the boot-diagnostics block went from four
  warnings to three, with the storage line gone and `./storage` no longer created.
  19 unit cases cover the target resolver and the swap/warn split (including the
  refusals), 4 plugin-level cases pin what a boot does and says, and 7 pin the CLI
  option shape.

  `config.storage` authored with the `driver`/`root` dialect is still forwarded
  verbatim and still not read by the plugin — the same mismatch one layer up.
  Correcting it means deciding whether the plugin accepts that dialect or the
  config schema is wrong, so it is filed rather than papered over with a lenient
  alias here (AGENTS.md Prime Directive #12).

- 0bc685a: fix(storage): downloads carry the real filename + content-type, not the URL token (#3504)

  A presigned download served the bytes as `application/octet-stream` with no
  `Content-Disposition`, so a browser saved the file under the opaque URL token
  (e.g. `eyJrIjoiYXR0YWNo…`) instead of its real name — an approval's
  `signed-contract.pdf` downloaded as a nameless blob.

  - `IStorageService.getSignedUrl` / `getPresignedDownload` take an optional
    `PresignedDownloadOptions` (`filename`, `contentType`, `disposition`).
  - The REST download routes (`GET /storage/files/:id/url` and `/:id`) pass the
    `sys_file` record's `name` + `mime_type`.
  - The local adapter carries them in the signed token; the `_local/raw` route
    emits `Content-Type` + an RFC 5987 `Content-Disposition` (ASCII fallback +
    `filename*=UTF-8''…` for non-ASCII names). The S3 adapter bakes the same into
    the signed URL via `ResponseContentType` / `ResponseContentDisposition`.
  - Default disposition is `inline`, so previewable types (PDF, images) still open
    in the browser — now with the correct name when saved.

- 68dea0b: feat(platform-objects,service-storage,cli): `sys_migration` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the storage service (#4243)

  The deployment-level data-migration flag ledger (`sys_migration`, #3617) was
  registered by `@objectstack/service-storage` as its first consumer. That was
  deliberate while the file migration was the only consumer, but the ledger now
  gates storage-independent behaviour too — `os migrate value-shapes` (#4235)
  and the fresh-datastore attestation (#4215) — and a non-file migration had to
  boot the whole storage plugin just so the kernel carried the table. Any kernel
  assembled without storage silently had no ledger at all, which read exactly
  like "migration not run" (both answer false) while actually meaning "ledger
  not installed".

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the ledger exists with the
  platform, independent of which optional services are composed. The
  fresh-datastore attestation (#3438, ADR-0104) moves with it: it is ledger
  bookkeeping, and its old home justified itself as "the service that registers
  `sys_migration`". Definition ownership is unchanged (`sys_migration` stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`); the
  flag helpers and readers are untouched.

  Consequences:

  - `@objectstack/service-storage` no longer contributes `sys_migration` to the
    manifest and no longer performs the fresh-datastore attestation. An embedder
    composing `StorageServicePlugin` on a hand-built kernel that relied on it
    for the ledger must compose `PlatformObjectsPlugin` (the plugin every
    supported assembly path already includes).
  - The CLI's `buildDataMigrationPlugins()` no longer boots storage for every
    gated migration — it registers `PlatformObjectsPlugin` always, and settings
    - storage only for `os migrate files-to-references` (`{ storage: true }`),
      the one migration that actually reconciles against the storage adapter.

- 0dcbc11: storage: `sys_upload_session.status` `failed` / `expired` now have producers

  Both statuses were declared on the object, reaped on by the retention backstop
  (`onlyWhen: { status: { $in: ['completed', 'failed', 'expired'] } }`), and
  published to clients by `UploadProgressSchema` — while nothing in the service
  ever wrote either one. A scan of every session row could only return
  `in_progress` / `completed`, so retention named two states the system could not
  enter. Under ADR-0049 (enforce-or-remove) this takes the enforce branch:
  removing them would have forked the object from the spec's progress contract,
  and the two failure states they name are real.

  - **`failed`** — a chunked completion whose backend `completeChunkedUpload`
    threw left the row at `completing`: a non-terminal status the 7d retention
    backstop never reaped, and one a progress poll reported as "still assembling"
    forever. The completion route now stamps `failed` on that path. It records an
    attempt rather than locking the session — a retry of the same `uploadId` runs
    the happy path and overwrites it with `completed`.
  - **`expired`** — a session past its own `expires_at` kept answering
    `in_progress` and kept accepting chunks until the TTL sweep deleted the row
    out from under the caller, so the deadline the init response already announced
    (`expiresAt`) bound nothing. A chunk `PUT` or a `complete` against an
    overdue session is now refused with **410 `UPLOAD_SESSION_EXPIRED`** (new code,
    registered under `@objectstack/service-storage` in `ERROR_CODE_LEDGER`) and the
    row is durably stamped `expired`. `GET .../progress` reports the status instead
    of refusing — `expired` is a declared member of `UploadProgressSchema.status`,
    and the SDK's `resumeUpload` reads progress first.

  A session with no `expires_at` carries no declared deadline and is left alone,
  and a `completed` row does not become `expired` by waiting for the reaper.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [c44dd5e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [5fa04fb]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [9aa5510]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/observability@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 06be54e: fix(objectql): a value admitted by an `OS_ALLOW_LAX_*` escape hatch stops released field files from being collected (#4797)

  `recordDataMigrationRun`'s contract says a deployment whose data has regressed
  since it last verified closes its own gate. That only happened when a migration
  was re-run — nothing told the ledger when the data actually regressed.

  Normally nothing has to. Once `sys_migration` records a verified ADR-0104
  migration the write path is strict, a non-conforming value is refused, and the
  certificate cannot go stale. **The operator escape hatches are the exception,
  and they exist precisely to relax a deployment that has already verified.** With
  `OS_ALLOW_MEDIA_VALUES` / `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`
  on, a non-conforming value is admitted and persisted while the row still reads
  `verified_at` non-null, `blocking: 0`. Turn the switch off — or let any other
  process or machine run without it — and strict returns to reject the very data
  this deployment stored. Meanwhile the `adr-0104-file-references` row also governs
  reclamation of released field files, so the reap guard kept **deleting bytes** on
  the strength of a certificate that was no longer true, with nothing in the ledger
  saying so.

  **A lax-admitted write now records a deviation.** The engine's admit path — the
  same sink that already tallies counterexamples for #4769 — stamps
  `sys_migration.deviation_observed_at` (plus a `deviation_detail` naming the
  object, field, type and parse issue) on the migration whose contract the value
  broke.

  **The marker gates the irreversible path, and only that.** Authority is withdrawn
  in proportion to reversibility:

  | behaviour                                 | reversible?                 | predicate                      | while a deviation stands |
  | ----------------------------------------- | --------------------------- | ------------------------------ | ------------------------ |
  | strict value-shape enforcement (#3438)    | a rejected write is retried | `isDataMigrationFlagVerified`  | continues                |
  | tombstoning a released file (#3459 PR-5b) | lifted on re-attach         | `isDataMigrationFlagVerified`  | continues                |
  | reap guard's byte delete                  | **never**                   | `authorisesIrreversibleAction` | **refuses**              |

  A certificate is not a boolean; it is authority over a set of behaviours, and the
  two halves are withdrawn on different evidence. One admitted write is a complete
  disproof of "nothing here violates this contract" — enough to stop deleting data
  forever. It is _not_ evidence of the same order as the full-store scan that
  earned the certificate, so it does not revoke it: doing that would turn an
  explicitly temporary switch into a one-way door, forcing a full re-migration on
  anyone who used the escape hatch once.

  Recording without gating was rejected for the opposite reason — a marker no code
  consumes is a declared-but-unenforced field, and the bytes get deleted regardless.

  **Getting back to full authority is the documented route.** A real
  `os migrate files-to-references --apply` / `os migrate value-shapes --apply` run
  walks the whole store again, which _is_ evidence of the same order, and clears
  the marker.

  Additive and backward compatible. A `sys_migration` row written before these
  columns existed reads as "no deviation observed", so upgrading never retroactively
  closes a gate a deployment earned — the marker only ever closes it on an observed
  deviation. `isDataMigrationFlagVerified` is unchanged and keeps its existing
  consumers; the new `authorisesIrreversibleAction` (spec) and `mayActIrreversibly`
  (platform-objects) are the stronger pair, and the reap guard is their one caller.

- 20526f5: feat(spec,service-storage): restore prefix enumeration cursor-shaped — `IStorageService.list(prefix, { cursor, limit })` (#6781)

  `list?(prefix): Promise<StorageFileInfo[]>` was retired in #5540 / #5541 on the
  measurement "nothing in the repo calls either". True for this repo, false one repo
  over: `cloud` has two production callers — tenant attachment reclamation on
  environment delete (cloud#935 is the incident where that sweep silently did nothing)
  and marketplace snapshot GC. Both retirement notes reserved exactly one route back,
  word for word, and this is it (maintainer ruling on cloud#1203, option B).

  **The new member is the reserved shape, not the old one restored.**

  ```ts
  list?(prefix: string, options?: StorageListOptions): Promise<StorageListPage>;

  interface StorageListOptions { cursor?: string; limit?: number }
  interface StorageListPage { items: StorageFileInfo[]; nextCursor?: string }
  ```

  The two defects #5266 measured in the old signature are now unrepresentable:

  | #5266 defect                            | Why it cannot recur                                                                                                                                                      |
  | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | S3 truncated at 1000 objects, no signal | A page carries `nextCursor` **iff** more remains. The 1000 is now the default `limit`, and a capped page says so instead of looking complete.                            |
  | local listed one level, S3 recursed     | One prescribed semantics — raw key-string prefix, matched recursively — asserted against **both** backends from one table in `storage-adapter-list.conformance.test.ts`. |

  **Semantics every adapter must implement** (`IStorageService.list` carries the full
  text): raw key prefix, so `list('a')` returns `a/b/c` _and_ `ab.txt` and a trailing
  slash is what scopes to a folder; files only, with filesystem directories and S3
  zero-byte directory markers both skipped; ascending key order; pages full except the
  last; `nextCursor` iff more remains; no duplicates and no gaps across a run.

  **`limit` and `cursor` are refused, never coerced** — `VALIDATION_ERROR` / 400
  (ADR-0112). The validator and the cursor codec live on the _contract_
  (`resolveStorageListLimit`, `encodeStorageListCursor`, `decodeStorageListCursor`), not
  in each adapter, so two backends cannot answer the same bad argument two ways. A
  consequence worth knowing: a cursor means one thing everywhere — "resume after this
  key" — so both shipped adapters issue byte-identical cursors and a
  `SwappableStorageService` adapter swap mid-sweep resumes instead of restarting.

  **Additive.** `list` stays OPTIONAL, like every other capability on this contract: a
  third-party adapter that cannot enumerate is unaffected and still compiles. Making it
  required would be a major-version act, and enumeration is genuinely optional for a
  backend.

  Shipped with it: the S3 adapter loops `ListObjectsV2` with `ContinuationToken` inside a
  single call so a `limit` past the 1000-key `MaxKeys` ceiling is served in full, and
  resumes across calls with `StartAfter`; the local adapter emulates the S3 key space with
  a pruned walk whose memory is bounded by `limit` rather than by the size of the tree;
  `SwappableStorageService` forwards it. `storage-adapter-list-retirement.test.ts` is
  renamed to `storage-adapter-list-contract.test.ts` and **flipped** rather than deleted —
  it used to hold "the retired shape has not crept back", it now holds "both adapters
  carry the restored member, in the cursor shape and not the array one".

  ADR-0087 note: the `storage-service-list-retired` ledger entry is amended, not withdrawn.
  The single-argument `list(prefix)` stays retired and a call written against it still
  fails to compile; what changed is the entry's `replacement`, which said "no replacement"
  and would otherwise have shipped in the same release as the replacement — sending an
  upgrader to hand-roll S3 pagination, which is precisely the option the ruling rejected.

### Patch Changes

- 2e4274d: fix(service-storage): forward the caller's full execution envelope to the `sys_attachment` sharing gates (#7145)

  `callerContext()` in `attachment-access-hooks.ts` rebuilt a five-field
  projection of the caller's `ExecutionContext` (`userId` / `tenantId` /
  `positions` / `permissions` / `isSystem`) before handing it to
  `ISharingService.canEdit`, whose contract declares the **full** envelope and
  whose doc block tells callers they "MUST NOT rebuild a subset of it" (#6523 /
  the #6206 ruling). This is the same defect PR #7143 fixed for the `sys_comment`
  kit (#7141), one package over — the attachment kit is what the comment kit was
  derived from.

  The projection was doing two jobs at once and only one of them was correct:

  - **Dropping the middleware-private keys was correct**, and is preserved.
    plugin-security's middleware stamps the access DEPTH it resolved for the
    object of the operation in flight — `sys_attachment` here — onto the context
    in place (`sc.__readScope = …`), while these gates ask the sharing service
    about the **parent record's** object. Forwarding that whole would hand one
    object's widening to another object's owner-match, the stale-scope leak
    `resolveWriteScopeForSharing` was extracted to prevent. The keys are now
    dropped by the `__` **prefix** rather than by name, which also covers the
    engine's other operation-private markers on that channel (`__expandRead`
    waives the object-level CRUD check, `__referentialFieldClear` the
    referential-clear write) and cannot go stale when a fifth key is added.
  - **Dropping the principal fields was the defect.** Two of them decide the
    verdict these gates then trust:

    - `onBehalfOf` — `ISecurityService.hasWriteBypass`, the `modifyAllRecords`
      probe `SharingService.canEdit` consults last, is documented to fail CLOSED
      on a delegated context and implements that by reading exactly
      `context?.onBehalfOf?.userId`. Stripped, the guard could never fire on the
      attachment path, and the `/mcp` OAuth agent principal that
      `resolve-execution-context` builds _with_ the delegation link reached the
      bypass probe looking like an ordinary direct call.
    - `principalKind` — `resolvePermissionSetsForContext` keys the ADR-0090 D10
      rule "an agent's grants are EXACTLY its scope-derived ceiling" on
      `principalKind === 'agent'`. Stripped, the additive human baseline was
      appended to an agent's ceiling here, so the sets the bypass probe evaluated
      were a superset of what the user consented to.

    `systemPermissions`, `accessible_org_ids`, `posture`, `audience` and
    `rlsMembership` were dropped by the same projection and are forwarded now for
    the same reason.

  Both `canEdit` call sites are covered — the `beforeInsert` parent gate and the
  `beforeDelete` per-row authorization loop — and the same
  envelope-minus-private-keys rule is applied to the read middleware's
  parent-visibility probe, which spread the whole operation context into a `find`
  on a different object.

  No access depth is synthesised for the parent object: absent depth leaves the
  sharing owner-match at its narrowest (`own`), which is the safe direction and
  byte-for-byte what the projection produced. Resolving the parent's own depth
  would WIDEN these gates and is deliberately left to the separate decision
  tracked as #7144.

  Enforcement effect: a delegated (`onBehalfOf`-carrying) principal is now refused
  where the contract says it is refused. No caller gains access.

- db59e9c: hooks: drop the last three `doc` / `previousDoc` alias reads on a hook context — read the engine's own keys only

  Behaviour is unchanged: every one of these limbs guarded against a producer that
  has never existed, so none of them could be reached.

  - `service-storage` attachment lifecycle read `ctx.result ?? ctx.input.doc ?? ctx.input.data`
  - `plugin-sharing` primary-BU projection read `(ctx.input.data ?? ctx.input.doc).user_id`
  - `runtime`'s hook sandbox read `engineCtx.input ?? engineCtx.doc` and `engineCtx.previous ?? engineCtx.previousDoc`

  Every ObjectQL write context spells the payload `data` — measured and pinned by
  `hook-input-shape-contract.test.ts` in `@objectstack/objectql` ("insert carries
  `data` — never `doc`", #5273). The top-level pair is the same family one level
  up: `HookContextSchema` declares `input` / `result` / `previous` and neither a
  `doc` nor a `previousDoc`, and `engine.ts` — the sole producer of a HookContext
  — builds neither. The limbs survived only because the old `HookContext.input`
  contract table documented insert as `{ doc, options }`; that table was corrected
  in #5668, and the same alias was removed from `trigger-record-change` in #5671.
  These are the remainder (#5906), removed rather than left as a second de-facto
  contract (PD #12).

- fc3a36a: fix(spec,objectql,sharing,storage): a hook can tell a per-row bulk dispatch from a single-record write again (#6966)

  A predicate (`multi: true`) write dispatches its lifecycle hooks **once per
  matched row** — `after*` since #5038, `before*` since #5574 — on a context
  deliberately indistinguishable from a single-id write's, so a handler written
  for one record works unchanged on a batch. That indistinguishability is the
  feature, and it also erased the only signal several handlers had.

  Before #5574 a bulk `before*` fired once with `input.id` present-but-`undefined`,
  so "`input.id` is empty" meant "this call stands for N rows". Guards across the
  platform were written on it. Every one of them **silently inverted** rather than
  failing: a per-row context has an id, so the guard now answers "single write" for
  every row of a batch. Two further assumptions broke with it — that the engine
  reuses one `HookContext` across a write's before/after pair, and that `after*`
  work keyed on the write's row set runs once.

  ### New: `HookContext.dispatch`

  The engine now states the fact rather than leaving it to be inferred:

  ```ts
  ctx.dispatch; // { mode: 'record' | 'per-row', index: number, scope: object } | undefined
  ```

  - `mode` — `'record'` when the call is the caller's whole write; `'per-row'`
    when it is one of N.
  - `index` — position in the fan-out. `index === 0` is how a handler does
    batch-scoped work once instead of N times.
  - `scope` — scratch shared by **every** dispatch of one write, both phases, same
    object identity. This is the seam handlers used to get by stashing on the
    context itself, which only ever worked because a single-id write reuses one
    context across its pair.

  Bound at every write dispatch site — insert, update, delete, both phases.
  Optional, and an absent marker reads as "not a per-row dispatch", so a handler
  reads `ctx.dispatch?.mode === 'per-row'` and existing code keeps its behaviour.
  Reads carry no marker: a read has no fan-out.

  It is deliberately **not** the `isPredicateBulkWrite` discriminator #5574
  retired. That one was removed under ADR-0049 for having neither a producer nor a
  reachable consumer — it inferred "bulk" from `input.id` and `options.multi` at
  the consumer, which is exactly what `asScalarId` stays unexported to prevent
  (#4434 / #4550). This one is produced by the engine at the point the dispatch
  ladder is decided, and the platform's own handlers read it.

  ### Behaviour fixed

  **Sharing rules and the record-share cascade (`@objectstack/plugin-sharing`).**
  The `before*` hook stashes the write's affected row set for the `after*` hook to
  act on. On a predicate write that stash was landing on a per-row context the
  `after` phase never saw, so `readAffectedRows` answered `resolve-failed` and both
  subscribers took their safe branch: every bulk update or delete on a ruled object
  revoked **all** of that object's rule grants and queued a full asynchronous
  re-grant — once per matched row, with the repeats racing each other's re-grants.
  Access was never widened (the trade is the ruling's "over-granting is an
  incident, under-granting is a wobble" direction), but a bounded write now takes
  the bounded path again: the rows are unioned as the engine hands them over, the
  cap still applies to the union, and the `after*` work runs once per write.

  **File-reference ownership (`@objectstack/service-storage`).** The `beforeDelete`
  hook that pre-resolved ids for a `where`-shaped delete was dead on every path,
  and `afterDelete` was falling back to one `sys_file` lookup **per row** where the
  batch fits one `$in`. Both are fixed by the marker, and the pre-resolution query
  is gone entirely — the engine has already matched the rows and hands them over.
  The `beforeUpdate` copy-on-claim pass no longer runs once per row against a
  batch-scoped payload, which also removes a row-conditioned rewrite of a shared
  `SET` clause (out of contract under ADR-0058 Addendum II D3).

  No authored metadata changes, and no write's result, event or return contract
  changes.

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

- a5302c7: fix(service-storage): a predicate update writing a file field is refused, instead of giving N records one file id (#7102)

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

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [5fa04fb]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/observability@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- 718b229: fix(service-storage)!: a `sys_file` / `sys_upload_session` write that never landed no longer reports success (#5216)

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
    layer answers 404, unchanged). An engine that _throws_ now propagates:
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

  There is nothing to migrate: no deployment can have been _relying_ on the old
  behaviour, because the old behaviour produced no signal to rely on. What a
  deployment may newly _see_ is a 500 that was previously an undetected data loss.
  `StorageMetadataStoreError` and the `StorageMetadataOperation` type are exported
  from `@objectstack/service-storage` for callers that want to tell a metadata
  outage apart from any other 500.

### Patch Changes

- 1f1edc0: refactor(service-storage): drop `list(prefix)` from the local and S3 adapters — the implementation half of the #5540 contract retirement (#5541)

  `IStorageService.list?(prefix)` was removed from the contract in `@objectstack/spec` 5.x
  (#5540, ADR-0049 enforce-or-remove; analysis #5266). This removes what it left behind:
  the two shipped adapters' own implementations, the tests that pinned them, and the
  `'list'` label in each adapter's metrics vocabulary.

  **Nothing in this repository ever called them.** The only in-repo call site was the
  `SwappableStorageService` pass-through, deleted with the contract member in #5540. After
  that deletion the surviving references were the two adapter methods and their own tests —
  four sites, all inside `@objectstack/service-storage`, all of them producers. REST, the
  CLI, the storage routes, the attachment/file-reference lifecycles and the backfill
  tooling never called `list` on either adapter, on the swappable proxy, or on the
  `file-storage` service. #5172 came closest and walked away: it planned to reclaim email
  attachments by listing `EMAIL_ATTACHMENT_KEY_PREFIX`, found the local adapter could not
  see one level down, and switched to queue-driven deferred work instead.

  **What the two implementations actually did**, which is why aligning them was rejected:

  | Adapter               | Answered `list('a')` with                                                                                                                                                                                                      |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `LocalStorageAdapter` | one level of `readdir` — a nested key `a/b/c` was invisible, you got `a/b` — and every subdirectory `stat` succeeded on was returned as if it were a file, so `size` was a directory inode and `download()` could not fetch it |
  | `S3StorageAdapter`    | a recursive `ListObjectsV2` that read neither `IsTruncated` nor `ContinuationToken`, so past 1000 objects the "all files under this prefix" you got was the first page, indistinguishable from a complete answer               |

  One contract method, two dialects, both silently incomplete, no signal on either.

  **Migration.** Callers holding the contract type were already migrated by #5540 — the
  member is gone from `IStorageService`, so `storage.list(...)` stops type-checking there.
  This release also removes the method from the **concrete** classes, so a caller holding a
  `LocalStorageAdapter` or `S3StorageAdapter` directly loses it too:

  | Wrote                                                    | Write instead                                                                                                                                               |
  | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `new LocalStorageAdapter(...).list('attachments/task/')` | query the records you wrote — `sys_file` / file-reference rows carry the storage key and page deterministically through ObjectQL                            |
  | `new S3StorageAdapter(...).list(prefix)`                 | same; for a genuine bucket sweep, call `ListObjectsV2` through the AWS SDK yourself and handle `ContinuationToken`, which is the part the adapter never did |
  | a custom adapter of your own with `list?(prefix)`        | nothing breaks — an extra method on a class is not a type error; delete it whenever it suits you                                                            |

  Querying your own records is not a workaround for the missing method. It is the only form
  that was ever correct on both backends and past 1000 objects: the bucket was never the
  system of record for "which files exist" — the rows are.

  **If enumeration ever comes back, it comes back cursor-shaped.** Not this signature. A
  prefix listing that cannot paginate is the wrong shape to inherit, so a future
  first-party need returns `list(prefix, { cursor, limit })` — a page plus a continuation
  token — with adapter-conformance cases (nested keys, directory entries, more than 1000
  objects) proving both backends agree _before_ either ships. Maintainer ruling 2026-08-05
  on #5266 chose this over aligning the two adapters, which would have grown a conformance
  surface nobody walks.

  Patch rather than major: the contract break was #5540's and shipped there. `tsc` cannot
  see this one — a class may carry members its interface does not declare, which is exactly
  why the #5540 changeset told adapter authors that leaving an implementation in place
  still compiles — so the absence is held by a runtime pin,
  `storage-adapter-list-retirement.test.ts`, instead.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [f104bab]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/observability@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- 941dec4: fix(service-storage): an UNSCOPED multi-delete of `sys_attachment` is refused instead of authorized (#4757)

  `installAttachmentAccessHooks`'s `beforeDelete` gate resolved the rows a delete
  matches in two ways — by `input.id`, or by `input.options.where` — and then
  short-circuited with `if (!rows.length) return`. A delete carrying **neither**
  an id **nor** a `where` took neither branch, so `rows` stayed empty and the gate
  returned _allow_. That is not "nothing matched": nothing was ever queried.

  The engine reads the same call as a bulk delete over everything — with no
  single id it seeds the delete AST as `{ object }` and hands that to
  `driver.deleteMany` — so `ql.delete('sys_attachment', { multi: true })` emptied
  the whole attachment table with the record-level gate having authorized exactly
  zero rows. Neither layer underneath catches it: plugin-sharing composes no
  row-scoping predicate for an object with no owner field (`sys_attachment`'s
  provenance column is `uploaded_by`), and plugin-security only refuses callers
  whose grants lack the delete bit on `sys_attachment` — an app shipping the
  domain grant the attachments panel requires passes RBAC and lands here.

  The gate now fails **closed** on that shape: no id and no `where` is refused
  with 403 `ATTACHMENT_DELETE_DENIED` ("Refusing an unscoped multi-delete of
  attachments — scope the delete to the rows you mean"), the posture #4630 gave
  `sys_comment` in `resolveTargetRows`. "Nothing to authorize" and "nothing was
  ever queried" are different verdicts, and reading the second as the first is
  fail-open.

  Scoped deletes are unchanged: an id-bound delete, a `where`-bound multi-delete,
  and even `where: {}` (which matches every row but is a real query) still resolve
  their rows and authorize each one uploader-or-parent-editor as before — a delete
  that legitimately matches no row still passes. Only the predicate-less call is
  newly refused. If you were relying on `ql.delete('sys_attachment', { multi:
true })` to clear the table, pass a predicate (`{ multi: true, where: {} }`
  authorizes row-by-row) or perform the sweep under a system context, which
  bypasses the gate as before.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [ff17642]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- b1863a5: feat(storage): released field files enter collection on deployments that verified their file migration — ADR-0104 D3 wave 2 PR-5b (#3459)

  The gated, final step of the file-as-reference sequence. On a deployment whose
  `adr-0104-file-references` flag is verified (`os migrate files-to-references
--apply`, #3617), releasing a field file's ownership — clearing the field, or
  deleting the owning record — now also tombstones the file
  (`status='deleted'` + `deleted_at`), which starts the `sys_file` lifecycle's
  declared 30-day grace window and, at its end, hands the row to the reap sweep.
  Re-referencing the id inside the window revives it, exactly like re-attaching
  an attachment.

  **The two halves ship together, deliberately.** The same change extends the
  reap guard's sweep-time re-verify beyond `sys_attachment` join rows to the
  ownership columns: a tombstoned file whose `ref_*` columns name a current
  owner (re-claimed in the window, or a release/claim race) is un-tombstoned and
  vetoed. Tombstoning released files without that re-verify would have turned
  every release into a _guaranteed_ byte delete — the guard's old check consults
  a table that is always empty for field files. This pairing was the standing
  hard constraint on #3459, locked by regression tests on both halves.

  **Nothing changes for a deployment that has not migrated.** Release keeps
  clearing the ownership columns only, and released files are retained forever.
  Every way of not knowing — no flag row, an unreadable table, an engine that
  cannot be asked — reads as "not verified": the gate fails closed, toward
  retention. And the guard re-reads the flag _fresh_ at sweep time (not the
  release path's memoized read), so a later failing migration run — a database
  that has drifted — closes the gate for already-written tombstones too, without
  a restart. Attachments-scope collection is unchanged and needs no flag.

  The irreversible moment is therefore per deployment: day 30 after _that_
  deployment verified its migration and released a file — never the upgrade
  itself.

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- efcd68c: **The storage adapter stops being rebuilt and re-pointed on every boot, and the
  "files may be unreachable" warning stops firing at a healthy server (#4096).**

  Every `os dev` / `os serve` boot printed:

  ```
  WARN StorageServicePlugin: storage adapter swapped (LocalStorageAdapter →
  LocalStorageAdapter). Existing files were NOT migrated and may be unreachable
  through the new adapter.
  ```

  The warning was telling the truth. `serve` constructed the plugin with
  `{ driver: 'local', root }` — and `StorageServicePluginOptions` declares
  neither key. Both were dropped silently, so the plugin applied its own
  `./storage` default, `OS_STORAGE_ROOT` changed nothing, and uploads landed in a
  directory nobody named. The `storage` settings namespace then corrected the root
  on its first read (its manifest default is `./.objectstack/data/uploads`),
  genuinely moving the backing store — every boot, forever.

  Three fixes, because there were three defects:

  - **`serve` now passes options the plugin reads** — `{ adapter: 'local',
local: { rootDir } }`. `OS_STORAGE_ROOT` takes effect, and local uploads land
    under `.objectstack/data/uploads` from the first byte instead of `./storage`.
    Extracted as `resolveStorageCapabilityArg` so the option SHAPE is pinned by
    tests: a mismatch like this type-checks fine and does nothing at runtime.
  - **A swap is skipped when nothing changed.** The plugin records what the
    running adapter points at and compares resolved configurations, instead of
    rebuilding whenever the settings namespace held any value at all — which is
    every boot once that namespace has persisted its own defaults.
  - **The warning now means what it says.** It fires when the BACKING STORE moved
    (kind change, different root, different bucket/region/endpoint), not merely
    when the adapter object was replaced. A credential rotation swaps the adapter
    so the new key takes effect and logs at info: same bucket, nothing stranded.
    A swap from a caller that resolved no target still warns — ignorance must not
    silence it.

  Path spellings are normalised, so the platform writing the same default two ways
  (`./.objectstack/data/uploads` in the settings manifest,
  `.objectstack/data/uploads` in the CLI) is no longer read as a migration between
  a directory and itself.

  Verified on `examples/app-todo`: the boot-diagnostics block went from four
  warnings to three, with the storage line gone and `./storage` no longer created.
  19 unit cases cover the target resolver and the swap/warn split (including the
  refusals), 4 plugin-level cases pin what a boot does and says, and 7 pin the CLI
  option shape.

  `config.storage` authored with the `driver`/`root` dialect is still forwarded
  verbatim and still not read by the plugin — the same mismatch one layer up.
  Correcting it means deciding whether the plugin accepts that dialect or the
  config schema is wrong, so it is filed rather than papered over with a lenient
  alias here (AGENTS.md Prime Directive #12).

- 68dea0b: feat(platform-objects,service-storage,cli): `sys_migration` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the storage service (#4243)

  The deployment-level data-migration flag ledger (`sys_migration`, #3617) was
  registered by `@objectstack/service-storage` as its first consumer. That was
  deliberate while the file migration was the only consumer, but the ledger now
  gates storage-independent behaviour too — `os migrate value-shapes` (#4235)
  and the fresh-datastore attestation (#4215) — and a non-file migration had to
  boot the whole storage plugin just so the kernel carried the table. Any kernel
  assembled without storage silently had no ledger at all, which read exactly
  like "migration not run" (both answer false) while actually meaning "ledger
  not installed".

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the ledger exists with the
  platform, independent of which optional services are composed. The
  fresh-datastore attestation (#3438, ADR-0104) moves with it: it is ledger
  bookkeeping, and its old home justified itself as "the service that registers
  `sys_migration`". Definition ownership is unchanged (`sys_migration` stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`); the
  flag helpers and readers are untouched.

  Consequences:

  - `@objectstack/service-storage` no longer contributes `sys_migration` to the
    manifest and no longer performs the fresh-datastore attestation. An embedder
    composing `StorageServicePlugin` on a hand-built kernel that relied on it
    for the ledger must compose `PlatformObjectsPlugin` (the plugin every
    supported assembly path already includes).
  - The CLI's `buildDataMigrationPlugins()` no longer boots storage for every
    gated migration — it registers `PlatformObjectsPlugin` always, and settings
    - storage only for `os migrate files-to-references` (`{ storage: true }`),
      the one migration that actually reconciles against the storage adapter.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 99736a0: feat(storage): exclusive field-reference file ownership — ADR-0104 D3 wave 2 (PR-3)

  A `file`/`image`/`avatar`/`video`/`audio` field that holds a `sys_file` id now
  records its owner on the file: `sys_file.ref_object` / `ref_id` / `ref_field`
  name the single `(object, record, field)` slot that references it, maintained on
  the engine write path — claimed on insert, reconciled on update, released when
  the owning record is deleted.

  **Field references are exclusive, unlike attachments.** The attachments surface
  deliberately shares one file across many `sys_attachment` join rows; a field
  reference is owned by at most one slot, and writing an already-owned id into a
  second slot **copies the bytes into a fresh `sys_file`** rather than sharing the
  row. That keeps a file's read authorisation derived from exactly one parent
  record instead of the union of every referrer's — so copying a private record's
  file id into a world-readable one cannot silently widen access — and it removes
  reference counting from the lifecycle entirely: a file is released because its
  one owner let go, never because a count came back zero.

  **Deletes nothing.** This records and releases ownership; it never tombstones,
  and the `scope === 'attachments'` guardrail that keeps field-referenced files
  out of the reap is untouched. Collection is a separate, gated change that must
  also extend the reap guard's sweep-time re-verify in the same commit.

  Also exports `isFileIdToken` from `@objectstack/spec/data` as the single arbiter
  of "is this stored string an opaque file id, or a legacy/external URL?", now
  shared by the read resolver and the write claimer so the two cannot drift.

  Dormant until a field actually holds an id token: objects without file-class
  fields, inline-blob values and URL-shaped values all exit before any I/O.

- 134df4f: feat(storage): governed download for field-owned files — ADR-0104 D3 wave 2 (PR-4)

  A file owned by a record's field (`sys_file.ref_object` / `ref_id`, set by
  PR-3) is now authorized on download the same way an attachment is: the caller
  must be able to READ the file's parent record, or be its uploader. Previously
  only `attachments`-scope files were gated and every field file kept an
  anonymous capability URL.

  **Parent resolution differs by surface, and that asymmetry is the point.** An
  attachment may hang off many records, so its readable-by set is the union over
  its `sys_attachment` join rows. A field-owned file belongs to exactly one
  record, so its readable-by set is that one record's — nothing more. Under a
  shared reference model the field case would have had to union too, which is
  what makes copying a file id into a more public record silently widen access.

  Denials are reported as `FILE_DOWNLOAD_DENIED` (403), distinct from the
  attachments path's `ATTACHMENT_DOWNLOAD_DENIED`, since the file _belongs to_ one
  record rather than being _attached to_ several.

  **`acl: 'public_read'` is the opt-out**, and now an explicit declaration rather
  than the silent default every field file used to get. Genuinely public images —
  anything embedded in an `<img src>`, which cannot carry a bearer token — must
  declare it.

  **Dual-mode safe, gates nothing that is open today.** A pre-cutover field holds
  an inline blob or an external URL, never a `sys_file` id, so no existing file
  has an owner recorded and none of them start being gated. The gate engages only
  for files a record's field has actually claimed, and disengages again when
  ownership is released.

  ***

  Also adds `verifyFileReferences()` — the executable form of ADR-0104's R4
  acceptance gate. It compares ground truth (what records' file fields actually
  hold) against recorded ownership, and classifies disagreements by whether they
  could cause data loss once collection is enabled:

  - **blocking** — `unowned_reference` (a held file nothing owns), `foreign_owner`
    (a record holds a file owned by another slot), `shared_reference` (one file
    held by two slots, i.e. exclusivity was violated). Each would let a later reap
    delete bytes a record still points at.
  - **advisory** — `stale_owner` (owned but no longer held; fails toward
    retention) and `unreferenced_file` (storage cost, not a correctness problem).

  The scan is read-only — it never writes, tombstones, or deletes. A ledger may
  not be given authority over irreversible deletes until it has been shown to
  agree with reality, so this must report zero blocking discrepancies on real
  tenant data, on consecutive runs, before the gated collection change may merge.

- fe67e34: feat(spec)!: media fields declare accept/maxSize, and the stored form is a file reference — ADR-0104 D3 wave 2 (PR-5a)

  **`accept` and `maxSize` are now declared on `FieldSchema`, and enforced on the
  server.** Both were already read by the upload widgets — `field.accept`,
  `field.maxSize` — while the spec did not declare them, so an author who wrote
  them had the keys silently stripped at parse and the constraint simply never
  existed. That is exactly the ADR-0104 failure class (a declaration accepted in
  source, dropped from the contract, with no feedback).

  Now that the platform owns the file, `sys_file` carries the authoritative MIME
  type and byte size, so a record write is re-checked against the declaration
  where it actually binds rather than only in the browser — a client-side check is
  a convenience, not a control, since any caller talking to the API directly
  bypasses it. Violations raise `FileConstraintError` and fail the write. An entry
  is only judged against metadata the file actually reports: a file with no
  recorded MIME type cannot fail an `accept` test, and one with no recorded size
  cannot fail `maxSize` — "we don't know" must not become "not permitted".

  **The stored form of a media field narrows to an opaque `sys_file` id.**
  `valueSchemaFor(field, 'stored')` now yields an id for `file`/`image`/`avatar`/
  `video`/`audio`; the inline `{url, name, size, …}` blob becomes the `'expanded'`
  read form, which also still admits an unresolved id (storage service absent,
  file not committed) exactly as an unexpanded lookup id stays valid.

  Two legacy forms therefore stop conforming, both deliberately:

  - the **inline blob**, which is no longer stored but derived;
  - an **external URL**, which was never a managed file — ADR-0104 R7 retires it
    toward an explicit `url` field, and under AI authoring that is the point: it
    stops "managed file" and "external link" being the same declaration.

  **Not a breaking change today.** Value-shape checking is warn-first
  (ADR-0104 R1/R2): a not-yet-backfilled row still writes and the author gets a
  warning naming the field. Hard rejection arrives only when a deployment opts
  into `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` — which it should do after running the
  backfill and confirming reconciliation. The `!` marks the contract change for
  the v17 window, not a runtime break on upgrade.

- 3d3fddf: feat(storage): legacy file-value backfill — ADR-0104 D3 wave 2 (PR-6)

  `backfillFileReferences()` converts the pre-reference forms a `file`/`image`/
  `avatar`/`video`/`audio` field may hold — an inline metadata blob
  (`{url, name, size, …}`) or a bare URL string — into the reference form: an
  opaque `sys_file` id, owned by the record's field.

  What it will and will not convert:

  - **A URL naming this platform's own resolver** (`…/storage/files/:id`) already
    identifies a `sys_file`; the field is rewritten to the bare id and no bytes
    move.
  - **A `data:` URI** carries its bytes inline; they are uploaded, a `sys_file` is
    registered, and the field is rewritten to its id.
  - **An external URL** is reported, never converted. Re-hosting third-party
    content is a bandwidth, licensing and privacy decision that is not a
    migration's to make — ADR-0104 R7 retires these toward an explicit `url`
    field, which under AI authoring is the point: it stops "managed file" and
    "external link" being the same declaration.

  **Dry run by default** — nothing is written unless `apply` is set, and the
  dry-run report has the same shape as the applied one so the plan can be reviewed
  and diffed. **Idempotent** — a value already in reference form is recorded and
  left alone, so a partially-completed run is safe to repeat.

  The backfill never writes the ownership columns itself: it rewrites the record,
  and the claim hooks observe that write and record ownership. One claiming path,
  so there is nothing that can disagree with itself. Run
  `verifyFileReferences()` afterwards to confirm the two agree — that
  reconciliation is the gate the irreversible collection change must pass.

- fdb4f50: feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

  The ADR-0104 file-as-reference migration ships as a command a deployment runs
  against its own database, and the deployment-level flag it records is what may
  later authorise irreversible behaviour — never the platform version.

  ```bash
  os migrate files-to-references           # dry run: reports, writes nothing
  os migrate files-to-references --apply   # converts, verifies, records the flag
  ```

  The run backfills legacy file-field values (inline metadata blobs, own-resolver
  URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
  ledger against what records actually hold, and — only on an `--apply` run whose
  reconciliation reports **zero blocking discrepancies** — records
  `sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

  **Why a flag rather than a release note.** ObjectStack is a development
  platform: third-party deployments upgrade on their own schedule and their data
  is not observable by anyone else, so no release-side soak can vouch for them.
  The evidence has to be produced where the data is. Consequences:

  - Installing a new version never starts deleting bytes. Running the migration
    and passing its self-check is the consent.
  - Not run, or not passed → files are retained forever. Wasted storage, zero
    data loss.
  - A later failing run **clears** `verified_at`: a deployment whose data has
    drifted closes its own gate.
  - A dry run writes nothing at all — not the conversions, and not the flag,
    even when the self-check would pass.
  - External URLs stay advisory. They are not `sys_file`s, so they can never
    enter collection; whether to remodel them as a `url` field is the app
    author's decision (ADR-0104 R7), not a gate.

  Ships alongside:

  - `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
    and the single `isDataMigrationFlagVerified` predicate both future consumers
    (collection #3459, strict value-shape #3438) read, so the two gates cannot
    disagree about the same fact.
  - `@objectstack/platform-objects` — the `sys_migration` object plus
    `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
    Reads fail toward "not verified": a gate that cannot read its evidence stays
    closed.
  - `@objectstack/objectql` — a read may now opt out of file-reference expansion
    via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
    bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
    their expanded form before the reconciliation sees them, which reports held
    references as absent — noisy `stale_owner` findings, and a missed
    `unowned_reference` would have been a false pass of the collection gate.

### Patch Changes

- 37b1346: feat(storage): surface the sys_file id on upload-complete — ADR-0104 D3 wave 2 (PR-1)

  `POST /api/v1/storage/upload/complete` now returns the opaque `sys_file` id
  (`data.fileId`), and `client.storage.upload()` surfaces it on the returned
  `FileMetadata`. Previously the commit response omitted the id — the caller
  could not learn which id to persist after committing an upload, so a file
  field could never store a reference.

  Additive and non-breaking (new optional `fileId` on `FileMetadataSchema`; the
  client falls back to the presigned id when talking to an older server). This is
  the enabling foundation for file-as-reference; the storage model itself is
  unchanged in this PR.

- deb538f: fix(storage): let an object delegate file-read authorization to its service

  Fixes a regression from the governed-download change (ADR-0104 D3 wave 2): a
  **legitimate approver could see a decision attachment's filename but got 403
  opening it**, found by driving app-showcase in a browser as a real non-admin
  approver.

  Cause: a field-owned file's download was authorized by testing whether the
  caller can READ the owning row. For an ordinary business object that is right —
  row readability _is_ the access rule. For `sys_approval_action` it is the wrong
  authority: the audit table is deliberately closed to ordinary approver
  positions (`operation 'find' … is not permitted for positions [auditor,
everyone]`), so the test denied the very approver the attachment was filed for.
  The approvals _service_ has always had the real rule, which is why the timeline
  listing the attachment returned 200 while the bytes returned 403.

  An object may now name a service to answer the question instead:

  - `ObjectSchema.fileAccessDelegate` — a kernel service that authorizes
    downloads of files owned by that object's media fields.
  - `IFileAccessDelegate.authorizeFileRead(recordId, context)` — the contract.
  - `sys_approval_action` declares `'approvals'`; `ApprovalService.authorizeFileRead`
    reuses the _same_ gate `listActions` applies (visibility of the parent
    request) rather than inventing a second, looser rule for the bytes.

  **Fails closed**: a declared delegate that is missing or does not implement the
  method denies, rather than silently reverting to the raw read it was declared to
  replace. Objects without the declaration are unchanged.

  Verified in the browser against app-showcase, both sides of the gate: the
  approver now downloads the real PDF (200), and an anonymous request is still
  refused (401) — the anonymous capability URL the original change closed stays
  closed. A decision attachment ends up exactly as readable as the decision it
  hangs off: never more, and no longer less.

- 2c19383: fix(service-storage): stop handing out `_local/file/:key`, a URL nothing mounts (#3641)

  Three call sites built `${basePath}/_local/file/<key>`. No registrar has ever
  mounted it, so anyone who followed one got a 404. Found by the tranche-3
  storage ledger (#3636), which recorded the URL as deliberately absent and filed
  this; now nothing builds it either.

  Each site is fixed according to what it could honestly do:

  - **`LocalStorageAdapter.getPresignedUpload()`** simply omits `downloadUrl`
    (optional on the descriptor). It cannot construct the real capability URL —
    that is keyed by `sys_file.id`, and an adapter only ever sees the storage
    key. Nothing read the field anyway, which is how it survived: the
    presigned-upload route builds its own `downloadUrl`
    (`${basePath}/files/:fileId/url`) and ignores this one, while all three real
    readers of `desc.downloadUrl` take it from `getPresignedDownload`, whose URL
    _is_ mounted (`_local/raw/<token>`).

  - **`GET /files/:fileId/url` and `GET /files/:fileId`** answer **501
    `NOT_IMPLEMENTED`** when the adapter has neither `getPresignedDownload` nor
    `getSignedUrl`, instead of returning (or redirecting to) the unmounted URL.
    The caller now learns the adapter is the limitation rather than chasing a
    broken link.

  Behaviour change is confined to adapters implementing neither capability —
  `LocalStorageAdapter` and the S3 adapter both implement `getPresignedDownload`,
  so no shipped path changes. A 200/302 pointing at a 404 becomes a 501 that says
  why.

  Two conformance cases added for the new branches, and mutation-checked:
  restoring either dead URL fails them.

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- f1a8114: fix(client,service-i18n): ledger the autonomously-mounted service routes, and repair the two i18n calls that reached nothing (#3636)

  Tranche 3 of the #3563 route audit — the last un-audited server surface. The
  dispatcher ledger (#3563) and the REST ledger (#3587) each stop at their own
  package boundary, and two services mount routes outside both: they reach for
  the `http-server` service and register straight on `IHttpServer`, so neither
  `RouteManager` nor `RestServer.getRoutes()` has ever seen them. That left the
  SDK's entire storage surface, plus all of i18n, in the pre-#3563 posture:
  expressed, working, guarded by nothing.

  **Ledgers + guards.** `storage-route-ledger.ts` (10 routes) and
  `i18n-route-ledger.ts` (3) sit next to the registrars that mount them, each
  enumerated for real — the registrar runs against a capturing mock
  `IHttpServer` and its registration calls _are_ the route set, so a new route
  lands with a reviewed disposition or fails CI. The client half is
  `packages/client/src/service-route-ledger-coverage.test.ts`; ledgers cross the
  boundary as relative source imports, never a service→client package edge.

  **Two wire-level 404s fixed.** `i18n.getTranslations` sent
  `/i18n/translations?locale=xx` and `i18n.getFieldLabels` sent
  `/i18n/labels/:object?locale=xx`, while every serving surface — service-i18n's
  mounts, the dispatcher's HTTP mounts, and the `plugin-rest-api.zod.ts`
  contract — mounts only the path form. Neither call could ever be answered.
  Both had carried a green `sdk` row in the dispatcher ledger since tranche 1,
  because that guard asks whether the client _method_ exists, not whether it
  speaks a URL anything mounts. The client now sends the path dialect, the same
  resolution #3611 gave `meta.getView`, and a new suite drives the real client
  at a real router so a revert cannot pass quietly.

  **One response-shape fix.** service-i18n's success bodies omitted the
  `success` flag that `ObjectStackClient.unwrapResponse` keys on, so the SDK
  returned the raw `{ data: … }` wrapper against that provider while returning
  the declared unwrapped shape against the dispatcher — one method, two shapes,
  decided by which plugin mounted the route. Its three handlers now emit the
  `{ success: true, data }` envelope the `i18n` route group declares. `data` did
  not move, so direct body readers are unaffected.

  Storage audited clean: 7 routes SDK-expressed, 3 reviewed `server-only` (the
  browser capability URL objectql stamps into file-field payloads, and the two
  local-driver loopbacks). The chunked-upload family, flagged for triage, turned
  out fully expressed. Both ledgers ratchet `gap` and `mismatch` at zero.

  Filed, not fixed: `GET {base}/_local/file/:key` is built by three call sites
  and mounted by none (#3641); the cross-surface URL conformance guard that would
  have caught all of the above mechanically is the capstone (#3642).

- bd68f08: fix(service-storage,service-i18n): emit the declared error envelope, not a bare `{ error }` (#3675)

  #3636 aligned the **success** bodies of the autonomously-mounted service
  routes because those were the ones breaking `ObjectStackClient.unwrapResponse`.
  The error bodies were left alone and stayed a bare `{ error: '<message>' }` —
  with the code, where one existed at all, as a _sibling_ of `error` rather than
  a field of it — against a contract (`BaseResponseSchema` + `ApiErrorSchema`)
  that declares `{ success: false, error: { code, message } }`.

  So the same SDK method returned two different error shapes depending on which
  provider mounted the route: a caller reading `body.error.message` got the real
  message from the dispatcher and `undefined` from these services. All 32 sites
  (27 in `storage-routes.ts`, 5 in `i18n-service-plugin.ts`) now go through a
  single `sendError` helper per module — the nested-`error` shape the sibling
  services already use (`settings-routes.ts`, `share-link-routes.ts`), plus the
  `success` flag those two still omit and the contract requires.

  **Codes moved, and that is the breaking part.** `AUTH_REQUIRED`,
  `ATTACHMENT_DOWNLOAD_DENIED` and `FILE_DOWNLOAD_DENIED` used to sit at
  `body.code`; they now sit at `body.error.code`. The SDK is unaffected — it
  already reads `errorBody?.code || errorBody?.error?.code`, one of the four
  shapes its error path sniffs for, which is the consumer-side shim Prime
  Directive #12 says to cure at the producer. The console's attachment panel
  was NOT: it read the top level only, so every gated download would have
  degraded from "You don't have access to download this attachment." to
  "Download failed (403)". Fixed in objectui to read both dialects, since a
  console build ships independently of the server it talks to.

  **Guarded both ways.** New `error-envelope.conformance.test.ts` in each
  service drives every distinct error branch through the real registrar and
  parses the body against the real `BaseResponseSchema` imported from
  `packages/spec` — not a local restatement of it — and scans the module source
  so a new route cannot quietly reintroduce the bare shape. The route ledgers
  (#3563 → #3656) could never have caught this: they audit which routes exist
  and whether the SDK can address them, not what comes back.

  Measured and left alone: the dispatcher does not conform either — it puts the
  HTTP status in `error.code`, where the contract declares a semantic string,
  and parks the real code in `details` to work around its own occupied field.
  That deviation is now pinned to exactly one field by a test in
  `http-dispatcher.test.ts` rather than described in prose. Also unchanged:
  service-storage's success bodies are still three shapes of their own
  (`{ data }`, bare `{ url }`, `{ ok, key }`, none with `success: true`) — a
  non-additive change that needs its own issue, not a quiet ride along with this
  one.

- 6633337: fix(service-storage): emit the declared success envelope on all eight routes (#3689)

  #3675 moved the **error** bodies of the autonomously-mounted `/api/v1/storage/*`
  routes into the declared `{ success: false, error: { code, message } }`
  envelope and deliberately stopped there: unlike the errors, the success bodies
  were not an additive fix. They were three shapes, none of them carrying the
  `success` flag `BaseResponseSchema` declares and
  `ObjectStackClient.unwrapResponse` keys on —

  | Route(s)                                                                                                                     | Was                 | Now                                |
  | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- |
  | the six upload routes (`/upload/presigned`, `/upload/complete`, `/upload/chunked`, `…/chunk/:i`, `…/complete`, `…/progress`) | `{ data: {…} }`     | `{ success: true, data: {…} }`     |
  | `GET /files/:fileId/url`                                                                                                     | `{ url }`           | `{ success: true, data: { url } }` |
  | `PUT /_local/raw/:token`                                                                                                     | `{ ok: true, key }` | `{ success: true, data: { key } }` |

  — while `storage.zod.ts` declared every one of them as
  `BaseResponseSchema.extend({ data })`, and `PresignedUrlResponse` and friends
  are `z.infer`red from those schemas and published as the SDK's return types.
  The declaration said `success: boolean`; the wire said nothing. It broke
  nothing only because the storage SDK methods returned `res.json()` raw —
  `any`, so TypeScript could not see the gap and nothing relied on the
  declaration. That is the posture i18n was in before #3636, right up until
  something did rely on it.

  **The payload moved on two routes, and that is the breaking part.** A direct
  HTTP caller reading `body.url` from `GET /files/:fileId/url` must now read
  `body.data.url`; one reading `body.ok`/`body.key` from the local adapter's
  `PUT /_local/raw/:token` loopback must read `body.success`/`body.data.key`.
  `ok` is dropped rather than kept beside `success` — it was a second, private
  word for the same thing. The six upload routes are additive: callers already
  destructure `.data`, and a new sibling key changes nothing.

  Every in-repo consumer was fixed first, so the two repos are not coupled by
  merge order:

  - `client.storage.getDownloadUrl()` now reads through `unwrapResponse`, the
    SDK's one standard envelope seam — which strips the envelope when present
    and returns the body untouched when not, so a client either side of this
    server change resolves the same URL. The other storage methods hand back the
    whole envelope by design and were already correct.
  - The console's two attachment openers (`RecordAttachmentsPanel`,
    `ApprovalsInboxPage`) already read `body?.url ?? body?.data?.url`; objectui
    gains tests pinning that tolerance as deliberate.

  Two schemas that were missing are now declared — `FileDownloadUrlResponse` and
  `RawUploadResponse` — and `getDownloadUrl` joins `StorageApiContracts`, which
  it had never been in. That absence is how its shape drifted outside the
  envelope unnoticed. The two `_local/raw/:token` routes stay out of the
  registry on purpose: they are the local adapter's own presign loopback,
  ledgered `server-only` and addressed as an opaque signed URL rather than as an
  API.

  `success-envelope.conformance.test.ts` holds the new shape in place the way
  `error-envelope.conformance.test.ts` holds the error one: every route is
  driven and its body parsed against the **declared schema** it answers to — not
  a restatement — the retired shapes are asserted dead, and the module source is
  scanned so a new route cannot bypass the `sendOk` helper. As with #3675, the
  route ledgers cannot catch this class of drift: they audit which routes exist
  and whether the SDK can address them, not what comes back.

- 0bc685a: fix(storage): downloads carry the real filename + content-type, not the URL token (#3504)

  A presigned download served the bytes as `application/octet-stream` with no
  `Content-Disposition`, so a browser saved the file under the opaque URL token
  (e.g. `eyJrIjoiYXR0YWNo…`) instead of its real name — an approval's
  `signed-contract.pdf` downloaded as a nameless blob.

  - `IStorageService.getSignedUrl` / `getPresignedDownload` take an optional
    `PresignedDownloadOptions` (`filename`, `contentType`, `disposition`).
  - The REST download routes (`GET /storage/files/:id/url` and `/:id`) pass the
    `sys_file` record's `name` + `mime_type`.
  - The local adapter carries them in the signed token; the `_local/raw` route
    emits `Content-Type` + an RFC 5987 `Content-Disposition` (ASCII fallback +
    `filename*=UTF-8''…` for non-ASCII names). The S3 adapter bakes the same into
    the signed URL via `ResponseContentType` / `ResponseContentDisposition`.
  - Default disposition is `inline`, so previewable types (PDF, images) still open
    in the browser — now with the correct name when saved.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/observability@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0

## 16.0.0

### Patch Changes

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/observability@16.0.0

## 16.0.0-rc.1

### Patch Changes

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/observability@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [ce468c8]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/observability@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/observability@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(attachments): authenticated, parent-scoped downloads for attachments files (#2970)

  Closes item 2 of #2970. The storage download endpoints (`GET /storage/files/:fileId`
  and `/files/:fileId/url`) were anonymous capability URLs — anyone holding a
  `fileId` could mint a download without a session or any access check.

  For `scope === 'attachments'`, non-`public_read` files, both endpoints now gate
  on a new `authorizeFileRead` seam: `401 AUTH_REQUIRED` without a session, `403
ATTACHMENT_DOWNLOAD_DENIED` when the caller is neither the file's owner nor able
  to READ a record the file is attached to (parent-derived, resolved through the
  full caller context via `resolveAuthzContext`), and otherwise a **short-lived**
  signed URL (`downloadTtl`, default 300s). Non-attachments files (field files,
  avatars, org logos — embedded in `<img src>` which cannot carry a bearer token)
  keep the stable anonymous capability URL, and bare kernels/tests without the
  seam wired stay open (back-compat).

- f531a26: feat(attachments): edit-on-parent attach, upload-session lifecycle, trash=false (#2970 items 3-5)

  Closes the remaining enforce-or-remove / lifecycle items of #2970:

  - **Edit-on-parent for attach (item 3, Salesforce parity).** Creating a
    `sys_attachment` now requires EDIT access to the parent record (via the
    sharing service's `canEdit`), not merely read — public-model parents are
    unchanged (canEdit is true for any member), private/owner-scoped parents
    require the caller to own/edit them. Degrades to read visibility when no
    sharing service is present.
  - **`sys_upload_session` lifecycle (item 4).** Abandoned / terminal chunked
    upload sessions are reaped by the platform LifecycleService (`transient`;
    TTL 1d past `expires_at`; retention 7d for terminal statuses). Row reap
    only — a reap guard that aborts backend multipart uploads for partial S3
    sessions is a filed follow-up.
  - **`sys_attachment.enable.trash` → `false` (item 5, ADR-0049).** The flag is
    `dead` in the liveness ledger (no engine soft-delete reader) and attachment
    deletes are hard (the reap guard reclaims a file's bytes once its last join
    row is gone, so a restore would dangle) — declare the honest state rather
    than claim a restore capability the runtime does not provide.

- f531a26: feat(attachments): sys_attachment read inherits parent-record visibility (#2970)

  Follow-up to #2755. The create/delete gates landed, but a member could still
  LIST `sys_attachment` rows (file_name, size, parent_id) pointing at records
  they cannot read — an information leak, since attachment access derives from
  the PARENT record (Salesforce ContentDocumentLink semantics). `sys_attachment`
  is a public system object with no owner field, so the sharing/RLS static
  predicates never narrowed it.

  `installAttachmentReadVisibility` registers a `sys_attachment`-scoped engine
  **middleware** (not a find-hook) so it filters `find`, `findOne`, `count`, and
  `aggregate` identically — critically, the list `total` (which comes from
  `engine.count()`, never the find path) is filtered too, so it cannot leak the
  count of hidden rows. Generalizing ADR-0055 `controlled_by_parent` to the
  polymorphic parent, each read resolves the visible parent ids per
  `parent_object` through the caller-scoped engine (the parent's own RLS/OWD/
  sharing apply) and ANDs a `$or` of `{ parent_object, parent_id: { $in } }`
  into the query; no visible parent ⇒ a deny-all sentinel. Fails closed on any
  compute error. System / context-less internal reads are not narrowed.

- f531a26: feat(attachments): sys_file orphan lifecycle + parent-derived attachment access (#2755)

  **Orphan lifecycle (ADR-0057).** Deleting a `sys_attachment` join row used to
  orphan the backing `sys_file` row and its storage bytes forever. `sys_file`
  now declares a lifecycle (`ttl 30d` on a new `deleted_at` tombstone for
  orphans; `retention 7d onlyWhen status=pending` for abandoned uploads), the
  storage plugin's new hooks tombstone a file when its LAST join row is deleted
  (attachments scope only — `Field.file`/`Field.image`/avatar scopes are never
  touched) and un-tombstone on re-attach, and a new LifecycleService **reap
  guard** seam (`registerReapGuard`) re-verifies zero references at sweep time
  and deletes the storage bytes before confirming each row reap. A guarded
  object is never blind-deleted; an erroring guard fails safe (rows retained).

  **Attachment access (ADR-0049, Salesforce parent-derived semantics).**
  `sys_attachment` create now requires caller READ visibility of the parent
  record (403 `ATTACHMENT_PARENT_ACCESS`) and server-stamps `uploaded_by` from
  the session (client value ignored); delete requires uploader-or-parent-editor
  (403 `ATTACHMENT_DELETE_DENIED`). The storage upload routes require an
  authenticated session when an auth service is wired (401 `AUTH_REQUIRED`;
  bare kernels stay open) and stamp `owner_id` on new files.

  **REMOVED — `sys_attachment.share_type` / `sys_attachment.visibility`.**
  Both fields were modeled in v1 with zero runtime consumers (ADR-0049
  parsed-but-unenforced). There is no replacement key: attachment access is
  derived from the parent record by the hooks above. Writers of these fields
  should simply stop sending them (unknown-field validation will reject them);
  existing DB columns are left as unmanaged leftovers, no migration needed.

  `@objectstack/verify` gains `BootOptions.extraPlugins` for booting optional
  service pairs (e.g. storage + audit) in dogfood fixtures.

### Patch Changes

- f531a26: fix(storage): abort the backend multipart upload when reaping an abandoned sys_upload_session (#2970)

  The `sys_upload_session` lifecycle (added in #2984) reaps abandoned/terminal
  chunked-upload session ROWS, but not the underlying backend multipart upload —
  on S3 an initiated-but-not-completed multipart keeps its already-uploaded parts
  billable and invisible to normal listing until an explicit
  `AbortMultipartUpload`, so reaping only the row stranded them (with
  `backend_upload_id`, the sole pointer, gone).

  `createUploadSessionReapGuard` registers a `LifecycleReapGuard` on
  `sys_upload_session` that aborts the backend multipart before the row is
  deleted: it skips `completed` sessions (their multipart already became a real
  object — an abort would `NoSuchUpload`-error), re-seeds the S3 adapter's
  `uploadId → key` map from the row (a cold sweep lacks the live in-process map),
  and vetoes (keeps the row for retry) on abort failure so the pointer survives.
  The local adapter's parts directory is removed the same way.

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/observability@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/observability@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/observability@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/observability@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/observability@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/observability@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/observability@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/observability@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/observability@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/observability@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/observability@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/observability@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/observability@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/observability@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/observability@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/observability@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/observability@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/observability@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/observability@12.0.0

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/observability@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/observability@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/observability@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/observability@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/observability@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/observability@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/observability@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/observability@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/observability@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [dc2990f]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/observability@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/observability@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/observability@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/observability@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/observability@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/observability@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/observability@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/observability@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/observability@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/observability@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/observability@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/observability@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/observability@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/observability@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/observability@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/observability@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/observability@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/observability@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/observability@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/observability@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/observability@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/observability@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/observability@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/observability@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/observability@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/observability@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/observability@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/observability@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/observability@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/observability@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/observability@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/observability@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/observability@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/observability@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/observability@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/observability@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/observability@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/observability@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/observability@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/observability@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/observability@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/observability@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/observability@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/observability@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/observability@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/observability@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/observability@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/observability@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/observability@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/observability@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/observability@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
