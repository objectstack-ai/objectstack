# @objectstack/rest

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/service-package@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/service-package@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/service-package@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/service-package@11.2.0

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

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/service-package@11.1.0

## 11.0.0

### Patch Changes

- 359c0aa: fix(objectql,rest): single-item meta reads must revalidate (no `max-age=3600`)

  `GET /api/v1/meta/object/:name` (and the other single-item meta reads served by
  the cached path) sent `Cache-Control: public, max-age, max-age=3600`. Two bugs:

  1. **Stale metadata for up to an hour.** Object metadata is invalidated by
     publish, but a one-hour TTL let browsers (and any CDN/proxy) serve a stale
     schema _without revalidating_ — e.g. the AI-build "New" create form kept
     rendering pre-publish fields until the TTL lapsed. The list endpoint
     `GET /api/v1/meta/object` is uncached, which is why list views updated but
     single-object reads didn't. `getMetaItemCached` now returns
     `directives: ['private', 'no-cache']` with no `maxAge`, so the ETag validator
     (which already changes on publish) gates freshness: a cheap `304` when
     unchanged, fresh fields the instant a publish bumps the ETag. `private` also
     keeps per-tenant metadata out of shared caches.

  2. **Malformed header.** The directives array carried a bare `max-age`
     placeholder _and_ the REST layer appended `max-age=3600` from the `maxAge`
     field, concatenating into `public, max-age, max-age=3600`. The header builder
     now strips the bare `max-age` token before appending the real value, so a
     `maxAge` is emitted once as a well-formed `max-age=N`.

- 9a810f8: fix(rest): register static data-action routes before the greedy `:object/:id` matcher

  The REST router matches first-registered-wins with no specificity sorting, but
  `registerDataActionEndpoints` (which holds `GET /data/:object/export`) ran AFTER
  `registerCrudEndpoints` (which holds the greedy `GET /data/:object/:id`). A
  request to `GET /data/<object>/export` was therefore captured by `:object/:id` —
  `"export"` treated as a record id — returning `404 RECORD_NOT_FOUND` instead of
  streaming the export. The data-action registration now runs first, mirroring the
  existing `/meta/:type/:name/references`-before-`/meta/:type/:name` convention.
  Reordering is safe both ways: `registerDataActionEndpoints` contains no greedy
  2-segment `:object/:id` routes, so it cannot shadow any CRUD literal. A
  regression test asserts the export route registers ahead of the get-by-id route.

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

- aa33b02: fix(security): single-source the request authorization resolver — REST no longer drops sys_user_role

  The REST server and the runtime dispatcher each carried their own copy of the request → ExecutionContext identity/role resolver, and they drifted on a security path. The REST copy silently omitted `sys_user_role` (so custom roles granted via the ADR-0057 D4 platform-RBAC path did not apply over REST), `sys_role_permission_set`, the `owner→org_owner` membership normalization, the platform-admin derivation, and the `ai_seat` synthesis — fail-closed (legitimate access denied), not an escalation.

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
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/service-package@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/service-package@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/service-package@10.2.0

## 10.1.0

### Patch Changes

