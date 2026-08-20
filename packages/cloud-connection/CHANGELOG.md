# @objectstack/cloud-connection

## 17.1.0

### Minor Changes

- e0695b5: fix(cloud-connection): the four mutating `install-local` routes require the `manage_metadata` capability, and the `x-user-id` header fallback is gone (#8976)
  
  <!-- adr-0087: not-required (no-migration-prescription) Four route handlers gain
  a capability gate, one identity resolver is replaced by the shared one, plus one
  new test file and a shared test fixture. No authorable property is added,
  renamed, retired or tombstoned, so there is no conversion to register. The
  behavioural change is that four package-install doors stop accepting callers who
  hold no authoring capability, and stop accepting a bare identity header. -->
  
  **BREAKING for any integration that installs, uninstalls, reseeds or purges a
  local marketplace package with a principal holding no authoring capability — and
  for anything that identified itself to these routes with an `x-user-id` header.**
  Landing after the v17.0.0 cut, so it ships as `minor` under the lockstep
  launch-window convention.
  
  `MarketplaceInstallLocalPlugin`'s `requireAuthenticatedUser` asked one question —
  "is there a session?" — and it was the only check on all four mutating routes:
  
  - `POST /api/v1/marketplace/install-local` — accepts an **inline manifest**,
    hot-registers its objects into the shared registry, runs `syncSchemas()`
    against the shared database, writes the install ledger and runs seed data;
  - `DELETE /api/v1/marketplace/install-local/:manifestId`;
  - `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data`;
  - `POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data`.
  
  It also ended in a fallback that trusted a bare **`x-user-id` request header**,
  commented as being "for cases where auth is disabled (e.g. test stubs)".
  
  **Measured through the composed plugin, to the point the state actually changes**
  — `manifest.register()`, `objectql.syncSchemas()`, the ledger file on disk,
  `SeedLoaderService.load()`, `driver.delete()`. All three principal shapes were
  indistinguishable, and every effect fired for every one of them:
  
  | principal | install | reseed | purge | uninstall |
  |:--|:--|:--|:--|:--|
  | bare `x-user-id` header, **no session** | **200** | **200** | **200** | **200** |
  | authenticated, **no** `manage_metadata` | **200** | **200** | **200** | **200** |
  | authenticated, `manage_metadata` | 200 | 200 | 200 | 200 |
  
  Nothing downstream refused any of it. The first row is the sharper half: with no
  session store consulted first, a caller who could reach the port completed a
  full schema-mutating install and had `installedBy` recorded as a string of their
  own choosing.
  
  **Severity by deployment shape.** Metadata is environment-scoped rather than
  org-scoped, so Layer 0's tenant wall does not reach these writes: on the walled
  multi-org EE shape this is a cross-tenant write channel — any signed-up user of
  any customer organization could mutate the schema every other tenant runs on,
  and `organization_admin` deliberately withholds `manage_metadata` precisely
  because a tenant administrator is not supposed to. It also nullified the
  already-implemented cloud-side ruling that AI `build` be structurally closed on
  that shape: closing the build agent while this route stayed open closed the
  front door and left the loading dock unlocked. On a single-org self-host the
  severity is genuinely lower — every user is one tenant's — but "any employee
  with a login can alter the schema and run seed data" still contradicts the
  operator-action framing, and the header fallback admitted callers with no login
  at all. The measurements above are code-path measurements through a composed
  host, not an exploit demonstrated against a running deployment.
  
  **The fix.** All four routes now resolve identity **and** capability through
  `resolveAuthzContext` — the platform's single authorization resolver
  (`@objectstack/core`) — and demand ADR-0066 D1's `manage_metadata`, the same key
  the `/meta` write doors carry (#6603, and #8919 for the promotion verbs). A
  caller with no resolvable principal gets `401 UNAUTHENTICATED`; an authenticated
  caller without the capability gets `403 FORBIDDEN` naming the capability they
  need. The refusal is issued before any work, so a refused caller cannot probe
  what is installed through a downstream error. Service and operator tokens are
  exempt exactly as elsewhere, with no special case: an API key resolves through
  the same resolver to its owner's real grants.
  
  **The `x-user-id` fallback is removed, not mode-gated.** It carried no mode flag
  to gate it to, and it was the last `x-user-id` trust left in `packages/**`
  source — the two sibling raw-route surfaces that carried the identical line had
  it *removed* in favour of this same resolver rather than restricted
  (`plugin-sharing`'s share-link routes, `service-settings`' settings routes). The
  one first-party caller of these routes, `os package install`, signs in for a
  real better-auth session cookie and never sent the header.
  
  The plugin's mount stays **unconditional** (cloud#1287 moved it out of the
  `marketplaceUrl` ternary so air-gapped boxes stop 404ing). This is authorization
  on the routes, not un-mounting the plugin.
  
  **Anti-drift.** `marketplace-install-local-capability-enumeration.test.ts`
  derives the mutating routes from the plugin's own route table and compares them
  against a declared list, so a new mutating install-local route fails the build
  until it is enumerated and its refusal cases run. Each refusal asserts the
  ADR-0112 envelope (`code` **and** `status`) *and* that no registry, schema,
  ledger, seed or delete effect fired — a gate that answers 403 after
  `syncSchemas()` has run is still the bug.
  
  Two existing suites whose names read as authorization coverage —
  `marketplace-install-local-posture-gate.test.ts` (the ADR-0120 D5e ceremony,
  which the caller satisfies from their own request body) and
  `marketplace-install-local-tenancy-posture.test.ts` (which selects a seeding
  path) — now open with an explicit statement of what they do **not** cover and
  name the file that does, backed by an assertion that the named file exists so
  the correction cannot rot into a wrong answer. Neither test was weakened.
- 01074e5: fix(cloud-connection): the `install-local` listing requires an authenticated principal, and narrows `installedBy` / `storageDir` to `manage_metadata` holders (#9011)
  
  <!-- adr-0087: not-required (no-migration-prescription) One route handler gains an
  authorization gate and a caller-dependent response projection, one 401 envelope is
  extracted into a shared seam, plus one new test file. No authorable property is added,
  renamed, retired or tombstoned, so there is no conversion to register. The behavioural
  change is that one package-inventory read stops answering anonymous callers, and stops
  serving two operator-grade fields to callers who hold no authoring capability. -->
  
  **BREAKING for any consumer that reads this route anonymously — it now answers `401`
  — and for any authenticated non-operator consumer that reads `installedBy` or
  `storageDir` from it.** Landing after the v17.0.0 cut, so it ships as `minor` under the
  lockstep launch-window convention.
  
  `GET /api/v1/marketplace/install-local` — the console's Setup → "Installed Apps" list —
  called **no** identity resolution whatsoever. `handleList`'s first statement read the
  ledger. After #8976 capability-gated the four mutating doors on this surface, this was
  the only anonymous door left on it: not a weaker gate, the absence of one, so any caller
  who could reach the port received `200` and the complete payload.
  
  **What was disclosed.** Per ledger entry: `packageId`, `versionId`, `manifestId`,
  `version`, `installedAt`, `installedBy`, `withSampleData`; once per response: `items`,
  `total`, `storageDir`.
  
  - `installedBy` is a **platform user id**, and the listing enumerates them across every
    install.
  - `storageDir` is an **absolute filesystem path on the host** (#6721 put it on the wire
    deliberately, for a *signed-in* CLI operator who cannot see the remote host's disk).
  - The inventory itself is a version-level software bill of materials for the deployment
    — which packages, at which versions, installed when.
  
  On the walled multi-org EE shape the inventory and the installer identities are
  cross-tenant information, for the same reason #8976's write channel was: metadata is
  environment-scoped, not org-scoped, so Layer 0's tenant wall does not scope this read
  either. Severity is nonetheless lower than #8976's: this is read-only disclosure, not a
  write channel. The measurement is a code-path measurement through a composed host, not
  an exploit demonstrated against a running deployment.
  
  **The fix — authenticated floor plus field narrowing** (maintainer ruling 2026-08-16):
  
  | caller | status | `items` / `total` | `installedBy` | `storageDir` |
  |:--|:--|:--|:--|:--|
  | anonymous | **401 `UNAUTHENTICATED`** | — | — | — |
  | authenticated, **no** `manage_metadata` | 200 | served | **omitted** | **omitted** |
  | authenticated, `manage_metadata` | 200 | served | served | served |
  
  Splitting the payload rather than gating it whole is the point: "which packages are
  installed here" and "who installed them and where they live on this host" are genuinely
  different sensitivities. Demanding `manage_metadata` for the whole read would have
  withdrawn a console page that ships to non-operator users today, and an authenticated
  floor alone would have left the user ids and the host path on the wire for every signed-in
  account.
  
  The two narrowed keys are **omitted, not nulled** — `null` would be a claim about the
  ledger ("installed by nobody") instead of a fact about the caller. The console already
  renders the "installed by" line conditionally and never reads `storageDir`, so a narrowed
  caller sees the same list minus that one line.
  
  Identity is resolved by the **same** `resolveInstallPrincipal` the four mutating doors use
  — `resolveAuthzContext`, the platform's single authorization resolver — not a second
  session read; two auth mechanisms in one file is how the next gap gets created, and this
  file has already produced one. The 401 envelope is extracted into one
  `refuseUnauthenticated` seam shared by all five routes, so a client branching on
  `UNAUTHENTICATED` never has to learn which door it knocked on. The read door inherits
  #8976's removal of the `x-user-id` fallback: a bare header is still anonymous.
  
  **No new capability is minted** (#8919 discipline) — the narrowing reuses
  `manage_metadata`, matching the `/meta` precedent. The plugin's mount stays
  **unconditional** (cloud#1287 moved it out of the `marketplaceUrl` ternary so air-gapped
  boxes stop 404ing); the answer to an unauthorized read is a refusal, never an absent
  route, and the enumeration suite still asserts the GET is mounted.
  
  **Pinned.** `marketplace-install-local-list-posture.test.ts` pins all three rows above and
  states, in its own docblock, that it is the file which answers "is the listing gated?" —
  the sibling `capability-enumeration` suite answers that only for the mutating doors and
  deliberately filters the GET out. The non-operator row is pinned in **both** directions
  (the inventory is present *and* the two fields are absent), because asserting only the
  absences would keep passing if that caller were refused outright — the option the ruling
  rejected. The refusal asserts the ADR-0112 envelope (`code` **and** `status`) and that it
  is issued **before** the ledger is read, so a refused caller cannot probe what is installed
  through timing or a storage error.
- 990a893: fix(runtime-config): `OS_PRODUCT_STAGE` / `branding.stage` actually reaches `/api/v1/runtime/config`, so the documented preview-badge switch stops being a no-op (#9252)
  
  <!-- adr-0087: not-required (no-migration-prescription) One constructor option
  and one optional response key are ADDED; nothing authorable is renamed, retired
  or tombstoned, and no stored `sys_metadata` shape changes. There is no
  conversion to register. -->
  
  Running `examples/app-showcase` with `OS_PRODUCT_STAGE=ga objectstack dev` left
  the Console's "Preview" chip on screen. `RuntimeConfigPlugin` never emitted
  `branding.stage`, so objectui's `PreviewBadge` — which reads exactly that key —
  never saw the value, and the switch objectui's app-shell README presents as the
  operational way to hide the badge did nothing at all.
  
  **Nobody implemented it, in either distribution.** The card guessed the knob was
  "honored only by the cloud distribution"; measured with a control first, so the
  zeros are a reading rather than a broken search:
  
  | probe | result |
  |---|---|
  | `OS_PRODUCT_STAGE`, framework repo-wide | 0 hits |
  | `OS_PRODUCT_STAGE` / `branding.stage` / `PlatformStage`, cloud repo-wide | 0 hits |
  | control: `OS_PRODUCT_NAME`, cloud repo | 9 hits |
  | control: files mentioning `branding`, cloud repo | 18 files |
  
  So this is the declared-but-unenforced trap in its purest form: a documented
  operator knob with no producer anywhere. Emitting the key restores an
  already-declared contract rather than widening a surface — no request that is
  accepted today becomes rejected, or vice versa.
  
  **Resolved in the plugin, not threaded through the CLI.** Both halves of the
  documented interface name this plugin (`OS_PRODUCT_STAGE` **or**
  `new RuntimeConfigPlugin({ stage })`), every sibling branding key already
  resolves `config.X ?? OS_X` in the same constructor, and — decisively — the
  card's own repro constructs its **own** `RuntimeConfigPlugin` in
  `examples/app-showcase/objectstack.config.ts`, which wins over the CLI's by
  plugin name. A value threaded through `Serve.RUNTIME_CONFIG_OPTIONS` would have
  left the reported repro still broken. The cloud distribution inherits the fix
  for free: its `RuntimeConfigPlugin` extends this one and spreads its config into
  `super()`, so there is one mechanism answering this question, not two.
  
  **The value space is closed** — `'preview' | 'beta' | 'ga'`, mirroring the
  `PlatformStage` union the Console branches on (exported as `PlatformStage`). An
  unrecognised value is refused and named in a mount-time `warn` listing the
  accepted spellings, never forwarded: the SPA discards off-contract values
  anyway, so a passthrough would recreate this bug's exact shape — an operator
  sets the knob, nothing happens, nothing is said.
  
  **Unset stays absent.** No `stage` key at all, rather than an empty string or a
  default invented server-side, so the Console keeps applying its own documented
  `'preview'` default and nothing that works today changes. The regression proof
  asserts that direction on **key presence** (`hasOwnProperty`), not
  `toBeUndefined()` — `{ stage: undefined }` satisfies the latter while being a
  present property that survives `structuredClone` and shows up in `Object.keys`.

### Patch Changes

- 2277443: fix(cloud-connection,service-automation): stop two plugin classes renaming themselves in the shipped build, and enforce the class-name identity limb against `Ctor.name` (#8645)
  
  `Serve.providesCapability` (`packages/cli/src/commands/serve.ts`) decides whether a
  host already supplied a capability's provider by comparing, by equality, both a
  loaded plugin's `name` and its `constructor.name` against a declared identity
  list. Every identity registry in that file therefore declares two spellings per
  provider — the registered `plugin.name` id and the exported class name — and the
  class-name spelling is a claim about the **built** artifact.
  
  **Measured against the built packages, two of the 27 declared class-name
  identities matched nothing at all:**
  
  ```
  MISMATCH CAPABILITY_PROVIDERS.automation   declared=AutomationServicePlugin  runtime=_AutomationServicePlugin
  MISMATCH Serve.MARKETPLACE_PROXY_IDENTITIES declared=MarketplaceProxyPlugin  runtime=_MarketplaceProxyPlugin
  ```
  
  Both classes referenced themselves **by name inside their own body** —
  `MarketplaceProxyPlugin.prototype.version` building the outbound proxy
  User-Agent, and a `private static` backoff helper called from an instance method
  in the automation plugin. esbuild rewrites such a class into
  `var X = class _X { … _X … }` so the inner reference binds to the class binding
  rather than the outer `var`, and the emitted class reports `_X` as its `.name`.
  
  There was no user-visible impact, because every guard naming these plugins also
  declares the registered id, which the instance carries as a plain field no
  bundler touches. What was dead is the **redundancy**: a guard running on one
  limb it does not know it is running on is one rename away from failing open —
  and failing open here means silently mounting a second instance over a host's
  own.
  
  Both source idioms are replaced with module-scope declarations, so the shipped
  classes keep their names. The marketplace proxy's self-reference was also
  reading a field that was never there (`version` is an instance field, so
  `prototype.version` was always `undefined`): its outbound `User-Agent` announced
  the `?? '1.0.0'` fallback on every request and now announces the plugin's real
  version, `1.1.0`.
  
  The enforcement half lives in `packages/cli/test/serve-capability-identity.test.ts`:
  every declared class-name identity, across `CAPABILITY_PROVIDERS` and the four
  marketplace identity lists, is now compared to the runtime `Ctor.name` of the
  export it names, and must satisfy `providesCapability` through the class-name
  limb alone. The `*_IDENTITIES` statics are re-derived from `Serve` itself, so a
  fifth list cannot be added without being enumerated. #8357's local
  "modulo one leading underscore" accommodation is retired rather than left as a
  third spelling of the same rule.
- 7c3a7eb: Marketplace install-local now registers the per-organization seed replayer alongside its dataset merge, so organizations founded after an install are no longer empty.
  
  Installing a package merged its `data` blocks onto the kernel's shared `seed-datasets` service but never registered the `seed-replayer` service that consumes them. That replayer is registered in `AppPlugin`'s seeder path, so a host runtime declaring no seed data of its own — `objects: []`, no `data`, which is exactly the shape a marketplace install targets — ended up with datasets present and no replayer. On a walled (`isolated` / `group`) deployment the org-scoping middleware then found the datasets, found no replayer, and did nothing: every organization founded after the install received zero rows of the installed app, while the installer's own organization looked correct because it had been seeded inline at install time.
  
  `applySideEffects` now calls the runtime's `registerSeedReplayerOnce` next to the merge, on both the install and the rehydrate path. Registration is register-once by construction, so a host that already has a replayer keeps it and is unaffected; the incumbent re-reads the same shared list and replays the newly installed datasets too.
- d2e6b1d: Cloud-connection refusals now emit the response envelope they declare.
  
  Eleven error exits on `/api/v1/cloud-connection/*` answered with
  `error: { code }` and no `message`. `ApiErrorSchema.message` is REQUIRED, so
  `body.error.message` read `undefined` on the wire for every one of them — the
  Console had already grown the accommodation that produces, displaying
  `body?.error?.message ?? body?.error?.code` and so showing a machine code to a
  human. All eleven now carry a readable message; no status and no code changed.
  
  `POST /api/v1/cloud-connection/bind/poll` additionally stamped the UPSTREAM
  RFC 8628 spelling (`expired_token`, `access_denied`, …) straight into
  `error.code`, which is a closed ADR-0112 vocabulary — so that body failed its
  own contract. The wire change, for anyone branching on it:
  
      before:  { success: false, data: { pending: false },
                 error: { code: "expired_token" } }
      after:   { success: false, data: { pending: false },
                 error: { code: "DEVICE_CODE_FAILED",
                          declaredCode: "expired_token",
                          message: "Device authorization failed: expired_token" } }
  
  Nothing is lost: the verbatim upstream spelling now rides `declaredCode`, the
  open producer-authored channel ADR-0112 declares for a code the serving side's
  ledger does not know. Read `error.declaredCode` where you previously read
  `error.code` for the RFC 8628 value; `error.code` is now the registered member,
  which is what a consumer branching on platform conditions should key on.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [ca2e020]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [e374b4d]
- Updated dependencies [a433122]
- Updated dependencies [bc6434b]
- Updated dependencies [96f397a]
- Updated dependencies [9aa8890]
- Updated dependencies [48032c9]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [6a51704]
- Updated dependencies [2d0af57]
- Updated dependencies [c766ec3]
- Updated dependencies [420804d]
- Updated dependencies [c8e85fc]
- Updated dependencies [3d61924]
- Updated dependencies [5244fd7]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [b2789ad]
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
- Updated dependencies [6aceca9]
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
- Updated dependencies [20067c5]
- Updated dependencies [e783e16]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [4fc4a3c]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [17854cb]
- Updated dependencies [3851f87]
- Updated dependencies [09b880b]
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
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [c86799f]
- Updated dependencies [5989b0d]
- Updated dependencies [19db5fa]
- Updated dependencies [2b9d33a]
- Updated dependencies [ad217b1]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/runtime@17.1.0
  - @objectstack/core@17.1.0

## 17.0.0

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

- 28ad90e: feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

  ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
  D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
  与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
  姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

  **D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
  边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
  读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
  对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
  维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
  装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
  确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
  留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
  谁确认的、何时、在哪个姿态下问的),**之后不复问**。

  - 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
    元数据可以直接重试,不需要先卸载。
  - 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
    其中一条仍会在剩下的那条上停住。
  - 升级引入的**新**约束会被问,老的答案继续算数。
  - 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
    问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
  - ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
    的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
    `os migrate plan` 的 advisory 形态覆盖。

  判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
  就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
  `true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
  (S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

  CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
  逐条清单而不是一句 "Install failed (409)"。

  **D5c —— 遗留手写组织复合索引的 advisory。** 新规则
  `unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
  (`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
  per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
  SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
  在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
  driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
  **永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
  真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

  **D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
  §Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
  `content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
  §Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
  退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
  `content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
  条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
  `gen:schema && gen:docs` 再生成,未手改。

  按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
  显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
  说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
  顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
  `examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
  唯一约束**,故无可扫;这是核查结论,不是遗漏。

  **三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
  `single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
  (S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
  **逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
  断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
  外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
  drift op 为零。

  对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
  `unique: true` 一如既往合法。

- 7737bc8: feat(cloud-connection,cli): the install-local POST reports where it cached the manifest, and `os package install` quotes it (#6721)

  The two endpoints of `MarketplaceInstallLocalPlugin` disagreed about one fact.
  `GET /api/v1/marketplace/install-local` — the console's Installed Apps list —
  served `storageDir: this.storageDir`, the ledger directory as resolved by
  `LocalManifestSource` (`config.storageDir` when the host set one, the
  `.objectstack/installed-packages` default when it did not). The `POST` that
  performs the install did not, so its `data` block described everything about
  the install except **where the install went**.

  That gap was load-bearing for the one consumer of that response. `os package
install` runs on a different machine from the runtime it installs into: it
  speaks HTTP and never touches the target's disk. With no directory in the
  response it could only describe the cache location by literal, and the literal
  it printed was the plugin's _default_ — wrong for every host that configures
  `storageDir`, and wrong today rather than eventually. No consumer-side fix
  existed: a locally-resolved constant names the wrong machine, and importing it
  from `@objectstack/cloud-connection` would make a pure-HTTP command fail at
  module load wherever that package is absent. The producer is the contract, so
  the fix is there.

  **`@objectstack/cloud-connection` (additive, no migration).** The install POST
  response's `data` now carries `storageDir`, read from the same
  `this.storageDir` field the GET listing already returns — one field, two
  endpoints, so they cannot drift apart again. No existing key changed, and
  nothing needs to read the new one.

  **`@objectstack/cli`.** The post-install hint now quotes the directory the
  runtime reported:

  ```
    The manifest is cached on the runtime host and re-registers on every
    boot (survives restarts):
      /srv/objectstack/state/ledger-packages
  ```

  Against a runtime older than this release — one whose response has no
  `storageDir` — the CLI prints **no** directory sentence at all. It does not
  fall back to the old literal: a consumer stating a value the producer declined
  to state is the defect Prime Directive #12 forbids, and saying less is correct
  where guessing is not. Everything else the command prints is unchanged.

- 5a45b9b: `LocalManifestSource.read()` now says WHICH of the two things its `null` meant

  `read()` answered `null` to two different questions at once — "this manifest was
  never installed" and "it was installed, but its ledger file cannot be read" —
  and dropped the reason for the second in an un-bound `catch`. Two admin
  endpoints check `has()` first, so absence was already ruled out by the time they
  called it, and both could only answer
  `500 { code: 'MARKETPLACE_STORAGE_FAILED', message: 'Failed to read manifest cache.' }`:
  a sentence whose only content is that the thing it just did failed, one line
  after `has()` said the file is there. The `Unexpected end of JSON input` /
  `EACCES` / `EISDIR` that names the repair had already been thrown away, and
  nothing was written to the server log either.

  **Breaking (`@objectstack/cloud-connection`):** `read()` returns an
  `InstalledManifestLookup` instead of `InstalledManifestEntry | null`.

  - FROM: `const entry = source.read(id);`
  - TO: `const { entry, failure } = source.read(id);`

  `entry` is the old return value unchanged, so a caller that legitimately treats
  both nulls alike migrates by reading `.entry`. `failure` is a
  `SkippedManifestEntry` — `{ file, cause }`, the same shape `list()` already
  reports, with the thrown object carried unwrapped — and is present ONLY when a
  ledger file exists and could not be read. `failure === undefined` with
  `entry === null` therefore means "not installed", which is the distinction the
  merged `null` erased. One new exported type, `InstalledManifestLookup`.

  `read()` still does not validate the parsed value's SHAPE, and enumerating the
  ledger directory still throws out of `list()` — both unchanged.

  Consumer-visible behaviour:

  - `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` and
    `…/purge-sample-data` keep returning `500 MARKETPLACE_STORAGE_FAILED` — the
    same failure, so a client branching on the code is unaffected — but the
    message now names the ledger file to repair or remove and quotes the cause
    verbatim, and a matching `warn` line goes to the server log.
  - The install path's ADR-0120 D5e posture gate is unchanged on purpose: a
    corrupt entry still counts as "no attestation on record", so the one-time
    installation-wide-unique ceremony is asked again rather than skipped.

- 7127b48: `LocalManifestSource.list()` now reports the ledger entries it could NOT read

  A truncated, unreadable or unparseable file under
  `.objectstack/installed-packages/` was skipped in an un-bound per-file `catch`
  and `list()` returned a bare array, so a short list was indistinguishable from a
  complete one — no difference in the return value, no log, no count. Three
  consumers gave a confidently wrong answer: the installed app was never
  registered at boot (gone from the app switcher, its objects nonexistent) with
  nothing in the log, the console's installed-apps list came back short with
  `success: true`, and `os doctor` printed `✓ Unique scope` over manifests it had
  never parsed.

  Skipping a corrupt file stays correct — one bad manifest must not stop a runtime
  booting the packages that are fine. Skipping it _silently_ was the defect.

  **Breaking (`@objectstack/cloud-connection`):** `LocalManifestSource.list()`
  returns `{ entries, skipped }` instead of `InstalledManifestEntry[]`.

  - FROM: `const entries = source.list();`
  - TO: `const { entries, skipped } = source.list();`

  `skipped` is `Array< { file: string; cause: unknown } >` — the file's basename
  and the object reading or parsing it threw, unwrapped. Callers that only want
  the old behaviour read `.entries`; the point of the shape is that dropping
  `skipped` is now something a caller has to do on purpose. Two new exported
  types, `InstalledManifestListing` and `SkippedManifestEntry`.

  Enumerating the ledger DIRECTORY still throws out of `list()` — unchanged, and a
  different fact from "some files in it would not parse".

  `os doctor` reports unparseable entries as a `Unique scope` warning row naming
  each file with its cause, and withholds the `✓` success line, alongside the
  directory-level row it already had.

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

- f985b3f: fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

  **`packages/core/src/contracts/` was a dead near-copy of the real contracts,
  and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
  ZERO importers — no relative import, no subpath export, not a tsup entry;
  core's barrel has re-exported the `@objectstack/spec/contracts` versions all
  along ("Re-export contracts from @objectstack/spec for backward
  compatibility"). But the shadow had already **diverged** from the live
  contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
  `rawBody?`; the copy never did), so anyone who grepped their way into it read a
  stale contract that nothing enforces — the exact both-humans-and-AI failure
  mode behind the false `http.server` exemption (#4382). Deleting it is
  zero-risk by construction: nothing could reach it.

  **`http.server` is the canonical slot name, and the ledger now says so.**
  `ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
  `'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
  register both two lines apart; cloud's two server entrypoints do the same).
  Canonical is the only name present on EVERY provider path: runtime's
  `config.server` path registers no alias, so the three cloud-connection plugins
  that read the alias alone (marketplace-proxy, runtime-config,
  marketplace-install-local) found an empty slot there — a live miss, now fixed:
  all readers go canonical-first with the alias as a fallback that dies with the
  alias registrations. The registrations themselves are untouched this release;
  both sites now carry the deprecation note.

  **`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
  escape, declared once. Four consumers were each declaring it locally
  (cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
  those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
  return is deliberate and documented at the single declaration: the handle's
  real type belongs to the framework, and naming it would give the contract a
  framework dependency. Adapters are not required to expose it; consumers
  feature-detect.

  **`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
  their implementation has always accepted.** `bulkRegister`'s contract options
  dropped the `MetadataWriteOptions` half its implementation intersects in
  (`notify` is destructured on the method's first line); `bulkUnregister`
  declared no options at all while the manager takes them. Same shape as the
  `IDataEngine` read-methods gap from B2: a caller typed to the contract could
  not reach the channel without erasing the lookup. Both additive; no implementor
  or caller breaks.

  Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
  typed while touched).

- 402f534: fix(objectql): bridge late-registered manifest objects into the metadata service

  Marketplace-installed template packages register through the `manifest`
  service on `kernel:ready` (install) or later (HTTP install), but the one-shot
  SchemaRegistry→metadata bridge runs once during `ObjectQLPlugin.start()` —
  so their objects only ever reached the ObjectQL registry. Every
  IMetadataService consumer (AI `describe_object`, Studio object lists,
  `metadata.listObjects`) missed them; only the seed loader had grown an
  engine-side fallback (#3422).

  The manifest service's `register` now bridges the manifest's own objects into
  the metadata service after registering them with the engine, resolving the
  service at call time and mirroring the startup bridge's contract:
  `register('object', name, obj, { notify: false })` (#3112), skip entries it
  did not bridge itself, refresh its own copy on same-package re-install (hot
  upgrade). Armed only after `start()` has run the one-shot bridge, and never
  on project kernels — boot-time behavior is unchanged. `register` now returns
  a promise; the marketplace install/rehydrate paths await it so metadata reads
  right after an install are deterministic.

- 1c8bf4f: fix(marketplace): heal missing sample data when rehydrating installed packages onto a new database

  The install ledger (`.objectstack/installed-packages/`) is anchored to the
  project directory while the database can be swapped out from under it —
  `os dev --fresh`, a deleted `dev.db`, a `--database` switch. Rehydrate
  deliberately never re-seeds (existing rows must not be re-upserted over user
  edits on every boot), which left a rehydrated marketplace package PERMANENTLY
  empty on a new database: app in the switcher, tables created, zero rows — the
  "HotCRM installed but every KPI is 0 / Sales Pipeline all-empty" state.

  Rehydrate now runs the bundled seed datasets iff the manifest actually bundles
  them, the user never explicitly purged them, the runtime is single-tenant
  (multi-tenant seeding stays owned by the per-org replay), and EVERY seeded
  object is empty — one surviving row anywhere means the data is still there and
  nothing is touched, so the heal is idempotent across restarts and can never
  revert user edits.

  Also fixed along the way: a purge now stamps `sampleDataPurged` on the ledger
  entry (so healed restarts respect the deliberate empty baseline), and install
  marks `withSampleData: true` when the seed run reports all rows _skipped_
  (already present, e.g. a reinstall over live demo data) instead of leaving the
  flag false over a seeded database.

- ac1cc8c: fix(cloud-connection): align the marketplace seed test's timeout with its sibling (#3785)

  `marketplace-install-local-state-machine-exempt.test.ts` failed under a
  full-repo `pnpm test` at 30s, while passing every time the package ran alone.

  Both marketplace seed tests drive `MarketplaceInstallLocalPlugin`, whose
  seeding path dynamically imports the real `@objectstack/runtime` (unmocked on
  purpose, twice: `recordSeedSummary` and `mergeSeedDatasetsIntoKernel`). That
  cold import costs seconds by itself and multiples of that under a fully
  parallel turbo run, and it is charged to whichever test triggers it first.

  Its sibling `marketplace-install-local-seed-lookup.test.ts` was diagnosed as
  exactly this — _"an import stall, not a hang"_ — and raised to 120s. This file
  was left at 30s and kept flaking the same way. The budget is now aligned, with
  the rationale stated locally rather than only in the sibling.

  The flaky set turns out to be exactly the intersection of "does not mock
  `@objectstack/runtime`" and "actually drives seeding":

  | test                   | mocks runtime | drives seeding                    | budget             |
  | :--------------------- | :------------ | :-------------------------------- | :----------------- |
  | `conflict`, `bundle`   | no            | **no** — never reaches the import | default            |
  | `reseed`, `heal`       | **yes**       | yes                               | default            |
  | `seed-lookup`          | no            | yes                               | 120s (already)     |
  | `state-machine-exempt` | no            | yes                               | 120s (this change) |

  So the two tests #3785 recorded are the only two that can hit this, and no
  other file needs the same treatment. A genuine hang still fails — later.

- 2ddba89: fix(tenancy): eight sites answered "is this deployment multi-org?" with the demoted `OS_MULTI_ORG_ENABLED` (#5262)

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the authoritative knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — therefore reads `false` from
  `resolveMultiOrgEnabled()` while running a fully mounted organization wall.
  #5233 corrected two sites in `plugin-auth`; a census found eight more, all
  written before that function's doc comment was corrected. Third recurrence of
  the shape (cloud#1020, #5233).

  Each site was judged separately for **which** posture answers its question —
  what the operator REQUESTED, or what the `tenancy` service reports is actually
  IN FORCE — rather than converted mechanically:

  - `objectql` `SchemaRegistry` — the env-derived multi-tenant default. Reads the
    REQUESTED posture (it is constructed below the kernel, with no service
    registry to ask). The `organization_id` column was always provisioned; what
    diverged is its INDEX, so a posture-only deployment ran the Layer 0 wall's
    hottest predicate unindexed while SecurityPlugin compiled that same wall.
  - `plugin-dev` — whether to load the enterprise `@objectstack/organizations`.
    REQUESTED posture, mirroring `serve.ts`: this branch is what mounts the wall,
    so asking whether the wall is up would be circular. A posture-only dev stack
    previously never loaded the package at all and served traffic unwalled. Its
    diagnostic now names the posture that was requested instead of asserting
    `OS_MULTI_ORG_ENABLED=true` at an operator who never set it.
  - `runtime` `AppPlugin` (inline seed + hot-reload seeder) — EFFECTIVE posture,
    via the `tenancy` service. These ask "will the per-org replay run instead of
    me?", and on an ADR-0093 D5 degraded boot that replay does not exist, so
    keying on the request would defer to a replay that can never happen. Walled
    deployments previously inline-seeded exactly the NULL-organization rows the
    code's own comment exists to avoid.
  - `cloud-connection` marketplace local install (install-time seed + rehydrate
    heal) — EFFECTIVE posture, same reasoning. The install path is a write path:
    a walled deployment wrote every sample row with no `organization_id`, landing
    the app's data outside the wall its own reads apply.
  - `driver-sql` `isMultiTenantMode()` — REQUESTED posture (a driver has no
    kernel to ask, and a suppressed warning is the costlier error for a
    diagnostic). It also no longer memoises into `_multiTenantMode`: that froze a
    process-level fact into a per-instance verdict on whichever write landed
    first. The gate now resolves live, which is affordable because
    `auditMissingTenant` consults it only after the `tenantId` early-out.
  - `cli` `os verify` — REQUESTED posture. This one produced a green verification
    run over an unverified property: a posture-only deployment silently skipped
    every multi-tenant proof and exited 0.

  **No configuration change is needed anywhere.** Deployments setting only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  belt-and-braces configuration stays valid. Deployments that set only
  `OS_TENANCY_POSTURE` can now drop the redundant boolean. Single-org behaviour is
  unchanged at every site; only the knob each one reads is corrected.

- 4018fc1: fix(cloud-connection): `features.installLocal` is derived from what is mounted; the constructor option becomes a ceiling (#8388)

  `GET /api/v1/runtime/config` reported `installLocal` straight from the
  constructor option, next to a `marketplace` key that #8356 had just made an
  observation. Two flags in one object, answered by different rules — and the
  declared one is the key #8343 actually measured wrong on a real self-hosted
  deployment:

  ```json
  {"features":{"installLocal":true,"marketplace":true, …}}
  ```

  ```
  GET  /api/v1/marketplace/install-local -> 404 {"error":"Not found"}
  POST /api/v1/marketplace/install-local -> 404 {"error":"Not found"}
  ```

  Nothing checked that `MarketplaceInstallLocalPlugin` was mounted on the kernel
  serving the response, so `new RuntimeConfigPlugin({ installLocal: true })` on a
  runtime that never mounted it announced a capability whose route 404s, and the
  Console rendered an install affordance that could not work.

  The flag is now **observed** per request, off the route table of the app serving
  the response — the same seam #8356 built, read by a sibling predicate rather than
  a shared one, because the browse predicate subtracts exactly the paths this one
  requires. The two share the prefix constant, so "what counts as install-local"
  has one definition and the flags cannot both claim, or both disown, the same
  route.

  **The `installLocal` constructor option is kept, as a ceiling.** Hosts pass it
  today, so it is not removed:

  - omitted or `true` — report what is actually mounted (what every host passing
    `installLocal: true` already meant);
  - `false` — report `false` even where the plugin is mounted, for an operator who
    wants the affordance hidden.

  It deliberately cannot raise the answer. A plain override would have left the
  measured defect standing: the CLI's own frozen `RUNTIME_CONFIG_OPTIONS` passes
  `installLocal: true` unconditionally, so honouring `true` upward would keep
  "declared `true`, route 404s" reachable on exactly the product path #8343
  reported, leaving the derivation inert where it is most needed.

  **What changes for hosts.** A runtime that mounts an install-local surface
  reports exactly what it did before. A runtime that mounts none now reports
  `installLocal: false` instead of whatever it declared — the correction. An
  omitted option no longer means `false`: it defers to the observation, so a host
  that mounts the plugin and forgot the flag now gets the truthful `true` it should
  always have had.

  **Escape hatch, unchanged.** The derivation is the base value, not a veto: the
  open-core `resolveFeatures` seam still merges over it (and over the ceiling), so a
  host on an adapter whose raw app exposes no route ledger — where both derived
  flags conservatively report `false`, with a warning logged once at mount time —
  can still declare the capability it knows it serves.

- 631ddbf: fix(cloud-connection): `features.marketplace` is derived from what is mounted, not hardcoded `true` (#8356)

  `GET /api/v1/runtime/config` built its response with `marketplace: true` as a
  literal, so **every** runtime that mounted `RuntimeConfigPlugin` told the Console
  the package catalog was browsable — including runtimes where
  `MarketplaceProxyPlugin` was never mounted because no control plane resolved. The
  SPA rendered a browse affordance the runtime could not serve. That is the same
  declared-is-not-enforced shape as #8343, one key over.

  It was a live constraint, not a hypothetical: it is why #8343 mounts install-local
  **alone** on a cloud-less runtime and deliberately does not also mount
  `RuntimeConfigPlugin` there. Doing so would have restored the Console's knowledge
  of install-local at the cost of asserting a browse capability that is definitively
  absent — trading the reported bug for its mirror image.

  The flag is now **observed** per request, off the route table of the app serving
  the response: `true` when a marketplace browse surface is mounted on it, `false`
  when none is. `/api/v1/marketplace/install-local` is deliberately excluded — it is
  the offline install half, mounted precisely on the runtimes that have no catalog,
  and counting it as browse would recreate the defect one key over.

  Reading the route table rather than a proxy-specific signal is what makes one
  derivation true for every distribution: `MarketplaceProxyPlugin` registers no
  service (it announces itself only by mounting its routes), the `IHttpServer`
  mount-introspection members exclude framework-native `getRawApp()` mounts by
  construction, and the ObjectStack Cloud control plane serves the catalog
  **natively** with no proxy at all. The route table is the union that covers all
  three.

  **What changes for hosts.** A runtime that mounts a marketplace browse surface
  reports exactly what it did before. A runtime that mounts none now reports
  `marketplace: false` instead of `true` — the correction — and its Console stops
  offering catalog browse it cannot serve. A cloud-less runtime can therefore report
  `installLocal: true` truthfully without also claiming browse. No config knob was
  added: a knob would repeat one layer up the every-host-must-remember failure that
  propagated the original defect into the self-hosted EE image, where both the host
  config and this package's README kept a hand-maintained flag out of step with
  their own mounting.

  **Escape hatch, unchanged.** The derivation is the base value, not a veto: the
  open-core `resolveFeatures` seam still merges over it, so a host on an adapter
  whose raw app exposes no route ledger (where the flag conservatively reports
  `false`, with a warning logged at mount time) can still declare the capability it
  knows it serves.

- 810a3a2: fix(runtime,cloud-connection): multi-tenant seed replay covers every source, not just the first (#3453)

  In multi-tenant deployments (enterprise `@objectstack/organizations`) a brand-new org
  gets its own private copy of demo data by replaying the kernel's `seed-datasets` list
  on the `sys_organization` insert. That list is meant to hold the union of every seed
  source — every config-declared app AND every marketplace package — but two framework
  traps (the same pair #3444 fixed for seed-summary) shrank it to just the first source:

  - The standard `PluginContext` exposes `getService`/`registerService` but has NO
    `.kernel` handle, so `(ctx as any).kernel?.getService('seed-datasets')` always read
    `undefined`. Each source then saw "nothing registered" and overwrote the list with
    only its own datasets instead of extending it.
  - `registerService` throws on a duplicate name, so the second source's re-register was
    swallowed by the surrounding try/catch — its datasets (and, for a config app, its
    replayer) silently lost.

  Net effect: with two config apps, or a config app plus marketplace packages, a new org
  replayed only the first app's seeds.

  The fix mirrors #3444's seed-summary hardening: `seed-datasets` is now a single shared
  array, registered once and mutated in place by every source through a new
  `mergeSeedDatasets` helper that reads via the context's own resolver first. AppPlugin's
  per-org replayer reads that live list at invoke time instead of a captured snapshot, so
  it replays the full union — including datasets merged after its closure was built — and
  the replayer itself is registered once and reused by later config apps.

  Covered by seam-level unit tests (accumulation across app + marketplace sources; the
  replayer reads the live union). True multi-tenant end-to-end coverage requires the
  enterprise `@objectstack/organizations` plugin, which lives in the cloud repo.

- 627b188: fix(seed-loader): count reference fields dropped from rows that were still written

  The loader had two failure outcomes and only counted one. A record it cannot
  write is counted in `errored`. But an unusable **reference value** (an object
  where a natural key belongs, an array on a single-value field) is removed from
  the record — never written as NULL, which would sever an existing link on
  upsert replay — and the row is written **without it**. Nothing counted that.

  So a load that quietly severed N associations reported `totalErrored: 0`, and
  every count-driven surface read clean. The CLI boot banner — the one seed signal
  that survives `os dev`'s boot-quiet window and the default `warn` level — printed
  `showcase 42 rows`, and the warn line said `0 dropped record(s)`: true, and
  useless ([#3932](https://github.com/objectstack-ai/objectstack/issues/3932)).

  `SeedLoadResult.referencesDropped` and `SeedLoaderSummary.totalReferencesDropped`
  now count it. It is deliberately **not** folded into `errored` — the row _was_
  written, so that would break the `inserted + updated + skipped` reconciliation
  against `total`. The banner names it separately:

  ```
  ⚠ Seeds:   showcase 42 ok / 3 lost links ⚠
  ```

  Both counters are additive with a `0` default, so an existing producer or
  consumer of `SeedLoaderResult` is unaffected.

- d60968c: Surface marketplace rehydrate/heal seed outcomes in the `os dev` / `os serve` boot banner (#3430), extending the config-app Seeds line from #3415.

  The seed pipeline's most useful result lines are all `logger.info`, but `os dev` forwards a default `warn` level and the serve boot-quiet window swallows stdout — so "marketplace package rehydrated onto a fresh DB with 0 rows", a fresh-DB self-heal, and row-level seed failures were all invisible unless you queried the database directly.

  The `seed-summary` kernel service is now a per-source list. AppPlugin (config apps) and the marketplace rehydrate/heal path each contribute a labelled entry, and the banner prints one combined line that ignores the log level:

  ```
  Seeds:   showcase 162 rows · hotcrm(marketplace) 157 ok / 5 errors ⚠
  ```

  Fresh-DB heals are marked `(healed on fresh db)`; a marketplace package that installed with seed datasets but landed 0 rows, and any run that dropped records, escalate to a yellow `⚠` line instead of passing silently.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

- Updated dependencies [50616d9]
- Updated dependencies [bc35e00]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [6e141bc]
- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [30536e3]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [48fcf70]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [a4e2684]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [739f496]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [698cbc2]
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
- Updated dependencies [ffb003c]
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
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fa1827]
- Updated dependencies [6fdc5c6]
- Updated dependencies [0e79785]
- Updated dependencies [8b9d71e]
- Updated dependencies [7e7a605]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [6877e9a]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [0f12193]
- Updated dependencies [0bab8bb]
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
- Updated dependencies [3c8cfd1]
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
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [116c0d9]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [c546c89]
- Updated dependencies [57a3bb3]
- Updated dependencies [627e65a]
- Updated dependencies [4c5df00]
- Updated dependencies [b16dcb4]
- Updated dependencies [22df871]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
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
- Updated dependencies [f7d80f4]
- Updated dependencies [fce14ab]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [7309c81]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
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
- Updated dependencies [4ff8abf]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [e38db3d]
- Updated dependencies [a225ef5]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [63b33e6]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [c9d254a]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [c3bcb42]
- Updated dependencies [19e3e6e]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [7bf3d1c]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
- Updated dependencies [20bc357]
- Updated dependencies [0373d52]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [4f30943]
- Updated dependencies [db9c331]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [217b791]
- Updated dependencies [bb192c4]
- Updated dependencies [fd8521f]
- Updated dependencies [35b36f2]
- Updated dependencies [86e6f6c]
- Updated dependencies [cbedd62]
- Updated dependencies [19aaf4b]
- Updated dependencies [0e4a7fb]
- Updated dependencies [98e7cc7]
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
- Updated dependencies [4cf7c61]
- Updated dependencies [f505689]
- Updated dependencies [76682cb]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [18b8eaa]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [8a341a4]
- Updated dependencies [78adc2e]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
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
- Updated dependencies [385c4b0]
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
- Updated dependencies [d9cac60]
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
- Updated dependencies [7674859]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [db59e9c]
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
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
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
- Updated dependencies [af05400]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [fa48973]
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
- Updated dependencies [6146b67]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [99b4392]
- Updated dependencies [591f675]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [8aacf94]
- Updated dependencies [d56012f]
- Updated dependencies [73648ba]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [7180ed5]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [33a5ff4]
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
- Updated dependencies [8fbed3b]
- Updated dependencies [083c414]
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
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [b295e4b]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [91eddca]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [7dbf4c3]
- Updated dependencies [e15e679]
- Updated dependencies [2ddba89]
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
- Updated dependencies [ef7845a]
- Updated dependencies [4cc4fb7]
- Updated dependencies [9b2d720]
- Updated dependencies [95ef5c0]
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
- Updated dependencies [1fa224a]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [8e08bc3]
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
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [5b08389]
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
- Updated dependencies [48d5a1c]
- Updated dependencies [cc3555e]
- Updated dependencies [f8fe47e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [3216344]
- Updated dependencies [f5bfac8]
- Updated dependencies [6163393]
- Updated dependencies [688e9df]
- Updated dependencies [8f124a7]
- Updated dependencies [21ca1d5]
- Updated dependencies [03b11e8]
- Updated dependencies [89d7b35]
- Updated dependencies [0cd08d5]
- Updated dependencies [8891f93]
- Updated dependencies [6155c3c]
- Updated dependencies [d729a31]
- Updated dependencies [b30963d]
- Updated dependencies [cb8322e]
- Updated dependencies [94f7b6a]
- Updated dependencies [1d5dc46]
- Updated dependencies [d13f627]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
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
- Updated dependencies [86d2e5e]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [de6daa5]
- Updated dependencies [378d8b1]
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
- Updated dependencies [6f23667]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [cde1975]
- Updated dependencies [e231abb]
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
- Updated dependencies [2053714]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
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
- Updated dependencies [7309c81]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
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
- Updated dependencies [ecf0bef]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [43fc039]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [bd5fc38]
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
- Updated dependencies [89be40c]
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
  - @objectstack/runtime@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 7737bc8: feat(cloud-connection,cli): the install-local POST reports where it cached the manifest, and `os package install` quotes it (#6721)

  The two endpoints of `MarketplaceInstallLocalPlugin` disagreed about one fact.
  `GET /api/v1/marketplace/install-local` — the console's Installed Apps list —
  served `storageDir: this.storageDir`, the ledger directory as resolved by
  `LocalManifestSource` (`config.storageDir` when the host set one, the
  `.objectstack/installed-packages` default when it did not). The `POST` that
  performs the install did not, so its `data` block described everything about
  the install except **where the install went**.

  That gap was load-bearing for the one consumer of that response. `os package
install` runs on a different machine from the runtime it installs into: it
  speaks HTTP and never touches the target's disk. With no directory in the
  response it could only describe the cache location by literal, and the literal
  it printed was the plugin's _default_ — wrong for every host that configures
  `storageDir`, and wrong today rather than eventually. No consumer-side fix
  existed: a locally-resolved constant names the wrong machine, and importing it
  from `@objectstack/cloud-connection` would make a pure-HTTP command fail at
  module load wherever that package is absent. The producer is the contract, so
  the fix is there.

  **`@objectstack/cloud-connection` (additive, no migration).** The install POST
  response's `data` now carries `storageDir`, read from the same
  `this.storageDir` field the GET listing already returns — one field, two
  endpoints, so they cannot drift apart again. No existing key changed, and
  nothing needs to read the new one.

  **`@objectstack/cli`.** The post-install hint now quotes the directory the
  runtime reported:

  ```
    The manifest is cached on the runtime host and re-registers on every
    boot (survives restarts):
      /srv/objectstack/state/ledger-packages
  ```

  Against a runtime older than this release — one whose response has no
  `storageDir` — the CLI prints **no** directory sentence at all. It does not
  fall back to the old literal: a consumer stating a value the producer declined
  to state is the defect Prime Directive #12 forbids, and saying less is correct
  where guessing is not. Everything else the command prints is unchanged.

### Patch Changes

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
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [4c5df00]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [f7d80f4]
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
- Updated dependencies [121852d]
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
- Updated dependencies [86e6f6c]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
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
- Updated dependencies [db59e9c]
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
- Updated dependencies [c51ffa5]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [6146b67]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [73648ba]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [1fa224a]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [89d7b35]
- Updated dependencies [6155c3c]
- Updated dependencies [d13f627]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [bd5fc38]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/runtime@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

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
  - @objectstack/runtime@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 28ad90e: feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

  ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
  D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
  与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
  姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

  **D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
  边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
  读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
  对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
  维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
  装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
  确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
  留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
  谁确认的、何时、在哪个姿态下问的),**之后不复问**。

  - 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
    元数据可以直接重试,不需要先卸载。
  - 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
    其中一条仍会在剩下的那条上停住。
  - 升级引入的**新**约束会被问,老的答案继续算数。
  - 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
    问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
  - ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
    的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
    `os migrate plan` 的 advisory 形态覆盖。

  判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
  就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
  `true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
  (S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

  CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
  逐条清单而不是一句 "Install failed (409)"。

  **D5c —— 遗留手写组织复合索引的 advisory。** 新规则
  `unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
  (`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
  per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
  SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
  在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
  driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
  **永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
  真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

  **D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
  §Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
  `content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
  §Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
  退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
  `content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
  条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
  `gen:schema && gen:docs` 再生成,未手改。

  按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
  显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
  说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
  顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
  `examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
  唯一约束**,故无可扫;这是核查结论,不是遗漏。

  **三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
  `single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
  (S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
  **逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
  断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
  外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
  drift op 为零。

  对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
  `unique: true` 一如既往合法。

- 5a45b9b: `LocalManifestSource.read()` now says WHICH of the two things its `null` meant

  `read()` answered `null` to two different questions at once — "this manifest was
  never installed" and "it was installed, but its ledger file cannot be read" —
  and dropped the reason for the second in an un-bound `catch`. Two admin
  endpoints check `has()` first, so absence was already ruled out by the time they
  called it, and both could only answer
  `500 { code: 'MARKETPLACE_STORAGE_FAILED', message: 'Failed to read manifest cache.' }`:
  a sentence whose only content is that the thing it just did failed, one line
  after `has()` said the file is there. The `Unexpected end of JSON input` /
  `EACCES` / `EISDIR` that names the repair had already been thrown away, and
  nothing was written to the server log either.

  **Breaking (`@objectstack/cloud-connection`):** `read()` returns an
  `InstalledManifestLookup` instead of `InstalledManifestEntry | null`.

  - FROM: `const entry = source.read(id);`
  - TO: `const { entry, failure } = source.read(id);`

  `entry` is the old return value unchanged, so a caller that legitimately treats
  both nulls alike migrates by reading `.entry`. `failure` is a
  `SkippedManifestEntry` — `{ file, cause }`, the same shape `list()` already
  reports, with the thrown object carried unwrapped — and is present ONLY when a
  ledger file exists and could not be read. `failure === undefined` with
  `entry === null` therefore means "not installed", which is the distinction the
  merged `null` erased. One new exported type, `InstalledManifestLookup`.

  `read()` still does not validate the parsed value's SHAPE, and enumerating the
  ledger directory still throws out of `list()` — both unchanged.

  Consumer-visible behaviour:

  - `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` and
    `…/purge-sample-data` keep returning `500 MARKETPLACE_STORAGE_FAILED` — the
    same failure, so a client branching on the code is unaffected — but the
    message now names the ledger file to repair or remove and quotes the cause
    verbatim, and a matching `warn` line goes to the server log.
  - The install path's ADR-0120 D5e posture gate is unchanged on purpose: a
    corrupt entry still counts as "no attestation on record", so the one-time
    installation-wide-unique ceremony is asked again rather than skipped.

- 7127b48: `LocalManifestSource.list()` now reports the ledger entries it could NOT read

  A truncated, unreadable or unparseable file under
  `.objectstack/installed-packages/` was skipped in an un-bound per-file `catch`
  and `list()` returned a bare array, so a short list was indistinguishable from a
  complete one — no difference in the return value, no log, no count. Three
  consumers gave a confidently wrong answer: the installed app was never
  registered at boot (gone from the app switcher, its objects nonexistent) with
  nothing in the log, the console's installed-apps list came back short with
  `success: true`, and `os doctor` printed `✓ Unique scope` over manifests it had
  never parsed.

  Skipping a corrupt file stays correct — one bad manifest must not stop a runtime
  booting the packages that are fine. Skipping it _silently_ was the defect.

  **Breaking (`@objectstack/cloud-connection`):** `LocalManifestSource.list()`
  returns `{ entries, skipped }` instead of `InstalledManifestEntry[]`.

  - FROM: `const entries = source.list();`
  - TO: `const { entries, skipped } = source.list();`

  `skipped` is `Array< { file: string; cause: unknown } >` — the file's basename
  and the object reading or parsing it threw, unwrapped. Callers that only want
  the old behaviour read `.entries`; the point of the shape is that dropping
  `skipped` is now something a caller has to do on purpose. Two new exported
  types, `InstalledManifestListing` and `SkippedManifestEntry`.

  Enumerating the ledger DIRECTORY still throws out of `list()` — unchanged, and a
  different fact from "some files in it would not parse".

  `os doctor` reports unparseable entries as a `Unique scope` warning row naming
  each file with its cause, and withholds the `✓` success line, alongside the
  directory-level row it already had.

### Patch Changes

- 2ddba89: fix(tenancy): eight sites answered "is this deployment multi-org?" with the demoted `OS_MULTI_ORG_ENABLED` (#5262)

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the authoritative knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — therefore reads `false` from
  `resolveMultiOrgEnabled()` while running a fully mounted organization wall.
  #5233 corrected two sites in `plugin-auth`; a census found eight more, all
  written before that function's doc comment was corrected. Third recurrence of
  the shape (cloud#1020, #5233).

  Each site was judged separately for **which** posture answers its question —
  what the operator REQUESTED, or what the `tenancy` service reports is actually
  IN FORCE — rather than converted mechanically:

  - `objectql` `SchemaRegistry` — the env-derived multi-tenant default. Reads the
    REQUESTED posture (it is constructed below the kernel, with no service
    registry to ask). The `organization_id` column was always provisioned; what
    diverged is its INDEX, so a posture-only deployment ran the Layer 0 wall's
    hottest predicate unindexed while SecurityPlugin compiled that same wall.
  - `plugin-dev` — whether to load the enterprise `@objectstack/organizations`.
    REQUESTED posture, mirroring `serve.ts`: this branch is what mounts the wall,
    so asking whether the wall is up would be circular. A posture-only dev stack
    previously never loaded the package at all and served traffic unwalled. Its
    diagnostic now names the posture that was requested instead of asserting
    `OS_MULTI_ORG_ENABLED=true` at an operator who never set it.
  - `runtime` `AppPlugin` (inline seed + hot-reload seeder) — EFFECTIVE posture,
    via the `tenancy` service. These ask "will the per-org replay run instead of
    me?", and on an ADR-0093 D5 degraded boot that replay does not exist, so
    keying on the request would defer to a replay that can never happen. Walled
    deployments previously inline-seeded exactly the NULL-organization rows the
    code's own comment exists to avoid.
  - `cloud-connection` marketplace local install (install-time seed + rehydrate
    heal) — EFFECTIVE posture, same reasoning. The install path is a write path:
    a walled deployment wrote every sample row with no `organization_id`, landing
    the app's data outside the wall its own reads apply.
  - `driver-sql` `isMultiTenantMode()` — REQUESTED posture (a driver has no
    kernel to ask, and a suppressed warning is the costlier error for a
    diagnostic). It also no longer memoises into `_multiTenantMode`: that froze a
    process-level fact into a per-instance verdict on whichever write landed
    first. The gate now resolves live, which is affordable because
    `auditMissingTenant` consults it only after the `tenantId` early-out.
  - `cli` `os verify` — REQUESTED posture. This one produced a green verification
    run over an unverified property: a posture-only deployment silently skipped
    every multi-tenant proof and exited 0.

  **No configuration change is needed anywhere.** Deployments setting only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  belt-and-braces configuration stays valid. Deployments that set only
  `OS_TENANCY_POSTURE` can now drop the redundant boolean. Single-org behaviour is
  unchanged at every site; only the knob each one reads is corrected.

- Updated dependencies [9fe9c1d]
- Updated dependencies [da5d1b4]
- Updated dependencies [d4e0809]
- Updated dependencies [739f496]
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
- Updated dependencies [9f747ee]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [43ca399]
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
- Updated dependencies [7bf3d1c]
- Updated dependencies [db9c331]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [217b791]
- Updated dependencies [fd8521f]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [18b8eaa]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [78adc2e]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
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
- Updated dependencies [d9cac60]
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
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
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
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [ef7845a]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [0cd08d5]
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
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
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
  - @objectstack/runtime@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [7e7a605]
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
- Updated dependencies [63b33e6]
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
- Updated dependencies [8aacf94]
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
  - @objectstack/runtime@17.0.0-rc.2
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

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

- f985b3f: fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

  **`packages/core/src/contracts/` was a dead near-copy of the real contracts,
  and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
  ZERO importers — no relative import, no subpath export, not a tsup entry;
  core's barrel has re-exported the `@objectstack/spec/contracts` versions all
  along ("Re-export contracts from @objectstack/spec for backward
  compatibility"). But the shadow had already **diverged** from the live
  contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
  `rawBody?`; the copy never did), so anyone who grepped their way into it read a
  stale contract that nothing enforces — the exact both-humans-and-AI failure
  mode behind the false `http.server` exemption (#4382). Deleting it is
  zero-risk by construction: nothing could reach it.

  **`http.server` is the canonical slot name, and the ledger now says so.**
  `ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
  `'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
  register both two lines apart; cloud's two server entrypoints do the same).
  Canonical is the only name present on EVERY provider path: runtime's
  `config.server` path registers no alias, so the three cloud-connection plugins
  that read the alias alone (marketplace-proxy, runtime-config,
  marketplace-install-local) found an empty slot there — a live miss, now fixed:
  all readers go canonical-first with the alias as a fallback that dies with the
  alias registrations. The registrations themselves are untouched this release;
  both sites now carry the deprecation note.

  **`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
  escape, declared once. Four consumers were each declaring it locally
  (cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
  those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
  return is deliberate and documented at the single declaration: the handle's
  real type belongs to the framework, and naming it would give the contract a
  framework dependency. Adapters are not required to expose it; consumers
  feature-detect.

  **`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
  their implementation has always accepted.** `bulkRegister`'s contract options
  dropped the `MetadataWriteOptions` half its implementation intersects in
  (`notify` is destructured on the method's first line); `bulkUnregister`
  declared no options at all while the manager takes them. Same shape as the
  `IDataEngine` read-methods gap from B2: a caller typed to the contract could
  not reach the channel without erasing the lookup. Both additive; no implementor
  or caller breaks.

  Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
  typed while touched).

- ac1cc8c: fix(cloud-connection): align the marketplace seed test's timeout with its sibling (#3785)

  `marketplace-install-local-state-machine-exempt.test.ts` failed under a
  full-repo `pnpm test` at 30s, while passing every time the package ran alone.

  Both marketplace seed tests drive `MarketplaceInstallLocalPlugin`, whose
  seeding path dynamically imports the real `@objectstack/runtime` (unmocked on
  purpose, twice: `recordSeedSummary` and `mergeSeedDatasetsIntoKernel`). That
  cold import costs seconds by itself and multiples of that under a fully
  parallel turbo run, and it is charged to whichever test triggers it first.

  Its sibling `marketplace-install-local-seed-lookup.test.ts` was diagnosed as
  exactly this — _"an import stall, not a hang"_ — and raised to 120s. This file
  was left at 30s and kept flaking the same way. The budget is now aligned, with
  the rationale stated locally rather than only in the sibling.

  The flaky set turns out to be exactly the intersection of "does not mock
  `@objectstack/runtime`" and "actually drives seeding":

  | test                   | mocks runtime | drives seeding                    | budget             |
  | :--------------------- | :------------ | :-------------------------------- | :----------------- |
  | `conflict`, `bundle`   | no            | **no** — never reaches the import | default            |
  | `reseed`, `heal`       | **yes**       | yes                               | default            |
  | `seed-lookup`          | no            | yes                               | 120s (already)     |
  | `state-machine-exempt` | no            | yes                               | 120s (this change) |

  So the two tests #3785 recorded are the only two that can hit this, and no
  other file needs the same treatment. A genuine hang still fails — later.

- 627b188: fix(seed-loader): count reference fields dropped from rows that were still written

  The loader had two failure outcomes and only counted one. A record it cannot
  write is counted in `errored`. But an unusable **reference value** (an object
  where a natural key belongs, an array on a single-value field) is removed from
  the record — never written as NULL, which would sever an existing link on
  upsert replay — and the row is written **without it**. Nothing counted that.

  So a load that quietly severed N associations reported `totalErrored: 0`, and
  every count-driven surface read clean. The CLI boot banner — the one seed signal
  that survives `os dev`'s boot-quiet window and the default `warn` level — printed
  `showcase 42 rows`, and the warn line said `0 dropped record(s)`: true, and
  useless ([#3932](https://github.com/objectstack-ai/objectstack/issues/3932)).

  `SeedLoadResult.referencesDropped` and `SeedLoaderSummary.totalReferencesDropped`
  now count it. It is deliberately **not** folded into `errored` — the row _was_
  written, so that would break the `inserted + updated + skipped` reconciliation
  against `total`. The banner names it separately:

  ```
  ⚠ Seeds:   showcase 42 ok / 3 lost links ⚠
  ```

  Both counters are additive with a `0` default, so an existing producer or
  consumer of `SeedLoaderResult` is unaffected.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

- Updated dependencies [bc35e00]
- Updated dependencies [6a67d7a]
- Updated dependencies [6e141bc]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [a4e2684]
- Updated dependencies [06772eb]
- Updated dependencies [0c90ece]
- Updated dependencies [195ad76]
- Updated dependencies [c2bbd97]
- Updated dependencies [698cbc2]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [6fa1827]
- Updated dependencies [05154a1]
- Updated dependencies [0f12193]
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
- Updated dependencies [fce14ab]
- Updated dependencies [2e836de]
- Updated dependencies [7309c81]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [a225ef5]
- Updated dependencies [c9d254a]
- Updated dependencies [c8124e5]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [0373d52]
- Updated dependencies [4f30943]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [bb192c4]
- Updated dependencies [98e7cc7]
- Updated dependencies [4cf7c61]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [8a341a4]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [385c4b0]
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
- Updated dependencies [99b4392]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [33a5ff4]
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
- Updated dependencies [3ba8d77]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [5b08389]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [1d5dc46]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [65a3a84]
- Updated dependencies [de6daa5]
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
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [2053714]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [7309c81]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [43fc039]
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
  - @objectstack/runtime@17.0.0-rc.1
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- 402f534: fix(objectql): bridge late-registered manifest objects into the metadata service

  Marketplace-installed template packages register through the `manifest`
  service on `kernel:ready` (install) or later (HTTP install), but the one-shot
  SchemaRegistry→metadata bridge runs once during `ObjectQLPlugin.start()` —
  so their objects only ever reached the ObjectQL registry. Every
  IMetadataService consumer (AI `describe_object`, Studio object lists,
  `metadata.listObjects`) missed them; only the seed loader had grown an
  engine-side fallback (#3422).

  The manifest service's `register` now bridges the manifest's own objects into
  the metadata service after registering them with the engine, resolving the
  service at call time and mirroring the startup bridge's contract:
  `register('object', name, obj, { notify: false })` (#3112), skip entries it
  did not bridge itself, refresh its own copy on same-package re-install (hot
  upgrade). Armed only after `start()` has run the one-shot bridge, and never
  on project kernels — boot-time behavior is unchanged. `register` now returns
  a promise; the marketplace install/rehydrate paths await it so metadata reads
  right after an install are deterministic.

- 1c8bf4f: fix(marketplace): heal missing sample data when rehydrating installed packages onto a new database

  The install ledger (`.objectstack/installed-packages/`) is anchored to the
  project directory while the database can be swapped out from under it —
  `os dev --fresh`, a deleted `dev.db`, a `--database` switch. Rehydrate
  deliberately never re-seeds (existing rows must not be re-upserted over user
  edits on every boot), which left a rehydrated marketplace package PERMANENTLY
  empty on a new database: app in the switcher, tables created, zero rows — the
  "HotCRM installed but every KPI is 0 / Sales Pipeline all-empty" state.

  Rehydrate now runs the bundled seed datasets iff the manifest actually bundles
  them, the user never explicitly purged them, the runtime is single-tenant
  (multi-tenant seeding stays owned by the per-org replay), and EVERY seeded
  object is empty — one surviving row anywhere means the data is still there and
  nothing is touched, so the heal is idempotent across restarts and can never
  revert user edits.

  Also fixed along the way: a purge now stamps `sampleDataPurged` on the ledger
  entry (so healed restarts respect the deliberate empty baseline), and install
  marks `withSampleData: true` when the seed run reports all rows _skipped_
  (already present, e.g. a reinstall over live demo data) instead of leaving the
  flag false over a seeded database.

- 810a3a2: fix(runtime,cloud-connection): multi-tenant seed replay covers every source, not just the first (#3453)

  In multi-tenant deployments (enterprise `@objectstack/organizations`) a brand-new org
  gets its own private copy of demo data by replaying the kernel's `seed-datasets` list
  on the `sys_organization` insert. That list is meant to hold the union of every seed
  source — every config-declared app AND every marketplace package — but two framework
  traps (the same pair #3444 fixed for seed-summary) shrank it to just the first source:

  - The standard `PluginContext` exposes `getService`/`registerService` but has NO
    `.kernel` handle, so `(ctx as any).kernel?.getService('seed-datasets')` always read
    `undefined`. Each source then saw "nothing registered" and overwrote the list with
    only its own datasets instead of extending it.
  - `registerService` throws on a duplicate name, so the second source's re-register was
    swallowed by the surrounding try/catch — its datasets (and, for a config app, its
    replayer) silently lost.

  Net effect: with two config apps, or a config app plus marketplace packages, a new org
  replayed only the first app's seeds.

  The fix mirrors #3444's seed-summary hardening: `seed-datasets` is now a single shared
  array, registered once and mutated in place by every source through a new
  `mergeSeedDatasets` helper that reads via the context's own resolver first. AppPlugin's
  per-org replayer reads that live list at invoke time instead of a captured snapshot, so
  it replays the full union — including datasets merged after its closure was built — and
  the replayer itself is registered once and reused by later config apps.

  Covered by seam-level unit tests (accumulation across app + marketplace sources; the
  replayer reads the live union). True multi-tenant end-to-end coverage requires the
  enterprise `@objectstack/organizations` plugin, which lives in the cloud repo.

- d60968c: Surface marketplace rehydrate/heal seed outcomes in the `os dev` / `os serve` boot banner (#3430), extending the config-app Seeds line from #3415.

  The seed pipeline's most useful result lines are all `logger.info`, but `os dev` forwards a default `warn` level and the serve boot-quiet window swallows stdout — so "marketplace package rehydrated onto a fresh DB with 0 rows", a fresh-DB self-heal, and row-level seed failures were all invisible unless you queried the database directly.

  The `seed-summary` kernel service is now a per-source list. AppPlugin (config apps) and the marketplace rehydrate/heal path each contribute a labelled entry, and the banner prints one combined line that ignores the log level:

  ```
  Seeds:   showcase 162 rows · hotcrm(marketplace) 157 ok / 5 errors ⚠
  ```

  Fresh-DB heals are marked `(healed on fresh db)`; a marketplace package that installed with seed datasets but landed 0 rows, and any run that dropped records, escalate to a yellow `⚠` line instead of passing silently.

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
- Updated dependencies [6877e9a]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [3c8cfd1]
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
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [0bfdf46]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [19e3e6e]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [cbedd62]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
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
- Updated dependencies [7180ed5]
- Updated dependencies [083c414]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
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
- Updated dependencies [8e08bc3]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
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
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [e231abb]
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
  - @objectstack/runtime@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [b39c65d]
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
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [ee0a499]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
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
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
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
  - @objectstack/runtime@16.0.0
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
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
- Updated dependencies [92f5f19]
- Updated dependencies [a2d6555]
- Updated dependencies [3a6310c]
- Updated dependencies [32899e6]
- Updated dependencies [515f11a]
- Updated dependencies [4174a07]
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
  - @objectstack/runtime@16.0.0-rc.0
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/runtime@15.1.1
- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1

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
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/runtime@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/runtime@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/runtime@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [5f43f88]
- Updated dependencies [261aff5]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/runtime@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/runtime@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/runtime@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [bc26360]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [bd39dc5]
  - @objectstack/runtime@14.0.0
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [9693a36]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/runtime@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/runtime@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [e011d42]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/core@11.1.0
  - @objectstack/runtime@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
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
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/runtime@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/types@10.0.0

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
  - @objectstack/runtime@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
  - @objectstack/spec@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/runtime@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/runtime@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Minor Changes

- 08a11f7: RuntimeConfigPlugin: make the per-request `features` seam open-ended and plan-agnostic (open-core boundary, cloud ADR-0012).

  The framework now transports an opaque feature map: a host's policy hook may return ANY boolean feature keys and they pass through to the SPA verbatim — the framework no longer enumerates a distribution's commercial feature catalog. Adds `resolveFeatures` (plan-agnostic) and `RuntimeFeatureOverrides`; deprecates `resolvePlanFeatures` / `RuntimeConfigPlanFeatures` (still honoured for backward compatibility).

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Minor Changes

- 998c4e4: New package: `@objectstack/cloud-connection` — the open runtime-side client for an ObjectStack cloud control plane (ADR-0008 Phase 2). Carries the marketplace browse proxy, install-local, the `/api/v1/cloud-connection/*` surface (status, RFC 8628 device-code bind, org catalog, installed views, control-plane install), and `RuntimeConfigPlugin` with a `resolvePlanFeatures` policy seam (plan entitlements stay host-side). Canonical sources move here from the cloud distribution's `@objectstack/objectos-runtime`, which now re-exports them.
- b8e4232: Self-hosted binding becomes consumable (cloud ADR-0008 consumption side): `ConnectionCredentialStore` persists the one-time `oscc_` runtime bearer the bind flow returns (0600, env-local); all control-plane forwards fall back to it when no `OS_CLOUD_API_KEY` is set; new `POST /cloud-connection/unbind` revokes + clears; install-local's catalog fetch presents the credential so org/private packages resolve. The binding Setup UI ships WITH the plugin as SDUI metadata (`cloud_connection_settings` page + Setup-nav contribution, ADR-0029 K2) — the console only registers the `cloud-connection:panel` widget.
- 8950204: The Installed Apps page ships as metadata with `MarketplaceInstallLocalPlugin` (cloud ADR-0009 P2a): `marketplace_installed` page (page:header + `marketplace:installed-list` widget) and the Setup nav entry switches to `type:'page'`.
- 17ffc74: `LocalManifestSource` — the install-local disk ledger promoted to a first-class, exported desired-state owner for self-hosted runtimes (cloud ADR-0007 step ⑤). `MarketplaceInstallLocalPlugin` now delegates all ledger reads/writes to it; behavior unchanged. Also exports `InstalledManifestEntry` and `DEFAULT_INSTALLED_PACKAGES_DIR`.
- c802327: Marketplace Setup navigation is now plugin-owned (cloud ADR-0009): `MarketplaceProxyPlugin` carries the "Browse Marketplace" entry and `MarketplaceInstallLocalPlugin` carries "Installed Apps" — no plugin mounted (e.g. `OS_CLOUD_URL=off`), no entry, no dead page. The two entries are removed from `@objectstack/platform-objects`' setup-nav contributions (ADR-0029 K2 ownership handoff).
- 48051ff: Runtime-identity bind v2 (cloud ADR runtime-identity-binding): a self-hosted runtime binds like a device — no environment id required. `bind/start`/`bind/poll` work environment-less in `singleEnvironment` mode; the bind call carries a registration claim (`hostname`, `runtime_version`, and the stored `runtime_id` on re-bind) and the store persists the cloud-minted `runtime_id` (durable identity, stable across token rotations). `status` reports `runtimeId` and treats "no env id" as unbound rather than 404; `unbind` revokes bearer-first with no environment requirement; `org-packages` forwards bearer-only when no environment is configured (the connection carries the org); `installation`/`installed` degrade gracefully for registration-only runtimes. `StoredConnectionCredential.environmentId` is now optional (`runtimeId` added).

### Patch Changes

- 9fea621: bind/start appends device context (`runtime_name`, `runtime_version`) to the device-flow verification URLs so the cloud approval page can show WHAT is being authorized (ADR runtime-identity-binding §2.3). Display-only informed-consent context; the approval page pairs it with an "only approve if you started this" warning.
- 3786f15: install-local accepts compiled stack bundles: a published version payload (`dist/objectstack.json`) nests its meta under `.manifest` while ObjectQL's registerApp expects the flat app shape — every install of a published compiled bundle failed with "Invalid manifest payload". The handler now flattens the bundle shape (both the cloud-fetch and inline/file-import paths).
- 9b4e870: `resolveEnvironmentId` no longer presents the CLI's local-dev sentinel ids (`env_local` / `proj_local`) to the control plane as cloud environment ids — they identify the local kernel only. A single-environment runtime started via `objectstack dev` now reads as cleanly unbound and binds environment-less (ADR runtime-identity-binding), instead of 404-ing the bind against a non-existent cloud environment.
- d01c427: Unbind keeps an identity residual: the credential is cleared (and revoked cloud-side first) but `runtimeId` survives in the store, so a later re-bind to the same org claims — and revives — the same registration instead of minting a new device per disconnect cycle. `ConnectionCredentialStore.read()` accepts token-less residual records.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0
