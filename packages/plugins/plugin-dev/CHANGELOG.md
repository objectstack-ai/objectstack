# @objectstack/plugin-dev

## 17.1.0

### Patch Changes

- 7552e03: fix(plugin-dev): ask the published `security` service — in `start()` — whether anything is enforcing, so the "RBAC/RLS/masking are NOT enforced" warning can fire in the state it describes (#10036)
  
  DevPlugin's security warning probed `security.permissions` / `security.rls` /
  `security.fieldMasker` from `init()`. Both halves were wrong, and wrong in the
  direction that is hardest to notice — silence read as health.
  
  **Wrong signal.** Those three are `SecurityPlugin.init()` registrations. The
  `ISecurityService` contract in `@objectstack/spec` names them "implementation
  internals and deliberately NOT part of this contract"; the published `security`
  service is the contract. Their presence answers "is SecurityPlugin loaded?",
  not "is anything being enforced?" — and the two answers come apart at
  `SecurityPlugin.start()`, which returns early (when `objectql`/`metadata` will
  not resolve, and when the engine cannot take middleware) **before** it publishes
  `security` and before it registers a single enforcement middleware. A stack in
  that state holds all three internal handles and enforces nothing, so the warning
  stayed silent in the one state where its own text is literally true.
  
  **Wrong phase.** `security` is registered in `SecurityPlugin.start()`, which
  DevPlugin runs in its own `start()`. Probing it from `init()` would find it
  absent on *every* stack, healthy ones included — so swapping only the service
  name turns a false negative into a permanent false positive. The check now runs
  after the child-start loop, in the boot banner an operator actually reads
  (the placement #3900 already established for the production-override brand).
  
  Observable behaviour change, both directions:
  
  - A stack whose `SecurityPlugin.start()` bailed now gets a warning that names
    that state ("LOADED but did not finish starting"), where it previously got
    silence. The internal handles keep their one honest use — telling "never
    loaded" apart from "loaded, then failed to start" — so the operator is
    pointed at the right fix.
  - The absent-plugin warning is unchanged in meaning and wording, but is now
    emitted from `start()` rather than `init()`.
  
  This is the same move #10035 made for the other consumer this signal misled
  (`plugin-hono-server`'s `/auth/me/permissions` and `/me/apps`). Two consumers,
  two packages, one misread — a property of the signal, not of either reader.
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
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [ca2e020]
- Updated dependencies [720ee95]
- Updated dependencies [e717ba1]
- Updated dependencies [f287435]
- Updated dependencies [e7bccaa]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [e374b4d]
- Updated dependencies [5047cb8]
- Updated dependencies [ed4ca59]
- Updated dependencies [445ae4d]
- Updated dependencies [a433122]
- Updated dependencies [bc6434b]
- Updated dependencies [96f397a]
- Updated dependencies [9aa8890]
- Updated dependencies [48032c9]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
- Updated dependencies [a751f7d]
- Updated dependencies [eccb8b2]
- Updated dependencies [650cd3d]
- Updated dependencies [b735507]
- Updated dependencies [91c6c28]
- Updated dependencies [75b7c24]
- Updated dependencies [cf0d902]
- Updated dependencies [498f4e8]
- Updated dependencies [cc5c07b]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [4c178c1]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [6a51704]
- Updated dependencies [2d0af57]
- Updated dependencies [c1731d0]
- Updated dependencies [c766ec3]
- Updated dependencies [7337f30]
- Updated dependencies [420804d]
- Updated dependencies [8656d67]
- Updated dependencies [51a46a4]
- Updated dependencies [c8e85fc]
- Updated dependencies [3d61924]
- Updated dependencies [5244fd7]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [e9534a4]
- Updated dependencies [6feac91]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [b2789ad]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [4ea921c]
- Updated dependencies [42b05af]
- Updated dependencies [0ccea4a]
- Updated dependencies [3ab2488]
- Updated dependencies [2b292ce]
- Updated dependencies [185c7bd]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [66dbec4]
- Updated dependencies [6aceca9]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [45862a5]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [152bff8]
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
- Updated dependencies [4e71ae1]
- Updated dependencies [739fe5b]
- Updated dependencies [20067c5]
- Updated dependencies [5ed8ee6]
- Updated dependencies [e783e16]
- Updated dependencies [4bfe1a5]
- Updated dependencies [b537855]
- Updated dependencies [2065e31]
- Updated dependencies [6cb88d9]
- Updated dependencies [b69d0f5]
- Updated dependencies [4dc8a61]
- Updated dependencies [4d47afe]
- Updated dependencies [4fc4a3c]
- Updated dependencies [e4e5c6e]
- Updated dependencies [4dfa369]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [5e2f594]
- Updated dependencies [e2899f6]
- Updated dependencies [bbd86ed]
- Updated dependencies [b6c7690]
- Updated dependencies [2a6ebaf]
- Updated dependencies [855591f]
- Updated dependencies [17854cb]
- Updated dependencies [e6e1de4]
- Updated dependencies [6a12e5e]
- Updated dependencies [3851f87]
- Updated dependencies [09b880b]
- Updated dependencies [c73eacd]
- Updated dependencies [712e185]
- Updated dependencies [88e1bac]
- Updated dependencies [693c788]
- Updated dependencies [2a29caa]
- Updated dependencies [9e2e682]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [0425db9]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [326f5de]
- Updated dependencies [30d3752]
- Updated dependencies [21995d7]
- Updated dependencies [c80e7ae]
- Updated dependencies [499f55e]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [6a5e6ad]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [c86799f]
- Updated dependencies [03fa4c9]
- Updated dependencies [5989b0d]
- Updated dependencies [19db5fa]
- Updated dependencies [8f266f1]
- Updated dependencies [2b9d33a]
- Updated dependencies [ad217b1]
- Updated dependencies [f01c0ee]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [b5f6b26]
- Updated dependencies [04f8fdb]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [b2a451f]
- Updated dependencies [c25b2d5]
- Updated dependencies [147eadc]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [7c2f386]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [8a9e7f4]
- Updated dependencies [3d0ded8]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [1258dca]
- Updated dependencies [4639cec]
- Updated dependencies [91c4ff5]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
- Updated dependencies [682b86b]
- Updated dependencies [6a1b45e]
  - @objectstack/spec@17.1.0
  - @objectstack/plugin-auth@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/runtime@17.1.0
  - @objectstack/plugin-security@17.1.0
  - @objectstack/rest@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/objectql@17.1.0
  - @objectstack/plugin-hono-server@17.1.0
  - @objectstack/driver-memory@17.1.0
  - @objectstack/service-storage@17.1.0
  - @objectstack/service-i18n@17.1.0
  - @objectstack/account@17.1.0
  - @objectstack/setup@17.1.0
  - @objectstack/service-realtime@17.1.0

## 17.0.0

### Minor Changes

- 4dc14cc: Retire the three `security.*` dev stubs, and refuse to load `plugin-dev` under `NODE_ENV=production` (#4093).

  **The security stubs are gone.** When `@objectstack/plugin-security` was not installed, `plugin-dev` filled its three slots with fakes that inverted the decision each stood in for: `security.permissions.checkObjectPermission()` returned `true` for everything, `security.rls.compileFilter()` returned `null` so no row-level predicate was applied, and `security.fieldMasker.maskResults()` returned rows unmasked. ADR-0076 D12's rule — learned from the analytics shim it retired in #3891 — is that a fallback may degrade features, **never security semantics**; `packages/spec/src/contracts/security-service.ts` says the same from the other side (these three are plugin-security's internals, and access-narrowing answers must fail CLOSED). Since `plugin-dev` loads SecurityPlugin through the same optional dynamic import as everything else, the package merely being absent was enough to swap real RBAC/RLS/masking for allow-all behind a single `warn` line.

  The slots now stay empty — which is what production has without SecurityPlugin, and what every consumer already handles — and the boot log states plainly that RBAC, row-level security and field masking are not being enforced.

  **`plugin-dev` now refuses to initialize under `NODE_ENV=production`.** It is a published package that registers development fakes for every unclaimed core service slot, including ones that report success for work they never did, and it had no environment check of its own: an `objectstack.config.ts` carrying `new DevPlugin()` into a production deploy got the whole fake slate with only a boot log to say so. `init()` now throws there. Set `OS_ALLOW_DEV_PLUGIN=1` if you deliberately want the dev slate under a production `NODE_ENV` (a staging box mimicking prod, a smoke test that pins the variable).

  FROM → TO: a stack that relied on the dev security stubs was not being protected by them — it was being told everything was allowed. Install `@objectstack/plugin-security` to enforce RBAC/RLS/masking, or accept the empty slots (unchanged behaviour on every path that already handled an absent SecurityPlugin). A production process that loaded `plugin-dev` must now either drop it and install the real services, or opt in explicitly with `OS_ALLOW_DEV_PLUGIN=1`.

  Also: `plugin-hono-server`'s `/auth/me/permissions` resolves `security.permissions` and `metadata` through the same guarded lookup its three sibling lookups already used. An unregistered slot makes `getService` throw, which previously landed in the outer catch — the same fail-open response body, but logged as "/auth/me/permissions failed" on every console navigation instead of taking the deliberate `!evaluator` branch.

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

- d0d7464: feat(plugin-dev)!: the stub table is retired — DevPlugin assembles real plugins and registers no service implementations of its own (ADR-0115, #4093, #4104).

  DevPlugin used to fill every core-service slot no real plugin occupied with a dev stub. Every one of those stubs is gone. A slot nothing fills now stays EMPTY, exactly as in production: routes answer 404/501, discovery reports `unavailable`, and in-process consumers must handle absence — which production already required of them. FROM → TO per retired slot:

  | Slot                               | The stub did                                                | Instead                                                                                                                                                                                                                                   |
  | :--------------------------------- | :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `security.permissions`             | allow-all `checkObjectPermission()`                         | install `@objectstack/plugin-security` (already part of the default assembly)                                                                                                                                                             |
  | `security.rls`                     | compiled no row filter                                      | same — `plugin-security`                                                                                                                                                                                                                  |
  | `security.fieldMasker`             | returned results unmasked                                   | same — `plugin-security`                                                                                                                                                                                                                  |
  | `auth`                             | `verify()` accepted everyone as admin                       | install `@objectstack/plugin-auth` (already part of the default assembly)                                                                                                                                                                 |
  | `data`                             | accepted writes, stored nothing                             | install `@objectstack/objectql` (already part of the default assembly)                                                                                                                                                                    |
  | `ui`                               | shapeless `{}` placeholder                                  | nothing consumed it; handle the absent slot                                                                                                                                                                                               |
  | `ai`                               | placeholder chat/complete answers                           | install a real AI service                                                                                                                                                                                                                 |
  | `automation`                       | `execute()` reported success without running                | install an automation engine plugin                                                                                                                                                                                                       |
  | `notification`                     | claimed "sent", delivered nothing                           | install a notification service                                                                                                                                                                                                            |
  | `file-storage`                     | in-memory files lost on restart                             | `@objectstack/service-storage` — now auto-wired by DevPlugin when installed (local-disk adapter)                                                                                                                                          |
  | `realtime`                         | in-process pub/sub copy                                     | `@objectstack/service-realtime` — now auto-wired by DevPlugin when installed (its default in-memory adapter)                                                                                                                              |
  | `search`                           | in-memory substring index                                   | no consumer resolves this slot; a future search service ships its own dev strategy                                                                                                                                                        |
  | `workflow`                         | unvalidated state transitions                               | no consumer resolves this slot; a future workflow service ships its own dev strategy                                                                                                                                                      |
  | `metadata`                         | a second hand-written copy of core's `createMemoryMetadata` | no behavior change — the kernel pre-injects core's fallback for empty core slots (`CORE_FALLBACK_FACTORIES`), and ObjectQL registers the real metadata service in the default assembly                                                    |
  | `cache` / `queue` / `job` / `i18n` | re-registered core's `createMemory*` fallbacks              | no behavior change — the kernel pre-injects the same core fallbacks automatically; install `@objectstack/service-cache` / `service-queue` / `service-job` for real engines, and i18n auto-wires from the stack's translations (unchanged) |

  Also new, from the same ADR:

  - **Production guard** (first shipped with the security-trio subset): `DevPlugin.init()` throws when `NODE_ENV === 'production'` — the assembly is built around a well-known default auth secret and a seeded dev admin. Escape hatch: `OS_ALLOW_DEV_PLUGIN=1`.
  - **Assembly auto-wire**: `@objectstack/service-storage` and `@objectstack/service-realtime` are wired as optional child plugins when installed (both ship with DevPlugin's dependencies), so dev keeps working file storage and realtime through real implementations.
  - `options.services` keys for the retired stubs are accepted and ignored; `'file-storage'` / `'realtime'` now toggle the real service wiring.

  One-line fix for an upgrading stack: if something you called in dev now throws "service not found" or 404s, that call was consuming a fabricated answer — install the real service for that slot (table above), or make the caller tolerate absence the way it already must in production.

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

- 22f0daa: fix(plugin-dev): a service that IS installed and fails to construct is no longer reported as "not installed" (#7926)

  Every optional-service load in `DevPlugin.init()` ended in a bare `catch {}`
  whose only act was to warn that the package was **not installed**. So any
  failure at all — a bad config, a missing peer, a deliberate refusal, a genuine
  bug in a constructor — came out as an absent package, and the operator went off
  to install something they already had.

  The measured instance (#6915 / PR #7924): `InMemoryDriver`'s constructor refuses
  a non-`single` tenancy posture with a message naming the detected posture, both
  env knobs (`OS_TENANCY_POSTURE` / `OS_MULTI_ORG_ENABLED`) and the
  `@objectstack/driver-sql` remedy including `connection: { filename: ':memory:' }`.
  Under `OS_TENANCY_POSTURE=isolated` an operator saw none of it — only
  `✘ @objectstack/runtime or @objectstack/driver-memory not installed — skipping
driver`. A well-written refusal replaced by a false diagnosis, which is the
  shape Prime Directive #10 forbids.

  Each `catch` now binds the error and tells the two cases apart:

  - **Absent** — today's wording and today's advice, unchanged, plus the
    resolver's own message. That last part matters for the case the code alone
    cannot separate: a package that resolves but whose _own_ dependency does not
    raises the same code, and the appended message names the specifier that
    actually failed, so "install X" stays actionable.
  - **Present but failed** — a distinct line at `error` level that says the
    package **is** installed, states that installing it again will not help, and
    carries the underlying `code` and `message` verbatim.

  The classifier is the module system's own resolution verdict —
  `ERR_MODULE_NOT_FOUND` from the ESM loader, `MODULE_NOT_FOUND` from the CJS
  build's `require()`, both measured on node v22 rather than assumed — never a
  match against message text. It reads no plugin's private refusal semantics, so
  it does not compete with the "which stage threw" classifier the organizations
  block uses one screen below.

  The code is read through the error's `cause` chain, because a loader failure
  does not always arrive bare: a host that transforms modules can hand back its
  own error with the real one on `cause`. The **outermost** error carrying a
  `code` decides, so a plugin's typed refusal is never re-read as a resolution
  failure just because something deeper in its chain happens to be one.

  Fixed at all eleven optional loads (objectql, driver, app metadata, i18n,
  storage, realtime, auth, the setup/account app packages, security, REST,
  dispatcher). The REST site differed and is handled on its own terms: its `#3963`
  no-auth precondition was a `throw` _inside_ the load `try`, so DevPlugin's own
  refusal to serve a data API without auth was reported as
  `ℹ @objectstack/rest not installed` at debug level. That check now runs before
  the import and reports itself.

  Behaviour is otherwise unchanged: a failed slot stays empty and `init()` still
  returns. Whether DevPlugin should refuse to start when a driver refuses is a
  product-shape question and is deliberately not decided here.

- 2a37694: fix(plugin-dev,types): the production escape hatch stops being silent (#3900)

  `DevPlugin.init()` refuses to run under `NODE_ENV=production` (ADR-0115 D6), and
  `OS_ALLOW_DEV_PLUGIN` overrides that refusal. As shipped, the override returned
  early with **no output at all**: the process ran the development assembly while
  every log line and the ready banner read like an ordinary production start.

  That reproduces, one level up, the defect the guard exists to close. The guard's
  own precedent says so — `OS_ALLOW_DEGRADED_TENANCY` boots degraded _and brands
  it everywhere an operator looks_, and `OS_ALLOW_DRIVER_CONNECT_FAILURE`'s
  contract is "logged loudly at startup". An escape hatch that says nothing leaves
  the operator's only evidence of a degraded state in an env var they may not have
  set themselves.

  **The override now brands itself, twice.** A warning at `init()` — emitted
  before any assembly work, so it survives an assembly step that later throws —
  and a repeat on the ready banner, which is the surface an operator actually
  reads:

  ```
  ⚠ DEV ASSEMBLY UNDER NODE_ENV=production (OS_ALLOW_DEV_PLUGIN is set) — the boot
    guard was explicitly overridden. This process is running the DEVELOPMENT
    assembly, which is not hardened for production traffic (ADR-0115 D6).
      • Auth secret is the default published inside @objectstack/plugin-dev. It is
        public, so anyone can mint a session this stack accepts. Pass `authSecret`
        explicitly.
      • Data goes to the in-memory driver with persistence disabled — every record
        is lost when this process exits.
  ```

  Only hazards that are live for _that_ configuration are named: the secret line
  is suppressed when the operator passed their own `authSecret`, and the driver
  line when the `driver` toggle is off. The dev-admin seed is deliberately absent
  — `plugin-auth`'s `maybeSeedDevAdmin` is hard-gated to
  `NODE_ENV === 'development'` and cannot fire on this path, so warning about it
  would spend the attention the real hazards need.

  **New export — `resolveAllowDevPlugin()` (`@objectstack/types`).** The flag moves
  off a bare `process.env['OS_ALLOW_DEV_PLUGIN'] === '1'` and joins the
  `OS_ALLOW_*` family's shared truthy vocabulary, next to
  `resolveAllowDegradedTenancy` / `resolveAllowDriverConnectFailure`.

  FROM → TO for operators: `OS_ALLOW_DEV_PLUGIN=1` keeps working unchanged.
  `OS_ALLOW_DEV_PLUGIN=true` (and `on` / `yes`, case-insensitive, surrounding
  whitespace ignored) **now takes effect** where the strict comparison previously
  ignored it and failed the boot. That is a widening, in the direction an operator
  setting the flag already intended; falsy and unrecognised values still refuse to
  boot, and unset still means "fail fast". If you were relying on
  `OS_ALLOW_DEV_PLUGIN=true` being inert as a way to keep the guard armed, unset
  the variable instead.

  No change to the refusal path, which this issue re-verified end to end:
  `kernel.use()` only registers, `initPluginWithTimeout` does not catch,
  `bootstrap()` rethrows, and `os serve`'s outer handler prints the message and
  exits `1`. The `throw` is genuinely fatal here, so it needs none of the
  `process.exit(1)` the tenancy guard required for sitting inside a broad `catch`.

- 45dc446: Every in-memory fallback and dev stub now self-describes with the standard `__serviceInfo` descriptor, classified by what it actually is (#4058 step 1).

  ADR-0076 D12 gave services one way to say "I am not the real thing", but the producers never converged on it:

  - The kernel's own fallbacks (`createMemoryCache` / `Queue` / `Job` / `I18n` / `Metadata`) carried `_fallback: true` — a marker **no** consumer recognized, `readServiceSelfInfo` included — so both discovery builders reported them as fully `available`.
  - `plugin-dev` marked all of its implementations with the same `_dev: true`, normalized to `status: 'stub', handlerReady: false`. That declared a working in-memory search index exactly as fake as an AI stub returning invented text.

  Both now carry `__serviceInfo`, split by a rule that holds across the whole set:

  - **`degraded`** — really does the work, with reduced capability: `cache`, `queue`, `job`, `file-storage`, `search`, `i18n`, `metadata`, `workflow`, `realtime`. Its answers are true answers; the `message` names what is missing (no persistence, no scheduling timer, no state-machine validation, …).
  - **`stub`** — the answer is fabricated: `ai`, `automation`, `notification`, `data`, `auth`, `security.permissions`, `security.rls`, `security.fieldMasker`. Never to be mistaken for a capability.

  `handlerReady: false` is set independently wherever no HTTP handler serves the slot (`cache` / `queue` / `job` / `realtime`, and every `stub`).

  Discovery output changes accordingly — a kernel fallback that used to report `status: 'available'` now reports `degraded` with an explanatory message. No routing, gating, or dispatch behavior changes: every dispatcher domain still resolves services exactly as before. Consumers reading `discovery.services.*` get the truth instead of a uniform claim.

  For anything that duck-typed the old markers: `svc._fallback` / `svc._dev` → `readServiceSelfInfo(svc)` from `@objectstack/spec/api` (the legacy `_dev` key is still understood by that reader, so third-party stubs carrying it keep working).

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

- 7309c81: fix(driver-memory,spec): persistence is opt-in again — `new InMemoryDriver()` is pure in-memory (#4065)

  `InMemoryDriverConfig.persistence` defaulted to `'auto'`, and in Node.js `'auto'`
  means **file**. So a bare `new InMemoryDriver()` — the shape every caller in this
  repo used — silently wrote `.objectstack/data/memory-driver.json` into the process
  CWD and reloaded it on the next boot. The default is now `false`.

  **This restores the accepted design rather than replacing it.** #815, the issue
  that introduced the persistence capability, specified it as opt-in in requirement
  \#1 — "默认情况下不启用持久化（纯内存，行为不变）" — and listed
  `new InMemoryDriver()` under "纯内存" in its own config examples. The `'auto'`
  default was a drift from that spec.

  What let the drift survive is worth naming, because it is not "there was no
  test". `MemoryConfigSchema` _did_ pin the default, and asserted `'auto'`; the
  driver honoured `'auto'`; so spec and implementation agreed, and the pair looked
  verified. What nothing checked was whether the value they agreed on was the one
  #815 accepted. The driver's own `persistence.test.ts` could not have caught it
  either — every case there passes `persistence` explicitly, so the omitted-value
  path was untested on the implementation side. Both sides are now covered: three
  behavioural tests in `persistence.test.ts` (no CWD write, no cross-instance row
  carry-over, opt-in still persists) and the flipped schema assertion.

  **The symptom this fixes.** `packages/runtime/src/datasource-autoconnect.test.ts`
  seeds two rows with fixed ids and asserts the exact set. Run 1 passed and wrote
  the rows to disk; run 2 loaded them back, appended two more, and failed with four
  rows; run N had 2N. CI never saw it — every job is a fresh clone, so every CI run
  is run 1 — but `pnpm test` twice in one working tree could only ever go green
  once. The persisted file's `created_at` values, one pair per run, were the proof.

  (#4083 fixed that particular suite from the factory side, and its regression
  test is kept as-is. The blast radius was wider than one suite, though: **every**
  bare `new InMemoryDriver()` inherited the default, so any code path constructing
  one directly wrote to its working directory. Unit tests should not have write
  side effects on the CWD at all.)

  **Migrating.** Callers that want durability now ask for it:

  ```ts
  new InMemoryDriver(); // pure in-memory (new default)
  new InMemoryDriver({ persistence: "file" }); // Node.js, durable across restarts
  new InMemoryDriver({ persistence: "local" }); // browser, durable across reloads
  new InMemoryDriver({ persistence: "auto" }); // previous default behaviour
  ```

  The `'auto'` / `'file'` / `'local'` / custom-adapter paths are unchanged; only
  the value used when `persistence` is omitted moved.

  **Relationship to #4083.** That issue fixed the same hazard one consumer at a
  time, and landed first: `createDefaultDatasourceDriverFactory` now passes
  `persistence: false` for a declared `{ driver: 'memory' }` datasource and scopes
  an opted-in destination _per datasource_, and the dev sqlite step-down's
  last-resort rung passes `false` too. Both are kept exactly as #4083 wrote them.
  This change closes the half they deliberately left open — a directly-constructed
  `new InMemoryDriver()` — which is the path that still wrote into the working
  directory of whatever process happened to build one.

  The two are complementary, not redundant. #4083's per-datasource scoping is
  still the only thing that expands `'auto'`/`'file'`/`'local'` into a destination
  carrying the datasource name, so two pools that DO opt in never alias one file;
  its explicit `false` becomes belt-and-braces, which is the right posture for a
  path that must never persist.

  `DevPlugin`'s driver is now explicitly `persistence: false`, matching the cache,
  queue, job, i18n, storage and search stubs it ships beside — it was the one piece
  of that stack that quietly outlived the process.

  **One claim trimmed, no behaviour attached.** The class docstring called this a
  "production-ready implementation of the ObjectStack Driver Protocol". It stores
  no constraints at all — `create()` is a `table.push()` and `syncSchema()` only
  allocates an array — so there is no primary key, uniqueness, `NOT NULL`, foreign
  key or column typing, and `bulkCreate` lands duplicate ids where a SQL driver
  raises a violation (the second finding in #4065). The docstring now says so, and
  points test authors at in-memory SQLite. Per Prime Directive #10 the fix for
  `declared ≠ enforced` is to implement it, trim the claim, or file it; with this
  driver moving to maintenance-only the claim is what goes.

- 7e791e5: fix(plugin-dev): 请求了组织墙而企业包不可用时拒绝 init,不再只 warn 就无墙跑 (#5301)

  `DevPlugin` 请求了有墙 tenancy posture(`isolated` / `group`)却加载不到企业
  `@objectstack/organizations` 时,只打一条 `logger.warn` 就继续 boot。于是同一台机器上,
  **同一个事实**有两个相反的答案:

  | 入口                | 请求 `isolated`、企业包缺失                      | 结果                              |
  | ------------------- | ------------------------------------------------ | --------------------------------- |
  | `objectstack serve` | 拒绝启动(除非显式 `OS_ALLOW_DEGRADED_TENANCY=1`) | 安全                              |
  | `DevPlugin`(改前)   | warn 后继续                                      | **无墙服务流量**,且没人显式同意过 |

  ADR-0093 D5「请求了隔离就不得在没有隔离的情况下服务流量」是**部署**的性质,不是某一个
  入口的性质,所以 dev 装配路径欠同一个答案。#5262 让这条更容易被触发而不是更难:在它之前,
  只设 `OS_TENANCY_POSTURE` 的 dev 栈根本不进这个分支(那是 #5262 本身的缺陷),修好读数之后
  它会进分支、会加载失败,然后正好走这条 fail-open 的路。

  **改为 `throw`,不是 `process.exit(1)`。** `serve.ts` 必须 `process.exit`,因为它那道闸
  嵌在会吞异常的 AuthPlugin `try` 里;`DevPlugin` 是**库形态**的装配插件,对宿主进程没有处置权,
  嵌入方(测试、脚本、父应用)有权 catch 它。而且它的 boot 链不吞异常——`kernel.use()` 只登记、
  `initPluginWithTimeout` 不 catch、`bootstrap()` 会 rethrow——所以 `throw` 能真的中止 boot,
  与同文件 `assertNotProduction()` 的既有依据一致。

  **照 #4818 分两阶段,两种失败两种诊断:**

  - **阶段 1(import 失败 = 包缺失)**:`OS_ALLOW_DEGRADED_TENANCY` 生效。未设则拒绝 init,
    报文里点名被请求的 posture 和全部出路;设了则照旧 warn 后降级继续,而且这条 warn 仍然
    如实说明墙是 INACTIVE。判定用的是 `resolveAllowDegradedTenancy()`——和 `serve.ts`
    同一个 resolver,所以两个入口对「显式同意」的定义不可能漂移。
  - **阶段 2(construct / init 失败 = 包在、插件自己拒绝)**:hatch **不覆盖**,一律中止。
    该 hatch 的含义始终是「这个能力**缺席**,我接受降级」,而不是「替我越过插件正在执行的闸」;
    让它放行会把插件的许可证/前置条件检查降格成一个环境变量。报文原样转述插件自己的说法,
    框架不解释,并明说这**不是**缺包问题,省掉一轮「去查安装」的排查。

  阶段 2 在 `DevPlugin` 里比 `serve.ts` 多一处落点:`serve` 把插件交给 `kernel.use()`,
  其 Phase-1 循环会 rethrow init 失败;而 `DevPlugin` 自己 init 子插件,那个循环刻意是
  best-effort(记一条 error 继续,dev 栈才能在缺包时照常起)。对这一个子插件,best-effort
  默认就是同一个 fail-open,所以它现在单独例外——其余子插件的容错**完全不变**。

  **迁移。** 只影响「请求了有墙 posture 且企业包不可用」的 dev 栈——此前它静默降级,现在会
  拒绝启动。若确实要在无墙状态下继续跑,显式设 `OS_ALLOW_DEGRADED_TENANCY=1`,与
  `objectstack serve` 的做法一致。单组织(`single` posture,即默认)栈完全不受影响,
  不进这个分支,也不需要这个 hatch。

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

- a3cb9c8: Retire the dev-mode `analytics` stub, and make the dispatcher gate `/analytics` on `handlerReady` rather than on service presence (#4000).

  Retiring the degraded analytics shim (#3891) made an empty `analytics` slot the honest signal: `/api/v1/analytics/*` 404s and discovery reports `unavailable`. `plugin-dev` refilled that slot with a stub, which re-created the retired shape in dev mode — the dispatcher gated on "is a service registered", so the stub was called like a real engine and its empty result came back as a 200.

  - `plugin-dev` no longer registers an `analytics` dev stub; the slot stays empty (`NO_DEV_STUB_SERVICES`). Every other dev stub is unchanged.
  - The `/analytics` domain, its route-mount gate, and discovery's `routes`/`features` now share one predicate (`isAnalyticsServiceServeable`): a service that self-declares `handlerReady: false` (ADR-0076 D12 — `__serviceInfo`, or plugin-dev's legacy `_dev: true`) is treated as an empty slot. A `degraded` implementation that genuinely serves requests keeps serving; `discovery.services.analytics` still reports a registered stub as `status: 'stub'`, which says more than `unavailable` would.

  FROM → TO for dev setups that relied on the stub answering `POST /api/v1/analytics/query` with `{ rows: [], fields: [] }`: install the real engine — `@objectstack/service-analytics` runs an InMemory strategy and needs no database of its own. Nothing else changes; hosts that already install it (including `os serve`, where `analytics` is in `ALWAYS_ON_CAPABILITIES`) are unaffected.

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

- Updated dependencies [c9c2d92]
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
- Updated dependencies [257d97a]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [3ec8186]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [698cbc2]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
- Updated dependencies [99736a0]
- Updated dependencies [134df4f]
- Updated dependencies [fe67e34]
- Updated dependencies [b1863a5]
- Updated dependencies [b1863a5]
- Updated dependencies [3d3fddf]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [735f850]
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
- Updated dependencies [bb1ce2e]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [63f3b87]
- Updated dependencies [c44dd5e]
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
- Updated dependencies [f7df82c]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [c36abfe]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [d085670]
- Updated dependencies [de70b42]
- Updated dependencies [2f6516e]
- Updated dependencies [01c0bae]
- Updated dependencies [b313fde]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [328ccc5]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [3c8cfd1]
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
- Updated dependencies [f92096b]
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
- Updated dependencies [59768f7]
- Updated dependencies [0f8ad09]
- Updated dependencies [ad878e7]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [116c0d9]
- Updated dependencies [a98085f]
- Updated dependencies [2e4274d]
- Updated dependencies [941dec4]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [fec2f0e]
- Updated dependencies [8d895ff]
- Updated dependencies [ea24593]
- Updated dependencies [86f7a20]
- Updated dependencies [7a40b7a]
- Updated dependencies [7cf1531]
- Updated dependencies [f2eb850]
- Updated dependencies [586d6f7]
- Updated dependencies [8bd437f]
- Updated dependencies [5046afe]
- Updated dependencies [984396b]
- Updated dependencies [9f747ee]
- Updated dependencies [d0fea33]
- Updated dependencies [2d14b35]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [f6472d7]
- Updated dependencies [6dcbbc3]
- Updated dependencies [c546c89]
- Updated dependencies [57a3bb3]
- Updated dependencies [627e65a]
- Updated dependencies [4c5df00]
- Updated dependencies [b16dcb4]
- Updated dependencies [22df871]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [c497d26]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [51fb081]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [36c2f00]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [bbdbf28]
- Updated dependencies [93929c2]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [fccec22]
- Updated dependencies [2af1988]
- Updated dependencies [b3a2318]
- Updated dependencies [0af50a3]
- Updated dependencies [f7d80f4]
- Updated dependencies [fce14ab]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [db31402]
- Updated dependencies [a0a206f]
- Updated dependencies [6df5135]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [6af87d7]
- Updated dependencies [7309c81]
- Updated dependencies [d3f2ff6]
- Updated dependencies [b7550d6]
- Updated dependencies [0164f40]
- Updated dependencies [e295ad1]
- Updated dependencies [1003125]
- Updated dependencies [12a19a8]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [3f86a57]
- Updated dependencies [5b843fb]
- Updated dependencies [10c4ea9]
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
- Updated dependencies [846ed1f]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [fae74b5]
- Updated dependencies [4ff8abf]
- Updated dependencies [c931e53]
- Updated dependencies [5c04b2a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [545d931]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [04476e7]
- Updated dependencies [de6b7f1]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [462b713]
- Updated dependencies [36030ff]
- Updated dependencies [e38db3d]
- Updated dependencies [3949a43]
- Updated dependencies [a225ef5]
- Updated dependencies [0a515c8]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [be25f97]
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
- Updated dependencies [366105c]
- Updated dependencies [c9d254a]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [9e8f04d]
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
- Updated dependencies [89e9808]
- Updated dependencies [8e17759]
- Updated dependencies [7bf3d1c]
- Updated dependencies [f4d7f1d]
- Updated dependencies [2ef1807]
- Updated dependencies [c519533]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ce0ca9]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [4dc14cc]
- Updated dependencies [2672f85]
- Updated dependencies [b3de0dd]
- Updated dependencies [fec7848]
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
- Updated dependencies [2b63a00]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [262e40d]
- Updated dependencies [55da611]
- Updated dependencies [d367f03]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [06ba036]
- Updated dependencies [3c628ce]
- Updated dependencies [347f460]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [4c45be1]
- Updated dependencies [18b8eaa]
- Updated dependencies [ac471a0]
- Updated dependencies [6fde910]
- Updated dependencies [60ae58e]
- Updated dependencies [9c82b89]
- Updated dependencies [7f62706]
- Updated dependencies [60cbf9d]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [8a341a4]
- Updated dependencies [78adc2e]
- Updated dependencies [0f17114]
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
- Updated dependencies [96d3d4d]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [b5f9397]
- Updated dependencies [1b2eb1b]
- Updated dependencies [afa6aa5]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [c39d713]
- Updated dependencies [b7d3be4]
- Updated dependencies [afb83d3]
- Updated dependencies [2a0d65e]
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
- Updated dependencies [2b1e37f]
- Updated dependencies [245d1dc]
- Updated dependencies [6029cc1]
- Updated dependencies [4ed7ed4]
- Updated dependencies [d2d6e4c]
- Updated dependencies [ce1f100]
- Updated dependencies [9b9b70f]
- Updated dependencies [f0d6594]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [2ad1eba]
- Updated dependencies [881a3cc]
- Updated dependencies [199ec47]
- Updated dependencies [66360f3]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [05d8a54]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [edff010]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [6f98c2d]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [c892829]
- Updated dependencies [2c19383]
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
- Updated dependencies [d97f2a2]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [307e0fe]
- Updated dependencies [189854c]
- Updated dependencies [d9cac60]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [dfa8bad]
- Updated dependencies [d4720ca]
- Updated dependencies [43ff598]
- Updated dependencies [1fe436d]
- Updated dependencies [7cdbcbb]
- Updated dependencies [e5a4d26]
- Updated dependencies [839982e]
- Updated dependencies [623e555]
- Updated dependencies [0e96e46]
- Updated dependencies [7674859]
- Updated dependencies [c1d44f7]
- Updated dependencies [cb5a75e]
- Updated dependencies [84b6e58]
- Updated dependencies [f160ba4]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [290d944]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [284e7d2]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [127f091]
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
- Updated dependencies [aff9e56]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [889d1b9]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [a92b179]
- Updated dependencies [c3f4916]
- Updated dependencies [65ac468]
- Updated dependencies [ef5e72d]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [9fd9ae7]
- Updated dependencies [3670cf9]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [fce8e49]
- Updated dependencies [313d7be]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [5faeac6]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [5d3ced9]
- Updated dependencies [9fa6bab]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [af05400]
- Updated dependencies [61dc08e]
- Updated dependencies [8dcf607]
- Updated dependencies [ea1d916]
- Updated dependencies [b691ba9]
- Updated dependencies [465c5fc]
- Updated dependencies [36d90fc]
- Updated dependencies [1eadac0]
- Updated dependencies [7777e8f]
- Updated dependencies [c804f19]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b86cf6]
- Updated dependencies [9b26699]
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
- Updated dependencies [dbe92a7]
- Updated dependencies [6146b67]
- Updated dependencies [fc71b84]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [e1fa8d5]
- Updated dependencies [594508e]
- Updated dependencies [07383fe]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [402f534]
- Updated dependencies [99b4392]
- Updated dependencies [591f675]
- Updated dependencies [9e9445b]
- Updated dependencies [3987a48]
- Updated dependencies [f3e26b7]
- Updated dependencies [8e0bb68]
- Updated dependencies [73dc89b]
- Updated dependencies [0045682]
- Updated dependencies [9bf4dd0]
- Updated dependencies [69fde55]
- Updated dependencies [7309c81]
- Updated dependencies [45d5bd2]
- Updated dependencies [60a7a2d]
- Updated dependencies [870f90c]
- Updated dependencies [6ceffe0]
- Updated dependencies [667192b]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [7372d46]
- Updated dependencies [8aacf94]
- Updated dependencies [5e247fd]
- Updated dependencies [a6cd2c1]
- Updated dependencies [fc3a819]
- Updated dependencies [83a3b1f]
- Updated dependencies [2443bb4]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [75fd301]
- Updated dependencies [623d008]
- Updated dependencies [495019b]
- Updated dependencies [54adb1f]
- Updated dependencies [73648ba]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [fdca3a1]
- Updated dependencies [1507ba3]
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
- Updated dependencies [7bc02f4]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [bf42e76]
- Updated dependencies [edbf873]
- Updated dependencies [3208222]
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
- Updated dependencies [1cae606]
- Updated dependencies [4addd9d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [3a27c46]
- Updated dependencies [e3c8ed0]
- Updated dependencies [643b7c7]
- Updated dependencies [fa6dd59]
- Updated dependencies [018d22c]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [55bbefc]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [f1da948]
- Updated dependencies [b9cc17d]
- Updated dependencies [255f2d7]
- Updated dependencies [29308ba]
- Updated dependencies [759a53a]
- Updated dependencies [b4ad984]
- Updated dependencies [00e9196]
- Updated dependencies [bfe689b]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [75f82f3]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [de113a4]
- Updated dependencies [caf144a]
- Updated dependencies [db8c285]
- Updated dependencies [8c767f5]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [0d24078]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [2ee1ab9]
- Updated dependencies [2934761]
- Updated dependencies [b295e4b]
- Updated dependencies [61ea810]
- Updated dependencies [a3c0865]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [de43f94]
- Updated dependencies [5b8f95b]
- Updated dependencies [cb43296]
- Updated dependencies [0d9a779]
- Updated dependencies [91eddca]
- Updated dependencies [b61afc1]
- Updated dependencies [4c31321]
- Updated dependencies [2c81b92]
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
- Updated dependencies [4b0ebdb]
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
- Updated dependencies [be7945a]
- Updated dependencies [d586366]
- Updated dependencies [54fe9d5]
- Updated dependencies [3ac243a]
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
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [37a8f2b]
- Updated dependencies [e50e479]
- Updated dependencies [c41828d]
- Updated dependencies [3fb42d2]
- Updated dependencies [8e08bc3]
- Updated dependencies [441d79f]
- Updated dependencies [59b85c0]
- Updated dependencies [16adb3c]
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
- Updated dependencies [9c5abf4]
- Updated dependencies [dc6abfd]
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [4df747c]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [31fb03d]
- Updated dependencies [47a4e67]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [e98c9d3]
- Updated dependencies [32ff033]
- Updated dependencies [af5918b]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [2c2a212]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [9bc846b]
- Updated dependencies [2cb6d3c]
- Updated dependencies [39396bd]
- Updated dependencies [577cd27]
- Updated dependencies [3ba8d77]
- Updated dependencies [f690747]
- Updated dependencies [bbd902d]
- Updated dependencies [773f80a]
- Updated dependencies [5897552]
- Updated dependencies [d6f3f2f]
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [bf478e1]
- Updated dependencies [dd5daac]
- Updated dependencies [5ac93d4]
- Updated dependencies [2efd2c9]
- Updated dependencies [f3f855a]
- Updated dependencies [3d5f726]
- Updated dependencies [695cfbd]
- Updated dependencies [91ec1ea]
- Updated dependencies [2d25303]
- Updated dependencies [0e043d8]
- Updated dependencies [70a1ce1]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [30f1b74]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [77fadbf]
- Updated dependencies [8dd98bf]
- Updated dependencies [4fedb11]
- Updated dependencies [a3cb9c8]
- Updated dependencies [e87fea1]
- Updated dependencies [4be9d99]
- Updated dependencies [c65e529]
- Updated dependencies [8dcc0f5]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b03b0e1]
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
- Updated dependencies [bf1edef]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [f1a8114]
- Updated dependencies [0931185]
- Updated dependencies [48d5a1c]
- Updated dependencies [cc3555e]
- Updated dependencies [f8fe47e]
- Updated dependencies [9e9445b]
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
- Updated dependencies [1ee48bc]
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
- Updated dependencies [e5fd28c]
- Updated dependencies [a841151]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4e74c18]
- Updated dependencies [8b90d68]
- Updated dependencies [4ac12ef]
- Updated dependencies [478f1fd]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [86d2e5e]
- Updated dependencies [c6a4eeb]
- Updated dependencies [422e97b]
- Updated dependencies [7e04fd0]
- Updated dependencies [d318b24]
- Updated dependencies [21888ab]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [2680cd3]
- Updated dependencies [810a3a2]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [9981c1d]
- Updated dependencies [d60968c]
- Updated dependencies [0c302a7]
- Updated dependencies [b54aaab]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [1e38158]
- Updated dependencies [bd68f08]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [93be029]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [b40f81c]
- Updated dependencies [e474853]
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
- Updated dependencies [1f6ed16]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [1216dcc]
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
- Updated dependencies [e51acd6]
- Updated dependencies [5f0852f]
- Updated dependencies [b41f51a]
- Updated dependencies [ef8b1ff]
- Updated dependencies [6f23667]
- Updated dependencies [cca11e9]
- Updated dependencies [cfb549d]
- Updated dependencies [77a77fd]
- Updated dependencies [d82f8c0]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [1f1edc0]
- Updated dependencies [efcd68c]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [718b229]
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
- Updated dependencies [d56bcdb]
- Updated dependencies [26bb053]
- Updated dependencies [ee3bde1]
- Updated dependencies [098b629]
- Updated dependencies [2053714]
- Updated dependencies [60b672e]
- Updated dependencies [779bab3]
- Updated dependencies [be90dea]
- Updated dependencies [d86815e]
- Updated dependencies [4f99860]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [2a18012]
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
- Updated dependencies [c03108c]
- Updated dependencies [fc5f536]
- Updated dependencies [0a5dc29]
- Updated dependencies [e13fd91]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [7e4783f]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [50185a8]
- Updated dependencies [7309c81]
- Updated dependencies [f8cfbb4]
- Updated dependencies [414083c]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [d6bd5a1]
- Updated dependencies [6e6c872]
- Updated dependencies [c797473]
- Updated dependencies [2bd4e5e]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [488b66c]
- Updated dependencies [148d451]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecf0bef]
- Updated dependencies [68f5ecc]
- Updated dependencies [ecc9110]
- Updated dependencies [a629074]
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
- Updated dependencies [6ad13bb]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [ec5a125]
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
- Updated dependencies [90fa077]
- Updated dependencies [8b50cb3]
- Updated dependencies [551f899]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [54f479a]
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
- Updated dependencies [69a89ce]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [d19fb5c]
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
- Updated dependencies [f46e987]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [e3a6f6e]
- Updated dependencies [c9bf940]
- Updated dependencies [a1dd1e4]
- Updated dependencies [a682670]
- Updated dependencies [dadb43f]
- Updated dependencies [2b52bc8]
- Updated dependencies [3556b67]
  - @objectstack/plugin-auth@17.0.0
  - @objectstack/spec@17.0.0
  - @objectstack/runtime@17.0.0
  - @objectstack/objectql@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/plugin-security@17.0.0
  - @objectstack/rest@17.0.0
  - @objectstack/service-storage@17.0.0
  - @objectstack/driver-memory@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/plugin-hono-server@17.0.0
  - @objectstack/account@17.0.0
  - @objectstack/service-i18n@17.0.0
  - @objectstack/service-realtime@17.0.0
  - @objectstack/setup@17.0.0

## 17.0.0-rc.6

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
- Updated dependencies [63f3b87]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [ad878e7]
- Updated dependencies [43a7a8d]
- Updated dependencies [2e4274d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [3028326]
- Updated dependencies [4c5df00]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [fe2dfa1]
- Updated dependencies [6f6fec7]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [f7d80f4]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [10c4ea9]
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
- Updated dependencies [de6b7f1]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [fec7848]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86e6f6c]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [262e40d]
- Updated dependencies [55da611]
- Updated dependencies [d367f03]
- Updated dependencies [e2798fa]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [6fde910]
- Updated dependencies [9c82b89]
- Updated dependencies [74155c7]
- Updated dependencies [742a6a5]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [b7d3be4]
- Updated dependencies [2a0d65e]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [6029cc1]
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
- Updated dependencies [edb4af0]
- Updated dependencies [f09a2e7]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [1fe436d]
- Updated dependencies [7cdbcbb]
- Updated dependencies [59b794f]
- Updated dependencies [db59e9c]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [55011af]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [a92b179]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [ea1d916]
- Updated dependencies [465c5fc]
- Updated dependencies [c804f19]
- Updated dependencies [9b86cf6]
- Updated dependencies [c51ffa5]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [dbe92a7]
- Updated dependencies [6146b67]
- Updated dependencies [c6b6bb4]
- Updated dependencies [07383fe]
- Updated dependencies [9e9445b]
- Updated dependencies [f3e26b7]
- Updated dependencies [870f90c]
- Updated dependencies [2f59da0]
- Updated dependencies [114e727]
- Updated dependencies [5e247fd]
- Updated dependencies [83a3b1f]
- Updated dependencies [2443bb4]
- Updated dependencies [1a53a02]
- Updated dependencies [623d008]
- Updated dependencies [73648ba]
- Updated dependencies [1507ba3]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [bf42e76]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [8fbed3b]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [bfe689b]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2934761]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [de43f94]
- Updated dependencies [4c31321]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [d586366]
- Updated dependencies [54fe9d5]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [1fa224a]
- Updated dependencies [3fb42d2]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [82397b6]
- Updated dependencies [4df747c]
- Updated dependencies [7084313]
- Updated dependencies [47a4e67]
- Updated dependencies [91cefb8]
- Updated dependencies [2c2a212]
- Updated dependencies [9bc846b]
- Updated dependencies [773f80a]
- Updated dependencies [f3f855a]
- Updated dependencies [0e043d8]
- Updated dependencies [4fedb11]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
- Updated dependencies [9e9445b]
- Updated dependencies [89d7b35]
- Updated dependencies [6155c3c]
- Updated dependencies [d13f627]
- Updated dependencies [e5fd28c]
- Updated dependencies [a841151]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [1788e19]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [0996899]
- Updated dependencies [378d8b1]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [1f6ed16]
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
- Updated dependencies [d86815e]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [e13fd91]
- Updated dependencies [2bd4e5e]
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
- Updated dependencies [d19fb5c]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
- Updated dependencies [c9bf940]
- Updated dependencies [a682670]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/objectql@17.0.0-rc.6
  - @objectstack/plugin-security@17.0.0-rc.6
  - @objectstack/service-storage@17.0.0-rc.6
  - @objectstack/rest@17.0.0-rc.6
  - @objectstack/runtime@17.0.0-rc.6
  - @objectstack/driver-memory@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/plugin-hono-server@17.0.0-rc.6
  - @objectstack/plugin-auth@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/service-i18n@17.0.0-rc.6
  - @objectstack/account@17.0.0-rc.6
  - @objectstack/setup@17.0.0-rc.6
  - @objectstack/service-realtime@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ee3bde1]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
- Updated dependencies [148d451]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/objectql@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/account@17.0.0-rc.5
  - @objectstack/setup@17.0.0-rc.5
  - @objectstack/driver-memory@17.0.0-rc.5
  - @objectstack/plugin-auth@17.0.0-rc.5
  - @objectstack/plugin-hono-server@17.0.0-rc.5
  - @objectstack/plugin-security@17.0.0-rc.5
  - @objectstack/rest@17.0.0-rc.5
  - @objectstack/runtime@17.0.0-rc.5
  - @objectstack/service-i18n@17.0.0-rc.5
  - @objectstack/service-realtime@17.0.0-rc.5
  - @objectstack/service-storage@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- 7e791e5: fix(plugin-dev): 请求了组织墙而企业包不可用时拒绝 init,不再只 warn 就无墙跑 (#5301)

  `DevPlugin` 请求了有墙 tenancy posture(`isolated` / `group`)却加载不到企业
  `@objectstack/organizations` 时,只打一条 `logger.warn` 就继续 boot。于是同一台机器上,
  **同一个事实**有两个相反的答案:

  | 入口                | 请求 `isolated`、企业包缺失                      | 结果                              |
  | ------------------- | ------------------------------------------------ | --------------------------------- |
  | `objectstack serve` | 拒绝启动(除非显式 `OS_ALLOW_DEGRADED_TENANCY=1`) | 安全                              |
  | `DevPlugin`(改前)   | warn 后继续                                      | **无墙服务流量**,且没人显式同意过 |

  ADR-0093 D5「请求了隔离就不得在没有隔离的情况下服务流量」是**部署**的性质,不是某一个
  入口的性质,所以 dev 装配路径欠同一个答案。#5262 让这条更容易被触发而不是更难:在它之前,
  只设 `OS_TENANCY_POSTURE` 的 dev 栈根本不进这个分支(那是 #5262 本身的缺陷),修好读数之后
  它会进分支、会加载失败,然后正好走这条 fail-open 的路。

  **改为 `throw`,不是 `process.exit(1)`。** `serve.ts` 必须 `process.exit`,因为它那道闸
  嵌在会吞异常的 AuthPlugin `try` 里;`DevPlugin` 是**库形态**的装配插件,对宿主进程没有处置权,
  嵌入方(测试、脚本、父应用)有权 catch 它。而且它的 boot 链不吞异常——`kernel.use()` 只登记、
  `initPluginWithTimeout` 不 catch、`bootstrap()` 会 rethrow——所以 `throw` 能真的中止 boot,
  与同文件 `assertNotProduction()` 的既有依据一致。

  **照 #4818 分两阶段,两种失败两种诊断:**

  - **阶段 1(import 失败 = 包缺失)**:`OS_ALLOW_DEGRADED_TENANCY` 生效。未设则拒绝 init,
    报文里点名被请求的 posture 和全部出路;设了则照旧 warn 后降级继续,而且这条 warn 仍然
    如实说明墙是 INACTIVE。判定用的是 `resolveAllowDegradedTenancy()`——和 `serve.ts`
    同一个 resolver,所以两个入口对「显式同意」的定义不可能漂移。
  - **阶段 2(construct / init 失败 = 包在、插件自己拒绝)**:hatch **不覆盖**,一律中止。
    该 hatch 的含义始终是「这个能力**缺席**,我接受降级」,而不是「替我越过插件正在执行的闸」;
    让它放行会把插件的许可证/前置条件检查降格成一个环境变量。报文原样转述插件自己的说法,
    框架不解释,并明说这**不是**缺包问题,省掉一轮「去查安装」的排查。

  阶段 2 在 `DevPlugin` 里比 `serve.ts` 多一处落点:`serve` 把插件交给 `kernel.use()`,
  其 Phase-1 循环会 rethrow init 失败;而 `DevPlugin` 自己 init 子插件,那个循环刻意是
  best-effort(记一条 error 继续,dev 栈才能在缺包时照常起)。对这一个子插件,best-effort
  默认就是同一个 fail-open,所以它现在单独例外——其余子插件的容错**完全不变**。

  **迁移。** 只影响「请求了有墙 posture 且企业包不可用」的 dev 栈——此前它静默降级,现在会
  拒绝启动。若确实要在无墙状态下继续跑,显式设 `OS_ALLOW_DEGRADED_TENANCY=1`,与
  `objectstack serve` 的做法一致。单组织(`single` posture,即默认)栈完全不受影响,
  不进这个分支,也不需要这个 hatch。

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
- Updated dependencies [f7df82c]
- Updated dependencies [978fed2]
- Updated dependencies [c36abfe]
- Updated dependencies [cfc293f]
- Updated dependencies [d085670]
- Updated dependencies [de70b42]
- Updated dependencies [2f6516e]
- Updated dependencies [01c0bae]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [7a40b7a]
- Updated dependencies [7cf1531]
- Updated dependencies [586d6f7]
- Updated dependencies [9f747ee]
- Updated dependencies [2d14b35]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [c497d26]
- Updated dependencies [bbdbf28]
- Updated dependencies [93929c2]
- Updated dependencies [2e284b2]
- Updated dependencies [3905c00]
- Updated dependencies [4335497]
- Updated dependencies [43ca399]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [846ed1f]
- Updated dependencies [947d4f9]
- Updated dependencies [d8f65fe]
- Updated dependencies [58ffcab]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [7bf3d1c]
- Updated dependencies [9ce0ca9]
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
- Updated dependencies [2b63a00]
- Updated dependencies [06ba036]
- Updated dependencies [18b8eaa]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [78adc2e]
- Updated dependencies [0f17114]
- Updated dependencies [81e2744]
- Updated dependencies [277eb36]
- Updated dependencies [41e605e]
- Updated dependencies [2649ccb]
- Updated dependencies [1eb13a0]
- Updated dependencies [a70cd0a]
- Updated dependencies [c52e608]
- Updated dependencies [96d3d4d]
- Updated dependencies [afa6aa5]
- Updated dependencies [afb83d3]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [d97f2a2]
- Updated dependencies [d9cac60]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [dfa8bad]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [290d944]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [5d3ced9]
- Updated dependencies [9fa6bab]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [61dc08e]
- Updated dependencies [8dcf607]
- Updated dependencies [b691ba9]
- Updated dependencies [1eadac0]
- Updated dependencies [7c2f7dd]
- Updated dependencies [9b26699]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [60a7a2d]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [1cae606]
- Updated dependencies [4addd9d]
- Updated dependencies [108ba8d]
- Updated dependencies [b9cc17d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [75f82f3]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [de113a4]
- Updated dependencies [caf144a]
- Updated dependencies [db8c285]
- Updated dependencies [0d24078]
- Updated dependencies [089767f]
- Updated dependencies [5b8f95b]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [ef7845a]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [37a8f2b]
- Updated dependencies [441d79f]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [9c5abf4]
- Updated dependencies [dc6abfd]
- Updated dependencies [39396bd]
- Updated dependencies [577cd27]
- Updated dependencies [5897552]
- Updated dependencies [91ec1ea]
- Updated dependencies [2d25303]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [bf1edef]
- Updated dependencies [7b005b4]
- Updated dependencies [0cd08d5]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [2680cd3]
- Updated dependencies [c5a5996]
- Updated dependencies [b40f81c]
- Updated dependencies [db2ea82]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [1216dcc]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [ef8b1ff]
- Updated dependencies [1f1edc0]
- Updated dependencies [718b229]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [d56bcdb]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [5aaa6fc]
- Updated dependencies [dca5bd3]
- Updated dependencies [488b66c]
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
- Updated dependencies [90fa077]
- Updated dependencies [946a131]
- Updated dependencies [909895d]
- Updated dependencies [c183a12]
- Updated dependencies [69a89ce]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
- Updated dependencies [2b52bc8]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/runtime@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/driver-memory@17.0.0-rc.4
  - @objectstack/rest@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/plugin-hono-server@17.0.0-rc.4
  - @objectstack/plugin-auth@17.0.0-rc.4
  - @objectstack/objectql@17.0.0-rc.4
  - @objectstack/plugin-security@17.0.0-rc.4
  - @objectstack/service-storage@17.0.0-rc.4
  - @objectstack/account@17.0.0-rc.4
  - @objectstack/setup@17.0.0-rc.4
  - @objectstack/service-i18n@17.0.0-rc.4
  - @objectstack/service-realtime@17.0.0-rc.4

## 17.0.0-rc.2

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
- Updated dependencies [328ccc5]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [941dec4]
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
- Updated dependencies [eb4204b]
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
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
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
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/rest@17.0.0-rc.2
  - @objectstack/service-storage@17.0.0-rc.2
  - @objectstack/driver-memory@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/plugin-hono-server@17.0.0-rc.2
  - @objectstack/account@17.0.0-rc.2
  - @objectstack/setup@17.0.0-rc.2
  - @objectstack/service-i18n@17.0.0-rc.2
  - @objectstack/service-realtime@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- 4dc14cc: Retire the three `security.*` dev stubs, and refuse to load `plugin-dev` under `NODE_ENV=production` (#4093).

  **The security stubs are gone.** When `@objectstack/plugin-security` was not installed, `plugin-dev` filled its three slots with fakes that inverted the decision each stood in for: `security.permissions.checkObjectPermission()` returned `true` for everything, `security.rls.compileFilter()` returned `null` so no row-level predicate was applied, and `security.fieldMasker.maskResults()` returned rows unmasked. ADR-0076 D12's rule — learned from the analytics shim it retired in #3891 — is that a fallback may degrade features, **never security semantics**; `packages/spec/src/contracts/security-service.ts` says the same from the other side (these three are plugin-security's internals, and access-narrowing answers must fail CLOSED). Since `plugin-dev` loads SecurityPlugin through the same optional dynamic import as everything else, the package merely being absent was enough to swap real RBAC/RLS/masking for allow-all behind a single `warn` line.

  The slots now stay empty — which is what production has without SecurityPlugin, and what every consumer already handles — and the boot log states plainly that RBAC, row-level security and field masking are not being enforced.

  **`plugin-dev` now refuses to initialize under `NODE_ENV=production`.** It is a published package that registers development fakes for every unclaimed core service slot, including ones that report success for work they never did, and it had no environment check of its own: an `objectstack.config.ts` carrying `new DevPlugin()` into a production deploy got the whole fake slate with only a boot log to say so. `init()` now throws there. Set `OS_ALLOW_DEV_PLUGIN=1` if you deliberately want the dev slate under a production `NODE_ENV` (a staging box mimicking prod, a smoke test that pins the variable).

  FROM → TO: a stack that relied on the dev security stubs was not being protected by them — it was being told everything was allowed. Install `@objectstack/plugin-security` to enforce RBAC/RLS/masking, or accept the empty slots (unchanged behaviour on every path that already handled an absent SecurityPlugin). A production process that loaded `plugin-dev` must now either drop it and install the real services, or opt in explicitly with `OS_ALLOW_DEV_PLUGIN=1`.

  Also: `plugin-hono-server`'s `/auth/me/permissions` resolves `security.permissions` and `metadata` through the same guarded lookup its three sibling lookups already used. An unregistered slot makes `getService` throw, which previously landed in the outer catch — the same fail-open response body, but logged as "/auth/me/permissions failed" on every console navigation instead of taking the deliberate `!evaluator` branch.

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

- d0d7464: feat(plugin-dev)!: the stub table is retired — DevPlugin assembles real plugins and registers no service implementations of its own (ADR-0115, #4093, #4104).

  DevPlugin used to fill every core-service slot no real plugin occupied with a dev stub. Every one of those stubs is gone. A slot nothing fills now stays EMPTY, exactly as in production: routes answer 404/501, discovery reports `unavailable`, and in-process consumers must handle absence — which production already required of them. FROM → TO per retired slot:

  | Slot                               | The stub did                                                | Instead                                                                                                                                                                                                                                   |
  | :--------------------------------- | :---------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `security.permissions`             | allow-all `checkObjectPermission()`                         | install `@objectstack/plugin-security` (already part of the default assembly)                                                                                                                                                             |
  | `security.rls`                     | compiled no row filter                                      | same — `plugin-security`                                                                                                                                                                                                                  |
  | `security.fieldMasker`             | returned results unmasked                                   | same — `plugin-security`                                                                                                                                                                                                                  |
  | `auth`                             | `verify()` accepted everyone as admin                       | install `@objectstack/plugin-auth` (already part of the default assembly)                                                                                                                                                                 |
  | `data`                             | accepted writes, stored nothing                             | install `@objectstack/objectql` (already part of the default assembly)                                                                                                                                                                    |
  | `ui`                               | shapeless `{}` placeholder                                  | nothing consumed it; handle the absent slot                                                                                                                                                                                               |
  | `ai`                               | placeholder chat/complete answers                           | install a real AI service                                                                                                                                                                                                                 |
  | `automation`                       | `execute()` reported success without running                | install an automation engine plugin                                                                                                                                                                                                       |
  | `notification`                     | claimed "sent", delivered nothing                           | install a notification service                                                                                                                                                                                                            |
  | `file-storage`                     | in-memory files lost on restart                             | `@objectstack/service-storage` — now auto-wired by DevPlugin when installed (local-disk adapter)                                                                                                                                          |
  | `realtime`                         | in-process pub/sub copy                                     | `@objectstack/service-realtime` — now auto-wired by DevPlugin when installed (its default in-memory adapter)                                                                                                                              |
  | `search`                           | in-memory substring index                                   | no consumer resolves this slot; a future search service ships its own dev strategy                                                                                                                                                        |
  | `workflow`                         | unvalidated state transitions                               | no consumer resolves this slot; a future workflow service ships its own dev strategy                                                                                                                                                      |
  | `metadata`                         | a second hand-written copy of core's `createMemoryMetadata` | no behavior change — the kernel pre-injects core's fallback for empty core slots (`CORE_FALLBACK_FACTORIES`), and ObjectQL registers the real metadata service in the default assembly                                                    |
  | `cache` / `queue` / `job` / `i18n` | re-registered core's `createMemory*` fallbacks              | no behavior change — the kernel pre-injects the same core fallbacks automatically; install `@objectstack/service-cache` / `service-queue` / `service-job` for real engines, and i18n auto-wires from the stack's translations (unchanged) |

  Also new, from the same ADR:

  - **Production guard** (first shipped with the security-trio subset): `DevPlugin.init()` throws when `NODE_ENV === 'production'` — the assembly is built around a well-known default auth secret and a seeded dev admin. Escape hatch: `OS_ALLOW_DEV_PLUGIN=1`.
  - **Assembly auto-wire**: `@objectstack/service-storage` and `@objectstack/service-realtime` are wired as optional child plugins when installed (both ship with DevPlugin's dependencies), so dev keeps working file storage and realtime through real implementations.
  - `options.services` keys for the retired stubs are accepted and ignored; `'file-storage'` / `'realtime'` now toggle the real service wiring.

  One-line fix for an upgrading stack: if something you called in dev now throws "service not found" or 404s, that call was consuming a fabricated answer — install the real service for that slot (table above), or make the caller tolerate absence the way it already must in production.

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

- 2a37694: fix(plugin-dev,types): the production escape hatch stops being silent (#3900)

  `DevPlugin.init()` refuses to run under `NODE_ENV=production` (ADR-0115 D6), and
  `OS_ALLOW_DEV_PLUGIN` overrides that refusal. As shipped, the override returned
  early with **no output at all**: the process ran the development assembly while
  every log line and the ready banner read like an ordinary production start.

  That reproduces, one level up, the defect the guard exists to close. The guard's
  own precedent says so — `OS_ALLOW_DEGRADED_TENANCY` boots degraded _and brands
  it everywhere an operator looks_, and `OS_ALLOW_DRIVER_CONNECT_FAILURE`'s
  contract is "logged loudly at startup". An escape hatch that says nothing leaves
  the operator's only evidence of a degraded state in an env var they may not have
  set themselves.

  **The override now brands itself, twice.** A warning at `init()` — emitted
  before any assembly work, so it survives an assembly step that later throws —
  and a repeat on the ready banner, which is the surface an operator actually
  reads:

  ```
  ⚠ DEV ASSEMBLY UNDER NODE_ENV=production (OS_ALLOW_DEV_PLUGIN is set) — the boot
    guard was explicitly overridden. This process is running the DEVELOPMENT
    assembly, which is not hardened for production traffic (ADR-0115 D6).
      • Auth secret is the default published inside @objectstack/plugin-dev. It is
        public, so anyone can mint a session this stack accepts. Pass `authSecret`
        explicitly.
      • Data goes to the in-memory driver with persistence disabled — every record
        is lost when this process exits.
  ```

  Only hazards that are live for _that_ configuration are named: the secret line
  is suppressed when the operator passed their own `authSecret`, and the driver
  line when the `driver` toggle is off. The dev-admin seed is deliberately absent
  — `plugin-auth`'s `maybeSeedDevAdmin` is hard-gated to
  `NODE_ENV === 'development'` and cannot fire on this path, so warning about it
  would spend the attention the real hazards need.

  **New export — `resolveAllowDevPlugin()` (`@objectstack/types`).** The flag moves
  off a bare `process.env['OS_ALLOW_DEV_PLUGIN'] === '1'` and joins the
  `OS_ALLOW_*` family's shared truthy vocabulary, next to
  `resolveAllowDegradedTenancy` / `resolveAllowDriverConnectFailure`.

  FROM → TO for operators: `OS_ALLOW_DEV_PLUGIN=1` keeps working unchanged.
  `OS_ALLOW_DEV_PLUGIN=true` (and `on` / `yes`, case-insensitive, surrounding
  whitespace ignored) **now takes effect** where the strict comparison previously
  ignored it and failed the boot. That is a widening, in the direction an operator
  setting the flag already intended; falsy and unrecognised values still refuse to
  boot, and unset still means "fail fast". If you were relying on
  `OS_ALLOW_DEV_PLUGIN=true` being inert as a way to keep the guard armed, unset
  the variable instead.

  No change to the refusal path, which this issue re-verified end to end:
  `kernel.use()` only registers, `initPluginWithTimeout` does not catch,
  `bootstrap()` rethrows, and `os serve`'s outer handler prints the message and
  exits `1`. The `throw` is genuinely fatal here, so it needs none of the
  `process.exit(1)` the tenancy guard required for sitting inside a broad `catch`.

- 45dc446: Every in-memory fallback and dev stub now self-describes with the standard `__serviceInfo` descriptor, classified by what it actually is (#4058 step 1).

  ADR-0076 D12 gave services one way to say "I am not the real thing", but the producers never converged on it:

  - The kernel's own fallbacks (`createMemoryCache` / `Queue` / `Job` / `I18n` / `Metadata`) carried `_fallback: true` — a marker **no** consumer recognized, `readServiceSelfInfo` included — so both discovery builders reported them as fully `available`.
  - `plugin-dev` marked all of its implementations with the same `_dev: true`, normalized to `status: 'stub', handlerReady: false`. That declared a working in-memory search index exactly as fake as an AI stub returning invented text.

  Both now carry `__serviceInfo`, split by a rule that holds across the whole set:

  - **`degraded`** — really does the work, with reduced capability: `cache`, `queue`, `job`, `file-storage`, `search`, `i18n`, `metadata`, `workflow`, `realtime`. Its answers are true answers; the `message` names what is missing (no persistence, no scheduling timer, no state-machine validation, …).
  - **`stub`** — the answer is fabricated: `ai`, `automation`, `notification`, `data`, `auth`, `security.permissions`, `security.rls`, `security.fieldMasker`. Never to be mistaken for a capability.

  `handlerReady: false` is set independently wherever no HTTP handler serves the slot (`cache` / `queue` / `job` / `realtime`, and every `stub`).

  Discovery output changes accordingly — a kernel fallback that used to report `status: 'available'` now reports `degraded` with an explanatory message. No routing, gating, or dispatch behavior changes: every dispatcher domain still resolves services exactly as before. Consumers reading `discovery.services.*` get the truth instead of a uniform claim.

  For anything that duck-typed the old markers: `svc._fallback` / `svc._dev` → `readServiceSelfInfo(svc)` from `@objectstack/spec/api` (the legacy `_dev` key is still understood by that reader, so third-party stubs carrying it keep working).

- 7309c81: fix(driver-memory,spec): persistence is opt-in again — `new InMemoryDriver()` is pure in-memory (#4065)

  `InMemoryDriverConfig.persistence` defaulted to `'auto'`, and in Node.js `'auto'`
  means **file**. So a bare `new InMemoryDriver()` — the shape every caller in this
  repo used — silently wrote `.objectstack/data/memory-driver.json` into the process
  CWD and reloaded it on the next boot. The default is now `false`.

  **This restores the accepted design rather than replacing it.** #815, the issue
  that introduced the persistence capability, specified it as opt-in in requirement
  \#1 — "默认情况下不启用持久化（纯内存，行为不变）" — and listed
  `new InMemoryDriver()` under "纯内存" in its own config examples. The `'auto'`
  default was a drift from that spec.

  What let the drift survive is worth naming, because it is not "there was no
  test". `MemoryConfigSchema` _did_ pin the default, and asserted `'auto'`; the
  driver honoured `'auto'`; so spec and implementation agreed, and the pair looked
  verified. What nothing checked was whether the value they agreed on was the one
  #815 accepted. The driver's own `persistence.test.ts` could not have caught it
  either — every case there passes `persistence` explicitly, so the omitted-value
  path was untested on the implementation side. Both sides are now covered: three
  behavioural tests in `persistence.test.ts` (no CWD write, no cross-instance row
  carry-over, opt-in still persists) and the flipped schema assertion.

  **The symptom this fixes.** `packages/runtime/src/datasource-autoconnect.test.ts`
  seeds two rows with fixed ids and asserts the exact set. Run 1 passed and wrote
  the rows to disk; run 2 loaded them back, appended two more, and failed with four
  rows; run N had 2N. CI never saw it — every job is a fresh clone, so every CI run
  is run 1 — but `pnpm test` twice in one working tree could only ever go green
  once. The persisted file's `created_at` values, one pair per run, were the proof.

  (#4083 fixed that particular suite from the factory side, and its regression
  test is kept as-is. The blast radius was wider than one suite, though: **every**
  bare `new InMemoryDriver()` inherited the default, so any code path constructing
  one directly wrote to its working directory. Unit tests should not have write
  side effects on the CWD at all.)

  **Migrating.** Callers that want durability now ask for it:

  ```ts
  new InMemoryDriver(); // pure in-memory (new default)
  new InMemoryDriver({ persistence: "file" }); // Node.js, durable across restarts
  new InMemoryDriver({ persistence: "local" }); // browser, durable across reloads
  new InMemoryDriver({ persistence: "auto" }); // previous default behaviour
  ```

  The `'auto'` / `'file'` / `'local'` / custom-adapter paths are unchanged; only
  the value used when `persistence` is omitted moved.

  **Relationship to #4083.** That issue fixed the same hazard one consumer at a
  time, and landed first: `createDefaultDatasourceDriverFactory` now passes
  `persistence: false` for a declared `{ driver: 'memory' }` datasource and scopes
  an opted-in destination _per datasource_, and the dev sqlite step-down's
  last-resort rung passes `false` too. Both are kept exactly as #4083 wrote them.
  This change closes the half they deliberately left open — a directly-constructed
  `new InMemoryDriver()` — which is the path that still wrote into the working
  directory of whatever process happened to build one.

  The two are complementary, not redundant. #4083's per-datasource scoping is
  still the only thing that expands `'auto'`/`'file'`/`'local'` into a destination
  carrying the datasource name, so two pools that DO opt in never alias one file;
  its explicit `false` becomes belt-and-braces, which is the right posture for a
  path that must never persist.

  `DevPlugin`'s driver is now explicitly `persistence: false`, matching the cache,
  queue, job, i18n, storage and search stubs it ships beside — it was the one piece
  of that stack that quietly outlived the process.

  **One claim trimmed, no behaviour attached.** The class docstring called this a
  "production-ready implementation of the ObjectStack Driver Protocol". It stores
  no constraints at all — `create()` is a `table.push()` and `syncSchema()` only
  allocates an array — so there is no primary key, uniqueness, `NOT NULL`, foreign
  key or column typing, and `bulkCreate` lands duplicate ids where a SQL driver
  raises a violation (the second finding in #4065). The docstring now says so, and
  points test authors at in-memory SQLite. Per Prime Directive #10 the fix for
  `declared ≠ enforced` is to implement it, trim the claim, or file it; with this
  driver moving to maintenance-only the claim is what goes.

- a3cb9c8: Retire the dev-mode `analytics` stub, and make the dispatcher gate `/analytics` on `handlerReady` rather than on service presence (#4000).

  Retiring the degraded analytics shim (#3891) made an empty `analytics` slot the honest signal: `/api/v1/analytics/*` 404s and discovery reports `unavailable`. `plugin-dev` refilled that slot with a stub, which re-created the retired shape in dev mode — the dispatcher gated on "is a service registered", so the stub was called like a real engine and its empty result came back as a 200.

  - `plugin-dev` no longer registers an `analytics` dev stub; the slot stays empty (`NO_DEV_STUB_SERVICES`). Every other dev stub is unchanged.
  - The `/analytics` domain, its route-mount gate, and discovery's `routes`/`features` now share one predicate (`isAnalyticsServiceServeable`): a service that self-declares `handlerReady: false` (ADR-0076 D12 — `__serviceInfo`, or plugin-dev's legacy `_dev: true`) is treated as an empty slot. A `degraded` implementation that genuinely serves requests keeps serving; `discovery.services.analytics` still reports a registered stub as `status: 'stub'`, which says more than `unavailable` would.

  FROM → TO for dev setups that relied on the stub answering `POST /api/v1/analytics/query` with `{ rows: [], fields: [] }`: install the real engine — `@objectstack/service-analytics` runs an InMemory strategy and needs no database of its own. Nothing else changes; hosts that already install it (including `os serve`, where `analytics` is in `ALWAYS_ON_CAPABILITIES`) are unaffected.

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
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
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
- Updated dependencies [bb1ce2e]
- Updated dependencies [6fa1827]
- Updated dependencies [05154a1]
- Updated dependencies [0f12193]
- Updated dependencies [9b6fe7c]
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
- Updated dependencies [b3a2318]
- Updated dependencies [0af50a3]
- Updated dependencies [fce14ab]
- Updated dependencies [2e836de]
- Updated dependencies [7309c81]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [fae74b5]
- Updated dependencies [545d931]
- Updated dependencies [a225ef5]
- Updated dependencies [366105c]
- Updated dependencies [c9d254a]
- Updated dependencies [c8124e5]
- Updated dependencies [9e8f04d]
- Updated dependencies [c3bcb42]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [f4d7f1d]
- Updated dependencies [2a37694]
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
- Updated dependencies [6f98c2d]
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
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [99b4392]
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
- Updated dependencies [efcd68c]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [2053714]
- Updated dependencies [68dea0b]
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
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/service-storage@17.0.0-rc.1
  - @objectstack/driver-memory@17.0.0-rc.1
  - @objectstack/plugin-security@17.0.0-rc.1
  - @objectstack/rest@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/plugin-auth@17.0.0-rc.1
  - @objectstack/account@17.0.0-rc.1
  - @objectstack/plugin-hono-server@17.0.0-rc.1
  - @objectstack/service-i18n@17.0.0-rc.1
  - @objectstack/service-realtime@17.0.0-rc.1
  - @objectstack/setup@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

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
- Updated dependencies [f92096b]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
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
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [307e0fe]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
- Updated dependencies [0e3a226]
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
- Updated dependencies [f1a8114]
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
- Updated dependencies [bd68f08]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
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
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/plugin-hono-server@17.0.0-rc.0
  - @objectstack/service-i18n@17.0.0-rc.0
  - @objectstack/account@17.0.0-rc.0
  - @objectstack/setup@17.0.0-rc.0
  - @objectstack/driver-memory@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/rest@16.1.0
  - @objectstack/plugin-hono-server@16.1.0
  - @objectstack/runtime@16.1.0
  - @objectstack/account@16.1.0
  - @objectstack/setup@16.1.0
  - @objectstack/plugin-auth@16.1.0
  - @objectstack/plugin-security@16.1.0
  - @objectstack/objectql@16.1.0
  - @objectstack/driver-memory@16.1.0
  - @objectstack/service-i18n@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
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
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [616e839]
- Updated dependencies [ee0a499]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
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
  - @objectstack/rest@16.0.0
  - @objectstack/plugin-auth@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0
  - @objectstack/account@16.0.0
  - @objectstack/setup@16.0.0
  - @objectstack/driver-memory@16.0.0
  - @objectstack/service-i18n@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [ee0a499]
- Updated dependencies [9d897b3]
- Updated dependencies [62a2117]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/rest@16.0.0-rc.1
  - @objectstack/plugin-hono-server@16.0.0-rc.1
  - @objectstack/runtime@16.0.0-rc.1
  - @objectstack/plugin-security@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/account@16.0.0-rc.1
  - @objectstack/setup@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/driver-memory@16.0.0-rc.1
  - @objectstack/plugin-auth@16.0.0-rc.1
  - @objectstack/service-i18n@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [b39c65d]
- Updated dependencies [f972574]
- Updated dependencies [2f3c641]
- Updated dependencies [e38da5b]
- Updated dependencies [f9b118d]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
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
- Updated dependencies [2ea08ee]
- Updated dependencies [d1d1c40]
- Updated dependencies [616e839]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
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
  - @objectstack/rest@16.0.0-rc.0
  - @objectstack/plugin-auth@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/account@16.0.0-rc.0
  - @objectstack/setup@16.0.0-rc.0
  - @objectstack/driver-memory@16.0.0-rc.0
  - @objectstack/service-i18n@16.0.0-rc.0

## 15.1.1

### Patch Changes

- Updated dependencies [9dbb883]
- Updated dependencies [01ba3b3]
  - @objectstack/plugin-auth@15.1.1
  - @objectstack/runtime@15.1.1
  - @objectstack/spec@15.1.1
  - @objectstack/core@15.1.1
  - @objectstack/types@15.1.1
  - @objectstack/objectql@15.1.1
  - @objectstack/setup@15.1.1
  - @objectstack/rest@15.1.1
  - @objectstack/driver-memory@15.1.1
  - @objectstack/plugin-hono-server@15.1.1
  - @objectstack/plugin-security@15.1.1
  - @objectstack/service-i18n@15.1.1
  - @objectstack/account@15.1.1

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
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/runtime@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/rest@15.1.0
  - @objectstack/plugin-hono-server@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/plugin-security@15.1.0
  - @objectstack/plugin-auth@15.1.0
  - @objectstack/types@15.1.0
  - @objectstack/account@15.1.0
  - @objectstack/setup@15.1.0
  - @objectstack/driver-memory@15.1.0
  - @objectstack/service-i18n@15.1.0

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
  - @objectstack/account@15.0.0
  - @objectstack/setup@15.0.0
  - @objectstack/plugin-auth@15.0.0
  - @objectstack/driver-memory@15.0.0
  - @objectstack/plugin-hono-server@15.0.0
  - @objectstack/service-i18n@15.0.0
  - @objectstack/types@15.0.0

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
  - @objectstack/spec@14.8.0
  - @objectstack/plugin-security@14.8.0
  - @objectstack/rest@14.8.0
  - @objectstack/account@14.8.0
  - @objectstack/setup@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/objectql@14.8.0
  - @objectstack/driver-memory@14.8.0
  - @objectstack/plugin-auth@14.8.0
  - @objectstack/plugin-hono-server@14.8.0
  - @objectstack/runtime@14.8.0
  - @objectstack/service-i18n@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [da5e686]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/plugin-auth@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/plugin-security@14.7.0
  - @objectstack/account@14.7.0
  - @objectstack/setup@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/driver-memory@14.7.0
  - @objectstack/plugin-hono-server@14.7.0
  - @objectstack/rest@14.7.0
  - @objectstack/runtime@14.7.0
  - @objectstack/service-i18n@14.7.0

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
  - @objectstack/account@14.6.0
  - @objectstack/setup@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/driver-memory@14.6.0
  - @objectstack/plugin-hono-server@14.6.0
  - @objectstack/rest@14.6.0
  - @objectstack/runtime@14.6.0
  - @objectstack/service-i18n@14.6.0
  - @objectstack/types@14.6.0

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
  - @objectstack/runtime@14.5.0
  - @objectstack/plugin-security@14.5.0
  - @objectstack/plugin-auth@14.5.0
  - @objectstack/rest@14.5.0
  - @objectstack/objectql@14.5.0
  - @objectstack/plugin-hono-server@14.5.0
  - @objectstack/account@14.5.0
  - @objectstack/setup@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/driver-memory@14.5.0
  - @objectstack/service-i18n@14.5.0
  - @objectstack/types@14.5.0

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
  - @objectstack/core@14.4.0
  - @objectstack/plugin-security@14.4.0
  - @objectstack/plugin-auth@14.4.0
  - @objectstack/account@14.4.0
  - @objectstack/setup@14.4.0
  - @objectstack/driver-memory@14.4.0
  - @objectstack/plugin-hono-server@14.4.0
  - @objectstack/rest@14.4.0
  - @objectstack/runtime@14.4.0
  - @objectstack/service-i18n@14.4.0
  - @objectstack/types@14.4.0

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
  - @objectstack/runtime@14.3.0
  - @objectstack/account@14.3.0
  - @objectstack/setup@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/driver-memory@14.3.0
  - @objectstack/plugin-hono-server@14.3.0
  - @objectstack/service-i18n@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/plugin-hono-server@14.2.0
  - @objectstack/plugin-security@14.2.0
  - @objectstack/spec@14.2.0
  - @objectstack/runtime@14.2.0
  - @objectstack/account@14.2.0
  - @objectstack/setup@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/objectql@14.2.0
  - @objectstack/driver-memory@14.2.0
  - @objectstack/plugin-auth@14.2.0
  - @objectstack/rest@14.2.0
  - @objectstack/service-i18n@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/account@14.1.0
  - @objectstack/setup@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/driver-memory@14.1.0
  - @objectstack/plugin-auth@14.1.0
  - @objectstack/plugin-hono-server@14.1.0
  - @objectstack/plugin-security@14.1.0
  - @objectstack/rest@14.1.0
  - @objectstack/runtime@14.1.0
  - @objectstack/service-i18n@14.1.0
  - @objectstack/types@14.1.0

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
  - @objectstack/plugin-security@14.0.0
  - @objectstack/rest@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/account@14.0.0
  - @objectstack/setup@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/driver-memory@14.0.0
  - @objectstack/plugin-auth@14.0.0
  - @objectstack/plugin-hono-server@14.0.0
  - @objectstack/service-i18n@14.0.0
  - @objectstack/types@14.0.0

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
  - @objectstack/plugin-auth@13.0.0
  - @objectstack/plugin-hono-server@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/account@13.0.0
  - @objectstack/setup@13.0.0
  - @objectstack/driver-memory@13.0.0
  - @objectstack/service-i18n@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [b5a87eb]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/runtime@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/rest@12.6.0
  - @objectstack/account@12.6.0
  - @objectstack/setup@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/driver-memory@12.6.0
  - @objectstack/plugin-auth@12.6.0
  - @objectstack/plugin-hono-server@12.6.0
  - @objectstack/plugin-org-scoping@12.6.0
  - @objectstack/plugin-security@12.6.0
  - @objectstack/service-i18n@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- 3b9fd94: `os dev` / `os start` / `os serve` no longer default-load the `@objectstack/studio` app package.

  The console ships a dedicated Studio surface at `/_console/studio/<package-id>/<pillar>`,
  so Studio no longer needs to exist as a navigable app tile in the home "Your apps" list.
  The `@objectstack/studio` package is unchanged and can still be registered explicitly;
  Setup and Account remain default-loaded (ADR-0048 one-app-per-package mechanism).

- f85635e: Drop the `@objectstack/studio` dependency from `cli` and `plugin-dev`. Since Studio is no longer default-loaded by `os dev` / `os start` / `os serve` (the console hosts it at `/_console/studio/...`), neither package imports it at runtime any more. The only remaining consumer was the ADR-0048 app-split test in `cli`, which now exercises the identical one-app-package code path via Setup + Account. The `@objectstack/studio` package itself is unchanged and still registerable explicitly.
- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/account@12.5.0
  - @objectstack/setup@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/driver-memory@12.5.0
  - @objectstack/plugin-auth@12.5.0
  - @objectstack/plugin-hono-server@12.5.0
  - @objectstack/plugin-org-scoping@12.5.0
  - @objectstack/plugin-security@12.5.0
  - @objectstack/rest@12.5.0
  - @objectstack/runtime@12.5.0
  - @objectstack/service-i18n@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/runtime@12.4.0
  - @objectstack/account@12.4.0
  - @objectstack/setup@12.4.0
  - @objectstack/studio@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/driver-memory@12.4.0
  - @objectstack/plugin-auth@12.4.0
  - @objectstack/plugin-hono-server@12.4.0
  - @objectstack/plugin-org-scoping@12.4.0
  - @objectstack/plugin-security@12.4.0
  - @objectstack/rest@12.4.0
  - @objectstack/service-i18n@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/rest@12.3.0
  - @objectstack/runtime@12.3.0
  - @objectstack/account@12.3.0
  - @objectstack/setup@12.3.0
  - @objectstack/studio@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/driver-memory@12.3.0
  - @objectstack/plugin-auth@12.3.0
  - @objectstack/plugin-hono-server@12.3.0
  - @objectstack/plugin-org-scoping@12.3.0
  - @objectstack/plugin-security@12.3.0
  - @objectstack/service-i18n@12.3.0
  - @objectstack/types@12.3.0

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
  - @objectstack/service-i18n@12.2.0
  - @objectstack/account@12.2.0
  - @objectstack/setup@12.2.0
  - @objectstack/studio@12.2.0
  - @objectstack/driver-memory@12.2.0
  - @objectstack/plugin-auth@12.2.0
  - @objectstack/plugin-hono-server@12.2.0
  - @objectstack/plugin-org-scoping@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [497bda8]
- Updated dependencies [93e6d02]
  - @objectstack/runtime@12.1.0
  - @objectstack/spec@12.1.0
  - @objectstack/account@12.1.0
  - @objectstack/setup@12.1.0
  - @objectstack/studio@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/driver-memory@12.1.0
  - @objectstack/plugin-auth@12.1.0
  - @objectstack/plugin-hono-server@12.1.0
  - @objectstack/plugin-org-scoping@12.1.0
  - @objectstack/plugin-security@12.1.0
  - @objectstack/rest@12.1.0
  - @objectstack/service-i18n@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [1b1b34e]
- Updated dependencies [9796e7c]
- Updated dependencies [9693a36]
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
  - @objectstack/runtime@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/rest@12.0.0
  - @objectstack/account@12.0.0
  - @objectstack/setup@12.0.0
  - @objectstack/studio@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/driver-memory@12.0.0
  - @objectstack/plugin-hono-server@12.0.0
  - @objectstack/plugin-org-scoping@12.0.0
  - @objectstack/service-i18n@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/plugin-security@11.10.0
  - @objectstack/account@11.10.0
  - @objectstack/setup@11.10.0
  - @objectstack/studio@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/driver-memory@11.10.0
  - @objectstack/plugin-auth@11.10.0
  - @objectstack/plugin-hono-server@11.10.0
  - @objectstack/plugin-org-scoping@11.10.0
  - @objectstack/rest@11.10.0
  - @objectstack/runtime@11.10.0
  - @objectstack/service-i18n@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [852bc8e]
- Updated dependencies [d3595d9]
  - @objectstack/runtime@11.9.0
  - @objectstack/spec@11.9.0
  - @objectstack/account@11.9.0
  - @objectstack/setup@11.9.0
  - @objectstack/studio@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/driver-memory@11.9.0
  - @objectstack/plugin-auth@11.9.0
  - @objectstack/plugin-hono-server@11.9.0
  - @objectstack/plugin-org-scoping@11.9.0
  - @objectstack/plugin-security@11.9.0
  - @objectstack/rest@11.9.0
  - @objectstack/service-i18n@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/account@11.8.0
- @objectstack/setup@11.8.0
- @objectstack/studio@11.8.0
- @objectstack/plugin-auth@11.8.0
- @objectstack/plugin-org-scoping@11.8.0
- @objectstack/plugin-security@11.8.0
- @objectstack/rest@11.8.0
- @objectstack/runtime@11.8.0
- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/objectql@11.8.0
- @objectstack/driver-memory@11.8.0
- @objectstack/plugin-hono-server@11.8.0
- @objectstack/service-i18n@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/account@11.7.0
  - @objectstack/setup@11.7.0
  - @objectstack/studio@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/objectql@11.7.0
  - @objectstack/driver-memory@11.7.0
  - @objectstack/plugin-auth@11.7.0
  - @objectstack/plugin-hono-server@11.7.0
  - @objectstack/plugin-org-scoping@11.7.0
  - @objectstack/plugin-security@11.7.0
  - @objectstack/rest@11.7.0
  - @objectstack/runtime@11.7.0
  - @objectstack/service-i18n@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/studio@11.6.0
- @objectstack/setup@11.6.0
- @objectstack/runtime@11.6.0
- @objectstack/rest@11.6.0
- @objectstack/driver-memory@11.6.0
- @objectstack/plugin-auth@11.6.0
- @objectstack/plugin-hono-server@11.6.0
- @objectstack/plugin-org-scoping@11.6.0
- @objectstack/plugin-security@11.6.0
- @objectstack/service-i18n@11.6.0
- @objectstack/account@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/account@11.5.0
  - @objectstack/setup@11.5.0
  - @objectstack/studio@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/driver-memory@11.5.0
  - @objectstack/plugin-auth@11.5.0
  - @objectstack/plugin-hono-server@11.5.0
  - @objectstack/plugin-org-scoping@11.5.0
  - @objectstack/plugin-security@11.5.0
  - @objectstack/rest@11.5.0
  - @objectstack/runtime@11.5.0
  - @objectstack/service-i18n@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/account@11.4.0
  - @objectstack/setup@11.4.0
  - @objectstack/studio@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/driver-memory@11.4.0
  - @objectstack/plugin-auth@11.4.0
  - @objectstack/plugin-hono-server@11.4.0
  - @objectstack/plugin-org-scoping@11.4.0
  - @objectstack/plugin-security@11.4.0
  - @objectstack/rest@11.4.0
  - @objectstack/runtime@11.4.0
  - @objectstack/service-i18n@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
- Updated dependencies [59576d0]
  - @objectstack/spec@11.3.0
  - @objectstack/plugin-auth@11.3.0
  - @objectstack/account@11.3.0
  - @objectstack/setup@11.3.0
  - @objectstack/studio@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/driver-memory@11.3.0
  - @objectstack/plugin-hono-server@11.3.0
  - @objectstack/plugin-org-scoping@11.3.0
  - @objectstack/plugin-security@11.3.0
  - @objectstack/rest@11.3.0
  - @objectstack/runtime@11.3.0
  - @objectstack/service-i18n@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/account@11.2.0
  - @objectstack/setup@11.2.0
  - @objectstack/studio@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/driver-memory@11.2.0
  - @objectstack/plugin-auth@11.2.0
  - @objectstack/plugin-hono-server@11.2.0
  - @objectstack/plugin-org-scoping@11.2.0
  - @objectstack/plugin-security@11.2.0
  - @objectstack/rest@11.2.0
  - @objectstack/runtime@11.2.0
  - @objectstack/service-i18n@11.2.0
  - @objectstack/types@11.2.0

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
  - @objectstack/rest@11.1.0
  - @objectstack/runtime@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/plugin-hono-server@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/driver-memory@11.1.0
  - @objectstack/account@11.1.0
  - @objectstack/setup@11.1.0
  - @objectstack/studio@11.1.0
  - @objectstack/plugin-org-scoping@11.1.0
  - @objectstack/service-i18n@11.1.0

## 11.0.0

### Major Changes

- 638f472: Remove the deprecated `IUIService` contract (use `IMetadataService`) — 11.0.

  `IUIService` (spec `contracts/ui-service.ts`) was superseded by `IMetadataService`
  (views/dashboards are metadata: `metadata.get('view', …)` / `register(…)`). This
  removes the dead interface and its dev stub:

  - spec: delete `contracts/ui-service.ts` + its barrel export.
  - plugin-dev: drop the bespoke `ui` dev stub (`createUIStub`). `'ui'` remains a
    `CoreServiceName`, so dev mode still registers a generic stub for it via the
    fallback path; only the obsolete view/dashboard methods are gone.

  Use `IMetadataService` for view/dashboard CRUD.

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
- Updated dependencies [1e8a813]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
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
  - @objectstack/plugin-auth@11.0.0
  - @objectstack/objectql@11.0.0
  - @objectstack/runtime@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/rest@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/account@11.0.0
  - @objectstack/setup@11.0.0
  - @objectstack/studio@11.0.0
  - @objectstack/plugin-org-scoping@11.0.0
  - @objectstack/plugin-security@11.0.0
  - @objectstack/driver-memory@11.0.0
  - @objectstack/plugin-hono-server@11.0.0
  - @objectstack/service-i18n@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [211425e]
- Updated dependencies [8cf4f7c]
- Updated dependencies [f2063f3]
  - @objectstack/objectql@10.3.0
  - @objectstack/runtime@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/types@10.3.0
  - @objectstack/studio@10.3.0
  - @objectstack/setup@10.3.0
  - @objectstack/rest@10.3.0
  - @objectstack/driver-memory@10.3.0
  - @objectstack/plugin-auth@10.3.0
  - @objectstack/plugin-hono-server@10.3.0
  - @objectstack/plugin-org-scoping@10.3.0
  - @objectstack/plugin-security@10.3.0
  - @objectstack/service-i18n@10.3.0
  - @objectstack/account@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/account@10.2.0
  - @objectstack/setup@10.2.0
  - @objectstack/studio@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/driver-memory@10.2.0
  - @objectstack/plugin-auth@10.2.0
  - @objectstack/plugin-hono-server@10.2.0
  - @objectstack/plugin-org-scoping@10.2.0
  - @objectstack/plugin-security@10.2.0
  - @objectstack/rest@10.2.0
  - @objectstack/runtime@10.2.0
  - @objectstack/service-i18n@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [94d2161]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/runtime@10.1.0
  - @objectstack/rest@10.1.0
  - @objectstack/account@10.1.0
  - @objectstack/setup@10.1.0
  - @objectstack/studio@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/driver-memory@10.1.0
  - @objectstack/plugin-auth@10.1.0
  - @objectstack/plugin-hono-server@10.1.0
  - @objectstack/plugin-org-scoping@10.1.0
  - @objectstack/plugin-security@10.1.0
  - @objectstack/service-i18n@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [47d978a]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [3754f80]
- Updated dependencies [feead7e]
- Updated dependencies [00c32f2]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/rest@10.0.0
  - @objectstack/plugin-security@10.0.0
  - @objectstack/runtime@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/plugin-hono-server@10.0.0
  - @objectstack/account@10.0.0
  - @objectstack/setup@10.0.0
  - @objectstack/studio@10.0.0
  - @objectstack/driver-memory@10.0.0
  - @objectstack/plugin-auth@10.0.0
  - @objectstack/plugin-org-scoping@10.0.0
  - @objectstack/service-i18n@10.0.0
  - @objectstack/types@10.0.0

## 9.11.0

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
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/account@9.11.0
  - @objectstack/setup@9.11.0
  - @objectstack/studio@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/driver-memory@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/service-i18n@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [f169558]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/spec@9.10.0
  - @objectstack/plugin-org-scoping@9.10.0
  - @objectstack/plugin-security@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/rest@9.10.0
  - @objectstack/account@9.10.0
  - @objectstack/setup@9.10.0
  - @objectstack/studio@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/driver-memory@9.10.0
  - @objectstack/plugin-auth@9.10.0
  - @objectstack/plugin-hono-server@9.10.0
  - @objectstack/service-i18n@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/objectql@9.9.1
- @objectstack/studio@9.9.1
- @objectstack/setup@9.9.1
- @objectstack/runtime@9.9.1
- @objectstack/rest@9.9.1
- @objectstack/driver-memory@9.9.1
- @objectstack/plugin-auth@9.9.1
- @objectstack/plugin-hono-server@9.9.1
- @objectstack/plugin-org-scoping@9.9.1
- @objectstack/plugin-security@9.9.1
- @objectstack/service-i18n@9.9.1
- @objectstack/account@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [0d4e3f3]
- Updated dependencies [44c5348]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [92d75ca]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/plugin-auth@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/rest@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/plugin-security@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/account@9.9.0
  - @objectstack/setup@9.9.0
  - @objectstack/studio@9.9.0
  - @objectstack/driver-memory@9.9.0
  - @objectstack/plugin-hono-server@9.9.0
  - @objectstack/plugin-org-scoping@9.9.0
  - @objectstack/service-i18n@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [7fe0b91]
- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/rest@9.8.0
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/account@9.8.0
  - @objectstack/setup@9.8.0
  - @objectstack/studio@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/driver-memory@9.8.0
  - @objectstack/plugin-auth@9.8.0
  - @objectstack/plugin-hono-server@9.8.0
  - @objectstack/plugin-org-scoping@9.8.0
  - @objectstack/plugin-security@9.8.0
  - @objectstack/service-i18n@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/objectql@9.7.0
- @objectstack/runtime@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
- @objectstack/studio@9.7.0
- @objectstack/setup@9.7.0
- @objectstack/rest@9.7.0
- @objectstack/driver-memory@9.7.0
- @objectstack/plugin-auth@9.7.0
- @objectstack/plugin-hono-server@9.7.0
- @objectstack/plugin-org-scoping@9.7.0
- @objectstack/plugin-security@9.7.0
- @objectstack/service-i18n@9.7.0
- @objectstack/account@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [1b82b64]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/plugin-auth@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/rest@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/account@9.6.0
  - @objectstack/setup@9.6.0
  - @objectstack/studio@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/driver-memory@9.6.0
  - @objectstack/plugin-hono-server@9.6.0
  - @objectstack/plugin-org-scoping@9.6.0
  - @objectstack/plugin-security@9.6.0
  - @objectstack/service-i18n@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/account@9.5.1
  - @objectstack/setup@9.5.1
  - @objectstack/studio@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/driver-memory@9.5.1
  - @objectstack/plugin-auth@9.5.1
  - @objectstack/plugin-hono-server@9.5.1
  - @objectstack/plugin-org-scoping@9.5.1
  - @objectstack/plugin-security@9.5.1
  - @objectstack/rest@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/service-i18n@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
- Updated dependencies [1a4f079]
- Updated dependencies [110a333]
  - @objectstack/spec@9.5.0
  - @objectstack/rest@9.5.0
  - @objectstack/setup@9.5.0
  - @objectstack/studio@9.5.0
  - @objectstack/account@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/objectql@9.5.0
  - @objectstack/driver-memory@9.5.0
  - @objectstack/plugin-auth@9.5.0
  - @objectstack/plugin-hono-server@9.5.0
  - @objectstack/plugin-org-scoping@9.5.0
  - @objectstack/plugin-security@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/service-i18n@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/rest@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/account@9.4.0
  - @objectstack/setup@9.4.0
  - @objectstack/studio@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/driver-memory@9.4.0
  - @objectstack/plugin-auth@9.4.0
  - @objectstack/plugin-hono-server@9.4.0
  - @objectstack/plugin-org-scoping@9.4.0
  - @objectstack/plugin-security@9.4.0
  - @objectstack/service-i18n@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [b08d08d]
- Updated dependencies [6259882]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/rest@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/driver-memory@9.3.0
  - @objectstack/plugin-auth@9.3.0
  - @objectstack/plugin-hono-server@9.3.0
  - @objectstack/plugin-org-scoping@9.3.0
  - @objectstack/plugin-security@9.3.0
  - @objectstack/service-i18n@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/driver-memory@9.2.0
  - @objectstack/plugin-auth@9.2.0
  - @objectstack/plugin-hono-server@9.2.0
  - @objectstack/plugin-org-scoping@9.2.0
  - @objectstack/plugin-security@9.2.0
  - @objectstack/rest@9.2.0
  - @objectstack/runtime@9.2.0
  - @objectstack/service-i18n@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/driver-memory@9.1.0
  - @objectstack/plugin-auth@9.1.0
  - @objectstack/plugin-hono-server@9.1.0
  - @objectstack/plugin-org-scoping@9.1.0
  - @objectstack/plugin-security@9.1.0
  - @objectstack/rest@9.1.0
  - @objectstack/runtime@9.1.0
  - @objectstack/service-i18n@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/driver-memory@9.0.1
  - @objectstack/plugin-auth@9.0.1
  - @objectstack/plugin-hono-server@9.0.1
  - @objectstack/plugin-org-scoping@9.0.1
  - @objectstack/plugin-security@9.0.1
  - @objectstack/rest@9.0.1
  - @objectstack/runtime@9.0.1
  - @objectstack/service-i18n@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/plugin-auth@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/driver-memory@9.0.0
  - @objectstack/plugin-hono-server@9.0.0
  - @objectstack/plugin-org-scoping@9.0.0
  - @objectstack/plugin-security@9.0.0
  - @objectstack/rest@9.0.0
  - @objectstack/runtime@9.0.0
  - @objectstack/service-i18n@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/objectql@8.0.1
- @objectstack/runtime@8.0.1
- @objectstack/rest@8.0.1
- @objectstack/driver-memory@8.0.1
- @objectstack/plugin-auth@8.0.1
- @objectstack/plugin-hono-server@8.0.1
- @objectstack/plugin-org-scoping@8.0.1
- @objectstack/plugin-security@8.0.1
- @objectstack/service-i18n@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [93f97b2]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [e6374b5]
- Updated dependencies [1e8b680]
- Updated dependencies [0a6438e]
- Updated dependencies [3306d2f]
- Updated dependencies [ae7fb3f]
- Updated dependencies [c262301]
- Updated dependencies [e1478fe]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/plugin-hono-server@8.0.0
  - @objectstack/plugin-auth@8.0.0
  - @objectstack/plugin-security@8.0.0
  - @objectstack/rest@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/driver-memory@8.0.0
  - @objectstack/plugin-org-scoping@8.0.0
  - @objectstack/service-i18n@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/objectql@7.9.0
  - @objectstack/rest@7.9.0
  - @objectstack/runtime@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/driver-memory@7.9.0
  - @objectstack/plugin-auth@7.9.0
  - @objectstack/plugin-hono-server@7.9.0
  - @objectstack/plugin-org-scoping@7.9.0
  - @objectstack/plugin-security@7.9.0
  - @objectstack/service-i18n@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/rest@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/driver-memory@7.8.0
  - @objectstack/plugin-auth@7.8.0
  - @objectstack/plugin-hono-server@7.8.0
  - @objectstack/plugin-org-scoping@7.8.0
  - @objectstack/plugin-security@7.8.0
  - @objectstack/service-i18n@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/driver-memory@7.7.0
  - @objectstack/plugin-auth@7.7.0
  - @objectstack/plugin-hono-server@7.7.0
  - @objectstack/plugin-org-scoping@7.7.0
  - @objectstack/plugin-security@7.7.0
  - @objectstack/rest@7.7.0
  - @objectstack/runtime@7.7.0
  - @objectstack/service-i18n@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Patch Changes

- bb04824: fix(build): don't bundle lazily-imported optional drivers (fixes build break from #1524).

  After moving optional internal `@objectstack/*` peerDependencies off `peer` (to
  stop the changesets fixed-group major cascade), tsup no longer auto-externalized
  them and began bundling the lazily `await import()`-ed driver packages — pulling
  in their optional native clients (`mysql` / `oracledb` via knex) and failing the
  build. Fix: `service-datasource` externalizes `@objectstack/driver-*` in tsup
  (kept as devDeps for tests); `plugin-dev` moves its framework packages to
  `dependencies` (auto-externalized; it's a dev-only plugin). Full build green.

- 8c01eea: fix(dev): seed the dev admin in-process and fix the port-drift seed failure.

  `os dev` (and `pnpm dev:showcase`) seeded the admin over HTTP against a
  hard-coded `localhost:3000`. In dev, `serve` auto-shifts off a busy port, so
  the seed POST hit the wrong server (or nothing) and the running instance never
  got an admin. A second, divergent seed in `plugin-dev` inserted a
  credential-less `sys_user` row that could not log in.

  Consolidate to a single in-process seed:

  - **`@objectstack/plugin-auth`** — `maybeSeedDevAdmin()` runs on `kernel:ready`
    and creates `admin@objectos.ai` / `admin123` through better-auth's real
    `signUpEmail` pipeline (hashed credential), so the account is loginable;
    `plugin-security` then promotes it to platform admin. Empty-DB only
    (excludes the system service account), idempotent, never overwrites an
    existing account. Hard-gated to `NODE_ENV=development`; opt out with
    `OS_SEED_ADMIN=0`.
  - **`@objectstack/cli`** — removed the HTTP seed; `--seed-admin` now passes
    `OS_SEED_ADMIN[_EMAIL|_PASSWORD]` to the serve child. `serve` publishes its
    actually-bound port over IPC and to a `runtime.<env>.json` state file under
    `OS_HOME`.
  - **`@objectstack/plugin-dev`** — removed the credential-less raw insert;
    `seedAdminUser` maps to the unified `OS_SEED_ADMIN` toggle.

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8c01eea]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [b7a4f14]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/plugin-auth@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/driver-memory@7.6.0
  - @objectstack/plugin-hono-server@7.6.0
  - @objectstack/plugin-org-scoping@7.6.0
  - @objectstack/plugin-security@7.6.0
  - @objectstack/rest@7.6.0
  - @objectstack/service-i18n@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1

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
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
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

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/plugin-auth@7.0.0
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-security@7.0.0
  - @objectstack/plugin-org-scoping@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/driver-memory@7.0.0
  - @objectstack/plugin-hono-server@7.0.0
  - @objectstack/rest@7.0.0
  - @objectstack/service-i18n@7.0.0

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

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/rest@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/driver-memory@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-hono-server@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/service-i18n@6.0.0

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

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/plugin-hono-server@5.0.0
  - @objectstack/service-i18n@5.0.0

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
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/plugin-auth@4.0.4
  - @objectstack/plugin-hono-server@4.0.4
  - @objectstack/plugin-security@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-i18n@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/plugin-auth@4.0.3
- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/objectql@4.0.3
- @objectstack/runtime@4.0.3
- @objectstack/rest@4.0.3
- @objectstack/driver-memory@4.0.3
- @objectstack/plugin-hono-server@4.0.3
- @objectstack/plugin-security@4.0.3
- @objectstack/plugin-setup@4.0.3
- @objectstack/service-i18n@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/plugin-hono-server@4.0.2
  - @objectstack/driver-memory@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-auth@4.0.2
  - @objectstack/plugin-security@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/runtime@4.0.2
  - @objectstack/service-i18n@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/plugin-auth@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/plugin-hono-server@4.0.0
  - @objectstack/plugin-security@4.0.0
  - @objectstack/plugin-setup@4.0.0
  - @objectstack/rest@4.0.0
  - @objectstack/service-i18n@4.0.0

## 3.3.1

### Patch Changes

- Updated dependencies [772dc3f]
  - @objectstack/service-i18n@3.3.1
  - @objectstack/spec@3.3.1
  - @objectstack/core@3.3.1
  - @objectstack/objectql@3.3.1
  - @objectstack/runtime@3.3.1
  - @objectstack/rest@3.3.1
  - @objectstack/driver-memory@3.3.1
  - @objectstack/plugin-auth@3.3.1
  - @objectstack/plugin-hono-server@3.3.1
  - @objectstack/plugin-security@3.3.1

## 3.3.0

### Patch Changes

- Updated dependencies [814a6c4]
  - @objectstack/plugin-auth@3.3.0
  - @objectstack/spec@3.3.0
  - @objectstack/core@3.3.0
  - @objectstack/objectql@3.3.0
  - @objectstack/runtime@3.3.0
  - @objectstack/rest@3.3.0
  - @objectstack/driver-memory@3.3.0
  - @objectstack/plugin-hono-server@3.3.0
  - @objectstack/plugin-security@3.3.0
  - @objectstack/service-i18n@3.3.0

## 3.2.9

### Patch Changes

- Updated dependencies [0bc7b0c]
- Updated dependencies [c3065dd]
  - @objectstack/plugin-hono-server@3.2.9
  - @objectstack/objectql@3.2.9
  - @objectstack/plugin-auth@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/rest@3.2.9
  - @objectstack/driver-memory@3.2.9
  - @objectstack/plugin-security@3.2.9
  - @objectstack/service-i18n@3.2.9

## 3.2.8

### Patch Changes

- Updated dependencies [1fe5612]
  - @objectstack/plugin-auth@3.2.8
  - @objectstack/spec@3.2.8
  - @objectstack/core@3.2.8
  - @objectstack/objectql@3.2.8
  - @objectstack/runtime@3.2.8
  - @objectstack/rest@3.2.8
  - @objectstack/driver-memory@3.2.8
  - @objectstack/plugin-hono-server@3.2.8
  - @objectstack/plugin-security@3.2.8
  - @objectstack/service-i18n@3.2.8

## 3.2.7

### Patch Changes

- Updated dependencies [35a1ebb]
  - @objectstack/plugin-auth@3.2.7
  - @objectstack/spec@3.2.7
  - @objectstack/core@3.2.7
  - @objectstack/objectql@3.2.7
  - @objectstack/runtime@3.2.7
  - @objectstack/rest@3.2.7
  - @objectstack/driver-memory@3.2.7
  - @objectstack/plugin-hono-server@3.2.7
  - @objectstack/plugin-security@3.2.7
  - @objectstack/service-i18n@3.2.7

## 3.2.6

### Patch Changes

- Updated dependencies [83151bc]
  - @objectstack/service-i18n@3.2.6
  - @objectstack/spec@3.2.6
  - @objectstack/core@3.2.6
  - @objectstack/objectql@3.2.6
  - @objectstack/runtime@3.2.6
  - @objectstack/rest@3.2.6
  - @objectstack/driver-memory@3.2.6
  - @objectstack/plugin-auth@3.2.6
  - @objectstack/plugin-hono-server@3.2.6
  - @objectstack/plugin-security@3.2.6

## 3.2.5

### Patch Changes

- Updated dependencies [e854538]
  - @objectstack/plugin-auth@3.2.5
  - @objectstack/spec@3.2.5
  - @objectstack/core@3.2.5
  - @objectstack/objectql@3.2.5
  - @objectstack/runtime@3.2.5
  - @objectstack/rest@3.2.5
  - @objectstack/driver-memory@3.2.5
  - @objectstack/plugin-hono-server@3.2.5
  - @objectstack/plugin-security@3.2.5

## 3.2.4

### Patch Changes

- Updated dependencies [f490991]
  - @objectstack/plugin-auth@3.2.4
  - @objectstack/spec@3.2.4
  - @objectstack/core@3.2.4
  - @objectstack/objectql@3.2.4
  - @objectstack/runtime@3.2.4
  - @objectstack/rest@3.2.4
  - @objectstack/driver-memory@3.2.4
  - @objectstack/plugin-hono-server@3.2.4
  - @objectstack/plugin-security@3.2.4

## 3.2.3

### Patch Changes

- Updated dependencies [0b1d7c9]
  - @objectstack/plugin-auth@3.2.3
  - @objectstack/spec@3.2.3
  - @objectstack/core@3.2.3
  - @objectstack/objectql@3.2.3
  - @objectstack/runtime@3.2.3
  - @objectstack/rest@3.2.3
  - @objectstack/driver-memory@3.2.3
  - @objectstack/plugin-hono-server@3.2.3
  - @objectstack/plugin-security@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [cfaabbb]
- Updated dependencies [46defbb]
  - @objectstack/plugin-auth@3.2.2
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-hono-server@3.2.2
  - @objectstack/plugin-security@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-auth@3.2.1
  - @objectstack/plugin-hono-server@3.2.1
  - @objectstack/plugin-security@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-auth@3.2.0
  - @objectstack/plugin-hono-server@3.2.0
  - @objectstack/plugin-security@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-auth@3.1.1
  - @objectstack/plugin-hono-server@3.1.1
  - @objectstack/plugin-security@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-auth@3.1.0
  - @objectstack/plugin-hono-server@3.1.0
  - @objectstack/plugin-security@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-auth@3.0.11
  - @objectstack/plugin-hono-server@3.0.11
  - @objectstack/plugin-security@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-auth@3.0.10
  - @objectstack/plugin-hono-server@3.0.10
  - @objectstack/plugin-security@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-auth@3.0.9
  - @objectstack/plugin-hono-server@3.0.9
  - @objectstack/plugin-security@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-auth@3.0.8
  - @objectstack/plugin-hono-server@3.0.8
  - @objectstack/plugin-security@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-auth@3.0.7
  - @objectstack/plugin-hono-server@3.0.7
  - @objectstack/plugin-security@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-auth@3.0.6
  - @objectstack/plugin-hono-server@3.0.6
  - @objectstack/plugin-security@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-auth@3.0.5
  - @objectstack/plugin-hono-server@3.0.5
  - @objectstack/plugin-security@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-auth@3.0.4
  - @objectstack/plugin-hono-server@3.0.4
  - @objectstack/plugin-security@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/rest@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-auth@3.0.3
  - @objectstack/plugin-hono-server@3.0.3
  - @objectstack/plugin-security@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-auth@3.0.2
  - @objectstack/plugin-hono-server@3.0.2
  - @objectstack/plugin-security@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-auth@3.0.1
  - @objectstack/plugin-hono-server@3.0.1
  - @objectstack/plugin-security@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/rest@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-auth@3.0.0
  - @objectstack/plugin-hono-server@3.0.0
  - @objectstack/plugin-security@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-auth@2.0.7
  - @objectstack/plugin-hono-server@2.0.7
  - @objectstack/plugin-security@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/runtime@2.0.7
