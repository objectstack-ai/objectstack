# @objectstack/plugin-audit

## 17.0.0-rc.0

### Minor Changes

- f243727: remove(plugin-audit): drop the kernel's built-in assignment notifications; move the policy to user-space automation (#3403)

  **Breaking (behavioral).** `plugin-audit` no longer emits a `collab.assignment`
  notification when an owner/assignee field changes on a record. Deciding that an
  assignment warrants a bell is a business policy, not a platform default — the
  kernel version guessed "who is the assignee" from field names (`owner_id`,
  `assigned_to`, `assignee_id`, `owner`, `assignee`), which misfired on system
  records like `sys_file` and spammed users with "…assigned to you" noise on file
  uploads (#3402).

  **What was removed:** the `writeAssignmentNotifications` writer, the `OWNER_FIELDS`
  heuristic, and the `messages.assignedToYou` translation key (en / zh-CN / ja-JP /
  es-ES). **Unaffected:** `sys_audit_log` / `sys_activity` capture, and `@mention`
  notifications (`collab.mention`) — those remain platform behavior. The
  `owner_of:` messaging audience and `service-messaging`'s `DEFAULT_OWNER_FIELDS`
  are a separate, caller-requested mechanism and are unchanged.

  **FROM → TO migration.** If you relied on the automatic bell, configure an
  automation flow on the target object (`record-after-update` / `record-after-create`
  trigger + a `notify` node). The `condition` can read the pre-update row via
  `previous`, and `notify`'s `recipients` / `title` / `actionUrl` all interpolate
  record fields. Ready-made example: `showcase_task_assigned_notify` in
  `examples/app-showcase/src/automation/flows/index.ts`:

  ```ts
  { id: 'start', type: 'start', config: {
      objectName: 'your_object',
      triggerType: 'record-after-update',
      condition: 'assignee != previous.assignee',
  } },
  { id: 'notify_assignee', type: 'notify', config: {
      topic: 'task.assigned',
      recipients: ['{record.assignee}'],
      channels: ['inbox'],
      title: 'New assignment: {record.title}',
      actionUrl: '/your_object/{record.id}',
  } },
  ```

  Notes on parity: the flow template renders a single language (the kernel version
  localized the title to the recipient's locale); a flow fires on every real change
  (the `previous` condition already gates that) and, unless you add an actor guard,
  also notifies self-assignments — the kernel version suppressed those.

### Patch Changes

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

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
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

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
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- ee0a499: feat(i18n): localize collaboration notification titles and the storage objects; wire the notifications REST routes

  Three gaps behind one report (a `sys_file "repro.png" assigned to you`
  notification that was English on an all-Chinese workspace, opened an English
  detail page, and never cleared its unread state):

  - **plugin-audit** — the assignment (`collab.assignment`) and @mention
    (`collab.mention`) bell titles were hardcoded English literals built from the
    raw object API name. They now resolve through the i18n service with the same
    key shapes as the activity summaries (framework#3039): new
    `messages.assignedToYou` / `messages.mentionedYou` /
    `messages.mentionedYouAnonymous` templates (en / zh-CN / ja-JP / es-ES), the
    object named by its translated label (`objects.{name}.label` → authored def
    label → API name), and the locale resolved for the **recipient** (they read
    the bell), not the acting user. Every step stays best-effort: no locale / no
    i18n / key miss degrades to the English literal — which now also prefers the
    authored object label over the API name.

  - **service-storage** — `sys_file` / `sys_upload_session` had no translation
    bundle at all, so the file detail page (labels, and the Pending Upload /
    Committed / Deleted status pipeline) rendered English on every locale. The
    service now ships its own ADR-0029 D8 bundle (en / zh-CN / ja-JP / es-ES,
    `src/translations` + `scripts/i18n-extract.config.ts`) and contributes it via
    `i18n.loadTranslations` on `kernel:ready`, matching service-messaging.
    (`sys_attachment` stays in platform-objects' bundles pending the
    storage-domain decomposition.)

  - **runtime** — the in-app notifications REST surface (`GET
/api/v1/notifications`, `POST /api/v1/notifications/read`, `POST
/api/v1/notifications/read/all`; ADR-0030) had its `handleNotification`
    dispatch branch and discovery entry, but no `server.<verb>()` mount in
    `dispatcher-plugin`, so only the cloud hosts' hono catch-all reached it — the
    standalone / `os dev` server 404'd every request. That left mark-read with no
    working endpoint (the console's direct `sys_notification_receipt` write is
    rejected by ADR-0103's engine-owned gate), so unread notifications could never
    clear. The three routes are now mounted explicitly, guarded by the
    route-registration regression test.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

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
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Patch Changes

- f531a26: ADR-0085 #2548 follow-ups surfaced by the real-backend browser pass:

  - **lint**: new `field-group-shadowed` warning in `validate-semantic-roles` — a
    declared fieldGroup whose every visible member is hoisted into the detail
    highlight strip (or is the record title) renders on forms but silently never
    on detail pages (detail bodies hide the first 4 highlightFields). Warning
    tier, same as the other semantic-role rules.
  - **plugin-audit**: feed/audit summaries ("Created … / Deleted … / Updated …")
    now name the object by its display label ("Semantic Zoo") instead of its API
    name ("showcase_semantic_zoo") — these strings render verbatim in the record
    Discussion feed and Setup dashboards. Falls back to the API name when the
    object definition isn't resolvable. Existing stored rows are unchanged.

- f531a26: Localize activity summaries to the workspace default locale (#3039). Activity
  writers previously hardcoded English verbs and the object API name
  (`Created person_qualification "OC-00001"`). The writer now resolves the
  ADR-0053 `localization.locale` setting per write (memoized per tenant/user
  scope), renders the verb through new `messages.activityCreated/Updated/Deleted`
  i18n templates (en, zh-CN, ja-JP, es-ES shipped), and names the object by its
  localized label (`objects.{name}.label`) with fallback to the authored def
  label, then the API name. Missing i18n/settings services or bundle keys
  degrade to the previous English summaries.
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
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0

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
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Minor Changes

- e2fa074: feat(data): make object `enable.feeds`/`enable.activities` real opt-out gates; define the `enable.trackHistory` contract (#2707)

  `ObjectSchema.enable.{files,trackHistory,activities,feeds}` were parsed but
  (mostly) unconsumed — an author setting them got nothing, silently. Per the
  enforce-or-remove doctrine, each flag now has a defined enforcement contract:

  - `enable.activities` — opt-OUT writer gate. Spec default flips
    `false → true`; plugin-audit keeps mirroring CRUD into the `sys_activity`
    timeline unless the object declares an explicit `activities: false`
    (behavior-preserving for every existing stack; the off-switch is the
    per-object lever for activity-row growth, ADR-0057). The compliance
    `sys_audit_log` row is NOT gated.
  - `enable.feeds` — opt-OUT with server-side enforcement. Spec default flips
    `false → true`; an explicit `feeds: false` now rejects `sys_comment`
    creation targeting that object at the engine hook seam
    (403 `FEEDS_DISABLED`, fail-closed like `CLONE_DISABLED`).
  - `enable.trackHistory` — was misclassified `dead` in the liveness ledger:
    the console has gated the record History tab on it since 2026-05.
    Reclassified live with the two-grain contract documented (object flag =
    History-tab master switch; per-field `trackHistory` = diff selector; audit
    _capture_ stays unconditional as a compliance ledger).
  - `enable.files` — stays dead + authorWarn (reserved for the future generic
    Attachments panel; use `Field.file`/`Field.image` meanwhile). Its
    `describe()` now says so instead of advertising a capability that
    doesn't exist.

  The default flips can't be avoided: with `default(false)`, compiled output
  materializes `false` for every object with an `enable` block, making
  "author explicitly opted out" indistinguishable from "schema default" — so
  opt-out semantics require the default to be `true` (same posture as
  `trash`/`mru`/`clone`). Liveness ledger + reference docs regenerated;
  compile-time authorWarn now fires only for `enable.files`.

- 23c8668: feat(data): `enable.files` goes live — opt-in gate for the generic Attachments surface (#2727)

  The last dead ObjectCapabilities flag gets its enforcement contract.
  `enable.files` is opt-IN (spec default stays `false`): the generic record
  Attachments panel is a new surface, not an existing behavior.

  - plugin-audit registers a `sys_attachment` beforeInsert hook: attachment
    join rows may only target objects that explicitly declare
    `enable: { files: true }` — anything else (absent block, absent flag,
    explicit false, unknown object) rejects fail-closed with
    403 `FILES_DISABLED` (CLONE_DISABLED / FEEDS_DISABLED pattern).
  - `mapDataError` maps `FILES_DISABLED` → 403 with the gated target object
    (generic data routes bypass `sendError`'s `.status` passthrough — the
    #2707 lesson, applied at introduction time).
  - `Field.file` / `Field.image` are deliberately independent: they store
    the file URL in the record's own column and never create
    `sys_attachment` rows, so field-level attachments work regardless of
    this flag.
  - Liveness ledger: `enable.files` dead→live, authorWarn dropped —
    ObjectCapabilities is now 100% live. The compile-time
    liveness-dead-property warning no longer fires for it; `describe()` and
    the reference docs state the real contract.

  Companion objectui PR ships `RecordAttachmentsPanel` (upload/list/
  download/delete over the presigned three-step storage flow), rendered on
  record pages when the flag is true.

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
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0

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

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

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

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

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
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

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
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0

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

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/platform-objects@9.9.1

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
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1

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

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/platform-objects@8.0.1

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
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

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

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

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

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.2.10

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

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
