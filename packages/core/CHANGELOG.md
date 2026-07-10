# @objectstack/core

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0

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

- 01917c2: ADR-0090 P2 — audience anchors: `everyone`/`guest` builtin positions.

  - `EVERYONE_POSITION` / `GUEST_POSITION` constants in `@objectstack/spec`;
    both anchors seeded (system-managed) alongside the builtin identity names.
  - Every authenticated principal implicitly holds `everyone` in
    `ctx.positions`, so sets bound to it resolve as ordinary position-bound
    grants — ADDITIVE. The fallback CLIFF is abolished: the configured
    baseline (`fallbackPermissionSet`, default `member_default`) now applies
    in addition to explicit grants instead of only when the user had none,
    and is also seeded as an `everyone` binding (same table/audit/explain
    path as admin-authored defaults).
  - Sessionless HTTP principals resolve as `principalKind: 'guest'` holding
    exactly `['guest']`; internal bare contexts are untouched.
  - Audience-anchor binding gate: `sys_position_permission_set` writes that
    would bind a high-privilege set (VAMA, delete/purge/transfer, system
    permissions, `'*'` wildcard) to `everyone`/`guest` are rejected at the
    data layer, unconditionally (`describeHighPrivilegeBits` predicate is
    exported and shared with the seed-time validation).

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

## 12.6.0

### Minor Changes

- 21420d9: Seed loader and data-import now route bulk writes through the engine's array-form `insert()` (one round-trip per batch, with parent-deduplicated summary recompute) instead of one `insert()`/`createData()` call per record, and both retry transient driver errors instead of silently dropping the row (#2678).

  A new shared helper, `bulkWrite` (`@objectstack/core`), batches rows through a caller-supplied batch-write function, retries a whole-batch transient failure (network blip / timeout) with exponential backoff, and degrades to per-row writes (each itself retried) when a batch fails for a non-transient reason — so one bad row can't drop the other N-1. `withTransientRetry` wraps a single write (e.g. an update) with the same retry behavior.

  - `SeedLoaderService.loadDataset()` (`@objectstack/metadata-protocol`) buffers insert-mode records and flushes them in batches of 200 via the engine's array `insert()`. Datasets with a self-referencing field (e.g. `employee.manager_id -> employee`) keep the historical per-record write path, since a later record may need an earlier one's freshly-assigned id.
  - `runImport()` (`@objectstack/rest`) buffers create-resolved rows and flushes them via `protocol.createManyData()` when the protocol supports it, falling back to the original per-row `createData()` call otherwise. `Protocol.createManyData` (`@objectstack/metadata-protocol`) now forwards `context` to `engine.insert()` like `createData` already did, so tenant-scoped bulk creates work correctly.

  Previously, a 1000-row seed or import into an object with a rollup summary issued 1000+ round-trips and up to 1000 summary recomputes; a single transient network error on any one row silently dropped it with no retry (the 2026-07-06 HotCRM first-boot incident). A `bulkCreate`-capable driver now sees roughly `ceil(N/batch)` writes, and a transient error is retried before a row is ever reported as failed.

  **Fix (`@objectstack/driver-sql`):** `SqlDriver.bulkCreate()` never generated a client-side id for a row missing one, unlike `create()` — a latent gap that this change is the first to exercise at scale (a bulk-inserted row without a driver-native id default silently landed with `id: NULL`). `bulkCreate()` now mirrors `create()`'s id/`_id` normalization per row.

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0

## 12.2.0

### Patch Changes

