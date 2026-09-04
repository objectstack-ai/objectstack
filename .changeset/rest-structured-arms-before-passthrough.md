---
"@objectstack/rest": patch
---

fix(rest): the bulk / metadata / UI error door consults the bespoke structured arms BEFORE its declared-status passthrough (#14541)

**Response-body change on published bulk doors.** One refusal used to produce
two different bodies depending on which route caught it. `resolveErrorResponse`
— the door behind `handleRouteError` / `sendThrownError`, used by `createMany`,
`updateMany`, `deleteMany`, `batch`, `clone`, the import/export routes and the
metadata / UI families — took its own declared-status passthrough BEFORE
delegating to `mapDataError`, which the single-record `/data` routes call
directly. An engine envelope that DECLARES `status` therefore short-circuited,
and every bespoke structured arm behind the delegation was unreachable from
those routes.

The project had already ruled on this exact shape, for one code:

> [#3770] `OBJECT_NOT_FOUND` is deliberately excluded from this
> status-passthrough: `mapDataError` owns its canonical envelope, and
> short-circuiting here would ship a second wire code for the same condition
> depending on which route caught it.

That exclusion never grew past its first case. This change generalises the
ruling instead of adding a second exclusion: the structured arms are lifted
into one `structuredCodeAnswer` classification that BOTH doors ask first, and
the bulk door answers a match by delegating to `mapDataError`, so the two
bodies are the same by construction rather than by coincidence.

**What callers on the bulk doors see change** — measured door-to-door, in
process, against the real producer shapes:

| producer (declares) | before, bulk door | after, bulk door |
| :-- | :-- | :-- |
| engine `DELETE_RESTRICTED` (409) | `{error, code}` | `+ developerMessage, dependentObject, dependentCount, object` |
| `ConcurrentUpdateError` (409) | `{error, code}` | `+ currentVersion, currentRecord, object` |
| `DuplicateRecordError` (409) | `{error: the engine's sentence, code: "DUPLICATE_RECORD"}` | `{error: the curated sentence, code: "UNIQUE_VIOLATION", developerMessage, field, object}` |
| `FEEDS_DISABLED` / `FILES_DISABLED` (403) | `{error, code}` | `+ object` |
| `ATTACHMENT_PARENT_ACCESS` / `ATTACHMENT_DELETE_DENIED` / `RECORD_NOT_ACCESSIBLE` (403) | `{error, code}` | `+ object` |
| engine `INVALID_FIELD` (400) | `{error, code}` | `+ field, object` |

In every row the STATUS is unchanged for that producer, and no key is removed.

**Where the added keys come from, and how documented each is.** They are the
keys the single-record `/data` door has always shipped for the same refusal —
⛔ *not* keys declared on `ApiErrorSchema`, which declares exactly `code`,
`declaredCode`, `message`, `userMessage`, `category`, `httpStatus`, `details`
and `requestId` and none of these. Their published status, measured on
`origin/main`:

- `field`, `object` — documented, `content/docs/protocol/kernel/http-protocol.mdx`, the 409 "Constraint Violations" body.
- `developerMessage`, `dependentObject`, `dependentCount` — documented, `content/docs/protocol/objectql/types.mdx` ("Required foreign keys") and `content/docs/api/data-api.mdx`.
- `currentVersion` — documented, `content/docs/api/wire-format.mdx` §7, "Concurrent Update — 409 Conflict".
- `currentRecord` — **shipped but undocumented**: no `content/docs/**` page describes it (the only textual match is the unrelated `currentRecordCount` tenant quota). It has been on the single-record door's 409 since the arm existed; this change puts it on the bulk doors too, still undocumented.

**One `code` VALUE changes, and what it restores differs by driver.** On the
SQL drivers the bulk doors answered `409 UNIQUE_VIOLATION` with the curated
sentence and `field` until #14095: the raw driver error declares no `status`,
so it fell past this passthrough into `mapDataError`'s `isUniqueViolationError`
arm. #14095's `DuplicateRecordError` DOES declare one, so from then on those
doors answered the engine spelling `DUPLICATE_RECORD` while the single-record
door was restored explicitly by #14389. This puts `UNIQUE_VIOLATION` back on
the bulk doors. On **driver-memory** the wire code was **already**
`UNIQUE_VIOLATION` before #14095 and never moved — its raw refusal declares
`code = 'UNIQUE_VIOLATION'` and `status = 409` itself, so it took the
passthrough, which relays a registered code verbatim. What changes for that
driver is the SENTENCE: its raw message quotes the offending values as JSON and
the curated one does not.

**⚠️ A vocabulary fork this puts side by side, disclosed rather than implied
away.** The `DUPLICATE_RECORD` arm answers the wire spelling
`UNIQUE_VIOLATION`. A batch or import ROW does not go through this
classification at all — `metadata-protocol`'s `toRowApiError` puts a thrown
registered code on the row verbatim, and `import-runner`'s row report does the
same, deliberately per #14095 — so after this change a **whole-request** failure
on `POST /data/:object/batch` or `POST /data/:object/import` answers
`UNIQUE_VIOLATION` while a **row** failure on the same route answers
`DUPLICATE_RECORD`. Neither half is new and neither is a regression; what is new
is that both spellings now appear in one route's responses. This change does not
pick a winner — the ledger's "if it merely re-spells a standard member, that
registration is a recorded waiver" and ADR-0112's one-name-per-concept both bear
on it, and moving either spelling is a published-contract change. **#14723
carries the decision.**

**Which doors.** Every route whose catch calls `handleRouteError` /
`sendThrownError`, plus each environment-scoped twin: `POST
/api/v1/data/:object/createMany`, `/updateMany`, `/deleteMany`, `/batch`, `POST
/api/v1/batch`, `POST /api/v1/data/:object/:id/clone`, `GET
/api/v1/data/:object/export`, the `POST /api/v1/data/:object/import` and
`/api/v1/data/import/jobs/…` family, `GET /api/v1/discovery`, `GET
/api/v1/openapi.json`, the `/api/v1/meta/**` family and `GET
/api/v1/ui/view/:object/:type`. Two more families reach the same door through
`classifiedRefusalAnswer` rather than a route catch, and one of them changes:

- **`POST /api/v1/analytics/dataset/query`** (and its environment-scoped twin) spreads every classified key onto its own envelope, and `service-analytics` throws `INVALID_FIELD` with `status`, `field` and `object` at three sites — so **that route's error body gains `field` and `object`** exactly as the bulk doors do. Newly pinned at key level, because its own envelope tests assert `code` and a message shape only.
- **The record-share family** re-dresses only `code` / `declaredCode` / `userMessage` / `error` into the nested ADR-0112 D5 envelope, so its key set does not move; its `error` SENTENCE would change for a `DuplicateRecordError`.

The single-record `/data` CRUD routes and `GET /api/v1/data/:object` call
`mapDataError` directly and are the reference this converges on; none of their
bodies move. `packages/rest/src/package-routes.ts` defines its own local
`sendThrownError` and is unaffected.

**Three boundaries this does NOT cross:**

- **The passthrough's 5xx half is untouched.** A producer-declared 5xx still takes that arm, prose dropped unconditionally (#5437 / #5582 / #5907).
- **A sandboxed producer keeps the unwrap door's answer** on the bulk door: the arms ship `error.message`, which for a QuickJS body is the debug wrapper #11588 exists to keep off this wire, so the consult declines an error carrying `innerMessage`.
- **The shared classification is declared-code only.** Nothing in it reads message TEXT to decide which condition an error is, which is why the `PERMISSION_DENIED` arm stays where it is.

**⚠️ Two exceptions to "nothing else moves", stated because they are true and
were measured rather than reasoned:**

1. **A sandboxed producer declaring a 5xx with `OBJECT_NOT_FOUND` or `INVALID_FIELD` now keeps that 5xx.** Before, it fell past the sandbox unwrap door (declared ≥ 500) into the arm below it; the arms now carry an explicit sandbox-origin clause, so it answers the declared status with the prose withheld — #5582's rule. Measured on `origin/main` and on this branch, both doors, per code:

   - `OBJECT_NOT_FOUND` + declared `503`: **both** doors answered `404 {"error":"Object 'nope' is not registered","code":"OBJECT_NOT_FOUND","object":"nope"}` and now answer `503 {"error":"Internal server error","code":"OBJECT_NOT_FOUND"}`. A status move on **both** doors, not one.
   - `INVALID_FIELD` + declared `502`: the single-record door answered `400` with the QuickJS debug wrapper as `error` and now answers `502` with the prose withheld; the bulk door already answered `502` and does not move.

   So "behaviour-identical" is not strictly true and is not claimed. No producer in this repo throws either code from a sandboxed body with a declared 5xx, so no wire in service moves — the shapes are synthesised, and they are pinned rather than described.
2. **A structured arm answering a 5xx no longer overrides a 4xx the producer declared, on either door.** Only `ERR_DATASOURCE_UNAVAILABLE`'s 503 answers a 5xx, and its producer declares no `status` at all, so nothing moves on the wire — but the single-record door used to answer `503` for a synthesised `{code, status: 400}` where the bulk door answered `400`, and the two now agree.

Both doors are pinned against each other per producer, every guard case asserts
BOTH doors as either a convergence or a *named* accepted divergence, and a
drift guard scans **both** halves of `classifyDataError` so an arm added below
the shared consult — the position that produced this card — cannot diverge
silently. That guard found one on its first run: `RECORD_NOT_FOUND` is a real
remaining instance, left open on purpose and recorded as a known gap citing
#14725 rather than quietly excused.
