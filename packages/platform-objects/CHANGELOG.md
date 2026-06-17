# @objectstack/platform-objects

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

  - **`@objectstack/plugin-security`** (RBAC) gains `sys_role`,
    `sys_permission_set`, `sys_user_permission_set`, `sys_role_permission_set`,
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
    - `plugin-security` ← `sys_role`, `sys_permission_set`,
      `sys_user_permission_set`, `sys_role_permission_set`
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
