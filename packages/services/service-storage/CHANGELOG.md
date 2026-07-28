# @objectstack/service-storage

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
