# Changelog

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

- bb1ce2e: fix(plugin-auth,plugin-webhooks): retire a dead degrade branch and an implicit transitive dependency (ADR-0116 follow-ups, #4187)

  Two concrete findings from the ADR-0116 consumer-side audit, plus the
  authoring rule that would have prevented both.

  **`plugin-auth` claimed a fallback it did not have.** `init()` ran
  `const dataEngine = ctx.getService('data'); if (!dataEngine) { warn('No data
engine service found - auth will use in-memory storage') }`. That branch could
  never execute: `getService` **throws** for an unregistered service rather than
  returning `undefined`, and this plugin declares a hard dependency on ObjectQL
  (which registers `data` unconditionally), so a kernel without the engine fails
  even earlier with `Dependency … not found`. The branch is removed and the real
  contract is declared — `requiresServices: ['data', 'manifest']` — which also
  replaces a trailing `// manifest service required` comment with the
  machine-checked form of the same claim. `AuthManager` keeps its own optional
  `dataEngine` guards: it is usable outside the plugin.

  **`plugin-webhook-outbox` was protected only transitively.** It resolves
  `manifest` in `init()` with no fallback while depending on
  `com.objectstack.service.messaging`, which in turn depends on ObjectQL, the
  actual provider. That works today and would have broken silently the day
  messaging stopped depending on the engine — surfacing as a crash inside an
  unrelated plugin's init. It now declares `requiresServices: ['manifest']`
  directly.

  Neither change alters ordering or boot outcomes on any current composition:
  both plugins were already ordered correctly. What changes is what a broken
  composition _says_, and that the guarantees are now checked rather than
  inherited.

  Docs: `content/docs/plugins/anatomy.mdx` gains the three ADR-0116 fields and
  the decision rule for resolving a service inside `init()` (hard dependency vs
  `optionalDependencies` + `requiresServices`), including the two traps behind
  these fixes — don't rely on a transitive provider, and don't write an
  `if (!svc)` fallback after a bare `getService`. The api-registry example
  declares the contract on all seven of its plugins instead of relying on
  `kernel.use()` order.

- ea24593: fix(plugin-auth): the auth catch-all yields paths better-auth does not own (#4088)

  `registerAuthRoutes` mounts `rawApp.all('${basePath}/*')` over the whole auth
  namespace (`/api/v1/auth` by default), and that handler was **terminal**: it
  returned better-auth's response unconditionally, including the 404 better-auth
  produces for a path it does not implement. Any other plugin's route under that
  prefix was therefore reachable only if it happened to register **first** — Hono
  runs handlers matching a path in registration order and the first to return a
  Response wins.

  That put a load-bearing surface at the mercy of `kernel.use()` order.
  `@objectstack/plugin-hono-server` mounts `/auth/me/permissions` and
  `/auth/me/localization` from its own `kernel:ready` hook; objectui's entire
  permission layer reads the former and `core`'s auth gate allow-lists the latter
  as an endpoint a gated user must still reach. Register `AuthPlugin` before
  `HonoServerPlugin` and all of it silently 404s.

  A 404 from better-auth now means "this path is not mine" and the catch-all yields
  to whatever else matched, in either registration order. Deliberately narrow:

  - **Only 404 falls through.** 401/403 are real better-auth answers, not
    disclaimers of ownership.
  - **Precedence still favours the namespace owner.** better-auth wins every path
    it implements; only its leftovers are up for grabs.
  - **The unclaimed-path wire shape is unchanged.** When nothing downstream
    answers, better-auth's own 404 is returned verbatim rather than Hono's
    `404 Not Found`.

  No configuration changes and no new routes. The only behavioural difference for
  an existing deployment is that a route another plugin mounts under
  `/api/v1/auth/*` now answers regardless of plugin order — previously it answered
  only in the lucky order.

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

- b5f9397: fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

  Two changes with different weights, from one sweep of every in-repo engine
  call site that still speaks a deprecated alias.

  **The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
  and `top`→`limit` on all six methods. The other four pairs in
  `RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
  the RPC/wire layer only — their values need shape lowering that belongs to
  those layers — and a **direct `engine.find()` never crosses that layer**. Three
  call sites passed `sort` there, so it rode onto the AST untouched, every
  driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
  the query returned an ordinary-looking, arbitrarily-ordered result:

  | call site                           | asked for                                         | actually got                |
  | ----------------------------------- | ------------------------------------------------- | --------------------------- |
  | `share-link-routes.ts`              | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
  | `runtime/domains/share-links.ts`    | same route, runtime-domain copy                   | same                        |
  | `share-link-service.ts` `listLinks` | the 200 most recent share links                   | an arbitrary 200            |

  All three combine the dropped sort with a `limit` — the "latest N" shape whose
  failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
  which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
  normalizer; these calls sit one layer below it. `listLinks` had no test at all,
  which is why it went unnoticed. Now pinned — on the option bag the engine
  receives, not on row order, because the failure is that the key never becomes
  `orderBy` and a fake engine honouring either spelling would pass either way.

  **The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
  `filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
  webhooks 2, plus the one `filters` in a spec doc example). These are strict
  no-ops since #4346 folds the alias — the point is that the framework stops
  depending on a spelling it asks users to migrate off, which is a prerequisite
  for ever retiring the aliases. Service-level `filter` PARAMETERS (each
  service's own public API, e.g. `listRequests(filter)`) are deliberately
  untouched — those are not engine option bags.

  Two of the renamed calls were live victims of the #4346 bug rather than
  cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
  `findOne({filter})` and counted the whole table via `count({filter})`, so a
  federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
  corrected the behaviour; this makes the call say what it means.

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

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

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

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
- Updated dependencies [fccec22]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [fae74b5]
- Updated dependencies [366105c]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [f4d7f1d]
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
- Updated dependencies [f0d6594]
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
- Updated dependencies [99b4392]
- Updated dependencies [7309c81]
- Updated dependencies [495019b]
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
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [dd5daac]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [0931185]
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
  - @objectstack/rest@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Major Changes

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

### Minor Changes

- 1bd5652: feat(auth): give ADR-0105 D8's scope-bounded issuance a caller — the
  `delegated_admin` org role, capped so it cannot mint authority (#3697)

  D8 authorizes invitation _placement_ against the issuer's `adminScope`
  (ADR-0090 D12), so a delegated plant admin may invite only into their own
  subtree. That gate is implemented, unit-proven and reachable — but no principal
  could reach it in a state where it did anything:

  - better-auth grants `invitation: ["create"]` to `owner` and `admin` only
    (`memberAc` holds `invitation: []`, which every other registered role
    inherits);
  - under a wall-enforcing posture, owners and admins are auto-elevated to
    `organization_admin` (`auto-org-admin-grant.ts`), which carries the wildcard
    `modifyAllRecords` that makes `isTenantAdmin()` true — and the gate
    short-circuits on tenant admins.

  The two sets were disjoint. Issuance placement was bounded by the Layer 0 org
  wall (real, and correct) but never by `adminScope`, so D8's motivating story —
  "a plant admin invites into their own subtree without a platform admin
  finishing the job" — could not happen.

  **Two pieces, and they only ship together.**

  **1. The role.** `delegated_admin` is now registered with the organization
  plugin as `memberAc.statements` plus `invitation: ["create"]` — the one
  membership grade that may reach `/organization/invite-member` without being an
  org admin. Deliberately _not_ `invitation: ["cancel"]`: better-auth's cancel
  route checks the permission with no inviterId attribution, so it would mean
  "cancel anyone's pending invitation in the org".

  The role carries no ObjectStack authority by construction — `mapMembershipRole`
  passes it through as a position name, and with no `sys_position_permission_set`
  binding that name resolves to nothing. Role = _can reach the endpoint_;
  `adminScope` = _what the endpoint permits_.

  `sys_member.role` and `sys_invitation.role` each gain `delegated_admin` as a
  fourth option. Those selects are **enforced on write** — better-auth's own
  invitation and membership inserts are validated like any other row — so
  registering the role with the org plugin without listing it in both would have
  produced a role nobody could hold and nobody could hand out
  (`ValidationError: role must be one of: owner, admin, member`). That is exactly
  how the end-to-end regression caught it, twice; neither unit test could. The
  three non-English translation bundles carry the English label for the new option
  until localized.

  **2. The role cap**, in the framework's own `beforeCreateInvitation` hook,
  beside the D8 placement gate. Registering the role alone would have been a
  four-step privilege escalation: better-auth's only role-level cap on _what role
  you may invite someone as_ is its `creatorRole` check (default `owner`), which
  blocks inviting an **owner** but not an **admin** — and an accepted `admin`
  membership is auto-elevated to `organization_admin` → `isTenantAdmin()`. A
  subtree-scoped delegate could have manufactured a tenant admin, with every
  existing defense off the path (`sys_member` is not a `GOVERNED_OBJECT`, and the
  acceptance-time membership write runs under better-auth's context, not the
  issuer's).

  The cap refuses an invitation whose role outranks the issuer's own, and
  restricts a below-admin issuer to plain `member` — not merely "not admin/owner",
  because an app-registered role projects into `current_user.positions` and may be
  bound to permission sets, making it a capability channel too. A delegate's
  channel for capability is the invitation's _placement_ intent, which the D12
  gate allowlists position-by-position. The cap applies to every invitation,
  placement-carrying or not (the escalation is independent of placement), and
  fails closed: an issuer role that cannot be resolved confers nothing above a
  plain member.

  **What changes for deployments.** One new class of principal exists: members
  holding the `delegated_admin` org role, who can invite into the org — as
  `member` only, into the subtree their `adminScope` allows. It is opt-in twice
  over (someone must set the membership role _and_ grant an adminScope set), so a
  default deployment changes not at all. Org owners and admins are unaffected.

  Also exported: `MEMBERSHIP_ROLE_DELEGATED_ADMIN` from `@objectstack/spec`, so
  console and control-plane surfaces name the role from one place.

- 7fb436c: Multi-organization operation is an ENTITLEMENT again: the `group` posture no
  longer activates without the enterprise runtime (ADR-0105 D12 correction).

  The first ADR-0105 wave read D12 as "the `group` wall ships open" and made the
  posture self-activating — it never probed for `@objectstack/organizations`. That
  turned `group` into a free multi-org path around the `isolated` gate (ADR-0081
  D2), and made the weaker isolation the free one, which is not a boundary anyone
  would draw on purpose.

  The distinction that was missed: **open code is not free activation.** The wall's
  implementation has always lived in the open packages — that is equally true of
  `isolated`, whose Layer 0 wall sits in `plugin-security` and is gated on a
  service the enterprise package registers. Cloud ADR-0016's 铁律
  (强制免费、治理收费) guarantees that a deployment RUNNING a multi-org shape is
  safe; it is satisfied by REFUSING to run one unwalled, not by giving the posture
  away.

  ## Changes

  - **`tenancy-service`**: `group` probes `org-scoping` exactly like `isolated`.
    Without it the posture resolves to `single` and reports `degraded`.
  - **`os serve`**: the ADR-0093 D5 boot guard keys off the resolved POSTURE
    instead of `OS_MULTI_ORG_ENABLED`. Previously `OS_TENANCY_POSTURE=group` skipped
    both the enterprise package load AND the fail-fast, silently degrading to an
    unwalled deployment — the exact ADR-0049 class that guard exists to close. A
    `group` request without the runtime now refuses to boot unless
    `OS_ALLOW_DEGRADED_TENANCY=1`.
  - **New seam — the runtime declares what it entitles.** `org-scoping` may expose
    `supportedPostures` (`OrgScopingEntitlement`, `@objectstack/spec/security`);
    the open side honours it and fails closed on anything not listed. Whether
    `group` and `isolated` are one commercial tier or two is packaging policy, and
    packaging policy belongs to the commercial runtime rather than hard-coded in
    open core. Omitting the field entitles every walled posture, so existing
    runtimes are unaffected.
  - **`organization_id` stamping returns to the enterprise runtime.** The previous
    wave moved auto-stamping into the open engine; that removed the closed
    package's only load-bearing runtime duty, so a five-line forged `org-scoping`
    registration would have produced a fully working multi-org deployment. With
    stamping back where it was, a forged registration yields NULL-org rows the wall
    hides — a broken deployment, not an unlicensed working one.

    **Write-side VALIDATION stays open and is unchanged**, including the
    bulk-insert coverage: rejecting a forged `organization_id` is a security
    property, not a packaging one. Only filling an ABSENT value moved back.

  - Default-organization bootstrap returns to `single`-only; every walled posture
    keeps its existing owner (ADR-0081 D1).

  ## Note for operators

  `OS_TENANCY_POSTURE=group` without `@objectstack/organizations` installed now
  **refuses to boot** rather than running single-org. This only affects
  deployments that adopted `group` between the two waves.

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 313d7be: feat(auth): `onInvitationAccepted` host seam — better-auth's
  `afterAcceptInvitation` forwarded to the host (ADR-0105 D8 prerequisite)

  An invitation may carry placement intent (target business unit + positions,
  extension fields on `sys_invitation` per the ADR-0092 whitelist), but there
  was no server-side seam to apply it when the invitation is accepted —
  better-auth's org-plugin models don't fire core `databaseHooks` (framework
  #3541 D8 note).

  `AuthManagerConfig.onInvitationAccepted` mirrors `onOrganizationCreated`:
  invoked from `organizationHooks.afterAcceptInvitation` with the mapped ids
  (`invitationId`, `organizationId`, `userId`, `memberId`, `role`, `email`)
  plus the RAW `invitation` / `member` rows so a host reads its own extension
  columns without a second query. Failure-isolated — acceptance never rolls
  back on a side-effect miss; hosts needing effectively-atomic placement
  should make the callback idempotent and reconcile on retry.

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

- aa8b847: feat(authz): scoped invitations — placement intent on an invitation, gated by
  the issuer's adminScope and applied on acceptance (ADR-0105 D8)

  An invitation may now carry PLACEMENT INTENT — the business unit the invitee
  lands in and the positions they are assigned — so a delegated (plant) admin's
  invitee arrives already in the right unit and role instead of waiting on a
  platform admin. This closes the structural gap ADR-0105 D8 names for
  `single`-posture deployments and is the natural admission path under `group`.

  The two halves ship together, deliberately:

  - **Issuance is authorized** against the ISSUER's `adminScope` (ADR-0090 D12),
    by dry-running the existing `DelegatedAdminGate` against the very
    `sys_user_position` rows the acceptance would write. The gate is reused
    verbatim — no second copy of the subtree/allowlist logic to drift — so an
    invitation can never place what its issuer could not have assigned directly.
    Without that gate the feature would be an escalation hole: the built-in
    `organization_admin` is deliberately read-only on the RBAC tables precisely
    so a fresh org admin cannot rebind themselves, and applying an unchecked
    invitation payload under system context would hand that authority straight
    back.
  - **Acceptance applies it**, idempotently and failure-isolated: a replayed
    acceptance converges instead of duplicating assignments, and a placement
    miss never undoes a valid membership.

  Surface:

  - `sys_invitation` gains `business_unit_id` + `positions` (ADR-0092 extension
    fields, registered in the D7 collision-guarded whitelist; NOT generically
    editable — placement is set only at issuance, through the gate).
  - `@objectstack/plugin-security` registers the `invitation-placement` service
    (`assertIssuable` / `apply`).
  - `@objectstack/plugin-auth` wires better-auth's `beforeCreateInvitation` /
    `afterAcceptInvitation` to it. **Fail closed**: an invitation that requests
    placement in a deployment without the delegated-administration runtime is
    refused, never silently placed unchecked.

  Existing invitations are unaffected — an invitation without placement intent
  never consults the gate and behaves exactly as before.

### Patch Changes

- 735f850: fix(security): resolve the ISSUER's real grants when authorizing invitation
  placement (ADR-0105 D8)

  Scoped-invitation issuance dry-runs `DelegatedAdminGate` against the
  `sys_user_position` rows the acceptance would write. The gate reads authority
  off `context.positions` / `context.permissions` — but the invitation hook
  handed it a hand-built `{ userId, tenantId }`, which carries neither. Every
  delegated administrator therefore resolved to the additive baseline alone and
  was refused:

  > requires tenant-level administration or a delegated adminScope (ADR-0090 D12)

  Fail-closed, but dead: only a tenant admin could ever issue a placement, which
  is the one case the feature was not for. Caught by cloud's group-posture
  dogfood, which exercises the real HTTP path with a real delegate.

  `assertIssuable` now takes `actorUserId` instead of a caller-built
  `actorContext` and resolves that user's grants itself through the single authz
  resolver (`@objectstack/core` `resolveUserAuthzGrants`) — the same envelope a
  transport would have carried, from the same reads. There is no request to
  resolve a context from inside a better-auth hook, so the id is what the caller
  can honestly supply and the resolution belongs behind the boundary.

  A principal-less call still reaches the gate with an empty context on purpose:
  the gate owns that refusal too, so the security boundary keeps exactly one
  place an issuance can be denied.

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

- d0fea33: fix(auth): map ObjectQL `ValidationError` to a 4xx on the better-auth paths (#3398)

  A field-level validation failure raised by the ObjectQL record-validator
  (e.g. an invalid `image` on `POST /api/v1/auth/update-user`) surfaced to the
  HTTP client as a **raw 500 with an empty body**. better-auth only maps its own
  `APIError`s to structured responses; any other error thrown from an adapter
  method propagates to better-call's router as an unhandled fault → `500 {}`.

  Added the auth-path analogue of the REST layer's `mapDataError`: the objectql
  adapter now detects the ObjectQL validation envelope at its boundary (duck-typed
  by `code` / `name`, so plugin-auth keeps no hard dependency on
  `@objectstack/objectql` and cross-realm `instanceof` can't bite) and re-throws
  it as `APIError('BAD_REQUEST', …)`. `update-user` and friends now answer with a
  `400 { code: 'VALIDATION_FAILED', message, fields }` instead of an opaque 500.

- bc17d39: fix(auth): provision the better-auth 1.7 columns `sys_team` / `sys_team_member` / `sys_two_factor` were missing (#3624)

  better-auth 1.7.0-rc.1 added fields to three models that the platform objects
  never provisioned and `auth-schema-config.ts` never mapped. Because an unmapped
  field keeps its camelCase name, the adapter emitted columns no table had:

  | model        | field                                     | column now provisioned                                      |
  | :----------- | :---------------------------------------- | :---------------------------------------------------------- |
  | `team`       | `memberCount`                             | `sys_team.member_count`                                     |
  | `teamMember` | `membershipKey`                           | `sys_team_member.membership_key`                            |
  | `twoFactor`  | `failedVerificationCount` / `lockedUntil` | `sys_two_factor.failed_verification_count` / `locked_until` |

  The team pair broke org creation outright. The organization plugin's team
  sub-feature is on by default, so `POST /api/v1/auth/organization/create`
  auto-creates a default team — and that insert died with `table sys_team has no
column named memberCount` _after_ the organization row had already committed.
  Callers got an HTTP 500 on top of a half-created org: a real org row with no
  default team behind it. Every multi-org deployment's create-org flow hit this.

  The two-factor pair broke the 2FA lockout path the same way: better-auth
  guard-increments `failedVerificationCount` on each wrong code and stamps
  `lockedUntil` past the threshold, so a wrong code 500'd instead of being
  counted. All four columns are better-auth's own state — provisioned, readable,
  and never written from the ObjectStack side.

  Existing environments pick the columns up through the driver's additive schema
  sync; no data migration is needed. `member_count` backfills to 0 and
  better-auth's own `syncTeamMemberCount` reconciles it on the next membership
  change, and `membership_key` stays null on pre-upgrade rows, which better-auth
  tolerates by falling back to the `(team_id, user_id)` pair.

  A new drift gate (`better-auth-schema-parity.test.ts`) now asserts that every
  column the installed better-auth version can write exists on the platform
  object backing it, across the auth manager's whole model surface. The ADR-0092
  D7 guard only ever caught _collisions_ between our extension fields and
  better-auth's, so a bump that adds a brand-new field passed the build and failed
  at runtime — twice now, counting the 1.7 `oauthAccessToken.authorizationCodeId`
  regression. The next one fails the build instead.

- 65ac468: fix(import): sanitize row errors — never leak raw SQL, map constraint failures to human wording (#3566)

  A failing import row surfaced the driver's raw error verbatim. When a write hit
  a DB constraint (e.g. `sys_user.phone_number` is `unique`), the query builder
  embeds the entire failing statement in `err.message`, and `toFailedResult`
  handed that straight back — so the importer saw `` insert into `sys_user`
(...) values (...) - UNIQUE constraint failed: sys_user.phone_number ``. That is
  both unreadable and an information disclosure of the schema.

  - `sanitizeRowError()` (import-runner) maps the common constraint failures —
    SQLite / MySQL / Postgres `UNIQUE` and `NOT NULL` — to human wording
    ("A record with this `<column>` already exists.", "`<column>` is required.")
    and, as a backstop, never lets a message that still reads as a SQL statement
    reach the client (it salvages the driver's trailing reason, or falls back to
    a generic message). Already-friendly messages (e.g. better-auth's "User
    already exists") pass through unchanged. Applies to every import path.
  - `isLikelyEmail` now rejects non-ASCII addresses, so an address like
    `x@柴仟.com` fails the import **dry-run** pre-check instead of passing client
    and dry-run validation only to be rejected by better-auth's strict ASCII
    validator at real-import time.

- 5faeac6: fix(auth): spell isLikelyEmail's ASCII guard with printable bounds (no control char)

  The non-ASCII guard added in framework#3566 was written as `[^\x00-\x7f]`, whose
  regex literal embeds a control character (`\x00`). Rewrite it as `[^\x20-\x7e]` —
  identical behaviour (anything outside printable ASCII fails the email
  pre-filter), but the pattern no longer carries a control character (eslint
  `no-control-regex`), and it matches the objectui side's `isPlausibleEmail`.

- cde1975: fix(dev): eliminate three fixed startup log warnings so official examples boot clean (#3420)

  `os dev` on the stock showcase printed three fixed noise sources on every boot,
  with zero example-side changes — training users to ignore warnings.

  - **spec** — add a field-level `ackPlaintextMasking: true` opt-out for the
    generic `password` author-time warning (ADR-0100). A deliberately-masked
    field (like field-zoo's `f_password`) can now affirm intent instead of
    printing an un-actionable "safe to ignore" on every boot; the warning text
    points authors at the flag.
  - **plugin-auth** — pass better-auth's documented
    `silenceWarnings.oauthAuthServerConfig` to `oauthProvider(...)`. We already
    mount the `/.well-known/oauth-authorization-server` documents ourselves at
    the issuer root, so the plugin's "please ensure it exists" reminder was a
    false positive (printed twice); silencing it removes both.
  - **objectql** — route the Registry's re-register / package-overwrite lines
    (normal rebuild / HMR / seed-replay paths) through a new debug-only
    `SchemaRegistry.debug()` so they stay out of the default `info` boot log. Adds
    a `logLevel` construction option (and matching `OS_REGISTRY_LOG` env var) so
    the debug-gated housekeeping is discoverable for troubleshooting.

- a629074: fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

  `auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
  better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
  governed two-factor verification no matter what the admin configured. An operator
  who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
  password stage that locked at 3 and a second factor that still locked at 10: the
  stricter door was the looser one, with nothing in the UI saying so.

  `lockout_threshold` / `lockout_duration_minutes` are now projected onto
  better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
  `durationSeconds`, minutes converted to seconds) rather than growing a parallel
  `two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
  field arrives as a new option instead of a conflict. The projection goes through
  `applyConfigPatch`, which resets the cached better-auth instance, so a settings
  change takes effect without a restart.

  Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
  password stage's "off", and a deployment may leave that stage unlocked because
  rate limiting or an IdP covers it; the second factor is the last check before a
  session is issued, so it keeps better-auth's default rather than being switched
  off by a setting that never mentioned it.

  The threshold field is also no longer hidden behind `email_password_enabled` —
  two-factor verification exists in passwordless deployments, where the setting was
  previously unreachable.

  The admin **Unlock Account** action now clears both stages. It only ever reset
  `sys_user`, so a user locked at the second factor had no admin escape hatch and
  had to wait the duration out — survivable while that lock needed 10 failures,
  routine once an operator can set the threshold to 3. The second-factor clear is
  best-effort and runs after the primary write, so an account with no enrolment
  still unlocks normally.

  Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
  option reaches; a threshold above 5 forces a fresh challenge rather than raising
  that cap.

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
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
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
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
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
- Updated dependencies [65ac468]
- Updated dependencies [ef5e72d]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
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
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [d318b24]
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
  - @objectstack/rest@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

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
  - @objectstack/rest@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- 616e839: **Bulk user import defaults to `auto` — prefer invite per row, temporary only for undeliverable rows (#3236).** The identity import endpoint (`POST /api/v1/auth/admin/import-users`) gains a fourth `passwordPolicy`, **`auto`**, and it is now the **default** (was `none`).

  `auto` decides **per row** instead of forcing one policy on the whole batch:

  - a row with a deliverable channel — a **real email + a wired email service**, or a **phone + a wired SMS-invite path** — is **invited** (a set-your-password email, or an invitation SMS for phone-only rows), so no shared secret ever leaves the server;
  - a row with **no** deliverable channel (placeholder email, phone-only without SMS, or an email row when no email service is wired) falls back to a **temporary password**, returned once in the response with `must_change_password` stamped.

  This shrinks the temporary-password blast radius from "the whole batch" to "only the rows that genuinely can't be reached", and — unlike `invite` — `auto` **never rejects the request for missing infrastructure**: with nothing wired, every row simply degrades to temporary. The per-row outcome is surfaced on `rows[].delivery` (`email` / `sms` / `temporary`) with a batch breakdown on `summary.delivery` (also recorded in the run audit).

  The three existing policies are unchanged and still selectable explicitly:

  - `invite` — force the invite path for every row; unreachable rows are **failed** per-row (never downgraded). Pick this when a temporary-password fallback is unacceptable.
  - `temporary` — force a generated temporary password for every row.
  - `none` — identity only, no password and no invitation.

  **Behavior change to note:** callers that **omit** `passwordPolicy` previously got `none` (no credential, no outbound message); they now get `auto`, which proactively sends invitations to deliverable rows (and returns temporary passwords for the rest). Callers that want the old identity-only behavior must pass `passwordPolicy: 'none'` explicitly. Every call that already passes an explicit policy is unaffected, and the response is a strict superset (adds the `delivery` fields).

### Patch Changes

- deb7e7e: fix(plugin-auth): run better-auth adapter WRITES as system context so #2948 doesn't strip readonly identity columns (#3164)

  The better-auth ObjectQL adapter wrapped the engine so its READS carried
  `isSystem` (to bypass the control-plane org-scope read hook), but its WRITES
  passed through with no context. The static-`readonly` UPDATE strip (#2948) runs
  on any non-system update — and since the adapter carries no caller context,
  `!ctx?.isSystem` was `true`, so the strip silently DROPPED better-auth's own
  writes to readonly `sys_user` columns: `email` (change-email), `banned` /
  `ban_reason` / `ban_expires` (admin ban). Those operations returned success but
  never persisted.

  `withSystemReadContext` is renamed to `withSystemContext` (a deprecated alias is
  kept for one release) and now injects `isSystem` on `insert` / `update` /
  `delete` as well as reads. This is correct because these are the identity
  authority's own writes — user-context writes to `managedBy: 'better-auth'` tables
  are already rejected upstream by the ADR-0092 identity write guard, so the
  adapter path only ever carries better-auth's internal writes.

  Found while implementing #3043 (the INSERT-side readonly strip). This is its
  UPDATE-side dual: #3043 relocated the insert strip to the external ingress
  precisely because internal writers (this adapter included) don't declare
  `isSystem`; the pre-existing engine-level UPDATE strip has no such relocation, so
  the adapter had to declare its writes system.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

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
- Updated dependencies [83e8f7d]
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
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/rest@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/rest@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 616e839: **Bulk user import defaults to `auto` — prefer invite per row, temporary only for undeliverable rows (#3236).** The identity import endpoint (`POST /api/v1/auth/admin/import-users`) gains a fourth `passwordPolicy`, **`auto`**, and it is now the **default** (was `none`).

  `auto` decides **per row** instead of forcing one policy on the whole batch:

  - a row with a deliverable channel — a **real email + a wired email service**, or a **phone + a wired SMS-invite path** — is **invited** (a set-your-password email, or an invitation SMS for phone-only rows), so no shared secret ever leaves the server;
  - a row with **no** deliverable channel (placeholder email, phone-only without SMS, or an email row when no email service is wired) falls back to a **temporary password**, returned once in the response with `must_change_password` stamped.

  This shrinks the temporary-password blast radius from "the whole batch" to "only the rows that genuinely can't be reached", and — unlike `invite` — `auto` **never rejects the request for missing infrastructure**: with nothing wired, every row simply degrades to temporary. The per-row outcome is surfaced on `rows[].delivery` (`email` / `sms` / `temporary`) with a batch breakdown on `summary.delivery` (also recorded in the run audit).

  The three existing policies are unchanged and still selectable explicitly:

  - `invite` — force the invite path for every row; unreachable rows are **failed** per-row (never downgraded). Pick this when a temporary-password fallback is unacceptable.
  - `temporary` — force a generated temporary password for every row.
  - `none` — identity only, no password and no invitation.

  **Behavior change to note:** callers that **omit** `passwordPolicy` previously got `none` (no credential, no outbound message); they now get `auto`, which proactively sends invitations to deliverable rows (and returns temporary passwords for the rest). Callers that want the old identity-only behavior must pass `passwordPolicy: 'none'` explicitly. Every call that already passes an explicit policy is unaffected, and the response is a strict superset (adds the `delivery` fields).

### Patch Changes

- deb7e7e: fix(plugin-auth): run better-auth adapter WRITES as system context so #2948 doesn't strip readonly identity columns (#3164)

  The better-auth ObjectQL adapter wrapped the engine so its READS carried
  `isSystem` (to bypass the control-plane org-scope read hook), but its WRITES
  passed through with no context. The static-`readonly` UPDATE strip (#2948) runs
  on any non-system update — and since the adapter carries no caller context,
  `!ctx?.isSystem` was `true`, so the strip silently DROPPED better-auth's own
  writes to readonly `sys_user` columns: `email` (change-email), `banned` /
  `ban_reason` / `ban_expires` (admin ban). Those operations returned success but
  never persisted.

  `withSystemReadContext` is renamed to `withSystemContext` (a deprecated alias is
  kept for one release) and now injects `isSystem` on `insert` / `update` /
  `delete` as well as reads. This is correct because these are the identity
  authority's own writes — user-context writes to `managedBy: 'better-auth'` tables
  are already rejected upstream by the ADR-0092 identity write guard, so the
  adapter path only ever carries better-auth's internal writes.

  Found while implementing #3043 (the INSERT-side readonly strip). This is its
  UPDATE-side dual: #3043 relocated the insert strip to the external ingress
  precisely because internal writers (this adapter included) don't declare
  `isSystem`; the pre-existing engine-level UPDATE strip has no such relocation, so
  the adapter had to declare its writes system.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

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
- Updated dependencies [83e8f7d]
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
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/rest@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- 9dbb883: Contain the blast radius of a failing optional better-auth plugin: core email/password + session auth now stays up when an optional feature plugin throws during initialization.

  Previously, one throwing optional plugin (the 15.1.0 incident: `@better-auth/oauth-provider` threw `Cannot set properties of undefined (setting 'modelName')` from a 1.6/1.7 version mix) failed the whole lazily-built better-auth instance, turning EVERY auth endpoint — sign-up, sign-in, get-session — into a 500.

  `AuthManager.buildPluginList` now classifies plugins in two tiers. Optional feature plugins (organization, admin, phoneNumber, magicLink, genericOAuth, jwt+oauthProvider as one atomic unit, sso, scim, deviceAuthorization) are constructed through an isolation wrapper: on failure the feature is skipped with a loud actionable `console.error`, recorded in `getDegradedAuthFeatures()`, and its endpoints 404 while core auth keeps working. Security-bearing plugins (bearer, twoFactor, haveIBeenPwned, customSession with its ADR-0069 authGate) still fail hard — better a hard 500 than silently weakened auth (e.g. 2FA-enrolled accounts signing in on password alone).

  The OIDC discovery mount (`/.well-known/{oauth-authorization-server,openid-configuration}`) checks the degraded set and skips advertising an IdP whose endpoints did not come up, with a clear error log instead of sending external clients into 404s.

- 01ba3b3: Fix fresh-project auth returning 500 on every endpoint (sign-up / sign-in / get-session) with `Cannot set properties of undefined (setting 'modelName')`.

  The published manifest declared `better-auth`, `@better-auth/core`, `@better-auth/oauth-provider`, and `@better-auth/sso` as `^1.6.23`, while only `@better-auth/scim` was pinned to `1.7.0-rc.1` (GHSA-j8v8-g9cx-5qf4 is fixed only in the 1.7.0 pre-release line). The framework workspace forces the whole better-auth family to `1.7.0-rc.1` via pnpm overrides, but overrides do not ship with published packages — a downstream `npx create-objectstack` install resolved the `^1.6.23` ranges to 1.6.23 (still the npm `latest`), and the resulting 1.7/1.6 mix crashes during better-auth initialization, so every fresh 15.1.0 project shipped with broken auth.

  All four packages are now pinned to the exact `1.7.0-rc.1` — the only combination the workspace actually builds and tests against. The pins will be relaxed to `^1.7.0` once a stable better-auth 1.7.0 ships. A new CI gate (`scripts/check-override-consistency.mjs`) fails whenever a pnpm-workspace override target is not reachable from a publishable package's declared range, so tested-vs-published drift like this cannot recur silently.

  - @objectstack/spec@15.1.1
  - @objectstack/core@15.1.1
  - @objectstack/types@15.1.1
  - @objectstack/platform-objects@15.1.1
  - @objectstack/rest@15.1.1

## 15.1.0

### Patch Changes

- f531a26: fix(plugin-auth): re-run membership backfill when app seeding settles (#2996)

  The ADR-0093 D6 membership backfill — the only safety net for users created
  by app seeds (raw `engine.insert` into `sys_user` bypasses better-auth's
  `user.create.after` reconciler) — ran only once on `kernel:ready`. When a seed
  bundle overruns its inline budget (`OS_INLINE_SEED_BUDGET_MS`, default 8s) it
  finishes in the background _after_ `kernel:ready`, so its users stayed
  member-less in single-org `auto` mode until the next restart re-ran the backfill.

  `AppPlugin` now emits a new **`app:seeded`** lifecycle event when an app's inline
  seed settles (success, partial, or fallback) — carrying `{ appId, overBudget }`,
  where `overBudget: true` marks the post-`kernel:ready` background case. plugin-auth
  subscribes and re-runs the (idempotent, self-guarding, opt-out-able)
  `backfillMemberships` on that signal, closing the window without waiting for a
  restart. No behavior change when a seed completes within budget, in multi-tenant
  mode, or under `invite-only` policy; `OS_SKIP_MEMBERSHIP_BACKFILL=1` still opts out.

- 4109153: Close the `@better-auth/oauth-provider` 1.7 schema drift that broke platform
  SSO (token exchange 500: `table sys_oauth_access_token has no column named
authorizationCodeId`).

  - `sys_oauth_access_token` / `sys_oauth_refresh_token`: add
    `authorization_code_id`, `resources`, `requested_user_info_claims`,
    `confirmation` (+ access-token `revoked`; + refresh-token `rotated_at`,
    `rotation_replay_response`, `rotation_replay_expires_at`).
  - `sys_oauth_consent`: add `resources`, `requested_user_info_claims`.
  - `sys_oauth_application`: add `jwks`, `jwks_uri`, `backchannel_logout_uri`,
    `backchannel_logout_session_required`, `dpop_bound_access_tokens`.
  - New platform objects for the three models 1.7 introduced:
    `sys_oauth_resource`, `sys_oauth_client_resource`,
    `sys_oauth_client_assertion` (RFC 8707 resource indicators + RFC 7523
    client-assertion replay prevention), registered in the auth manifest and
    mapped in `buildOauthProviderPluginSchema()`.
  - All camelCase→snake_case `fieldName` mappings extended accordingly, and a
    new parity test (`oauth-provider-schema-parity.test.ts`) fails the build
    whenever a future better-auth bump introduces model fields our objects or
    mappings don't cover.

- f531a26: fix(auth): align the better-auth family on 1.7.0-rc.1, implement the new adapter methods, and add the new sys_jwks columns (#2974)

  Remediating GHSA-p2fr-6hmx-4528 (`@better-auth/oauth-provider`) requires the
  1.7 plugin line, which imports `CLIENT_ASSERTION_TYPE` and other symbols that
  only exist in `@better-auth/core` 1.7.x — so the whole better-auth family is
  pinned to `1.7.0-rc.1` together (mixing a 1.7 plugin with 1.6.23 core 500s on
  sign-in). better-auth 1.7 also extends its `CustomAdapter` contract with two
  new methods, which the ObjectQL adapter now implements:

  - `consumeOne` — atomic single-row consume (find the guarded row, delete it,
    return it), used by better-auth for single-use credential consumption
    (e.g. verification tokens on the sign-in path).
  - `incrementOne` — guarded counter mutation (`field = field + delta` per
    `increment` entry plus any absolute `set` values), returning the updated row
    or `null` when the guard matches nothing.

  Both are find-then-write mirrors of the existing `delete` / `update` methods
  (ObjectQL exposes no native atomic primitive) and honour the same core/plugin
  field-name bridging.

  better-auth 1.7 also extends its `jwks` model with two new optional columns,
  `alg` (signing algorithm, e.g. `EdDSA`) and `crv` (curve, e.g. `Ed25519`), and
  writes them when minting signing keys. The `sys_jwks` platform object gains the
  matching fields — without them every JWKS write failed (`table sys_jwks has no
column named alg`), 500ing token signing and breaking session validation
  (sign-in succeeded but every authenticated request 401'd).

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
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/rest@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [a581a65]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/rest@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [e46169c]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/rest@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Minor Changes

- 824a395: Tenancy mode as a first-class capability + a single owner for the user→membership
  lifecycle (ADR-0093, Phases 1–3).

  **Tenancy service (`@objectstack/types`, `@objectstack/plugin-auth`).** plugin-auth
  registers a `tenancy` service — the single source of truth for tenancy mode
  (`mode`, `isolationActive`, `requested`, `degraded`, `defaultOrgId()`). It derives
  `isolationActive` from the presence of the `org-scoping` service, so the
  enterprise `@objectstack/organizations` package lights it up with no change.
  SecurityPlugin's RLS-strip gate and `/auth/config` (`features.multiOrgEnabled`,
  new `features.degradedTenancy`) now consume it instead of re-deriving the fact.

  **Fail-fast on degraded tenancy (`@objectstack/cli`, ADR-0093 D5).**
  `OS_MULTI_ORG_ENABLED=true` without a working `@objectstack/organizations` now
  **refuses to boot** — a deployment that requested tenant isolation must not serve
  traffic without it (tenant RLS would be silently stripped). Escape hatch:
  `OS_ALLOW_DEGRADED_TENANCY=1` boots in an explicitly branded degraded state
  (`features.degradedTenancy`). **This may halt upgrades for deployments that were
  silently degraded — intentionally; install the enterprise package or set the
  escape hatch.**

  **Membership reconciler (`@objectstack/plugin-auth`, ADR-0093 D1–D3, D6).** A
  single reconciler composed into better-auth's `user.create.after` hook owns the
  "every new user gets a membership" invariant across all creation paths (signup,
  admin create-user, import, SSO JIT). It yields to any existing membership (host
  hooks win), honors a new `membershipPolicy: 'auto' | 'invite-only'` auth option
  (default `auto`), and binds only to an unambiguous target org (single-org default;
  multi-org binds nothing). A bounded, idempotent `kernel:ready` backfill covers
  pre-existing member-less users in single-org/auto deployments
  (`OS_SKIP_MEMBERSHIP_BACKFILL=1` to opt out). The endpoint-level create-user bind
  from #2882 now delegates to this shared reconciler.

  New env vars: `OS_ALLOW_DEGRADED_TENANCY`, `OS_SKIP_MEMBERSHIP_BACKFILL`. New docs:
  Deployment → Tenancy Modes & Membership.

### Patch Changes

- da5e686: fix(auth): create-user membership bind is tenancy-mode-aware; export the ADR-0093 host API

  Multi-org runtime verification (real `@objectstack/organizations` linked into a
  live stack) caught a gap in the #2884 endpoint bind: it resolved its target org
  via `resolveDefaultOrgId` (slug='default' first), so in a multi-org deployment —
  where the bootstrap default org coexists with real tenant orgs — `/admin/create-user`
  would have bound the new user into the default org, violating ADR-0093 D3
  ("the framework never guesses in multi mode"). The bind now consults the
  `tenancy` service (`getTenancy` on the endpoint deps): single mode → default org,
  multi mode → no bind. Verified live: multi-org create-user and sign-up both leave
  the new user member-less (invites / host hooks own membership there); single-org
  behavior unchanged.

  Also exports `reconcile-membership` and `tenancy-service` from the package index
  as the public host API, and adds dogfood integration tests driving the REAL
  better-auth pipeline: sign-up membership via the reconciler hook alone, backfill
  bind + idempotency, invite-only refusal, and the yield-to-host-membership rule.

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0
  - @objectstack/rest@14.7.0

## 14.6.0

### Patch Changes

- 160d565: fix(auth): guarantee an absolute https origin for every user-facing auth URL

  Follow-up to the invitation-link fix. Several other user-facing links were
  built from the raw `config.baseUrl` with no scheme guarantee, so a bare-host
  `baseUrl` (e.g. `cloud.objectos.ai`) produced relative-looking, unclickable
  links. All now flow through the hardened `getCanonicalOrigin()` (prepends
  `https://` when the scheme is missing, trims a trailing slash):

  - better-auth `baseURL` — the reset-password, verify-email and magic-link
    email links are derived from it.
  - OAuth `loginPage` / `consentPage` redirect targets.
  - Device-authorization `verificationUri`.
  - The phone-invite SMS `{{baseUrl}}`.

  Deployments that already configure an absolute `baseUrl` are unaffected.

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
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/rest@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Minor Changes

- a348394: feat(auth): identity write guard — `managedBy: 'better-auth'` is now enforced at the engine (ADR-0092 D2/D3/D6)

  Every object whose schema declares `managedBy: 'better-auth'` (`sys_user`,
  `sys_member`, `sys_session`, `sys_api_key`, …) is now protected by engine
  `beforeInsert` / `beforeUpdate` / `beforeDelete` hooks registered by
  plugin-auth: **user-context** writes through the generic data path are
  rejected fail-closed with `403 PERMISSION_DENIED`, closing the hole where a
  wildcard admin permission set could raw-write any identity column (including
  `email` and credential stamps) via the data API. Internal writes are
  unaffected — the better-auth adapter, `isSystem` plugin/system contexts, and
  the identity import keep working unchanged.

  The only opening is a per-object update whitelist
  (`registerManagedUpdateWhitelist(object, fields)`): non-whitelisted fields are
  stripped from the payload, and a payload that strips to nothing throws. The
  first registration ships here: `sys_user → { name, image }` (pure profile
  fields), backed by the new shared `SYS_USER_PROFILE_EDIT_FIELDS` /
  `SYS_USER_IMPORT_UPDATE_FIELDS` constants — the import upsert's field
  discipline is now derived from the same module (subset-by-construction, no
  drift).

  After a guarded profile edit, an `afterUpdate` companion hook re-writes the
  user's cached `{session, user}` snapshots in better-auth's secondary storage
  (same TTL, mirror of better-auth's own `refreshUserSessions`) so session
  reads stay coherent; it rewrites rather than deletes, and no-ops when no
  secondary storage is wired.

  Migration note: server-side scripts that previously updated identity tables
  with a **user** execution context must either run with a system context
  (`{ isSystem: true }`) if they are genuinely internal, or move to the
  dedicated auth endpoints (invite / create-user / set-user-password / ban /
  better-auth APIs). Flows and automations that wrote non-profile `sys_user`
  columns under a user identity are now filtered the same way.

- 5bced2f: feat(auth): `passwordPolicy: 'none'` is the identity import's new default — import provisions identity, not credentials

  `POST /api/v1/auth/admin/import-users` now supports (and defaults to)
  `passwordPolicy: 'none'`: accounts are created without a credential record
  (better-auth's optional-password create), so no password material is
  generated, returned, or distributed at all. Users first sign in through a
  channel — phone OTP, magic link, or a password-reset link — and the Console's
  existing credential-less detection (`hasLocalPassword()` → set-initial-password)
  nudges them to set a password afterwards.

  The `invite` policy also no longer mints a throwaway password: it creates the
  same credential-less account and sends the set-your-password invitation
  (better-auth's reset flow creates the credential record on first set).
  `temporary` is unchanged and remains the fallback for deployments without
  email/SMS infrastructure.

  Breaking-ish note: `passwordPolicy` was previously required — requests that
  omitted it got a 400. They now succeed with the `none` behavior.

- e2c05d6: feat(auth/i18n): localised, tenant-customisable phone SMS texts (#2815)

  The OTP and invitation SMS bodies were hard-coded English. They now resolve
  in two layers: a `sys_notification_template` row for
  `(auth.phone_otp | auth.phone_invite, channel 'sms', locale)` — editable in
  Setup, seeded once with built-in en/zh rows, tenant edits never overwritten —
  falling back to the bundled bilingual texts. The locale follows the
  deployment default (`localization.locale` setting, live-rebound); per-user
  locale is deferred until `sys_user` grows a locale column. The OTP wording
  is purpose-neutral (one provider template covers sign-in and reset, and the
  SMS reveals nothing about what the code unlocks). Template lookups are
  best-effort — an outage never blocks an OTP send — and the no-OTP-in-logs
  red line is unchanged.

### Patch Changes

- 3fd87b2: fix(auth): invitation accept link is now an absolute URL under the Console base

  `sendInvitationEmail` built the accept URL straight from `config.baseUrl` with
  no scheme guarantee and no UI mount prefix — `${baseUrl}/accept-invitation/<id>`.
  Two problems surfaced in real deployments:

  1. When `baseUrl` was a bare host (e.g. `cloud.objectos.ai`, no scheme), the
     emailed link was relative-looking; email clients would not linkify it and
     clicking it went nowhere.
  2. The accept-invitation page is a Console SPA route mounted under `uiBasePath`
     (default `/_console`) — the same router/basename as `/login`, `/register`
     and `/oauth/consent`, and the exact link the Console itself generates for its
     "copy invitation link" action (`${origin}${BASE_URL}accept-invitation/<id>`).
     The root-path link omitted that prefix, so it 404'd at the host root instead
     of resolving to the page.

  The link is now built as
  `${origin}${uiBasePath}/accept-invitation/<id>` via a hardened
  `getCanonicalOrigin()` that guarantees an absolute origin (prepends `https://`
  when `baseUrl` has no scheme). The scheme hardening also applies to the OAuth
  issuer / consent / device-flow URLs that share the helper. Deployments that
  mount the Console elsewhere are honoured through the existing `uiBasePath`
  config.

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [4d9dd7b]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/rest@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- 9887465: fix(auth): make the self-service "Resend Verification Email" action work

  better-auth's stock `POST /send-verification-email` requires `{ email }` in the
  body, but the `sys_user` `resend_verification_email` action (record-header
  button, "email unverified" record alert, and record-section quick action) fires
  with an empty body — so the request bounced with `[body.email] Invalid input:
expected string, received undefined` and the button was permanently broken. A
  thin wrapper route now defaults the address to the authenticated caller's own
  session email when the body omits it, then re-dispatches through the real route.
  An explicitly-supplied `email` (admin / verify-screen path) passes through
  untouched.

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/rest@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Minor Changes

- 2a71f48: feat(auth): admin direct user management, phone sign-in, and identity bulk import (#2766, re-scoped #2758)

  `sys_user` is managed by better-auth and its generic CRUD is suppressed, so
  until now the only way to add a teammate was the email-dependent invite flow.
  This ships three staged capabilities:

  - **Admin direct user management** — `POST /api/v1/auth/admin/create-user`
    and a wrapped `POST /api/v1/auth/admin/set-user-password` (ADR-0068
    platform-admin gate; better-auth pipeline so credentials are real). Optional
    generated temporary password (returned once, never persisted or logged) and
    a new `sys_user.must_change_password` flag enforced through the ADR-0069
    authGate (`403 PASSWORD_EXPIRED` until the user changes it). New
    `create_user` action and upgraded `set_user_password` action on the Users
    list — pure schema, no frontend changes.
  - **Phone sign-in (opt-in `auth.plugins.phoneNumber`)** — better-auth
    phoneNumber plugin, phone+password only (`POST /sign-in/phone-number`);
    OTP flows stay off until SMS infrastructure exists. Adds
    `sys_user.phone_number` (unique) / `phone_number_verified`. Phone-only
    accounts get an undeliverable placeholder email
    (`u-<random>@placeholder.invalid`, never derived from the phone number);
    all auth mail callbacks refuse placeholder recipients.
  - **Identity bulk import** — `POST /api/v1/auth/admin/import-users` accepts
    the same payloads as the generic import routes (rows/csv/xlsx, dryRun,
    upsert by email or phone) but writes every row through better-auth.
    Password policies: `invite` (reset-link email per created user; requires an
    EmailService) and `temporary` (per-row one-time passwords + forced change).
    Sync only, ≤500 rows per request; no undo; upsert updates touch profile
    fields only and can never reset an existing user's password.
    `prepareImportRequest` and the CSV/xlsx parsers moved from rest-server.ts
    to an exported `import-prepare.ts` module (behavior unchanged).

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
    (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
    transports plus a dev log fallback. Configured through the new `sms`
    settings namespace (live provider rebind, encrypted secrets, send-test
    action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
    persistence and NO body logging — SMS bodies carry OTP codes.
  - **Messaging `sms` channel** — registered at kernel:ready when an `sms`
    service is present; `notify(channels:['sms'])` resolves
    `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
    inherits outbox retry/dead-letter.
  - **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
    `sendPasswordResetOTP` now deliver via SMS, enabling
    `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
    `/phone-number/request-password-reset` + `/reset-password` (self-service
    reset). Without a deliverable SMS service they keep failing loudly
    (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
    Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
    per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
    across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
    rules, and OTP codes never reach logs or error messages.
  - **Import SMS invites** — `/admin/import-users`'s `invite` policy now
    supports phone-only rows: a credential-free invitation SMS points the
    employee at phone-OTP first sign-in followed by self-set password; mixed
    files validate the reachable channel per row.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
- Updated dependencies [bea4b92]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/rest@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/types@14.1.0

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
  - @objectstack/types@14.0.0

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

### Minor Changes

- 57b89b4: feat(mcp): the MCP surface is now **default-on** — a core platform capability (#2698)

  `/api/v1/mcp` is served (and advertised in `/discovery`) out of the box; the
  OAuth 2.1 authorization track and Dynamic Client Registration follow it, so a
  fresh deployment is connectable by any MCP client with zero configuration.
  Operators opt OUT with `OS_MCP_SERVER_ENABLED=false`.

  - New single decision point `isMcpServerEnabled()` in `@objectstack/types`
    (default on; explicit `false`/`0`/`off`/`no` disables). The runtime
    dispatcher's `/mcp` route gate, the CLI's MCP plugin auto-load, the REST
    `/discovery` advertisement, and the auth service's OAuth/DCR follow-defaults
    all delegate to it — the served route, the advertised route, and the
    authorization track can never disagree.
  - The env var is now effectively tri-state: unset → HTTP surface on;
    explicit `true` → additionally auto-start the long-lived **stdio** transport
    at boot (unchanged, still opt-in — a default must not claim the process's
    stdin/stdout); explicit `false` → everything off, fail-closed (404, no
    metadata, no DCR).
  - The OAuth 2.1 TLS rule is unaffected: on a plain-HTTP non-loopback origin
    the OAuth track stays dark and the default-on surface remains API-key-only.

- 5be00c3: feat(mcp): spec-compliant OAuth 2.1 authorization for `/api/v1/mcp` (#2698)

  Any OAuth-capable MCP client (claude.ai custom connectors, Claude Desktop,
  Claude Code) can now connect to a deployment **self-serve**: no admin-minted
  API key, no central registry — you sign in through the browser as yourself and
  every tool call runs under your own permissions and row-level security.

  **Each deployment is its own authorization server**, backed by the embedded
  better-auth instance (`@better-auth/oauth-provider`). Rationale for the design
  decisions lives in #2698; the moving parts:

  - **Discovery**: `/.well-known/oauth-protected-resource` (RFC 9728, incl. the
    path-inserted variant for `/api/v1/mcp`) and
    `/.well-known/oauth-authorization-server` (RFC 8414, incl. the path-inserted
    variant for the `/api/v1/auth` issuer) are served from the deployment origin.
    401s from `/api/v1/mcp` advertise the resource metadata via
    `WWW-Authenticate`, so clients bootstrap the flow automatically.
  - **Dynamic Client Registration (RFC 7591)** is enabled (unauthenticated, as
    the MCP spec requires) whenever the MCP surface is on — every deployment is a
    distinct AS, so clients cannot ship pre-registered IDs. Force it either way
    with `OS_OIDC_DCR_ENABLED` or the new `plugins.dynamicClientRegistration`
    auth-config field. The embedded AS itself auto-enables whenever the MCP
    surface is on — which is now the default (explicit
    `OS_OIDC_PROVIDER_ENABLED=false` still wins).
  - **Authorization-code + PKCE** flow with RFC 8707 resource binding: access
    tokens are minted with `aud=<origin>/api/v1/mcp` and verified locally
    (signature/issuer/audience/expiry) against the deployment's own JWKS —
    fail-closed parity with API keys: unknown/expired/wrong-audience tokens,
    sub-less M2M tokens, or a presented-but-invalid bearer never fall back to an
    ambient session, they 401.
  - **Token → ExecutionContext**: a valid access token resolves to the same
    principal-bound `ExecutionContext` as every other credential, single-sourced
    through `resolveAuthzContext` — OAuth adds a second _provenance_ for the
    principal, not a second authz model. `ExecutionContext` gains an optional
    `oauthScopes` field carrying the token's granted scopes.
  - **Coarse scopes → tool families**, enforced at tool dispatch: `data:read`
    (list/describe/query/get), `data:write` (create/update/delete),
    `actions:execute` (list_actions/run_action). Constants live in
    `@objectstack/spec/ai` (`MCP_OAUTH_SCOPES`). Tools outside the grant are not
    registered — and therefore rejected — for that request. API-key and session
    principals are unaffected (not scope-limited).
  - **TLS required, localhost exempt** (OAuth 2.1): on a plain-HTTP non-loopback
    origin the OAuth track stays dark (no metadata, no bearer acceptance) and the
    endpoint remains API-key-only. Local clients reach intranet deployments;
    claude.ai web connectors additionally need public HTTPS reachability.

  **API keys are unchanged** (dual-track): `x-api-key` / `Authorization: ApiKey` /
  `Authorization: Bearer osk_…` keep working exactly as before for CI and
  headless agents — covered by new regression tests.

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
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/types@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0
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
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Minor Changes

- 07f055c: feat(auth): last-login audit fields — sys_user.last_login_at / last_login_ip (ADR-0069 D7)

  Completes the ADR-0069 D7 identity-field set: `sys_user.last_login_at` and
  `sys_user.last_login_ip` are stamped on every successful `/sign-in/email` by
  `AuthManager.stampLastLogin` (a best-effort after-hook, independent of the
  lockout-accounting path so it runs even when lockout is disabled). The IP is
  taken from the trusted forwarded headers (`x-forwarded-for` →
  `cf-connecting-ip` → `x-real-ip`), the same precedence as the D5 IP allow-list
  middleware, and capped to the 45-char column width. Both fields are
  system-managed, read-only, and land in the Admin group of `sys_user`.

  The rest of ADR-0069 P1 (password complexity/history/expiry, HIBP, account
  lockout, enforced MFA) was already implemented; this fills the one missing D7
  field pair. ADR-0069 status updated Proposed → Accepted (P1/P2 implemented)
  with an implementation-status matrix reflecting what is landed vs the remaining
  P2 gaps (per-org IP ranges, shared-store rate limiting).

- 1b1b34e: feat(auth): shared cross-node rate-limit + session store via the cache service (ADR-0069 D2)

  Multi-node deployments previously rate-limited **per process** — better-auth's
  default `rateLimit` store is in-memory, so each node counted independently and
  an attacker could rotate nodes to bypass the limit. `AuthPlugin` now wires the
  kernel `cache` service as better-auth's `secondaryStorage` and flips
  `rateLimit.storage` to `'secondary-storage'`, so rate-limit counters (and the
  session cache) are enforced against **one shared store across every node** —
  shared iff the cache service is (Redis adapter in a cluster; memory single-node,
  where behavior is unchanged). When no cache service is registered the plugin
  logs a warning that a multi-node deployment needs a shared cache (ADR-0069
  honesty — no silent per-process limiting presented as global).

  New `cacheSecondaryStorage(cache)` adapter (`ICacheService` → better-auth
  `SecondaryStorage`). Note: the cache has no atomic increment, so under high
  concurrency the get→set counter path can slightly over-count — acceptable for a
  rate limiter and strictly better than independent per-node counters; a future
  cache adapter exposing atomic INCR can add an `increment` method for exact
  counting.

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
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- 59576d0: fix(auth): restore the admin gate on POST /admin/oauth-application/toggle-disabled after ADR-0068

  ADR-0068 stopped `customSession` from synthesizing `user.role = 'admin'`;
  canonical roles now arrive in `user.roles[]` with `user.isPlatformAdmin` as a
  derived alias. The OAuth-client enable/disable route was missed in that
  migration and still gated on `session.user.role !== 'admin'`, which now rejects
  even platform admins (the scalar is no longer synthesized). It now mirrors the
  sibling /admin/unlock-user gate: `isPlatformAdmin` / `platform_admin` in
  `roles[]`, with the legacy `role` scalar as a fallback.

  Also corrects the now-stale `customSession()` doc comment in auth-manager that
  still described the removed `user.role = 'admin'` overwrite.

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- cbc8c02: feat(auth): opt-in SSO domain verification (ADR-0024 ②)

  Add DNS-TXT domain-ownership verification for external SSO providers, gated
  behind a new `OS_SSO_DOMAIN_VERIFICATION` flag (off by default — today's
  register→login behavior is unchanged). When enabled, `@better-auth/sso` mounts
  `/sso/request-domain-verification` + `/sso/verify-domain` and enforces that a
  provider's email domain be DNS-verified before it may complete a login.

  - `auth-manager.ts`: new `ssoDomainVerification` enabled-flag (readBooleanEnv) →
    passes `domainVerification: { enabled: true }` to `sso()`; public
    `isSsoDomainVerificationEnabled()` helper.
  - `register-sso-provider.ts`: `runRequestDomainVerification` /
    `runVerifyDomain` bridges — re-dispatch through the gated better-auth
    endpoints and reshape the response into the `{ success, data }` envelope the
    `sys_sso_provider` action `resultDialog` reads (request → ready-to-paste DNS
    TXT record; verify → clear success/error). A bare 404 from the inner endpoint
    is surfaced as "not enabled for this environment".
  - `auth-plugin.ts`: mount the two bridges as rawApp routes
    (`/admin/sso/{request-domain-verification,verify-domain}`).
  - `sys_sso_provider`: `domain_verified` field + list column + the two actions;
    `domainVerified` documented in `AUTH_SSO_PROVIDER_SCHEMA`.

- ce0b4f6: Auth: password expiry — the session-validation gate (ADR-0069 D1, P1)

  Builds the **authentication-policy session gate** ADR-0069 needs and uses it for password expiry. When `password_expiry_days` (new `auth` setting, 0 = off) is exceeded, an authenticated user is blocked from protected REST resources with `403 PASSWORD_EXPIRED` until they change their password — while auth + remediation paths stay reachable.

  - **core**: new pure `evaluateAuthGate` / `isAuthGateAllowlisted` helper (`@objectstack/core/security`) — single source of truth for the allow-list (auth endpoints, change-password, health, UI-bootstrap reads).
  - **plugin-auth**: `customSession` computes the gate posture once and attaches `user.authGate`; `computeAuthGate` reads `sys_user.password_changed_at` vs the configured window; `password_changed_at` is stamped on sign-up / change / reset; `isAuthGateActive()` keeps the gate **zero-overhead** when off.
  - **platform-objects**: new `sys_user.password_changed_at` column.
  - **rest**: `resolveExecCtx` carries `authGate`; `enforceAuth` blocks gated sessions (independent of `requireAuth`) using the core allow-list.
  - **service-settings**: new `password_expiry_days` field.

  Default-off / additive (no upgrade behavior change); a null `password_changed_at` never expires (existing users). Per ADR-0049 the setting ships with its enforcement; timestamps written as `Date` (ADR-0074).

  This gate is the shared seam for **enforced MFA** (ADR-0069 D3), which lands next as a small addition (a second `authGate` branch). The dispatcher/MCP path is a follow-up (tracked in #2375); the REST surface the Console uses is fully gated here.

- 90bce88: Auth: enforced MFA (ADR-0069 D3, P1)

  Completes the session-validation gate: when `mfa_required` (new `auth` setting) is on, an authenticated user without TOTP enrolled is blocked from protected resources with `403 MFA_REQUIRED` once their `mfa_grace_period_days` (default 7) window elapses — while the two-factor enrollment endpoints stay reachable so they can comply. Reuses the `authGate` seam shipped in #2388 (a second posture branch in `computeAuthGate`).

  - New `auth` settings `mfa_required` (toggle) + `mfa_grace_period_days`; enabling `mfa_required` also force-enables the `twoFactor` plugin so `/two-factor/*` enrollment exists.
  - New `sys_user.mfa_required_at` column — the grace clock, stamped lazily the first time a user is seen required-but-unenrolled.
  - `isAuthGateActive()` now also trips on `mfa_required` (still zero-overhead when off).

  Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

  **Needs an objectui follow-up**: the Console should handle a `403 MFA_REQUIRED` by showing the TOTP-enrollment prompt. Per-org `sys_organization.require_mfa` and the dispatcher/MCP gate remain follow-ups (#2375).

- 3209ec6: Auth: session controls — idle timeout, absolute max lifetime, concurrent cap (ADR-0069 D4, P2)

  Adds three `auth` session-control settings (all 0 = off):

  - `session_idle_timeout_minutes` — sign a user out after inactivity. Enforced in `customSession`: touches `sys_session.last_activity_at` (throttled to once a minute) and, once the idle window is exceeded, revokes the session.
  - `session_absolute_max_hours` — cap total session lifetime regardless of refresh; revoked once `created_at` is older than the cap.
  - `max_concurrent_sessions_per_user` — on sign-in, keep the newest N live sessions and revoke the rest (oldest first).

  Revocation expires the session in place (`expires_at` set to the past + `revoked_at` / `revoke_reason` stamped on new `sys_session` columns), so better-auth returns no session on the next request → the Console's existing 401 → login redirect handles it (no client change). Note: better-auth garbage-collects expired sessions, so the `revoke_reason` audit row is best-effort; the enforcement (session killed) is not.

  Default-off / additive (no upgrade behavior change); per ADR-0049 each setting ships with its enforcement.

- 8c84c97: Auth: IP allow-list — network gating on the auth routes (ADR-0069 D5, P2)

  Adds an `allowed_ip_ranges` auth setting (CIDR ranges or exact IPs; empty = no restriction). A Hono middleware registered ahead of the better-auth handler in the auth-route registration rejects auth requests from a client IP outside the ranges with `403 IP_NOT_ALLOWED`, before they reach better-auth.

  - Client IP is read trust-proxy-aware from `x-forwarded-for` (first hop) / `cf-connecting-ip` / `x-real-ip`.
  - The public render helpers (`/config`, `/bootstrap-status`) are exempt so a blocked client still gets a clean login page + a clear error.
  - **Fails OPEN** when the client IP can't be determined (no proxy header), so a misconfigured proxy is a no-op rather than a lockout — an admin enabling this must ensure forwarded headers are trusted.
  - IPv4 CIDR (`a.b.c.d/n`) + exact IPv4/IPv6 matching.

  Default-off / additive; per ADR-0049 the setting ships with its enforcement.

- e011d42: Auth: per-org MFA + dispatcher/MCP gate — complete the ADR-0069 enforced-MFA story

  Two follow-ups that make enforced MFA total:

  - **Per-org `sys_organization.require_mfa`** — an org may require MFA above the global floor. `computeAuthGate` now treats the active org's `require_mfa` as an effective MFA requirement even when the global `mfa_required` is off; `isAuthGateActive()` stays cheap via a 60s-TTL "any org requires MFA" cache (lazy background refresh), so a brand-new per-org requirement activates the gate on the next request without per-request org queries.
  - **Dispatcher/MCP gate** — the auth-policy gate now also runs in the runtime dispatcher (after `resolveExecutionContext`), so MCP / GraphQL / embedded data paths enforce `PASSWORD_EXPIRED` / `MFA_REQUIRED` consistently with the REST seam (reusing the shared `evaluateAuthGate` allow-list). Previously only the REST surface (the Console) was gated.

  Default-off / additive. Per ADR-0049 each setting ships with its enforcement.

- 6e5bdd5: feat(auth): SAML 2.0 SSO via @better-auth/sso (ADR-0069 P3)

  `@better-auth/sso@1.6.20` ships full SAML 2.0 (samlify-backed), so SAML needs no
  custom plugin. Adds a `register_saml_provider` action on `sys_sso_provider` and a
  `runRegisterSamlProviderFromForm` bridge that reshapes the flat admin form into the
  nested `samlConfig` and re-dispatches through `/sso/register` (admin gate enforced),
  returning the SP ACS + metadata URLs to configure on the IdP. Updates ADR-0069 to
  correct the stale "SAML is out of better-auth core" premise.

### Patch Changes

- 18f9713: Auth: surface "SSO Providers" in the Setup app nav when SSO is enabled (ADR-0024 / cloud#551)

  The `sys_sso_provider` admin object (register / list / delete external OIDC IdPs) had no navigation entry, so an admin could only reach it by direct URL. `AuthPlugin` now contributes an **"SSO Providers"** entry into the Setup app's **Access Control** group — but only when the external-IdP RP is wired (`AuthManager.isSsoWired()`, which captures both self-host `OS_SSO_ENABLED` and the cloud per-env `planAllowsSso` arriving via `plugins.sso`). Owning-plugin-contributes pattern (ADR-0029 K2), mirroring `plugin-security`. `isSsoWired()` is made public for this gate.

- 7cf81a7: Auth: org-scope registered SSO/SAML providers so any org admin can manage them (ADR-0024 / cloud#551)

  `@better-auth/sso`'s provider-management endpoints (delete / update / domain verification) gate ORG-LESS providers on `provider.userId === caller` — only the original registrar could manage them, so a second org admin couldn't delete or verify an IdP someone else registered. The register bridges now resolve the caller's active organization (best-effort, via a `/get-session` re-dispatch) and scope the provider to it, so management gates on `isOrgAdmin` instead — **any** org owner/admin can manage the environment's IdPs. Falls back to org-less (no behavior change) when no active org is set.

  Verified E2E: an OIDC provider registered through the form lands with `organization_id` set to the env's org (was null); register + delete still succeed.

- d7a88df: Auth: SSO quality polish (ADR-0024 / cloud#551)

  - **plugin-auth**: `OS_OIDC_PROVIDER_ENABLED` / `OS_SSO_ENABLED` / `OS_SCIM_ENABLED` now parse with the shared `readBooleanEnv` helper (same as `OS_AUTH_TWO_FACTOR` etc.), so the platform-standard truthy set works (`true`/`1`/`yes`/`on`, case-insensitive) instead of only the literal `'true'` — a repeated operator footgun where `OS_SSO_ENABLED=1` silently parsed as disabled. Added unit tests.
  - **platform-objects**: `sys_sso_provider`'s list view gets a per-object empty state ("No SSO providers yet" + a pointer to "Register SSO Provider"), replacing the shared identity-object copy ("records are created automatically … cannot be added here") which is wrong for this object — it HAS a register action.

- 4f8f108: Auth: make the open-source SSO-provider registration form produce a usable IdP (ADR-0024 / cloud#551)

  The `sys_sso_provider` `register_sso_provider` UI action posted FLAT form fields to `@better-auth/sso`'s `/sso/register`, which expects the OIDC fields NESTED under `oidcConfig`. The top-level `clientId`/`clientSecret` were Zod-stripped, so the form persisted an `oidc_config = null` provider that could never complete a login ("Invalid SSO provider").

  - **plugin-auth**: new shared `runRegisterSsoProviderFromForm` helper reshapes the flat form body into the nested shape and re-dispatches it through the real `/sso/register` (so the admin gate, the public-routable `trustedOrigins` allowance, discovery hydration, and secret handling all still run). Exposed via a new `/admin/sso/register` bridge route on the host `AuthPlugin`. (The cloud per-env runtime mounts the same helper in its `AuthProxyPlugin` — mirrors `set-initial-password`.)
  - **platform-objects**: `register_sso_provider` retargets to `/api/v1/auth/admin/sso/register` and gains `discoveryEndpoint`, `scopes`, and attribute-mapping (`mapId`/`mapEmail`/`mapName`) fields. Open mechanism — keeps runtime IdP registration self-service in the OSS edition.

  Verified E2E: an admin registers an external OIDC IdP from the flat form → a member logs in through it (JIT-provisioned, `sys_account.provider_id` set); a non-admin is rejected (403) before discovery runs.

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
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Minor Changes

- 21b3208: Auth: password complexity policy (ADR-0069 D1, P1)

  Adds `password_require_complexity` (toggle, default off) + `password_min_classes` (1–4, default 3) to the `auth` password-policy settings. A custom validator runs in the better-auth `before` hook on `/sign-up/email`, `/reset-password`, and `/change-password`, rejecting passwords that use fewer than `password_min_classes` of the four character classes (upper / lower / digit / symbol) with `PASSWORD_POLICY_VIOLATION` — better-auth natively enforces only min/max length.

  Default-off and additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement. No new identity fields. Continues the ADR-0069 P1 password-policy work alongside the HIBP breached-password reject (#2361).

- 9b5bf3d: Auth: password history / no-reuse (ADR-0069 D1, P1)

  Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

  Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

### Patch Changes

- caa3ef4: Auth: trust public-routable external-IdP origins at SSO registration (ADR-0024 / cloud#551)

  `@better-auth/sso`'s discovery validation requires every IdP endpoint origin to be in `trustedOrigins` — even for a publicly-routable IdP. That broke ADR-0024's "register your OIDC IdP at runtime, no boot config" promise: registering any external IdP returned `400 discovery_untrusted_origin` unless the operator had pre-listed it.

  When the external-SSO RP is enabled, `trustedOrigins` is now exposed as a per-request function that, for a `POST /sso/register` | `/sso/update-provider`, additionally trusts the **public-routable** issuer / `oidcConfig` endpoint origins declared in the request body (via `@better-auth/core`'s own `isPublicRoutableHost`). Private / internal / loopback hosts are never auto-trusted — they still require explicit `trustedOrigins` config (the documented SSRF escape hatch), and better-auth's own DNS-resolution checks still apply.

  Verified: a same-origin public IdP (GitLab.com — issuer and all discovered endpoints on one origin, like Okta / Entra / Auth0 / Keycloak) now registers at runtime with no boot config (was a hard 400). The admin gate still fires first (a non-admin is rejected before discovery runs). Note: IdPs that split endpoints across multiple domains (e.g. Google's `accounts.google.com` + `oauth2.googleapis.com`) still need those extra origins in `trustedOrigins`.

- 22b32c1: Auth: admin-gate self-service SSO provider registration + default-role JIT (ADR-0024 / cloud#551)

  `@better-auth/sso`'s `POST /sso/register` only enforces org-admin when `body.organizationId` is supplied — a **global** (org-less) provider passed on nothing but a valid session, so any authenticated env member could register an env-wide external IdP (a JIT-provisioning / login-routing vector). This closed the "registerSSOProvider is admin-only" requirement of ADR-0024's first slice.

  - **plugin-auth**: a `before`-hook on `/sso/register` now requires the caller to be a platform admin OR an owner/admin of their active org, regardless of `organizationId`. Fail-closed; unauthenticated requests still fall through to `sessionMiddleware` (→ 401). New helpers `resolveActor()` (hook-order-independent cookie/bearer resolution) and `isOrgOrPlatformAdmin()` (mirrors `customSession`'s role derivation; reads via `withSystemReadContext`).
  - **plugin-auth**: `sso()` now receives `organizationProvisioning.defaultRole:'member'` so a first-time federated login lands with an explicit role (over SecurityPlugin's `member_default` baseline).

  Additive and fail-closed — no behavior change for legitimate admins. The SSO mechanism stays framework-open (no identity-governance added).

- 1e8a813: feat(auth): surface `features.sso` in the public `/auth/config` response

  `getPublicConfig()` reported every other auth capability flag (`oidcProvider`,
  `twoFactor`, `multiOrgEnabled`, …) but omitted enterprise SSO, even though the
  manager already computes whether the domain-routed `@better-auth/sso` plugin is
  wired (`OS_SSO_ENABLED` / `plugins.sso`). Without it the login UI had no signal
  to gate on, so it rendered a "Sign in with SSO" button unconditionally — and on
  a self-hosted / local deployment where SSO isn't wired, clicking it only then
  surfaced "No SSO provider is configured for this email domain."

  The config now includes `features.sso`. `getPublicConfig()` returns the coarse
  "is the plugin wired" flag — resolved with the EXACT logic that decides whether
  the plugin is mounted in `buildPlugins()`, so the advertised capability can never
  disagree with the actual `/sign-in/sso` route. The `/auth/config` route then
  refines it to "usable" via the new `AuthManager.isSsoUsable()`, which additionally
  requires at least one `sys_sso_provider` row to exist — so a freshly-enabled but
  unconfigured SSO setup doesn't advertise a button that errors for everyone.
  `isSsoUsable()` only queries when wired and fails open to the wired flag on any
  introspection error (no data engine, query failure), so config never 500s. The
  console login form consumes `features.sso` to hide the button (objectui side).

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
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/types@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0
  - @objectstack/types@10.1.0

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
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/types@9.11.0

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
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- 0d4e3f3: feat(auth): password-policy & session settings — live, enforced (P0 security)

  Extends the existing `auth` settings manifest (global scope) with the security policy keys that are **genuinely enforced today**, rather than standing up a new `security` namespace full of non-functional toggles (which would be false surface):

  - **Password policy** — `password_min_length` (default 8), `password_max_length` (default 128). Enforced by better-auth on sign-up and password reset.
  - **Sessions** — `session_expiry_days` (default 7, absolute lifetime), `session_refresh_days` (default 1, refresh threshold).

  These ride the existing `AuthPlugin.bindAuthSettings` → `AuthManager.applyConfigPatch` path (read on `kernel:ready`, re-applied live via `settings.subscribe('auth')`, which invalidates the cached better-auth instance). Days are converted to seconds for better-auth's `session.{expiresIn,updateAge}`; unset (`source: 'default'`) and malformed/non-positive values are ignored so the provider default holds. Ships en + zh-CN translations.

  Deliberately **out of scope** (no enforcement exists, so they're not declared as settings): MFA-required, IP allowlist, SSO/SAML, SCIM, API rate limits, password complexity/rotation/history. These are real features to be built, not settings toggles.

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
  - @objectstack/platform-objects@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- 1b82b64: auth: expose `isPlatformAdmin` on the customSession user payload

  The session already derives a coarse `admin` role for platform admins or
  active-org admins, but never surfaced the underlying platform-admin signal.
  Console action `visible` CEL predicates need it to gate platform-admin-only
  object actions (e.g. `sys_environment.change_plan`) without hiding org-admin
  actions. Both `customSession` return paths now carry the boolean; org-admins
  who are not platform admins correctly get `isPlatformAdmin: false`.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/types@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Minor Changes

- f533f42: Settings namespace environment overrides now use the canonical ObjectStack
  `OS_<NAMESPACE>_<KEY>` form, with no unprefixed aliases. For example,
  `ai.openai_base_url` is now `OS_AI_OPENAI_BASE_URL`, and
  `feature_flags.ai_enabled` is now `OS_FEATURE_FLAGS_AI_ENABLED`.

  The AI service now treats a stored or env-locked `provider=memory` setting as
  an explicit override, while the manifest default still leaves boot-time
  provider auto-detection intact.

  The auth plugin now binds the `auth` settings namespace to better-auth runtime
  configuration, exposes an extension hook for provider packages, and includes a
  basic Google sign-in implementation configured either in Setup → Authentication
  or by deployment-level `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

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
  - @objectstack/platform-objects@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

### Patch Changes

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

- b7a4f14: fix(dev): surface the seeded dev-admin credentials in the `serve` startup banner.

  When the runtime seeds the dev admin on an empty DB, the confirmation was
  emitted via `ctx.logger` during `runtime.start()` — inside serve's boot-quiet
  window — so it was swallowed and never reached the console. plugin-auth now
  records the seed result on the `auth` service and `serve` prints it in the
  ready banner (after stdout is restored), e.g.:

  ```
    🔑  Dev admin: admin@objectos.ai / admin123
        seeded on empty DB · dev only — do not use in production
  ```

  Shown only when an admin was actually seeded this boot (empty DB) — never on a
  DB that already had a user, so stale credentials are never displayed. Visible
  in both `serve --dev` and `os dev` (the child's stdout is inherited).

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

- c72daad: ADR-0029 D7 — Setup app navigation contributions.

  Adds the UI-layer analog of object `own`/`extend`: a package can contribute
  navigation items into an app it does not own, so a shared admin app can be a
  thin shell while each capability plugin ships the menu for the objects it owns.

  - **`@objectstack/spec`** — new `NavigationContributionSchema` (`{ app, group?,
priority, items }`) and an optional `navigationContributions` field on the
    manifest.
  - **`@objectstack/objectql`** — `SchemaRegistry.registerAppNavContribution()`
    plus lazy merge in `getApp` / `getAllApps` (by target group id + priority,
    cloning so the stored app is never mutated); the engine wires
    `manifest.navigationContributions` during app registration.
  - **`@objectstack/platform-objects`** — the Setup app becomes a **shell** of
    empty group anchors; its entries for platform-objects-owned objects move to
    `SETUP_NAV_CONTRIBUTIONS`.
  - **`@objectstack/plugin-auth`** — registers `SETUP_NAV_CONTRIBUTIONS` alongside
    the Setup app it already registers.
  - **`@objectstack/plugin-webhooks`** — contributes its `Webhooks` /
    `Webhook Deliveries` entries into the Setup `group_integrations` slot (it owns
    `sys_webhook` / `sys_webhook_delivery` per K2.a), demonstrating end-to-end
    cross-plugin contribution.

  The rendered Setup nav is identical to the former static artifact — just
  assembled from its owners. A disabled/absent capability contributes nothing and
  its slot stays empty (in addition to the existing `requiresObject` gating).
  This unblocks moving each remaining K2 domain's menu out of the monolith with
  its objects.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0
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
  - @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- 74470ad: **New `account` App for self-service identity management + `App.hidden` shell hint**

  Adds a dedicated **Account** App (`name: 'account'`, icon `user-circle`) that exposes the three end-user identity surfaces:

  - **Two-Factor Authentication** — `sys_two_factor`
  - **Linked Accounts** — `sys_account`
  - **OAuth Applications** — `sys_oauth_application`

  The app declares **no** `requiredPermissions`, so every authenticated user can reach it — unlike Setup, which requires `setup.access` and therefore excludes the default `member_default` permission set. Combined with the C-tier `resultDialog` actions already shipped on these objects (2FA QR + backup codes, OAuth `client_secret` reveal, `link_social` redirect), this replaces the legacy standalone `apps/account` SPA with a single console + metadata-driven surface.

  **New `App.hidden: boolean` field** (`packages/spec/src/ui/app.zod.ts`) hides an app from the top-level App Switcher. Hidden apps stay fully routable and permission-checked; the shell is expected to surface them through the avatar / user dropdown instead. Mirrors the GitHub Settings / Google account chip / Salesforce Personal Settings pattern. The Account app is the first user.

  Wiring: `plugin-auth` registers `ACCOUNT_APP` alongside `SETUP_APP` / `STUDIO_APP` (`packages/plugins/plugin-auth/src/auth-plugin.ts`). The legacy duplicate entries inside Setup's Advanced group are kept unchanged — they remain admin-only for tenant-wide inspection.

  **Follow-up for objectui**: the shell's `AppSwitcher` and avatar `DropdownMenu` need updating to honour `app.hidden` (filter hidden apps out of the switcher; render them as dropdown menu entries). Tracked separately.

- 257954d: **Organization detail page — Members / Invitations / Teams tabs (slotted Page)**

  Adds a record-detail Page for `sys_organization` (`SysOrganizationDetailPage`) so admins can manage the entire membership graph from a single record view instead of switching between three separate Setup list views.

  The page uses `kind: 'slotted'` and overrides only the `tabs` slot — header, actions, highlights, details and discussion fall through to the synthesized default, so the existing record-header actions (`Set Active`, `Edit`, `Delete`, `Leave Organization`) are preserved unchanged.

  Three tabs, each a `record:related_list` scoped by `organization_id`:

  - **Members** — `sys_member` (user, role, joined)
  - **Invitations** — `sys_invitation` (email, role, status, expires, inviter)
  - **Teams** — `sys_team` (name, created, updated)

  Per-row actions defined on each child object (`invite_user`, `cancel_invitation`, `remove_member`, `transfer_ownership`, `create_team`, …) are inherited unchanged — no admin endpoint is re-declared here.

  **Deliberately omitted:**

  - **OAuth Apps** — `sys_oauth_application` is owned by `user_id`, not `organization_id`; it surfaces on the user's Account view instead.
  - **SSO** — no `sys_sso*` object exists yet; will become a fourth tab when better-auth's SSO plugin lands.

  **Package wiring:**

  - `@objectstack/platform-objects` exposes a new `./pages` subpath export and re-exports `SysOrganizationDetailPage` from the root.
  - `plugin-auth` registers it via the existing `manifest.register({ ..., pages: [SysOrganizationDetailPage] })` call alongside the platform apps and dashboards.

  Verified end-to-end on the console-starter shell against `example-crm` — the three tabs render and the Members/Teams tables populate with the rows better-auth creates automatically when an org is provisioned.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- de239ef: Fix WebContainer (StackBlitz) sign-up / sign-in failing with
  `INTERNAL_SERVER_ERROR: No request state found. Please make sure you are
calling this function within a `runWithRequestState` callback.`

  WebContainer reports itself as Node.js but its `node:async_hooks`
  implementation does not propagate `AsyncLocalStorage` context across
  `await` boundaries. As a result, better-auth's `runWithRequestState`
  wrap installed by `handleRequest` was lost as soon as the inner
  `customSession` → `getSession()` call chain awaited anything, and every
  endpoint that reads request state (e.g. `should-session-refresh`,
  `oauth`) threw "No request state found".

  `AuthManager` now detects WebContainer and pre-populates better-auth's
  global `requestStateAsyncStorage` slot with a synchronous polyfill
  before better-auth instantiates its own. The polyfill correctly
  propagates the store through awaited promises within a single
  `run()` call, which is sufficient for WebContainer's single-flight
  dev server. Production environments (real Node, Bun, edge runtimes)
  continue to use the native `AsyncLocalStorage` and are unaffected.

  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- 0bf6f9a: Add explicit `@better-auth/core` dependency.

  `plugin-auth` already pulled `@better-auth/core` transitively via `@better-auth/oauth-provider`, but several call sites in `auth-manager.ts` import from it directly. Promote it to a first-class dependency so the resolved version is stable across the workspace and `pnpm install` doesn't surface "module not found" against the transitive copy under stricter peer resolution.

  No behaviour change.

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Minor Changes

- b4c74a9: WebContainer (StackBlitz) signup compatibility: `AuthManager` now auto-detects
  WebContainer runtimes at construction time and swaps better-auth's default
  `node:crypto.scrypt`-based password hasher for the pure-JS hasher from
  `@better-auth/utils/password` (which uses `@noble/hashes/scrypt` under the
  hood).

  **Why:** WebContainer's `node:crypto` polyfill ships an incomplete `scrypt`
  implementation that throws `TypeError: y.run is not a function` on every
  signup, blocking template demos on StackBlitz. The pure-JS implementation is
  byte-compatible with the Node hasher (same scrypt params, same `salt:keyHex`
  storage format), so accounts created under either hasher remain mutually
  verifiable — no migration, no template changes.

  **Scope:** detection short-circuits to `undefined` on real Node, so production
  deployments are completely unaffected — the JS fallback module is only
  dynamically imported when one of `process.versions.webcontainer`,
  `SHELL` containing `jsh`, or `STACKBLITZ` env is present.

  Templates (`@template/todo`, `@template/contracts`, …) require no changes;
  the fix lives entirely inside `@objectstack/plugin-auth`.

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/platform-objects@4.0.5

## Unreleased

### Minor Changes

- Always register better-auth's `bearer()` plugin so cross-origin browsers
  (where third-party cookies are blocked) and native mobile clients can
  authenticate via `Authorization: Bearer <token>` headers and pick up
  rotated tokens from the `set-auth-token` response header (fixes #1172).

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

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- 1fe5612: fix vercel
  - @objectstack/spec@3.2.8
  - @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- 35a1ebb: fix auth
  - @objectstack/spec@3.2.7
  - @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- e854538: fix beyyer-auth
  - @objectstack/spec@3.2.5
  - @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- f490991: fix better-auth
  - @objectstack/spec@3.2.4
  - @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- 0b1d7c9: fix auth
  - @objectstack/spec@3.2.3
  - @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- cfaabbb: fix: AuthPlugin error handling & database adapter config

  - `AuthManager.handleRequest()` now inspects `response.status >= 500` and logs the error body via `console.error`, since better-auth catches internal errors and returns 500 Responses without throwing.
  - `AuthPlugin.registerAuthRoutes()` also logs 500+ responses via `ctx.logger.error` for structured plugin logging.
  - `createDatabaseConfig()` now wraps the ObjectQL adapter as a `DBAdapterInstance` factory function so better-auth's `getBaseAdapter()` correctly recognises it (via `typeof database === "function"` check) instead of falling through to the Kysely adapter path.

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

- Unify all package versions with a patch release
- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

All notable changes to `@objectstack/plugin-auth` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.2] - 2026-02-10

### Added

- Initial release of Auth Plugin
- Integration with better-auth library for robust authentication
- Session management and user authentication
- Support for OAuth providers (Google, GitHub, Microsoft, etc.)
- Organization/team support for multi-tenant applications
- Two-factor authentication (2FA)
- Passkey support
- Magic link authentication
- Configurable session expiry and refresh
- Automatic HTTP route registration
- Comprehensive test coverage

### Security

- Secure session token management
- Encrypted secrets support
- Rate limiting capabilities
- CSRF protection

[Unreleased]: https://github.com/objectstack-ai/spec/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/objectstack-ai/spec/releases/tag/v2.0.2
