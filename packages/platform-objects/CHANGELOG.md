# @objectstack/platform-objects

## 14.8.0

### Patch Changes

- bb71321: i18n: translate the system account/messaging surfaces end to end.

  - **spec**: `ObjectTranslationDataSchema` / `ObjectTranslationNodeSchema` now
    accept `_views.<view>.emptyState.{title,message}` so list-view empty states
    are translatable (contract-first for the extractor below).
  - **cli**: `os i18n extract` emits `_views.<view>.emptyState` keys when a view
    declares an empty state.
  - **platform-objects**: fill every missing zh-CN/ja-JP/es-ES translation for
    `sys_user`, `sys_organization` and `sys_business_unit` (fields, options,
    views, actions); replace the hardcoded English tab/section/action labels in
    the `sys_user`, `sys_organization` and `sys_position` detail pages with
    inline i18n label objects, and route the user Security tab through
    `record:quick_actions` so object action labels localize.
  - **service-messaging**: new ADR-0029 D8 translation bundle
    (`MessagingTranslations`) covering the seven `sys_*` messaging objects
    (inbox message, receipts, deliveries, preferences, subscriptions, templates,
    HTTP deliveries), registered on `kernel:ready`; zh-CN is fully translated
    and ja-JP/es-ES cover `sys_inbox_message` (incl. the `mine` view empty
    state).

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/metadata-core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/metadata-core@14.7.0

## 14.6.0

### Patch Changes

- 609cb13: **Action params gain a `visible` predicate; the create-user `phoneNumber` param is gated on `features.phoneNumber`.**

  `ActionParamSchema` gains an optional `visible` (CEL, `ExpressionInputSchema`) evaluated against the same scope as action `visible` (`current_user`/`app`/`data`/`features`); a UI that honors it omits the param when it's false. The `sys_user` `create_user` action's `phoneNumber` param now carries `visible: 'features.phoneNumber == true'`, so the form no longer offers a Phone Number field when the opt-in `phoneNumber` auth plugin is off — otherwise the endpoint rejects it with "Phone numbers require the phoneNumber auth plugin". Pairs with the objectui `ActionParamDialog` change that evaluates `param.visible`.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/metadata-core@14.6.0

## 14.5.0

### Minor Changes

- 6da03ee: feat(identity): open the standard Edit affordance on sys_user for profile fields (ADR-0092 D4)

  `sys_user` now sets `userActions: { edit: true }`, so the generic row-edit
  form is available (create / import / delete stay off). The two profile fields
  (`name`, `image`) are editable; every other column — `email`, `role`, ban
  state, phone, and all system-managed stamps — is marked `readonly` so the
  standard edit form renders it non-editable.

  This is safe because the server boundary is the identity write guard shipped
  in the previous change (ADR-0092 D2): a user-context update to `sys_user` may
  only touch `{name, image}` regardless of what any form submits; everything
  else is stripped or rejected. The `readonly` flags here are UX only.

  The dedicated action dialogs are unaffected — `create_user` / `invite_user` /
  `set_user_role` reference `email` and `role` as action **params** (their own
  inputs), which do not inherit the field-level `readonly` and stay editable
  (verified in the running Console).

  Note: the Console's record-form renderer must honor `userActions.edit` +
  per-field `readonly` on `managedBy:'better-auth'` objects for the edit form to
  be functional; that is an objectui-side change vendored via `objectui:refresh`
  and tracked separately.

### Patch Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

