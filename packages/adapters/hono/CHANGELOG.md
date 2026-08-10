# @objectstack/hono

## 17.0.0-rc.6

### Patch Changes

- Updated dependencies [97b0798]
- Updated dependencies [4c5df00]
- Updated dependencies [f7d80f4]
- Updated dependencies [121852d]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86e6f6c]
- Updated dependencies [e2798fa]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [c8d6f6e]
- Updated dependencies [1fe436d]
- Updated dependencies [7cdbcbb]
- Updated dependencies [db59e9c]
- Updated dependencies [c51ffa5]
- Updated dependencies [6146b67]
- Updated dependencies [73648ba]
- Updated dependencies [a954634]
- Updated dependencies [8fbed3b]
- Updated dependencies [b295e4b]
- Updated dependencies [1fa224a]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [f8fe47e]
- Updated dependencies [6155c3c]
- Updated dependencies [d13f627]
- Updated dependencies [0996899]
- Updated dependencies [378d8b1]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [68f5ecc]
- Updated dependencies [bd5fc38]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
  - @objectstack/runtime@17.0.0-rc.6
  - @objectstack/plugin-hono-server@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- @objectstack/plugin-hono-server@17.0.0-rc.5
- @objectstack/runtime@17.0.0-rc.5
- @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [739f496]
- Updated dependencies [28ad90e]
- Updated dependencies [64cd010]
- Updated dependencies [29c6c9d]
- Updated dependencies [9f747ee]
- Updated dependencies [43ca399]
- Updated dependencies [eda599e]
- Updated dependencies [7bf3d1c]
- Updated dependencies [db9c331]
- Updated dependencies [77022a9]
- Updated dependencies [217b791]
- Updated dependencies [fd8521f]
- Updated dependencies [18b8eaa]
- Updated dependencies [78adc2e]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [a70cd0a]
- Updated dependencies [08f93bc]
- Updated dependencies [d9cac60]
- Updated dependencies [dfa8bad]
- Updated dependencies [02dc076]
- Updated dependencies [55dbbba]
- Updated dependencies [1203bb2]
- Updated dependencies [caf144a]
- Updated dependencies [2ddba89]
- Updated dependencies [ef7845a]
- Updated dependencies [0cd08d5]
- Updated dependencies [ae490ef]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [aac90a5]
  - @objectstack/runtime@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/plugin-hono-server@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [7e7a605]
- Updated dependencies [2826d1e]
- Updated dependencies [63b33e6]
- Updated dependencies [ff17642]
- Updated dependencies [20bc357]
- Updated dependencies [ac471a0]
- Updated dependencies [eb4204b]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [8aacf94]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [5a84d41]
- Updated dependencies [ea90179]
- Updated dependencies [dadb43f]
  - @objectstack/runtime@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/plugin-hono-server@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