- 4f5b791: Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
  "declared but never wired" family, following the #2596 hooks template).

  **Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
  was only ever populated from the app bundle at boot, so a published `action`
  row (standalone or embedded in an authored object's `actions[]`) was stored
  and listed but never executable — before OR after a restart. Now:

  - `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
    (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
    body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
  - `ObjectQLPlugin` re-registers runtime-authored actions from their
    `sys_metadata` rows under `packageId: 'metadata-service'` at
    `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
    mutations — saves, publishes, edits, and deletes take effect live.
    Package-artifact actions are excluded (AppPlugin owns those; re-registering
    would clobber their handlers).

  **Authored translations reach the i18n runtime (#2591).** `translation`
  metadata items (single-locale `AppTranslationBundle` payloads; locale from
  `_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
  into the i18n service as a separate authored layer that overlays static
  bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
  AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
  and standalone stacks actually run. The shared sync
  (`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
  the runtime's AppPlugin and by I18nServicePlugin with single-owner
  semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
  `translation` protocol mutations, with clear-then-reload semantics so
  deleted items/keys stop resolving instead of lingering in the deep-merged
  map.

  **Sharing rules created at runtime bind without a restart (#2592).**
  `bindRuleHooks` was boot-only, so the first rule authored at runtime for an
  object with no boot-time rule silently never evaluated (rule authoring is a
  data insert — `metadata:reloaded` never fires). The sharing plugin now binds
  afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
  unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
  so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
  rebind failure never fails the rule write.

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0

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

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0

## 11.1.0

### Minor Changes

- ce0b4f6: Auth: password expiry — the session-validation gate (ADR-0069 D1, P1)

  Builds the **authentication-policy session gate** ADR-0069 needs and uses it for password expiry. When `password_expiry_days` (new `auth` setting, 0 = off) is exceeded, an authenticated user is blocked from protected REST resources with `403 PASSWORD_EXPIRED` until they change their password — while auth + remediation paths stay reachable.

  - **core**: new pure `evaluateAuthGate` / `isAuthGateAllowlisted` helper (`@objectstack/core/security`) — single source of truth for the allow-list (auth endpoints, change-password, health, UI-bootstrap reads).
  - **plugin-auth**: `customSession` computes the gate posture once and attaches `user.authGate`; `computeAuthGate` reads `sys_user.password_changed_at` vs the configured window; `password_changed_at` is stamped on sign-up / change / reset; `isAuthGateActive()` keeps the gate **zero-overhead** when off.
  - **platform-objects**: new `sys_user.password_changed_at` column.
  - **rest**: `resolveExecCtx` carries `authGate`; `enforceAuth` blocks gated sessions (independent of `requireAuth`) using the core allow-list.
  - **service-settings**: new `password_expiry_days` field.

  Default-off / additive (no upgrade behavior change); a null `password_changed_at` never expires (existing users). Per ADR-0049 the setting ships with its enforcement; timestamps written as `Date` (ADR-0074).

  This gate is the shared seam for **enforced MFA** (ADR-0069 D3), which lands next as a small addition (a second `authGate` branch). The dispatcher/MCP path is a follow-up (tracked in #2375); the REST surface the Console uses is fully gated here.

- 3e593a7: Remove the deprecated `DriverInterface` type alias — use `IDataDriver` (11.0).

  `DriverInterface` was a `@deprecated` alias of `IDataDriver` (the authoritative
  driver contract). It is removed from `@objectstack/spec/contracts` and
  `@objectstack/core`; `objectql`'s engine now types drivers as `IDataDriver`
  directly (a type-identical change, since the alias _was_ `IDataDriver`).

  Driver authors: replace `DriverInterface` with `IDataDriver` (same shape).

  Note: this is unrelated to the live `IDataEngine` interface (engine-layer
  contract, not deprecated) and to the separate zod-derived `DriverInterface` /
  `DriverInterfaceSchema` in `@objectstack/spec/data` (the runtime driver schema),
  both of which are unchanged.

### Patch Changes

- 9ccfcd6: perf(core): authenticated requests issued ~16 sequential queries — duplicate authz + repeated localization — now request-scoped memoized

  An authenticated REST request resolves its execution context (identity +
  RBAC/RLS + localization) many times in a single handler — the data operation
  itself, app-nav RBAC filtering, dashboard widget gating, the ADR-0069 auth gate.
  Each `resolveExecCtx` pass is the full `resolveAuthzContext` aggregation plus the
  localization read (~16 sequential queries), and nothing memoized it, so a request
  that resolves twice paid for duplicate authz and repeated localization.

  - **`@objectstack/rest`** — `resolveExecCtx` is now memoized per request, keyed by
    the request object (a `WeakMap`, so the entry is collected with the request — no
    TTL, no cross-request leak) and the input `environmentId`. The in-flight Promise
    is cached so concurrent callers share one resolution. The heavy path moved to
    `computeExecCtx`. Anonymous (`undefined`) resolutions are cached too.
  - **`@objectstack/core`** — within a single `resolveAuthzContext` pass, `sys_user`
    is now read at most once (the email fallback and the `ai_seat` synthesis shared a
    duplicate query on the API-key path); `resolveLocalizationContext`'s direct-read
    fallback batches `timezone`/`locale`/`currency` into one `sys_setting` query
    (`$in` on `key`) instead of three sequential reads.

  No authorization-behavior change — the same roles/permissions/RLS context is
  resolved, just without the redundant reads. The `sys_member` reads (per-user roles
  vs. all-org-members) are intentionally left distinct (different filters/limits).

  Tests: query-counting regressions assert `sys_user` reads once and localization
  reads once; new rest-server tests pin the per-request/per-environment memo contract.

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- c715d25: chore(license): unify the framework repo to a single Apache-2.0 license

  The repo was left in a half-finished, self-contradictory source-available
  transition: 44 package `LICENSE` files carried restrictive dual-license text
  (a Licensor of "ObjectStack AI LLC", a four-year conversion date, and an
  anti-competitive-hosting grant) while those same packages' `package.json`
  already declared `"license": "Apache-2.0"` — and that license text pointed at
  `LICENSING.md` for the authoritative list of restricted packages, which listed
  none. The root also carried a redundant `LICENSE.apache` left over from that
  transition.

  The framework is deliberately permissive Apache-2.0 to maximize adoption; value
  capture lives in the separate closed-source cloud repo, not here. This change
  makes that unambiguous: every package `LICENSE` now contains the canonical
  Apache 2.0 text (copied from the root `LICENSE`), the redundant root
  `LICENSE.apache` is removed, and `LICENSING.md` states the entire repository is
  Apache-2.0 with no dual-license language. No restrictive-license residue remains
  anywhere outside `node_modules`.

  This is a metadata-only change (license text and `package.json` already agreed);
  the patch bump republishes the affected packages with the corrected `LICENSE`.

- aa33b02: fix(security): single-source the request authorization resolver — REST no longer drops sys_user_position

  The REST server and the runtime dispatcher each carried their own copy of the request → ExecutionContext identity/role resolver, and they drifted on a security path. The REST copy silently omitted `sys_user_position` (so custom roles granted via the ADR-0057 D4 platform-RBAC path did not apply over REST), `sys_position_permission_set`, the `owner→org_owner` membership normalization, the platform-admin derivation, and the `ai_seat` synthesis — fail-closed (legitimate access denied), not an escalation.

  Both entry points now delegate to a single shared resolver, `resolveAuthzContext` in `@objectstack/core/security` (joining the API-key verifier that already lived there). A contract test locks every authorization source and a lint gate (`check:authz-resolver`) prevents a future duplicate resolver or a dropped delegation.

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
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0

## 10.0.0

### Patch Changes

- d5f6d29: fix(runtime): surface code-defined datasources at `GET /api/v1/datasources` and `GET /api/v1/meta/datasource` on the standalone / host-config boot path (ADR-0015 §18, follow-up to #2111).

  A datasource declared in `defineStack({ datasources: [...] })` (e.g. the showcase's `showcase_external`) is stamped `origin: 'code'` and registered by `AppPlugin` via `metadata.registerInMemory('datasource', …)` — gated on `typeof metadata.registerInMemory === 'function'`. On the standalone / host-config path (`os dev`/`serve` for a config whose `plugins` are already instantiated — `isHostConfig` true — so no `MetadataPlugin` loads) the `metadata` service is an in-memory fallback that implemented `register`/`list`/`get` but **not** `registerInMemory`. The guard was therefore false, AppPlugin silently skipped the registration, and the datasource was absent from both REST surfaces (and Setup → Integrations → Datasources) even though the boot banner counted it and its federated objects were queryable.

  Both in-memory `metadata` fallbacks (`@objectstack/core`'s `createMemoryMetadata` and `@objectstack/plugin-dev`'s dev stub) now implement `registerInMemory` (synchronous, no persistence — identical to `register` for these in-memory stores, matching `MetadataManager`'s signature). The read paths (`metadata.list`, datasource-admin `listDatasources`, and `protocol.getMetaItems` which merges `metadata.list`) were already correct; this restores the write-side registration they depend on. It also makes stack-declared security metadata (`roles`/`permissions`/`sharingRules`/`policies`, registered through the same guard) listable on this path.

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0

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

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1

## 9.9.0

### Minor Changes

- 601cc11: feat(analytics): timezone-aware date bucketing (ADR-0053 Phase 2)

  Analytics day/week/month/quarter/year buckets now resolve on a **reference timezone's** calendar days, so a row near a tz day-boundary lands in the bucket a user in that zone would expect — identically on SQLite and Postgres.

  Per ADR-0053 decision **D2**, bucketing is done **in-memory, uniformly** for non-UTC zones rather than emitting dialect-specific `date_trunc … AT TIME ZONE` (SQLite has no tz database and MySQL needs tz tables loaded, so splitting by dialect would shift bucket boundaries for the same data). `engine.aggregate({ timezone })` therefore forces the in-memory aggregation path when a non-UTC reference tz is set — the date-range `where` still goes to the driver, so only matching rows are fetched. **UTC / unset keeps the native driver fast path unchanged.**

  - New shared `calendarPartsInTz` / `calendarPartsInTzOrUtc` util in `@objectstack/core` (DST-safe via `Intl.DateTimeFormat`, never hand-rolled offset math; falls back to UTC for an unset/`'UTC'`/invalid zone).
  - `EngineAggregateOptions` and the analytics `executeAggregate` bridge / `ObjectQLStrategy` thread the reference timezone (sourced from the dataset selection / `ExecutionContext`) through to `applyInMemoryAggregation` → `bucketDateValue`, and the draft-preview evaluator's `bucketDate`.
  - `formatDateBucket` (dimension labels) stays UTC-only by design: it re-labels values that were _already_ bucketed upstream, so re-applying a timezone there would shift a correct bucket by a day.

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

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0

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

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1

## 8.0.0

### Minor Changes

- c262301: fix(rest): REST data API honors sys_api_key — one shared verifier with MCP (closes #1633)

  Staging e2e found the MCP surface authenticated a `sys_api_key` but the REST data
  API (`@objectstack/rest`) returned 401 for the same key — its `resolveExecCtx`
  only checked the better-auth session, never the API key.

  Converged both surfaces onto ONE verifier so they can't drift:

  - **`@objectstack/core/security`** now owns the shared `sys_api_key` primitives
    (`hashApiKey`, `generateApiKey`, `extractApiKey`, `parseScopes`, `isExpired`)
    plus a new `resolveApiKeyPrincipal(ql, headers, nowMs?)` that hashes the
    inbound key, looks it up by the indexed at-rest hash, and rejects unknown /
    revoked / expired / owner-less keys (fail-closed). `core` is the natural home:
    both `rest` and `runtime` depend on it, it depends on neither (no cycle), and
    it's server-side (already uses `node:crypto`).
  - **`@objectstack/runtime`** — `security/api-key.ts` re-exports the primitives
    from core (stable import surface) and `resolveExecutionContext` now delegates
    its API-key branch to `resolveApiKeyPrincipal`.
  - **`@objectstack/rest`** — `resolveExecCtx` resolves the data engine once and
    tries `resolveApiKeyPrincipal` (x-api-key / `Authorization: ApiKey`) BEFORE the
    session, so `/api/v1/data` + `/api/v1/meta` now authenticate an API key under
    the key's permissions + RLS, exactly like the dispatcher/MCP path.

  Tests: core `api-key.test.ts` (primitives + verifier: valid / revoked / expired /
  unknown / owner-less / plaintext-not-matched / fail-closed-ql). runtime + rest
  suites green.

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

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

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

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

## 7.3.0

### Patch Changes

- 5e7c554: **Rename kernel plugin-sandbox permission schemas to remove a naming footgun** (issue #1383).

  `@objectstack/spec/kernel` exported `PermissionSchema` / `PermissionSetSchema`
  (and the `Permission` / `PermissionSet` types) for the plugin-sandbox security
  model. Their names collided with the metadata-protocol permission set exported
  from `@objectstack/spec/security` (`PermissionSetSchema`), making it very easy
  to validate the `permission`/`profile` metadata type against the wrong schema
  and reject every legal payload.

  The kernel symbols are now prefixed with `Plugin` to reflect their specialized
  semantics:

  | Old (`@objectstack/spec/kernel`) | New                         |
  | :------------------------------- | :-------------------------- |
  | `PermissionSchema`               | `PluginPermissionSchema`    |
  | `PermissionSetSchema`            | `PluginPermissionSetSchema` |
  | `Permission` (type)              | `PluginPermission`          |
  | `PermissionSet` (type)           | `PluginPermissionSet`       |

  The metadata `permission`/`profile` types are unchanged — keep using
  `PermissionSetSchema` from `@objectstack/spec/security`.

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2

## 4.0.0

### Minor Changes

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

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11

## 1.0.10

### Patch Changes

- 10f52e1: fix: silence unhandled promise rejections when checking for async services in kernel
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4

## 1.0.3

### Patch Changes

- fb2eabd: fix: resolve "process is not defined" runtime error in browser environments by adding safe environment detection and polyfills
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

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.7.1

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
