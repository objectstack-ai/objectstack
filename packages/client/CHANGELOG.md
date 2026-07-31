# @objectstack/client

## 17.0.0-rc.1

### Major Changes

- b09d8d9: refactor(data)!: `query.cursor` is removed — no driver ever implemented keyset pagination (#4286 step 4)

  `cursor` promised keyset pagination and nothing served it: the key was accepted
  and ignored, so every page came back identical — a caller looping "until
  `hasMore` is false" never terminated. It was Tier A of the #4286 inventory: a
  shipped public producer (`QueryBuilder.cursor()`) minting a key no executor
  read.

  **FROM → TO**

  | Was                                       | Now                                                                        |
  | :---------------------------------------- | :------------------------------------------------------------------------- |
  | `cursor: { created_at: last.created_at }` | `where: { created_at: { $gt: last.created_at } }` + the matching `orderBy` |
  | `QueryBuilder.cursor({...})`              | `.where({ created_at: { $gt: ... } }).orderBy('created_at')`               |

  The one-line fix: **delete the key and seek with `where` on your sort key** —
  every driver already executes that, with canonicalised temporal comparands.

  Mechanics: `retiredKey()` tombstones on both declaration sites
  (`QuerySchema.cursor` and `EngineQueryOptionsSchema.cursor`, one shared
  prescription), so authoring the key fails `tsc` and a query still carrying it
  fails to parse with the fix. `QueryBuilder.cursor()` is deleted. Registered as
  the protocol-17 semantic migration `query-cursor-retired` (request surface —
  nothing stored to rewrite). The caller-built `Record<string, unknown>` shape
  would not survive a real keyset design anyway: a first-class cursor, if ever
  built, will be a response-minted opaque token (the pattern the
  metadata-revision / flow-run / notification list endpoints already use — those
  `cursor` params are unrelated and unchanged).

- b09d8d9: refactor(data)!: `query.distinct` is removed, and with it the mis-wired REST count suppression (#4286 step 4)

  `distinct` promised `SELECT DISTINCT` and no driver ever rendered it — but it
  was **mis-wired rather than merely dead** (#4286 finding 2, the harsher
  ADR-0078 class): its only observable effect platform-wide was that the REST
  list path treated a distinct query as _not countable_, silently degrading
  `total`/`hasMore` to a page-local estimate while still returning duplicate
  rows. A caller — or a self-verifying agent — saw the response change and
  concluded the flag worked. It had a shipped public producer
  (`QueryBuilder.distinct()`).

  **FROM → TO**

  | Was                                      | Now                                                                               |
  | :--------------------------------------- | :-------------------------------------------------------------------------------- |
  | `distinct: true` for unique combinations | `groupBy: ['category']`                                                           |
  | `distinct: true` + count                 | `aggregations: [{ function: 'count_distinct', field: 'category', alias: '...' }]` |
  | one column's distinct values             | the SQL/memory drivers' `distinct(object, field)` door (driver-level)             |

  The one-line fix: **delete the key**; deduplicate with `groupBy` /
  `count_distinct`.

  Mechanics: `retiredKey()` tombstones on both declaration sites
  (`QuerySchema.distinct` and `EngineQueryOptionsSchema.distinct`, one shared
  prescription); `QueryBuilder.distinct()` is deleted; registered as the
  protocol-17 semantic migration `query-distinct-retired`. **Observable REST
  change (`@objectstack/metadata-protocol`):** the count-suppression branch is
  deleted — a list request that used to carry `distinct` now gets a real
  `total`/`hasMore` again (that restoration is the point, not a side effect).
  The per-aggregation `distinct` flag (`AggregationNode.distinct`) is a
  different, live member and is untouched.

### Minor Changes

- 195ad76: fix(actions)!: failures speak HTTP — business rejections are 400, success is a single wrap (#3962)

  **BREAKING (raw-HTTP callers of `POST /api/v1/actions/...` only).** The
  200-with-inner-envelope wire was never a designed contract: no ADR or doc ever
  specified it, it originated as the route's catch block reusing
  `deps.success()`, and `/actions` was the only route of 12 that double-wrapped.
  #3962 classifies it as a bug. Five defects traced back to that one extra layer
  (the console's green toast on failed actions, `redirectUrl` never firing, a
  marketplace install reported as installed when it failed, the client-envelope
  divergence #3927 papered over, and crashes invisible to monitoring).

  The contract now, identical to `/data`:

  | Outcome                                                        |         HTTP          | Body                                                                  |
  | :------------------------------------------------------------- | :-------------------: | :-------------------------------------------------------------------- |
  | Ran, returned                                                  |        **200**        | `{success: true, data: <handler return value>}` — single wrap         |
  | Ran, rejected (business rule / validation)                     |        **400**        | `{success: false, error: {message, code, details: {code?, fields?}}}` |
  | Never dispatched (unknown / denied / wrong type / unavailable) | 404 / 403 / 400 / 503 | unchanged (#3930/#3951)                                               |
  | Crashed (`TypeError`, driver class, sandbox timeout)           |        **500**        | unchanged (#3951)                                                     |

  A validation rejection carries `details.code: 'VALIDATION_FAILED'` and
  `details.fields[]` — the exact payload #3937 fought for, now on the same wire
  shape `/data` has always used, which `@objectstack/client` normalizes to
  `err.code` / `err.fields` (#3927). A rejected flow is a 400 with
  `details.code: 'FLOW_FAILED'`. The crash-vs-rejection discriminator (#3951,
  error `name`) now selects 400 vs 500.

  `client.actions.invoke` / `invokeGlobal` still never throw: they fold every
  failure status into `{success: false, error}`, read the single wrap on
  success, and keep a NARROW legacy heuristic so a current SDK talking to a
  pre-#3962 server still folds the old double-wrapped 200s correctly.

  **Migration for raw-HTTP third parties:** branch on the HTTP status — a
  non-2xx is the failure, `error.message` / `error.details` carry the detail; on
  a 200, `data` is the handler's return value directly (one level less than
  before). Callers using `@objectstack/client` need no change.

- c2bbd97: fix(actions): reach global actions at their real registration key, and 404 an action that never dispatched (#3913)

  **1 — the registration key and the lookup key disagreed.** Both writers
  register an objectName-less action under the literal `'global'`: `AppPlugin`
  (`action.object || 'global'`) and `ObjectQLPlugin.actionObjectKey`. The REST
  route's fallback probed `'*'`, and `engine.executeAction` is an exact-string
  `Map` lookup with no wildcard semantics — so the probe could only ever miss:

  ```
  Action 'log_call' on object '*' not found
  ```

  `POST /api/v1/actions/global/log_call` worked by **accident** (the path segment
  happened to spell the registration key); `POST /api/v1/actions//log_call` never
  worked at all, and neither did falling back from an object-scoped route to a
  global handler. `'global'` is now the canonical key
  (`GLOBAL_ACTION_OBJECT_KEY`), the probe order is
  `[<routed object>, 'global', '*']` for both the REST route and the MCP
  `run_action` bridge (`actionHandlerObjectKeys` — one list, two surfaces), and a
  single-segment path (`/actions//:action`) routes at `'global'` instead of
  400-ing. A handler registered directly under `'*'` still resolves; the doc
  comments that called `'global'` a "wildcard" are corrected at every site.

  **2 — "no such action" was reported as a success.** The not-found exit called
  `deps.success(...)`, which always emits `{status: 200, body: {success: true,
data}}`, so a request naming an action that does not exist came back as:

  ```json
  {
    "success": true,
    "data": {
      "success": false,
      "error": "Action 'log_call' on object '*' not found"
    }
  }
  ```

  Every caller that did not hand-unwrap the INNER envelope read the outer
  `success: true` and reported a success that never happened — including the
  shipped console, which showed a green toast (fixed on that side in
  objectui#2963). Nothing **dispatched** there, so it is a **404** now, joining
  the answers this route already gives a status: 403 denied, 400 wrong action
  type, 503 unavailable. The miss also names the **routed** object rather than
  whichever probe ran last (the old fallback said `on object '*'`, an object the
  caller never asked for).

  A handler that **ran and rejected** is unchanged: HTTP 200 with
  `data: {success: false, error, code?, fields?}`. That is a business outcome,
  not a transport error, and #3937 pins it. The line is "did a handler run" —
  below it the payload, above it the status.

  `client.actions.invoke` / `invokeGlobal` still do **not** throw. `client.fetch`
  throws on every non-2xx, so `invoke` now catches and folds a dispatch failure
  into the same `{ success, data?, error? }` result with `error` as a plain
  string — otherwise the routes that just gained a status would have started
  propagating exceptions into callers that only ever checked `result.success`.

- 0c4f5b2: `err.code` no longer falls back to the pre-#3842 parking spot (`error.details.code`). The "newer SDK, older server" pairing that read served is not a supported deployment (SDK and server ship as one fixed release group), and the ADR-0112 batch-1 rename changed the code values anyway — a code dug out of an old server's parking spot would match no branch written against the current catalog (#4007). `err.category` / `err.retryable` are now read from inside `error`, where `ApiErrorSchema` declares them; the old top-level read yielded `undefined` against every conformant server (#4006).

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

- cbc08eb: fix(client): normalize both server error envelopes so `err.code` / `err.fields` mean one thing (#3918 follow-up)

  Two envelopes are in play and they disagree about where the semantic code and
  the per-field list live:

  ```
  @objectstack/rest, flat:
    { error, code: 'VALIDATION_FAILED', fields: [...] }

  runtime dispatcher, wrapped:
    { success: false, error: { message, code: 400,
        details: { code: 'VALIDATION_FAILED', fields: [...] } } }
  ```

  `error.code` in the **wrapped** form is the HTTP status, not a semantic code.
  The client read it straight through, so `err.code` was the **number 400** where
  the flat envelope gave `'VALIDATION_FAILED'` — meaning the branch our own docs
  teach,

  ```js
  if (err.code === 'VALIDATION_FAILED') err.fields.forEach(…)
  ```

  never matched on a dispatcher-served surface, and the field list (put on the
  wire for those routes by #3918) was unreachable at `err.details.error.details.fields`.

  Now normalized at the throw site:

  - **`err.code` is always the semantic string.** It is read from the flat
    `code`, else the wrapped `error.details.code`, else a _string_ `error.code` —
    a numeric value is never reported as a code. The HTTP status is on
    `err.httpStatus`, where it always was.
  - **`err.fields` is the per-field list** whenever the server sent one, from
    either envelope. It is left **unset** (not `[]`) when there is none, so
    `if (err.fields)` is a safe test for "this failure is field-anchored".
  - **`err.details`** prefers a top-level `details` (unchanged), then the wrapped
    envelope's own `details`, then the whole body. The flat envelope has no
    top-level `details` and so keeps falling through to the whole body exactly as
    before — only the wrapped shape changes, and only from "the entire response"
    to the structured object it actually carries.

  **Behaviour change worth noting:** code that read `err.code` from a
  dispatcher-served route previously got a number and now gets a string (or
  `undefined` where the server sent no semantic code). Nothing in this repo did —
  `err.httpStatus` was always the correct source for the status, and remains
  untouched — but a consumer that branched on `err.code === 400` should move to
  `err.httpStatus === 400`.

- 03d26f7: fix(runtime,spec)!: the dispatcher's `error.code` is the semantic string it always declared; the HTTP status moves to `httpStatus` (#3842)

  `HttpDispatcher.error()` took the HTTP status as its `code` argument and wrote it
  straight into the field `ApiErrorSchema` reserves for a semantic string, so
  `error.code` came back as `400`/`403`/`503` — a number, duplicating the response
  status and occupying the one slot a caller is meant to branch on. The real code
  then had to go somewhere else, and did, three somewhere-elses: `details.code`
  (auth gate, permission denial, anonymous deny), `details.type`
  (project-membership gate), and `error.type` (`routeNotFound`). Four sites, three
  parking spots, because the declared one was full.

  **FROM → TO on the wire.** A dispatcher error body

  ```json
  {
    "success": false,
    "error": {
      "message": "…",
      "code": 403,
      "details": { "code": "PERMISSION_DENIED" }
    }
  }
  ```

  is now

  ```json
  {
    "success": false,
    "error": { "code": "PERMISSION_DENIED", "message": "…", "httpStatus": 403 }
  }
  ```

  | Reading       | Was                                                        | Now                                               |
  | ------------- | ---------------------------------------------------------- | ------------------------------------------------- |
  | semantic code | `error.details.code` / `error.details.type` / `error.type` | `error.code`                                      |
  | HTTP status   | `error.code`                                               | `error.httpStatus` (or the response status)       |
  | context       | `error.details` (with the code mixed in)                   | `error.details` (context only, absent when empty) |

  **One-line fix for a direct reader:** replace `body.error.details?.code ??
body.error.type` with `body.error.code`, and `body.error.code` with
  `body.error.httpStatus`. **SDK callers need no change** — `ObjectStackClient`
  already normalised this (`err.code` semantic, `err.httpStatus` numeric) and still
  reads the old shape, so a client newer than its server is unaffected.

  Every code already on the wire moves **verbatim** — `PERMISSION_DENIED`,
  `ROUTE_NOT_FOUND`, `PASSWORD_EXPIRED`, `PROJECT_MEMBERSHIP_REQUIRED`,
  `VALIDATION_FAILED`, `unauthenticated`. This change moves a field; it does not
  rename anything. Reconciling the repo's two code vocabularies is #3841, and this
  leaves it exactly one map and one enum to sweep instead of four parking spots.

  A branch with no code of its own is served one derived from the status, via the
  single declared map `HttpStatusErrorCodeMap` / `standardErrorCodeForHttpStatus`
  in `@objectstack/spec/api` (`403` → `permission_denied`, `503` →
  `service_unavailable`, …). Derivation is necessary because `ApiErrorSchema.code`
  is required; drawing it from `StandardErrorCode` keeps a derived code a
  catalogued one rather than an invented string.

  **Spec changes:**

  - `ApiErrorSchema` gains optional `httpStatus: number` — the precedent is
    `EnhancedApiErrorSchema.httpStatus`. Additive.
  - `StandardErrorCode` gains `method_not_allowed` and `precondition_required`,
    the two statuses the runtime returns that the enum could not name. Additive.
  - **Breaking — `DispatcherErrorCode`** was `'404' | '405' | '501' | '503'` (string
    spellings of HTTP statuses, for matching against the numeric `error.code`). It
    is now `'ROUTE_NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'NOT_IMPLEMENTED' |
'SERVICE_UNAVAILABLE'` — the same four members the removed `error.type` enum
    declared, moved verbatim. FROM `DispatcherErrorCode.parse('404')` TO
    `DispatcherErrorCode.parse('ROUTE_NOT_FOUND')`; to match a status, read
    `error.httpStatus`. TypeScript flags every call site.
  - **Breaking — `DispatcherErrorResponseSchema`**: `error.code` is `z.string()`
    (was `z.number().int()`), `error.type` is **removed** (folded into `code`), and
    `error.httpStatus` / `error.details` are declared. This schema is what
    legitimised the deviation — it declared the opposite of `ApiErrorSchema` for
    the same field. FROM `{ code: 404, type: 'ROUTE_NOT_FOUND' }` TO
    `{ code: 'ROUTE_NOT_FOUND', httpStatus: 404 }`.

  **Also aligned, because they are the same wire surface:** `dispatcher-plugin`'s
  `errorResponseBase` (the THROWN-error exit) and its inline 404, and the MCP 405.
  `errorResponseBase` previously discarded a thrown error's `.code` outright — it
  had nowhere to put it — so the two exits of one surface disagreed about what a
  caller would see; they now agree. Every body on this surface is built by one
  helper (`packages/runtime/src/error-envelope.ts`), guarded in both directions by
  `error-envelope.conformance.test.ts`: each branch driven and parsed against the
  schema imported from `packages/spec`, plus a source scan so a new branch cannot
  quietly reintroduce a numeric `code` or a `type`-as-code sibling.

  This deletes the #3687 pin in `http-dispatcher.test.ts`, which asked to be
  deleted rather than updated once the dispatcher was fixed.

- 239c3a3: fix(spec)!: the #3963 / #4052 / #4158 / #4196 / #4286 retirements land in protocol **17**, not a protocol 18 that this train cannot produce (#4350)

  Ten tombstone prescriptions told authors a key "was removed in `@objectstack/spec` **18**",
  and — worse — the machine agreed with them: a whole `step18` chain step and two
  `toMajor: 18` conversions were wired for a major the release train does not reach.

  **17 is what ships.** `latest` is 16.1.0 and `rc` is `17.0.0-rc.0` — 17.0.0 has never been
  published. `.changeset/pre.json` records `@objectstack/spec` at initialVersion 16.1.0, and
  changesets computes a pre-mode bump from the last _published_ version: 16.1.0 + `major` =
  **17.0.0**, released as `17.0.0-rc.N`. `PROTOCOL_VERSION` is `'17.0.0'`, and
  `protocol-version.test.ts` pins it to the package major, so it cannot unilaterally become 18
  either. The "18" came from counting up from the in-flight `17.0.0-rc.0` instead of from
  16.1.0.

  **The prose was the smaller half.** `composeMigrationChain(from, to = PROTOCOL_MAJOR)`
  filters `m <= toMajor`, so a step keyed 18 was **unreachable**: `os migrate meta --from 16`
  walked steps 11–17 and silently skipped 18. The same ceiling applies to `composeSpecChanges`,
  so the generated `spec-changes.json`, `docs/protocol-upgrade-guide.md` and the `spec_changes`
  MCP tool — the ADR-0087 D4 primary channel — carried **none** of these seven retirements:
  `query.joins`, `query.windowFunctions` and `BatchOptions.validateOnly` appeared zero times in
  the committed manifest, and the upgrade guide contained no "18" at all. Authors would have hit
  the tombstones with no chain hop to run and no upgrade-guide row to read.

  What changed:

  - `step18` is folded into `step17` — its rationale, both `conversionIds`
    (`stack-api-require-auth-removed`, `flow-node-wait-timeout-keys-removed`) and all six
    semantic migrations move across, and `MIGRATIONS_BY_MAJOR[18]` is gone. Both conversions
    become `toMajor: 17` (`migrations.test.ts` requires a conversion's `toMajor` to equal its
    step's major), and `CONVERSIONS_BY_MAJOR[18]` merges into `[17]`.
  - All 30 hand-written "18" references become "17": the ten tombstone prescriptions
    (`query.zod.ts`, `flow.zod.ts`, `rest-server.zod.ts`, `stack.zod.ts`, `protocol.ts`), the
    `query.test.ts` pin regex that was holding the wrong number in place, the internal comments,
    the `liveness/query.json` + `liveness/README.md` notes, and the seven unconsumed changesets.
  - The seven retirements are written into the v17 release notes and upgrade checklist, where
    they had no entry at all — there is no `v18.mdx` for them to have landed in.

  No behaviour is added or withdrawn: every key retired by #3963, #4052, #4158, #4196 and #4286
  stays retired, on exactly the terms those changesets describe. What changes is that the
  prescription now names the version that will actually carry it, and `os migrate meta` actually
  applies the two stack conversions instead of stepping over them.

- 7309c81: test(runtime,client,metadata): back the remaining suites with in-memory SQLite instead of the mingo driver (#4065)

  Ten test files used `InMemoryDriver` as a convenience backing store — somewhere
  for rows to go while the suite proved something else (REST routing, datasource
  auto-connect, the batch `$ref` contract, metadata history). They now run on
  `SqliteWasmDriver` at `:memory:`, the same engine `@objectstack/verify`'s
  `bootStack` already gives the dogfood gate: pure JS (no native build, CI-safe on
  any runner) and real SQL semantics.

  The point is fidelity, not tidiness. Production runs SQL, and mingo differs from
  it in ways that let a suite pass while the behaviour it stands for is broken.
  Every failure this migration produced was a fixture defect the memory driver had
  been absorbing:

  - **Tables were never created.** `driver.create()` on the memory driver is a
    bare `table.push()` onto an auto-vivified array, so an object registered
    _after_ `kernel.bootstrap()` — which misses the boot-time schema sync — looked
    fine. On SQL the first write fails with `no such table`, which the REST error
    mapper turns into a **404 `OBJECT_NOT_FOUND`**: a routing-shaped symptom for a
    DDL-shaped cause. Four suites needed an explicit `syncObjectSchema`.
  - **A missing object declaration read as working.** `notifications.hono.integration`
    writes `sys_notification`, which `MessagingServicePlugin` does not declare —
    it is a platform object, and that lean kernel never booted `platform-objects`.
    Auto-vivification hid the omission entirely. The suite now registers the real
    `SysNotification` rather than a hand-copied stand-in, so there is still exactly
    one schema for it (Prime Directive #12).
  - **`connect()` was optional.** The memory driver needs none; a SQL driver does.

  What deliberately did NOT move: `read-coercion-conformance` keeps its two-driver
  matrix (proving a stored value reads back as its declared type on _both_ engines
  is the entire point of that gate), and the suites whose subject IS the memory
  driver or its wiring — `standalone-stack` (`memory://` scheme),
  `sqlite-driver-fallback` (the dev step-down), the CLI's driver-label tests, and
  driver-memory's own suite.

  `datasource-autoconnect` is in that second group as of #4083, which landed a
  regression test there for exactly the memory-pool property this PR originally
  proposed to migrate away from. Moving that file to SQLite would have left the
  new test passing vacuously — a wasm-SQLite pool never writes `.objectstack/` at
  all — so it stays on the memory driver and keeps guarding what it was written
  to guard.

  No new coverage is claimed here: each suite asserts exactly what it asserted
  before, against a more faithful store.

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
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
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
  - @objectstack/core@17.0.0-rc.1

## 17.0.0-rc.0

### Major Changes

- 8b9d71e: feat(client,spec)!: the SDK's `ai` namespace now expresses the AI surface that exists (#3718)

  `client.ai` and the AI service were **disjoint sets**. The namespace held three
  methods — `nlq`, `suggest`, `insights` — whose URLs no repo has ever mounted
  (removed in v17), while `service-ai` mounted 12 routes the SDK could not reach
  at all. v17 closed the first half by deleting the dead methods. This closes the
  second: the SDK now reaches every route that is meant to be tenant API surface.

  | SDK                                                         | Route                                                                             |
  | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
  | `ai.chat(request)`                                          | `POST /api/v1/ai/chat` — forces `stream: false`, so the JSON mode is what you get |
  | `ai.chatStream(request)`                                    | `POST /api/v1/ai/chat` — `AsyncIterable` of UI Message Stream frames              |
  | `ai.complete(request)`                                      | `POST /api/v1/ai/complete`                                                        |
  | `ai.models()`                                               | `GET /api/v1/ai/models` — the ADR-0028 plan-filtered picker list                  |
  | `ai.conversations.create/list/get/update/delete/addMessage` | the six `/api/v1/ai/conversations` routes                                         |

  `ai.chatStream` returns a promise for an async iterable rather than being an
  async generator, so the request is issued — and an HTTP error thrown — when you
  call it, not when you first iterate.

  **Where the server is.** `service-ai` is a Cloud/EE package in the `cloud`
  repo; this repo only proxies `/api/v1/ai/**` and 404s `AI service is not
configured` without it. Check `discovery.services` before calling, exactly as
  for any other plugin-provided namespace. For a React chat UI, `useChat()`
  (`@ai-sdk/react`) is still the better client — it speaks the same protocol
  `ai.chatStream` parses and owns message state; these methods are for callers
  that are not components.

  **Breaking — the spec's dead AI declarations are retired.** All three had no
  implementation anywhere and no runtime consumer:

  - `Ai{Nlq,Suggest,Insights}{Request,Response}[Schema]` → replaced by the wire
    shapes of the real routes: `AiChat{Request,Response}`, `AiStreamChunk`,
    `AiCompleteRequest`, `AiModelsResponse`, `AiConversation`, `AiMessage`,
    `{Create,List,Update}AiConversation*`. The six retired JSON Schemas are
    dropped from `json-schema.manifest.json` (deliberate retirement, #2978).
  - `DEFAULT_AI_ROUTES` → deleted, and `getDefaultRouteRegistrations()` returns 8
    groups instead of 9. It declared the three phantom endpoints and had no
    runtime consumer; re-declaring the real ones here would recreate the same
    illusion, since they are mounted from another repo.
  - `AiProtocol` (`aiNlq?` / `aiSuggest?` / `aiInsights?`) → deleted. Nothing
    implemented it and nothing dispatched through it. The real server contract is
    `IAIService` + `IAIConversationService` in `@objectstack/spec/contracts`.

  **The guard.** `/api/v1/ai/` becomes a bounded prefix exemption in the capstone
  (#3642) alongside the control plane — bounded from both ends: only `ai.*` may
  use it, and the namespace must still be reaching it. That is not a
  wave-through. The reachability check lives where the routes are:
  `cloud`'s `packages/service-ai/src/ai-route-ledger.conformance.test.ts` reads
  the table `buildAIRoutes()` returns and drives this SDK against it, so an
  `ai.*` URL that stops resolving fails a test in the repo that mounts it. The
  wildcard-only bound stays **0** — these URLs never touch the `* /ai/**` row,
  which is what certified three dead methods for years.

  The four replaced client tests are worth naming: they mocked `fetch` and
  asserted the URL the client _built_, never that anything answered it, and
  passed for years against endpoints that did not exist. The new ones assert only
  what this repo can honestly know — verb, path, and the body decisions the SDK
  makes for you (`stream: false` on `chat`, the 204 on `delete`, SSE frame
  parsing) — and leave "does it resolve" to the ledger next to the routes.

- 9f060e5: chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
  production-dependency batch from #3517

  **better-auth 1.7.0-rc.1 → 1.7.0-rc.2** across the family (`better-auth`,
  `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/sso`, and the
  adapter/telemetry overrides). `@better-auth/scim` deliberately stays on
  1.7.0-rc.1 — rc.2 replaces its whole model (code-defined connections; the
  `scimProvider` model and the generate-token endpoint are gone), which is a
  feature migration, not a version bump. Its peer range accepts rc.2 core, and the
  advisory that forced the original pin (GHSA-j8v8-g9cx-5qf4) is still fixed.

  **BREAKING — account identity.** better-auth renamed `account.accountId` to
  `account.providerAccountId` and added a REQUIRED `account.issuer`; sign-in now
  resolves accounts by `(issuer, providerAccountId)`.

  - FROM `fields: { accountId: 'account_id' }` → TO
    `fields: { issuer: 'issuer', providerAccountId: 'account_id' }`. The provider
    account id keeps its `account_id` column — only the better-auth-side name
    moved — and `sys_account` gains an `issuer` column.
  - FROM `internalAdapter.createAccount({ providerId, accountId, … })` → TO
    `createAccount({ providerId, issuer, providerAccountId, … })`. A local
    password account carries the issuer better-auth mints for itself,
    `local:credential`.
  - FROM `client.auth.accounts.unlink({ providerId, accountId })` → TO
    `unlink({ accountId })`, where `accountId` is now the account ROW id (the `id`
    from `accounts.list()`), matching better-auth's narrowed body.
    `accounts.list()` returns `issuer` + `providerAccountId` in place of
    `accountId`.

  **Existing deployments:** rows written before 1.7 have no issuer and are
  invisible to sign-in until stamped. The auth plugin now runs an idempotent
  boot-time backfill that stamps what it can derive — `local:credential` for
  password accounts, `local:oauth:<providerId>` for configured social providers,
  and the registered IdP's real `iss` from `sys_sso_provider` for federated ones.
  Accounts from a federated IdP that is no longer registered cannot be derived;
  they are logged with their provider id and row count rather than guessed, and
  those users cannot sign in through that provider until the row is stamped with
  the IdP's issuer or removed so a fresh login re-links it.

  **Also required by 1.7:** `SecondaryStorage` gained two mandatory methods, both
  now implemented over the kernel cache service — `getAndDelete` (single-use
  verification values) and `increment` (fixed-window rate-limit counter;
  `rateLimit.storage: 'secondary-storage'` throws at boot without it).

  The rest of #3517's production-dependency batch rides along: `@oclif/core`
  4.13.0, `@hono/node-server` 2.0.12, `hono` 4.12.32, `tar` 7.5.22, `jose` 6.2.4,
  `pinyin-pro` 3.28.2, plus the private docs app's fumadocs/next/react bumps.

- a137bbc: feat(client)!: remove the `ai` namespace — three methods, none of which ever worked (#3718)

  `client.ai` held exactly three methods, and **no server in any repo has ever
  mounted the URLs they build**:

  | Removed              | Built                      | Why it 404ed                                                                                                                                                   |
  | -------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `client.ai.nlq`      | `POST /api/v1/ai/nlq`      | declared in `DEFAULT_AI_ROUTES`, which has no runtime consumer — only the spec's own test reads it; `aiNlq?` is an optional protocol method nothing implements |
  | `client.ai.suggest`  | `POST /api/v1/ai/suggest`  | same                                                                                                                                                           |
  | `client.ai.insights` | `POST /api/v1/ai/insights` | same                                                                                                                                                           |

  Found by the AI route ledger (#3718, in `cloud`, where `service-ai` lives),
  which enumerates the table `buildAIRoutes()` returns and matches the SDK's URLs
  against it. The two sets are **disjoint**: the real AI surface is 12 routes —
  `chat`, `chat/stream`, `complete`, `models`, `status`, `effective-model` and six
  `conversations` routes — and the SDK expressed none of them.

  **Removed, not deprecated.** A typed method that always throws is worse than no
  method: it costs a runtime round-trip to discover, where absence is a compile
  error. No working code can break, because there was no working behaviour. This
  lands in the v17 major `@objectstack/client` is already taking, which is the
  right window for a breaking removal rather than a reason to defer one.

  Expressing the real surface is tracked on #3718 as **new** API, not a rename of
  what was removed. For chat, `useChat()` (`@ai-sdk/react`) already speaks the
  Data Stream Protocol `POST /api/v1/ai/chat` serves.

  Also removed: the `AI_PLANE` exemption added to the capstone hours earlier
  (#3727). With no method targeting `/api/v1/ai/`, an exemption there is a hole
  with nothing to cover — the wildcard-only bound stays `0` and now reaches 0
  with nothing exempted to get there.

  The four AI tests in `client.test.ts` are **replaced, not deleted**. They were
  the exact shape this audit keeps finding behind green suites: mock `fetch`,
  assert the URL the client _built_, never assert that anything answered it. They
  passed for years against three endpoints that did not exist. The replacement
  asserts the one thing worth defending — the namespace is gone and must not
  return without a route behind it.

  `Ai{Nlq,Suggest,Insights}{Request,Response}` are still re-exported straight
  from `@objectstack/spec/api`, so anyone holding those types keeps them.
  Retiring the spec-side declarations is a separate change.

  Docs corrected: `client-sdk.mdx` carried three copy-pasteable examples that
  404ed, and `plugin-endpoints.mdx` had the AI surface **inverted** — it tabled
  the three phantom routes and explicitly denied `/ai/chat`, which is mounted. It
  now lists the 12 real ones.

### Minor Changes

- 6fdc5c6: feat(client,spec): `ai.agents.*` and `ai.pendingActions.*` — the AI routes the SDK could not reach (#3718)

  #3718 deleted three `client.ai.*` methods whose URLs no route had ever mounted,
  then expressed the surface that does exist. It expressed **one** builder's worth
  of it. `service-ai` mounts seven; the audit that widened its ledger
  (objectstack-ai/cloud#903) counted **ten** routes the SDK cannot reach, nine of
  which had simply never been counted.

  This closes the six with the strongest evidence: `objectui` already ships
  product on them, over URLs it builds by hand because there was nothing to call.

  **`ai.agents`** — `/ai/chat` talks to the environment's default agent; these
  talk to one you name.

  - `agents.list()` — the agents this CALLER may chat with. The route filters by
    the caller's permissions (ADR-0049), so an empty list is a legitimate answer
    for a seat-less user, not an error to retry.
  - `agents.chat(name, request)` / `agents.chatStream(name, request)` — one route,
    two methods, mirroring `ai.chat` / `ai.chatStream` rather than inventing a
    third shape for the same endpoint. `chat` forces `stream: false` for the same
    reason `ai.chat` does: the route streams by default, so leaving the flag to
    the caller means the JSON path is the one you have to remember.

  **`ai.pendingActions`** — the human-in-the-loop approval queue. When a tool call
  needs a human decision the turn parks an action instead of executing it, and an
  app embedding the chat has to render and resolve that queue.

  - `pendingActions.list(options?)` — `status`, `conversationId` and `limit` only.
    `AIService.listPendingActions` also accepts `objectName`, but the route never
    forwards it; typing it here would offer a filter that silently does nothing.
  - `pendingActions.get(id)`
  - `pendingActions.approve(id)` — approves **and executes**. Check the returned
    `status`: a tool that fails after approval comes back
    `{ status: 'failed', error }` with HTTP 200, because the approval succeeded
    even though the execution did not. Code that reads only `res.ok` reports a
    failed write as a success.
  - `pendingActions.reject(id, reason?)` — executes nothing.

  Reads and decisions are separately permissioned server-side (`ai:read` vs
  `ai:approve`), so a caller that can list the queue may still be refused on
  approve. Handle the 403; one does not imply the other.

  **Typed from what the routes return**, not from what a client might like them
  to — the failure #3718 exists to punish. The pending-action shape is the
  persisted row, `snake_case` on the wire because that is what it is. Agent rows
  require `capabilities`, because that object is what tells a UI which
  affordances to render.

  The capstone (#3642) exempts `/api/v1/ai/` by prefix and says the evidence lives
  on the other side of the repo boundary. It does: cloud's ledger drives every
  `ai.*` method against the tables its builders really return — and since #903
  that means all seven builders, which is what makes these six routes checkable
  at all. Their routes come from `buildAgentRoutes()` and
  `buildPendingActionRoutes()`, neither of which the ledger could see when the
  exemption was written.

- 0cdb57a: feat(client): `automation.resume()` / `automation.getScreen()` — finish a paused screen flow from the SDK (#3528)

  A `type: 'screen'` flow suspends when it reaches a `screen` node: `execute()`
  returns `{ status: 'paused', runId, screen }` and the run waits for input. The
  second half of that contract — `POST /automation/:flow/runs/:runId/resume` —
  has shipped in the dispatcher since ADR-0019, but the client SDK's automation
  surface stopped at `getFlow` / `execute` / `listRuns` / `getRun`. Anything built
  on the SDK could therefore _start_ a screen flow and never finish it: the run
  stayed suspended and the only way out was hand-rolling the HTTP call. That gap
  is what stranded the Console's developer "Flow Runs" test runner, where every
  test run of a screen flow orphaned a `paused` row.

  - **`automation.resume(flowName, runId, signal?)`** — posts the collected screen
    values as `inputs` (applied as bare flow variables), plus the approval-style
    `output` / `branchLabel` the dispatcher already accepts. Returns the next
    `{ status: 'paused', screen }` of a multi-step wizard, or the terminal
    `AutomationResult`.
  - **`automation.getScreen(flowName, runId)`** — the screen a paused run is
    waiting on, so a client that did not launch the run (a page reload, another
    tab, an inbox) can render the pending step before resuming.
  - Both are available on the environment-scoped client
    (`client.project(id).automation.*`) as well as the unscoped one.

  Also covers the two dispatcher routes with tests — the resume and screen paths
  had none, including the ordering guard that keeps `/runs/:runId/screen` from
  being swallowed by the `/runs/:runId` run lookup.

- d3f2ff6: feat(client): `actions` surface — the SDK path to server-registered actions (#3563 PR-2)

  `client.actions.invoke(object, action, { recordId, params })` and
  `client.actions.invokeGlobal(action, opts)` dispatch handlers registered via
  `engine.registerAction` (`POST /api/v1/actions/...`). This closes the largest
  gap in the #3563 route audit: the whole `/actions` domain — the documented way
  to expose custom server-side operations — was unreachable from the SDK, and
  every console hand-rolled `fetch` for it. The record id travels in the body,
  which both server URL shapes honor; the handler's own business failure comes
  back as `{ success: false, error }` rather than a thrown exception.

  The route ledger flips all three `/actions` rows to `sdk` and the gap ratchet
  drops 27 → 24. Also takes the documentation-drift findings from the audit:
  the client README no longer documents six methods that do not exist,
  `CLIENT_SPEC_COMPLIANCE.md` is retired to a tombstone pointing at the
  CI-enforced ledger (its "FULLY COMPLIANT" verdict was measured against a
  route table nothing consumes), and the docs-site SDK page documents the new
  surface.

- b7550d6: feat(client): `keys`, `shareLinks`, and `security` surfaces (#3563 PR-3)

  Three more domains the route audit found with zero SDK expression:

  - `client.keys.create({ name?, expiresAt? })` — mints a `sys_api_key`
    (`POST /api/v1/keys`). The raw secret comes back exactly once; `user_id`
    is pinned server-side. There was previously no SDK path to create an API
    key at all.
  - `client.shareLinks.create / list / revoke` — authenticated management of
    record share links. Listing is server-constrained to the caller's own
    links; the public token-consumption routes stay browser-only by design.
  - `client.security.suggestedBindings.list / confirm / dismiss` — the
    ADR-0090 admin surface for package audience-binding suggestions.

  The route ledger flips all seven rows to `sdk` and the gap ratchet drops
  24 → 17.

- 0164f40: feat(client): the final six route-audit gaps — meta drafts/published/FSM + automation descriptors (#3563 PR-5)

  - `meta.getPublished(type, name)` — the published version of a metadata item
    (ADR-0033; compound names pass through unencoded, matching `getItem`).
  - `meta.listDrafts({ packageId?, type? })` — pending drafts the active-only
    lists hide.
  - `meta.getLegalNextStates(object, field, from?)` — ADR-0020 FSM
    introspection ("from here, where can this record go?").
  - `automation.listActions({ paradigm?, source?, category? })` /
    `automation.listConnectors({ type? })` — the ADR-0018/0022 descriptor
    registries backing the Studio designer's pickers.
  - `automation.getRuntimeStatus()` — per-flow enabled/bound engine state.

  With these, the #3563 gap ratchet reaches **0** (from 27): every dispatcher
  route that should be SDK-expressible is, and the conformance guard keeps it
  that way.

- e295ad1: feat(client): the eleven package-lifecycle methods (#3563 PR-4)

  `client.packages` grows from install/enable to the full lifecycle the server
  has shipped for three ADR generations: `update` (manifest edit),
  `publish`, `publishDrafts` / `discardDrafts` (ADR-0033 whole-app draft
  promotion), `listCommits` / `revertCommit` / `rollback` (ADR-0067 commit
  timeline), `revert`, `export`, `adoptOrphans`, `duplicate` (ADR-0070
  portability). All eleven routes existed with no SDK expression — Studio
  reached them via raw fetch.

  The route ledger flips all eleven rows to `sdk` and the gap ratchet drops
  17 → 6 (from 27 at the start of the audit).

- 1003125: feat(client): close the approvals (6) + record-shares (3) REST gaps (#3587 batch 3/5)

  `client.approvals` gains the full request lifecycle beyond approve/reject:
  `recall` (submitter withdraw), `revise` / `resubmit` (ADR-0044 send-back
  round-trip), and the thread interactions `remind` / `requestInfo` / `comment`.
  New `client.shares` namespace for per-record sharing grants: `list` / `grant` /
  `revoke` (204-safe) under `/data/:object/:id/shares`. REST route-ledger
  ratchet: 26 → 17.

- 6e62a93: feat(client): close the sharing-rules (5) + security-explain (2) + search (1) REST gaps (#3587 batch 4/5)

  New `client.shares.rules` sub-namespace for tenant-wide sharing rules
  (M10.17): `list` / `save` / `get` / `delete` (204-safe, grants cascade) /
  `evaluate` (reconcile). `client.security.explain` speaks the ADR-0090 D6
  access-explanation contract via the POST transport (the GET query form is the
  same `ExplainRequestSchema`). Top-level `client.search` covers global
  cross-object search (M10.5). REST route-ledger ratchet: 17 → 9.

- ecda20c: feat(client): close the 8 reports-family REST gaps (#3587 batch 2/5)

  New `client.reports` namespace speaking the plugin-reports REST surface:
  `list` / `save` / `get` / `delete` (schedules cascade), `run`, `schedule`,
  `listSchedules`, `unschedule`. The two DELETE routes return 204 — the client
  methods return `{ deleted: true }` without attempting to parse an empty body.
  Fixed path (`/api/v1/reports` is not in `ApiRoutesSchema`), matching the
  keys / share-links precedent. REST route-ledger ratchet: 34 → 26.

- 6e62a93: feat(client): close the final 9 REST gaps — ratchet 9 → 0 (#3587 batch 5/5)

  `data.clone` (enable.clone duplication) and `data.export` (streaming
  CSV/JSON/XLSX; returns the raw `Response` — a file stream, not a JSON
  envelope). New `email.send` (IEmailService; branch on the returned `status`).
  `analytics.queryDataset` speaks the ADR-0021 REST dataset-query dialect. New
  `datasources.external.*` federation admin: `listTables` / `draft` / `import` /
  `refreshCatalog` / `validate` (ADR-0015 Addendum, 503-degrading). Every REST
  route is now either SDK-expressed or carries a reviewed non-sdk disposition —
  the #3587 gap ratchet rests at ZERO.

- fc968af: feat(client): close the 9 metadata-family REST gaps the #3587 ledger carried (#3587)

  New `meta` surface: `getDiagnostics` (spec-validation sweep), `getReferences`
  (reverse references), `getBookTree` (ADR-0046 §6 spine resolution), `getAudit`
  (ADR-0010 §3.6 protection trail), `publishItem` / `rollbackItem` / `diffItem`
  (ADR-0033 per-item draft lifecycle). The two compound-name routes
  (`GET|PUT /meta/:type/:section/:name`) turned out to be already expressible —
  `getItem`/`saveItem` pass slashes through unencoded — so they are flipped to
  `sdk` with URL-pinning tests instead of new methods (the audit note claiming
  an encoding barrier was wrong; only `deleteItem` encodes). REST route-ledger
  ratchet: 43 → 34.

- 7c7e246: feat(authz): expose the caller's delegable scope — the read half of the
  delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

  `adminScope` decided writes but could not be READ: `assignablePermissionSets`
  lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
  person in a unit, with these positions" (the D8 scoped-invitation form) had no
  way to narrow its pickers. It would list the whole tree and let the user
  discover the boundary by being refused — which turns an authorization gate into
  a validator and makes the boundary invisible until it bites.

  `ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
  `GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

  - `placeableBusinessUnitIds` — union of the subtrees where the caller may place
    people (scopes granting `manageAssignments`);
  - `assignablePositions` — positions whose every distributed permission set the
    caller may hand out (containment check included);
  - `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
  - `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
    renders ONE uniform picker instead of special-casing.

  Computed by the same helpers the write gate enforces with, so an option this
  reports is one `assert()` accepts — a test asserts that agreement directly. It
  NARROWS; the gate still decides.

  Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
  the authority the caller already holds (unlike `explain`, which has one and
  gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
  no delegated authority gets empty lists, and a deployment without
  `@objectstack/plugin-security` gets 501.

- 094fa34: feat(cli,client)!: drop `os environments create --template` and the
  `template_id` body field — no control plane has ever read them (#3731)

  The CLI advertised `--template` as _"Built-in template id (e.g. crm, todo,
  blank)"_ and forwarded it as `template_id` on `projects.create()`. Nothing
  consumes it: `template_id` / `templateId` appears in **zero** non-test files in
  the `cloud` repo, `sys_environment` has no such column, and the create route
  whitelists what it reads (`displayName`, `organizationId`, `isDefault`,
  `hostname`, `metadata`, …) — `template_id` is not in the list. The
  `blank`/`crm`/`todo` registry the flag named was the `apps/server`
  `createTemplatesRoutePlugin` snapshot, removed when the control plane moved to
  `cloud`; the flag outlived it.

  So the flag was accepted, transmitted, and dropped — no seeding, no error, no
  stored trace. That is worse than the 404 its listing counterpart returned
  (`projects.listTemplates`, deleted in #3702): a 404 tells the caller something
  is wrong, a silently ignored flag reports success.

  **Migration.** `os environments create --template <id>` → drop the flag; it
  never did anything. Starter content comes from the App Marketplace: create the
  environment, then install the package (`sys_package` rows with
  `is_starter = true`, i.e. `client.projects.packages.install(envId, { packageId })`).
  Callers passing `template_id` to `client.projects.create()` should delete the
  property — TypeScript now rejects it, which is the point: an unknown field was
  being silently discarded on the wire.

  Note this is **not** the same `--template` as `os init` / `create-objectstack`
  (`app` / `plugin` / `empty` scaffolds) — those are local scaffolding templates
  and are untouched.

- 5e55739: feat(client)!: delete `projects.listTemplates()` — it targeted a route nothing
  has ever mounted (#3702, #3655 finding)

  `client.projects.listTemplates()` built `GET /api/v1/cloud/templates`. That
  path is mounted by **nothing**: none of the 17 registrars in `cloud`'s
  `cloud-artifact-api-plugin.ts` (91 registrations, enumerated by driving them
  against a capturing mock `IHttpServer`), and nothing in this repo — the string
  occurred exactly once in each repo, at the call itself. Every invocation was a
  404 with a type signature promising a resolved value.

  "Templates" are real as **data** — `sys_package_templates`, the
  `is_starter = true` view over `sys_package`, rendered as a console page — but
  there has never been an HTTP route that lists them, and no caller in either
  repo (nor in `objectui`) used the method. Mounting a route to satisfy a method
  nobody calls is the wrong order: the client's declared shape
  (`{ id, label, description, category? }`) does not match `sys_package`'s
  columns, so picking that mapping is a product decision, not an implementation
  detail. The method returns when a route exists to back it.

  Sixth instance of the `the method exists ≠ the method can be called` class this
  audit family keeps finding, after `analytics.explain` / `analytics.meta`
  (#3584), `meta.getView` (#3611) and `i18n.getTranslations` / `getFieldLabels`
  (#3636) — and the first one only a cross-repo guard could see. The framework
  capstone (#3642) exempts the `/api/v1/cloud/` prefix wholesale, because this
  repo does not serve those routes; `cloud`'s control-plane ledger (#3655) is
  where the mounted set and the SDK are both in scope, and it pins the absence.

  Callers who somehow depended on it were already receiving a 404; read starter
  packages through the `sys_package` view (`is_starter = true`) instead.

- c2d9098: feat(rest/protocol): extend droppedFields write-observability to the bulk paths + client SDK (#3455)

  Follow-up to #3448 (#3431 D2): the single-write PATCH/POST `/data` paths already
  surface LEGALLY-stripped write fields (static `readonly` #2948 / `readonlyWhen`
  #3042 / #3043 create ingress) as `droppedFields`. The **bulk** write paths did
  not — the same strips happened silently on every batched row — and the typed
  client warning + CORS mirror were deferred. This closes those out.

  **Bulk passthrough (metadata-protocol).**

  - `updateManyData` and `batchData` (update/upsert rows) now register a per-row
    `onFieldsDropped` collector and attach the events to that row's result.
  - `createManyData` diffs each supplied row against its #3043-stripped form and
    returns an **aggregated** top-level `droppedFields` (one event per
    object/reason with the union of field names) — its `{ records, count }`
    response has no per-row slot, and the insert-time strip is static-`readonly`
    only, so it is schema-uniform across rows and the aggregate is faithful.
  - `insertManyData` keeps per-row precision, attaching `droppedFields` to each
    outcome.
  - **Correctness fix bundled in:** `updateManyData` and `batchData` never threaded
    the caller's execution `context` to the engine — bulk writes ran context-less,
    so RLS/FLS and `readonlyWhen` evaluated without the caller's principal, and the
    batch create-ingress strip was hard-coded to a non-system context. All engine
    calls in both methods now run under the resolved `context`.

  **Contract (spec).** `BatchOperationResultSchema` gains an optional per-row
  `droppedFields` (covers `updateMany` + `batch`, which alias
  `BatchUpdateResponseSchema`); `CreateManyDataResponseSchema` gains the optional
  aggregated `droppedFields`. Both are omit-when-empty, so existing clients are
  unaffected. `X-ObjectStack-Dropped-Fields` is deliberately **not** emitted for
  batches — one response header cannot express per-row drops, so the per-row body
  field is the canonical bulk channel.

  **Typed client warnings (@objectstack/client).** `CreateDataResult` /
  `UpdateDataResult` gain `droppedFields?: DroppedFieldsEvent[]`, giving the body
  channel a type instead of an untyped property.

  **CORS (@objectstack/hono, @objectstack/plugin-hono-server).**
  `x-objectstack-dropped-fields` is added to the default `Access-Control-Expose-Headers`
  allow-list (kept in lockstep across both Hono CORS sites) so a cross-origin
  browser can read the single-write drop header. The body `droppedFields` remains
  the primary, cross-origin-safe surface — this is a convenience mirror.

  **GraphQL — not applicable (documented).** #3455 lists a GraphQL mutation item,
  but GraphQL has no runtime: `kernel.graphql` is unassigned everywhere and
  `handleGraphQL` returns `501`, and discovery never advertises `/graphql`. There
  is no schema generator or mutation resolver to expose a typed payload field on,
  so there is nothing to wire until a GraphQL engine lands — at which point the
  protocol-layer `droppedFields` is already present and only the GraphQL schema
  projection would remain.

- 88ef03e: fix(spec,client)!: `GetTranslationsRequest` is locale-only — drop the
  `namespace` / `keys` filters no server ever read (#3676)

  `GetTranslationsRequestSchema` declared two optional filters, and the endpoint
  description promised one of them ("...for the specified locale and optional
  namespace"). Neither serving surface read either: the dispatcher domain body
  (`runtime/src/domains/i18n.ts`) takes `parts[1]` / `query.locale`, and
  service-i18n (`i18n-service-plugin.ts`) takes `req.params.locale`. Both return
  the locale's whole bundle. The SDK meanwhile put both on the query string, so a
  caller who passed `keys` to shrink the response shrank nothing and got no
  indication the filter was inert — Prime Directive #10's declared ≠ enforced, the
  same shape #1475 trimmed out of the validation-rule types.

  Trimmed rather than implemented, on three counts:

  - **No consumer.** No call site in this repo or `objectui` passed either field.
    The docs (`content/docs/api/client-sdk.mdx`, `skills/objectstack-i18n/SKILL.md`)
    already documented `getTranslations(locale)` as a full-bundle snapshot, so the
    schema was the outlier, not the docs. The one thing that did exercise them was
    a client test asserting the query string got _built_ — it pinned the phantom
    rather than any behaviour, since no server read what it asserted was sent. It
    is replaced here by its inverse: a regression test that the request carries no
    filter query at all.
  - **`keys` could not deliver what it advertises.** `II18nService.getTranslations`
    (`contracts/i18n-service.ts`) takes only `locale`, so a filter could only be a
    post-filter over an already-materialized bundle. `keys` reads as a payload
    optimization; a post-filter saves wire bytes but none of the server work, and
    widening the contract would break every implementer (`memory-i18n`,
    `file-i18n-adapter`) for a capability with no caller.
  - **`keys` has no defined meaning against the current bundle shape.** Under the
    retired flat `o.`-dotted dialect, `keys: ['o.account.label']` was an obvious
    pick. #3778 settled the tree on one nested `TranslationData` shape, where a
    flat `string[]` is neither a path set nor a group set, and a filtered response
    would have to be rebuilt as a sparse nested tree to stay schema-valid. That is
    a design decision, and nothing is waiting on it.

  `namespace` is the one that got _easier_ — it now lands exactly on
  `TranslationData`'s top-level groups, which is what its own description already
  said ("e.g., objects, apps, messages"). It is still trimmed here: re-adding an
  optional request field is additive and non-breaking the day the Studio's
  per-module views actually need it, whereas shipping an unexercised filter path
  now means dead code with tests to match, and a declared-but-unread field is
  precisely the exemplar the next author copies.

  BREAKING: the two schema fields and the `getTranslations(locale, options?)`
  second parameter are removed with no deprecation cycle. Nothing worked through
  them — a passed filter was silently ignored — so there is no behavior to
  protect. Runtime impact is nil (the fields were optional and now strip); TS
  callers passing them fail to compile, which is the intended signal.

- 7ffc3d3: feat(client,spec)!: delete the 21 dead SDK methods and the four ghost route
  tables that underwrote them (#3612, #3587 finding)

  Five client surface families built URLs that exist on NO server surface —
  not the dispatcher, not `@objectstack/rest`, not the autonomous service
  mounts — so every call was a guaranteed 404:

  - `permissions` (check, getObjectPermissions, getEffectivePermissions)
  - `realtime` (connect, disconnect, subscribe, unsubscribe, setPresence,
    getPresence) — `service-realtime` registers zero HTTP routes and the
    dispatcher deliberately never advertises `/realtime`
  - `workflow` (getConfig, getState, transition)
  - `views` CRUD (list, get, create, update, delete) — no `/ui/views` route
    anywhere
  - `notifications` device/preference helpers (registerDevice,
    unregisterDevice, getPreferences, updatePreferences) — the ADR-0012
    server side was never built

  Each family was underwritten only by an unconsumed spec `DEFAULT_*_ROUTES`
  table — the same disease `DEFAULT_DISPATCHER_ROUTES` had (#3586) — so
  `DEFAULT_PERMISSION_ROUTES`, `DEFAULT_VIEW_ROUTES`, `DEFAULT_WORKFLOW_ROUTES`,
  and `DEFAULT_REALTIME_ROUTES` are deleted with them;
  `getDefaultRouteRegistrations()` now returns 9 registrations.
  `ApiRouteType` loses its client-only `'views' | 'permissions'` extras.

  Kept: `client.events` (explicitly local in-memory buffer, no HTTP),
  `notifications.list/markRead/markAllRead` (dispatcher-served),
  `approvals.*` (ADR-0019 — the real approval decision API), and
  `meta.getLegalNextStates` (the real FSM read).

  Breaking for anyone calling the removed methods — a repo-wide and
  objectui-wide sweep found one consumer (`useClientNotifications`'s dead
  device/preference delegates, trimmed in the objectui companion change);
  shipped as minor per the launch-window convention (cf. #3562/#3581/#3595).
  Re-adding any of these surfaces requires the server route to exist and a
  route-ledger row proving it (#3569/#3609 guards).

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

- 0bab8bb: fix(client,runtime): analytics.meta/explain now call routes that actually exist (#3584)

  The route audit (#3563) ledgered four dispatcher↔client shape mismatches.
  Re-verification showed the two analytics shapes the client spoke —
  `GET /analytics/meta/:cube` and `POST /analytics/explain` — were served by
  **nothing**: not the dispatcher, not `@objectstack/rest`, not
  `service-analytics`. Both methods 404ed against every deployment.

  - `analytics.meta(cube?)` — FROM `GET /analytics/meta/:cube` TO
    `GET /analytics/meta[?cube=<name>]`. The cube argument is now optional; when
    given, the dispatcher threads it into `AnalyticsService.getMeta(cubeName?)`,
    which always supported the filter. Responses now use the dispatcher envelope
    (`{ success, data }`).
  - `analytics.explain(payload)` — FROM `POST /analytics/explain` TO
    `POST /analytics/sql` (the dispatcher's SQL dry-run route, backed by
    `generateSql`). Method name unchanged.

  No migration is expected in practice: a method that unconditionally 404ed can
  have no working callers (none exist in objectstack or objectui). Anyone who
  had hand-rolled fetches against the imaginary shapes should switch to the
  routes above.

  The two storage rows from the same audit are deliberately NOT reshaped: the
  presigned/chunked protocol the SDK speaks is registered autonomously by
  `service-storage` on any http-server and stays canonical; the dispatcher's
  bare `POST /storage/upload` / `GET /storage/file/:id` are reclassified in the
  route ledger as a `server-only` low-level compat surface.

- 984396b: test(plugin-auth): enumerate better-auth's route table — the `/auth/**` wildcard becomes 55 exact rows (#3656)

  The widest hole the #3642 capstone measured. That guard reports how many SDK
  calls match only a `**` prefix family rather than a resolvable route, and the
  answer was 60 of ~196 — with 54 on `* /auth/**`, the largest and most
  security-relevant namespace in the client. `auth.me` builds
  `/api/v1/auth/get-session`; a prefix claim cannot tell you better-auth still
  calls it that, and better-auth is a third-party dependency on its own release
  cadence (this repo already chased its 1.7 column drift in #3624 / #3647).

  `plugin-auth` mounts it with a single catch-all, so there are no per-route
  registration calls to capture the way tranche 3 captured
  `registerStorageRoutes`. The seam is `auth.api`: every better-auth endpoint
  carries `.path` and `.options.method`, so a live instance is the route table.

  `auth-route-ledger.ts` reads it, in two halves checked differently on purpose:

  - **55 reviewed rows** — every route the SDK calls, each naming its client
    method, checked strictly against the live table. This is the rename detector.
  - **129-path mounted-surface inventory** — checked for exact equality both
    ways, so a version bump that adds publicly-mounted auth endpoints becomes a
    reviewable CI diff. Machine-maintained rather than reviewed prose: demanding
    a rationale for all 129 would make every better-auth upgrade a hundred-row
    review and the ledger would rot into rubber-stamping.

  Enumeration is config-dependent, so the inventory is pinned at the
  configuration enabling every plugin the SDK targets — the maximal surface —
  with the participating `OS_*` env vars cleared so a developer's shell cannot
  produce a spurious diff. Mutation-checked: renaming a ledgered route fails the
  suite naming it.

  The capstone guard now includes this ledger in its union and prefers exact rows
  over wildcard families when matching — without that ordering fix every
  `/auth/*` URL would still have been absorbed by `* /auth/**` and the new ledger
  would have changed nothing. Wildcard-only matches fall **60 → 3**; the ratchet
  moves with them. What remains is `* /ai/**`, whose routes `service-ai` builds
  at plugin start.

  No runtime change: a ledger, a guard, and the header/audit-doc notes.

- 57a3bb3: fix(automation,approvals): the run-resume route is gated by the node the run is parked on (#3801)

  `POST /api/v1/automation/:name/runs/:runId/resume` forwarded a caller-supplied
  `{ inputs, output, branchLabel }` straight into `AutomationEngine.resume`, and
  `resumeInternal` validated **machine state only** — the concurrent-resume latch,
  the run exists, the flow exists, the suspended node still exists. Nothing asked
  _who was calling_.

  Approval nodes suspend and resume through exactly that mechanism. So a resume
  carrying `branchLabel: 'approve'` walked the approve edge with **no approver
  check, no `sys_approval_action` row and no status mirror** — the
  `sys_approval_request` row and the run then disagreed permanently. The only
  thing standing between the route and the approvals rules was convention; the
  showcase spelled it out in a comment ("decide via the approvals API, never a raw
  engine `resume`"), and a comment in an example is not an access control.

  Removing the route was not the fix: it is load-bearing for **screen flows** —
  the UI flow-runner posts `{ inputs }` there to advance a paused `screen` node.
  The gate therefore keys on **what the run is parked on**:

  - `ActionDescriptor.resumeAuthority` (`'any'` | `'service'`, default `'any'`) —
    a pausing node declares who may continue it. `approval` declares `'service'`.
  - The engine refuses a `'service'` suspension unless the signal carries
    `RESUME_AUTHORITY_SERVICE` (`@objectstack/spec/contracts`), a **symbol** the
    owning service stamps in-process — a JSON body can never produce one, so the
    transport cannot forge it. `ApprovalService` stamps it on the tail of a
    decision it has already authorized and recorded.
  - The gate follows a **subflow** pause down to the child the signal would
    actually reach, so resuming the parent is not a way around it.
  - Refusal returns `{ success: false, code: 'forbidden' }` and the route answers
    **403**. Nothing is consumed — the request stays pending and the run stays
    parked, so the real decision still lands.

  `screen` and `wait` pauses are unchanged, as is every path that already went
  through the approvals API. What changes for consumers:

  - **FROM:** finishing an approval with
    `client.automation.resume(flow, runId, { branchLabel: 'approve' })`
    **TO:** `client.approvals.approve(requestId, …)` (or `.reject` / `.recall`).
    The old call now answers 403 and changes nothing.
  - Registering your own pausing node whose continuation belongs to a service
    rather than to whoever holds the run id? Declare `resumeAuthority: 'service'`
    on its descriptor and stamp `RESUME_AUTHORITY_SERVICE` on the signal from that
    service.

  A suspension now records the node type that produced it
  (`SuspendedRun.nodeType` / `sys_automation_run.node_type`), captured at suspend
  time so a flow republished mid-pause cannot re-type the node out from under the
  gate; rows written before this fall back to the flow definition.

- 1b717e5: test(client): close the route audit's reverse direction — every SDK URL must match a route some surface mounts (#3642)

  The capstone of the #3563 route audit. The dispatcher (#3563), REST (#3587) and
  service-mount (#3636) ledgers all run server → client: enumerate what a surface
  mounts, demand a reviewed disposition, and for `sdk` rows demand the named
  client method exists. None of them asked the reverse question — does the URL
  the client _builds_ match anything a server _mounts_? — so a method could name
  a real function, carry a green ledger row, and 404 everywhere.

  That shipped four times, found one at a time by hand: `analytics.explain` and
  `analytics.meta` (#3584), `meta.getView` (#3611), and `i18n.getTranslations` /
  `getFieldLabels` (#3636) — the last pair having carried green `sdk` rows since
  tranche 1.

  `client-url-conformance.test.ts` drives every method on a real client with a
  recording `fetch` and matches each captured URL against the union of all four
  ledgers. A real drive rather than a hand-written "method X targets route Y"
  table, because such a table is an assertion _about_ the code that the code can
  drift away from — the exact failure being fixed. Mutation-checked: re-injecting
  the #3636 dialect bug fails the suite.

  The sweep's own completeness is asserted, since that is what rots silently — a
  new method must be driven or declared `NON_HTTP` with a reason; a driven method
  emitting zero requests fails (stale placeholder args are how a sweep quietly
  stops covering anything); a URL containing `undefined` fails; and the
  `__api-endpoint` `(unmatched)` catch-all is excluded from the pattern set so it
  cannot match everything and make the suite vacuous.

  196 of ~219 methods matched. Two bounds are reported rather than papered over:
  `/api/v1/cloud/*` (23 `projects.*` methods) belongs to the sibling `cloud` repo
  and is exempt by prefix, bounded so no other namespace can use it (#3655); and
  60 of ~196 matched calls rest only on a `**` prefix claim rather than a
  resolvable route — 54 of those on `* /auth/**` — a count the guard ratchets so
  it can only shrink (#3656).

  No runtime change: this is a guard plus the ledger-header and audit-doc notes
  recording what it does and does not cover.

- 16adb3c: fix(rest,client)!: reconcile the two REST↔client mismatches the #3587 audit
  ledgered (#3610, #3611)

  **#3610 — `POST /api/v1/packages` publish-vs-install collision.** The REST
  package registrar claimed the bare `POST /packages` for _marketplace publish_
  (`{manifest, metadata}`), while the dispatcher packages domain gives the same
  verb+path _install_ semantics — and REST registers first in the production
  stack (first-match-wins), so every `client.packages.install` call landed on
  the publish handler and 400'd. Marketplace publish moves to
  `POST /api/v1/packages/publish` (breaking for direct callers; a repo-wide and
  objectui-wide sweep found zero). The dispatcher's `POST /packages/:id/publish`
  (ADR-0033 draft publish) is two segments — different shape, no clash. The
  dispatcher already writes both stores on install (`protocol.installPackage`)
  and fully uninstalls on DELETE (`protocol.deletePackage`), so the remaining
  REST GET/GET/DELETE shadows stay — they are compatible.

  **#3611 — UI view dialect split.** `meta.getView` spoke the `?type=` query
  dialect that only the dispatcher `/ui` domain understands; the REST surface
  mounts only the path form `/ui/view/:object/:type`, so the query form 404'd
  wherever REST serves (e.g. project-scoped bases). The client now sends the
  path form both surfaces accept; a URL-pinning test keeps it that way.

  REST route ledger updated: the two `mismatch` rows are resolved (packages
  publish row is `server-only` publisher tooling; the ui row flips to `sdk`).
  The ledger now carries zero mismatches.

- 3d5f726: feat(rest): route audit tranche 2 — the REST surface gets its own ledger +
  conformance guard (#3587, follow-up to #3563)

  The dispatcher tranche closed its 27 gaps and guards them (#3569…#3579), but
  `@objectstack/rest` mounts a second, larger surface the client also reaches —
  89 routes, never audited. `rest-route-ledger.ts` now records a reviewed
  disposition for every one of them (38 sdk, 43 gap, 3 server-only, 3 public,
  2 mismatch), and the guard is real enumeration on both sources: RouteManager
  routes via the `getRoutes()` introspection seam, and the two
  RouteManager-bypassing registrars (`package-routes.ts`,
  `external-datasource-routes.ts`) via captured mock-server registrations — no
  pinned-by-hand list. The client half
  (`rest-route-ledger-coverage.test.ts`) verifies every claimed method exists;
  a 43-gap ratchet is wired into CI. Every guard direction was negative-tested.

  Notable dispositions the audit surfaced: `POST /api/v1/packages` is a
  publish/install shape collision between REST and the dispatcher (REST
  registers first and wins) — ledgered `mismatch`; the REST
  `GET /ui/view/:object/:type` path dialect is unreachable by the SDK's
  query-param dialect — ledgered `mismatch`; `service-storage` /
  `service-i18n` mount a third route surface outside `@objectstack/rest`,
  explicitly out of scope here and tracked under #3587.

  No behavior change — data + tests only, plus a scope-note refresh in the
  runtime ledger pointing at the new REST ledger.

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

- 48d5a1c: Route ledger + conformance guard for the dispatcher↔client surface (#3563)

  #3528's root-cause class — a route that exists and works while
  `@objectstack/client` has no way to express it — now has an inventory and a
  ratchet. `route-ledger.ts` records the audited disposition of every dispatcher
  route (sdk / gap / server-only / public / dynamic / mismatch);
  The guard is split along the package boundary (a runtime→client edge is a
  build cycle): runtime's `route-ledger.conformance.test.ts` fails when a
  dispatcher domain lands with no ledger entry and ratchets the audited gap
  count (27 at PR-1); client's `route-ledger-coverage.test.ts` fails when a
  ledger entry claims a client method that doesn't exist. Findings and follow-up slicing live
  in `docs/audits/2026-07-dispatcher-client-route-coverage.md`. No runtime
  behavior change.

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
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
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
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Minor Changes

- 9ccd1e9: feat(client): typed `data.batchTransaction()` for the atomic cross-object batch (#1604 / ADR-0034 item 4)

  Adds `client.data.batchTransaction(operations)` (and the environment-scoped
  `client.project(id).data.batchTransaction`) — a typed SDK surface for
  `POST {basePath}/batch`, the all-or-nothing cross-object transactional batch
  that master-detail saves go through. Reuses `CrossObjectBatchOperation` /
  `CrossObjectBatchRequest` / `CrossObjectBatchResponse` from
  `@objectstack/spec/api` (also re-exported from the client for convenience);
  supports `{ $ref: <opIndex> }` intra-batch parent references.

  The method is always atomic and deliberately exposes no `atomic` flag — the
  endpoint rejects `atomic: false` with `400 BATCH_NOT_ATOMIC`. Non-atomic
  per-object bulk writes stay on `data.batch()` / `createMany` / `updateMany`,
  so any best-effort fallback is isolated in the caller's adapter (the ObjectUI
  `masterDetailTx` adapter), not in the SDK.

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

- 668dd17: **Breaking (npm type surface): retire the vestigial feed contracts + protocol surface (ADR-0052 §5 follow-up, #1959).**

  The `service-feed` runtime was deleted in #1955; `sys_comment` / `sys_activity`
  are the canonical record-collaboration/timeline backend. This removes the dead
  type surface that still pointed at the deleted runtime — every removed method was
  already unreachable (the feed REST route was never mounted → 404; the protocol
  implementation was never wired with a feed service, so `requireFeedService()`
  could only throw). No behavior changes.

  No authorable metadata key is removed (the `feeds:` object capability flag and
  the `RecordActivity` UI component config are unchanged), so `PROTOCOL_MAJOR`
  stays 15 and this ships as `minor` rather than a protocol major.

  FROM → TO migration for every removed export:

  - `@objectstack/spec/contracts` — `IFeedService`, `CreateFeedItemInput`,
    `UpdateFeedItemInput`, `ListFeedOptions`, `FeedListResult` → **removed, no
    replacement**. Comments/activity are plain records: write `sys_comment` / read
    `sys_activity` via the data engine or the REST data API.
  - `@objectstack/spec/api` — `FeedApiContracts`, `FeedApiErrorCode`,
    `FeedProtocol`, and all feed request/response schemas + types (`GetFeed*`,
    `CreateFeedItem*`, `UpdateFeedItem*`, `DeleteFeedItem*`, `AddReaction*`,
    `RemoveReaction*`, `PinFeedItem*`, `UnpinFeedItem*`, `StarFeedItem*`,
    `UnstarFeedItem*`, `SearchFeed*`, `GetChangelog*`, `ChangelogEntry`,
    `SubscribeRequest/Response`, `FeedUnsubscribeRequest`, `UnsubscribeResponse`,
    `FeedPathParams`, `FeedItemPathParams`, `FeedListFilterType`) → **removed**. Use
    the data API against `sys_comment` / `sys_activity` (`/api/v1/data/sys_comment/…`);
    reactions and threaded replies are fields on `sys_comment`.
  - `@objectstack/spec/data` — `FeedItemSchema`/`FeedItem`, `FeedActorSchema`/`FeedActor`,
    `MentionSchema`/`Mention`, `ReactionSchema`/`Reaction`,
    `FieldChangeEntrySchema`/`FieldChangeEntry`, `FeedVisibility`,
    `RecordSubscriptionSchema`/`RecordSubscription`, `SubscriptionEventType`, and the
    `data`-namespace `NotificationChannel` → **removed**. `FeedItemType` and
    `FeedFilterMode` are **kept** (live UI activity-timeline config). For notification
    channels use `NotificationChannelSchema` from `@objectstack/spec/system`.
  - `@objectstack/client` — `client.feed.*` (`list` / `create` / `update` / `delete` /
    `addReaction` / `removeReaction` / `pin` / `unpin` / `star` / `unstar` / `search` /
    `getChangelog` / `subscribe` / `unsubscribe`) and the re-exported feed response
    types → **removed**. One-line fix: use `client.data.*` on `sys_comment` /
    `sys_activity`, e.g. `client.data.create('sys_comment', { object, record_id, body })`
    and `client.data.find('sys_activity', { filters: [['record_id', '=', id]] })`.
  - `@objectstack/metadata-protocol` — `ObjectStackProtocolImplementation` no longer
    implements the 14 feed methods; its constructor
    `(engine, getServicesRegistry?, getFeedService?, environmentId?)` becomes
    `(engine, getServicesRegistry?, environmentId?)`. One-line fix: delete the third
    argument.

### Patch Changes

- 8abf133: **Breaking (discovery response shape): retire the residual feed capability surface (#3180, follow-up to #1959 / ADR-0052 §5).**

  The feed backend was retired long ago; #1959 removed the feed contracts + SDK. This
  removes the last discovery/dispatcher references to it, and fixes a real bug where the
  `comments` capability was permanently `false`.

  - `@objectstack/spec` — `WellKnownCapabilitiesSchema.feed` and `ApiRoutesSchema.feed`
    (`routes.feed`) are **removed**, and the `/api/v1/feed` entry is dropped from
    `DEFAULT_DISPATCHER_ROUTES`. FROM → TO: clients reading `discovery.capabilities.feed`
    or `discovery.routes.feed` → use `discovery.capabilities.comments`; comments/activity
    are served by the generic data API on `sys_comment` / `sys_activity`
    (`/api/v1/data/sys_comment/…`).
  - `@objectstack/metadata-protocol` — `getDiscovery()` no longer emits the always-`false`
    `feed` service/capability. **Bug fix:** the `comments` capability previously keyed off
    the deleted `'feed'` service (so it was permanently `false` after #1955); it now tracks
    the presence of the `sys_comment` object (provided by the always-on audit slate), so
    `declared === enforced`.
  - `@objectstack/client` — the internal `feed: '/api/v1/feed'` route constant is removed
    (it only existed to satisfy the now-removed `ApiRoutes.feed` type; no client code used it).

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
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
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 9ccd1e9: feat(client): typed `data.batchTransaction()` for the atomic cross-object batch (#1604 / ADR-0034 item 4)

  Adds `client.data.batchTransaction(operations)` (and the environment-scoped
  `client.project(id).data.batchTransaction`) — a typed SDK surface for
  `POST {basePath}/batch`, the all-or-nothing cross-object transactional batch
  that master-detail saves go through. Reuses `CrossObjectBatchOperation` /
  `CrossObjectBatchRequest` / `CrossObjectBatchResponse` from
  `@objectstack/spec/api` (also re-exported from the client for convenience);
  supports `{ $ref: <opIndex> }` intra-batch parent references.

  The method is always atomic and deliberately exposes no `atomic` flag — the
  endpoint rejects `atomic: false` with `400 BATCH_NOT_ATOMIC`. Non-atomic
  per-object bulk writes stay on `data.batch()` / `createMany` / `updateMany`,
  so any best-effort fallback is isolated in the caller's adapter (the ObjectUI
  `masterDetailTx` adapter), not in the SDK.

- 668dd17: **Breaking (npm type surface): retire the vestigial feed contracts + protocol surface (ADR-0052 §5 follow-up, #1959).**

  The `service-feed` runtime was deleted in #1955; `sys_comment` / `sys_activity`
  are the canonical record-collaboration/timeline backend. This removes the dead
  type surface that still pointed at the deleted runtime — every removed method was
  already unreachable (the feed REST route was never mounted → 404; the protocol
  implementation was never wired with a feed service, so `requireFeedService()`
  could only throw). No behavior changes.

  No authorable metadata key is removed (the `feeds:` object capability flag and
  the `RecordActivity` UI component config are unchanged), so `PROTOCOL_MAJOR`
  stays 15 and this ships as `minor` rather than a protocol major.

  FROM → TO migration for every removed export:

  - `@objectstack/spec/contracts` — `IFeedService`, `CreateFeedItemInput`,
    `UpdateFeedItemInput`, `ListFeedOptions`, `FeedListResult` → **removed, no
    replacement**. Comments/activity are plain records: write `sys_comment` / read
    `sys_activity` via the data engine or the REST data API.
  - `@objectstack/spec/api` — `FeedApiContracts`, `FeedApiErrorCode`,
    `FeedProtocol`, and all feed request/response schemas + types (`GetFeed*`,
    `CreateFeedItem*`, `UpdateFeedItem*`, `DeleteFeedItem*`, `AddReaction*`,
    `RemoveReaction*`, `PinFeedItem*`, `UnpinFeedItem*`, `StarFeedItem*`,
    `UnstarFeedItem*`, `SearchFeed*`, `GetChangelog*`, `ChangelogEntry`,
    `SubscribeRequest/Response`, `FeedUnsubscribeRequest`, `UnsubscribeResponse`,
    `FeedPathParams`, `FeedItemPathParams`, `FeedListFilterType`) → **removed**. Use
    the data API against `sys_comment` / `sys_activity` (`/api/v1/data/sys_comment/…`);
    reactions and threaded replies are fields on `sys_comment`.
  - `@objectstack/spec/data` — `FeedItemSchema`/`FeedItem`, `FeedActorSchema`/`FeedActor`,
    `MentionSchema`/`Mention`, `ReactionSchema`/`Reaction`,
    `FieldChangeEntrySchema`/`FieldChangeEntry`, `FeedVisibility`,
    `RecordSubscriptionSchema`/`RecordSubscription`, `SubscriptionEventType`, and the
    `data`-namespace `NotificationChannel` → **removed**. `FeedItemType` and
    `FeedFilterMode` are **kept** (live UI activity-timeline config). For notification
    channels use `NotificationChannelSchema` from `@objectstack/spec/system`.
  - `@objectstack/client` — `client.feed.*` (`list` / `create` / `update` / `delete` /
    `addReaction` / `removeReaction` / `pin` / `unpin` / `star` / `unstar` / `search` /
    `getChangelog` / `subscribe` / `unsubscribe`) and the re-exported feed response
    types → **removed**. One-line fix: use `client.data.*` on `sys_comment` /
    `sys_activity`, e.g. `client.data.create('sys_comment', { object, record_id, body })`
    and `client.data.find('sys_activity', { filters: [['record_id', '=', id]] })`.
  - `@objectstack/metadata-protocol` — `ObjectStackProtocolImplementation` no longer
    implements the 14 feed methods; its constructor
    `(engine, getServicesRegistry?, getFeedService?, environmentId?)` becomes
    `(engine, getServicesRegistry?, environmentId?)`. One-line fix: delete the third
    argument.

### Patch Changes

- 8abf133: **Breaking (discovery response shape): retire the residual feed capability surface (#3180, follow-up to #1959 / ADR-0052 §5).**

  The feed backend was retired long ago; #1959 removed the feed contracts + SDK. This
  removes the last discovery/dispatcher references to it, and fixes a real bug where the
  `comments` capability was permanently `false`.

  - `@objectstack/spec` — `WellKnownCapabilitiesSchema.feed` and `ApiRoutesSchema.feed`
    (`routes.feed`) are **removed**, and the `/api/v1/feed` entry is dropped from
    `DEFAULT_DISPATCHER_ROUTES`. FROM → TO: clients reading `discovery.capabilities.feed`
    or `discovery.routes.feed` → use `discovery.capabilities.comments`; comments/activity
    are served by the generic data API on `sys_comment` / `sys_activity`
    (`/api/v1/data/sys_comment/…`).
  - `@objectstack/metadata-protocol` — `getDiscovery()` no longer emits the always-`false`
    `feed` service/capability. **Bug fix:** the `comments` capability previously keyed off
    the deleted `'feed'` service (so it was permanently `false` after #1955); it now tracks
    the presence of the `sys_comment` object (provided by the always-on audit slate), so
    `declared === enforced`.
  - `@objectstack/client` — the internal `feed: '/api/v1/feed'` route constant is removed
    (it only existed to satisfy the now-removed `ApiRoutes.feed` type; no client code used it).

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
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
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
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
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

## 15.1.0

### Patch Changes

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
- Updated dependencies [4109153]
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
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- e46169c: 面向最终用户的错误消息去掉调试噪音:REST 数据路由(`mapDataError`)对沙箱 hook/action 抛错解包 `SandboxError.innerMessage`(并对丢失实例的情况正则剥离 `hook 'x' threw: Error: ` 包装,保留 `TypeError:` 等非默认错误名);客户端 SDK 的 `error.message` 不再拼 `[ObjectStack] CODE:` 前缀(code 仍在 `error.code` 上可编程读取)。控制台报错 toast 从 `[ObjectStack] hook 'pm_ref_base' threw: Error: 制作基地被…` 变为只显示业务消息本身;完整调试包装仍写入服务端日志。
- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- e4cf774: fix(auth): single-source Console page-URL construction; correct SMS + OAuth-callback landing paths

  Root-cause hardening after the invitation-link fixes. Every user-facing link
  to a Console page is `${origin}${uiBasePath}${path}`, but that composition was
  hand-written at each call site — which is how the scheme / `/_console` prefix
  kept getting dropped one link at a time.

  **plugin-auth**

  - New single-source `getConsolePageUrl(path)` helper; `loginPage`,
    `consentPage`, device `verificationUri` and the invitation accept URL all
    compose through it, so future page links can't drift.
  - Phone-invite SMS now links to the actual Console sign-in page
    (`${origin}${uiBasePath}/login`) via a new `{{loginUrl}}` template variable
    instead of the bare origin. `{{baseUrl}}` is still provided for backward
    compatibility with tenant-overridden templates.

  **client**

  - `signInWithProvider` now defaults `callbackURL` to the current page
    (`window.location.href`) instead of a hard-coded `origin + '/login'`. The
    SDK cannot know the app's mount path (Console lives under `/_console`), so
    returning the user to where they started is the only base-path-correct
    default; it also mirrors `linkSocial`. Pass an explicit `callbackURL` to
    override.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0

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
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

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

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Minor Changes

- 7087cfe: Remove the unused HTTP framework adapters and the MSW plugin — the open edition ships the **Hono** adapter only.

  The `express` / `fastify` / `nextjs` / `nestjs` / `nuxt` / `sveltekit` adapters and
  `@objectstack/plugin-msw` had **zero internal consumers** and were not dogfooded —
  pure release/maintenance surface (and an untested-integration liability). They are
  removed; `@objectstack/hono` (the adapter actually used, via `@objectstack/client`)
  is kept.

  - Deleted packages: `@objectstack/express`, `@objectstack/fastify`,
    `@objectstack/nextjs`, `@objectstack/nestjs`, `@objectstack/nuxt`,
    `@objectstack/sveltekit`, `@objectstack/plugin-msw` (fixed group 73 → 66).
  - `@objectstack/client`: dropped the `plugin-msw` / `msw` dev usage (MSW test removed).
  - `HttpDispatcher` (the dispatch engine) is now used only by the Hono adapter +
    the internal dispatcher-plugin, so its misleading `@deprecated → createDispatcherPlugin`
    note (createDispatcherPlugin is a kernel plugin, not a drop-in) is corrected.

  Anyone needing another framework adapter can build one on the public
  `HttpDispatcher` / `createDispatcherPlugin` API or maintain it out-of-tree.

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- 1b00ba2: chore(client): remove dead `projects.*` env-member SDK methods (cloud#533 / ADR-0024 D9)

  Removes `projects.listMembers` / `addMember` / `updateMemberRole` / `removeMember`,
  which called `GET/POST/PATCH/DELETE /api/v1/cloud/environments/:id/members`. Those
  control-plane endpoints were deleted in cloud#533 (retiring `sys_environment_member`),
  so the methods returned 404. Org membership/invites now flow through the better-auth
  `organization` plugin (`organization.inviteMember` / `listMembers` / …); objectui
  already uses `organization.*` and no in-repo callers remained.

  The `membership` field on the `projects.get()` response is unchanged — cloud#533 still
  returns it on the single-env GET (re-sourced to the caller's org `sys_member` role).

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
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

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

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

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

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

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

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

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

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Minor Changes

- 2170ad9: client SDK: add `approvals` namespace; remove dead workflow approve/reject surface (ADR-0019)

  ADR-0019 collapsed approval into Flow: approval is no longer a workflow step but
  a first-class **flow node** that opens a request and suspends the run, with a
  human decision resuming the flow down the matching `approve` / `reject` edge.
  The server already exposes this as a dedicated `/api/v1/approvals` surface
  (`registerApprovalsEndpoints`), but the client SDK still carried the old
  approval-on-`workflow` methods, which pointed at routes that never existed.

  - **`@objectstack/client`** gains a `client.approvals` namespace backed by the
    real REST surface:

    - `listRequests(filter?)` → `GET /approvals/requests` (the "my approvals"
      inbox; filter by `status` (single or array), `object`, `recordId`,
      `approverId`, `submitterId`).
    - `getRequest(id)` → `GET /approvals/requests/:id`.
    - `approve(id, { actorId?, comment? })` / `reject(id, …)` →
      `POST /approvals/requests/:id/{approve,reject}` (records a decision and
      resumes the owning flow run).
    - `listActions(id)` → `GET /approvals/requests/:id/actions` (audit trail).

    The approval runtime types (`ApprovalRequestRow`, `ApprovalActionRow`,
    `ApprovalStatus`, `ApprovalDecisionInput`, `ApprovalDecisionResult`) are
    re-exported so consumers can type the namespace without reaching into
    `@objectstack/spec`.

  - **Removed the dead workflow approve/reject surface.** `client.workflow.approve`
    / `client.workflow.reject` and the backing `WorkflowApprove*` / `WorkflowReject*`
    protocol schemas, types, `IProtocolService` methods, and the `/approve` /
    `/reject` entries in `DEFAULT_WORKFLOW_ROUTES` are gone — approval decisions
    are no longer recorded on a workflow record. `workflow` is reclaimed for state
    machines, so `getConfig` / `getState` / `transition` are unchanged.

  - Discovery advertises the new route key: `ApiRoutesSchema.approvals`.

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

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Major Changes

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- 5326c6b: Studio developer UX overhaul.

  - **Inspector drawer** (right Sheet, toggle via header button or `]`) with API / Source / Refs tabs that auto-populate from the current resource detail page.
  - **Problems panel** (status bar pill + `[`) that subscribes to object/view/flow/hook changes and surfaces unknown object refs, missing field refs, and broken triggers with deep-links back to source.
  - **Keyboard shortcuts**: `g o|f|v|a|s|p` navigation, `[` problems, `]` inspector, `?` help dialog.
  - **Resource actions menu** (`⋯` on detail page header): Copy as curl / fetch() / `defineX()` TypeScript / Metadata JSON; Open in VS Code; Open API endpoint.
  - **Welcome onboarding** empty-state in the developer overview when a package has no metadata.
  - New `StudioShell` wrapper; `TopBar` gains a `rightSlot` prop for Inspector / Help buttons.

  `@objectstack/client`: surface plain-string `error` bodies (e.g. `RECORD_LOCKED: …`) in fetch error messages instead of swallowing them as `Bad Request`.

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

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Minor Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

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

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9
- @objectstack/core@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8
- @objectstack/core@1.0.8

## 1.0.7

### Patch Changes

- ebdf787: feat: implement standard service discovery via `/.well-known/objectstack`
  - @objectstack/spec@1.0.7
  - @objectstack/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/core@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4
- @objectstack/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/spec@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1
- @objectstack/core@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 0.3.1

### Patch Changes

- @objectstack/spec@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