- 8f23746: `sys_sso_provider` domain-verification `resultDialog` paths now address the
  inner `data` payload (`dnsRecordType`, not `data.dnsRecordType`), matching every
  other object. Pairs with the objectui `apiHandler` envelope-unwrap fix
  (objectui#2396) — the old `data.` prefix compensated for a runtime bug and would
  blank the dialog once the runtime unwraps correctly.
- b97af7e: `sys_user` account-management actions (Ban/Unban, Unlock Account, Set Password, Set Platform Role, Impersonate) now also surface on the user record-detail header (`record_header`, overflowing into the ⋯ "More" menu), not just the Users list row menu — so a platform admin can manage an account from an open user record without navigating back to the list.
- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/metadata-core@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/metadata-core@14.4.0

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

### Patch Changes

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/metadata-core@14.3.0

## 14.2.0

### Minor Changes

- 4ab9958: Position assignment panels as pure SDUI (ADR-0090 follow-through).

  - `RecordRelatedListProps` gains `relationshipValueField` (default `'id'`): which parent-record field the junction's `relationshipField` stores — the generic affordance for name-keyed junctions (`sys_user_position.position` stores `sys_position.name`). Used for both the list filter and the Add-picker's parent-side value.
  - `sys_user` detail page gains a **Positions** tab (assign positions to a user; Add picker stores the position machine name via `valueField: 'name'`; the D12 delegated-admin gate's denials surface in the dialog).
  - New `sys_position` detail page (shipped by plugin-security): **Holders** (name-keyed via `relationshipValueField: 'name'`) and **Permission Sets** (bindings) tabs — zero bespoke UI; ADR-0091 validity columns slot in later as plain column additions.

  Renderer note: the generic `record:related_list` Add-picker and `relationshipValueField` support land in objectui alongside the ^14 alignment; with older renderers these tabs degrade to read-only lists.

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/metadata-core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/metadata-core@14.1.0

## 14.0.0

### Patch Changes

- 332b711: feat(mcp): plugin-carried "Connect an agent" Setup page (#2714 Phase 1)

  The MCP plugin now registers a Setup page (`connect_agent`) plus its
  navigation entry under Integrations — the nav lives and dies with the
  capability (cloud ADR-0009 principle) and follows the surface's default-on
  switch: an opted-out deployment (`OS_MCP_SERVER_ENABLED=false`) gets no page
  and no entry. The page body is the `mcp:connect-agent` SDUI widget provided
  by objectui (objectui#2372): env MCP URL, per-client connect cards, SKILL.md
  download, API-key minting. zh-CN nav label included.

- d0531c4: Setup → Access Control nav: the `sys_position` entry is renamed
  `nav_roles`/"Roles" → `nav_positions`/"Positions" (岗位 / ポジション /
  Posiciones) — the last "role" leftover in platform UI copy (ADR-0090 D3;
  the Studio-side relabel already landed in objectui). The framework's
  `.objectui-sha` pin is bumped to pick up the Studio Access-pillar explain
  panel ("why can this user access?", ADR-0090 D6) and the suggested
  audience-binding install prompt (D5/D9).
- cff5aac: Setup navigation: the Access Control menu entry for `sys_position` is now labeled "Positions" (was still "Roles" after the ADR-0090 D3 rename) — `nav_roles` → `nav_positions`, with zh-CN 岗位 / ja-JP ポジション / es-ES Posiciones translations updated to match the position vocabulary.
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/metadata-core@14.0.0

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

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

### Minor Changes

- 9fa84f9: Secure-by-default posture for sensitive system objects (ADR-0066 ④, system-object
  slice) — the platform's raw secret/credential stores no longer ride the wildcard
  `'*'` permission grant.

  `sys_secret` (encrypted settings/datasource secrets), `sys_jwks` (JWT signing
  keys), `sys_verification` (password-reset / verify tokens),
  `sys_oauth_access_token`, `sys_oauth_refresh_token` (live bearer credentials),
  and `sys_device_code` (pending device-grant codes) now declare
  `access: { default: 'private' }`: an ordinary member's generic data-layer
  read/write gets 403 instead of being covered by `member_default`'s
  `'*': allowRead`. Platform admins retain access via the posture-gated
  `viewAllRecords`/`modifyAllRecords` superuser bypass, and every runtime consumer
  is unaffected — better-auth reads via its adapter (system context),
  `engine.resolveSecret` reads at driver level, and SettingsService / the
  datasource secret-binder read principal-less (middleware falls open for internal
  calls).

  `sys_scim_provider` (SCIM bearer-token config) gains the object-level
  `requiredPermissions: ['manage_platform_settings']` capability gate, mirroring
  its sibling `sys_sso_provider`. The Setup nav item for Signing Keys (JWKS) is
  now capability-gated like API Keys, so non-admins don't see a menu entry that
  can only 403.

  Member self-service objects (`sys_session`, `sys_api_key`,
  `sys_oauth_application`, `sys_two_factor`) deliberately keep the public posture —
  the Account app ("My Sessions" / "My API Keys" / "My Apps" / 2FA "My
  Enrollment") reads them through the generic data layer as the member; row
  scoping remains their guard. The declarations are pinned by
  `platform-objects.test.ts` and the ADR-0056 D10 conformance-matrix row
  `secure-by-default-posture`, so dropping the flag from a secret store fails CI.

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
  - @objectstack/metadata-core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0
  - @objectstack/metadata-core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/metadata-core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/metadata-core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0
  - @objectstack/metadata-core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/metadata-core@12.1.0

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
  - @objectstack/metadata-core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/metadata-core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/metadata-core@11.9.0

## 11.8.0

### Patch Changes

- 53d491a: feat(setup): Packages entry in Setup's Apps group

  Package administration (install / inspect / manage) is an operator concern
  (ADR-0084: packages are Operate, out of the builder), so it gains a home in the
  Setup app: `group_apps` now carries a **Packages** entry bound to the console's
  existing `developer:packages` page. Building apps remains a separate journey
  (the Home builder cover → `/studio`); this entry is for administration.

- b84726b: feat(studio): "App Builder" navigation entry — the pillar builder joins the journey

  The Studio app's Overview group gains an **App Builder** entry (componentRef
  `studio:builder`, bound by the console to the builder landing page). This makes the
  pillar application builder reachable from the moment a user logs in — Home → Studio
  → App Builder → pick/create a writable base package → the full-screen builder at
  `/studio/:packageId/:tab` — instead of being a URL-only surface.

  - @objectstack/spec@11.8.0
  - @objectstack/metadata-core@11.8.0

## 11.7.0

### Patch Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/metadata-core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/metadata-core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/metadata-core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/metadata-core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/metadata-core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/metadata-core@11.2.0

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

- 07c2773: Auth: make the SSO Providers list visible to admins (ADR-0024 / cloud#551)

  The `sys_sso_provider` Setup list rendered empty even after an admin registered a provider: `member_default`'s wildcard `tenant_isolation` RLS (`organization_id == current_user.organization_id`) denied every row, because better-auth writes these via its adapter with no tenantId context so `organization_id` is never stamped, and the platform-admin `viewAllRecords` superuser bypass is gated to private/non-tenant objects.

  `sys_sso_provider` is env-global, admin-only identity config, so it now declares:

  - `tenancy: { enabled: false }` — opts out of multi-tenancy (the env IS the tenant; providers are env-wide), letting a platform admin's `viewAllRecords` bypass see every provider.
  - `requiredPermissions: ['manage_platform_settings']` — object-level capability gate so ordinary members are denied (without it, tenancy-disabled + `member_default`'s `'*': allowRead` would expose providers to every authenticated user).

  Verified E2E: an admin sees all env providers in the Setup → Access Control → SSO Providers list; a non-admin gets 403. (Env-only object — no control-plane cross-tenant impact. The sibling `sys_oauth_application` / `sys_account` nav entries share the same empty-list symptom but span the control plane and need separate per-object analysis.)

- d7a88df: Auth: SSO quality polish (ADR-0024 / cloud#551)

  - **plugin-auth**: `OS_OIDC_PROVIDER_ENABLED` / `OS_SSO_ENABLED` / `OS_SCIM_ENABLED` now parse with the shared `readBooleanEnv` helper (same as `OS_AUTH_TWO_FACTOR` etc.), so the platform-standard truthy set works (`true`/`1`/`yes`/`on`, case-insensitive) instead of only the literal `'true'` — a repeated operator footgun where `OS_SSO_ENABLED=1` silently parsed as disabled. Added unit tests.
  - **platform-objects**: `sys_sso_provider`'s list view gets a per-object empty state ("No SSO providers yet" + a pointer to "Register SSO Provider"), replacing the shared identity-object copy ("records are created automatically … cannot be added here") which is wrong for this object — it HAS a register action.

- 4f8f108: Auth: make the open-source SSO-provider registration form produce a usable IdP (ADR-0024 / cloud#551)

  The `sys_sso_provider` `register_sso_provider` UI action posted FLAT form fields to `@better-auth/sso`'s `/sso/register`, which expects the OIDC fields NESTED under `oidcConfig`. The top-level `clientId`/`clientSecret` were Zod-stripped, so the form persisted an `oidc_config = null` provider that could never complete a login ("Invalid SSO provider").

  - **plugin-auth**: new shared `runRegisterSsoProviderFromForm` helper reshapes the flat form body into the nested shape and re-dispatches it through the real `/sso/register` (so the admin gate, the public-routable `trustedOrigins` allowance, discovery hydration, and secret handling all still run). Exposed via a new `/admin/sso/register` bridge route on the host `AuthPlugin`. (The cloud per-env runtime mounts the same helper in its `AuthProxyPlugin` — mirrors `set-initial-password`.)
  - **platform-objects**: `register_sso_provider` retargets to `/api/v1/auth/admin/sso/register` and gains `discoveryEndpoint`, `scopes`, and attribute-mapping (`mapId`/`mapEmail`/`mapName`) fields. Open mechanism — keeps runtime IdP registration self-service in the OSS edition.

  Verified E2E: an admin registers an external OIDC IdP from the flat form → a member logs in through it (JIT-provisioned, `sys_account.provider_id` set); a non-admin is rejected (403) before discovery runs.

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0
  - @objectstack/metadata-core@11.1.0

## 11.0.0

### Minor Changes

- 9b5bf3d: Auth: password history / no-reuse (ADR-0069 D1, P1)

  Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

  Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

### Patch Changes

- 5737261: fix(setup): drop Advanced nav entries for non-listable objects (sys_verification, sys_device_code)

  Dogfooding every Setup menu surfaced two Advanced entries that always render
  "无法加载记录 / failed to load": **Verifications** (`sys_verification`) and
  **Device Codes** (`sys_device_code`). Both objects deliberately omit `list`
  from `apiMethods` (sensitive, ephemeral secrets — verification tokens and OAuth
  device-grant codes are not meant to be browsed), so the generic object/list-view
  menu can only ever 405. Removed both nav entries (and their orphaned zh labels);
  the objects remain reachable by id. Re-adding a browse menu would require
  enabling `list` on the object — a security decision, not a nav fix.

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

- f44c1bd: fix(platform-objects): hide org/membership surfaces in single-org mode

  The platform gates multi-org features two ways — nav entries on
  `requiresService: 'org-scoping'` (e.g. setup-nav Organizations/Invitations)
  and object actions on `visible: 'features.multiOrgEnabled != false'` (e.g.
  `sys_organization.create_organization`). That convention had only been applied
  to a handful of spots, so a wide band of org/membership surface leaked into
  single-org deployments where it is pure noise or a broken affordance:

  - The Account app's "My Organizations" entry (`sys_member` / `mine` view) was
    gated on `requiresObject: 'sys_member'` — but `sys_member` is a system object
    that is always registered, so the gate never fired. In single-org there are
    no `sys_organization` rows and no auto-stamped memberships, so the view is
    always empty for every user. Re-gated on `requiresService: 'org-scoping'`.
  - The setup-nav "Teams" entry had no gate at all, while its sibling
    Organizations/Invitations entries were correctly service-gated. Added
    `requiresService: 'org-scoping'`.
  - Org/membership mutation actions rendered (and on toolbars, were clickable)
    in single-org but hit better-auth endpoints that resolve an active org that
    does not exist, failing at the API. Gated each on
    `features.multiOrgEnabled != false`:
    - `sys_user.invite_user` (the most exposed — the Users list is always
      reachable in single-org)
    - `sys_member.add_member` / `update_member_role` / `remove_member`, and
      `transfer_ownership` (combined with its existing `record.role != 'owner'`
      condition)
    - `sys_team.create_team` / `update_team` / `remove_team`
    - `sys_team_member.add_team_member` / `remove_team_member`
    - `sys_invitation.invite_user` / `resend_invitation` / `cancel_invitation`
      (recipient-side accept/reject stay record-gated; they are unreachable in
      single-org anyway since no invitation rows exist)

  Also tightened the remaining single-org rough edges on these objects:

  - `sys_organization` admin actions (`update` / `delete` / `set_active` /
    `leave` / `change_slug`) are now all gated on
    `features.multiOrgEnabled != false`, joining the already-gated
    `create_organization` — previously only create was gated.
  - `titleFormat` no longer renders a null organization: `sys_member` is titled
    `'{user_id} ({role})'` (was `'… in {organization_id}'`) and `sys_invitation`
    is titled `'Invitation for {email}'` (was `'Invitation to {organization_id}'`).
    In single-org `organization_id` is null, so the old formats read "… in null".
    The new fields are more useful identifiers in both modes.

  No behavior change in multi-org deployments (`OS_MULTI_ORG_ENABLED=true`):
  `features.multiOrgEnabled` is true and the `org-scoping` service is present, so
  every gate evaluates to visible exactly as before. This is metadata-only — no
  schema, API, or runtime changes.

- Updated dependencies [4d99a5c]
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
  - @objectstack/metadata-core@11.0.0
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/metadata-core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/metadata-core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/metadata-core@10.1.0

## 10.0.0

### Major Changes

- e16f2a8: **BREAKING:** the system object `sys_department` is renamed to `sys_business_unit`
  — object + member table (`sys_department_member` → `sys_business_unit_member`),
  fields, and i18n — with **no compatibility alias**. Any deployment holding
  `sys_department` rows, or metadata that references the object by name (lookups,
  list views, queries, sharing/approval scopes), must migrate to `sys_business_unit`.
  A renamed shipped system object is a breaking change to the platform's public
  data surface, so this lands as a **major**. Verified per ADR-0059's pre-publish
  hotcrm gate: no published downstream consumer references the old name.

  ADR-0057 — ERP authorization core. Adds permission-grant access DEPTH
  (`own`/`own_and_reports`/`unit`/`unit_and_below`/`org`), renames `sys_department`
  → `sys_business_unit` (no aliases — see BREAKING above), introduces the platform-owned
  `sys_user_position` assignment, and seeds stack-declared `roles`/`sharingRules` into
  `sys_position`/`sys_sharing_rule` at boot (closes #2077). Hierarchy-relative scopes are
  delegated to a pluggable `IHierarchyScopeResolver` (open edition fails closed to
  owner-only; `defineStack` errors without `requires: ['hierarchy-security']`). Also
  fixes a latent over-grant where `engine.find({ filter })` was ignored (driver reads
  `where`) — normalized `filter`→`where` in the engine.

### Minor Changes

- 2256e93: Setup nav: gate Organizations/Invitations on multi-org; enforce `requiresService` server-side (ADR-0057 addendum D10).

  `rest-server`'s `filterAppForUser` now honours `NavigationItem.requiresService` — entries
  whose named kernel service isn't registered are dropped from the served app metadata
  (fail-open when the kernel can't be probed; previously the field was a frontend-only hint).
  Applies `requiresService: 'org-scoping'` to the Setup app's Organizations and Invitations
  entries, so they surface only in multi-org (multi-tenant) deployments and disappear in
  single-tenant. Business Units is intentionally left ungated — it is open per the open/paid
  seam + D12 ("pick people by BU"); only the hierarchy rollup capability is enterprise.

- 7108ff3: Drop the unused `team` value from `sys_business_unit.kind` (ADR-0057 addendum D11).

  The `team` kind collided head-on with the first-class `sys_team` object: a
  `kind='team'` business unit walks the hierarchical `BusinessUnitGraphService`,
  while `sys_team` is the flat better-auth collaboration grouping served by
  `TeamGraphService`. `kind` is a display-only categorisation hint (it does not
  change graph semantics) and had **zero** usages anywhere in the repo, so this is a
  safe narrowing with no data migration. New enum:
  `company | division | department | office | cost_center`.

- 30c0313: Add `sys_user.primary_business_unit_id` projection (ADR-0057 addendum D12).

  Adds a denormalised `primary_business_unit_id` lookup to `sys_user`, maintained
  by plugin-sharing as a projection of `sys_business_unit_member.is_primary`
  (insert/update/delete hooks + a boot-time backfill). This makes "pick people by
  business unit" — the Dataverse _filtered lookup_ / ServiceNow _reference
  qualifier_ interaction — expressible as a plain `where: { primary_business_unit_id: X }`
  (and thus as a `lookupFilters` picker filter) with **zero** query-engine change,
  without traversing the membership junction. `sys_business_unit_member` remains
  the effective-dated, matrix-friendly source of truth; the new column is a
  maintained projection, not a second source. Home is plugin-sharing (always
  loaded, owns the BU graph) rather than plugin-org-scoping, so the projection
  works in single-tenant deployments too. Picker filtering by BU is therefore an
  **open** (non-enterprise) capability — only hierarchy _rollup_ stays paid.

- ae271d0: feat(identity): add an Org Chart tree view to `sys_business_unit`

  `sys_business_unit` is already a self-referencing hierarchy
  (`parent_business_unit_id`, ADR-0057 D2) but Setup only exposed flat grids. Adds
  an `org_chart` list view (`type: 'tree'`) that renders the hierarchy as an
  indented, expand/collapse tree-grid, listed first so it's the default tab. No
  schema change — the parent pointer and graph traversal already existed; this only
  surfaces them. The `active` / `inactive` / `by_kind` / `all` grids stay for
  search, filter, and bulk edit.

- 47d978a: Add `manager_id` (self-lookup) to `sys_user` — the reporting chain that the ADR-0057 `own_and_reports` hierarchy scope walks.

  The `own_and_reports` scope was implemented in the resolver but **unbacked**: nothing on `sys_user` modelled a manager, so it always degraded to owner-only. This adds the field (+ en/zh/ja/es labels) and extends the scope-depth dogfood to prove the scope end-to-end — a user now sees their own records plus everyone down their `manager_id` chain.

### Patch Changes

- 61ed5c7: Complete the ADR-0057 `sys_department` → `sys_business_unit` rename in the Setup app and across the object's i18n (en / zh / ja / es).

  - Setup nav entry "Departments" → "Business Units" (`nav_departments` → `nav_business_units`).
  - `sys_business_unit` / `sys_business_unit_member` field **labels and descriptions** in the object definitions now read "business unit" instead of "department" (the generated `en` labels had been hand-updated ahead of the def; the def was the stale source).
  - All four locales' generated object translations aligned to 业务单元 / ビジネスユニット / Unidad de negocio.

  Intentionally preserved: the `kind` enum value `department` (a business unit can be _of kind_ department) and the multi-concept node descriptions that list kinds.

- 0df063e: Fix: `sys_business_unit` / `sys_team` could not be created in single-tenant deployments.

  `organization_id` was `required`, but single-tenant has no `sys_organization` row and
  nothing auto-stamps one (OrgScopingPlugin is multi-tenant-only), so every create failed
  with `VALIDATION_FAILED: organization_id (required)`. Make `organization_id` optional on
  both objects: single-tenant leaves it null; multi-tenant still auto-stamps it via
  OrgScopingPlugin and tenant-isolation RLS hides any null-org row (fail-closed), so there is
  no cross-tenant exposure. (sys_member / sys_invitation carry the same `required` flag but are
  created only through better-auth org flows, which always supply an org — left unchanged.)

- ce13bb8: Single-tenant audit follow-ups (ADR-0057):

  - **`sys_member` / `sys_invitation`**: make `organization_id` optional (same class as the
    sys_business_unit/sys_team fix #2178). Single-tenant has no org row and no auto-stamp;
    multi-tenant still auto-stamps via OrgScopingPlugin with null-org rows hidden by
    tenant-isolation RLS (fail-closed). Completes the org-scoped identity graph's
    single-tenant consistency.
  - **`BusinessUnitGraphService.headOf()`**: add the missing `orgScope()` org filter (it
    queries under SYSTEM_CTX, bypassing RLS, so the scope is the only isolation). Previously
    `headOf(buId)` read a business unit's `manager_user_id` by id alone — a cross-organization
    leak in multi-tenant. Now consistent with `descendants()`. +regression test.

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
  - @objectstack/metadata-core@10.0.0

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
  - @objectstack/metadata-core@9.11.0

## 9.10.0

### Patch Changes

- 4331adb: fix(i18n): add view form `end_user_controls` translations for en, es-ES, ja-JP and zh-CN metadata-forms bundles.
- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/metadata-core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/metadata-core@9.9.1

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
  - @objectstack/metadata-core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/metadata-core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/metadata-core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/metadata-core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/metadata-core@9.5.1

## 9.5.0

### Patch Changes

- 5be7102: i18n(metadata-forms): correct stale page-`type` help text across locales

  The page `type` field help text still described page types as "record, home, app, dashboard …" — listing `dashboard` (and implying grid/kanban/calendar) as page types, which is wrong after the ADR-0047 page-type cleanup: those are visualizations configured under Interface, not page kinds. Updated en / zh-CN / ja-JP / es-ES to "page kind — list / record / home / app / utility; visualizations live under Interface". Also fixed the stale zh-CN `kind` help text (it described "record / list / detail" instead of the record-page override mode).

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/metadata-core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata-core@9.4.0

## 9.3.0

### Minor Changes

- c802327: Marketplace Setup navigation is now plugin-owned (cloud ADR-0009): `MarketplaceProxyPlugin` carries the "Browse Marketplace" entry and `MarketplaceInstallLocalPlugin` carries "Installed Apps" — no plugin mounted (e.g. `OS_CLOUD_URL=off`), no entry, no dead page. The two entries are removed from `@objectstack/platform-objects`' setup-nav contributions (ADR-0029 K2 ownership handoff).

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/metadata-core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/metadata-core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/metadata-core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/metadata-core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/metadata-core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/metadata-core@8.0.1

## 8.0.0

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
  - @objectstack/metadata-core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/metadata-core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/metadata-core@7.8.0

## 7.7.0

### Patch Changes

- 023bf93: fix(spec): reject unknown top-level keys on `ObjectSchema.create()` (#1535)

  `ObjectSchemaBase` is a plain `z.object({...})` (Zod default `.strip()`), so any
  unknown top-level key passed to `ObjectSchema.create()` — `workflows`, a typo'd
  `validation`/`indexs`, etc. — was discarded silently: no error, no warning, and a
  green `tsc`. Declarative metadata an author believed they shipped (e.g. object-level
  `workflows: [...]`) vanished from every built artifact, dead from day one. This is the
  metadata-shape analogue of ADR-0032's "no silent failure" principle.

  `create()` now rejects unknown top-level keys with a precise, fixable build error that
  names the offending key(s), suggests the intended key on a likely typo
  (`validation` → `validations`), and — for known-confusable keys like `workflows` —
  points authors at the supported mechanism (a lifecycle hook `src/objects/<name>.hook.ts`
  or a top-level `record_change` flow; there is no object-level `workflows[]` field). The
  factory signature also constrains excess keys to `never`, so the mistake is caught at
  `tsc` time as well as at build.

  The non-strict `ObjectSchema.parse()` load path (registry/artifact validation) is
  unchanged.

  Also fixes two platform objects (`sys_secret`, `sys_setting_audit`) that carried
  silently-stripped `views`/`scope`/`defaultViewName` keys: their intended list views are
  migrated to the supported `listViews` field (`type: 'list'` → `'grid'`) so they now
  render instead of being dropped. The `objectstack-data` skill's CRM blueprint no longer
  teaches the non-existent `workflows[]` shape.

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/metadata-core@7.7.0

## 7.6.0

### Patch Changes

- 7ae6abc: Fix `sys_user` load failure after the validation-rule type trim (#1485)

  #1485 trimmed the unenforceable validation-rule types (`unique`, `async`,
  `custom`) from the `ValidationRuleSchema` discriminated union, but `sys_user`
  still declared an `email_unique` rule with `type: 'unique'`. Loading the object
  then threw a `ZodError` ("Invalid discriminator value … at validations[0].type"),
  failing `platform-objects.test.ts` and turning `main` red.

  The rule was redundant: `sys_user` already declares a unique index on `email`
  (`indexes: [{ fields: ['email'], unique: true }]`), and the user table is
  managed by better-auth which enforces email uniqueness at the source. Removed
  the unenforceable validation rule; uniqueness remains enforced by the index.
  No other object uses a trimmed validation type.

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

- eea3f1b: ADR-0029 K0 + K2.a — single-owner invariant and webhooks ownership pilot.

  **K0 (`@objectstack/objectql`)** — add `SchemaRegistry.assertSingleOwnerPerObject()`,
  the install-time backstop for the kernel-decomposition invariant: every
  registered object must resolve to exactly one `own` contributor. A second
  cross-package owner is already rejected at registration time; this additionally
  catches "extend with no owner" (which would otherwise resolve to nothing). Call
  after kernel bootstrap completes.

  **K2.a (`@objectstack/plugin-webhooks` ← `@objectstack/platform-objects`)** — move
  the `sys_webhook` object definition out of the `platform-objects` monolith into
  `@objectstack/plugin-webhooks`, where it joins its sibling `sys_webhook_delivery`
  so the plugin owns both its data model and behavior as one unit. `sys_webhook` is
  no longer exported from `@objectstack/platform-objects` (or its `/integration`
  subpath, now an empty barrel); import it from `@objectstack/plugin-webhooks/schema`
  instead. Runtime behavior is unchanged — the webhook plugin already registered
  `sys_webhook` at runtime; only the definition's home moved. Setup-app navigation
  (which references `sys_webhook` by name) and existing i18n bundles (object-name
  keyed) continue to work. Per ADR-0029 D8, migrating the object's i18n extraction
  into the plugin is a tracked follow-up before the next translation regeneration.

- e478e0c: ADR-0029 K2 — security domain ownership (RBAC + sharing) + Setup nav contributions.

  Moves the security objects out of the `@objectstack/platform-objects` monolith
  into the two capability plugins that already register and operate them, split by
  concern (the two are orthogonal — sharing objects never reference RBAC objects):

  - **`@objectstack/plugin-security`** (RBAC) gains `sys_position`,
    `sys_permission_set`, `sys_user_permission_set`, `sys_position_permission_set`,
    and the `defaultPermissionSets` seed (which its `bootstrap-platform-admin`
    already consumes). The RBAC + default-permission-set tests move with them.
  - **`@objectstack/plugin-sharing`** gains `sys_record_share`,
    `sys_sharing_rule`, `sys_share_link`.
  - `@objectstack/platform-objects` no longer defines/exports any security
    objects; the `/security` subpath is now an empty barrel. Runtime is unchanged
    (both plugins already registered these objects at runtime).

  **D7 navigation** — the Setup app's `group_access_control` is now assembled from
  three sources: `plugin-security` contributes Roles / Permission Sets (priority
  100), `plugin-sharing` contributes Sharing Rules / Record Shares (priority 200),
  and `platform-objects` keeps only API Keys (`sys_api_key`, an identity object,
  priority 300) — preserving the original menu order.

  **i18n (D8)** — the objects are removed from the `platform-objects` i18n extract
  config; existing generated bundles keep working at runtime (object-name keyed).
  Migrating the i18n extraction to the owning plugins remains the tracked
  follow-up.

- 4cc2ced: ADR-0029 K2.b — approvals domain ownership + Setup nav contribution.

  Moves `sys_approval_request` / `sys_approval_action` out of the
  `@objectstack/platform-objects` monolith into `@objectstack/plugin-approvals`,
  which already registers and operates them — so the plugin now owns its data
  model, behavior, and admin menu as one unit.

  - The object definitions move to `plugin-approvals`; `platform-objects` no
    longer exports them from `/audit`. Runtime is unchanged (the plugin already
    registered them at runtime).
  - **D7 navigation** — the Setup app's `group_approvals` entries (`Requests`,
    `Action History`) move out of `platform-objects`' `SETUP_NAV_CONTRIBUTIONS`
    into `plugin-approvals`' `navigationContributions`. The plugin fills the slot
    it owns; when the plugin is absent the slot stays empty.
  - **i18n (D8)** — the objects are removed from the `platform-objects` i18n
    extract config; their existing generated translation bundles keep working at
    runtime (object-name keyed). Migrating the i18n extraction/bundles to the
    plugin remains the tracked cross-cutting follow-up (best done with the
    `os i18n extract` tooling, not hand-edited generated files).

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

### Patch Changes

- 23c7107: ADR-0020 — converge the three "state machine" declaration shapes to one
  **enforced** `state_machine` validation rule.

  Before this change a record state machine could be declared three ways (a
  `workflow` metadata type, an `object.stateMachines` map, or a `state_machine`
  validation rule) and **none of them were enforced at runtime** — a declarative
  guardrail that was pure decoration, and a hallucination trap for AI authors.

  **Enforcement (`@objectstack/objectql`)**

  - New `validation/rule-validator.ts` evaluates the object's `validations` union
    on the write path: `evaluateValidationRules`, `needsPriorRecord`, and the
    `legalNextStates` introspection helper (all exported from the package root).
  - `state_machine` rules reject illegal `field` transitions on update (with the
    rule's `message`); `script` / `cross_field` predicate rules now also fire
    (they were silently broken on PATCH updates because only the patch, not the
    prior record, was available). The engine plumbs the prior record into
    rule evaluation on single-row update; multi-row (`updateMany`) updates log a
    warning and skip rule evaluation rather than enforce on incomplete data.

  **Convergence / retirement (`@objectstack/spec`) — breaking**

  - Retires the `workflow` metadata type (removed from the metadata-type enum,
    the registry, the schema map, the `workflows` collection key, and the
    plural→singular mapping).
  - Removes the `object.stateMachines` map and the `stack.workflows` array. The
    `state_machine` validation rule is the single canonical home.
  - The XState-style `StateMachineSchema` file is **kept** (still used by the
    agent conversation lifecycle and the discovery protocol); only its role as
    the `workflow` metadata-type backing schema was removed. The optional
    `workflow` **RPC service** surface (`CoreServiceName.workflow`,
    `/api/v1/workflow`, `IWorkflowService`) is kept as a documented follow-up.

  **Introspection (`@objectstack/runtime`)**

  - Adds `GET /metadata/objects/:name/state/:field?from=:state`, returning the
    legal next states for a field (`next: null` when no FSM governs the field,
    `[]` for a declared dead-end) so UIs/agents read the transition table instead
    of re-deriving it.

  **Surfaces (`@objectstack/platform-objects`, `@objectstack/cli`)**

  - Studio drops the standalone "Workflow Rules" nav (state machines are edited
    alongside the object's other validation rules).
  - `explain` no longer lists `workflow` as a related metadata type.

  Migration: replace a `workflow` / `StateMachineConfig` declaration with a
  `state_machine` validation rule on the object (`field` + `{ from: [allowedTo] }`
  transition table), and move any side-effecting actions (emails, task creation)
  into a record-triggered or scheduled Flow (ADR-0019). See the migrated
  `examples/app-crm` flows for the pattern.

- 4404572: ADR-0029 D8 — migrate i18n ownership for the moved domains to their plugins.

  The object translations for the domains decomposed in K2.a/K2.b/K2 previously
  lived in the `@objectstack/platform-objects` generated bundles even though the
  objects now live in their capability plugins. This moves each domain's i18n
  extraction + bundles to the owning plugin, preserving every hand-translated
  string (zh-CN / ja-JP / es-ES):

  - Each plugin gains a build-time `scripts/i18n-extract.config.ts` and a
    `src/translations/` bundle (`{locale}.objects.generated.ts` + an `index.ts`
    barrel), generated with `os i18n extract` and self-baselined so re-runs
    preserve translations.
  - Each plugin loads its bundle at runtime on `kernel:ready` via
    `i18n.loadTranslations` (the i18n service is optional — load is best-effort).
    - `plugin-webhooks` ← `sys_webhook`, `sys_webhook_delivery`
    - `plugin-approvals` ← `sys_approval_request`, `sys_approval_action`
    - `plugin-security` ← `sys_position`, `sys_permission_set`,
      `sys_user_permission_set`, `sys_position_permission_set`
    - `plugin-sharing` ← `sys_record_share`, `sys_sharing_rule`, `sys_share_link`
  - `@objectstack/platform-objects` translation bundles are regenerated to drop
    those objects' keys (its extract config already excluded them); all other
    objects' translations and the metadata-form bundles are preserved.

  Net runtime effect is unchanged (same translations load, now contributed by the
  package that owns each object) — closing the D8 follow-up tracked since K2.a.

- 82eb6cf: Fix system-metadata translations: locale fallback, app/dashboard localization, and coverage gaps.

  Switching the UI language left many surfaces in English. Three root causes
  are addressed:

  - **Locale fallback (server).** The metadata translation resolver
    (`@objectstack/spec` `i18n-resolver`) now resolves a requested locale
    against the locales actually present in the bundle (exact →
    case-insensitive → base-language → variant), so a request for `zh`
    correctly hits the `zh-CN` bundle instead of falling back to English.
    This mirrors `resolveLocale` in `@objectstack/core` and benefits every
    resolver (objects, views, actions, settings, metadata forms).

  - **App & dashboard localization (server).** Added `translateApp` and
    `translateDashboard` resolvers and wired `app`/`dashboard` into the REST
    `/meta` translation path. App labels, sidebar/navigation group labels,
    and dashboard titles/widgets were previously never localized at the API
    boundary even though the translation data existed.

  - **Coverage & quality (data).** Added translations for the previously
    untranslated platform objects `sys_share_link`, `sys_view_definition`,
    and `sys_metadata_audit` (and registered them in the i18n-extract config
    so future extractions keep them). Replaced English placeholder strings
    left in the `zh-CN` / `ja-JP` / `es-ES` object and metadata-form bundles
    (notably action `confirmText` / `successMessage` prompts). Added the
    missing `es-ES` built-in Settings bundle in `@objectstack/service-settings`.

- c381977: Harden the notification pipeline: race-safe dedup + opt-in retention (ADR-0030).

  **Race-safe dedup.** `sys_notification.dedup_key` is now declared a **UNIQUE**
  index (was a plain index), and `emit()` **converges on a unique-key conflict**:
  the pre-insert `dedup_key` check is a fast-path, but if a concurrent `emit`
  raced past it and inserted first, our insert hits the violation — we catch it
  and converge to the winner's event (a dedup hit) instead of throwing or
  double-emitting. This mirrors the delivery outbox's enqueue convergence and
  stops a record-change storm from producing duplicate bell notifications. SQL
  treats NULLs as distinct, so the common events with no `dedup_key` are
  unconstrained. (Enforcement is per-driver: where declared indexes are
  materialized the conflict path activates; drivers that don't materialize them
  fall back to the best-effort fast-path — the catch is simply never taken. Note
  the SQL driver currently doesn't sync declared object indexes, which already
  affects the delivery/receipt unique indexes — tracked separately.)

  **Opt-in retention.** New `NotificationRetention` sweeper + plugin options
  `retentionDays` / `retentionSweepMs`. Every `emit()` writes a `sys_notification`
  event (plus delivery/materialization/receipt rows), so a high-frequency
  periodic flow grows the tables unbounded. When `retentionDays > 0`, a
  low-frequency sweep (default hourly, timer `unref`'d) bulk-deletes events,
  deliveries, inbox messages and receipts older than the cutoff — a notification
  ages out wholesale, keeping the model consistent (no dangling `notification_id`)
  and the bell (recent-only) unaffected. The delivery row's epoch-ms `created_at`
  vs the others' ISO `created_at` is handled per target. **Default off** — no
  notification data is deleted without explicit operator policy. Each target is
  isolated (one object's failure doesn't abort the sweep), and the sweep runs
  under a system context (retention is a cross-tenant operator policy).

  Tests: +7 `service-messaging` cases (converge-on-conflict, non-conflict
  rethrow, retention cutoff-formatting per target, no-engine / non-positive
  no-ops, failure isolation, missing-count) — 102 passing.

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

- 6228609: Account App: route Profile to a custom React component instead of the
  generic sys_user record page.

  The Account App's `nav_account_profile` entry switched from
  `type: 'object'` (sys_user record, current user id) to
  `type: 'component'` with `componentRef: 'account:profile_card'`.
  End users now see a settings-form-style "My Profile" card
  (avatar / name / password / SSO recovery) registered by the Console
  runtime, while the `sys_user` slotted record page (`SysUserDetailPage`)
  is unchanged and remains the admin view reached from Setup → Users.

  This is a behavioural change for any Studio override that mutates
  `nav_account_profile`: the entry no longer has `objectName`,
  `recordId`, or `requiresObject`. Override consumers should drop
  those fields and target `componentRef: 'account:profile_card'`
  (or restore the previous nav item type explicitly).

  Requires a Console build that registers `account:profile_card`
  (included in the matching `@object-ui/console` release pinned via
  `.objectui-sha`).

  Verified end-to-end: login → Account App → 个人资料 sidebar item
  → `/_console/apps/account/component/account/profile_card` renders
  the React Profile card; editing Name and clicking Save Changes
  POSTs `/api/v1/auth/update-user` (200) and persists.

  Also removes the `nav_account_preferences` entry that exposed the
  raw `sys_user_preference` table as a "Preferences" page in the
  Account App. `sys_user_preference` is an internal key-value store
  the UI uses for state like `ui.recent`, `ui.favorites`, theme, and
  sidebar collapse — not a user-curatable settings surface. A future
  `account:preferences_card` React component should provide curated
  theme / locale / timezone / notifications toggles when needed.
  The corresponding `nav_account_preferences` i18n labels were
  removed from all locale bundles (en / es-ES / ja-JP / zh-CN).

  The upstream `@object-ui/console` release also fixes a latent
  `useState` bug in the same ProfilePage: when mounted under
  `<Suspense>` before `AuthProvider` resolves, `user` is null on
  first render and `setName(user?.name ?? '')` initialised to `''`
  with no follow-up sync. A `useEffect` now mirrors `user.name`
  into local state. This was masked when the page was only reached
  via the System Hub route (where `AuthGuard` ensured user was
  already loaded) and is exposed by the new mount path.

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Minor Changes

- 74470ad: **New `account` App for self-service identity management + `App.hidden` shell hint**

  Adds a dedicated **Account** App (`name: 'account'`, icon `user-circle`) that exposes the three end-user identity surfaces:

  - **Two-Factor Authentication** — `sys_two_factor`
  - **Linked Accounts** — `sys_account`
  - **OAuth Applications** — `sys_oauth_application`

  The app declares **no** `requiredPermissions`, so every authenticated user can reach it — unlike Setup, which requires `setup.access` and therefore excludes the default `member_default` permission set. Combined with the C-tier `resultDialog` actions already shipped on these objects (2FA QR + backup codes, OAuth `client_secret` reveal, `link_social` redirect), this replaces the legacy standalone `apps/account` SPA with a single console + metadata-driven surface.

  **New `App.hidden: boolean` field** (`packages/spec/src/ui/app.zod.ts`) hides an app from the top-level App Switcher. Hidden apps stay fully routable and permission-checked; the shell is expected to surface them through the avatar / user dropdown instead. Mirrors the GitHub Settings / Google account chip / Salesforce Personal Settings pattern. The Account app is the first user.

  Wiring: `plugin-auth` registers `ACCOUNT_APP` alongside `SETUP_APP` / `STUDIO_APP` (`packages/plugins/plugin-auth/src/auth-plugin.ts`). The legacy duplicate entries inside Setup's Advanced group are kept unchanged — they remain admin-only for tenant-wide inspection.

  **Follow-up for objectui**: the shell's `AppSwitcher` and avatar `DropdownMenu` need updating to honour `app.hidden` (filter hidden apps out of the switcher; render them as dropdown menu entries). Tracked separately.

- d29617e: Add `Action.resultDialog` for one-shot reveal of API responses

  Some platform operations return values the user MUST copy now because they
  cannot be retrieved later — TOTP enrollment URIs, OAuth client secrets,
  backup recovery codes. Previously these were handled by bespoke account-app
  pages because actions only surfaced a `successMessage` toast.

  This change adds:

  - **`Action.resultDialog`** — describes a post-success modal that renders
    selected fields from `result.data`. Supports `qrcode`, `code-list`,
    `secret`, `text`, and `json` field formats. When set, renderers SHOULD
    suppress `successMessage` and require explicit acknowledgement.

  - **`Action.target` interpolation contract** — formalised TSDoc spelling
    out the `${param.X}` and `${ctx.X}` substitution rules (with mandatory
    `encodeURIComponent` for URL query positions). Used by redirect-style
    actions like `link_social`.

  New / updated platform actions:

  - `sys_two_factor`: `enable_two_factor` now reveals TOTP URI + backup codes;
    added `regenerate_backup_codes`.
  - `sys_oauth_application`: `rotate_client_secret` now reveals the new
    secret; added `create_oauth_application` toolbar action.
  - `sys_account`: added `link_social` toolbar action (type:`url`, templated
    target) for self-service identity linking.

  These let the Setup app cover OAuth-app registration, 2FA enrollment, and
  social-account linking entirely through metadata, removing the last
  must-have reasons to ship a separate `apps/account` SPA.

  Renderer-side work (separate PR in `objectui`): consume `resultDialog`,
  implement `${param}/${ctx}` interpolation, ship `ResultDialog` component.
  See `c-tier-renderer-contract.md` design note.

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

### Patch Changes

- d29617e: Add self-service account & invitation actions on `sys_*` objects so the
  Setup App can host the day-to-day "account settings" affordances the
  standalone Account SPA used to own — no per-page React code needed.

  **New actions:**

  - `sys_user`
    - `update_my_profile` — wraps `POST /api/v1/auth/update-user` (name + image)
    - `change_my_password` — wraps `POST /api/v1/auth/change-password`
      (current + new + optional revoke-other-sessions)
    - `change_my_email` — wraps `POST /api/v1/auth/change-email`
      (verification email is sent to the new address)
    - `delete_my_account` — wraps `POST /api/v1/auth/delete-user`
      (requires current password)
  - `sys_invitation`
    - `accept_invitation` — wraps `POST /api/v1/auth/organization/accept-invitation`
    - `reject_invitation` — wraps `POST /api/v1/auth/organization/reject-invitation`
  - `sys_member`
    - `transfer_ownership` — wraps `POST /api/v1/auth/organization/update-member-role`
      with `role: 'owner'` (better-auth auto-demotes the previous owner to admin)

  All four `sys_user` self-service actions are gated by
  `visible: 'record.id == ctx.user.id'` so they only render on the signed-in
  user's own row — they never leak into the admin Users list. The two
  `sys_invitation` recipient actions use
  `record.email == ctx.user.email && record.status == 'pending'` so they
  only appear on the user's incoming invitations.

- 010757b: Fix two self-service identity action bugs:

  - `sys_two_factor` was missing the `verified` boolean column that better-auth's two-factor plugin writes during enrollment. Without it the `/2fa/enable` endpoint 500'd with `table sys_two_factor has no column named verified`. Added `Field.boolean({ defaultValue: true })` to match the better-auth schema.
  - `sys_account.link_social` action's `callbackURL` still pointed at the pre-migration Setup path (`/apps/setup/system/sys_account`). Updated to `/apps/account/sys_account` so users land back on the linked-accounts view after the OAuth dance.

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

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

- 45d27c5: Setup App: added a **Data Model** navigation group with **Objects** and
  **Fields** entries that open filtered list views of `sys_metadata`.

  To support the new entries, `sys_metadata.listViews` now includes
  `only_objects`, `only_fields`, and `all_metadata` — each filtered by
  `type` and projecting a curated column set (name, namespace, scope,
  managed_by, state, updated_at). The new list views are the read side of
  the protocol-driven metadata editing flow; the matching write surface
  is provided by `MetadataObjectsPage` / `MetadataFieldsPage` in
  `@object-ui/plugin-designer` (separate package), which call the
  existing `/api/v1/meta/*` REST endpoints.

  No behavioural changes to the metadata REST endpoints themselves; no
  migration required.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Minor Changes

- 4f9e9d4: Setup App: complete the Configuration settings pages.

  **Setup App navigation**

  The Configuration group now lists every built-in settings namespace
  (previously Storage was missing entirely, and Knowledge had no entry):

  - Branding · Email · **File Storage** · **AI & Embedder** · **Knowledge** · Feature Flags

  Order in the left-nav now matches `builtinSettingsManifests` so the
  "All Settings" index and the left-nav stay aligned.

  **AI manifest — embedder section**

  `ai.manifest.ts` now ships an Embedder section in addition to the
  existing chat-LLM section. Knobs:

  - `embedder_provider` — `none` (default) / `openai` / `azure` /
    `dashscope` (阿里通义) / `zhipu` (智谱) / `siliconflow` (硅基流动) /
    `doubao` (火山引擎) / `minimax` / `ollama` / `custom`. Preset list
    mirrors `@objectstack/embedder-openai`'s `OPENAI_COMPATIBLE_PRESETS`.
  - `embedder_api_key` — encrypted password.
  - `embedder_model` — free text with documented examples per provider.
  - `embedder_base_url` — visible for `custom` / `azure` only.
  - `embedder_dimensions` — optional Matryoshka override.
  - `embedder_batch_size` — `embed()` chunk batch size.
  - Test action wired to `POST /api/settings/ai/test_embedder` — fallback
    validates form completeness; real probe lives in `service-ai` /
    `service-knowledge`.

  **New `knowledge` settings manifest**

  `knowledge.manifest.ts` is the canonical surface for RAG infrastructure:

  - `adapter` — `memory` / `turso` / `ragflow`.
  - Turso group — `turso_url` (libsql://, file:, :memory:) + encrypted
    `turso_auth_token`. Leaving URL blank means "reuse the tenant's
    primary libSQL connection" — the recommended cloud setup.
  - RAGFlow group — base URL + encrypted API key + default dataset id.
  - Indexing defaults — `chunk_target`, `chunk_overlap`, `over_fetch`.
  - Permissions — `enforce_rls` defaults to `true` (security-critical;
    toggling off skips the platform's unique RLS re-check on every hit).
  - Test action wired to `POST /api/settings/knowledge/test`.

  **Translations**

  Full `ai` and `knowledge` translation blocks added to both `en.ts` and
  `zh-CN.ts`. Storage block had translations already.

  **Tests**

  - `ai.manifest.test.ts`: +5 cases covering embedder select, encryption,
    test action wiring, and embedder handler validation across 5 provider
    shapes (none / ollama / OpenAI-compatible cloud / custom / azure).
  - `knowledge.manifest.test.ts`: 20 new cases covering manifest shape,
    adapter selection, secret encryption, default `enforce_rls=true`,
    test handler validation across all 3 adapters and payload merging.

  78/78 tests pass in `@objectstack/service-settings`.

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

## 5.2.0

### Minor Changes

- bab2b20: feat(approvals): execution-pinned approval processes (ADR-0009)

  When an approval request is submitted, the engine now records a `process_hash`
  on `sys_approval_request` — the sha256 of the approval process body resolved
  through `MetadataRepository`. While the request is in flight, `approve` /
  `reject` / `recall` resolve the pinned process body via
  `MetadataRepository.getByHash`. Upgrading the approval process definition
  mid-flight therefore no longer affects requests that already started against
  the previous version.

  Behavior:

  - `sys_approval_request` gains a `process_hash` column (text, nullable,
    read-only). Existing rows keep working — the engine falls back to the
    current `sys_approval_process` projection when the column is empty.
  - `ApprovalServiceOptions` accepts an optional `metadataRepo`. When omitted
    (e.g. defining processes purely through the runtime API or in unit tests),
    pinning is silently disabled and the service behaves as before.
  - `ApprovalsServicePlugin` looks up the metadata service from the kernel
    and wires its repository automatically.
  - The metadata-core local `MetadataTypeSchema` enum was realigned with the
    canonical `@objectstack/spec/kernel` enum (drift fix: `approval`, `field`,
    `function`, `service`, …).

  This is the first user-visible consumer of the `executionPinned` capability
  introduced in ADR-0009.

### Patch Changes

- f0f7c27: Add `mark_read` / `mark_unread` row actions to `sys_notification` and polish
  listView columns + grouping.

  - Row-level `mark_read` / `mark_unread` actions guarded by CEL `visible`
    expressions so each only renders on rows in the appropriate state. Both
    use the generic PATCH `/api/v1/data/sys_notification/{id}` endpoint with
    `bodyExtra` to flip `is_read` (and clear `read_at` on unmark).
  - Reordered listView columns to lead with `title` + `actor_name` (the "who
    did what" users actually scan) and demote `type` to a chip column.
  - `mine` view now groups by `type` so mention/assignment storms don't bury
    system or task_due rows.

  `mark_all_read` is intentionally not added server-side — there's no bulk
  PATCH primitive on the REST surface yet, and the popover already handles
  multi-row mark-all client-side via N single-row PATCHes
  (`InboxPopover.tsx` → `AppHeader.markAllRead`).

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

## 5.1.0

### Minor Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- 888a5c1: PR-10d.3 — feature flag for `SysMetadataRepository.put` write path in `saveMetaItem`.

  - `ObjectStackProtocolImplementation` now accepts an `options.useRepositoryWritePath` flag
    (also honored via `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`) that routes overlay writes
    through `SysMetadataRepository.put`, appending to the change-log and emitting HMR `seq`.
  - `saveMetaItem` request grew optional `parentVersion` (If-Match) and `actor` fields.
    `ConflictError` is mapped to a 409 `metadata_conflict` API error.
  - Plural metadata type aliases (`views`, `dashboards`, ...) are normalized to singular
    before the repo's overlay-allowlist gate.
  - `SysMetadataRepository.put`/`delete` now update/delete by row `id` (the engine's
    strict `.update` semantics require an id or `multi:true`).
  - `sys_metadata.checksum` column widened from 64 → 71 chars to hold the `"sha256:"`
    prefix produced by `hashSpec()`.
  - Default behaviour unchanged: legacy raw-engine path remains until PR-10d.4 flips the
    flag and removes it.

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
