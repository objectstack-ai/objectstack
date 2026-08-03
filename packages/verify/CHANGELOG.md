# @objectstack/verify

## 17.0.0-rc.2

### Minor Changes

- b25a116: fix(verify): resolve the enterprise organizations package from the HOST APP (#4700)

  `bootStack(app, { multiTenant: true })` — and therefore `objectstack verify
--multi-tenant` — could never load `@objectstack/organizations`. Node ESM
  resolves a bare `import()` against the **importer's own realpath**, which for
  `packages/verify` is inside the framework workspace, while the enterprise
  package is cloud-private and only ever lives in the verified app's
  `node_modules`. Every real host app fell into the catch and was told to
  "Install/link it in this workspace" — about a package it had already installed.
  Same defect class as cloud#1013, which fixed `objectstack serve`; #4699 fixed
  that one call site and this issue tracked the two the sweep left behind.

  **New: `@objectstack/types/node`.** The host-app resolver (`createHostRequire` /
  `createHostImporter`) moved out of `packages/cli/src/utils/import-from-host.ts`
  — where `@objectstack/verify` and the dogfood suite could not import it without
  inverting the dependency direction — into a **node-only subpath export** of
  `@objectstack/types`. One behaviour, one source; the CLI now consumes it and its
  private copy is deleted.

  It is a subpath and **not** the root export because `@objectstack/types` is a
  dependency of `@objectstack/hono` ("edge-compatible REST API server for
  Cloudflare Workers, Deno, Bun, and Node") and of the plugin layer a `LiteKernel`
  boots on Workers. The root entry reaches zero `node:` builtins, and a Workers
  bundle breaks on `node:module` even when nothing calls it. `tsup` emits the two
  entries as separate self-contained bundles (`splitting: false`), and a test
  walks the root's import graph and fails on the first reachable `node:`
  specifier, so the isolation is enforced rather than merely intended. Same
  arrangement `@objectstack/metadata` already ships for its `./node` subpath.

  **New: `BootOptions.hostRoot`** (optional, defaults to `process.cwd()`) names
  the app whose `node_modules` supplies those optional packages — for a harness
  booting an app that is not the working directory.

  **The dogfood multi-org gates had never run.** Two suites probed availability
  with the same bare `import()` and so were **constant-false** — not "false
  because absent" but false by construction, in every environment including the
  cloud CI whose comment claimed it ran them. The #1994 cross-tenant RLS proof and
  the attachments cross-tenant isolation block had therefore never executed while
  the suite reported green (Prime Directive #10, test-suite edition). They now
  resolve like the runtime does, and `OS_TEST_MULTI_ORG_ENABLED=1` declares that a
  run is expected to ship the package — turning a silent skip into a loud failure,
  so a run can no longer pass by quietly not running the gates it exists for.

- c2a1134: fix(verify): stop the harness pinning `suspendedRunStore: 'memory'` (#4470)

  `bootStack` hardcoded `suspendedRunStore: 'memory'` when it registered
  `@objectstack/service-automation`. That made the DB-backed suspended-run store
  **structurally unreachable** from every dogfood/e2e fixture — not under-tested,
  untestable. The coverage map had a clean seam nothing crossed:

  - unit tests covered ENGINE-side persistence (`suspended-run-store.test.ts`
    drives suspend → restart → resume against a fake table);
  - e2e covered the BUSINESS chain (approvals), but single-process and wholly in
    memory;
  - the ASSEMBLY between them — is `sys_automation_run` registered, is its table
    created, is the store actually attached to the engine — was covered by
    neither.

  #4420 grew in precisely that seam: the store hung off a table that was never
  created, every write failed into a `warn` nobody read, the pause reported
  success, and the run died at the next restart. #4460 added assembly unit tests;
  this makes the e2e half possible.

  The harness now boots the plugin's own `'auto'` default — the same wiring
  `objectstack dev` / `serve` get — so fixtures exercise the real assembly. Two
  new knobs:

  - `automation` accepts `{ suspendedRunStore: 'auto' | 'memory' }` as well as
    `true`, so a fixture that wants the old in-memory behaviour asks for it
    explicitly rather than getting it by default.
  - `databaseFile` backs the in-process SQLite database with a file instead of
    `:memory:`, so state can outlive a kernel.

  Answering the question the issue raised — was `'memory'` pinned for speed or
  because persistence could not run there? **Speed/simplicity.** The durable path
  works in this harness: the accompanying dogfood proof boots with it, and the
  whole existing dogfood suite passes on it unchanged (38 files, 239 tests). Note
  `databaseFile` does not yet deliver a true cold boot: a second `bootStack` over
  the same file reads a database whose tables exist but whose rows are gone —
  ordinary records do not survive it either, so it is a harness/driver persistence
  gap rather than anything to do with suspended runs, and it is filed as #4518.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [257d97a]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [7e7a605]
- Updated dependencies [2f05139]
- Updated dependencies [fa94b2c]
- Updated dependencies [328ccc5]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [f2eb850]
- Updated dependencies [8bd437f]
- Updated dependencies [5046afe]
- Updated dependencies [203a449]
- Updated dependencies [6dcbbc3]
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
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [be25f97]
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
- Updated dependencies [4c45be1]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [05d8a54]
- Updated dependencies [ec975f1]
- Updated dependencies [68c02c2]
- Updated dependencies [eb4204b]
- Updated dependencies [25784cf]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [127f091]
- Updated dependencies [9fd9ae7]
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
- Updated dependencies [0d9a779]
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
- Updated dependencies [1ee48bc]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [ba5ff2f]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [304423e]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [26bb053]
- Updated dependencies [be90dea]
- Updated dependencies [04f1182]
- Updated dependencies [c03108c]
- Updated dependencies [5647006]
- Updated dependencies [50185a8]
- Updated dependencies [d6bd5a1]
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
  - @objectstack/objectql@17.0.0-rc.2
  - @objectstack/plugin-auth@17.0.0-rc.2
  - @objectstack/plugin-security@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/service-analytics@17.0.0-rc.2
  - @objectstack/service-automation@17.0.0-rc.2
  - @objectstack/rest@17.0.0-rc.2
  - @objectstack/service-datasource@17.0.0-rc.2
  - @objectstack/plugin-sharing@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/service-settings@17.0.0-rc.2
  - @objectstack/plugin-hono-server@17.0.0-rc.2

## 17.0.0-rc.1

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

- c3bcb42: feat(runtime,datasource): the default-datasource connect seam accepts a host driver factory — adopt pre-built instances without forking the verdict (#3826)

  ADR-0062 D1's open-core convergence (#3869/#3886) left one structural question
  open: a host whose `default` needs a driver the shared factory cannot build —
  the cloud distribution's `turso`, or an instance pooled BEYOND one kernel (the
  cloud control-plane driver doubles as the proxy base of every environment
  kernel; per-environment drivers are cached across kernel rebuilds) — had only
  two options, both bad: stay on the legacy pre-built `DriverPlugin` path, whose
  connect verdict lives in `ObjectQLEngine.init()` (the second implementation
  #3826 exists to retire), or fork the connect orchestration. Either re-opens the
  #3741 → #3758 drift this whole line of work is about.

  Two additive pieces close it:

  - **`DefaultDatasourcePlugin` accepts an injected `IDatasourceDriverFactory`**
    (defaults to the shared open-core factory, byte-for-byte unchanged when
    omitted). The factory only changes what `create()` returns — the policy-free
    init connect, `bootCritical` fail-fast, `OS_ALLOW_DRIVER_CONNECT_FAILURE`
    escape hatch, and the start() replay into retained admin state are identical
    either way, and the new tests pin that (an adopted instance that cannot
    connect takes the exact same verdict).
  - **`createPrebuiltDriverFactory(driver, { driverId?, fallback? })`** in
    `@objectstack/service-datasource` — the "adopt an existing driver" seam the
    first #3826 pass found missing, landed AS a factory so it composes into the
    one connect path instead of becoming a second entry point. `create()` returns
    the SAME instance every call: construction, pooling, and reuse stay host
    concerns; only the verdict converges. Not for the common case — a `default`
    expressible as `{ driver, config }` should stay a plain definition.

  The `@objectstack/verify` dogfood harness now boots through
  `DefaultDatasourcePlugin` (declared `sqlite-wasm` definition) instead of a
  pre-built `DriverPlugin` — so the dogfood gate exercises the same declared
  -default connect path `objectstack dev`/`serve` use, which is the §Risk
  mitigation ADR-0062 promised ("behind the dogfood gate") and did not yet have.
  The degraded-boot parity guard stays: `ObjectQLEngine.init()`'s verdict is
  still live for the boot re-verification, `DriverPlugin` escape-hatch drivers,
  and the cloud compositions until they converge onto this seam.

- 64f8cbe: feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

  The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
  registered by `@objectstack/service-settings`, but it has three producer
  classes and only one of them is settings: the settings service's encrypted
  specifiers, the ObjectQL engine's own `secret`-field encryption
  (`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
  business object carrying a `Field.secret()`), and the datasource credential
  binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
  fail-CLOSED: on a kernel composed without settings, every insert/update of an
  object with a secret field threw — with an error message that told the
  operator to "Ensure the platform-objects (sys_secret) are registered", naming
  a package that did not register it.

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the store exists with the
  platform, independent of which optional services are composed, and the
  engine's fail-closed error message is true. Definition ownership is unchanged
  (`sys_secret` stays in `@objectstack/platform-objects` and in
  `PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
  consumer through its `sys_secret`-backed secret store.

  Consequences:

  - `@objectstack/service-settings` no longer contributes `sys_secret` to the
    manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
    embedder composing `SettingsServicePlugin` on a hand-built kernel that
    relied on it for the `sys_secret` table must compose
    `PlatformObjectsPlugin` (the plugin every supported assembly path already
    includes). The move REPLACES the registration — nothing registers the
    object twice.
  - `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
    mirroring `os serve`'s auto-inject — which also means harness kernels now
    carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
    served assembly always had.

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
- Updated dependencies [3ec8186]
- Updated dependencies [698cbc2]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
- Updated dependencies [1ea6bce]
- Updated dependencies [e5e8b10]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [bb1ce2e]
- Updated dependencies [b4be309]
- Updated dependencies [6fa1827]
- Updated dependencies [05154a1]
- Updated dependencies [7a55913]
- Updated dependencies [0f12193]
- Updated dependencies [7a55913]
- Updated dependencies [f5ab1c7]
- Updated dependencies [9b6fe7c]
- Updated dependencies [3abd233]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [ea24593]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [fccec22]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [fce14ab]
- Updated dependencies [2e836de]
- Updated dependencies [7309c81]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [7df7c64]
- Updated dependencies [fae74b5]
- Updated dependencies [545d931]
- Updated dependencies [a225ef5]
- Updated dependencies [7bf5349]
- Updated dependencies [366105c]
- Updated dependencies [c9d254a]
- Updated dependencies [c8124e5]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [f4d7f1d]
- Updated dependencies [217e2e6]
- Updated dependencies [4dc14cc]
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
- Updated dependencies [c39d713]
- Updated dependencies [dc530b4]
- Updated dependencies [f0d6594]
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
- Updated dependencies [d4720ca]
- Updated dependencies [43ff598]
- Updated dependencies [e5a4d26]
- Updated dependencies [839982e]
- Updated dependencies [623e555]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [71af9f5]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [99b4392]
- Updated dependencies [99ffc04]
- Updated dependencies [974c6d4]
- Updated dependencies [7309c81]
- Updated dependencies [495019b]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [33a5ff4]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [55bbefc]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [be7945a]
- Updated dependencies [cc2de0e]
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
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [dd5daac]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
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
- Updated dependencies [0931185]
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
- Updated dependencies [f1f40b4]
- Updated dependencies [4580597]
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
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/runtime@17.0.0-rc.1
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/plugin-sharing@17.0.0-rc.1
  - @objectstack/plugin-security@17.0.0-rc.1
  - @objectstack/rest@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/plugin-auth@17.0.0-rc.1
  - @objectstack/service-automation@17.0.0-rc.1
  - @objectstack/service-analytics@17.0.0-rc.1
  - @objectstack/plugin-hono-server@17.0.0-rc.1
  - @objectstack/service-datasource@17.0.0-rc.1
  - @objectstack/service-settings@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 587fc91: feat(analytics): the executeAggregate bridge carries ExecutionContext — ADR-0021 D-C second belt

  The analytics→engine bridge now forwards the request's `ExecutionContext` to
  `engine.aggregate`, so the engine's own middleware chain scopes analytics reads
  independently of the analytics layer's `getReadScope`.

  **Why.** `BaseEngineOptions.context` has always been `.optional()`, so nothing
  forced the bridge to pass it — and it did not. An authenticated aggregate
  reached the engine with no principal, plugin-security's principal-less fall-open
  skipped its RLS injection, and the only thing left scoping the query was the
  strategy remembering to call `getReadScope`. #3597 was a strategy that did not,
  and both belts were off at once.

  `getReadScope` stays: the two resolve scope through different paths (engine
  middleware vs `security.getReadFilter`), and a deployment without
  plugin-security has only the analytics layer. This is depth, not a replacement.

  - `StrategyContext` gains `context?: ExecutionContext`, bound per call by
    `AnalyticsService` from `query()` / `generateSql()` / `queryDataset()`.
  - `StrategyContext.executeAggregate` and the `AnalyticsServicePlugin` /
    `AnalyticsService` `executeAggregate` config options gain `context?:
ExecutionContext`. **Custom bridges should forward it** to their engine; the
    built-in auto-bridge does. Purely additive — an existing bridge that ignores
    it keeps working exactly as before.
  - `DimensionLabelDeps.fetchRecordLabels` and `resolveDimensionLabels` each gain
    an optional trailing `context`, beside the `scope` / `resolveScope` that
    #3639 added — the same two-belt split as the aggregate path.
  - `BootOptions.analytics` (`@objectstack/verify`) overrides the
    AnalyticsServicePlugin instance, so a gate can boot with the analytics belt
    off and assert the engine-side belt alone still scopes.

  **Also fixed on the same seam:**

  - `fetchRecordLabels` — the dimension display-label lookup — is row-granular
    (one row per record, real display names). #3639 gave it the analytics-layer
    belt (the referenced object's own read scope); it now also carries the
    context, so the engine scopes the same read independently.
  - `ObjectQLStrategy.generateSql` emitted no `WHERE` at all, so the
    `/analytics/sql` preview read as an unscoped table scan while the real
    aggregate was scoped. It now renders the caller's filters and the read scope.
    The preview never executed, so this was misleading output rather than a leak.

- 680e8e8: feat(verify): `checkDateBucketParity` — pin the seam between pushed-down and in-memory date bucketing

  A driver that advertises `supports.queryDateGranularity[g]` is telling
  `engine.aggregate` it may push `dateGranularity: g` down as SQL instead of
  fetching rows and bucketing them in JS. The two are then not two features but
  one feature with two implementations, and the engine picks between them per
  query — a granularity the driver advertises goes down as SQL, one it does not
  goes to `applyInMemoryAggregation`, and a non-UTC timezone forces the in-memory
  path regardless. A dashboard can cross that seam mid-drill-down.

  Nothing checked that they agree. That is how #3773 shipped: SQLite stores a
  `Field.datetime` as INTEGER epoch milliseconds, `strftime` read the bare integer
  as a Julian day number, and every row bucketed as NULL — a trend chart collapsed
  into a single bar while every gate stayed green. The driver's own bucket suites
  build their fixtures with `knex.schema.createTable` + `t.string(...)`, which is
  ISO TEXT — the half `strftime` parses natively — and the engine never
  second-guesses a granularity a driver claims to support.

  `checkDateBucketParity(driver)` rounds a fixture through the driver and, for
  every granularity it advertises, compares its pushed-down result against the
  REAL `applyInMemoryAggregation` over the driver's own `find()` rows. Both
  temporal storage forms are probed under one object (`Field.datetime` and
  `Field.date` naming the same calendar days), so a storage-form leak shows up as
  the two columns bucketing differently even when each is internally consistent.
  A granularity the driver does not advertise is skipped, never faulted.

  It follows `checkReadCoercion`: human-readable problems (empty = conformant), no
  test-runner dependency, driver taken structurally — so an out-of-tree driver
  runs the identical contract against itself. That matters most for cloud's
  `driver-turso`, which is remote SQLite with exactly the epoch storage that broke
  here.

  Wired up in `packages/qa/dogfood/test/date-bucket-parity-conformance.test.ts`
  against driver-sql and driver-sqlite-wasm, with negative controls that pin what
  the checker can detect. Verified against the real regression, not just fakes:
  reverting the #3773 fix turns the gate red on both drivers with a diagnostic
  naming the collapsed bucket.

  The three test files that hand-copy `bucketDateValue` (driver-sql cannot depend
  on objectql) now say what their `⚠️ Keep in sync` comments cannot enforce — a
  copy that stops tracking its original leaves the copy and the SQL agreeing with
  each other while both are wrong — and point at the executable check. The same
  pointer is on `bucketDateValue` itself, which is where an edit would start the
  drift.

- a227ed7: fix(objectql)!: one key for the empty group bucket — real `null`, on both aggregation paths (#3839)

  A grouped row whose dimension value is empty now carries `null` for that
  dimension no matter which way the aggregate ran. Downstream code can test the
  empty bucket with a plain `value == null` again: charts render their own empty
  label, drill-through on that bucket builds `field = null` and returns the rows
  it should, and a dashboard no longer changes shape when the driver, the
  granularity or the reference timezone changes.

  ### What was wrong

  `engine.aggregate` has two implementations of one feature. It pushes the
  aggregate down as SQL when the driver advertises every requested granularity and
  the reference timezone is UTC; otherwise it fetches rows and buckets them in JS.
  The two disagreed about how to spell "empty":

  ```
  --- same dataset, same query, one row with a NULL value ---
    pushed-down SQL : [{ "key": null,     "type": "null",   "total": 2 }, …]
    in-memory       : [{ "key": "(null)", "type": "string", "total": 2 }, …]
  ```

  The measures were always right — only the key's type and literal differed —
  which is why this went unnoticed for so long: every total reconciled. But the
  engine picks a path per query, so the same data produced a different bucket key
  on SQLite-plus-UTC-plus-`month` than on `week` (which SQLite does not advertise),
  a non-UTC timezone, or `driver-rest` / `driver-memory` / a remote Turso, all of
  which bucket in memory unconditionally.

  It was never date-specific either. A plain `groupBy: ['stage']` over a NULL
  column diverged the same way.

  Consumers are written against `null` — they check `== null` and supply their own
  empty label ('—', '(empty)', a localized "Uncategorized"). The sentinel defeated
  every one of them: it rendered a raw English debug string in the UI, and a drill
  on the empty bucket compiled to `field = '(null)'` and matched nothing.

  The in-memory path's comment justified the string as staying "consistent with
  the client `useReportData` hook". That hook was removed with ADR-0021, and the
  literal never appeared in it.

  ### What changed

  - `applyInMemoryAggregation` and `bucketDateValue` (`@objectstack/objectql`) key
    the empty bucket as `null`. `bucketDateValue` now returns `string | null`. A
    null instant and an unparseable one still share one bucket, because SQL cannot
    tell them apart either (`strftime('%Y-%m', 'not-a-date')` is NULL).
  - The internal composite bucket id is JSON-encoded, so the empty bucket stays
    distinct from a row whose value is the literal string `"null"`.
  - `bucketKeyToCalendarRange` (`@objectstack/core`) accepts `string | null`. The
    empty bucket has no calendar span, so a drill on it opens the unscoped
    superset instead of an invented bound — unchanged behavior, honest signature.
  - The driver output contract in `@objectstack/spec` now states the rule: a row
    with no value keys as `null`, never a sentinel. Propagating NULL through the
    bucket expression is the whole of it; a driver only breaks it by adding a
    `COALESCE`.

  ### Gates

  `checkDateBucketParity` (`@objectstack/verify`) deliberately carried no null
  instant, because the divergence would have failed it for a reason it was not
  about. Its fixture now has one, so the convergence is held in place — including
  for out-of-tree drivers that run the check against themselves.

  Two fixes were needed to make that fixture meaningful:

  - The check folded bucket labels through `String(value)`, which turns SQL NULL
    into `'null'` — a label a TEXT column can genuinely hold. A driver spelling
    "empty" as a string could compare equal to one returning real NULL. The empty
    bucket is now keyed out of band.
  - Label sets were compared with `JSON.stringify`, which is sensitive to key
    insertion order. Row order is not part of this contract and the two paths
    naturally differ (SQL sorts its groups; the in-memory path emits first-seen
    order), so a driver with entirely correct buckets could be reported as
    disagreeing — with an empty diff message, since nothing actually differed.
    The comparison is now order-insensitive.

  A new dogfood check covers the non-date half against real drivers: same dataset,
  plain and date-bucketed `groupBy`, both paths, one key.

### Patch Changes

- 0045682: feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
  vocabulary is closed (ADR-0108, #3723)

  `sys_member.role` answers "what is your standing in this organization". It does
  not answer "what may you do" — that is what positions are for. One column was
  answering both.

  `resolve-authz-context` projects EVERY value stored in `sys_member.role` into
  `current_user.positions`, alongside the rows read from `sys_user_position`. So a
  business role handed out through the membership role _was_ capability — granted
  with none of the position system's controls: no `granted_by`, no ADR-0091
  validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
  That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
  invitations are accepted — **never as the authority for RBAC**"), what
  ADR-0090 D3's word ban restates (distribution = `position`), and what
  ADR-0095 D3 keeps out of the enforcement path.

  The vocabulary is therefore closed to the four framework-owned names:
  `owner` / `admin` / `delegated_admin` / `member`.

  **BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
  `AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
  (`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
  `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
  `withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
  `MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
  `OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
  `@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
  `MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
  app-supplied names. A TypeScript error is the intended failure: an option that
  is silently ignored is `declared ≠ enforced` one more time.

  FROM → TO:

  ```diff
  - new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
  + new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

  - POST /organization/invite-member { email, role: 'sales_rep' }
  + POST /organization/invite-member { email, role: 'member',
  +                                    businessUnitId, positions: ['sales_rep'] }
  ```

  For an existing member, assign the position through `sys_user_position` (the
  governed write path). Invitation placement (ADR-0105 D8) is the one-step
  admission flow: issuance is authorized against the issuer's `adminScope` by
  dry-running `DelegatedAdminGate`, and acceptance writes real
  `sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
  what it replaces — a delegated admin may use it within their subtree, where the
  membership-role route was open to org admins only (the invitation role cap holds
  anyone below admin grade to plain `member`).

  An invitation naming an app role now fails at better-auth's door with
  `ROLE_NOT_FOUND`, before any row is written.

  This reverses two changesets that were never consumed into a release
  (`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
  version ever offered the behaviour; both are removed rather than shipped and
  retracted in the same changelog. A pre-existing deployment could only have
  stored a custom value by direct DB write.

  Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
  now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
  copy carried `guest`, which the `sys_member.role` select has never offered — an
  approver authored as `{ type: 'org_membership_level', value: 'guest' }`
  resolved to nobody and the lint whose whole job is to catch that stayed silent.

- e889386: `bootStack({ multiTenant: true })` now REQUESTS the `isolated` tenancy posture
  for the boot (ADR-0105 D1), restoring the request on `stop()` and respecting an
  explicit caller-provided `OS_TENANCY_POSTURE`.

  Since #3559 a walled posture is an explicit operator request resolved from env
  when AuthPlugin registers the `tenancy` service — mounting the enterprise
  organizations plugin only ENTITLES it. The harness's multi-tenant opt-in
  predates that split and only mounted the plugin, so multi-org fixtures silently
  booted `single`: no Layer 0 wall, D3 default-org write stamping, and every
  cross-tenant proof asserting against the wrong posture (first surfaced by
  cloud's security-enterprise multi-org integration test, which runs the licensed
  path open-core CI cannot).

  The verify package also gains a `test` script so its suite actually runs under
  `turbo run test`, including the new regression pin for this contract.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [735f850]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [c7f4417]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [6877e9a]
- Updated dependencies [0bab8bb]
- Updated dependencies [840ee4b]
- Updated dependencies [7101ca2]
- Updated dependencies [587fc91]
- Updated dependencies [415254c]
- Updated dependencies [1f8390b]
- Updated dependencies [3167e29]
- Updated dependencies [0a6fb1e]
- Updated dependencies [1986594]
- Updated dependencies [3c8cfd1]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [f92096b]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [fb90784]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [9dcc0ae]
- Updated dependencies [984396b]
- Updated dependencies [d0fea33]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [1003125]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [0bfdf46]
- Updated dependencies [3949a43]
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
- Updated dependencies [ce1f100]
- Updated dependencies [2fa4ca1]
- Updated dependencies [2f47489]
- Updated dependencies [7ef20d0]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [c88eeda]
- Updated dependencies [de9af8a]
- Updated dependencies [5524f84]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [307e0fe]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [5602211]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [aff9e56]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [65ac468]
- Updated dependencies [ef5e72d]
- Updated dependencies [dac6a08]
- Updated dependencies [313d7be]
- Updated dependencies [5faeac6]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
- Updated dependencies [0045682]
- Updated dependencies [7180ed5]
- Updated dependencies [083c414]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [fc5f126]
- Updated dependencies [adabaa8]
- Updated dependencies [030125b]
- Updated dependencies [605c23f]
- Updated dependencies [67452d1]
- Updated dependencies [9bf4588]
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
- Updated dependencies [db48ad5]
- Updated dependencies [8e08bc3]
- Updated dependencies [16adb3c]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [bbd902d]
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
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [d318b24]
- Updated dependencies [1659072]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [5cfd4d5]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [647ec8b]
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [a629074]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/objectql@17.0.0-rc.0
  - @objectstack/rest@17.0.0-rc.0
  - @objectstack/runtime@17.0.0-rc.0
  - @objectstack/plugin-auth@17.0.0-rc.0
  - @objectstack/plugin-security@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/plugin-hono-server@17.0.0-rc.0
  - @objectstack/service-analytics@17.0.0-rc.0
  - @objectstack/service-automation@17.0.0-rc.0
  - @objectstack/service-datasource@17.0.0-rc.0
  - @objectstack/plugin-sharing@17.0.0-rc.0
  - @objectstack/service-settings@17.0.0-rc.0
  - @objectstack/driver-sqlite-wasm@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/service-automation@16.1.0
  - @objectstack/rest@16.1.0
  - @objectstack/plugin-hono-server@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/plugin-auth@16.1.0
  - @objectstack/plugin-security@16.1.0
  - @objectstack/plugin-sharing@16.1.0
  - @objectstack/service-settings@16.1.0
  - @objectstack/objectql@16.1.0
  - @objectstack/driver-sqlite-wasm@16.1.0
  - @objectstack/service-analytics@16.1.0
  - @objectstack/service-datasource@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [a9459e6]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [02eafa5]
- Updated dependencies [deb7e7e]
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
- Updated dependencies [780b4b5]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [616e839]
- Updated dependencies [b320158]
- Updated dependencies [ee0a499]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [f8c1b69]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [1e145eb]
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
  - @objectstack/plugin-security@16.0.0
  - @objectstack/objectql@16.0.0
  - @objectstack/plugin-hono-server@16.0.0
  - @objectstack/service-automation@16.0.0
  - @objectstack/plugin-sharing@16.0.0
  - @objectstack/rest@16.0.0
  - @objectstack/service-analytics@16.0.0
  - @objectstack/plugin-auth@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/driver-sqlite-wasm@16.0.0
  - @objectstack/service-datasource@16.0.0
  - @objectstack/service-settings@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [b320158]
- Updated dependencies [ee0a499]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [f8c1b69]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/rest@16.0.0-rc.1
  - @objectstack/plugin-hono-server@16.0.0-rc.1
  - @objectstack/service-automation@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/plugin-security@16.0.0-rc.1
  - @objectstack/plugin-sharing@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/driver-sqlite-wasm@16.0.0-rc.1
  - @objectstack/plugin-auth@16.0.0-rc.1
  - @objectstack/service-analytics@16.0.0-rc.1
  - @objectstack/service-datasource@16.0.0-rc.1
  - @objectstack/service-settings@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [a9459e6]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [02eafa5]
- Updated dependencies [deb7e7e]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [780b4b5]
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [616e839]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [2049b6a]
- Updated dependencies [beaf2de]
- Updated dependencies [1e145eb]
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
  - @objectstack/plugin-security@16.0.0-rc.0
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/plugin-hono-server@16.0.0-rc.0
  - @objectstack/service-automation@16.0.0-rc.0
  - @objectstack/plugin-sharing@16.0.0-rc.0
  - @objectstack/rest@16.0.0-rc.0
  - @objectstack/service-analytics@16.0.0-rc.0
  - @objectstack/plugin-auth@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/driver-sqlite-wasm@16.0.0-rc.0
  - @objectstack/service-datasource@16.0.0-rc.0
  - @objectstack/service-settings@16.0.0-rc.0

## 15.1.1

### Patch Changes

- Updated dependencies [9dbb883]
- Updated dependencies [01ba3b3]
  - @objectstack/plugin-auth@15.1.1
  - @objectstack/runtime@15.1.1
  - @objectstack/spec@15.1.1
  - @objectstack/core@15.1.1
  - @objectstack/objectql@15.1.1
  - @objectstack/rest@15.1.1
  - @objectstack/driver-sqlite-wasm@15.1.1
  - @objectstack/plugin-hono-server@15.1.1
  - @objectstack/plugin-security@15.1.1
  - @objectstack/plugin-sharing@15.1.1
  - @objectstack/service-analytics@15.1.1
  - @objectstack/service-automation@15.1.1
  - @objectstack/service-datasource@15.1.1
  - @objectstack/service-settings@15.1.1

## 15.1.0

### Minor Changes

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

- Updated dependencies [f531a26]
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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/rest@15.1.0
  - @objectstack/plugin-hono-server@15.1.0
  - @objectstack/service-automation@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/plugin-security@15.1.0
  - @objectstack/plugin-sharing@15.1.0
  - @objectstack/plugin-auth@15.1.0
  - @objectstack/driver-sqlite-wasm@15.1.0
  - @objectstack/service-analytics@15.1.0
  - @objectstack/service-datasource@15.1.0
  - @objectstack/service-settings@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [0fcef9b]
- Updated dependencies [13749ec]
- Updated dependencies [ca2b2f6]
- Updated dependencies [2ae78c6]
- Updated dependencies [5febe3f]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [698454e]
- Updated dependencies [29a4c90]
- Updated dependencies [ef70521]
- Updated dependencies [a581a65]
- Updated dependencies [31d04d4]
- Updated dependencies [5774a75]
  - @objectstack/spec@15.0.0
  - @objectstack/plugin-security@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/runtime@15.0.0
  - @objectstack/rest@15.0.0
  - @objectstack/objectql@15.0.0
  - @objectstack/plugin-auth@15.0.0
  - @objectstack/plugin-sharing@15.0.0
  - @objectstack/service-settings@15.0.0
  - @objectstack/driver-sqlite-wasm@15.0.0
  - @objectstack/plugin-hono-server@15.0.0
  - @objectstack/service-analytics@15.0.0
  - @objectstack/service-automation@15.0.0
  - @objectstack/service-datasource@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [a199626]
- Updated dependencies [607aaf4]
- Updated dependencies [e46169c]
- Updated dependencies [f0acf25]
- Updated dependencies [712328a]
- Updated dependencies [1dede32]
- Updated dependencies [bb71321]
- Updated dependencies [a199626]
  - @objectstack/spec@14.8.0
  - @objectstack/service-automation@14.8.0
  - @objectstack/plugin-security@14.8.0
  - @objectstack/rest@14.8.0
  - @objectstack/driver-sqlite-wasm@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/objectql@14.8.0
  - @objectstack/plugin-auth@14.8.0
  - @objectstack/plugin-hono-server@14.8.0
  - @objectstack/plugin-sharing@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/service-analytics@14.8.0
  - @objectstack/service-datasource@14.8.0
  - @objectstack/service-settings@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [da5e686]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/plugin-sharing@14.7.0
  - @objectstack/plugin-auth@14.7.0
  - @objectstack/plugin-security@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/driver-sqlite-wasm@14.7.0
  - @objectstack/plugin-hono-server@14.7.0
  - @objectstack/rest@14.7.0
  - @objectstack/runtime@14.7.0
  - @objectstack/service-analytics@14.7.0
  - @objectstack/service-automation@14.7.0
  - @objectstack/service-datasource@14.7.0
  - @objectstack/service-settings@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [160d565]
- Updated dependencies [e4cf774]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
- Updated dependencies [6e2b8ae]
  - @objectstack/spec@14.6.0
  - @objectstack/plugin-auth@14.6.0
  - @objectstack/objectql@14.6.0
  - @objectstack/plugin-security@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/driver-sqlite-wasm@14.6.0
  - @objectstack/plugin-hono-server@14.6.0
  - @objectstack/plugin-sharing@14.6.0
  - @objectstack/rest@14.6.0
  - @objectstack/runtime@14.6.0
  - @objectstack/service-analytics@14.6.0
  - @objectstack/service-automation@14.6.0
  - @objectstack/service-datasource@14.6.0
  - @objectstack/service-settings@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [5f43f88]
- Updated dependencies [261aff5]
- Updated dependencies [f70eb2c]
- Updated dependencies [d79ca07]
- Updated dependencies [a348394]
- Updated dependencies [4d9dd7b]
- Updated dependencies [5bced2f]
- Updated dependencies [3fd87b2]
- Updated dependencies [33ebd34]
- Updated dependencies [6da03ee]
- Updated dependencies [e2c05d6]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/service-automation@14.5.0
  - @objectstack/runtime@14.5.0
  - @objectstack/plugin-security@14.5.0
  - @objectstack/plugin-sharing@14.5.0
  - @objectstack/plugin-auth@14.5.0
  - @objectstack/rest@14.5.0
  - @objectstack/objectql@14.5.0
  - @objectstack/plugin-hono-server@14.5.0
  - @objectstack/service-settings@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/driver-sqlite-wasm@14.5.0
  - @objectstack/service-analytics@14.5.0
  - @objectstack/service-datasource@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [9887465]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/driver-sqlite-wasm@14.4.0
  - @objectstack/service-automation@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/plugin-security@14.4.0
  - @objectstack/plugin-sharing@14.4.0
  - @objectstack/plugin-auth@14.4.0
  - @objectstack/plugin-hono-server@14.4.0
  - @objectstack/rest@14.4.0
  - @objectstack/runtime@14.4.0
  - @objectstack/service-analytics@14.4.0
  - @objectstack/service-datasource@14.4.0
  - @objectstack/service-settings@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [8f0b9df]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
- Updated dependencies [bea4b92]
  - @objectstack/plugin-auth@14.3.0
  - @objectstack/rest@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/plugin-security@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/service-settings@14.3.0
  - @objectstack/runtime@14.3.0
  - @objectstack/plugin-sharing@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/driver-sqlite-wasm@14.3.0
  - @objectstack/plugin-hono-server@14.3.0
  - @objectstack/service-analytics@14.3.0
  - @objectstack/service-automation@14.3.0
  - @objectstack/service-datasource@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/plugin-hono-server@14.2.0
  - @objectstack/plugin-security@14.2.0
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/service-datasource@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/objectql@14.2.0
  - @objectstack/driver-sqlite-wasm@14.2.0
  - @objectstack/plugin-auth@14.2.0
  - @objectstack/plugin-sharing@14.2.0
  - @objectstack/rest@14.2.0
  - @objectstack/service-analytics@14.2.0
  - @objectstack/service-automation@14.2.0
  - @objectstack/service-settings@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/driver-sqlite-wasm@14.1.0
  - @objectstack/plugin-auth@14.1.0
  - @objectstack/plugin-hono-server@14.1.0
  - @objectstack/plugin-security@14.1.0
  - @objectstack/plugin-sharing@14.1.0
  - @objectstack/rest@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/service-analytics@14.1.0
  - @objectstack/service-automation@14.1.0
  - @objectstack/service-datasource@14.1.0
  - @objectstack/service-settings@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [57b8fe0]
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [ac08698]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [bc26360]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
- Updated dependencies [bd39dc5]
- Updated dependencies [1056c5f]
  - @objectstack/runtime@14.0.0
  - @objectstack/spec@14.0.0
  - @objectstack/plugin-sharing@14.0.0
  - @objectstack/plugin-security@14.0.0
  - @objectstack/rest@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/driver-sqlite-wasm@14.0.0
  - @objectstack/plugin-auth@14.0.0
  - @objectstack/plugin-hono-server@14.0.0
  - @objectstack/service-analytics@14.0.0
  - @objectstack/service-automation@14.0.0
  - @objectstack/service-datasource@14.0.0
  - @objectstack/service-settings@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [799b285]
- Updated dependencies [b1081b8]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/runtime@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/rest@13.0.0
  - @objectstack/plugin-security@13.0.0
  - @objectstack/plugin-sharing@13.0.0
  - @objectstack/plugin-auth@13.0.0
  - @objectstack/service-automation@13.0.0
  - @objectstack/plugin-hono-server@13.0.0
  - @objectstack/driver-sqlite-wasm@13.0.0
  - @objectstack/service-analytics@13.0.0
  - @objectstack/service-datasource@13.0.0
  - @objectstack/service-settings@13.0.0

## 12.6.0

### Minor Changes

- 3fd3576: Add `checkReadCoercion` — a reusable, driver-agnostic read-coercion conformance
  helper (a stored value must read back as its declared type: boolean as boolean,
  json as object, integer as number). Mirrors `checkLedger`: returns a list of
  problems (empty = conformant) with no test-runner dependency, so any driver —
  including out-of-tree ones like cloud's driver-turso — can run the identical
  contract against itself. This is the invariant behind the case_escalation
  `1 != true` incident.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [c4fd39f]
- Updated dependencies [0adcc1c]
- Updated dependencies [b5a87eb]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/service-settings@12.6.0
  - @objectstack/service-automation@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/rest@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/driver-sqlite-wasm@12.6.0
  - @objectstack/plugin-auth@12.6.0
  - @objectstack/plugin-hono-server@12.6.0
  - @objectstack/plugin-org-scoping@12.6.0
  - @objectstack/plugin-security@12.6.0
  - @objectstack/plugin-sharing@12.6.0
  - @objectstack/service-analytics@12.6.0
  - @objectstack/service-datasource@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/service-automation@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/driver-sqlite-wasm@12.5.0
  - @objectstack/plugin-auth@12.5.0
  - @objectstack/plugin-hono-server@12.5.0
  - @objectstack/plugin-org-scoping@12.5.0
  - @objectstack/plugin-security@12.5.0
  - @objectstack/plugin-sharing@12.5.0
  - @objectstack/rest@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/service-analytics@12.5.0
  - @objectstack/service-datasource@12.5.0
  - @objectstack/service-settings@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/driver-sqlite-wasm@12.4.0
  - @objectstack/plugin-auth@12.4.0
  - @objectstack/plugin-hono-server@12.4.0
  - @objectstack/plugin-org-scoping@12.4.0
  - @objectstack/plugin-security@12.4.0
  - @objectstack/plugin-sharing@12.4.0
  - @objectstack/rest@12.4.0
  - @objectstack/service-analytics@12.4.0
  - @objectstack/service-automation@12.4.0
  - @objectstack/service-datasource@12.4.0
  - @objectstack/service-settings@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/plugin-sharing@12.3.0
  - @objectstack/rest@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/driver-sqlite-wasm@12.3.0
  - @objectstack/plugin-auth@12.3.0
  - @objectstack/plugin-hono-server@12.3.0
  - @objectstack/plugin-org-scoping@12.3.0
  - @objectstack/plugin-security@12.3.0
  - @objectstack/service-analytics@12.3.0
  - @objectstack/service-automation@12.3.0
  - @objectstack/service-datasource@12.3.0
  - @objectstack/service-settings@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/rest@12.2.0
  - @objectstack/spec@12.2.0
  - @objectstack/plugin-security@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/runtime@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/plugin-sharing@12.2.0
  - @objectstack/driver-sqlite-wasm@12.2.0
  - @objectstack/plugin-auth@12.2.0
  - @objectstack/plugin-hono-server@12.2.0
  - @objectstack/plugin-org-scoping@12.2.0
  - @objectstack/service-analytics@12.2.0
  - @objectstack/service-automation@12.2.0
  - @objectstack/service-datasource@12.2.0
  - @objectstack/service-settings@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [8bcd994]
- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/service-automation@12.1.0
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/driver-sqlite-wasm@12.1.0
  - @objectstack/plugin-auth@12.1.0
  - @objectstack/plugin-hono-server@12.1.0
  - @objectstack/plugin-org-scoping@12.1.0
  - @objectstack/plugin-security@12.1.0
  - @objectstack/plugin-sharing@12.1.0
  - @objectstack/rest@12.1.0
  - @objectstack/service-analytics@12.1.0
  - @objectstack/service-datasource@12.1.0
  - @objectstack/service-settings@12.1.0

## 12.0.0

### Patch Changes

- 7c09621: feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

  **BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
  (`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
  `RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
  the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
  deployment explicitly opts out. (Scope note: this gate covers the REST
  `/data/*` surface — the metadata read/write endpoints and the dispatcher
  GraphQL route have their own pre-existing anonymous posture, tracked
  separately; this flip does not change them.)

  **Migration (one line):** a deployment that intentionally serves data publicly
  (demo / playground / kiosk) sets the flag on the stack config — now a declared
  `ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
  parsing (previously an undeclared top-level `api` key was silently stripped):

  ```ts
  export default defineStack({
    // …
    api: { requireAuth: false },
  });
  ```

  The REST plugin logs a boot warning for the explicit opt-out so a fail-open
  posture is always visible. A misplaced `api.requireAuth` at the plugin level
  (one nesting short) is now also called out with a boot warning instead of
  being silently ignored.

  **What keeps working with no action:**

  - **Share links** — validate their token, then read under a system context.
  - **Public forms** — self-authorizing via the declaration-derived
    `publicFormGrant` (create + read-back on the declared target object only);
    no `guest_portal` profile needed.
  - **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
  - **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
    `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
    authenticate against them), with the boot warning.

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [1b1b34e]
- Updated dependencies [9796e7c]
- Updated dependencies [f84f8d5]
- Updated dependencies [9693a36]
- Updated dependencies [ffafb30]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [e3498fb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [48ad533]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/plugin-auth@12.0.0
  - @objectstack/plugin-security@12.0.0
  - @objectstack/service-automation@12.0.0
  - @objectstack/runtime@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/rest@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/driver-sqlite-wasm@12.0.0
  - @objectstack/plugin-hono-server@12.0.0
  - @objectstack/plugin-org-scoping@12.0.0
  - @objectstack/plugin-sharing@12.0.0
  - @objectstack/service-analytics@12.0.0
  - @objectstack/service-datasource@12.0.0
  - @objectstack/service-settings@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/plugin-security@11.10.0
  - @objectstack/plugin-sharing@11.10.0
  - @objectstack/service-automation@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/driver-sqlite-wasm@11.10.0
  - @objectstack/plugin-auth@11.10.0
  - @objectstack/plugin-hono-server@11.10.0
  - @objectstack/plugin-org-scoping@11.10.0
  - @objectstack/rest@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/service-analytics@11.10.0
  - @objectstack/service-datasource@11.10.0
  - @objectstack/service-settings@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/driver-sqlite-wasm@11.9.0
  - @objectstack/plugin-auth@11.9.0
  - @objectstack/plugin-hono-server@11.9.0
  - @objectstack/plugin-org-scoping@11.9.0
  - @objectstack/plugin-security@11.9.0
  - @objectstack/plugin-sharing@11.9.0
  - @objectstack/rest@11.9.0
  - @objectstack/service-analytics@11.9.0
  - @objectstack/service-automation@11.9.0
  - @objectstack/service-datasource@11.9.0
  - @objectstack/service-settings@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/plugin-auth@11.8.0
- @objectstack/plugin-org-scoping@11.8.0
- @objectstack/plugin-security@11.8.0
- @objectstack/plugin-sharing@11.8.0
- @objectstack/rest@11.8.0
- @objectstack/service-settings@11.8.0
- @objectstack/runtime@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/objectql@11.8.0
- @objectstack/driver-sqlite-wasm@11.8.0
- @objectstack/plugin-hono-server@11.8.0
- @objectstack/service-analytics@11.8.0
- @objectstack/service-automation@11.8.0
- @objectstack/service-datasource@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/objectql@11.7.0
  - @objectstack/driver-sqlite-wasm@11.7.0
  - @objectstack/plugin-auth@11.7.0
  - @objectstack/plugin-hono-server@11.7.0
  - @objectstack/plugin-org-scoping@11.7.0
  - @objectstack/plugin-security@11.7.0
  - @objectstack/plugin-sharing@11.7.0
  - @objectstack/rest@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/service-analytics@11.7.0
  - @objectstack/service-automation@11.7.0
  - @objectstack/service-datasource@11.7.0
  - @objectstack/service-settings@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/runtime@11.6.0
- @objectstack/rest@11.6.0
- @objectstack/driver-sqlite-wasm@11.6.0
- @objectstack/plugin-auth@11.6.0
- @objectstack/plugin-hono-server@11.6.0
- @objectstack/plugin-org-scoping@11.6.0
- @objectstack/plugin-security@11.6.0
- @objectstack/plugin-sharing@11.6.0
- @objectstack/service-analytics@11.6.0
- @objectstack/service-automation@11.6.0
- @objectstack/service-datasource@11.6.0
- @objectstack/service-settings@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/driver-sqlite-wasm@11.5.0
  - @objectstack/plugin-auth@11.5.0
  - @objectstack/plugin-hono-server@11.5.0
  - @objectstack/plugin-org-scoping@11.5.0
  - @objectstack/plugin-security@11.5.0
  - @objectstack/plugin-sharing@11.5.0
  - @objectstack/rest@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/service-analytics@11.5.0
  - @objectstack/service-automation@11.5.0
  - @objectstack/service-datasource@11.5.0
  - @objectstack/service-settings@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/driver-sqlite-wasm@11.4.0
  - @objectstack/plugin-auth@11.4.0
  - @objectstack/plugin-hono-server@11.4.0
  - @objectstack/plugin-org-scoping@11.4.0
  - @objectstack/plugin-security@11.4.0
  - @objectstack/plugin-sharing@11.4.0
  - @objectstack/rest@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/service-analytics@11.4.0
  - @objectstack/service-automation@11.4.0
  - @objectstack/service-datasource@11.4.0
  - @objectstack/service-settings@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
- Updated dependencies [59576d0]
  - @objectstack/spec@11.3.0
  - @objectstack/plugin-auth@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/driver-sqlite-wasm@11.3.0
  - @objectstack/plugin-hono-server@11.3.0
  - @objectstack/plugin-org-scoping@11.3.0
  - @objectstack/plugin-security@11.3.0
  - @objectstack/plugin-sharing@11.3.0
  - @objectstack/rest@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/service-analytics@11.3.0
  - @objectstack/service-automation@11.3.0
  - @objectstack/service-datasource@11.3.0
  - @objectstack/service-settings@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/driver-sqlite-wasm@11.2.0
  - @objectstack/plugin-auth@11.2.0
  - @objectstack/plugin-hono-server@11.2.0
  - @objectstack/plugin-org-scoping@11.2.0
  - @objectstack/plugin-security@11.2.0
  - @objectstack/plugin-sharing@11.2.0
  - @objectstack/rest@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/service-analytics@11.2.0
  - @objectstack/service-automation@11.2.0
  - @objectstack/service-datasource@11.2.0
  - @objectstack/service-settings@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [574e7a3]
- Updated dependencies [cbc8c02]
- Updated dependencies [18f9713]
- Updated dependencies [7cf81a7]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [8c84c97]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [13dbcf2]
- Updated dependencies [9ccfcd6]
- Updated dependencies [dc2990f]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
- Updated dependencies [7087cfe]
- Updated dependencies [69ae136]
  - @objectstack/plugin-security@11.1.0
  - @objectstack/plugin-auth@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/service-settings@11.1.0
  - @objectstack/rest@11.1.0
  - @objectstack/runtime@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/plugin-hono-server@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/plugin-org-scoping@11.1.0
  - @objectstack/plugin-sharing@11.1.0
  - @objectstack/driver-sqlite-wasm@11.1.0
  - @objectstack/service-analytics@11.1.0
  - @objectstack/service-automation@11.1.0
  - @objectstack/service-datasource@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [caa3ef4]
- Updated dependencies [22b32c1]
- Updated dependencies [4d99a5c]
- Updated dependencies [21b3208]
- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
- Updated dependencies [910a8f0]
- Updated dependencies [1e8a813]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [4b5ec6e]
- Updated dependencies [b6a4972]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [359c0aa]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [9a810f8]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [a619a3a]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/plugin-auth@11.0.0
  - @objectstack/objectql@11.0.0
  - @objectstack/runtime@11.0.0
  - @objectstack/service-settings@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/service-analytics@11.0.0
  - @objectstack/service-automation@11.0.0
  - @objectstack/rest@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/plugin-sharing@11.0.0
  - @objectstack/plugin-org-scoping@11.0.0
  - @objectstack/plugin-security@11.0.0
  - @objectstack/driver-sqlite-wasm@11.0.0
  - @objectstack/plugin-hono-server@11.0.0
  - @objectstack/service-datasource@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [f73d40a]
- Updated dependencies [211425e]
- Updated dependencies [c121d73]
- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/service-analytics@10.3.0
  - @objectstack/objectql@10.3.0
  - @objectstack/service-settings@10.3.0
  - @objectstack/runtime@10.3.0
  - @objectstack/service-datasource@10.3.0
  - @objectstack/driver-sqlite-wasm@10.3.0
  - @objectstack/plugin-sharing@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/rest@10.3.0
  - @objectstack/plugin-auth@10.3.0
  - @objectstack/plugin-hono-server@10.3.0
  - @objectstack/plugin-org-scoping@10.3.0
  - @objectstack/plugin-security@10.3.0
  - @objectstack/service-automation@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/driver-sqlite-wasm@10.2.0
  - @objectstack/plugin-auth@10.2.0
  - @objectstack/plugin-hono-server@10.2.0
  - @objectstack/plugin-org-scoping@10.2.0
  - @objectstack/plugin-security@10.2.0
  - @objectstack/plugin-sharing@10.2.0
  - @objectstack/rest@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/service-analytics@10.2.0
  - @objectstack/service-automation@10.2.0
  - @objectstack/service-datasource@10.2.0
  - @objectstack/service-settings@10.2.0

## 10.1.0

### Minor Changes

- 49da36e: feat(datasource): reject field.columnName on external objects + drop showcase onEnable bridge (ADR-0062 Phase 4, D7/D8)

  **D7 — reconcile column mapping.** `os compile`/`build` (`validateStackExpressions`)
  now rejects `field.columnName` on a federated (external) object with a corrective
  message: the driver's query pipeline ignores `field.columnName` for external
  objects, so `external.columnMap` is the single authoritative mechanism. Managed
  objects are untouched.

  **D8 — drop the canonical example's driver bridge.** `examples/app-showcase`
  declares its external datasource with **no** `onEnable` driver registration — the
  declared datasource auto-connects at boot (ADR-0062 D1). `onEnable` now only
  provisions the "remote" fixture tables. To cover this end-to-end, the
  `@objectstack/verify` harness wires the datasource-admin plugin (registering the
  `'datasource-connection'` service) when an app declares datasources, so it mirrors
  `objectstack dev`/serve; a new dogfood test reads the federated objects through the
  real REST stack (incl. the `remoteName` remap). `onEnable` + `ctx.drivers.register`
  remains supported as an escape hatch for drivers built dynamically at runtime.

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/service-analytics@10.1.0
  - @objectstack/service-datasource@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/rest@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/driver-sqlite-wasm@10.1.0
  - @objectstack/plugin-auth@10.1.0
  - @objectstack/plugin-hono-server@10.1.0
  - @objectstack/plugin-org-scoping@10.1.0
  - @objectstack/plugin-security@10.1.0
  - @objectstack/plugin-sharing@10.1.0
  - @objectstack/service-automation@10.1.0
  - @objectstack/service-settings@10.1.0

## 10.0.0

### Minor Changes

- ee86099: ADR-0060 P1 — add the reusable conformance-ledger helper. `@objectstack/verify`
  now exports `checkLedger(rows, opts)` + `ConformanceRow`: the static complement to
  its runtime harness, encoding the shared invariants the platform had hand-written
  twice (unique ids / valid state / enforced-has-site / experimental·removed-has-note
  / proof-file-exists / high-risk-has-proof / exactly-one-cover / discover ratchet).
  The ADR-0056 authz and ADR-0058 expression ledgers are refactored onto it.

### Patch Changes

- 0feea92: fix(verify): skip read-only federated (external) objects in CRUD verification.

  `objectstack verify` probe-inserts a record into every object. A federated object
  on an external datasource is read-only unless BOTH the datasource and the object
  opt into writes (ADR-0015 write gate), so that insert is correctly rejected —
  which `verify` was reporting as a `create-failed` runtime failure. `deriveCrudCases`
  now marks such objects `blocked` (skipped), matching the write gate's double
  opt-in rule, so the dogfood gate stays honest while supporting external datasource
  example apps.

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [70609af]
- Updated dependencies [3187952]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [3754f80]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [00c32f2]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/rest@10.0.0
  - @objectstack/plugin-sharing@10.0.0
  - @objectstack/plugin-security@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/service-analytics@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/plugin-hono-server@10.0.0
  - @objectstack/driver-sqlite-wasm@10.0.0
  - @objectstack/plugin-auth@10.0.0
  - @objectstack/plugin-org-scoping@10.0.0
  - @objectstack/service-automation@10.0.0
  - @objectstack/service-settings@10.0.0

## 9.11.0

### Minor Changes

- 4c213c2: Master-detail "controlled by parent" permissions (ADR-0055).

  A detail object can now declare `sharingModel: 'controlled_by_parent'`: its read/write access is derived from its master record, with no authored RLS.

  - `@objectstack/spec`: `controlled_by_parent` added to the authorable `object.sharingModel` enum.
  - `@objectstack/plugin-security`: reads inject `masterFK IN (accessible master ids)` (resolved from the master's own RLS, reusing the existing filter machinery — zero RLS-compiler changes); by-id writes (insert/update/delete) to a detail now require edit access to its master, closing the #1994-class by-id hole for derived access.
  - `@objectstack/verify`: related-record **topological synthesis** — `deriveCrudCases` no longer skips objects with required relations; it builds the object dependency graph, orders it topologically, and threads real target ids, so relationship-dense objects (and the master-detail RLS proof) are verifiable. Honest `blocked` verdicts remain for required-reference cycles and external/missing targets.

  v1 limits (per ADR-0055): the accessible-master id set is unbounded (large-tenant scale is a documented future limit), and master-detail chains are single-level (not transitively traversed).

- a8e4f3b: `bootStack` gains an opt-in `automation` boot option. When set, it registers `@objectstack/service-automation` so the app's authored flows are pulled from the registry and `POST /api/v1/automation/:name/trigger` actually executes their nodes against the real in-process stack. This makes flow-node execution + variable wiring verifiable end-to-end (ADR-0054 Phase 2), mirroring the existing `multiTenant` opt-in. Default is `false`, so the standard boot stays lean for apps that don't exercise flows.
- fd2e1a2: Add `@objectstack/verify` — boot any ObjectStack app in-process and verify it through the real HTTP stack: auto-derived CRUD round-trip fidelity (`runCrudVerification`) plus the cross-owner RLS invariant (`runRlsProofs`, "you can't write what you can't read"). Also adds an `objectstack verify` CLI command that runs these proofs against an app config and exits non-zero on real failures.

  Extracted from the internal dogfood regression gate so third-party and template authors can run the same runtime proofs against their own apps. The private `@objectstack/dogfood` package now consumes this library for its golden regression tests.

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [e7f6539]
- Updated dependencies [fa8964d]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [751f5cf]
- Updated dependencies [5a5a9fe]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/plugin-sharing@9.11.0
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/driver-sqlite-wasm@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/service-analytics@9.11.0
  - @objectstack/service-automation@9.11.0
  - @objectstack/service-settings@9.11.0