- 517dad9: Schema drift detection + `os migrate` for non-additive metadata changes (#2186).

  The metadata→DB schema sync was additive-only: it created tables and added
  columns but never altered/dropped existing ones, so relaxing `required`,
  changing a type/length, or dropping a field silently diverged from an existing
  database. The physical column won at write time, surfacing a misleading
  `organization_id is required` 400 even though `/meta` reported the field
  optional.

  - **driver-sql** — the SQL driver now detects managed-schema drift (metadata is
    the source of truth) and categorises each divergence `safe` / `needs_confirm`
    / `destructive`. `initObjects` warns once per divergence with an actionable
    hint. A new opt-in `SqlDriverConfig.autoMigrate: 'safe'` auto-applies the
    _loosening_ subset (relax `NOT NULL`, widen varchar) so an existing dev DB
    self-heals on restart — never destructive, force-disabled under
    `NODE_ENV=production`. New public methods `detectManagedDrift()` /
    `applyMigrationEntries()`. SQLite reconciles via the official table-rebuild
    (copy → swap), preserving data; Postgres/MySQL alter in place.
  - **cli** — new `os migrate plan` (dry-run, categorised diff) and
    `os migrate apply` (`--allow-destructive` for drops/tightenings, confirm gate,
    `--json`). `os dev`/`serve` now pass `autoMigrate: 'safe'` in dev only.
  - **rest** — a `NOT NULL` violation that reaches the driver (metadata validation
    already passed) now carries a drift-aware `hint` pointing at `os migrate`,
    instead of only the misleading "field is required" message. The
    `VALIDATION_FAILED` / `fields` envelope is unchanged for back-compat.

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/service-package@10.1.0

## 10.0.0

### Minor Changes

- 2256e93: Setup nav: gate Organizations/Invitations on multi-org; enforce `requiresService` server-side (ADR-0057 addendum D10).

  `rest-server`'s `filterAppForUser` now honours `NavigationItem.requiresService` — entries
  whose named kernel service isn't registered are dropped from the served app metadata
  (fail-open when the kernel can't be probed; previously the field was a frontend-only hint).
  Applies `requiresService: 'org-scoping'` to the Setup app's Organizations and Invitations
  entries, so they surface only in multi-org (multi-tenant) deployments and disappear in
  single-tenant. Business Units is intentionally left ungated — it is open per the open/paid
  seam + D12 ("pick people by BU"); only the hierarchy rollup capability is enterprise.

- 220ce5b: Resolve the tenant default currency onto ExecutionContext.

  Adds `ExecutionContext.currency` (ISO 4217) and resolves it from the
  `localization.currency` setting alongside `timezone`/`locale` — in both the
  runtime `resolveExecutionContext` and the REST mirror. This is the foundation
  for the documented "applied when a currency field omits its own" fallback: the
  tenant default is now carried on every request context, so analytics enrichment,
  formatters, and renderers can resolve a measure/field currency down to the org
  default instead of hard-coding it. Undefined when no tenant default is
  configured (consumers then render a plain number).

### Patch Changes

- 3754f80: Fix: the Setup-nav capability gate (`requiresService`, ADR-0057 D10) was a no-op on the single-item app-meta path.

  `GET /meta/app/:name` returns a metadata envelope `{ type, name, item: <app>, ... }`, but
  `filterAppForUser` was applied to the envelope — whose `.navigation` is undefined — so it
  returned it untouched, silently bypassing BOTH the `requiredPermissions` gate and the D10
  `requiresService` gate. Organizations/Invitations therefore still appeared in the Setup app
  even in single-tenant deployments. `filterAppForUser` and `resolveRegisteredServices` now
  unwrap the envelope (the list path already passed the raw app). Verified against a live
  `os dev`: single-tenant hides Organizations/Invitations; multi-tenant shows them.

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
  - @objectstack/service-package@10.0.0

## 9.11.0

### Patch Changes

- e7f6539: feat(rest): warn on fail-open anonymous posture (ADR-0056 D2, warn→enforce)

  Secure-by-default work for the data API. The deny capability already exists
  (`api.requireAuth=true` rejects anonymous via `enforceAuth`, and share-link /
  `guest_portal` / control-plane routes are exempt) — but the **default is fail-open**
  (`requireAuth=false`), so an object with no OWD/RLS is world-readable with no signal.
  This adds a boot-time WARN when running in that posture, making it explicit
  (consistent with D4/D8 honesty). The global default is deliberately NOT flipped here
  — that is a release-gated decision; flipping it would 401 deployments that rely on
  anonymous reads. Proven by the `showcase-anonymous-deny` dogfood test (anonymous
  read+write → 401, authenticated → 200, control-plane open).

- 751f5cf: feat(security): declaration-derived public-form authorization (ADR-0056, Option A)

  Public form submissions are now authorized by the **declaration**, not by a
  deployment-configured `guest_portal` profile. The form-submit route derives a narrow
  `publicFormGrant: { object }` from the matched form's target object; the SecurityPlugin
  honors it as a least-privilege capability — **create + the immediate read-back on THAT
  object only**, with no userId, and crucially NOT the anonymous fall-open. This makes
  public forms work under secure-by-default (`requireAuth`) **without** a hand-configured
  `guest_portal`, scoped to exactly the declared object (the field allow-list is still
  enforced at the route; `guest_portal`/`anonymous` are kept on the context for back-compat
  with guest-detection hooks). It is the prerequisite that unblocks the eventual
  `requireAuth` default flip, and generalizes the platform principle "public access =
  declared + runtime-derived scoped grant" (the same shape share-links already use).
  Proven by `form-self-auth` dogfood (create on target allowed; cross-object + update/delete
  denied). plugin-security 108, rest 121, full dogfood 98 — no regression.

- 2afb612: feat(security): resolve `current_user.email` in RLS owner policies

  RLS `using` predicates can now reference **`current_user.email`** — a unique,
  human-readable, _seedable_ owner anchor (`owner = current_user.email`). Previously
  the RLS compiler resolved only `current_user.id` / `organization_id` / `roles` /
  `org_user_ids`, so any owner-by-name/email predicate silently compiled to the
  deny sentinel (fail-closed → the user saw nothing). Email is sourced for free
  from the auth session (with a bounded `sys_user` fallback for the API-key path)
  and threaded onto the `ExecutionContext` in both identity resolvers — the REST
  data path (`rest-server`) and the dispatcher path (`resolve-execution-context`).

  Display `name` is deliberately **not** exposed to RLS: names collide, and a
  collision on an ownership predicate is an access-control leak. Only unique
  identifiers (`id`, `email`) are resolvable.

  This makes owner-scoped row-level security work with seed data (no per-user ids
  needed) and, combined with `controlled_by_parent` (ADR-0055), lets a master's
  owner scoping flow to its detail records. The example-showcase demonstrates it:
  `showcase_invoice` carries an `owner` email + an owner RLS policy, its lines are
  controlled-by-parent, and invoices/lines are seeded per owner. It also fixes the
  showcase's previously inert owner predicates (they used `==` and `current_user.name`,
  neither of which the compiler accepts) to `= current_user.email`.

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
  - @objectstack/service-package@9.11.0

## 9.10.0

### Patch Changes

- fd07027: fix(analytics): make organization timezone actually drive date-dimension bucketing (ADR-0053 Phase 2, #1982)

  Date-bucketed analytics silently ignored the reference timezone end-to-end. Three independent seams were broken:

  - **service-analytics** — `NativeSQLStrategy` (priority 10) won every cube/dataset query on a SQL driver, but it groups by the raw column (no `date_trunc`) and ignores `timezone`, so a date dimension never bucketed (one row per raw timestamp) and a non-UTC zone was dropped. It now declines queries that carry a `timeDimensions[].granularity`, handing them to `ObjectQLStrategy` → `engine.aggregate` (native bucketing when UTC-safe, uniform in-memory bucketing when non-UTC).
  - **objectql** — the in-memory `count` aggregation treated the `*` count-all sentinel (the Cube `count` measure / a fieldless dataset `count`, both compiled to `sql: '*'`) as a column name, counting non-null of a non-existent property → `0` for every bucket. The driver's `COUNT(*)` masked it; the in-memory path (non-UTC date buckets, `driver-rest`/`driver-memory`) returned zeros. `*` is now counted as all rows.
  - **rest** — `resolveExecCtx` never resolved the localization timezone/locale, so `/analytics/dataset/query` always ran with `timezone: 'UTC'`. It now resolves them through the `settings` service (honouring the 4-tier cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override), mirroring the dispatcher path.

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/service-package@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/service-package@9.9.1

## 9.9.0

### Minor Changes

- 44c5348: fix: two runtime gaps found by driving the CRM example end-to-end.

  **Delete of a parent with a required-FK child no longer fails with a misleading "<field> is required" error.** `cascadeDeleteRelations` defaulted a `lookup` FK to `set_null`; for a _required_ FK that issued an UPDATE clearing the column, which the child's validator rejected with a `400 "<field> is required"` naming a field that isn't even on the object being deleted (e.g. deleting a `crm_account` with opportunities → `"account is required"`). A required FK can't be nulled, so a _defaulted_ `set_null` now escalates to `restrict`: the delete is refused with a clear `409 DELETE_RESTRICTED` carrying the dependent object + count (`"Cannot delete crm_account (…): 4 dependent crm_opportunity record(s) reference it via account … set deleteBehavior:'cascade'"`). Explicit `cascade`/`restrict` and optional (nullable) lookups are unchanged.

  **Removed the hardcoded `POST /data/lead/:id/convert` endpoint + `convertLead` protocol method.** It hardcoded bare object names (`lead`/`account`/`contact`/`opportunity`) and a fixed Salesforce field mapping into the framework runtime, so it was unreachable by any real (namespaced) app — `/data/crm_lead/:id/convert` 404s, and the literal `lead` object doesn't exist. Lead conversion is an app concern modeled correctly as a flow (the CRM ships a `crm_convert_lead_wizard` screen flow); baking a CRM-specific workflow into the framework was false surface. Untested, undocumented, unused by the example. Removed.

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
  - @objectstack/service-package@9.9.0

## 9.8.0

### Minor Changes

- 7fe0b91: feat(rest): enforce object-level API exposure (`enable.apiEnabled` / `enable.apiMethods`) on the REST data surface (ADR-0049 #1889). Previously these flags were parsed but unenforced — an object could not be hidden from the automatic API, a false sense of security. Now: `apiEnabled: false` → the object's `/api/v1/data/{object}` routes return 404 (existence not revealed); a non-empty `apiMethods` whitelist → operations outside it return 405. Enforced across list/get/create/query/update/delete/import/export/batch/createMany/updateMany/deleteMany. Default-allow (objects with no `enable` block, or `apiEnabled` unset/true and no `apiMethods`) behave exactly as before — no regression. This is the _external_ API boundary only; internal callers (hooks, flows, objectql) are unaffected.
- 884bf2f: feat: record clone — wire the `object.enable.clone` capability to a real runtime (previously a parsed-but-dead flag).

  - **objectql**: new `protocol.cloneData({ object, id, overrides?, context? })` — reads the source record, drops engine-owned columns (`id` + audit `created_at`/`created_by`/`updated_at`/`updated_by`, plus `system`-flagged, `autonumber`, `formula` and `summary` fields) so the insert path re-derives them, applies caller `overrides` last, and inserts the copy. Shallow by design (duplicates the record's own fields, not its child records). Gated by `schema.enable.clone`: default-on, an explicit `enable.clone === false` throws `403 CLONE_DISABLED`.
  - **rest**: new `POST /api/v1/data/:object/:id/clone` (201 → `{ object, id, sourceId, record }`). Optional body `{ overrides }` (or a bare field map) overrides copied values, e.g. a new `name` or a cleared unique field. Honors the same auth + `enable.apiEnabled`/`apiMethods` gates as the rest of the data surface; `enable.clone === false` → 403.

  Reclassifies `object.enable.clone` `dead → live` in the spec liveness ledger.

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/service-package@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/service-package@9.7.0

## 9.6.0

### Minor Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/service-package@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/service-package@9.5.1

## 9.5.0

### Minor Changes

- d08551c: feat(ADR-0046): per-locale documentation content (doc i18n)

  Docs can now ship localized bodies. Authors add sibling locale-variant files
  `src/docs/<name>.<locale>.md` (e.g. `crm_lead_guide.zh.md`, `..pt-BR.md`) next
  to the base `<name>.md`; the base stays the default and the fallback. Flatness is
  preserved — variants are flat siblings, not subdirectories.

  - **spec**: `DocSchema` gains an optional `translations` map
    (`locale → {label?, description?, content}`) plus `resolveDocLocale(doc, locale)`,
    which collapses a doc to the best-matching locale (exact → primary subtag
    `zh-CN`→`zh` → base) with per-field fallback and strips the `translations` map.
  - **cli (collect-docs)**: variant files are folded into the base doc's
    `translations`; orphan/duplicate variants and the v1 MDX/image bans are linted
    on variant content too.
  - **rest**: `/meta/doc` (list + single) resolves the request locale from the
    existing `Accept-Language` / `?locale` negotiation, returns one localized body,
    and never ships the `translations` map. Doc detail bypasses the response cache
    so a language switch can't return a stale-locale body.
  - **setup / studio**: the built-in overview docs now ship `zh` translations
    (TS-first inline `translations`), so a Chinese console renders Chinese docs.

  The console already sends the active UI language as `Accept-Language`, so doc
  content localizes on a language switch with no client change.

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/service-package@9.5.0

## 9.4.0

### Minor Changes

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

### Patch Changes

- 3e675f6: fix(metadata): package-scope the layered (Studio editor) read via `?package=` (ADR-0048)

  The `?layers=true` single-item read (the Studio metadata editor's 3-state
  code/overlay/effective view) ignored `packageId`, so editing one of two
  same-named items from different packages resolved ambiguously (first match).

  - `protocol.getMetaItemLayered` now threads `packageId` into the code layer
    (`metadataService.get` + `lookupArtifactItem` + `registry.getItem`) and the
    `sys_metadata` overlay query (`package_id` prefer-local).
  - `registry.getArtifactItem(type, name, currentPackageId?)` and
    `lookupArtifactItem` gained the optional package-scope hint.
  - `rest-server` threads `?package=` into the layered branch.

  This completes the per-route package-scoped resolution audit: the runtime
  render surface (dashboard/report/page/doc) was already scoped; this closes the
  Studio editor (`/apps/:appName/metadata/:type/:name`). Frontend counterpart
  sends `?package=` from the metadata list row's owning package.

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/service-package@9.4.0

## 9.3.0

### Minor Changes

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- 50b7b47: Approvals server-side pagination + search pushdown (#1745). `listRequests` accepts `q` / `limit` / `offset` — free-text search pushes into the engine query as an `$or` of `$contains` terms (the `payload_json` snapshot carries record titles, so titles match without a join), and the page window pushes down whenever the filter is fully pushable; approver/status-array filters still post-filter their bounded scan and window in memory (the documented residual until the approver join-table follow-up). New `countRequests` returns the unwindowed total (engine `count` when pushable). REST: `GET /approvals/requests` gains `q`/`limit`/`offset` and returns `{data, total}` when paging.
- f8684ea: Approvals thread interactions — the collaboration layer between submit and decide. `reassign()` hands a pending-approver slot to someone else (audit-first ordering, new approver notified via the optional `messaging` service), `remind()` nudges every pending approver with a 4h per-request throttle (`THROTTLED` → HTTP 429), `requestInfo()` sends a request back to the submitter for more material while it stays pending, and `comment()` adds free-form thread replies. Rows expose `sla_due_at` (`created_at + escalation.timeoutHours`, display-only) and single reads attach `flow_steps` (the owning flow's approval trunk with done/current/upcoming states). REST grows the four matching POST routes; the `sys_approval_action.action` enum gains the new kinds.

### Patch Changes

- b08d08d: ADR-0046: `GET /meta/doc` list responses omit `content` by default (`?include=content` opts back in; `GET /meta/doc/:name` always returns the full body). The runtime dispatcher's `/metadata/doc` route already slims docs (#1789) — this applies the same rule on the REST `/meta/:type` route the console actually reads, keeping unbounded manuals off the list surface.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/service-package@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/service-package@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/service-package@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/service-package@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/service-package@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/service-package@8.0.1

## 8.0.0

### Minor Changes

- 345e189: Robust multi-write transactions (ADR-0034). `engine.transaction()` now establishes an ambient transaction (AsyncLocalStorage) so every data operation during the callback — including internal reads performed while a write runs — binds to the active transaction's connection instead of asking the pool for another one and deadlocking on SQLite's single-connection pool. Adds a cross-object transactional batch endpoint (`POST /api/v1/data/batch`) with intra-batch `{ $ref: <opIndex> }` parent references, so a parent and its children can be created atomically in one transaction.

### Patch Changes

- 0a6438e: perf(rest): cache hostname→environment resolution; document cluster pub/sub durability (P1-4, P1-5)

  - **rest (P1-4):** `resolveByHostname()` ran on every unscoped request — a
    control-plane lookup (typically a DB query) in the hot path. `RestServer` now
    caches `hostname → environmentId` in-memory with a 30s TTL across all three
    resolution sites, caching negative results too so unknown hosts don't hammer the
    registry. Registry errors are not cached, so a transient blip self-heals.
  - **service-cluster-redis (P1-5):** recorded the durability contract for
    `metadata.changed` in `pubsub.ts`. Redis pub/sub is at-most-once **by design**;
    the event is a cache-invalidation hint only — the durable source of truth is the
    transactional `sys_metadata` (+ `sys_metadata_history`) write, so a missed event
    causes a stale cache until the next reload, never data loss. No code change to
    the delivery semantics; risk accepted and documented.

- ae7fb3f: fix(rest): advertise `routes.mcp` in /discovery when MCP is enabled (cloud#152)

  The objectui Integrations page reads `discovery.routes.mcp` to show the "Connect
  an AI agent" card, but it stayed absent on live envs even with MCP enabled. Root
  cause (NOT a cache, as first suspected): `@objectstack/rest` serves its OWN
  `/discovery` (`protocol.getDiscovery()`), separate from the dispatcher's
  `getDiscoveryInfo` where the `mcp` field was added — so the REST-served discovery
  never advertised it.

  The REST discovery handler now adds `routes.mcp` (pointing at the unscoped
  `/api/v1/mcp`, since the MCP route is mounted bare) when
  `OS_MCP_SERVER_ENABLED=true`, and omits it otherwise — mirroring the dispatcher
  discovery and the opt-in gate. 2 tests (enabled → advertised, disabled → absent).

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

- e1478fe: fix(rest): map schema-mismatch & not-null driver errors to structured 4xx

  `mapDataError` collapsed any SQL-looking driver error into a generic
  `500 DATABASE_ERROR`, so a bad write payload to the data API leaked a 500
  instead of a fixable 4xx (e.g. `POST /data/sys_team` with an unknown field,
  or omitting a required column). It now maps unknown-column errors to
  `400 INVALID_FIELD { field }` and not-null violations to
  `400 VALIDATION_FAILED { fields:[{required}] }` across SQLite/Postgres/MySQL
  phrasings, placed before the unknown-object branch so Postgres
  `column … of relation … does not exist` is not mis-mapped to 404. Genuine
  driver faults still return 500; unique violations still return 409.

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
  - @objectstack/service-package@8.0.0

## 7.9.0

### Patch Changes

- ac1fc4c: feat(metadata): optional storage teardown on delete so "publish to preview" leaves no orphan table

  Object storage was create-only: `publishMetaItem` creates a table (`ensureObjectStorage`) but nothing ever dropped one — `deleteMetaItem` only tombstones the metadata row, leaving the physical table behind. That made the pragmatic "publish an object just to preview it with real data, then discard if wrong" loop leave residue.

  Adds the inverse path, opt-in and guarded:

  - `engine.dropObjectSchema(name)` — inverse of `syncObjectSchema`; resolves the table name + driver and calls the driver's existing `dropTable` (DROP TABLE IF EXISTS / drop collection).
  - `deleteMetaItem({ …, dropStorage })` — when `true`, drops the object's physical table after the metadata is removed. **DESTRUCTIVE**, so it is gated: `object` type only (others have no table), `active` state only (drafts were never materialised), and never a `sys_`-prefixed platform table. Default `false` keeps delete non-destructive to data. Best-effort: a drop failure is logged, not thrown.
  - REST: `DELETE /meta/:type/:name?dropStorage=true` threads the flag.

  This makes "publish to preview → discard" cleanly reversible. Combined with the draft-overlay read mode, it backs the team's chosen approach: lean on publish (into a dev sandbox) for data-level confirmation rather than building a full draft-data preview, and make that publish safely undoable.

  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/service-package@7.9.0

## 7.8.0

### Patch Changes

- a75823a: feat(metadata): expose pending DRAFT metadata (ADR-0033 draft discoverability)

  AI-authored metadata lands as drafts (`sys_metadata` rows with `state='draft'`, bound to an app package), but the only list path — `getMetaItems` — reads the active registry, so drafts were invisible: a just-built app package looked empty and there was no "pending changes" surface.

  - `SysMetadataRepository.listDrafts({type?, packageId?})` lists draft rows (mirrors `list()` but scoped to `state='draft'`, optionally narrowed by package), returning a light header projection (no body) with `packageId`.
  - `protocol.listDrafts({packageId?, type?, organizationId?})` exposes it over the overlay repo.
  - `GET /api/v1/meta/_drafts?packageId=&type=` surfaces it to the console. Registered in the REST server before the greedy `/meta/:type` route (and mirrored in the dispatcher) so `_drafts` is never captured as a metadata type name.

  Read-only; no behavior change to existing list/publish paths. Powers the upcoming Studio "drafts/pending changes" view and draft-aware package contents.

- Updated dependencies [06f2bbb]
- Updated dependencies [4fbb86a]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/service-package@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/service-package@7.7.0

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
  - @objectstack/core@7.6.0
  - @objectstack/service-package@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/service-package@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/service-package@7.4.1

## 7.4.0

### Minor Changes

- 2faf9f2: External Datasource Federation (ADR-0015) — REST surface.

  Adds `registerExternalDatasourceRoutes`, mounting `/api/v1/datasources/:name/
external/*` — `GET tables`, `POST tables/:remote/draft`, `POST refresh-catalog`,
  `POST validate` — served by the `external-datasource` service and wired into the
  REST API plugin. Routes return `503 external_service_unavailable` when the
  service is not registered, so they are safe to mount unconditionally.

### Patch Changes

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

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
  - @objectstack/service-package@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/service-package@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/service-package@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/service-package@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/service-package@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/service-package@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/service-package@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/service-package@6.8.1

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

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/service-package@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/service-package@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/service-package@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/service-package@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/service-package@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/service-package@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/service-package@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/service-package@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/service-package@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/service-package@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/service-package@6.1.0

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
  - @objectstack/service-package@6.0.0

## 5.2.0

### Patch Changes

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
  - @objectstack/core@5.2.0
  - @objectstack/service-package@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/service-package@5.1.0

## 5.0.0

### Minor Changes

- 5cfdc85: PR-10d.4 — REST plumbing for the metadata repository write path.

  - `PUT /api/v1/meta/:type/:name` (and the compound `:type/:section/:name` variant)
    now forwards the `If-Match` header to `saveMetaItem` as `parentVersion`, and
    `X-Actor` (or `req.user.id`) as `actor`. ETag-style quotes are stripped.
  - A failed optimistic-lock check surfaces as HTTP 409 with body
    `{ "error": "...", "code": "metadata_conflict" }` (no protocol changes —
    `sendError` already honoured `error.status` + `error.code`).
  - Added a real-engine integration test for the repository write path
    (`protocol-save-meta-repo-path-real-engine.test.ts`) — addresses the
    PR-10d.3 rubber-duck stub-drift concern by exercising
    `ObjectStackProtocolImplementation.saveMetaItem` through `new ObjectQL()`
    with an inline in-memory driver. Covers insert→update version bump,
    parentVersion conflict, checksum length, and plural→singular normalization.

  Default behaviour unchanged: the repository write path remains opt-in via
  `options.useRepositoryWritePath` / `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`.
  Flag flip and legacy path removal will follow in a separate post-soak PR.

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/service-package@5.0.0

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
  - @objectstack/service-package@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/service-package@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/service-package@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/service-package@4.0.5

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

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.1.1
  - @objectstack/core@1.1.1

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema, MCP Protocol schemas, API versioning, Dispatcher protocol
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` now use `z.unknown()`. Add type narrowing where needed.

  ### Hub schemas relocated

  Barrel imports via `Hub.*` still work. Direct path imports (`hub/license.zod.ts` → `system/license.zod.ts`) need updating.

  ### MetricType renamed

  `MetricType` (analytics) → `AggregationMetricType`, `MetricType` (licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → `createDispatcherPlugin()`
  - `createHonoApp` → `HonoServerPlugin`

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema (`Studio.PluginManifest`)
  - **@objectstack/spec**: MCP (Model Context Protocol) schemas for AI tools, resources, prompts, transport
  - **@objectstack/spec**: API versioning schema with multiple strategies
  - **@objectstack/spec**: Dispatcher protocol schema
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas for JSON Schema generation
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  REST API is now opt-in. If you relied on automatic REST registration:

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` in spec schemas changed from `z.any()` to `z.unknown()`. If you consume inferred types, add type narrowing:

  ```ts
  // Before — worked silently
  const val: string = record.metadata.foo;

  // After — requires narrowing
  const meta = record.metadata as Record<string, string>;
  const val = meta.foo;
  ```

  ### Hub schemas relocated

  - `hub/composer.zod.ts`, `hub/marketplace.zod.ts`, `hub/space.zod.ts`, `hub/hub-federation.zod.ts` — removed
  - `hub/plugin-registry.zod.ts` → `kernel/plugin-registry.zod.ts`
  - `hub/license.zod.ts` → `system/license.zod.ts`
  - `hub/tenant.zod.ts` → `system/tenant.zod.ts`

  Barrel imports via `Hub.*` namespace still work. Direct path imports need updating.

  ### MetricType renamed

  - `MetricType` (data analytics) → `AggregationMetricType`
  - `MetricType` (hub licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → use `createDispatcherPlugin()` instead
  - `createHonoApp` → use `HonoServerPlugin` instead

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