- 4be9d99: fix(runtime,hono,plugin-dev): retire the dispatcher's `/storage` bridge — it never spoke the storage contract (#4087)

  `POST /api/v1/storage/upload` and `GET /api/v1/storage/file/:id` were a
  dispatcher-side bridge to the `file-storage` service slot, written against a
  service shape that does not exist:

  - **Upload** called the contract's `upload(key, data, options?)` as
    `upload(file, { request })` — the parsed file object landed in the `key`
    slot and `{ request }` in `data`. That is a `TypeError` against every
    implementation in the repo (`S3StorageAdapter`, `LocalStorageAdapter`,
    `SwappableStorageService`, plugin-dev's in-memory one), not a
    near-miss: `Buffer.from({}) → ERR_INVALID_ARG_TYPE`, or an object used as
    an S3 object key / `path.join` segment.
  - **Download** branched on `result.url` / `result.redirect` / `result.stream`
    / `result.mimeType` while the contract's `download(key)` resolves a
    `Buffer`, so every branch fell through and the route answered a
    JSON-serialized Buffer.

  Both routes are removed, along with `HttpDispatcher.handleStorage()`, the
  `/storage` domain registration, the dispatcher-plugin mounts and the two route
  ledger rows.

  **Migration.** There is nothing to migrate off in practice — neither route
  could complete a request. (They were reachable: `service-storage` mounts
  `/storage/upload/presigned`, not `/storage/upload`, so nothing shadowed them.
  They simply had no caller — no SDK method builds those URLs.)
  `/api/v1/storage` is `@objectstack/service-storage`'s surface and always was
  the working one:

  - Upload — FROM `POST /api/v1/storage/upload` TO the presigned protocol
    (`POST /storage/upload/presigned` → direct `PUT` to the returned URL →
    `POST /storage/upload/complete`), or `client.storage.upload(file)`, which
    runs all three steps.
  - Download — FROM `GET /api/v1/storage/file/:id` TO
    `GET /storage/files/:fileId/url` (`client.storage.getDownloadUrl(fileId)`)
    for a signed URL, or `GET /storage/files/:fileId` for a stable browser URL
    that 302s to it.

  Install `@objectstack/service-storage` to get those routes; without it
  `/api/v1/storage` now has no handler, which is the same answer every other
  uninstalled capability gives.

  Two follow-on corrections keep `declared === enforced`:

  - `@objectstack/hono` no longer mounts `app.all('<prefix>/storage/*')`. That
    wildcard claimed the whole `/storage` subtree for the two dead routes, so
    every other path under it — service-storage's protocol above all — got the
    bridge's own 404 rather than falling through. Storage is ordinary catch-all
    traffic now.
  - Discovery keeps gating `routes.storage` on `isServiceServeable` — the shared
    `handlerReady` predicate #4058 step 2 introduced — and plugin-dev's in-memory
    implementation now self-declares `handlerReady: false`. #4058 deliberately
    left that one serving because the `/storage` bridge was still there to serve
    it; with the bridge retired nothing routes HTTP to that slot, so `false` is
    the honest value — the position `realtime` has held since ADR-0076 D12. The
    implementation keeps working for in-process callers; it is simply no longer
    advertised as a reachable HTTP capability.

### Patch Changes

- 554ff92: fix(adapters/hono): the auth wildcard yields paths the auth service does not own (#4117)

  `app.all('${prefix}/auth/*')` claimed a whole namespace and was **terminal**: it
  returned the auth service's response unconditionally, including better-auth's 404
  for a path it does not implement, and the legacy `handleAuth` bridge's own
  `handled: false` 404. That is the #4088 shape, found by #4116's enumeration after
  manual greps had missed it.

  A 404 from better-auth, or `handled: false` from the dispatcher, now means "not
  this mount's path" and the handler yields. The predicate is the dispatcher's own
  `handled` flag wherever one exists — an explicit ownership answer beats inferring
  one from a status; only the better-auth hand-off lacks such a flag, and there the
  404 is the signal, as in #4092.

  **What changes on the wire.** An unowned path under `${prefix}/auth/*` used to get
  a 404 built by this mount. It now continues to the `${prefix}/*` dispatcher
  catch-all and gets a real, gate-carrying `dispatch()` attempt, so a domain handler
  registered for such a path becomes reachable — this adapter's actual extension
  mechanism. When nothing anywhere claims the path the reply is still the same
  enveloped `{ success: false, error: { message: 'Not Found', code: 404 } }`. Paths
  the auth service does own are untouched, and a 401/403 from it is never treated as
  a disclaimer of ownership.

  No configuration changes and no new routes.

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

- 2053714: fix(hono,plugin-hono-server,runtime): one CORS source and one registry key — the last derivable copies from the #3786 sweep

  Re-ran the sweep across all 72 packages. The earlier pass globbed `packages/*/src`,
  which is one level deep, so it missed everything under `packages/plugins/` and
  `packages/adapters/` — the "sweep is basically clean" report was based on an
  incomplete scan.

  **A stale CORS default, on the one description callers actually read.**
  `HonoCorsOptions.allowHeaders`' TSDoc promised
  `['Content-Type', 'Authorization', 'X-Requested-With']` "which is sufficient for
  cookie and bearer-token auth". The real default carries three more:
  `X-Tenant-ID` and `X-Environment-Id` (multi-tenant routing) and `If-Match` (the
  OCC token on record PATCHes, objectui#2572). Sizing a custom `allowHeaders`
  against that sentence drops all three and every cross-origin save fails with
  "Failed to fetch".

  The instructive part: **three** Hono CORS sites each carried their own copy of
  the defaults under "keep in sync" comments, and the copies all agreed. What
  drifted was the _doc_ — the only description with no counterpart to be diffed
  against, and the only one a caller reads.

  Both defaults are now single constants, `DEFAULT_CORS_ALLOW_HEADERS` and
  `DEFAULT_CORS_EXPOSE_HEADERS`, exported from `@objectstack/plugin-hono-server`
  and imported by the adapter (which already depends on it — no new edge). The
  TSDoc links them rather than restating, and documents an asymmetry it never
  mentioned: `allowHeaders` REPLACES the default, `exposeHeaders` MERGES with it.

  `hono-plugin.test.ts` stopped stubbing `./adapter` wholesale and keeps the real
  constants via `importOriginal` — it asserts exact header lists, so a mocked copy
  would make the test agree with itself rather than with what ships. Verified:
  removing `If-Match` from the constant fails `should allow If-Match by default`,
  by name.

  **A third copy, in the public protocol docs.** `content/docs/protocol/kernel/
http-protocol.mdx` advertised `Access-Control-Allow-Headers: Authorization,
Content-Type` — two of the six — and methods missing `PUT` and `HEAD`, with no
  mention of the exposed headers at all. That is the copy an integrator builds a
  client against: reading it, you would not know `If-Match` is permitted (so you
  would not attempt OCC) or that `set-auth-token` is readable (so a rotated
  session would look like a bug). Corrected, with the three non-obvious allowed
  headers and the two exposed ones explained, and a pointer to the constants as
  the source of truth.

  **A hand-copied service-registry key.** `runtime`'s share-links domain resolved
  `'shareLinks'` as a string literal, copied from `SHARE_LINK_SERVICE` — whose own
  doc-comment says "keep in sync with the SharingPlugin registration". It now
  imports the constant. A drifted copy resolves nothing, so every share link
  answers 501 "Sharing is not configured for this environment" on an environment
  where it is configured perfectly well.

  **Plus a duplicate ledger entry**, which is the same defect one level up:
  `check-generated.ts` carried two `NO_GENERATOR` entries for
  `check:strictness-ledger`, because #4203 and #4252 each added one without seeing
  the other. Functionally harmless (the ledger is read into a `Set`) but it leaves
  two comments telling overlapping versions of the same story. #4203's is kept —
  it is the more complete account and it is the PR that fixed the underlying
  problem.

  Checked and deliberately left alone: `ApprovalStatus` (5 values) and
  `ApprovalActionKind` (12 values) versus their `plugin-approvals` selects — diffed
  verbatim, no drift today, still hand-copied across a package boundary.

- Updated dependencies [bc35e00]
- Updated dependencies [6e141bc]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [a4e2684]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [698cbc2]
- Updated dependencies [ffb003c]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [6fa1827]
- Updated dependencies [05154a1]
- Updated dependencies [0f12193]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fce14ab]
- Updated dependencies [2e836de]
- Updated dependencies [7309c81]
- Updated dependencies [41dcda3]
- Updated dependencies [545d931]
- Updated dependencies [a225ef5]
- Updated dependencies [c9d254a]
- Updated dependencies [c3bcb42]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [4dc14cc]
- Updated dependencies [0373d52]
- Updated dependencies [4f30943]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [bb192c4]
- Updated dependencies [98e7cc7]
- Updated dependencies [4cf7c61]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [8a341a4]
- Updated dependencies [b5f9397]
- Updated dependencies [385c4b0]
- Updated dependencies [45dc446]
- Updated dependencies [d4720ca]
- Updated dependencies [43ff598]
- Updated dependencies [e5a4d26]
- Updated dependencies [839982e]
- Updated dependencies [623e555]
- Updated dependencies [f985b3f]
- Updated dependencies [9881074]
- Updated dependencies [507b92a]
- Updated dependencies [99b4392]
- Updated dependencies [33a5ff4]
- Updated dependencies [39eb01b]
- Updated dependencies [7ce02eb]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [a1b61e0]
- Updated dependencies [2cb6d3c]
- Updated dependencies [3ba8d77]
- Updated dependencies [a3cb9c8]
- Updated dependencies [4be9d99]
- Updated dependencies [8dcc0f5]
- Updated dependencies [5b08389]
- Updated dependencies [a2266a6]
- Updated dependencies [5c13368]
- Updated dependencies [1d5dc46]
- Updated dependencies [627b188]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [de6daa5]
- Updated dependencies [d5749d7]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [2053714]
- Updated dependencies [7309c81]
- Updated dependencies [43fc039]
  - @objectstack/runtime@17.0.0-rc.1
  - @objectstack/plugin-hono-server@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

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

- cbedd62: fix(runtime,hono): close the remaining raw-driver-message exits on the HTTP boundary (#3867 follow-up)

  #3867 sanitised `dispatcher-plugin`'s `errorResponseBase`. That covers errors
  **thrown** out of `dispatch()` — but not the ones it **returns**. A
  `{handled: true, response}` result goes to `sendResult`, never through that
  catch, and those bodies are built by `HttpDispatcher.error()`, which passed the
  message through verbatim. Sweeping the boundary for the same defect class (the
  follow-up #3867 called for) turned up two more live exits:

  **`HttpDispatcher.error()`** — the single construction point for every returned
  error response. Reachable with a raw driver message today through
  `errorFromThrown` (`/meta` save, `/packages` install) and the MCP transport's
  `deps.error(err?.message, 500)`. Pinned by a test that drives
  `PUT /meta/:type/:name` with a throwing `protocol.saveMetaItem`: without the
  guard the response body is the driver's `insert into \`sys_team\` … UNIQUE
  constraint failed: sys_team.id`, naming a physical table and column.

  **`@objectstack/hono`'s auth-config route** — a 500 built from a caught
  error with `message: err.message`. The auth service reads from the database, so
  that message can carry a driver dump.

  Both apply the same `looksLikeInternalErrorLeak` predicate #3867 put in
  `@objectstack/types`, and both are scoped to **5xx** for the same reason: a 4xx
  message is a deliberate business/validation answer (`Path must be
/actions/:object/:action`, a hook's own `throw`, a `saveMetaItem` field error)
  and must reach the caller intact. Structured `details` — the semantic `code` and
  per-field `issues` the Studio maps back to inputs — is never touched, so a
  sanitised 500 still carries everything a client can act on.

  Diagnostics are unaffected: callers that threw still hand the original error to
  `errorReporter` via `__obsRecordedError`, and every 5xx is logged server-side.

  Audited in the same pass and deliberately left alone: the inline error bodies in
  the `ai` / `mcp` domains (static literal strings, no interpolated error text) and
  `plugin-hono-server`'s 403s (4xx, deliberate messages). With this change every
  dynamic message on both dispatcher exits and the REST data routes goes through
  one predicate.

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

- Updated dependencies [af5a224]
- Updated dependencies [879ea13]
- Updated dependencies [6877e9a]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [3c8cfd1]
- Updated dependencies [ad4af62]
- Updated dependencies [57a3bb3]
- Updated dependencies [9f060e5]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [19e3e6e]
- Updated dependencies [cbedd62]
- Updated dependencies [32d3800]
- Updated dependencies [c2d9098]
- Updated dependencies [9613396]
- Updated dependencies [4ed7ed4]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [41642b0]
- Updated dependencies [394b7a1]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [083c414]
- Updated dependencies [030125b]
- Updated dependencies [8e08bc3]
- Updated dependencies [3d5f726]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [48d5a1c]
- Updated dependencies [3216344]
- Updated dependencies [f5bfac8]
- Updated dependencies [6163393]
- Updated dependencies [688e9df]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [8891f93]
- Updated dependencies [d729a31]
- Updated dependencies [cb8322e]
- Updated dependencies [810a3a2]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [e231abb]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
  - @objectstack/runtime@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/plugin-hono-server@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [818e6a3]
  - @objectstack/plugin-hono-server@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [22013aa]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [6c270a6]
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
- Updated dependencies [ce468c8]
  - @objectstack/runtime@16.0.0
  - @objectstack/plugin-hono-server@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
  - @objectstack/plugin-hono-server@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [22013aa]
- Updated dependencies [fdc244e]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [83e8f7d]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [6c270a6]
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
- Updated dependencies [ce468c8]
  - @objectstack/runtime@16.0.0-rc.0
  - @objectstack/plugin-hono-server@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/runtime@15.1.1
- @objectstack/types@15.1.1
- @objectstack/plugin-hono-server@15.1.1

## 15.1.0

### Patch Changes

- f531a26: CORS default `allowHeaders` now includes `If-Match`. The REST record update
  accepts the OCC token as an `If-Match` header (objectui's record-level inline
  edit sends it on every save), but the preflight allow-list omitted it — so on
  any split-origin deployment (console dev server against a backend on another
  origin) the browser failed the preflight and every inline-edit save died with
  "Failed to fetch". Found live while dogfooding objectui#2572; same
  split-origin failure class as the #2548 Bearer fixes. Explicit user-supplied
  `allowHeaders` still win unchanged.
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
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
  - @objectstack/runtime@15.1.0
  - @objectstack/plugin-hono-server@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [e62c233]
  - @objectstack/runtime@15.0.0
  - @objectstack/plugin-hono-server@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- @objectstack/plugin-hono-server@14.8.0
- @objectstack/runtime@14.8.0
- @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [824a395]
  - @objectstack/types@14.7.0
  - @objectstack/plugin-hono-server@14.7.0
  - @objectstack/runtime@14.7.0

## 14.6.0

### Patch Changes

- @objectstack/plugin-hono-server@14.6.0
- @objectstack/runtime@14.6.0
- @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [5f43f88]
- Updated dependencies [261aff5]
- Updated dependencies [d79ca07]
- Updated dependencies [6da03ee]
  - @objectstack/runtime@14.5.0
  - @objectstack/plugin-hono-server@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- @objectstack/plugin-hono-server@14.4.0
- @objectstack/runtime@14.4.0
- @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- @objectstack/runtime@14.3.0
- @objectstack/plugin-hono-server@14.3.0
- @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
  - @objectstack/plugin-hono-server@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- @objectstack/plugin-hono-server@14.1.0
- @objectstack/runtime@14.1.0
- @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [bc26360]
- Updated dependencies [bd39dc5]
  - @objectstack/runtime@14.0.0
  - @objectstack/plugin-hono-server@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b1081b8]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
  - @objectstack/runtime@13.0.0
  - @objectstack/plugin-hono-server@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [b5a87eb]
  - @objectstack/runtime@12.6.0
  - @objectstack/plugin-hono-server@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- @objectstack/plugin-hono-server@12.5.0
- @objectstack/runtime@12.5.0
- @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [1dd5dfd]
  - @objectstack/runtime@12.4.0
  - @objectstack/plugin-hono-server@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- @objectstack/runtime@12.3.0
- @objectstack/plugin-hono-server@12.3.0
- @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [4f5b791]
  - @objectstack/runtime@12.2.0
  - @objectstack/plugin-hono-server@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [497bda8]
  - @objectstack/runtime@12.1.0
  - @objectstack/plugin-hono-server@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [9693a36]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
  - @objectstack/runtime@12.0.0
  - @objectstack/plugin-hono-server@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- @objectstack/plugin-hono-server@11.10.0
- @objectstack/runtime@11.10.0
- @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
  - @objectstack/runtime@11.9.0
  - @objectstack/plugin-hono-server@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/runtime@11.8.0
- @objectstack/types@11.8.0
- @objectstack/plugin-hono-server@11.8.0

## 11.7.0

### Patch Changes

- @objectstack/plugin-hono-server@11.7.0
- @objectstack/runtime@11.7.0
- @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/types@11.6.0
- @objectstack/runtime@11.6.0
- @objectstack/plugin-hono-server@11.6.0

## 11.5.0

### Patch Changes

- @objectstack/plugin-hono-server@11.5.0
- @objectstack/runtime@11.5.0
- @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- @objectstack/plugin-hono-server@11.4.0
- @objectstack/runtime@11.4.0
- @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- @objectstack/plugin-hono-server@11.3.0
- @objectstack/runtime@11.3.0
- @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- @objectstack/plugin-hono-server@11.2.0
- @objectstack/runtime@11.2.0
- @objectstack/types@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [e011d42]
- Updated dependencies [dc2990f]
- Updated dependencies [fdb41c0]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/runtime@11.1.0
  - @objectstack/plugin-hono-server@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [6c4fbd9]
- Updated dependencies [795b6d1]
- Updated dependencies [aa33b02]
  - @objectstack/runtime@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/plugin-hono-server@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/runtime@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/plugin-hono-server@10.3.0

## 10.2.0

### Patch Changes

- @objectstack/plugin-hono-server@10.2.0
- @objectstack/runtime@10.2.0
- @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
  - @objectstack/runtime@10.1.0
  - @objectstack/plugin-hono-server@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [e16f2a8]
- Updated dependencies [47d978a]
- Updated dependencies [220ce5b]
- Updated dependencies [00c32f2]
  - @objectstack/runtime@10.0.0
  - @objectstack/plugin-hono-server@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [2afb612]
  - @objectstack/runtime@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
  - @objectstack/runtime@9.10.0
  - @objectstack/plugin-hono-server@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/types@9.9.1
- @objectstack/runtime@9.9.1
- @objectstack/plugin-hono-server@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [11af299]
- Updated dependencies [83fd318]
- Updated dependencies [9afeb2d]
  - @objectstack/runtime@9.9.0
  - @objectstack/plugin-hono-server@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- @objectstack/runtime@9.8.0
- @objectstack/plugin-hono-server@9.8.0
- @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/runtime@9.7.0
- @objectstack/types@9.7.0
- @objectstack/plugin-hono-server@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [71578f2]
  - @objectstack/runtime@9.6.0
  - @objectstack/plugin-hono-server@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- @objectstack/plugin-hono-server@9.5.1
- @objectstack/runtime@9.5.1
- @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- @objectstack/plugin-hono-server@9.5.0
- @objectstack/runtime@9.5.0
- @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [0856476]
  - @objectstack/runtime@9.4.0
  - @objectstack/plugin-hono-server@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
  - @objectstack/runtime@9.3.0
  - @objectstack/plugin-hono-server@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- @objectstack/plugin-hono-server@9.2.0
- @objectstack/runtime@9.2.0
- @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- @objectstack/plugin-hono-server@9.1.0
- @objectstack/runtime@9.1.0
- @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- @objectstack/plugin-hono-server@9.0.1
- @objectstack/runtime@9.0.1
- @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- @objectstack/plugin-hono-server@9.0.0
- @objectstack/runtime@9.0.0
- @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/types@8.0.1
- @objectstack/runtime@8.0.1
- @objectstack/plugin-hono-server@8.0.1

## 8.0.0

### Patch Changes

- e15c845: feat(hono): re-export the `Hono` type from `@objectstack/hono`

  Downstream apps that consume `createHonoApp()` only need the `Hono` type to
  annotate the returned app. They can now `import type { Hono } from '@objectstack/hono'`
  instead of adding their own `hono` dependency, which guarantees a single
  `hono` across a `link:`/cross-package boundary (no duplicate-package
  type-identity errors, no version-pin alignment). `hono` remains a normal
  runtime dependency of this package, so standalone usage is unaffected.

- Updated dependencies [f68be58]
- Updated dependencies [93f97b2]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [c262301]
  - @objectstack/runtime@8.0.0
  - @objectstack/plugin-hono-server@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/runtime@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/plugin-hono-server@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [424ab26]
  - @objectstack/runtime@7.8.0
  - @objectstack/plugin-hono-server@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- @objectstack/plugin-hono-server@7.7.0
- @objectstack/runtime@7.7.0
- @objectstack/types@7.7.0

## 7.6.0

### Patch Changes

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

- Updated dependencies [8e539cc]
  - @objectstack/runtime@7.6.0
  - @objectstack/plugin-hono-server@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/types@7.5.0
- @objectstack/plugin-hono-server@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/types@7.4.1
- @objectstack/plugin-hono-server@7.4.1

## 7.4.0

### Patch Changes

- @objectstack/plugin-hono-server@7.4.0
- @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- @objectstack/plugin-hono-server@7.3.0
- @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/plugin-hono-server@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/plugin-hono-server@7.2.0

## 7.1.0

### Patch Changes

- @objectstack/plugin-hono-server@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-hono-server@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/plugin-hono-server@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/plugin-hono-server@6.8.1

## 6.8.0

### Patch Changes

- @objectstack/plugin-hono-server@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/plugin-hono-server@6.7.1

## 6.7.0

### Patch Changes

- @objectstack/plugin-hono-server@6.7.0

## 6.6.0

### Patch Changes

- @objectstack/plugin-hono-server@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/plugin-hono-server@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/plugin-hono-server@6.5.0

## 6.4.0

### Patch Changes

- @objectstack/plugin-hono-server@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/plugin-hono-server@6.3.0

## 6.2.0

### Patch Changes

- @objectstack/plugin-hono-server@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/plugin-hono-server@6.1.1

## 6.1.0

### Patch Changes

- @objectstack/plugin-hono-server@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [944f187]
  - @objectstack/runtime@6.0.0
  - @objectstack/plugin-hono-server@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [b806f58]
  - @objectstack/plugin-hono-server@5.2.0

## 5.1.0

### Patch Changes

- @objectstack/plugin-hono-server@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
  - @objectstack/runtime@5.0.0
  - @objectstack/plugin-hono-server@5.0.0

## 4.2.0

### Patch Changes

- @objectstack/plugin-hono-server@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/plugin-hono-server@4.1.1

## 4.1.0

### Patch Changes

- @objectstack/plugin-hono-server@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/plugin-hono-server@4.0.5

## 4.0.4

### Patch Changes

- @objectstack/runtime@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/runtime@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
  - @objectstack/runtime@4.0.2

## 4.0.0

### Patch Changes

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

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/runtime@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/runtime@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/runtime@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/runtime@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/runtime@3.2.8

## 3.2.8

### Patch Changes

- fix: unified catch-all dispatch pattern — `createHonoApp()` now delegates all non-framework-specific routes to `HttpDispatcher.dispatch()`, automatically supporting packages, analytics, automation, i18n, ui, openapi, custom endpoints, and any future routes
- fix: resolves 404 errors for `/api/v1/meta` and `/api/v1/packages` after Vercel deployment
- Only auth (service check), storage (formData), GraphQL (raw result), and discovery (response wrapper) remain as explicit routes
- Added comprehensive tests for the catch-all dispatch pattern

## 3.2.7

### Patch Changes

- @objectstack/runtime@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/runtime@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/runtime@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/runtime@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/runtime@3.2.3

## 3.2.2

### Patch Changes

- @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/runtime@3.0.3

## 3.0.2

### Patch Changes

- @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@3.0.0

## 2.0.7

### Patch Changes

- @objectstack/runtime@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.6

## 2.0.5

### Patch Changes

- @objectstack/runtime@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.3

## 2.0.2

### Patch Changes

- @objectstack/runtime@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/runtime@2.0.1

## 2.0.0

### Patch Changes

- @objectstack/runtime@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/runtime@1.0.11

## 1.0.10

### Patch Changes

- @objectstack/runtime@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/runtime@1.0.9

## 1.0.8

### Patch Changes

- 8f2a3a2: fix: standardize discovery endpoint response to include 'data' wrapper
  - @objectstack/runtime@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7

## 1.0.6

### Patch Changes

- @objectstack/runtime@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/runtime@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/runtime@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
  - @objectstack/runtime@1.0.3

## 1.0.2

### Patch Changes

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/runtime@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.0
