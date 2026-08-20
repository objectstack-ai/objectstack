# @objectstack/core

## 17.1.0

### Minor Changes

- 2782805: feat(security): the REST 401 anonymous-deny body carries `code: "UNAUTHENTICATED"` alongside the existing `error` / `message` keys (#9487)
  
  Every other REST error family answers `{ error, code }`, with the machine code
  in `code` — the 401 family was the one outlier, answering
  `{ error: "UNAUTHENTICATED", message }` with no `code` key at all. A client
  keying on `body.code` (the shape the other families teach, and the first read
  of `@objectstack/client`'s `err.code`) read `undefined` for every
  authentication failure.
  
  `ANONYMOUS_DENY_BODY` now carries `code: "UNAUTHENTICATED"` as well.
  **Additive only** (maintainer-ruled): no key is removed or moved — `error`
  keeps holding the same code value it always has, so every existing reader
  keeps working. The wire effect surfaces through `@objectstack/rest`'s
  `enforceAuth`, which writes this constant verbatim on every `/data`, `/meta`
  and `/reports` 401. This does not settle ADR-0112 D5 (flat vs nested envelope
  convergence); both declared envelope families are unchanged in kind.
- e43d63a: feat(identity): API keys are minted against the minter's active organization, and carry it into the request (#8287)
  
  <!-- adr-0087: not-required (no-migration-prescription) One additive column on
  an `isSystem` object declaring `protection: { lock: 'full' }`, which tenants
  cannot author, so there is no consumer metadata to migrate and nothing
  authorable is renamed, retired or tombstoned — no conversion to register. The
  behavioural change is that a minted key now carries an organization, that a key
  which cannot carry one is refused under the posture where it could never read
  anything, and that an ex-member's key stops authenticating. -->
  
  On a deployment running `OS_TENANCY_POSTURE=isolated`, a minted API key could
  read **nothing at all**. `sys_api_key` carried no organization column, so key
  authentication established a user but no active organization — and the
  `isolated` Layer 0 wall is `organization_id = activeOrganizationId`, which with
  no active organization matches no row. Every organization-scoped read answered
  `200` with `total 0` while the console went on offering minting, so a tenant
  admin could mint a valid-looking secret and discover only at call time that it
  read nothing. (There was no cross-tenant leak — the failure was in the other
  direction.)
  
  **The column was absent by an inherited rule, not by oversight.**
  `resolveInjectedSystemColumns` injects `organization_id` into every registered
  object *except* `managedBy: 'better-auth'` ones, and `sys_api_key` carries that
  flag — even though better-auth's `apiKey` plugin is not loaded and the table is
  hand-rolled ObjectStack. So the fix needs the declaration *and* the ADR-0105 D7
  extension-field registration to stay consistent. The read side, by contrast,
  was **already wired**: `resolveApiKeyPrincipal` already read an organization
  into `tenantId` and `resolveAuthzContext` already adopted it — it was reading a
  column no mint path ever wrote.
  
  **What changes**
  
  - `sys_api_key` declares `active_organization_id` (+ index, and the column is
    shown in the "My Keys" and "All" list views, because the card's complaint was
    a credential whose reach its owner could not see).
  - `POST /api/v1/keys` **inherits** the caller's active organization — there is
    deliberately no org parameter and no cross-org key — and **re-checks the
    caller's `sys_member` membership at mint time**, honouring ADR-0091 validity
    windows. Under a walled posture it refuses (400) rather than minting a key
    with no organization, and refuses (403) for an organization the caller is not
    a member of. The mint response echoes the organization the key is pinned to.
  - The verifier reads **one spelling** (Prime Directive #12): the
    `row.organization_id ?? row.organizationId` chain it used to carry was a
    consumer-side tolerance for a producer that did not exist.
  - An **ex-member's key fails closed at verify time** — no principal, not a
    degrade to a user-only principal, which would resurrect the same
    `200 + total 0` silent-empty. Checked at verify rather than by revoking on
    membership loss, because membership ends through many paths (better-auth org
    endpoints, SCIM, a direct `sys_member` delete, a lapsing validity window) and
    a hook must catch every one or it silently misses. It costs **zero extra
    queries**: the resolver has already read `sys_member` for this user.
  - **Pre-existing org-less keys are never backfilled** — that would silently
    upgrade credentials minted under a different promise. They keep working under
    `single` (no wall) and under `group` (whose wall derives from the owner's
    memberships independently of the active organization, so they already work
    there), and are **refused under `isolated`**, where they are provably dead
    today.
  
  **The column is deliberately named `active_organization_id`, not
  `organization_id`** — the `sys_session` spelling, for the same concept: the
  organization a credential makes *active*. `objectHasOrgIdField` tests for the
  literal `organization_id`, and Layer 0 exempts objects without it, so the other
  name would have made `sys_api_key` itself org-walled. Both walled postures
  exclude NULL, so every pre-existing org-less row would have vanished from its
  **own owner's** "My Keys" list while, under `group`, continuing to
  authenticate — a live credential nobody could see or revoke, which is a fresh
  instance of the very class this change removes.
- a38408a: fix(core): both kernels agree that a duplicate plugin registration OVERWRITES, and say so out loud (#9864)
  
  Registering two plugins under the same `name` used to mean two different things
  depending on which kernel was running:
  
  | kernel | behaviour before |
  |---|---|
  | `ObjectKernel` (what `os serve` runs) | accepted and overwrote, with **no check and no distinguishing log line** — `Plugin registered: <name>@<version>` printed twice, reading as two plugins running |
  | `LiteKernel` (tests, serverless, edge) | threw `[Kernel] Plugin '<name>' already registered` |
  
  Under the maintainer's ruling (2026-08-19, option B) both kernels now apply one
  declared contract: **duplicate registration by `name` overwrites — last-one-wins
  — and emits a `warn` naming the plugin and both versions.**
  
  ```
  WARN Plugin superseded: 'com.objectstack.audit' — the later registration (v2.0.0)
       REPLACED the earlier one (v1.0.0). Only the later instance is initialized and
       started; the earlier one is discarded without ever running init(). Duplicate
       registration by name is last-one-wins on both kernels by declared contract
       (#9864) — register the plugin once if that is not what you meant.
  ```
  
  **This declares and warns about behaviour that already shipped; it does not fix a
  user-visible bug.** The overwrite is load-bearing today — it is exactly what lets
  a stack's own `plugins` entry supersede a plugin the CLI auto-registered earlier
  in the same boot (`AuditPlugin`, #9863) — and every boot path that worked before
  works the same way now. What changes is that the behaviour is declared, audible,
  and pinned against **both** kernels
  (`packages/core/src/plugin-registration.contract.test.ts`) rather than being an
  accident of whichever kernel a reader happened to open. This was the fourth
  measured instance of one contract implemented twice across the two kernels
  (#5170, #5282, #8357 adjacent).
  
  **What this changes for a caller**
  
  - `LiteKernel.use()` no longer throws on a duplicate name. FROM: catch
    `[Kernel] Plugin '<name>' already registered` to detect a double registration.
    TO: there is no throw to catch — a duplicate is a `warn` and the later instance
    wins. Code that registered a plugin twice and relied on the refusal should
    register it once instead.
  - `ObjectKernel` emits one `warn` where it previously emitted nothing, and
    **suppresses** its `Plugin registered:` line for the superseding registration,
    so the count of those lines equals the number of plugins that actually boot.
  - The level is part of the contract: `warn`, never `info`. The CLI's default
    kernel level is `warn`, and its boot-quiet window replays `warn` while
    discarding in-window `info` — an `info` notice would be invisible on exactly
    the boot path where this was measured.
  
  **Measured, not assumed:** the displaced instance holds nothing that needs
  teardown. Registration is legal only while the kernel is `idle`, so a supersede
  can only ever displace a plugin that has never been initialized; `init()`,
  `start()` and `destroy()` all run later, over a registry the displaced entry has
  already left. `PluginLoader.loadPlugin()` — which `ObjectKernel` runs first — is
  pure validation plus a name-keyed map write of its own, and invokes nothing on
  the plugin. Calling `destroy()` on the displaced instance would be the bug, not
  the fix: it is the paired teardown for an `init()` that never ran.
- 5f5e234: fix(security): `sys_permission_set.active` and `sys_position.active` now actually stop granting access (#8613)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  added, renamed or retired. `active` is a ROW property of a `sys_permission_set`
  / `sys_position` record, not a key on `PermissionSetSchema` (which is a strict
  object in `packages/spec` and deliberately declares no such key — see
  `permission-set-projection.ts`'s ROW_STATE_COLUMNS). No spec schema, export or
  stored metadata shape changes, so there is no conversion to register and no
  tombstone to write. The change is a runtime predicate at the authorization
  resolution seam; the remedy for an affected deployment is operational
  (re-activate rows that were switched off), not a metadata migration. -->
  
  **BREAKING for deployments that already switched a permission set or position
  off.** Both objects ship a Deactivate action whose confirmation dialog promises,
  in all four locales, that access stops:
  
  > Deactivate this permission set? Existing assignments stay in place but stop
  > granting access until re-activated.
  > Deactivate this position? Users keep their assignment but the position stops
  > granting permissions until re-activated.
  
  Nothing read the column. Measured on the real resolver: a position seeded
  `active: false` still granted its permission sets, and a permission set seeded
  `active: false` still returned `posture: PLATFORM_ADMIN` with its system
  permissions. Deactivation moved a badge in Setup and nothing else — while the
  admin who had just revoked a compromised or over-broad grant was told the
  opposite, and whose likely next step was therefore *not* the action that would
  have worked (delete the set, or remove the assignments).
  
  **What changes at runtime.** `resolveAuthzContext` / `resolveUserAuthzGrants`
  (`@objectstack/core`) — the single seam every transport resolves authorization
  through — now drop a deactivated row **before** any derivation:
  
  - a deactivated `sys_position` no longer contributes its
    `sys_position_permission_set` grants, and its name leaves `positions` (so the
    name-reuse path cannot resolve the same grant one layer down);
  - a deactivated `sys_permission_set` contributes no name, no
    `system_permissions`, no `tab_permissions`, **and no `PLATFORM_ADMIN`
    posture** — the flag is applied before the posture is derived, not after;
  - the `plugin-security` DB loader applies the same predicate, which is what
    judges a set reached by NAME through an active position of the same name.
  
  Both tables were already read at that seam, so this costs **zero new hot-path
  queries**.
  
  **⚠️ Read this before upgrading.** Any `sys_permission_set` or `sys_position`
  row currently carrying `active: false` **stops granting the moment this
  lands** — on live data, with no migration step to notice. That is the correct
  direction (it is what the dialog said when someone clicked Deactivate), but on
  an installation that used the switch believing it was inert it is a real
  revocation. Before upgrading, list the deactivated rows and re-activate any that
  are still meant to grant:
  
  ```
  GET /api/v1/data/sys_permission_set?filters=[["active","=",false]]
  GET /api/v1/data/sys_position?filters=[["active","=",false]]
  ```
  
  A row whose `active` column is **absent or NULL** is unaffected: the predicate
  is "explicitly deactivated", never "explicitly active", so rows that predate the
  column keep granting exactly as before.
  
  **Break-glass, closed in the same change** (`@objectstack/plugin-auth`).
  Enforcing the flag opened a one-click, installation-wide lockout: deactivating
  `admin_full_access` un-makes every platform admin at once, through a payload
  that touches neither `name` nor any identity table, and re-activating requires
  the permission the click just took away (the seeders deliberately never
  reconcile `active`, so no restart restores it). The last-administrator guard now
  judges that write like the delete and rename spellings it already refused, and
  an environment whose break-glass set is *already* off is read as emptied rather
  than as a bootstrap window — so it does not silently disarm the guard for every
  other identity write. Re-activation itself stays permitted, or the refusal would
  have no way out from inside the product.
- f8eb736: feat(security): bind the break-glass standing-key lists to what the authz resolver actually reads — the correspondence stops being prose (#8734)
  
  `plugin-auth`'s last-administrator guard (ADR-0024 D5.2) decides whether a
  pending write can empty the administrator population by testing the payload
  against three standing-key lists (`MEMBER_STANDING_KEYS`,
  `GRANT_STANDING_KEYS`, `PERMISSION_SET_STANDING_KEYS`). A payload touching none
  of them is skipped without any reads — so a column `resolveAuthzContext` starts
  reading that a list omits is a write class the guard **silently stops judging**,
  on the one path whose failure mode is an installation-wide administrator lockout
  with no in-product recovery.
  
  Nothing bound the two together. The correspondence lived in a comment, and it
  had already gone false once: #6084 wrote — naming `active` explicitly — that
  everything a permission-set write touches other than `name` is invisible to "who
  is an administrator". That was true when written; #8613 made `active` a
  resolution-time predicate and the sentence became false. Nothing mechanical
  would have caught it, because the guard's own tests stay green precisely when
  the guard is never consulted.
  
  **The mechanism is two links, and the first one is a measurement.**
  
  - `@objectstack/core` now exports `ADMIN_STANDING_SURFACE` — declared beside the
    resolver, listing every table the administrator-derivation path reads, each
    classified `derives` or `reads-only` with its reason, and for the deriving
    tables every column read. It is asserted **equal** to what the real
    `resolveAuthzContext` reads, observed at runtime through a recording engine
    that records every property access and every `where` key per table. Observation
    rather than source extraction because the reads that matter have moved into
    helpers: `active` is read by `isRowActive(row)` and the ADR-0091 window bounds
    by `isGrantActive(row, now)`, neither named at the resolver's own call site —
    the exact shape #8613 had.
  
  - `@objectstack/plugin-auth` now exports its standing-key lists plus
    `STANDING_KEYS_BY_TABLE` and `STANDING_KEY_EXCLUSIONS`, and a gate requires
    every column of that measured surface to have an answer: it is standing-bearing
    (in a list) or it is excluded with the reason it cannot empty the administrator
    population. There is no third state — the third state is what `active` was
    between #6084 and #8613.
  
  So a resolver change that starts reading a new column fails at the first link
  until the declaration is updated, and at the second until the guard has an
  explicit answer for it. Landing #8613 green would have required writing down that
  deactivating `admin_full_access` cannot empty the administrator population —
  which is false, and which is what the old comment asserted by accident.
  
  **No guard behaviour changes.** Every list keeps exactly the values it had; the
  gate is one-directional by construction (it can only ever demand that the guard
  judges *more*), because the other direction would put pressure on a break-glass
  guard to fire less often.
  
  The table-level half is covered too: a resolver that started deriving
  administrator standing from a **new** table is invisible to any column-set
  comparison, since the table is absent from both sides — so the surface enumerates
  every table the path reads, and an unclassified one fails.

### Patch Changes

- 7ff3975: feat(spec): `IHttpServer` gains an optional `afterResponse` response-observing
  hook so HTTP metrics are transport-agnostic instead of Hono-only (#9835)
  
  The contract addition (additive — a new optional member plus the
  `HttpResponseObservation` / `HttpResponseObserver` types and the reserved
  `UNMATCHED_ROUTE_PATTERN` label): a transport invokes each registered observer
  exactly once per answered request with `{ method, routePattern, status,
  elapsedMs }`, after the response exists — the observation point the `use()`
  middleware contract cannot express (it runs before dispatch and never sees a
  status). `routePattern` is REQUIRED to be the registered route pattern
  (`/api/v1/data/:id`), never the concrete path, so no adapter re-decides metric
  cardinality. Optionality is feature-detected runtime-real
  (`typeof server.afterResponse === 'function'`); a transport that does not
  implement the seam reports **no** HTTP metrics — zero there means "not
  instrumented", never "no traffic".
  
  Implementations and consumers in the same change:
  
  - `@objectstack/plugin-hono-server`: `HonoHttpServer` implements the seam (the
    ruled #9650 raw-app middleware becomes its delivery path — same reach,
    including `getRawApp()` mounts and middleware-refused 429s); unrouted
    requests are now labelled with the reserved `unmatched` pattern (previously
    they could surface as `/*`).
  - `@objectstack/observability`: new `armHttpRequestCounter(server, metrics)`
    arms the `http_requests_total` counter through the seam at most once per
    server (first caller wins), which is what makes "exactly one counter per
    server" structural.
  - `@objectstack/runtime`: the dispatcher offers its `observability.metrics`
    registry to the seam (a host that wires only the dispatcher now counts every
    inbound surface) and suppresses its own per-route copy of
    `http_requests_total` when the transport implements the seam — retiring the
    #9833 double count. Request-id echo, the duration histogram, the error
    counter and the error reporter are unchanged.
  - `@objectstack/http-conformance`: `NodeHttpServer` implements the seam, and a
    new cross-adapter conformance suite locks the semantics for both adapters.
  - `@objectstack/core`: re-exports the new contract types/constant.
- 24173e9: fix(rest): read an offset-free import cell in the business timezone, not the host `TZ` (#8485)
  
  `parseDateCell` ended in `new Date(s)`. A spreadsheet cell like
  `2026-08-01 06:00:00` carries no offset, so ECMAScript resolves it against the
  **process** timezone, and the instant bulk import stored became a property of
  the deployment host:
  
  ```
  TZ=Asia/Shanghai → 2026-07-31T22:00:00.000Z
  TZ=UTC           → 2026-08-01T06:00:00.000Z
  ```
  
  Same file, same tenant, same cell — eight hours apart, decided by a setting
  nobody authoring the spreadsheet can see, and never consulting the business
  timezone the route had already resolved one frame up
  (`ExecutionContext.timezone`, the platform-default → global → tenant cascade).
  
  Since the export renders `datetime` cells in that business timezone (#8373), the
  advertised export → edit in a spreadsheet → re-import round trip was lossless
  only where the host `TZ` happened to equal the business zone. `import-coerce.ts`
  opens by calling itself "the inverse of `export-format.ts`"; it now is one, and
  the regression proof asserts inverse-ness on the **pair** — every fixture under
  a host `TZ` deliberately different from the business timezone, because a test
  that runs only under a matching `TZ` cannot fail.
  
  **An offset-free datetime cell is now read in the caller's business timezone**,
  through `@objectstack/core`'s new `zonedWallClockToUtcMs` — the DST-safe wall
  clock → instant primitive that `zonedDateStartToUtcMs` (the date-bucket drill
  path) is now the midnight special case of. One implementation of zone
  arithmetic, `Intl` offsets from the platform tz database, never hand-rolled;
  generalising the existing one rather than hand-rolling a second in `rest` is
  what keeps the export and import halves of this seam from drifting apart again.
  Two wall clocks are not a bijection with instants, and both degenerate DST
  readings resolve to the earlier candidate instant — a gap reading lands just
  before the gap, an ambiguous reading on its first occurrence (pinned, measured).
  
  Three things deliberately do **not** move:
  
  - **A cell that carries an explicit offset** (`…Z`, `…+08:00`) already names one
    instant and is honoured exactly as written. This change affects naive cells
    only.
  - **The date-only fast path stays UTC.** `YYYY-MM-DD` is UTC per ECMAScript and
    a `date` is a timezone-naive calendar day (ADR-0053); sweeping it into the
    zoned handling to make the code look uniform would silently re-time every
    date-only import to fix nothing.
  - **No timezone resolved ⇒ UTC**, never the process clock. That is the fallback
    the export's cell path takes in the same case, so the round trip stays exact
    for deployments that configure no zone — and a process-`TZ` fallback would
    preserve the defect for exactly the deployments that cannot see it. This is
    the one **behaviour change for existing deployments**: a host with a non-UTC
    `TZ` and no resolved business timezone previously read naive cells in the host
    clock and now reads them as UTC. An explicitly resolved `'UTC'` is a resolved
    zone, not a missing one.
  
  Two adjacent legs of the same defect, both on the naive-cell path:
  
  - **A naive cell landing in a `date` or `time` field** now takes the typed
    components verbatim (`2026-08-01 06:00:00` → `2026-08-01` / `06:00:00`).
    Those branches also read the process clock, so a host east of the cell stored
    the *previous calendar day* for a `date` column.
  - **An xlsx date cell.** An Excel serial date carries no timezone; ExcelJS
    materialises it as a `Date` whose UTC components are the sheet's wall clock,
    and `import-prepare.ts` rendered it with `toISOString()` — stamping a `Z` the
    file never had. That fabricated offset then outranked the business timezone by
    the very carve-out above, so every real date cell in a user-authored workbook
    imported as UTC whatever the tenant's zone. It now flattens to the same
    offset-free `YYYY-MM-DD HH:mm:ss` a CSV export writes, which is what that
    function's contract already claimed to produce.
- e1bb0ca: fix(qa): `HttpTestAdapter` resolves the Data Protocol mount from the server's `/discovery`, and falls back to the convention loudly (#7983)
  
  The record-shaped `os test` action types (`create_record`, `read_record`,
  `update_record`, `delete_record`, `query_records`) built their URLs from the
  **defaults** of `RestApiConfigSchema.apiPath` and
  `CrudEndpointsConfigSchema.dataPrefix`, because the adapter is handed an origin
  and nothing else. A deployment that moved the mount got a 404 that reads like the
  suite author's own URL mistake rather than a platform limitation.
  
  The adapter now asks the server, following the `getRoute` precedent in
  `@objectstack/client`: **one memoised `GET {apiBase}/discovery` per run** (`os
  test` builds one adapter for the whole run), addressing whatever `routes.data`
  advertises, with the schema-derived convention as the fallback. Measured on a
  booted stack (REST route generator + dispatcher bridge), before and after:
  
  | deployment | before | after |
  |---|---|---|
  | stock | created | created |
  | `crud.dataPrefix: '/objects'` | `HTTP Error 404` | created |
  | `api.apiPath: '/api/2026-01'` | `HTTP Error 404` | `HTTP Error 404`, now naming the mount |
  
  The `apiPath` row is **not** closed, and the reason is structural: `apiPath`
  moves the base that `/discovery` is itself mounted under, so the document that
  would name the new mount sits behind the prefix that is missing. The one
  discovery document at a fixed path does not rescue it — `/.well-known/objectstack`
  advertises the **dispatcher's** `${prefix}/data`, measured as `/api/v1/data`
  under all three configs above — so it is deliberately not probed: trusting it
  would attach a false provenance ("discovery told us") to the same 404.
  
  Instead that case degrades loudly. Falling back to the convention prints a
  warning naming the mount it will address, the probe that failed and the remedy,
  and every 404/405 from a record action now carries the mount it addressed and
  where that mount came from. `api_call` is unchanged, issues no probe, and remains
  the escape hatch for a host the probe cannot reach.
- 402c125: fix(objectql): a temporal filter comparand the platform cannot interpret is refused at the engine door instead of answering 200 with zero rows (#8690)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  renamed, retired or tombstoned — no spec schema is touched at all. The change
  is a new runtime refusal at the engine's filter collection point, plus the
  routing decline that stops the raw-SQL analytics path bypassing it. -->
  
  A `datetime` / `date` / `time` field filtered with a bare string the platform
  cannot read — `last_30_days`, `not-a-date-at-all` — was bound **as written**
  all the way to the driver, where the comparison is false for every row. The
  caller received `HTTP 200`, an empty result set, and nothing to indicate the
  filter was meaningless. An unknown `{placeholder}` in the same position was
  already refused loudly (`FILTER_TOKEN_UNKNOWN` / 400, listing the resolvable
  tokens), so one API answered two shapes of unusable comparand two different
  ways.
  
  It is concretely reachable rather than theoretical: `last_7_days` /
  `last_30_days` / `last_90_days` are **declared preset names** in the dashboard
  schema. The shipped console lowers them to `{N_days_ago}` macros before they
  reach the API, so the console path was always safe — but a saved report, an
  integration, an MCP client or an AI-authored query sends the preset name itself
  and got a silent zero. An empty chart is the hardest failure to debug: it is
  indistinguishable from "there is genuinely no data".
  
  Such a comparand is now refused at the ObjectQL engine's single filter
  collection point, with `code: 'INVALID_FILTER'` and `status: 400`, naming the
  field, the value, the key path and the spellings that would work. That seam is
  the one place holding the caller's comparand and the field's **declared type**
  at the same moment, and every verb (`find` / `findOne` / `count` / `aggregate`
  / `update` / `delete`) and both filter spellings (the array sugar and the
  lowered condition) pass through it, so all four backends inherit one answer
  rather than four. `NativeSQLStrategy` additionally **declines** such a query so
  the raw-SQL analytics path falls through to that door instead of binding the
  value into its own statement.
  
  Deliberately unchanged, each by ruling: a `{placeholder}` keeps its existing
  refusal one layer down (the door runs before token resolution and steps around
  them, so `{30_days_ago}` still resolves normally); non-string comparands are
  untouched (a number is epoch milliseconds, a `Date` is an instant); and the
  **empty string** keeps today's behaviour exactly — it binds as `''` and matches
  every non-null row, which is a separate question that remains its own card.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [9aa8890]
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
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0

## 17.0.0

### Major Changes

- 29c6c9d: feat(spec,core,runtime)!: declarative `apis:` refuses loudly instead of parsing into silence; the `ApiRegistry` family retires (#4936, #4939)

  The declarative API-endpoint surface was **zero-execution end to end**, and said nothing
  about it. Metadata loading worked perfectly — a stack declared `apis:`, `defineStack`
  accepted it, and `GET /api/v1/meta/api` returned every endpoint with every key intact.
  The execution side never fired once. On a real boot (showcase, 47 plugins) both declared
  paths answered a bare `404 {"error":"Not found"}` — not even the dispatcher's semantic
  404, because **no route was ever mounted** for a declared path, so the request died at
  Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint` branch resolved the
  metadata service and called `matchEndpoint` on it — a method **no implementation in the
  repo has ever provided**. The branch returned "not handled" on every request ever served.

  So every key on `ApiEndpointSchema` was declared ≠ enforced: `path`/`method` (never
  mounted), `type`/`target`/`objectParams` (never executed), `cacheTtl`,
  `inputMapping`/`outputMapping`, `rateLimit`, `summary`/`description` — and
  **`authRequired`**, a security semantic that parsed green and gated nothing at all. That
  is false compliance, the failure ADR-0049 exists to stop, not debt.

  ## BREAKING — a non-empty `apis:` is now rejected

  Metadata that parsed cleanly before is now **refused at publish/validate**, with the
  prescription in the rejection itself:

  ```
  apis: `apis:` (declarative ApiEndpoint) is DECLARED BUT NOT EXECUTABLE in this runtime,
  so a non-empty array is rejected instead of silently accepted (#4936). …
  ```

  **FROM → TO.** `apis: [ …endpoints… ]` → `apis: []` (or delete the key; both are still
  accepted, and an empty array is not a special case). To actually serve the route today,
  mount it **in code** — a plugin manifest `contributes.routes` entry, or an `http.server`
  route. That is now the only honest path, and the one `examples/app-showcase` uses
  (`src/system/server/recalc-endpoint.ts`).

  The refusal lives on `ObjectStackDefinitionSchema` itself, which is the single choke
  point every path runs through — `defineStack`, the metadata plugin's artifact ingestion,
  `os validate`, the lint scorer and `EnvironmentArtifactSchema`. There is no path that
  forgot to check.

  **The `ApiEndpoint` vocabulary is deliberately KEPT.** Retiring it was considered and
  rejected: endpoint shapes are an industry-stable form, so a retirement would only mean
  re-introducing the identical schema later. Your endpoint definitions stay valid TypeScript
  and stay in the spec; only _authoring them into a stack_ is refused, and only until the
  executor lands. Keep them commented next to your stack — that is what the showcase does.
  The executor (route mounting + endpoint matching + per-key wiring for
  `authRequired`/`cacheTtl`/`inputMapping`/`outputMapping`/`rateLimit`) is tracked by
  **#5040**, which replaces this rejection with real execution.

  ## BREAKING — the `ApiRegistry` / `ApiEndpointRegistration` family is removed (#4939)

  The repo carried a **second**, unrelated declaration shape for "an API endpoint":
  `ApiEndpointRegistrationSchema` and the ~500-line `ApiRegistry` service that
  `createApiRegistryPlugin()` registered under `api-registry`. Nothing composed it — every
  assembly site lived in `packages/core/examples/`, with no registration in
  `packages/runtime`, `packages/cli` or any `examples/app-*`, and a real boot carried no
  such service. The whole family was therefore inert, including
  `ApiEndpointRegistration.requiredPermissions`, whose docs promised **in the present tense**
  that "the gateway layer automatically validates these permissions" while no gateway read
  it. Two declaration shapes, both dead; this retirement converges them on one.

  Removed from `@objectstack/spec/api`: `ApiEndpointRegistration(Schema)`,
  `ApiRegistry(Schema)`, `ApiRegistryEntry(Schema)`, `ApiMetadataSchema`,
  `ApiParameterSchema`, `ApiResponseSchema`, `ApiDiscoveryQuerySchema`,
  `ApiDiscoveryResponseSchema`, `ApiProtocolType`, `HttpStatusCode`,
  `ObjectQLReferenceSchema`, `SchemaDefinition` (12 JSON-Schema defs, 67 authorable keys).
  Removed from `@objectstack/core`: `ApiRegistry`, `createApiRegistryPlugin`.
  Removed from `@objectstack/plugin-hono-server`: the `useApiRegistry` option — it was
  defaulted to `true` and read by nothing, configuring a service that was never composed.

  **FROM → TO.** There is no replacement shape to migrate to, because nothing executed the
  old one: delete the registration objects. If you were assembling an `ApiRegistryEntry`,
  you were building a value only your own code read — keep it as your own type. Declarative
  endpoints have one vocabulary now, `ApiEndpointSchema`.

  `ConflictResolutionStrategy` **survives** the removal and moved to
  `@objectstack/spec/api`'s `router.zod` — same name, same four values
  (`error`/`priority`/`first-wins`/`last-wins`), same import path. It is pinned there by two
  independent ratchets and is not part of the retired surface.

  ## Also in this change

  - **BREAKING (`@objectstack/runtime`):** `HttpDispatcher.handleApiEndpoint()` is deleted,
    along with its now-orphaned private `callData` delegate, and `/__api-endpoint` leaves
    `LEGACY_CHAIN_PREFIXES` and the route ledger. The method was public, so this is an API
    removal — but it returned `{ handled: false }` for every call it ever received, so no
    caller can observe a behaviour change beyond the missing symbol. Delete the call.
    Absence is now loud (ADR-0076): the surface is refused at authoring rather than 404ing
    at runtime with dead code behind it.
  - `examples/app-showcase` no longer declares endpoints, and its coverage manifest no
    longer claims the capability is `demonstrated` — that entry read "executed by the runtime
    dispatcher (handleApiEndpoint)", which was exactly the advertise-what-you-don't-deliver
    claim Prime Directive #10 forbids.
  - The endpoint-level `rateLimit` tracking pointers left by #4910/#5006 now name **#5040**,
    the live executor card, instead of #4936, which closes with this change.

### Minor Changes

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

- 32ccb23: feat(spec,core,runtime)!: ADR-0112 batch 1 — one error-code vocabulary, SCREAMING_SNAKE, schema-enforced (#3841)

  Settles #3841 per ADR-0112: the top-level `error.code` vocabulary is
  SCREAMING_SNAKE, in two tiers.

  - **`StandardErrorCode` members renamed in place** (`validation_error` →
    `VALIDATION_ERROR`, all 53). Breaking for importers that branch on the old
    lowercase members; the type name and member _meanings_ are unchanged.
  - **New `ERROR_CODE_LEDGER`** (`@objectstack/spec/api`): service-specific codes
    (`AUTH_REQUIRED`, `VALIDATION_FAILED`, `ATTACHMENT_DOWNLOAD_DENIED`, …) are
    registered per owning package. `ErrorCode` = standard ∪ registered.
  - **`ApiErrorSchema.code` is now `ErrorCode`**, not `z.string()` — an
    unregistered code fails parse, so the envelope conformance suites assert
    values, not just shape.
  - **`FieldErrorSchema.code` widened to `z.string()`** (ADR-0112 D6): field-level
    codes are a separate vocabulary the enum never described; #3977 owns its real
    catalog.
  - **Derived codes changed case on the wire**: `standardErrorCodeForHttpStatus`
    now yields SCREAMING members (`permission_denied` → `PERMISSION_DENIED`,
    `method_not_allowed` → `METHOD_NOT_ALLOWED`, …) — this map was #3842's
    designated one-file sweep point for exactly this decision.
  - **`ANONYMOUS_DENY_CODE` is `'UNAUTHENTICATED'`** (was `'unauthenticated'`) —
    the promoted code on anonymous-denied requests and the REST `enforceAuth`
    body change spelling with it.

  `error-catalog.mdx` and the error-handling guides are rewritten to the single
  vocabulary; a spec test now locks the catalog page's headings to the enum so
  they cannot drift apart again. Remaining lowercase emitters (cloud-connection,
  plugin-auth envelope codes, metadata-protocol, …) are the batch-2 sweep.

- 98877c9: feat(core,platform-objects,spec): the ADR-0119 D2 migration-journal runner — a migration killed mid-run is resumable to completion or compensable to clean, with journal rows proving which (#4617)

  **The gap D1 left open.** ADR-0119 D1 made `engine.transaction()` reachable
  through the contract, which is the right answer for multi-write atomicity that
  fits in one transaction. Migration-class work does not fit: a million-row
  backfill cannot hold one write-lock for its duration, `driver-memory`'s
  `beginTransaction` deep-clones the entire database (O(db) per begin),
  `ObjectQL.transaction()` binds the **default driver only** so a multi-datasource
  migration silently commits part of its work outside it, and a process **killed**
  — as distinct from a thrown error — defeats in-process rollback entirely. So the
  unit of atomicity is the _chunk_, and durability across chunks is a journal.

  Four consumers had each converged on the same four moves — dry-run preflight,
  undo journal, LIFO compensation, re-entrant forward recovery (ADR-0105 D13
  promotion, ADR-0117 D8's ownership backfill, the org lifecycle transitions, and
  D10 master-data distribution #4585). One copy is engineering; four is platform
  debt, and the fourth author would have had to rediscover the invariant below
  from scratch.

  **New: `runMigrationJournal` (`@objectstack/core`).** Preflight runs every
  step's read-only validator before any step writes, so a plan that would fail at
  step 3 has not written step 1. Rows are chunked per the `bulk-write.ts`
  discipline; each chunk's writes run inside `engine.transaction()`. On failure,
  committed chunks are compensated newest-first, each in its own transaction. On
  restart, a rediscovered run resumes forward from the first chunk lacking
  `chunk_done`, or unwinds, per the plan's `onCrash` policy. Forward and
  compensate callbacks receive an `attempt` counter; `attempt > 1` means the prior
  outcome is UNKNOWN and the callback must recheck by natural key before
  re-writing — the same at-least-once contract `bulk-write.ts` already documents,
  reused rather than re-derived.

  **The invariant that carries the design:** `chunk_done(i)` is written **inside**
  the chunk's own transaction, so `done ⇔ committed` holds by construction;
  `chunk_started(i)` is written autonomously **before** it. That asymmetry is what
  gives `started ∧ ¬done` exactly one meaning — _the outcome is unknown_ — which
  is the only state a crash can leave and the only state recovery reasons about.
  Making both writes symmetric would look tidier and would destroy recovery.

  **New: `sys_migration_journal` (`@objectstack/platform-objects`).** Rows keyed
  `(run_id, seq)` under a unique index, so a resumed run that miscomputes its next
  sequence fails loudly rather than double-recording an event. Registered
  unconditionally alongside `sys_migration` because recovery must be discoverable
  with **zero host wiring** — a journal some kernels compose and others do not is
  a journal a boot scanner cannot rely on (ADR-0078). Distinct in grain from
  `sys_migration`, which holds one durable verdict per named migration; this holds
  many rows per _run_. Read-only over the API; writes go through the runner in
  system context.

  **The runner refuses rather than degrades**, in four places: the runtime cannot
  roll back; any preflight fails; the plan declares `onCrash: 'compensate'` but a
  step cannot compensate; or a resume's plan hash disagrees with the journal
  (resuming a changed plan would apply chunk boundaries the journal never
  described). A compensation failure halts and is journalled — never swallowed —
  and the run ends `failed`, not `compensated`, because a database in a state no
  clean story covers must not be reported as a tidy rollback.

  **`engineCanRollBack` is now shared.** The two-level probe (engine method AND
  default-driver `beginTransaction`) was the same condition written twice — here
  and in `batchData`'s atomic gate. It now lives in `@objectstack/core` and
  `@objectstack/metadata-protocol` imports it, as a type predicate so callers do
  not each re-narrow the optional member by hand. Two copies of "can this runtime
  actually roll back?" drift by one clause and leave one caller believing it has
  atomicity it does not have.

  Boot reconciliation and `os migrate resume` land separately; `findInterruptedRuns`
  is the discovery primitive they will consume, and is exported here.

  **Docs:** ADR-0118 (plugin-reachable transactions) is renumbered **ADR-0119**.
  It merged one day after an unrelated ADR-0118 (非用户 actor 的平台契约) and the
  earlier merge holds the number; citations of "ADR-0118 D1/D2/D3/D4" written
  before 2026-08-03 mean the renumbered record.

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

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

- 82da264: feat: declare `ExecutionContext.authGate`, so the ADR-0069 gate sits inside the closed field set (#7280)

  The ADR-0069 authentication-policy gate (expired password, enforced MFA) rode
  the execution context **undeclared**: REST's `computeExecCtx` spread it onto the
  assembled envelope with `...(authGate ? { authGate } : {})` behind an `as any`,
  and its `enforceAuth` read it back ten lines later. Nothing was broken — but the
  closed entry field set shipped in #6216 is derived from `keyof ExecutionContext`,
  so a field that exists only inside an `as any` is **outside every closure gate by
  construction**: `ENTRY_EXECUTION_CONTEXT_FIELDS` could not list it,
  `ExecutionContextEntryFields` could not demand it, and the runtime pin that
  reconciles the closed set against `ExecutionContextSchema.shape` could not see
  it. It was the exact blind spot that gate exists to remove, sitting one `as any`
  outside it.

  **@objectstack/spec** declares the field:

  ```ts
  authGate: z.object({ code: z.string(), message: z.string() }).optional();
  ```

  Both inner keys are required, matching the sole producer
  (`AuthManager.computeAuthGate`, which sets both on every return branch) — `code`
  is the stable machine code a client branches on, `message` is what the blocked
  user reads, and the transport seam renders both as the `403` body.

  **@objectstack/core** picks it up as an ENTRY-decided field — it is resolved from
  the request's own session at the transport entry point, never written mid-request
  — so `ExecutionContextAssemblyInput` gains a **required** `authGate` input on the
  same footing as `accessToken`: every face states its decision instead of omitting
  it. A guest principal never carries one (no authenticated session for a policy
  gate to attach to). Also exported: `normalizeAuthGate`, which completes a session
  user's loose `authGate` into the declared shape at the one producer rather than
  tolerating a partial shape downstream — a gate naming a `code` but no `message`
  no longer renders a `403` body with `message: undefined`. `AuthGate` is now
  derived from the schema instead of being a second hand-written declaration.

  **@objectstack/rest** passes the resolved gate as an assembler input and drops the
  post-assembly spread; the remaining `as any` covers `__kernel` alone.
  **@objectstack/runtime** (the runtime / MCP dispatcher) passes `authGate:
undefined` on the record: it enforces the same gate at its own seam
  (`HttpDispatcher.enforceAuthGate` re-reads the session and calls
  `evaluateAuthGate`) and never reads `context.authGate`, so carrying it there
  would be a second copy no consumer reads.

  **No runtime behaviour change on either surface.** The shared assembler omits
  `undefined`-valued keys, so the key is present exactly when it was before. The one
  new behaviour is the normalization above, on a shape the sole producer never
  emits today.

- f586f1a: refactor: one shared `ExecutionContext` assembler, two named anonymous entries (#6216)

  `resolveAuthzContext` already made AUTHORIZATION resolution single-sourced; the
  step after it — turning the resolved envelope into the `ExecutionContext` that
  reaches enforcement — was still one hand-written copy per transport, and the
  copies drifted twice for real: **#6071** (the REST copy never set
  `principalKind`, so every enforcement judgment reading it was silently
  never-true on that face) and **#6206 / #6551** (a dropped `accessible_org_ids`
  produced real 403s on the share-link faces).

  **@objectstack/core** gains the single assembly, with the anonymous divergence
  as named API rather than drift (maintainer ruling 2026-08-08 on #6216, Option
  A):

  - `assembleExecutionContext(input)` — the **fail-closed default** entry. No
    resolved principal → `undefined`, and the surface answers 401.
  - `assembleExecutionContextOrGuest(input)` — the **explicit guest** entry. No
    resolved principal → a first-class guest envelope (`principalKind: 'guest'`,
    `positions: ['guest']`), whose consumers are live (`explain-engine`'s
    guest ⇒ `EXTERNAL` posture floor). Adopted only by a surface whose product
    semantics serve anonymous principals.
  - The field set is **closed by type**: `ExecutionContextEntryFields` requires a
    decision for every `ExecutionContext` field that is not explicitly declared
    non-entry-resolved, so a new field cannot reach one transport and miss
    another. Also exported: `ENTRY_EXECUTION_CONTEXT_FIELDS`,
    `EntryExecutionContextField`, `ExecutionContextAssemblyInput`,
    `OAuthTokenProvenance`, `EntryLocalization`.

  **@objectstack/runtime** (`resolveExecutionContext`, the runtime / MCP
  dispatcher) and **@objectstack/rest** (`computeExecCtx`) now assemble through
  that module — the dispatcher via the guest entry, REST via the fail-closed
  default.

  **No runtime behaviour change on either surface.** The remaining per-face
  divergences are required inputs rather than silent omissions: REST passes
  `accessToken: undefined` (it has never carried the session bearer on the
  envelope, and `session.accessToken` is a published hook surface) and
  `oauth: undefined` (OAuth bearers are honoured on the `/mcp` door alone). The
  one measurable difference is that a key whose value was `undefined` is now
  omitted rather than spelled — invisible to `ctx.x` reads, to `JSON.stringify`
  and to spreading the envelope.

- 763931e: feat(filters): evaluate `{filter-token}` placeholders server-side (#3582)

  Filter values travel as JSON, so a time- or user-scoped slice writes a
  placeholder instead of code:

  ```ts
  filter: { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' }
  ```

  The vocabulary has been in `@objectstack/spec` for a while (`date-macros.zod.ts`,
  `context-tokens.zod.ts`) and `objectstack build` rejects tokens outside it
  (#3574). What was missing is the half that _substitutes a value_: **nothing on
  the server ever did**. A placeholder reached the driver as the literal string
  `'{current_year_start}'`, compared as text, and matched nothing.

  That failure is invisible — an empty widget looks exactly like a metric that is
  legitimately zero — so apps worked around it by computing dates at module load,
  which freezes "this year" into the built artifact and quietly goes stale.

  **New: `resolveFilterTokens()` in `@objectstack/core`**, wired into the two
  server-side seams every filter passes through:

  - **ObjectQL read path** — `find` / `findOne` / `count` / `aggregate`, so REST
    queries, related lists, saved-view filters and flow `find_records` all resolve.
    It runs before the middleware chain, so only author-supplied filters are
    inspected; RLS/sharing filters are injected downstream from concrete values.
  - **Analytics dataset executor** — a dataset's intrinsic `filter`, a widget's
    `runtimeFilter`, measure-scoped filters, and time-dimension `dateRange`s.
    This path needs its own call: `NativeSQLStrategy` compiles raw SQL and binds
    comparands directly, so a dashboard widget never passes through `engine.find()`.

  Behavioural notes:

  - Date tokens resolve to ISO strings (`YYYY-MM-DD`, or a full timestamp for
    `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`). Turning that into a column's
    on-disk form stays the driver's job (`SqlDriver.temporalFilterValue`), so
    there is still exactly one source of truth for the storage convention.
  - Calendar boundaries follow `ExecutionContext.timezone`; one instant is pinned
    per filter tree, so a `>= {current_month_start}` / `< {next_month_start}` pair
    can never straddle a boundary.
  - `{current_org_id}` reads `ExecutionContext.tenantId`; `{current_user_id}` reads
    `userId`. A request carrying neither now **throws** instead of resolving to
    `null` — a null comparand degrades to `IS NULL` on most drivers and would hand
    back the rows the filter was written to exclude.
  - An unrecognised placeholder **throws**, carrying the near-miss fix
    (`{current_user}` → `{current_user_id}`, `{this_quarter_start}` →
    `{current_quarter_start}`). This matches what `objectstack build` already
    enforces. Consequence, previously implicit and now load-bearing: a filter value
    that is _entirely_ `{...}` is always read as a placeholder, so a literal value
    of that shape is not expressible — rename the value.

  Also in this change: `notify` no longer sends the six-character string
  `"undefined"` as an audience member. `to: ['{record.owner.manager}']` walks
  `.manager` on a scalar foreign-key id, resolves to nothing, and `String(undefined)`
  turned that into a phantom recipient — the emit "succeeded", addressed nobody,
  and said nothing. Unresolved recipients are now dropped, and a node with no
  recipient left fails naming the offending template and pointing at the start
  node's `config.expand` (#3475), which does hydrate the relation.

- 518ca7a: fix(i18n): `GET /i18n/locales` reports the locales the app declared, not every locale a plugin happened to load (#7679)

  `GET /api/v1/i18n/locales` answered with four locale descriptors — `en`,
  `zh-CN`, `ja-JP`, `es-ES` — on the showcase app, whose artifact declares
  `i18n.supportedLocales: ['en', 'zh-CN']`. The envelope was correct (#3636); the
  **set** was a superset.

  Nothing was wrong with what had been _loaded_. Every platform plugin
  (`platform-objects`, `service-settings`, `service-storage`, `service-messaging`,
  `service-realtime`, `plugin-security`, `plugin-sharing`, `plugin-webhooks`)
  ships an `en/zh-CN/ja-JP/es-ES` bundle and pushes it at `kernel:ready`, which is
  what a platform should do. What was wrong is that the **loaded** set was
  reported as the **offered** set — two different facts owned by two different
  parties. So a locale picker built from this route, including the platform's own
  Settings > Localization select, offered `ja-JP` and `es-ES`: locales in which
  only `sys_*` objects are translated, guaranteeing a mixed-language session for
  everything the app itself owns.

  **What changed.** `II18nService` gains an optional
  `setSupportedLocales(locales)`. `AppPlugin.loadTranslations` threads the
  artifact's `i18n.supportedLocales` into it exactly the way it already threads
  `defaultLocale`, and both providers of the `i18n` slot — `createMemoryI18n` in
  `@objectstack/core` and `FileI18nAdapter` in `@objectstack/service-i18n` —
  narrow what `getLocales()` reports to that declaration. The runtime app-plugin
  layer is the only place this can originate: `getLocales()` sees what is loaded,
  and the app's declaration is not visible below it.

  The narrowing is applied as a filter at **read** time, never as a prune of what
  is stored, because the platform bundles arrive _after_ the app plugin has run.

  **Only the reported set narrows.** Bundles stay loaded and stay servable:
  `GET /i18n/translations/ja-JP` still answers on a stack that no longer
  advertises `ja-JP`, and `t()` still resolves it. Unloading those bundles buys
  nothing — `sys_*` translations for an unadvertised locale cost nothing sitting
  in the map.

  Two questions the fix had to settle, both behaviour in their own right:

  - **An app that declares no `supportedLocales` is not narrowed.** Absent means
    "no narrowing", and it keeps reporting every loaded locale — the behaviour it
    has today. Every app written before this change declared nothing, so
    narrowing an undeclared app to zero (or to its default alone) would have
    emptied the picker on every stack whose author never opted in. An
    `i18n` block carrying only a `defaultLocale`, and a `supportedLocales: []`
    that declares no usable code, are both read the same way.
  - **A declared locale with no bundle behind it is reported, not dropped.** If an
    app declares a locale the platform plugins never shipped, it appears in the
    response as declared-but-unserved rather than being silently intersected away.
    The declaration is the app's statement of intent and the client is entitled to
    see it; a quietly shortened list hides the authoring gap from both ends.
    Reporting the declaration is also the only answer that does not depend on how
    many bundles had loaded by the time the route was called. Reads for such a
    locale degrade to the default/fallback exactly as a half-translated bundle's
    missing keys already do.

  Reported locales now follow the **declared order** rather than the insertion
  order of whichever plugin loaded first, so a picker renders the ordering the app
  author wrote.

  `setSupportedLocales` is optional on the contract, like `setDefaultLocale`: a
  third-party `II18nService` that does not implement it keeps its current
  behaviour instead of failing to boot.

- 4cca74c: fix(i18n)!: the `translation` metadata type speaks the same `objects.` shape everything else does (#3778)

  A translation authored in the product saved successfully and then rendered
  nothing. Not a resolver gap — a contract split. The `translation` metadata type
  (`allowRuntimeCreate: true`, so Studio/the metadata API/an agent can author it)
  was registered against `AppTranslationBundleSchema`, an object-first shape keyed
  on `o.<object>`. Every resolver, `os i18n extract`, `os i18n check`, the objectui
  hooks, and all nine shipped bundles read `objects.<object>`. Nothing bridged the
  two, so the save path and the read path never met.

  **Why converge instead of bridge.** A converter was the obvious fix and the
  wrong one: it would be throwaway code, and it would start producing _working_
  `o.`-shaped rows — closing the migration-free window that exists precisely
  because the feature never functioned. The retired shape's real-world footprint
  was zero: all three `*.translation.ts` files in the tree (platform-objects,
  CRM and todo examples) were already `objects.`-shaped, contradicting the type's
  own registered schema. Converging is a registration fix, not a migration.

  **Breaking.** `AppTranslationBundleSchema`, `ObjectTranslationNodeSchema`, and
  their types are **deleted** — no deprecation cycle. Nothing worked end-to-end
  through them, so there is no functioning consumer to protect, and a
  deprecated-but-present schema is exactly the exemplar an AI agent copies into
  new code. The optional `II18nService.getAppBundle` / `loadAppBundle` methods go
  with them: zero implementers, so they advertised a capability the runtime never
  delivered.

  **The replacement.** `TranslationItemSchema` — one locale of the same
  `TranslationData` groups a file bundle uses, plus the `locale` it translates,
  with a `defineTranslation()` factory. An item is one entry of a
  `TranslationBundle`; that is the whole type.

  Three details are deliberate, all aimed at the failure being silent rather than
  loud:

  - **`locale` is required**, not inferred from the item name. The sync skips an
    item whose locale it cannot resolve, and a skip is invisible to whoever — or
    whatever — authored it. (The name fallback still covers rows written before
    this.)
  - **Retired keys are rejected, not stripped.** Zod drops undeclared keys
    silently, which would reproduce this bug exactly: save succeeds, nothing
    renders. A pre-parse guard turns that silence into a 422 naming the group to
    use (`'o' … — use 'objects.<object_name>'`). It runs ahead of the parse so the
    retired keys stay out of the schema itself — the generated JSON Schema and the
    Studio editor never advertise a shape that cannot work.
  - **`ObjectTranslationData.label` is now optional.** Partial translation is the
    normal state and every resolver already treats each key as independent.
    Requiring it forced authors to restate the source label just to validate,
    filling bundles with fake translations that mask real coverage gaps.

  Also in this change: the authored-translation sync warns (naming the row and the
  fix) when it meets a row still in the retired shape instead of loading it into
  nowhere, and no longer merges publish bookkeeping (`_lockReason`,
  `_packageVersion`, …) into the translation layer. `GET
/i18n/labels/:object/:locale`'s fallback now reads the nested
  `objects.<obj>.fields.<field>.label` data it is actually given — it scanned for
  flat dotted `o.<obj>.fields.<field>` keys, a third dialect no producer ever
  wrote, so it always returned `{}`.

  Migration: author every translation — file or runtime item — under `objects.`.
  `o` → `objects`, `app` → `apps`, `nav` → `apps.<app>.navigation.<id>.label`,
  `dashboard` → `dashboards`, `_globalOptions` →
  `objects.<obj>.fields.<field>.options`, `_meta.locale` → top-level `locale`,
  `_actions.confirmMessage` → `_actions.confirmText`. `reports`, `notifications`,
  `errors`, and `namespace` had no runtime consumer and have no replacement.

- 0f2fdcd: fix(core)!: a throwing `kernel:bootstrapped` / `kernel:listening` handler fails the boot on LiteKernel too (#5257)

  **A failed `listen()` no longer yields a false "✅ Bootstrap complete".**

  #5170 (PR #5258) unified `kernel:ready`: a handler that throws fails the boot on
  `ObjectKernel` and `LiteKernel` alike. It deliberately ruled that one hook only,
  leaving the other lifecycle hooks split — `ObjectKernel` propagates their
  failures (its `context.trigger` is a bare awaited loop that never catches) while
  `LiteKernel` routed them through the isolating dispatcher, logging
  `Hook handler failed: <name>` and carrying on. This closes the two boot-path
  hooks that were left: `kernel:bootstrapped` and `kernel:listening` now use the
  propagating dispatcher (`triggerHookOrThrow`) on `LiteKernel`, in the same shape
  #5258 established — the remaining handlers for that hook are skipped, the later
  boot hooks never fire, the original error reaches the caller **unwrapped**,
  `state` is left `'stopped'` rather than `'running'`, and the success line is
  never logged.

  The concrete failure this removes: `HonoServerPlugin` opens its socket inside a
  `kernel:listening` handler — `await this.server.listen(port)`, with no try/catch
  of its own, deliberately. When that rejected on `LiteKernel` (EACCES on a
  privileged port, a failure inside the port-fallback logic itself, a serverless /
  edge host where `listen` is not available at all) the throw was swallowed,
  `bootstrap()` resolved normally, and the process printed
  `✅ Bootstrap complete` while **nothing was listening**. The same plugin code on
  `ObjectKernel` failed the boot. The health check that came next was the first
  thing to notice, and it had already been told startup succeeded. Plain "port is
  in use" was never affected — `server.listen` falls back to a random port
  internally — which is exactly why this stayed invisible.

  `kernel:bootstrapped` carries reconcile and audit work (objectql's
  `announceOpenMigrationGates`, service-automation's node-type / trigger-binding
  audits, the sharing plugin's boot backfills); a swallowed failure there is a
  quieter version of the same lie — the audit silently does not run.

  **`kernel:shutdown` keeps fail-soft dispatch**, now as an explicit per-hook
  judgement recorded in a comment at the dispatch site rather than an inherited
  default. On the teardown path there is no "refuse to proceed" left to buy, and
  the handlers queued behind a failing one — plus the reverse-order `destroy()`
  pass after them — are what flush buffers, close connections and release locks.
  Aborting that sequence would convert one bad handler into leaked resources and
  unflushed writes.

  **Who is affected.** Hosts that boot through `LiteKernel` — vitest, serverless,
  edge (Workers) — and register a `kernel:bootstrapped` or `kernel:listening`
  handler that can throw. Such a host previously came up "successfully" with the
  work of that handler silently skipped; it now refuses to start and surfaces the
  original error. If a handler of yours performs best-effort work whose failure
  genuinely must not stop the boot, it needs its own `try/catch` — which is what
  the in-repo `kernel:bootstrapped` subscribers already do, per handler, with the
  reason written down. Nothing in this repo relied on the swallow: the core (426),
  client, runtime, http-conformance, connector-{rest,mcp,slack} and
  service-automation (665) suites pass unchanged.

  Boot assertions still belong in `kernel:ready`: it is the earliest hook at which
  the service registry is finished filling.

- 8ffa8b9: fix(core)!: a throwing `kernel:ready` handler now fails the boot on **LiteKernel** too (#5170)

  **Behaviour change — read this if you run `LiteKernel` (vitest harnesses,
  serverless functions, edge workers).** A `kernel:ready` handler that throws now
  **rejects `bootstrap()`** on `LiteKernel`, exactly as it always has on
  `ObjectKernel`. Before this change the throw was caught inside the kernel,
  written out as one `Hook handler failed: kernel:ready` error log, and the boot
  continued to "✅ Bootstrap complete".

  **Why it mattered.** The two kernels ran the same hook through two different
  dispatchers: `ObjectKernel` used `context.trigger` (a bare awaited loop that
  never catches), `LiteKernel` used `triggerHook` (per-handler try/catch,
  "continue with other handlers even if one fails"). Same hook name, same plugin
  code, opposite failure semantics — which is `declared ≠ enforced` in the
  kernel's own lifecycle contract.

  `kernel:ready` is the only correct moment for a plugin to assert that a
  precondition it _declared_ was actually delivered: the service registry is
  still filling during `init()`, so a boot gate has nowhere earlier to run. Every
  "declare it and we refuse to start if we cannot honour it" gate in this repo
  therefore lives there — and on `LiteKernel` those gates were being downgraded to
  a log line while the process came up and served traffic without the guarantee it
  had announced. `EmailServicePlugin`'s `queueDelivery: true` gate (#5160) is the
  worked example: on `ObjectKernel` the boot failed, on `LiteKernel` the server
  came up and quietly fell back to inline delivery. Serverless is exactly where
  "do not start misconfigured" matters most.

  **Who is affected.** Any `LiteKernel` host whose `kernel:ready` handler throws
  on a healthy boot. That boot previously "succeeded"; it now fails loudly with
  the original error, and the kernel is left `stopped` rather than `running`. The
  failure was never silent — it was already an `ERROR` line in your logs — so
  check for `Hook handler failed: kernel:ready` in existing logs to find hosts
  that will now refuse to start. If the handler's work is genuinely optional,
  catch inside the handler and log there; the kernel no longer decides that for
  you. The full test surface in this repo that boots `LiteKernel` (core, client,
  runtime, http-conformance, the connectors, service-automation) passes unchanged
  — nothing was relying on the swallow.

  Scope: **`kernel:ready` only.** `kernel:bootstrapped`, `kernel:listening` and
  `kernel:shutdown` keep `LiteKernel`'s isolating dispatch, pinned by a test.

- 9319586: feat(core,metadata,objectql): `IMetadataService.register` refuses ambiguous writes, and type stores key on the canonical type (#7378)

  The maintainer's three-cell ruling of 2026-08-12 on #7378, implemented in every
  shipped `IMetadataService` implementation — `createMemoryMetadata`
  (`@objectstack/core`), `MetadataManager` (`@objectstack/metadata`) and
  `MetadataFacade` (`@objectstack/objectql`) — through one shared guard,
  `assertMetadataRegisterContract` / `canonicalMetadataServiceType`, newly
  exported from `@objectstack/core`:

  - **A `data.name` that disagrees with the `name` argument is refused** with a
    locating `VALIDATION_ERROR` (status 400), before anything is stored. The
    previous behaviours resolved the disagreement silently in opposite
    directions per implementation (argument-wins on the Map-backed stores,
    document-wins on the pre-#7511 facade), either of which can file an item
    under a key the author never wrote. A document carrying no `name` of its own
    still registers under the argument — absence is not a disagreement.
  - **A non-object `data` (primitive, `null`, array) is refused** the same way.
    It was previously accepted-then-dropped by `MetadataFacade` (readable back
    through no member) and interim-fixed by boxing into `{ name, content }`; the
    ruling forbids both the drop and the coercion.
  - **Type stores are keyed on the canonical (singular) type**: `'objects'` and
    `'object'` now address ONE store on every implementation, in both the write
    and the read direction, converging with the platform's enforced
    plural→singular normalization (`PLURAL_TO_SINGULAR`, `canonicalMetaType`
    #4432, `check:meta-type-normalized`).

  Callers that register with a matching (or absent) `data.name` and plain-object
  documents — every in-tree caller — are unaffected. A caller that relied on a
  mismatched `data.name` being silently resolved must pass the intended key as
  the argument and make `data.name` match it; a caller storing a bare value must
  wrap it in a document whose shape its type's schema accepts.

- 071d0dc: feat(runtime,cli,core): boot reconciliation and `os migrate resume` for the migration journal — an interrupted run can no longer go unnoticed (ADR-0119 D2, #4617)

  Completes ADR-0119 D2. The runner and `sys_migration_journal` landed in #4668; this is the discovery channel that makes an interrupted run findable by someone who does not already know it happened.

  **`MigrationRecoveryPlugin` (`@objectstack/runtime`)** — at `kernel:ready`, scans the journal for runs that started and never concluded, and warns per run: how many chunks committed, which have an **unknown** outcome (`chunk_started` with no `chunk_done`), whether a compensation was left half-finished, and the exact command that will act. It also owns the `migration-plans` registry service.

  **`os migrate resume` (`@objectstack/cli`)** — lists interrupted runs (read-only, the default), or acts on one with `--run <id>`, under confirmation. Exits non-zero when a run ends `failed`, so a scripted recovery cannot move on from a migration that needs a human.

  **`MigrationPlanRegistry` (`@objectstack/core`)** — where a resume finds the plan it has to re-run.

  ## Boot discovers, the CLI acts

  This is the design decision, and it is deliberate rather than incidental.

  Resuming is a large, irreversible, potentially hour-long write against production data. Doing that as an unrequested side effect of a process starting is the kind of behaviour an operator finds out about from a graph. It is also not always possible at boot: a resume needs the plan's live callbacks, and the package that owns them may not be loaded in whichever process happened to restart first.

  So boot surfaces the run and names the command; the command acts, under explicit operator intent. ADR-0119 D2's per-plan `onCrash` policy still decides **what** acting means — resume forward from the first chunk lacking `chunk_done`, or unwind what committed — it just does not decide **when**, and "when" is the part a human should own.

  Deferring is safe precisely because of the runner's re-entrancy: `started ∧ ¬done` is durable, so an interrupted run stays exactly as recoverable an hour later as it was at boot. Nothing decays while the operator decides.

  ## Why a plan registry exists at all

  A journal cannot hold a plan. `forward` and `compensate` are functions and `load()` reads the live database, so none of it crosses a process boundary — which is why the journal records the plan **hash**, not the plan. Recovery therefore needs the plan handed back by the code that owns it, and `migration-plans` is that seam: between "the journal knows a run stopped at chunk 7" and "something in this process knows what chunk 7 was supposed to do".

  A run whose plan no loaded package registers is **reported**, never silently skipped — the operator is told which plan id is missing. "Nothing to resume" and "the code that owns this run is not here" are different facts, and only one of them is safe to ignore.

  ## Degradation

  No engine, or no `sys_migration_journal` registered (a lean kernel that never composed platform-objects) → the scan is skipped in **silence**: such a kernel has no interrupted runs to find, and a warning there would train operators to ignore this plugin's output, which is the one thing it cannot afford. A scan that **fails**, by contrast, is reported — "I could not check" and "there is nothing to find" are different answers.

  11 new tests pin the split (boot writes nothing to the journal), the three states an operator must tell apart (clean / interrupted / half-unwound), and both degradation paths.

- d13004a: feat(core,runtime): plugin ordering is a declared, kernel-enforced contract (ADR-0116, #4131)

  `kernel.use()` registration order was never a contract — the kernel resolves
  init/start order from the plugin dependency graph — but a plugin that needed a
  service at init _when its provider is composed_ while also booting _without_
  the provider had no way to declare that. `AppPlugin` was the standing example:
  it grabs `manifest`/`objectql` synchronously in `init()`, declared nothing
  (a hard dependency would break empty-env / metadata-only / mock-engine
  kernels), and so its correctness rode on which array slot each caller put it
  in. That convention failed the same way twice (`DefaultDatasourcePlugin`'s
  first cut; then #4085, disguised for months as "crashes when the artifact is
  missing").

  The kernel `Plugin` contract gains three additive fields, enforced by both
  `ObjectKernel` and `LiteKernel` through one shared implementation
  (`plugin-order.ts` — the previously duplicated topological sort is unified
  there):

  - **`optionalDependencies: string[]`** — order-if-present: hoisted ahead
    exactly like `dependencies` when composed (real topology edges, including
    cycle detection), silently skipped when absent.
  - **`requiresServices: string[]`** — services resolved synchronously during
    `init()` with no fallback. Validated **before Phase 1**: a required service
    whose only declared provider initializes later fails the boot with an error
    naming both plugins, both slots, and the fix — before any init side
    effects. Re-checked immediately before the plugin's own init, where a still-
    missing service becomes a named composition error exactly where the old
    bare `Service not found` crash fired.
  - **`providesServices: string[]`** — services a plugin's `init()`
    unconditionally registers; powers the validation and the diagnostics.

  Plugins that declare nothing get the diagnosis too: a `getService` miss
  during Phase 1 now appends which plugin was initializing and — when a
  composed plugin declares the service — who provides it and how to declare the
  ordering. The `Service '<name>' not found` prefix and the factory-backed
  `is async - use await` message are unchanged.

  First adopters: `AppPlugin` declares
  `optionalDependencies: ['com.objectstack.engine.objectql']` +
  `requiresServices: ['manifest']` (cleared on the empty-env no-op path), so
  the #4085 composition — AppPlugin registered before the engine — now boots
  correctly in every slot; `ObjectQLPlugin` declares
  `providesServices: ['objectql', 'data', 'manifest', 'lifecycle']` and
  `MetadataPlugin` declares `providesServices: ['metadata']`.

  Everything is additive — plugins that declare nothing keep their exact
  ordering semantics; no existing declaration changes meaning.

- 28d1eb7: fix(core): the QA `contains` assertion fails loudly instead of silently passing on a non-array/non-string actual (#7256)

  `TestRunner.assert`'s `case 'contains':` handled the two shapes it can evaluate —
  an array (membership) and a string (substring) — and had **no `else`**. Every
  other shape fell straight out of the switch throwing nothing, so the assertion
  reported **PASSED**. A scenario asserting
  `{ field: "body.data.items", operator: "contains", expectedValue: "acme" }`
  against a response that has no `body.data.items` at all reported ✅. The
  overwhelmingly common way to reach that branch is the one that matters most: a
  typo'd `field` path, or a response shape that moved under a suite nobody
  re-read. The assertion that was supposed to _be_ the test is the thing that
  silently disappears, and CI believes the green.

  `contains` was the only path in this engine that could decide "no comparison
  applies here" and report success. Every other unhandled shape already fails
  loud — an operator with no branch throws `Unknown assertion operator`, an action
  type with no adapter branch throws `Unsupported action type in HttpAdapter`,
  and `equals`/`not_equals`/`is_null`/`not_null` all compare unconditionally. This
  closes the asymmetry rather than adding a new posture: an assertion the engine
  **cannot evaluate** is a **failed** assertion.

  The message is written for the author who has to act on it, so it names the
  field, the operator and the runtime type of what the path actually resolved to
  (`null` and arrays get their own names, not `typeof`'s `object`), and then says
  which of the two things is wrong:

  ```
  Assertion failed: body.data.items cannot be evaluated by 'contains' — expected an
  array or a string at that path, got undefined. The path resolved to nothing — the
  field is absent from the result, or the path is misspelled. Use 'is_null' if
  asserting absence is what you meant.
  ```

  `undefined`/`null` point at the **fixture** (the path did not resolve, so the
  field path or the response shape it was written against is the suspect);
  a number, boolean or object points at the **assertion** (the path resolved
  fine and `contains` is the wrong operator for what it found).

  **Behaviour change, and its measured blast radius.** Suites that today pass a
  `contains` against a non-array/non-string will start failing — which is the
  point; each such assertion was asserting nothing. The in-tree radius was
  measured on the loud build and is **zero**: `os test` is the runner's only
  consumer, and the repository contains no Quality Protocol suite documents at
  all (no `qa/*.test.json` anywhere; the three example apps run `vitest`, and
  `packages/qa/*` are vitest suites that never touch `TestRunner`). No CI workflow
  invokes `os test`. So no in-repo case was passing vacuously and none needed
  repair. Downstream suites are the ones that will see red, and every case they
  see is a test that was never running.

  The two evaluable shapes are untouched in both directions: a matching array or
  string still passes, a non-matching one still fails with its existing message.
  `not_contains`, `gt`, `gte`, `lt`, `lte` and `error` are declared in
  `TestAssertionTypeSchema` and still have no branch in the runner — they were
  already refused loudly at `default:` rather than silently passed, so they do not
  carry this defect; that gap is recorded separately and is pinned here so a later
  implementation is a deliberate change rather than an accident.

- 1363084: feat(spec,objectql): `engine.transaction` 契约收紧第一批 —— `opts.require` fail-closed 与 `owned` 信号 (#5696)

  `IObjectQLEngine.transaction` 的声明面(`packages/spec/src/contracts/objectql-engine.ts`,
  ADR-0119 D1)此前把「默认驱动之外的对象写在事务外」与「驱动没有 `beginTransaction`
  时静默降级」写成**声明语义**的一部分。#4619 把这两条降级变得可观测(PR #5724),本次
  把其中两条收紧为调用方可选的契约,并同步修订 TSDoc 的事实性偏差。

  **新增(可选,默认行为完全不变):**

  - `transaction(cb, base, { require: true })` —— 驱动没有 `beginTransaction` 时
    **抛 `TransactionUnsupportedError`(`code: 'ERR_TRANSACTION_UNSUPPORTED'`)**,
    而不是静默降级成「无事务、无回滚」。在回调运行**之前**拒绝,所以调用方收到错误时
    一行都还没写。这是把 `batchData` 的 atomic 门(ADR-0119 D4)泛化成通用能力:
    只为「开事务的唯一理由就是回滚」的调用方而设,不传 `require` 的行为一字未变
    (仍然降级 + warn-once)。
  - 回调的**第二个参数** `{ owned: boolean }` —— `true` 表示本次调用开启了事务并拥有
    提交/回滚,`false` 表示它 **join** 了外层已开的 ambient 事务(ADR-0067 D2),
    或者处在降级路径上(那里根本没有事务可拥有)。join 语义本身正确且保留;缺的是
    调用方**无从分辨**,而「整体一起回滚」这类担保只在 owned 时成立。单参数回调不受影响。

  两点在 `ctx.api.transaction`(`ScopedContext.transaction`,沙箱 hook/action 体)上
  同样生效 —— 同一个原语的第二份实现不该变成第二种方言。

  **契约文本修订:** transaction 的 TSDoc 原先写「路由到别处的对象在事务**外**写入」,
  实测不符 —— 引擎无条件把 ambient 事务句柄穿给了目标驱动,语句在**错误的连接**上执行
  (#5351 在真 SQL driver 上实测为 `no such table`)。TSDoc 已按实测改写,并声明了随后
  落地的两条语义:业务写跨驱动**响亮拒绝**、系统账本(`lifecycle.class` 为
  `audit`/`telemetry`/`event`)**移出事务执行**。

  **类型面:** `@objectstack/core` 的 `EngineWithTransaction` 从「手抄签名」改为
  `transaction: IObjectQLEngine['transaction']`,窄接口可以窄,但不能与真签名漂移。
  新导出 `EngineTransactionOptions` / `EngineTransactionInfo`(spec `contracts` 命名空间,
  经 `@objectstack/core` 转出)。

  升级须知:无破坏性变更。既有调用点全部保持原行为;要 fail-closed 的调用方显式传
  `{ require: true }`。

- e4c2dc8: Order temporal operands correctly when one side is a JS `Date` on the two
  type-blind filter backends (ADR-0053 D-A3 / #4191).

  `utcInstantMs` joins `nextUtcCalendarDay` in `@objectstack/spec/data`
  (re-exported from `@objectstack/core`): it reads the UTC instant a temporal
  operand denotes, accepting only unambiguous spellings — a `Date`, epoch ms, a
  bare `YYYY-MM-DD`, and an ISO timestamp with or without an explicit zone (a
  zone-naive one being UTC, per D-B2) — and returning `null` for everything
  else, notably a bare wall clock, which denotes no instant.

  Both type-blind evaluators now use it to compare a `Date` against wire text,
  which JS relational operators cannot do: `<` and friends coerce with hint
  `number`, so the `Date` becomes its epoch and the string becomes `NaN`.

  - `formula`'s `matchesFilterCondition` (the RLS write-side `check`) dropped
    every `Date`-valued row in 10 of the 16 shared conformance cases. The
    post-image is the caller's raw write payload, so an SDK write of
    `new Date()` hit this directly, and fail-closed turned it into a **denied
    write**.
  - `service-analytics`' preview evaluator diverged on the same 10 cases in
    BOTH directions, because `String(new Date())` sorts after every `'2026-…'`
    comparand — a drafted chart both lost rows and gained ones, then changed
    its numbers at publish. Rows from a mongo-backed dataset arrive as BSON
    `Date`s, so this was reachable in normal use.

  Comparisons that did not involve a `Date` are unchanged.

### Patch Changes

- 690ccf2: fix(objectql): a by-id `update()`/`delete()` against a nonexistent record answers 404 `RECORD_NOT_FOUND` instead of a 400 from further down the pipeline (#7867)

  Nothing on the action-body write path ever asked whether the target row existed.
  `ctx.api.object(name).update({ id, … })` reached `ObjectQL.update()`'s by-id
  branch through `buildSandboxApi` → `ObjectRepository`, and that branch had **no
  existence gate at all**: `engine.update()` on a ghost id was a silent no-op that
  resolved `null`, so the write ran on into validation, the driver and the hook
  chain and died on whichever complained first.

  **Which one it died on varied with the object's declarations**, which is why the
  defect read as several unrelated bugs:

  - a **hooked** object → `400` `HookConditionError`, from an `afterUpdate`
    condition reading `previous` on a row nobody read;
  - an **unhooked** object → `400` `VALIDATION_FAILED` "X is required", because
    with no prior row a PATCH is validated as if it were a whole record.

  The 400 class varied; the missing 404 was the constant. Measured on one showcase
  stack, same id, same object, same second: `POST /actions/showcase_task/
showcase_mark_done/<ghost>` answered 400 while `PATCH /data/showcase_task/
<ghost>` answered 404. Both answer **404 `RECORD_NOT_FOUND`** now.

  `delete()` had the same shape and was the worse of the two: with no gate it
  reported success for a row that was never there, so a typo'd id, an
  already-deleted row and a real deletion were indistinguishable.

  **This is not a `previous`-binding bug.** `if (priorRecord) hookContext.previous
= …` is correct and is untouched — ADR-0058 Addendum II / #4649 require that an
  absent row leave `previous` UNBOUND rather than fabricated. It was behaving
  correctly on a path that should never have been entered, so the fix removes the
  producer rather than specializing what it produced.

  **Where the gate went, and why there.** At the engine, in the by-id branches of
  `update()` and `delete()` — the one point all three action-body write faces
  funnel through (`ctx.api.object()`, its context-less repo-facade fallback, and
  `ctx.engine.update()`). A repository-level gate would have closed one of the
  three and made `ql.update(o, { id })` and `ctx.api.object(o).update({ id })`
  answer one ghost id two different ways. Two sibling paths already gated
  correctly — `protocol.updateData`/`deleteData` (#4435) and `callData`'s ObjectQL
  fallback (#5138) — and all three now throw the **same** `recordNotFoundError`,
  which moved to `@objectstack/core` so the engine can reach it without importing
  `@objectstack/metadata-protocol` (forbidden in the `/core` closure by ADR-0076
  D2's boundary ratchet). `@objectstack/metadata-protocol` re-exports it unchanged.

  Existence is asked with a pre-write read, never off the write's own result:
  `IDataDriver.update` declares no not-found signal, and the engine's post-write
  readback is `null` for a second reason (a write that moves the row out of the
  caller's row scope), so reading either would answer 404 to a write that landed.

  **Behaviour change worth knowing about — the by-id prior-row read is now
  unconditional.** #5284 (update) and #5929 (delete) had narrowed it to "does
  anything CONSUME the prior row?", skipping the read for objects with no hook, no
  prior-reading validation rule and no roll-up. Existence is a consumer that
  demand list never enumerated and the one consumer every by-id write has, and no
  cheaper question answers it — so the skip and the gate are mutually exclusive.
  The measured cost is small: #5929's own record enumerates the global hook
  registrants (plugin-sharing, service-storage, plugin-auth, plugin-audit), so on
  any kernel that loads them the demand was already true for every object and the
  narrowing skipped nothing. The read is genuinely new only for a bare
  `@objectstack/objectql/core` embedder — which is buying a 404 it did not have.

  Three read-count pins measured the old skip and now measure the read, each
  recording what changed and why at its own site: #5284's and #5929's in
  `packages/objectql`, and #5860's `sys_job_queue` case in `@objectstack/plugin-audit`.
  The DISPATCH half all three are actually about — the per-object `hasHooksFor`
  question, the `excludeObjects` subtraction, and the retired
  `sys_fetch_previous_*` builtins — is untouched and still pinned.

  One further case encoded the old silent no-op as correct: `@objectstack/plugin-auth`'s
  #5941 last-admin-guard test deleted a `sys_account` id that was never seeded and
  asserted it RESOLVED, to show the guard does not write-guard that object. It now
  deletes a REAL row — which states the same thing more strongly — and separately
  pins that a ghost id there is refused by the ENGINE rather than by the guard.

  **Scope.** By-id only. A `multi: true` predicate write matching zero rows still
  resolves "0 rows affected" — the same line both sibling paths draw.

  `@objectstack/runtime`: the sandbox error passthrough now also carries `status`
  alongside `code` and `fields`, so an error that names its own HTTP status keeps
  it across the QuickJS boundary. Without it the action surface answered the right
  diagnosis at the wrong status (`{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`);
  `domains/actions.ts` already honoured `.status` first — the number simply never
  arrived. A permission refusal thrown inside a body likewise keeps its 403 now
  instead of flattening to 400.

- 2af1988: fix(formula,spec,core): the RLS write-side `check` evaluator honours calendar-day upper bounds (ADR-0053 D-D)

  `@objectstack/formula`'s `matchesFilterCondition` — the evaluator behind RLS
  write-side `check` policies (ADR-0058 D4) — compared a bare `YYYY-MM-DD` `$lte`
  bound literally. On a `datetime` post-image that meant a policy of the shape
  `{ signed_on: { $lte: '{today}' } }` **denied every write made after 00:00**:
  the write-side twin of the read-side data loss #3777 fixed, and the last of the
  platform's filter backends that disagreed about what a bare day means as a
  bound.

  `$lte` and a `$between` max now evaluate half-open against the next calendar
  day, matching the SQL compiler, the memory and mongo drivers, and the analytics
  preview evaluator. Unchanged, per the same semantics table: full-ISO bounds keep
  exact-instant semantics, `$gte`/`$gt`/`$lt` keep their midnight anchoring, and a
  plain `YYYY-MM-DD` value compares identically (string ordering makes the two
  forms equivalent). The evaluator stays fail-closed on a null bound.

  **Where the rule now lives.** `nextUtcCalendarDay` moved from
  `@objectstack/core` to `@objectstack/spec/data` — beside `date-macros.zod.ts`,
  whose vocabulary it interprets. `formula` cannot depend on `core`, and a second
  copy of the rule is exactly the divergence #3777 catalogued; `spec` is the one
  package all six consumers already depend on, so this adds no dependency edge.

  No import changes are required: `@objectstack/core` re-exports the symbol, so
  existing `import { nextUtcCalendarDay } from '@objectstack/core'` keeps working.
  New code should prefer `@objectstack/spec/data`.

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

- b746aa0: fix(service-automation): connector 物化失败的软路径改用结构化 `meta`;顺带修好 `ObjectLogger.error` 丢弃契约第三参的缺陷 (#5575)

  ## service-automation:`fail(msg, cause)`

  `reconcileDeclaredConnectors` 的报错器有两条路径(ADR-0097):冷启动 `throw`(fatal),
  `metadata:reloaded` 之后 —— Studio publish、`os dev` 重编译 —— 记日志并让旧 connector
  继续服务(soft)。其中两个调用点把**外来**的 `err.message` 插进那条日志 message:
  `resolveInstanceAuth` 失败处,以及 provider factory 抛错处。这两个 message 都不是我们
  自己的:credential resolver 由宿主提供
  (`AutomationServicePluginOptions.credentialResolver`),provider factory 更是 ADR-0097
  明确鼓励第三方去写的代码 —— 第一个用严格 Zod schema 校验 `providerConfig` 的 factory
  抛出的就是 `ZodError`,它的 `.message` 是 issue 数组的多行 JSON dump,第一行是一个 `[`。

  `ObjectLogger` 每次调用只写一条 `<ts> <LEVEL> <msg>` 记录,带换行的 message 会溢出到
  不带等级头的后续物理行,于是运行时 stderr 的每一个按行工作的消费者 —— 文件 sink、
  `docker logs`/journald 送进日志采集、一次 `grep ERROR` —— 都会把那些续行读成无法归属的
  垃圾记录:一条诊断散成 N 个碎片。与 #5048 在 flow 绑定接缝上是同一类,也是同一条 #4632
  原则:被搅烂的诊断比没有诊断更贵。

  改法与 PR #5572 同源:`fail(msg, cause?)` —— message 是不含换行的自足句子,cause 按路径
  分别渲染。soft 路径把 cause 交给 logger 的**结构化 meta**(`issues[]` / `error`);fatal
  路径把 cause 文本接在抛出的 message 后面(`… cause: <text>`),因为 throw 不是日志记录,
  内核失败通道原样打印,多行 ZodError dump 在终端里本来就好读 —— 同一个 cause,两种受众,
  刻意不共用一种形状。`#5048` 引入的内部模块随之从 `flow-bind-diagnostics.ts` 更名为
  `thrown-cause-diagnostics.ts`(`describeThrownForLog`),因为它从来不是 flow 专属的:
  主题是日志管线,不是 metadata 类型。被拒键名仍放在 `unrecognized` 而不是 Zod 原本的
  `keys`(`ObjectLogger` 的脱敏表按子串匹配,`keys` 含 `key`)。

  **一处订正**:#5575 的 issue 正文把此处的危害归给了 `serve` 的启动诊断缓冲
  (`BootLogCapture`)。那个缓冲看不到这条路径 —— `ObjectLogger` 把 `warn` 送 stdout(启动
  静默窗口只包了 `process.stdout.write`),`error`/`fatal` 送 **stderr**,而且 soft 路径在
  `metadata:reloaded` 之后才跑,窗口早已恢复。危害是上面那串按行消费者,以及日志查询根本
  无法按字段过滤;机制写进了模块文档,连同 `warn`/`error` 下游不同这件事本身。

  ## core:`ObjectLogger.error`/`fatal` 兑现契约声明的 `meta`

  `Logger` 契约声明 `error(message, error?: Error, meta?)`。`ObjectLogger` 按形状分派,
  所以 meta 也允许出现在 `error` 位 —— 这份宽容没问题;**丢掉一个自己声明的参数**有问题:
  `error === undefined` 时旧代码走 `write(level, message, errorOrMeta)`,第三个参数从未被
  读取。于是每一个按契约书写的 `logger.error(msg, undefined, { … })` 都只输出一条裸 message,
  事实全部静默消失 —— `metadata`、`metadata-protocol`、`client`、`core/security` 里约 15 处
  调用点今天就是这样(其中 `metadata/src/endpoint-matcher.ts` 送的正是一个 Zod issue 数组)。
  契约的另外两个实现(`@objectstack/observability` 的 `ConsoleLogger`/`JsonLogger`)都老老实实
  用了这个位置,所以是契约对、这一个实现错:declared ≠ enforced。

  三种形状现在都被兑现,两个位置同时带值时以更靠后的 `meta` 为准。这一处修好之后,上述
  调用点的诊断自动恢复(`client` 的 `HTTP request failed` 记录重新带上
  `{method, url, status, error}`)。connector 接缝改用契约的第三参而非第二参,是刻意的:
  把原始 error 塞进第二位会让每条记录都附带完整堆栈,ZodError 还会附带整段多行 dump ——
  正是我们要消灭的无界形状。

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

- b127c8b: fix(spec,core): a filter placeholder is recognised by INTENT — `{TODAY()}` refuses loudly instead of comparing as a literal (#5586)

  `UnknownFilterTokenError` had a hole exactly where authors fall in. Recognition
  used the token-NAME grammar `/^\$?\{([a-zA-Z0-9_]+)\}$/`, so any placeholder
  carrying a **non-word character** classified as "not a placeholder at all" and
  was handed to the driver verbatim, to be compared as a literal string — the
  silent-wrong-result failure the diagnostic exists to abolish.

  The failure was inverted against the author. Measured on 17.0.0-rc.2 against a
  four-row fixture:

  | filter value             | before                           |                                                                                                                            |
  | ------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `due_date < '{today}'`   | 2 rows                           | correct — the two overdue rows                                                                                             |
  | `due_date < '{TODAY}'`   | throws `UnknownFilterTokenError` | diagnostic working                                                                                                         |
  | `due_date < '{TODAY()}'` | **4 rows**                       | diagnostic bypassed — literal string compare, and `'2026-…' < '{'` in lexicographic order swallowed a row due a week later |

  So misspelling `{today}` as `{TODAY}` was reported by name, while misspelling it
  as `{TODAY()}` returned the wrong rows in silence — and the parenthesised,
  kebab-case, natural-language and dotted spellings (`{TODAY()}`,
  `{current-user-id}`, `{30 days ago}`, `{user.id}`) are precisely what an author
  migrating from another system's macro syntax writes first.

  **Both directions of the behaviour change:**

  - **Previously silent, now refuses loudly** — a filter value that is entirely
    brace-wrapped and outside the vocabulary now throws `UnknownFilterTokenError`
    (`code: FILTER_TOKEN_UNKNOWN`, `status: 400`) on the ObjectQL read and write
    paths and the analytics dataset executor, and is reported as
    `filter-token-unknown` by `objectstack build` / `validate` / `lint`. Before,
    it reached the data engine and compared as text.
  - **Unchanged** — `{today}` / `{current_user_id}` still resolve; `{TODAY}` still
    refuses with the same identity; a value that merely _contains_ braces
    (`'acme {x} deal'`), or is not ONE pair around the whole value (`{a}{b}`,
    `{{x}}`, `{}`), is still an ordinary literal and still reaches the driver
    untouched.

  Recognition and vocabulary are now two named grammars rather than one:
  `FILTER_TOKEN_WRAPPED_RE` (`/^\$?\{([^{}]+)\}$/`) answers "did the author mean a
  placeholder", and `isContextToken` / `isDateMacroToken` answer "is it in the
  vocabulary". Wide in, strict out. No escape hatch for a literal `{…}` comparand
  ships with this: a repo-wide measurement across structured metadata, examples,
  seed data and fixtures found zero legitimate consumers comparing a
  brace-wrapped literal, and an escape syntax is a public micro-contract that can
  be added the day one shows up.

  Flow templates are unaffected. `interpolateFilter` in
  `@objectstack/service-automation` already recognised the same wide shape and
  resolves `{record.id}` / `{TODAY() + 30}` from flow variables **before** the
  filter reaches ObjectQL; its hand-off to the engine is keyed on the token
  vocabulary (`isKnownFilterToken`), which this change does not touch.

- eb3e650: fix(core): 健康检查的超时守卫在 race 落定时被清除,周期性检查不再堆积孤儿定时器 (#4875)

  `PluginHealthMonitor.performHealthCheck()` 里那条 race 的守卫由 `timeout()` armed 之后就被
  扔掉:插件的 `checkMethod` 赢下 race 之后,那根 `setTimeout` 既没 `clearTimeout` 也没
  `unref()`,带着 ref 一直挂满整个 `config.timeout`。这与 #4813 修掉的两处(内核 init/start
  守卫,PR #4874)是同一种漏法。

  差别在于**健康检查是周期性的**:内核那两处是启动时一次性的固定份额(4 个插件 = 8 根),这里
  则是**每个插件每一轮各留一根**,`interval` 越密、`timeout` 越长,堆得越高 —— 一个
  `interval: 30s` / `timeout: 5s` 的插件在任意时刻都挂着若干根本该在毫秒级就回收的定时器。
  今天这条还没发作,只是因为 `startMonitoring()` 目前没有被内核启动流程调用;一旦健康监控被接进
  宿主,它就是 #4813 的放大版。

  修法与 #4874 同形:`timeout()` 换成私有 helper `raceCheckTimeout()`,`try { await
Promise.race(...) } finally { clearTimeout(guard) }`。

  **为什么是 `clearTimeout` 而不是 `unref()`。** `unref()` 让定时器不再钉住事件循环的同时,
  也让它不再是一个守卫 —— 若检查永不 settle 且没有别的东西撑着事件循环,Node 会在定时器触发
  之前退出,超时被静默吞掉。守卫必须在 race 未决期间保持 ref'd、在落定那一刻被回收,这正是
  `finally { clearTimeout(guard) }` 表达的语义。回归测试因此是三条:守卫赢不了时不留 ref'd
  定时器、连跑多轮不累积(fake timers 下计数,能识破 `unref()` 式的假修复)、以及检查真的挂住时
  超时照常上报。

  超时时长(`config.timeout`)一个都没动 —— 问题从来不在时长,而在没人回收。

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

- d6d1a50: refactor(core): one implementation per hook-dispatch flavour, plus a paired-pin gate (#5282)

  `ObjectKernel` does not extend `ObjectKernelBase` — it is a standalone
  production kernel with its own `hooks` map, and only `LiteKernel` extends the
  base. Lifecycle-hook dispatch therefore existed **twice**, with no shared code
  path: the base's `triggerHook` (isolating) / `triggerHookOrThrow` (propagating) /
  `context.trigger` on one side, and `ObjectKernel`'s private
  `triggerShutdownHookIsolating` / `context.trigger` on the other. The two
  isolating loops printed the same `Hook handler failed: kernel:shutdown` line
  because someone typed it twice.

  That seam produced three consecutive bugs, each the same shape — one hook name
  meaning opposite things on the two kernels: `kernel:ready` (#5170),
  `kernel:bootstrapped` / `kernel:listening` (#5257, where a swallowed
  `server.listen()` failure let a process print "✅ Bootstrap complete" with
  nothing listening), and `kernel:shutdown` in the other direction (#5274, where
  one bad handler skipped every `destroy()`).

  **No behaviour change.** The two dispatch flavours move verbatim into an
  internal module, `packages/core/src/hook-dispatch.ts`, which both kernels now
  call:

  - `dispatchHookIsolating` — a failing handler is logged as
    `Hook handler failed: <name>` and the remaining handlers still run.
  - `dispatchHookPropagating` — the first failure escapes unwrapped and the
    handlers behind it are skipped.

  Every call path keeps the flavour, the log wording and the trace line it had
  before, including the one asymmetry inside the propagating flavour:
  `PluginContext.trigger` has never emitted the `Triggering hook: <name>` trace on
  either kernel, so it still does not. The kernels' two `hooks` maps are
  deliberately **not** unified, and `ObjectKernel` deliberately does **not** gain a
  base class — both were considered and ruled out of scope.

  How "no behaviour change" was proved: the paired kernel pins from #5170 / #5257 /
  #5274 pass untouched, and deleting the shared dispatcher's error log now turns
  **both** kernels' test files red from a single edit — a property the hand-mirrored
  copies could not have (editing `ObjectKernel`'s private loop could never turn
  `lite-kernel.test.ts` red).

  Shared dispatch cannot cover the residual two-maps seam, so the pairing of the
  tests is now a gate rather than a convention: `pnpm check:kernel-hook-pairs`
  (`scripts/check-kernel-hook-pairs.mjs`, wired into the ESLint job) requires every
  `kernel:*` hook dispatched in `packages/core/src` to be named in a test title in
  **both** `kernel.test.ts` and `lite-kernel.test.ts`, and fails naming the hook
  and the side that lacks it. A fifth lifecycle hook can no longer arrive paired on
  one kernel only.

  Also pinned, deliberately unchanged: `kernel:shutdown` has two dispatch paths
  with different flavours on both kernels — the kernel's own teardown isolates,
  while a plugin calling `ctx.trigger('kernel:shutdown')` by hand propagates.
  Nothing in the repo triggers it by hand today, so this is dormant; it is now a
  documented fact with a named test on each side rather than a surprise found at
  teardown.

- 674ac99: fix(core): one throwing `kernel:shutdown` handler no longer skips every plugin `destroy()` and kills the process under a false "Shutdown timed out" (#5274)

  **On `ObjectKernel`, a single bad shutdown subscriber used to end the entire teardown
  and `process.exit(1)` the host — reporting a timeout that never happened.**

  `performShutdown()` dispatched `kernel:shutdown` through `context.trigger` (a bare
  awaited loop that never catches), so the first handler that threw propagated out to
  `shutdown()`'s `Promise.race` catch. That catch was written for the timeout race alone
  and treated every exception as one, producing three consequences at once:

  1. the remaining `kernel:shutdown` handlers never ran;
  2. **every** plugin's `destroy()` was skipped — the reverse-order destroy pass sits
     after the trigger in `performShutdown()`, so it was never reached;
  3. the process was killed by `process.exit(1)` under the log line
     `Shutdown timed out — forcing exit`, while nothing had timed out — sending whoever
     read it to the `shutdownTimeout` config for a handler bug.

  Two changes, matching the reasoning #5257 recorded at `LiteKernel`'s shutdown dispatch
  site:

  - **`kernel:shutdown` now dispatches ISOLATING on `ObjectKernel` too.** A handler that
    throws is logged as `Hook handler failed: kernel:shutdown` and the remaining handlers
    still run, followed by the reverse-order `destroy()` pass and the `onShutdown()`
    handlers — both of which already isolated per plugin and per handler. What is queued
    behind a failing shutdown handler is the cleanup that flushes buffers, closes
    connections and releases locks, so one bad handler must not amplify into leaks and
    unflushed writes. The BOOT-path hooks are untouched: `kernel:ready`,
    `kernel:bootstrapped` and `kernel:listening` still propagate and still fail the boot
    (#5170, #5257).
  - **The timeout catch now handles only a genuine timeout**, discriminated by identity on
    the timer's own rejection — not by message, not by type, so nothing a plugin throws
    can impersonate it. A genuine `shutdownTimeout` overrun is **unchanged**: it still
    logs `Shutdown timed out — forcing exit` and still calls `process.exit(1)`, because
    teardown really is hung and the process would otherwise hold what it failed to
    release. Any other exception is logged at `error` and follows the normal path —
    `state = 'stopped'`, return — with no `process.exit`, leaving an embedding host
    (cloud auth-proxy, CLI, a test runner) its own chance to finish cleanly.

  `shutdown()` still never rejects, so no existing caller changes. Telling the two paths
  apart is the point of the fix, and both are pinned by named tests.

- 833b512: fix(core): 插件 init/start 的超时守卫定时器在 race 结束时被清除,进程不再空转 `startupTimeout` (#4813)

  `ObjectKernel.initPluginWithTimeout()` / `startPluginWithTimeout()` 各自 `setTimeout` armed
  一根超时守卫,然后**把它扔了**:插件赢下 race 之后,那根定时器既没 `clearTimeout` 也没
  `unref()`,带着 ref 一直挂到 `startupTimeout` 走完。于是每个进程在活干完之后还要空转整整
  一个 `startupTimeout` —— `ObjectQLPlugin` 是 120 秒。

  实测(`examples/app-crm`,同一条 `migrate recorded-by --json`,同一个构建链,唯一差别是本
  改动):

  |        | 墙钟   |
  | :----- | :----- |
  | 修复前 | 122.4s |
  | 修复后 | 3.1s   |

  JSON 与 `✅ Graceful shutdown complete` 两次都在 ~3 秒出现 —— 后面那 119 秒纯粹是 8 根
  孤儿定时器(4 个 init + 4 个 start)钉着事件循环。`os serve` 里同样漏,只是那里进程本来
  就长命,看不出来。

  **为什么是 `clearTimeout` 而不是 `unref()`。** 隔壁 `shutdown()` 的守卫用的是 `unref()`,
  但那个写法在这里是错的,而且不是风格问题:`unref()` 让定时器不再钉住事件循环,**同时也
  让它不再是一个守卫** —— 若 hook 永不 settle 且没有别的东西撑着事件循环,Node 会在定时器
  触发之前直接退出,超时被**静默吞掉**,谁也不会收到那个 error。守卫必须在 race 未决期间
  保持 ref'd,在 race 落定的那一刻被回收,这正是 `finally { clearTimeout(guard) }` 表达的
  语义。两个守卫合并为一个私有 helper `raceStartupTimeout()`,措辞与理由写在它的 doc
  comment 里。

  `startupTimeout` 的取值一个都没动 —— 慢启动的插件需要那个上限,问题从来不在时长,而在
  没人回收。

- 7777e8f: fix(spec)!: retire the never-built typed-event system; the lifecycle registry now lists the events that actually fire (#4212 follow-up)

  The lifecycle-event surface promised a typed-event system that was never
  built, in three layers. `kernel/plugin-lifecycle-events.zod.ts` shipped ten
  payload schemas (`PluginRegisteredEvent`, `PluginErrorEvent`,
  `HookTriggeredEvent`, `KernelReadyEvent`, …) and a 21-name
  `PluginLifecycleEventType` enum — zero consumers for every export, and the
  enum was wrong in both directions: 17 names nothing fires, 10 real events
  missing. `contracts/plugin-lifecycle-events.ts` declared the same 17 dead
  names in `IPluginLifecycleEvents` next to 5 real ones, plus an
  `ITypedEventEmitter` interface nothing implements. All of it read as a
  promise; anyone who coded against it (hooking `plugin:started`, awaiting
  `plugin:error`) registered a handler that could never fire, with no error
  saying so — the same silent-drop shape as the #4212 lifecycle-hook family.

  Removed, with zero consumers verified repo-wide:

  - `kernel/plugin-lifecycle-events.zod.ts` and every export: `EventPhase`,
    `PluginEventBase`, `PluginRegisteredEvent`, `PluginLifecyclePhaseEvent`,
    `PluginErrorEvent`, `ServiceRegisteredEvent`, `ServiceUnregisteredEvent`,
    `HookRegisteredEvent`, `HookTriggeredEvent`, `KernelEventBase`,
    `KernelReadyEvent`, `KernelShutdownEvent`, `PluginLifecycleEventType`
    (schemas and inferred types).
  - `ITypedEventEmitter` from `contracts/plugin-lifecycle-events.ts`.
  - The 17 never-fired names from `IPluginLifecycleEvents`.

  `IPluginLifecycleEvents` is now the registry of the **14 events with a real
  emitter** — `kernel:{ready,bootstrapped,listening,shutdown}`, `app:seeded`,
  `metadata:reloaded` (payload `metadata` now optional, matching the documented
  contract), `external.schema.drift`, `ai:routes`, `auth:configure`, and the
  `{service}:ready` convention family (`mcp`, `automation`, `analytics`,
  `external-datasource`, `datasource-admin`) — each payload as observed at its
  fire site. A new `LifecycleEventName` union types
  `PluginContext.hook`/`trigger` in `@objectstack/core` as
  `LifecycleEventName | (string & {})`: known names autocomplete, custom
  cross-plugin names stay legal, existing callers compile unchanged. A pinning
  test asserts two-way equality between the interface keys and the fire-site
  inventory.

  FROM → TO:

  - `PluginLifecycleEventType` → `LifecycleEventName` (the union of names that
    fire). There is no runtime enum; the bus is open by design.
  - Event payload schemas (`KernelReadyEvent`, `PluginErrorEvent`, …) → the
    payload tuples on `IPluginLifecycleEvents`. No wire format existed or
    exists; payloads are in-process arguments.
  - `ITypedEventEmitter` → `PluginContext.hook`/`trigger` (the emitter that
    actually exists).
  - Handlers for the 17 dead names → delete them; they never ran. For plugin
    phase observation use the boot report (ADR-0084); for per-plugin errors the
    kernel throws/logs at the failing phase.

  Plain deletion rather than `retiredKey()` tombstones, per the #4233
  precedent: these keys were never authorable — they described runtime event
  payload records no config author can write, so the silent-strip class the
  authorable-surface ratchet guards against is vacuous. Its baseline entries
  and the `json-schema.manifest.json` keys are dropped deliberately in this PR.
  No ADR-0087 conversion: no stack metadata names these types; there is nothing
  for `os migrate meta` to rewrite.

- 46365ab: fix(core): `ObjectLogger` 的脱敏表按**词边界**匹配,不再按子串吃掉 `keys`/`tokens` 这类普通字段 (#5573)

  `redactSensitive` 此前的判定是 `key.toLowerCase().includes(pattern)` —— 只要字段名
  **含有** `password`/`token`/`secret`/`key` 子串,整个值就被换成 `***REDACTED***`。
  于是 `keys`、`keyword`、`keywords`、`keyboard`、`monkey`、`tokens`、`tokenizer`、
  `secretary` 全部中招:读者不但丢了事实,还被告知"这里挡住了一个秘密",比字段直接
  缺失更误导。仓库里已经有活的命中 —— `dispatcher-plugin.ts` 为了躲开脱敏器特意把
  `key` 改名成 `keyedBy`,而 `'keyedby'.includes('key')` 依然为真,那条限流日志的
  `keyedBy` 一直是 `***REDACTED***`。

  匹配语义 FROM → TO:

  |                                                        | FROM(子串 `includes`) | TO(词边界)           |
  | :----------------------------------------------------- | :-------------------- | :------------------- |
  | `apiKey` / `api_key` / `API_KEY` / `x-api-key`         | 脱敏                  | 脱敏(不变)           |
  | `apikey` / `APIKEY`(全小写连写)                        | 脱敏                  | 脱敏(不变,见下)      |
  | `apiKeys` / `refresh_tokens`(复合词里的复数)           | 脱敏                  | 脱敏(不变)           |
  | `keys` / `tokens` / `keyword` / `monkey` / `secretary` | **脱敏**              | **不脱敏**           |
  | `keyedBy` / `tokenizerName`                            | **脱敏**              | **不脱敏**           |
  | `passwords` / `secrets`(裸复数)                        | **脱敏**              | **不脱敏**           |
  | `api_key` 字段 + `redact: ['apiKey']` 配置             | **不脱敏**            | **脱敏**(跨拼法命中) |

  字段名按 camelCase / snake_case / kebab-case / 字母-数字边界分词后逐词比对。默认脱敏表
  (`['password','token','secret','key']`)本身**没有变**,`packages/spec` 的 schema 默认值
  也没有变 —— 变的只是这张表怎么用。

  两个边角是显式取舍,不是遗漏:

  - **全小写连写**没有词边界可分,`apikey` 分词后只有一个词。不能用"以 `key` 结尾"救,
    因为 `monkey`/`turkey`/`whiskey` 也以它结尾 —— 那正是本单要去掉的误报。所以连写只在
    前缀是一张显式限定词表(`api`/`access`/`refresh`/`client`/`private`/`session`/…)里的
    词时才算命中;表外的连写(`foobarkey`)不脱敏,按仓库命名惯例写成 `fooBarKey` /
    `foo_bar_key` 即可通用命中。只认**后缀**连写,所以 `secretary`、`keyword` 保持干净。
  - **裸复数**是集合或计数而不是秘密(`keys` 来自 Zod 的 `unrecognized_keys` issue,
    `tokens` 来自 LLM 用量),按维护者裁决不脱敏;复数**出现在复合词里**时仍然是秘密
    (`apiKeys: ['sk-…']`),照常脱敏。确实要脱敏裸复数的 host,写
    `redact: [..., 'passwords']` 显式加回。

  **影响面**:host 侧自定义 `redact` 配置的匹配行为随之收紧 —— 依赖子串宽匹配"顺手"挡住
  某个字段的部署,需要把该字段名(或它的词)显式写进 `redact`。反向的收益是同一个词现在
  跨拼法命中:配 `redact: ['apiKey']` 也会挡住 `api_key` 和 `apikey`。

- c5adfe1: fix: 节点执行与热重载 shutdown 的超时守卫在 race 落定时被清除,不再留下孤儿定时器 (#4952)

  #4813(PR #4874,内核 init/start)与 #4875(PR #4950,周期性健康检查)修掉的是同一种漏法:
  守卫 armed 之后就被扔掉 —— 被守护的一方赢下 race 之后,那根 `setTimeout` 既没 `clearTimeout`
  也没 `unref()`,带着 ref 一直把事件循环钉满整个超时预算。本次清仓剩下的两处生产实例:

  - **`AutomationEngine.executeWithTimeout()`**(`service-automation`)—— 三处里量级最大的一处:
    **每个声明了 `timeoutMs` 的流程节点各一根**,孤儿数随流程节点数 × 触发频率线性增长;一次性进程
    (`os` CLI 跑到 flow 的路径)干完活之后还会被最长的那根守卫按住到超时才退出。
  - **`HotReloadManager.reloadPlugin()`**(`core`)—— 插件 `destroy()` 的 shutdown 守卫,与 #4813
    修掉的两处一字不差:一次毫秒级完成的热重载,照样把循环钉满 `shutdownTimeout`。

  两处修法与 #4874 / #4950 同形,不新造变体:私有 helper +
  `try { return await Promise.race([...]) } finally { clearTimeout(guard) }`。`hot-reload.ts` 的
  helper 把入参放宽到 `T | PromiseLike<T>`(Plugin 契约允许同步 `destroy()`);`engine.ts` 的不放宽
  (`NodeExecutor.execute` 声明返回 `Promise`)。

  **为什么是 `clearTimeout` 而不是 `unref()`。** `unref()` 让定时器不再钉住事件循环的同时,也让它
  不再是一个守卫 —— 若被守护的一方永不 settle 且没有别的东西撑着事件循环,Node 会在定时器触发之前
  退出,超时被静默吞掉。守卫必须在 race 未决期间保持 ref'd、在落定那一刻被回收,这正是
  `finally { clearTimeout(guard) }` 表达的语义。两处的回归测试各自沿用 #4950 的双向写法:
  真实定时器下不留 ref'd 定时器、fake timers 下连跑多轮不累积(计数能看见 `unref()` 过的定时器,
  因此识破 `unref()` 式的假修复)、以及被守护方真的挂住时超时照常上报。

  超时时长(`timeoutMs` / `shutdownTimeout`)一个都没动 —— 问题从来不在时长,而在没人回收。

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

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

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

- 06770c0: fix(core,cli): `os test`'s record action types reach the served route, and a zero-match glob states its posture (#7848)

  Two defects on the same surface, both measured on a booted showcase while
  authoring the `qa` platform-checklist item.

  ## 5 of the 8 declared action types could not reach a stock server

  `HttpTestAdapter` built `${baseUrl}/api/data/:object`. A stock server serves
  `{apiPath}/data/:object` with `apiPath` = `/api/v1`, so every record-shaped
  member of `TestActionTypeSchema` was one version segment short and answered
  `HTTP Error 404: {"error":"Not found"}` — `create_record`, `read_record`,
  `update_record`, `delete_record` and `query_records`. `update_record` was wrong
  twice: it issued `PUT` where the route is `PATCH`, and there is no `PUT`
  sibling to fall back on. Only `api_call` and `wait` executed, which is why the
  gap survived — everything the Quality Protocol had been used for so far was
  expressible through `api_call`.

  All five now address the route the server registers, and `update_record` uses
  `PATCH` with `id` peeled off the body (the body is the field patch, not a
  column write). The prefix is no longer written down: it is derived from the two
  schemas `RestServer` itself resolves from — `RestApiConfigSchema`
  (`apiPath ?? {basePath}/{version}`) and `CrudEndpointsConfigSchema.dataPrefix`
  — so the adapter's default cannot drift from the declaration again. Defaults
  only: a deployment that overrides `api.apiPath` or `crud.dataPrefix` is still
  out of reach for the record action types, and `api_call` remains the escape
  hatch there.

  `run_script` still has no adapter branch and still throws by name; nothing here
  implements it.

  ## A run that loaded no suite reported success silently

  `os test 'qa/nothing-matches-*.test.json'` exited **0** after executing nothing,
  so a CI step whose glob stopped matching (a renamed directory, a moved suite)
  reported success forever.

  The default exit status is deliberately unchanged — a repository that
  legitimately ships no suites must not begin failing CI. What changes is that the
  posture is now **declared** rather than accidental:

  - `os test --help` states it: a pattern matching no suite prints
    `Found 0 test suites.` and exits 0;
  - **new flag `--fail-on-empty`** opts into the strict reading and exits 1 on an
    empty match;
  - `Found N test suites.` is emitted on **every** run, `Found 0 test suites.`
    included. It was previously printed only when the count was positive — absent
    from exactly the run where a caller needs it to tell "every suite passed" from
    "there were no suites".

  Both exit-code arms now carry explicit assertions over a real child process.

- 857a6cf: fix(cli,core,metadata,runtime): `os serve` boots with no compiled artifact — the platform does not need an application to start (#4085)

  The artifact (`dist/objectstack.json`) defines an **application**. ObjectStack is
  a development platform, so it has to start without one — but `os serve
objectstack.config.ts` died during boot whenever the artifact was absent:

  ```
    Loading objectstack.config.ts...
  [StandaloneStack] artifact read FAILED: path='…/dist/objectstack.json' error=ENOENT…

    ✗ Service 'manifest' is async - use await
  ```

  Exit 1 — on a **known-good app** (`examples/app-todo` fails the same way with
  only its `dist/objectstack.json` moved aside), and on every freshly authored
  project between `os init` and its first `os compile`. The message named neither
  the missing artifact nor a fix, so it read as an internal kernel fault.

  Three separate faults, each of which alone was enough to refuse the boot:

  - **`serve` registered the config-derived `AppPlugin` before the stack's own
    `plugins[]`.** Registration order _is_ the kernel's init/start order, and that
    slot sits ahead of `ObjectQLPlugin` (which registers `manifest`/`objectql`) and
    `DefaultDatasourcePlugin` (which connects the database the app seeds through).
    The wrap is now **appended** to `plugins[]`, the same slot
    `createStandaloneStack` gives its artifact-derived `AppPlugin` — so config-boot
    and artifact-boot share one plugin order. The artifact path never hit this,
    which is exactly what made a plugin-**order** bug look artifact-related.

  - **`ctx.getService()` reported a never-registered service as "is async".**
    `PluginLoader.getService` is an `async` method, so its return value is _always_
    a Promise and its internal "not found" rejection can never surface
    synchronously — the kernel read the answer off that Promise and told every
    caller to `await` a service that did not exist, while the `not found` branch
    below it was unreachable. It now decides from the registry: absent ⇒
    `[Kernel] Service 'x' not found`, registered-but-uninstantiated ⇒ the unchanged
    `Service 'x' is async - use await`. The same crash now reads
    `[Kernel] Service 'manifest' not found`, which points at the layer that is
    actually wrong.

  - **`MetadataPlugin` treated an absent `local-file` artifact as fatal.**
    `createStandaloneStack` always points it at `dist/objectstack.json`, so a stack
    with no app at all could not boot. A **missing** local artifact is now "nothing
    compiled yet": it logs, starts empty, and leaves the artifact watcher armed, so
    a later `os compile` hydrates the running server. The tolerance is
    ENOENT-only — a malformed or unreadable artifact stays fatal — and
    `bootstrap: 'artifact-only'` (sealed runtime, where the artifact _is_ the
    deployment) keeps failing loudly rather than silently serving an empty runtime.

  `[StandaloneStack] artifact read FAILED … ENOENT` is likewise no longer shouted
  at callers for whom "no artifact" is a healthy state; a present-but-unusable
  artifact keeps the loud warning.

  Pinned by an e2e pair that drives the real `os serve` with **no `os compile`
  anywhere**: an app defined only by `objectstack.config.ts` (asserting its object
  is in the started plugin set, not merely that boot survived) and a bare
  `export default {}` platform. The #4012 fixture drops the `os compile` this bug
  had forced on it.

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

- ee264b2: fix(rest): refuse an unknown `?status` on `/security/suggested-bindings` instead of answering an empty list (#7678)

  `GET /api/v1/security/suggested-bindings?status=garbage` returned **200 with an
  empty list**. That is worse than an error: an empty list is a plausible,
  actionable-looking answer, so the response reads as _"there are no suggestions"_
  rather than _"your filter was not a status"_. An admin checking whether a package
  still has pending audience-binding suggestions got a clean, wrong all-clear.

  The route (`registerSecurityEndpoints`) forwarded `req.query.status` straight into
  `listAudienceBindingSuggestions`, whose contract — `AudienceBindingSuggestionFilter`
  — declares exactly three values (`pending`, `confirmed`, `dismissed`). Anything
  else was not an injection (the `where` clause is structured, never interpolated),
  it simply matched no row.

  **The rule already existed; only one of its two seams had it.** The runtime
  dispatcher's `/security` domain has refused unknown statuses since the filter was
  first tightened, carrying a comment describing precisely the empty-list arm above.
  The live REST route is a second seam onto the same service call and never got it —
  a dispatcher-vs-REST divergence pointing the opposite way from the earlier `/meta`
  cases, where routes existed on the dispatcher but were never mounted on REST.

  So this is a **convergence, not a second implementation**. The vocabulary, the
  predicate and the refusal wording move to `@objectstack/core`'s security barrel
  (`isAudienceBindingSuggestionStatus`, alongside `shouldDenyAnonymous` and the other
  decisions shared by every HTTP seam), and both callers import it. The accepted
  values stay keyed _by_ the contract type, so adding a status to
  `AudienceBindingSuggestionFilter` leaves a key missing and fails to compile rather
  than silently drifting.

  An unknown `?status` is now refused with **400** and the ADR-0112 envelope
  (`{ error: { code: 'VALIDATION_ERROR', message } }`) — matching the repeated-query-
  parameter guard already on this route — and the service is not called at all. The
  vocabulary is case-sensitive, so `?status=PENDING` is refused like any other
  non-status.

  Unchanged: every declared status still returns its list, omitting `?status`
  entirely still returns the unfiltered list, `?packageId` is untouched, and the
  dispatcher seam answers exactly as it did before.

- 3556b67: fix(security): the MCP stdio bridge stops echoing `internal: true` columns from a write, and the write-response guarantee is guarded as a PROPERTY rather than per-class (#8497)

  **A live leak, found by widening a guard.** #7823 relocated the `internal: true`
  write-response strip to the generic-data-path ingress and gated the relocation on
  a tripwire that enumerates every `*Data` face on the protocol class. The card that
  produced this change observed that the guard's coverage — *"every `*Data`face on
one class"* — is narrower than the property that needs holding — *"no response body
an external caller receives from a write carries an`internal: true`value"* — and
that`@objectstack/rest`'s cross-object batch (a direct `ql.update`) was the
  standing proof the two are not the same set.

  Widening the guard to the property immediately found a second direct mouth that
  was **not** covered, and it was leaking. `@objectstack/mcp`'s stdio bridge
  (`stdio-data-bridge.ts`) is engine-only by construction — the long-lived stdio
  host cannot reuse the runtime's request-shaped `callData` builder — and its
  `create` arm handed `engine.insert`'s result straight back to the MCP caller.
  Since #7823 the engine deliberately keeps its write results whole, so the flagged
  column rode the tool response verbatim. Measured before the fix:

  ```
  {"object":"vault","id":"r1","record":{"name":"row","id":"r1","vault_secret":"<the stored secret>"}}
  ```

  The file's own header had listed its protocol-layer divergences as _"deliberate,
  filed, not security"_. One limb of that list **was** security, and the header now
  says so.

  **What changed**

  - `@objectstack/mcp` — the stdio bridge's `create` runs its response record
    through the shared strip. `update` does too: that arm discards the engine's
    write result and echoes the read-path row plus the caller's own patch, so no
    _stored_ value could reach it, but a caller who puts an `internal: true` key in
    `data` would otherwise get it echoed back — their own bytes used as an oracle
    for a column the flag says is never returned. Read verbs are untouched (the
    engine's read-path strip is unchanged).
  - `@objectstack/core` — the strip helper
    (`omitInternalFieldsFromWriteResponse` / `collectInternalWriteResponseFields`)
    moved here from `@objectstack/metadata-protocol`. It shipped beside the protocol
    class when that class was its only caller, but the generic write mouths are not
    all on it: `rest` and `mcp` both reach the engine directly and **neither depends
    on `@objectstack/metadata-protocol`**, so the old home forced each new mouth to
    choose between a duck-typed reach through a protocol instance and a private
    restatement of a security-relevant rule. `core` is the floor all three already
    depend on, and already hosts this class of shared write-path helper
    (`bulk-write.ts`). No behaviour change and no API change:
    `@objectstack/metadata-protocol` re-exports both names unchanged.

  **What guards it now.** Two new tripwires join the shipped one — which is **not**
  replaced: its runtime prototype walk and its `leakyData` negative control are
  untouched. Each is a runtime enumeration no author can dodge by adding code
  without touching it, and each fails on a surface it has no disposition for:

  - `metadata-protocol` — walks the protocol class for `*Data` faces (unchanged);
  - `rest` — walks `RestServer.getRoutes()` for HTTP write routes, drives the ten
    data-plane ones (including `POST /batch`, the direct-`ql.update` mouth) against
    a fixture whose stored rows carry a flagged sentinel, and deep-scans each
    response body;
  - `mcp` — walks the `McpDataBridge` faces the factory actually returns.

  Every driven case also asserts a control value is present, so a refusal or an
  empty body cannot satisfy "no sentinel" by returning nothing.

  Reverse-verified in both directions, the discipline #7823's own fix used: deleting
  the strip from the REST batch arm turned the REST tripwire red on exactly that
  route; adding a _second_ unstripped direct engine mouth turned it red again;
  removing the new MCP strip turned the MCP tripwire red; every restore was proven
  byte-identical with `git hash-object`.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
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
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
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
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
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
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
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
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
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
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
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
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
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
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
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
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
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
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
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
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [e15e679]
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
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
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
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
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
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
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
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
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
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
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
- Updated dependencies [cde1975]
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
- Updated dependencies [f8cfbb4]
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
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
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
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 82da264: feat: declare `ExecutionContext.authGate`, so the ADR-0069 gate sits inside the closed field set (#7280)

  The ADR-0069 authentication-policy gate (expired password, enforced MFA) rode
  the execution context **undeclared**: REST's `computeExecCtx` spread it onto the
  assembled envelope with `...(authGate ? { authGate } : {})` behind an `as any`,
  and its `enforceAuth` read it back ten lines later. Nothing was broken — but the
  closed entry field set shipped in #6216 is derived from `keyof ExecutionContext`,
  so a field that exists only inside an `as any` is **outside every closure gate by
  construction**: `ENTRY_EXECUTION_CONTEXT_FIELDS` could not list it,
  `ExecutionContextEntryFields` could not demand it, and the runtime pin that
  reconciles the closed set against `ExecutionContextSchema.shape` could not see
  it. It was the exact blind spot that gate exists to remove, sitting one `as any`
  outside it.

  **@objectstack/spec** declares the field:

  ```ts
  authGate: z.object({ code: z.string(), message: z.string() }).optional();
  ```

  Both inner keys are required, matching the sole producer
  (`AuthManager.computeAuthGate`, which sets both on every return branch) — `code`
  is the stable machine code a client branches on, `message` is what the blocked
  user reads, and the transport seam renders both as the `403` body.

  **@objectstack/core** picks it up as an ENTRY-decided field — it is resolved from
  the request's own session at the transport entry point, never written mid-request
  — so `ExecutionContextAssemblyInput` gains a **required** `authGate` input on the
  same footing as `accessToken`: every face states its decision instead of omitting
  it. A guest principal never carries one (no authenticated session for a policy
  gate to attach to). Also exported: `normalizeAuthGate`, which completes a session
  user's loose `authGate` into the declared shape at the one producer rather than
  tolerating a partial shape downstream — a gate naming a `code` but no `message`
  no longer renders a `403` body with `message: undefined`. `AuthGate` is now
  derived from the schema instead of being a second hand-written declaration.

  **@objectstack/rest** passes the resolved gate as an assembler input and drops the
  post-assembly spread; the remaining `as any` covers `__kernel` alone.
  **@objectstack/runtime** (the runtime / MCP dispatcher) passes `authGate:
undefined` on the record: it enforces the same gate at its own seam
  (`HttpDispatcher.enforceAuthGate` re-reads the session and calls
  `evaluateAuthGate`) and never reads `context.authGate`, so carrying it there
  would be a second copy no consumer reads.

  **No runtime behaviour change on either surface.** The shared assembler omits
  `undefined`-valued keys, so the key is present exactly when it was before. The one
  new behaviour is the normalization above, on a shape the sole producer never
  emits today.

- f586f1a: refactor: one shared `ExecutionContext` assembler, two named anonymous entries (#6216)

  `resolveAuthzContext` already made AUTHORIZATION resolution single-sourced; the
  step after it — turning the resolved envelope into the `ExecutionContext` that
  reaches enforcement — was still one hand-written copy per transport, and the
  copies drifted twice for real: **#6071** (the REST copy never set
  `principalKind`, so every enforcement judgment reading it was silently
  never-true on that face) and **#6206 / #6551** (a dropped `accessible_org_ids`
  produced real 403s on the share-link faces).

  **@objectstack/core** gains the single assembly, with the anonymous divergence
  as named API rather than drift (maintainer ruling 2026-08-08 on #6216, Option
  A):

  - `assembleExecutionContext(input)` — the **fail-closed default** entry. No
    resolved principal → `undefined`, and the surface answers 401.
  - `assembleExecutionContextOrGuest(input)` — the **explicit guest** entry. No
    resolved principal → a first-class guest envelope (`principalKind: 'guest'`,
    `positions: ['guest']`), whose consumers are live (`explain-engine`'s
    guest ⇒ `EXTERNAL` posture floor). Adopted only by a surface whose product
    semantics serve anonymous principals.
  - The field set is **closed by type**: `ExecutionContextEntryFields` requires a
    decision for every `ExecutionContext` field that is not explicitly declared
    non-entry-resolved, so a new field cannot reach one transport and miss
    another. Also exported: `ENTRY_EXECUTION_CONTEXT_FIELDS`,
    `EntryExecutionContextField`, `ExecutionContextAssemblyInput`,
    `OAuthTokenProvenance`, `EntryLocalization`.

  **@objectstack/runtime** (`resolveExecutionContext`, the runtime / MCP
  dispatcher) and **@objectstack/rest** (`computeExecCtx`) now assemble through
  that module — the dispatcher via the guest entry, REST via the fail-closed
  default.

  **No runtime behaviour change on either surface.** The remaining per-face
  divergences are required inputs rather than silent omissions: REST passes
  `accessToken: undefined` (it has never carried the session bearer on the
  envelope, and `session.accessToken` is a published hook surface) and
  `oauth: undefined` (OAuth bearers are honoured on the `/mcp` door alone). The
  one measurable difference is that a key whose value was `undefined` is now
  omitted rather than spelled — invisible to `ctx.x` reads, to `JSON.stringify`
  and to spreading the envelope.

- 28d1eb7: fix(core): the QA `contains` assertion fails loudly instead of silently passing on a non-array/non-string actual (#7256)

  `TestRunner.assert`'s `case 'contains':` handled the two shapes it can evaluate —
  an array (membership) and a string (substring) — and had **no `else`**. Every
  other shape fell straight out of the switch throwing nothing, so the assertion
  reported **PASSED**. A scenario asserting
  `{ field: "body.data.items", operator: "contains", expectedValue: "acme" }`
  against a response that has no `body.data.items` at all reported ✅. The
  overwhelmingly common way to reach that branch is the one that matters most: a
  typo'd `field` path, or a response shape that moved under a suite nobody
  re-read. The assertion that was supposed to _be_ the test is the thing that
  silently disappears, and CI believes the green.

  `contains` was the only path in this engine that could decide "no comparison
  applies here" and report success. Every other unhandled shape already fails
  loud — an operator with no branch throws `Unknown assertion operator`, an action
  type with no adapter branch throws `Unsupported action type in HttpAdapter`,
  and `equals`/`not_equals`/`is_null`/`not_null` all compare unconditionally. This
  closes the asymmetry rather than adding a new posture: an assertion the engine
  **cannot evaluate** is a **failed** assertion.

  The message is written for the author who has to act on it, so it names the
  field, the operator and the runtime type of what the path actually resolved to
  (`null` and arrays get their own names, not `typeof`'s `object`), and then says
  which of the two things is wrong:

  ```
  Assertion failed: body.data.items cannot be evaluated by 'contains' — expected an
  array or a string at that path, got undefined. The path resolved to nothing — the
  field is absent from the result, or the path is misspelled. Use 'is_null' if
  asserting absence is what you meant.
  ```

  `undefined`/`null` point at the **fixture** (the path did not resolve, so the
  field path or the response shape it was written against is the suspect);
  a number, boolean or object points at the **assertion** (the path resolved
  fine and `contains` is the wrong operator for what it found).

  **Behaviour change, and its measured blast radius.** Suites that today pass a
  `contains` against a non-array/non-string will start failing — which is the
  point; each such assertion was asserting nothing. The in-tree radius was
  measured on the loud build and is **zero**: `os test` is the runner's only
  consumer, and the repository contains no Quality Protocol suite documents at
  all (no `qa/*.test.json` anywhere; the three example apps run `vitest`, and
  `packages/qa/*` are vitest suites that never touch `TestRunner`). No CI workflow
  invokes `os test`. So no in-repo case was passing vacuously and none needed
  repair. Downstream suites are the ones that will see red, and every case they
  see is a test that was never running.

  The two evaluable shapes are untouched in both directions: a matching array or
  string still passes, a non-matching one still fails with its existing message.
  `not_contains`, `gt`, `gte`, `lt`, `lte` and `error` are declared in
  `TestAssertionTypeSchema` and still have no branch in the runner — they were
  already refused loudly at `default:` rather than silently passed, so they do not
  carry this defect; that gap is recorded separately and is pinned here so a later
  implementation is a deliberate change rather than an accident.

### Patch Changes

- b127c8b: fix(spec,core): a filter placeholder is recognised by INTENT — `{TODAY()}` refuses loudly instead of comparing as a literal (#5586)

  `UnknownFilterTokenError` had a hole exactly where authors fall in. Recognition
  used the token-NAME grammar `/^\$?\{([a-zA-Z0-9_]+)\}$/`, so any placeholder
  carrying a **non-word character** classified as "not a placeholder at all" and
  was handed to the driver verbatim, to be compared as a literal string — the
  silent-wrong-result failure the diagnostic exists to abolish.

  The failure was inverted against the author. Measured on 17.0.0-rc.2 against a
  four-row fixture:

  | filter value             | before                           |                                                                                                                            |
  | ------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `due_date < '{today}'`   | 2 rows                           | correct — the two overdue rows                                                                                             |
  | `due_date < '{TODAY}'`   | throws `UnknownFilterTokenError` | diagnostic working                                                                                                         |
  | `due_date < '{TODAY()}'` | **4 rows**                       | diagnostic bypassed — literal string compare, and `'2026-…' < '{'` in lexicographic order swallowed a row due a week later |

  So misspelling `{today}` as `{TODAY}` was reported by name, while misspelling it
  as `{TODAY()}` returned the wrong rows in silence — and the parenthesised,
  kebab-case, natural-language and dotted spellings (`{TODAY()}`,
  `{current-user-id}`, `{30 days ago}`, `{user.id}`) are precisely what an author
  migrating from another system's macro syntax writes first.

  **Both directions of the behaviour change:**

  - **Previously silent, now refuses loudly** — a filter value that is entirely
    brace-wrapped and outside the vocabulary now throws `UnknownFilterTokenError`
    (`code: FILTER_TOKEN_UNKNOWN`, `status: 400`) on the ObjectQL read and write
    paths and the analytics dataset executor, and is reported as
    `filter-token-unknown` by `objectstack build` / `validate` / `lint`. Before,
    it reached the data engine and compared as text.
  - **Unchanged** — `{today}` / `{current_user_id}` still resolve; `{TODAY}` still
    refuses with the same identity; a value that merely _contains_ braces
    (`'acme {x} deal'`), or is not ONE pair around the whole value (`{a}{b}`,
    `{{x}}`, `{}`), is still an ordinary literal and still reaches the driver
    untouched.

  Recognition and vocabulary are now two named grammars rather than one:
  `FILTER_TOKEN_WRAPPED_RE` (`/^\$?\{([^{}]+)\}$/`) answers "did the author mean a
  placeholder", and `isContextToken` / `isDateMacroToken` answer "is it in the
  vocabulary". Wide in, strict out. No escape hatch for a literal `{…}` comparand
  ships with this: a repo-wide measurement across structured metadata, examples,
  seed data and fixtures found zero legitimate consumers comparing a
  brace-wrapped literal, and an escape syntax is a public micro-contract that can
  be added the day one shows up.

  Flow templates are unaffected. `interpolateFilter` in
  `@objectstack/service-automation` already recognised the same wide shape and
  resolves `{record.id}` / `{TODAY() + 30}` from flow variables **before** the
  filter reaches ObjectQL; its hand-off to the engine is keyed on the token
  vocabulary (`isKnownFilterToken`), which this change does not touch.

- d6d1a50: refactor(core): one implementation per hook-dispatch flavour, plus a paired-pin gate (#5282)

  `ObjectKernel` does not extend `ObjectKernelBase` — it is a standalone
  production kernel with its own `hooks` map, and only `LiteKernel` extends the
  base. Lifecycle-hook dispatch therefore existed **twice**, with no shared code
  path: the base's `triggerHook` (isolating) / `triggerHookOrThrow` (propagating) /
  `context.trigger` on one side, and `ObjectKernel`'s private
  `triggerShutdownHookIsolating` / `context.trigger` on the other. The two
  isolating loops printed the same `Hook handler failed: kernel:shutdown` line
  because someone typed it twice.

  That seam produced three consecutive bugs, each the same shape — one hook name
  meaning opposite things on the two kernels: `kernel:ready` (#5170),
  `kernel:bootstrapped` / `kernel:listening` (#5257, where a swallowed
  `server.listen()` failure let a process print "✅ Bootstrap complete" with
  nothing listening), and `kernel:shutdown` in the other direction (#5274, where
  one bad handler skipped every `destroy()`).

  **No behaviour change.** The two dispatch flavours move verbatim into an
  internal module, `packages/core/src/hook-dispatch.ts`, which both kernels now
  call:

  - `dispatchHookIsolating` — a failing handler is logged as
    `Hook handler failed: <name>` and the remaining handlers still run.
  - `dispatchHookPropagating` — the first failure escapes unwrapped and the
    handlers behind it are skipped.

  Every call path keeps the flavour, the log wording and the trace line it had
  before, including the one asymmetry inside the propagating flavour:
  `PluginContext.trigger` has never emitted the `Triggering hook: <name>` trace on
  either kernel, so it still does not. The kernels' two `hooks` maps are
  deliberately **not** unified, and `ObjectKernel` deliberately does **not** gain a
  base class — both were considered and ruled out of scope.

  How "no behaviour change" was proved: the paired kernel pins from #5170 / #5257 /
  #5274 pass untouched, and deleting the shared dispatcher's error log now turns
  **both** kernels' test files red from a single edit — a property the hand-mirrored
  copies could not have (editing `ObjectKernel`'s private loop could never turn
  `lite-kernel.test.ts` red).

  Shared dispatch cannot cover the residual two-maps seam, so the pairing of the
  tests is now a gate rather than a convention: `pnpm check:kernel-hook-pairs`
  (`scripts/check-kernel-hook-pairs.mjs`, wired into the ESLint job) requires every
  `kernel:*` hook dispatched in `packages/core/src` to be named in a test title in
  **both** `kernel.test.ts` and `lite-kernel.test.ts`, and fails naming the hook
  and the side that lacks it. A fifth lifecycle hook can no longer arrive paired on
  one kernel only.

  Also pinned, deliberately unchanged: `kernel:shutdown` has two dispatch paths
  with different flavours on both kernels — the kernel's own teardown isolates,
  while a plugin calling `ctx.trigger('kernel:shutdown')` by hand propagates.
  Nothing in the repo triggers it by hand today, so this is dormant; it is now a
  documented fact with a named test on each side rather than a surprise found at
  teardown.

- d0d5205: refactor(core,plugin-audit,service-storage,plugin-reports): give the `__` operation-private-key convention a single owner (#7284)

  `withoutOperationPrivateKeys` — the rule that a consumer forwarding a caller's
  execution envelope to a question about a DIFFERENT object must first drop the
  `__`-prefixed keys plugin-security stamped for the operation in flight — had been
  hand-copied into three packages: `plugin-audit`'s comment access hooks (#7141),
  `service-storage`'s attachment access hooks (#7145) and `plugin-reports`' report
  service (#7204). Each carried its own `OPERATION_PRIVATE_KEY_PREFIX` and its own
  doc block, and the prose had already diverged while the code still agreed — the
  shape that makes a later divergence in behaviour hard to notice.

  The helper now lives once, in `@objectstack/core`
  (`security/operation-private-keys.ts`), exported from the package root. Core is
  the only candidate all three consumers already depend on: `plugin-security` is
  the producer of the convention and the most honest owner, but none of the three
  depends on it and a string-prefix filter does not justify three new dependency
  edges onto a plugin; `@objectstack/spec` is fenced off by Prime Directive #2. The
  new home sits beside `assemble-execution-context.ts`, which owns the other end of
  the same lifecycle — that file is where an `ExecutionContext` is built at a
  transport entry point, this one is where it is stripped back down before being
  forwarded.

  The full reasoning moved with the code rather than being thinned: which keys the
  middleware stamps and why each is a widening input, why they are dropped by
  PREFIX and never by a name list, and why the fresh copy is load-bearing in both
  directions. Each consumer keeps only its own local half — which object _its_
  gates actually ask about — and points at the shared home.

  No behaviour change: the three copies were byte-equivalent, and all three
  packages' suites pass unchanged. Two new pins at the home cover it — the rule's
  own behaviour, which no package-level test had ever asserted directly, and a
  repository-shape pin that turns red if a fourth file declares its own copy.

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
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
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
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
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
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
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
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6

## 17.0.0-rc.5

### Minor Changes

- 1363084: feat(spec,objectql): `engine.transaction` 契约收紧第一批 —— `opts.require` fail-closed 与 `owned` 信号 (#5696)

  `IObjectQLEngine.transaction` 的声明面(`packages/spec/src/contracts/objectql-engine.ts`,
  ADR-0119 D1)此前把「默认驱动之外的对象写在事务外」与「驱动没有 `beginTransaction`
  时静默降级」写成**声明语义**的一部分。#4619 把这两条降级变得可观测(PR #5724),本次
  把其中两条收紧为调用方可选的契约,并同步修订 TSDoc 的事实性偏差。

  **新增(可选,默认行为完全不变):**

  - `transaction(cb, base, { require: true })` —— 驱动没有 `beginTransaction` 时
    **抛 `TransactionUnsupportedError`(`code: 'ERR_TRANSACTION_UNSUPPORTED'`)**,
    而不是静默降级成「无事务、无回滚」。在回调运行**之前**拒绝,所以调用方收到错误时
    一行都还没写。这是把 `batchData` 的 atomic 门(ADR-0119 D4)泛化成通用能力:
    只为「开事务的唯一理由就是回滚」的调用方而设,不传 `require` 的行为一字未变
    (仍然降级 + warn-once)。
  - 回调的**第二个参数** `{ owned: boolean }` —— `true` 表示本次调用开启了事务并拥有
    提交/回滚,`false` 表示它 **join** 了外层已开的 ambient 事务(ADR-0067 D2),
    或者处在降级路径上(那里根本没有事务可拥有)。join 语义本身正确且保留;缺的是
    调用方**无从分辨**,而「整体一起回滚」这类担保只在 owned 时成立。单参数回调不受影响。

  两点在 `ctx.api.transaction`(`ScopedContext.transaction`,沙箱 hook/action 体)上
  同样生效 —— 同一个原语的第二份实现不该变成第二种方言。

  **契约文本修订:** transaction 的 TSDoc 原先写「路由到别处的对象在事务**外**写入」,
  实测不符 —— 引擎无条件把 ambient 事务句柄穿给了目标驱动,语句在**错误的连接**上执行
  (#5351 在真 SQL driver 上实测为 `no such table`)。TSDoc 已按实测改写,并声明了随后
  落地的两条语义:业务写跨驱动**响亮拒绝**、系统账本(`lifecycle.class` 为
  `audit`/`telemetry`/`event`)**移出事务执行**。

  **类型面:** `@objectstack/core` 的 `EngineWithTransaction` 从「手抄签名」改为
  `transaction: IObjectQLEngine['transaction']`,窄接口可以窄,但不能与真签名漂移。
  新导出 `EngineTransactionOptions` / `EngineTransactionInfo`(spec `contracts` 命名空间,
  经 `@objectstack/core` 转出)。

  升级须知:无破坏性变更。既有调用点全部保持原行为;要 fail-closed 的调用方显式传
  `{ require: true }`。

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- 29c6c9d: feat(spec,core,runtime)!: declarative `apis:` refuses loudly instead of parsing into silence; the `ApiRegistry` family retires (#4936, #4939)

  The declarative API-endpoint surface was **zero-execution end to end**, and said nothing
  about it. Metadata loading worked perfectly — a stack declared `apis:`, `defineStack`
  accepted it, and `GET /api/v1/meta/api` returned every endpoint with every key intact.
  The execution side never fired once. On a real boot (showcase, 47 plugins) both declared
  paths answered a bare `404 {"error":"Not found"}` — not even the dispatcher's semantic
  404, because **no route was ever mounted** for a declared path, so the request died at
  Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint` branch resolved the
  metadata service and called `matchEndpoint` on it — a method **no implementation in the
  repo has ever provided**. The branch returned "not handled" on every request ever served.

  So every key on `ApiEndpointSchema` was declared ≠ enforced: `path`/`method` (never
  mounted), `type`/`target`/`objectParams` (never executed), `cacheTtl`,
  `inputMapping`/`outputMapping`, `rateLimit`, `summary`/`description` — and
  **`authRequired`**, a security semantic that parsed green and gated nothing at all. That
  is false compliance, the failure ADR-0049 exists to stop, not debt.

  ## BREAKING — a non-empty `apis:` is now rejected

  Metadata that parsed cleanly before is now **refused at publish/validate**, with the
  prescription in the rejection itself:

  ```
  apis: `apis:` (declarative ApiEndpoint) is DECLARED BUT NOT EXECUTABLE in this runtime,
  so a non-empty array is rejected instead of silently accepted (#4936). …
  ```

  **FROM → TO.** `apis: [ …endpoints… ]` → `apis: []` (or delete the key; both are still
  accepted, and an empty array is not a special case). To actually serve the route today,
  mount it **in code** — a plugin manifest `contributes.routes` entry, or an `http.server`
  route. That is now the only honest path, and the one `examples/app-showcase` uses
  (`src/system/server/recalc-endpoint.ts`).

  The refusal lives on `ObjectStackDefinitionSchema` itself, which is the single choke
  point every path runs through — `defineStack`, the metadata plugin's artifact ingestion,
  `os validate`, the lint scorer and `EnvironmentArtifactSchema`. There is no path that
  forgot to check.

  **The `ApiEndpoint` vocabulary is deliberately KEPT.** Retiring it was considered and
  rejected: endpoint shapes are an industry-stable form, so a retirement would only mean
  re-introducing the identical schema later. Your endpoint definitions stay valid TypeScript
  and stay in the spec; only _authoring them into a stack_ is refused, and only until the
  executor lands. Keep them commented next to your stack — that is what the showcase does.
  The executor (route mounting + endpoint matching + per-key wiring for
  `authRequired`/`cacheTtl`/`inputMapping`/`outputMapping`/`rateLimit`) is tracked by
  **#5040**, which replaces this rejection with real execution.

  ## BREAKING — the `ApiRegistry` / `ApiEndpointRegistration` family is removed (#4939)

  The repo carried a **second**, unrelated declaration shape for "an API endpoint":
  `ApiEndpointRegistrationSchema` and the ~500-line `ApiRegistry` service that
  `createApiRegistryPlugin()` registered under `api-registry`. Nothing composed it — every
  assembly site lived in `packages/core/examples/`, with no registration in
  `packages/runtime`, `packages/cli` or any `examples/app-*`, and a real boot carried no
  such service. The whole family was therefore inert, including
  `ApiEndpointRegistration.requiredPermissions`, whose docs promised **in the present tense**
  that "the gateway layer automatically validates these permissions" while no gateway read
  it. Two declaration shapes, both dead; this retirement converges them on one.

  Removed from `@objectstack/spec/api`: `ApiEndpointRegistration(Schema)`,
  `ApiRegistry(Schema)`, `ApiRegistryEntry(Schema)`, `ApiMetadataSchema`,
  `ApiParameterSchema`, `ApiResponseSchema`, `ApiDiscoveryQuerySchema`,
  `ApiDiscoveryResponseSchema`, `ApiProtocolType`, `HttpStatusCode`,
  `ObjectQLReferenceSchema`, `SchemaDefinition` (12 JSON-Schema defs, 67 authorable keys).
  Removed from `@objectstack/core`: `ApiRegistry`, `createApiRegistryPlugin`.
  Removed from `@objectstack/plugin-hono-server`: the `useApiRegistry` option — it was
  defaulted to `true` and read by nothing, configuring a service that was never composed.

  **FROM → TO.** There is no replacement shape to migrate to, because nothing executed the
  old one: delete the registration objects. If you were assembling an `ApiRegistryEntry`,
  you were building a value only your own code read — keep it as your own type. Declarative
  endpoints have one vocabulary now, `ApiEndpointSchema`.

  `ConflictResolutionStrategy` **survives** the removal and moved to
  `@objectstack/spec/api`'s `router.zod` — same name, same four values
  (`error`/`priority`/`first-wins`/`last-wins`), same import path. It is pinned there by two
  independent ratchets and is not part of the retired surface.

  ## Also in this change

  - **BREAKING (`@objectstack/runtime`):** `HttpDispatcher.handleApiEndpoint()` is deleted,
    along with its now-orphaned private `callData` delegate, and `/__api-endpoint` leaves
    `LEGACY_CHAIN_PREFIXES` and the route ledger. The method was public, so this is an API
    removal — but it returned `{ handled: false }` for every call it ever received, so no
    caller can observe a behaviour change beyond the missing symbol. Delete the call.
    Absence is now loud (ADR-0076): the surface is refused at authoring rather than 404ing
    at runtime with dead code behind it.
  - `examples/app-showcase` no longer declares endpoints, and its coverage manifest no
    longer claims the capability is `demonstrated` — that entry read "executed by the runtime
    dispatcher (handleApiEndpoint)", which was exactly the advertise-what-you-don't-deliver
    claim Prime Directive #10 forbids.
  - The endpoint-level `rateLimit` tracking pointers left by #4910/#5006 now name **#5040**,
    the live executor card, instead of #4936, which closes with this change.

### Minor Changes

- 0f2fdcd: fix(core)!: a throwing `kernel:bootstrapped` / `kernel:listening` handler fails the boot on LiteKernel too (#5257)

  **A failed `listen()` no longer yields a false "✅ Bootstrap complete".**

  #5170 (PR #5258) unified `kernel:ready`: a handler that throws fails the boot on
  `ObjectKernel` and `LiteKernel` alike. It deliberately ruled that one hook only,
  leaving the other lifecycle hooks split — `ObjectKernel` propagates their
  failures (its `context.trigger` is a bare awaited loop that never catches) while
  `LiteKernel` routed them through the isolating dispatcher, logging
  `Hook handler failed: <name>` and carrying on. This closes the two boot-path
  hooks that were left: `kernel:bootstrapped` and `kernel:listening` now use the
  propagating dispatcher (`triggerHookOrThrow`) on `LiteKernel`, in the same shape
  #5258 established — the remaining handlers for that hook are skipped, the later
  boot hooks never fire, the original error reaches the caller **unwrapped**,
  `state` is left `'stopped'` rather than `'running'`, and the success line is
  never logged.

  The concrete failure this removes: `HonoServerPlugin` opens its socket inside a
  `kernel:listening` handler — `await this.server.listen(port)`, with no try/catch
  of its own, deliberately. When that rejected on `LiteKernel` (EACCES on a
  privileged port, a failure inside the port-fallback logic itself, a serverless /
  edge host where `listen` is not available at all) the throw was swallowed,
  `bootstrap()` resolved normally, and the process printed
  `✅ Bootstrap complete` while **nothing was listening**. The same plugin code on
  `ObjectKernel` failed the boot. The health check that came next was the first
  thing to notice, and it had already been told startup succeeded. Plain "port is
  in use" was never affected — `server.listen` falls back to a random port
  internally — which is exactly why this stayed invisible.

  `kernel:bootstrapped` carries reconcile and audit work (objectql's
  `announceOpenMigrationGates`, service-automation's node-type / trigger-binding
  audits, the sharing plugin's boot backfills); a swallowed failure there is a
  quieter version of the same lie — the audit silently does not run.

  **`kernel:shutdown` keeps fail-soft dispatch**, now as an explicit per-hook
  judgement recorded in a comment at the dispatch site rather than an inherited
  default. On the teardown path there is no "refuse to proceed" left to buy, and
  the handlers queued behind a failing one — plus the reverse-order `destroy()`
  pass after them — are what flush buffers, close connections and release locks.
  Aborting that sequence would convert one bad handler into leaked resources and
  unflushed writes.

  **Who is affected.** Hosts that boot through `LiteKernel` — vitest, serverless,
  edge (Workers) — and register a `kernel:bootstrapped` or `kernel:listening`
  handler that can throw. Such a host previously came up "successfully" with the
  work of that handler silently skipped; it now refuses to start and surfaces the
  original error. If a handler of yours performs best-effort work whose failure
  genuinely must not stop the boot, it needs its own `try/catch` — which is what
  the in-repo `kernel:bootstrapped` subscribers already do, per handler, with the
  reason written down. Nothing in this repo relied on the swallow: the core (426),
  client, runtime, http-conformance, connector-{rest,mcp,slack} and
  service-automation (665) suites pass unchanged.

  Boot assertions still belong in `kernel:ready`: it is the earliest hook at which
  the service registry is finished filling.

- 8ffa8b9: fix(core)!: a throwing `kernel:ready` handler now fails the boot on **LiteKernel** too (#5170)

  **Behaviour change — read this if you run `LiteKernel` (vitest harnesses,
  serverless functions, edge workers).** A `kernel:ready` handler that throws now
  **rejects `bootstrap()`** on `LiteKernel`, exactly as it always has on
  `ObjectKernel`. Before this change the throw was caught inside the kernel,
  written out as one `Hook handler failed: kernel:ready` error log, and the boot
  continued to "✅ Bootstrap complete".

  **Why it mattered.** The two kernels ran the same hook through two different
  dispatchers: `ObjectKernel` used `context.trigger` (a bare awaited loop that
  never catches), `LiteKernel` used `triggerHook` (per-handler try/catch,
  "continue with other handlers even if one fails"). Same hook name, same plugin
  code, opposite failure semantics — which is `declared ≠ enforced` in the
  kernel's own lifecycle contract.

  `kernel:ready` is the only correct moment for a plugin to assert that a
  precondition it _declared_ was actually delivered: the service registry is
  still filling during `init()`, so a boot gate has nowhere earlier to run. Every
  "declare it and we refuse to start if we cannot honour it" gate in this repo
  therefore lives there — and on `LiteKernel` those gates were being downgraded to
  a log line while the process came up and served traffic without the guarantee it
  had announced. `EmailServicePlugin`'s `queueDelivery: true` gate (#5160) is the
  worked example: on `ObjectKernel` the boot failed, on `LiteKernel` the server
  came up and quietly fell back to inline delivery. Serverless is exactly where
  "do not start misconfigured" matters most.

  **Who is affected.** Any `LiteKernel` host whose `kernel:ready` handler throws
  on a healthy boot. That boot previously "succeeded"; it now fails loudly with
  the original error, and the kernel is left `stopped` rather than `running`. The
  failure was never silent — it was already an `ERROR` line in your logs — so
  check for `Hook handler failed: kernel:ready` in existing logs to find hosts
  that will now refuse to start. If the handler's work is genuinely optional,
  catch inside the handler and log there; the kernel no longer decides that for
  you. The full test surface in this repo that boots `LiteKernel` (core, client,
  runtime, http-conformance, the connectors, service-automation) passes unchanged
  — nothing was relying on the swallow.

  Scope: **`kernel:ready` only.** `kernel:bootstrapped`, `kernel:listening` and
  `kernel:shutdown` keep `LiteKernel`'s isolating dispatch, pinned by a test.

### Patch Changes

- b746aa0: fix(service-automation): connector 物化失败的软路径改用结构化 `meta`;顺带修好 `ObjectLogger.error` 丢弃契约第三参的缺陷 (#5575)

  ## service-automation:`fail(msg, cause)`

  `reconcileDeclaredConnectors` 的报错器有两条路径(ADR-0097):冷启动 `throw`(fatal),
  `metadata:reloaded` 之后 —— Studio publish、`os dev` 重编译 —— 记日志并让旧 connector
  继续服务(soft)。其中两个调用点把**外来**的 `err.message` 插进那条日志 message:
  `resolveInstanceAuth` 失败处,以及 provider factory 抛错处。这两个 message 都不是我们
  自己的:credential resolver 由宿主提供
  (`AutomationServicePluginOptions.credentialResolver`),provider factory 更是 ADR-0097
  明确鼓励第三方去写的代码 —— 第一个用严格 Zod schema 校验 `providerConfig` 的 factory
  抛出的就是 `ZodError`,它的 `.message` 是 issue 数组的多行 JSON dump,第一行是一个 `[`。

  `ObjectLogger` 每次调用只写一条 `<ts> <LEVEL> <msg>` 记录,带换行的 message 会溢出到
  不带等级头的后续物理行,于是运行时 stderr 的每一个按行工作的消费者 —— 文件 sink、
  `docker logs`/journald 送进日志采集、一次 `grep ERROR` —— 都会把那些续行读成无法归属的
  垃圾记录:一条诊断散成 N 个碎片。与 #5048 在 flow 绑定接缝上是同一类,也是同一条 #4632
  原则:被搅烂的诊断比没有诊断更贵。

  改法与 PR #5572 同源:`fail(msg, cause?)` —— message 是不含换行的自足句子,cause 按路径
  分别渲染。soft 路径把 cause 交给 logger 的**结构化 meta**(`issues[]` / `error`);fatal
  路径把 cause 文本接在抛出的 message 后面(`… cause: <text>`),因为 throw 不是日志记录,
  内核失败通道原样打印,多行 ZodError dump 在终端里本来就好读 —— 同一个 cause,两种受众,
  刻意不共用一种形状。`#5048` 引入的内部模块随之从 `flow-bind-diagnostics.ts` 更名为
  `thrown-cause-diagnostics.ts`(`describeThrownForLog`),因为它从来不是 flow 专属的:
  主题是日志管线,不是 metadata 类型。被拒键名仍放在 `unrecognized` 而不是 Zod 原本的
  `keys`(`ObjectLogger` 的脱敏表按子串匹配,`keys` 含 `key`)。

  **一处订正**:#5575 的 issue 正文把此处的危害归给了 `serve` 的启动诊断缓冲
  (`BootLogCapture`)。那个缓冲看不到这条路径 —— `ObjectLogger` 把 `warn` 送 stdout(启动
  静默窗口只包了 `process.stdout.write`),`error`/`fatal` 送 **stderr**,而且 soft 路径在
  `metadata:reloaded` 之后才跑,窗口早已恢复。危害是上面那串按行消费者,以及日志查询根本
  无法按字段过滤;机制写进了模块文档,连同 `warn`/`error` 下游不同这件事本身。

  ## core:`ObjectLogger.error`/`fatal` 兑现契约声明的 `meta`

  `Logger` 契约声明 `error(message, error?: Error, meta?)`。`ObjectLogger` 按形状分派,
  所以 meta 也允许出现在 `error` 位 —— 这份宽容没问题;**丢掉一个自己声明的参数**有问题:
  `error === undefined` 时旧代码走 `write(level, message, errorOrMeta)`,第三个参数从未被
  读取。于是每一个按契约书写的 `logger.error(msg, undefined, { … })` 都只输出一条裸 message,
  事实全部静默消失 —— `metadata`、`metadata-protocol`、`client`、`core/security` 里约 15 处
  调用点今天就是这样(其中 `metadata/src/endpoint-matcher.ts` 送的正是一个 Zod issue 数组)。
  契约的另外两个实现(`@objectstack/observability` 的 `ConsoleLogger`/`JsonLogger`)都老老实实
  用了这个位置,所以是契约对、这一个实现错:declared ≠ enforced。

  三种形状现在都被兑现,两个位置同时带值时以更靠后的 `meta` 为准。这一处修好之后,上述
  调用点的诊断自动恢复(`client` 的 `HTTP request failed` 记录重新带上
  `{method, url, status, error}`)。connector 接缝改用契约的第三参而非第二参,是刻意的:
  把原始 error 塞进第二位会让每条记录都附带完整堆栈,ZodError 还会附带整段多行 dump ——
  正是我们要消灭的无界形状。

- eb3e650: fix(core): 健康检查的超时守卫在 race 落定时被清除,周期性检查不再堆积孤儿定时器 (#4875)

  `PluginHealthMonitor.performHealthCheck()` 里那条 race 的守卫由 `timeout()` armed 之后就被
  扔掉:插件的 `checkMethod` 赢下 race 之后,那根 `setTimeout` 既没 `clearTimeout` 也没
  `unref()`,带着 ref 一直挂满整个 `config.timeout`。这与 #4813 修掉的两处(内核 init/start
  守卫,PR #4874)是同一种漏法。

  差别在于**健康检查是周期性的**:内核那两处是启动时一次性的固定份额(4 个插件 = 8 根),这里
  则是**每个插件每一轮各留一根**,`interval` 越密、`timeout` 越长,堆得越高 —— 一个
  `interval: 30s` / `timeout: 5s` 的插件在任意时刻都挂着若干根本该在毫秒级就回收的定时器。
  今天这条还没发作,只是因为 `startMonitoring()` 目前没有被内核启动流程调用;一旦健康监控被接进
  宿主,它就是 #4813 的放大版。

  修法与 #4874 同形:`timeout()` 换成私有 helper `raceCheckTimeout()`,`try { await
Promise.race(...) } finally { clearTimeout(guard) }`。

  **为什么是 `clearTimeout` 而不是 `unref()`。** `unref()` 让定时器不再钉住事件循环的同时,
  也让它不再是一个守卫 —— 若检查永不 settle 且没有别的东西撑着事件循环,Node 会在定时器触发
  之前退出,超时被静默吞掉。守卫必须在 race 未决期间保持 ref'd、在落定那一刻被回收,这正是
  `finally { clearTimeout(guard) }` 表达的语义。回归测试因此是三条:守卫赢不了时不留 ref'd
  定时器、连跑多轮不累积(fake timers 下计数,能识破 `unref()` 式的假修复)、以及检查真的挂住时
  超时照常上报。

  超时时长(`config.timeout`)一个都没动 —— 问题从来不在时长,而在没人回收。

- 674ac99: fix(core): one throwing `kernel:shutdown` handler no longer skips every plugin `destroy()` and kills the process under a false "Shutdown timed out" (#5274)

  **On `ObjectKernel`, a single bad shutdown subscriber used to end the entire teardown
  and `process.exit(1)` the host — reporting a timeout that never happened.**

  `performShutdown()` dispatched `kernel:shutdown` through `context.trigger` (a bare
  awaited loop that never catches), so the first handler that threw propagated out to
  `shutdown()`'s `Promise.race` catch. That catch was written for the timeout race alone
  and treated every exception as one, producing three consequences at once:

  1. the remaining `kernel:shutdown` handlers never ran;
  2. **every** plugin's `destroy()` was skipped — the reverse-order destroy pass sits
     after the trigger in `performShutdown()`, so it was never reached;
  3. the process was killed by `process.exit(1)` under the log line
     `Shutdown timed out — forcing exit`, while nothing had timed out — sending whoever
     read it to the `shutdownTimeout` config for a handler bug.

  Two changes, matching the reasoning #5257 recorded at `LiteKernel`'s shutdown dispatch
  site:

  - **`kernel:shutdown` now dispatches ISOLATING on `ObjectKernel` too.** A handler that
    throws is logged as `Hook handler failed: kernel:shutdown` and the remaining handlers
    still run, followed by the reverse-order `destroy()` pass and the `onShutdown()`
    handlers — both of which already isolated per plugin and per handler. What is queued
    behind a failing shutdown handler is the cleanup that flushes buffers, closes
    connections and releases locks, so one bad handler must not amplify into leaks and
    unflushed writes. The BOOT-path hooks are untouched: `kernel:ready`,
    `kernel:bootstrapped` and `kernel:listening` still propagate and still fail the boot
    (#5170, #5257).
  - **The timeout catch now handles only a genuine timeout**, discriminated by identity on
    the timer's own rejection — not by message, not by type, so nothing a plugin throws
    can impersonate it. A genuine `shutdownTimeout` overrun is **unchanged**: it still
    logs `Shutdown timed out — forcing exit` and still calls `process.exit(1)`, because
    teardown really is hung and the process would otherwise hold what it failed to
    release. Any other exception is logged at `error` and follows the normal path —
    `state = 'stopped'`, return — with no `process.exit`, leaving an embedding host
    (cloud auth-proxy, CLI, a test runner) its own chance to finish cleanly.

  `shutdown()` still never rejects, so no existing caller changes. Telling the two paths
  apart is the point of the fix, and both are pinned by named tests.

- 46365ab: fix(core): `ObjectLogger` 的脱敏表按**词边界**匹配,不再按子串吃掉 `keys`/`tokens` 这类普通字段 (#5573)

  `redactSensitive` 此前的判定是 `key.toLowerCase().includes(pattern)` —— 只要字段名
  **含有** `password`/`token`/`secret`/`key` 子串,整个值就被换成 `***REDACTED***`。
  于是 `keys`、`keyword`、`keywords`、`keyboard`、`monkey`、`tokens`、`tokenizer`、
  `secretary` 全部中招:读者不但丢了事实,还被告知"这里挡住了一个秘密",比字段直接
  缺失更误导。仓库里已经有活的命中 —— `dispatcher-plugin.ts` 为了躲开脱敏器特意把
  `key` 改名成 `keyedBy`,而 `'keyedby'.includes('key')` 依然为真,那条限流日志的
  `keyedBy` 一直是 `***REDACTED***`。

  匹配语义 FROM → TO:

  |                                                        | FROM(子串 `includes`) | TO(词边界)           |
  | :----------------------------------------------------- | :-------------------- | :------------------- |
  | `apiKey` / `api_key` / `API_KEY` / `x-api-key`         | 脱敏                  | 脱敏(不变)           |
  | `apikey` / `APIKEY`(全小写连写)                        | 脱敏                  | 脱敏(不变,见下)      |
  | `apiKeys` / `refresh_tokens`(复合词里的复数)           | 脱敏                  | 脱敏(不变)           |
  | `keys` / `tokens` / `keyword` / `monkey` / `secretary` | **脱敏**              | **不脱敏**           |
  | `keyedBy` / `tokenizerName`                            | **脱敏**              | **不脱敏**           |
  | `passwords` / `secrets`(裸复数)                        | **脱敏**              | **不脱敏**           |
  | `api_key` 字段 + `redact: ['apiKey']` 配置             | **不脱敏**            | **脱敏**(跨拼法命中) |

  字段名按 camelCase / snake_case / kebab-case / 字母-数字边界分词后逐词比对。默认脱敏表
  (`['password','token','secret','key']`)本身**没有变**,`packages/spec` 的 schema 默认值
  也没有变 —— 变的只是这张表怎么用。

  两个边角是显式取舍,不是遗漏:

  - **全小写连写**没有词边界可分,`apikey` 分词后只有一个词。不能用"以 `key` 结尾"救,
    因为 `monkey`/`turkey`/`whiskey` 也以它结尾 —— 那正是本单要去掉的误报。所以连写只在
    前缀是一张显式限定词表(`api`/`access`/`refresh`/`client`/`private`/`session`/…)里的
    词时才算命中;表外的连写(`foobarkey`)不脱敏,按仓库命名惯例写成 `fooBarKey` /
    `foo_bar_key` 即可通用命中。只认**后缀**连写,所以 `secretary`、`keyword` 保持干净。
  - **裸复数**是集合或计数而不是秘密(`keys` 来自 Zod 的 `unrecognized_keys` issue,
    `tokens` 来自 LLM 用量),按维护者裁决不脱敏;复数**出现在复合词里**时仍然是秘密
    (`apiKeys: ['sk-…']`),照常脱敏。确实要脱敏裸复数的 host,写
    `redact: [..., 'passwords']` 显式加回。

  **影响面**:host 侧自定义 `redact` 配置的匹配行为随之收紧 —— 依赖子串宽匹配"顺手"挡住
  某个字段的部署,需要把该字段名(或它的词)显式写进 `redact`。反向的收益是同一个词现在
  跨拼法命中:配 `redact: ['apiKey']` 也会挡住 `api_key` 和 `apikey`。

- c5adfe1: fix: 节点执行与热重载 shutdown 的超时守卫在 race 落定时被清除,不再留下孤儿定时器 (#4952)

  #4813(PR #4874,内核 init/start)与 #4875(PR #4950,周期性健康检查)修掉的是同一种漏法:
  守卫 armed 之后就被扔掉 —— 被守护的一方赢下 race 之后,那根 `setTimeout` 既没 `clearTimeout`
  也没 `unref()`,带着 ref 一直把事件循环钉满整个超时预算。本次清仓剩下的两处生产实例:

  - **`AutomationEngine.executeWithTimeout()`**(`service-automation`)—— 三处里量级最大的一处:
    **每个声明了 `timeoutMs` 的流程节点各一根**,孤儿数随流程节点数 × 触发频率线性增长;一次性进程
    (`os` CLI 跑到 flow 的路径)干完活之后还会被最长的那根守卫按住到超时才退出。
  - **`HotReloadManager.reloadPlugin()`**(`core`)—— 插件 `destroy()` 的 shutdown 守卫,与 #4813
    修掉的两处一字不差:一次毫秒级完成的热重载,照样把循环钉满 `shutdownTimeout`。

  两处修法与 #4874 / #4950 同形,不新造变体:私有 helper +
  `try { return await Promise.race([...]) } finally { clearTimeout(guard) }`。`hot-reload.ts` 的
  helper 把入参放宽到 `T | PromiseLike<T>`(Plugin 契约允许同步 `destroy()`);`engine.ts` 的不放宽
  (`NodeExecutor.execute` 声明返回 `Promise`)。

  **为什么是 `clearTimeout` 而不是 `unref()`。** `unref()` 让定时器不再钉住事件循环的同时,也让它
  不再是一个守卫 —— 若被守护的一方永不 settle 且没有别的东西撑着事件循环,Node 会在定时器触发之前
  退出,超时被静默吞掉。守卫必须在 race 未决期间保持 ref'd、在落定那一刻被回收,这正是
  `finally { clearTimeout(guard) }` 表达的语义。两处的回归测试各自沿用 #4950 的双向写法:
  真实定时器下不留 ref'd 定时器、fake timers 下连跑多轮不累积(计数能看见 `unref()` 过的定时器,
  因此识破 `unref()` 式的假修复)、以及被守护方真的挂住时超时照常上报。

  超时时长(`timeoutMs` / `shutdownTimeout`)一个都没动 —— 问题从来不在时长,而在没人回收。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
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
- Updated dependencies [d9971d3]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
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

## 17.0.0-rc.2

### Minor Changes

- 98877c9: feat(core,platform-objects,spec): the ADR-0119 D2 migration-journal runner — a migration killed mid-run is resumable to completion or compensable to clean, with journal rows proving which (#4617)

  **The gap D1 left open.** ADR-0119 D1 made `engine.transaction()` reachable
  through the contract, which is the right answer for multi-write atomicity that
  fits in one transaction. Migration-class work does not fit: a million-row
  backfill cannot hold one write-lock for its duration, `driver-memory`'s
  `beginTransaction` deep-clones the entire database (O(db) per begin),
  `ObjectQL.transaction()` binds the **default driver only** so a multi-datasource
  migration silently commits part of its work outside it, and a process **killed**
  — as distinct from a thrown error — defeats in-process rollback entirely. So the
  unit of atomicity is the _chunk_, and durability across chunks is a journal.

  Four consumers had each converged on the same four moves — dry-run preflight,
  undo journal, LIFO compensation, re-entrant forward recovery (ADR-0105 D13
  promotion, ADR-0117 D8's ownership backfill, the org lifecycle transitions, and
  D10 master-data distribution #4585). One copy is engineering; four is platform
  debt, and the fourth author would have had to rediscover the invariant below
  from scratch.

  **New: `runMigrationJournal` (`@objectstack/core`).** Preflight runs every
  step's read-only validator before any step writes, so a plan that would fail at
  step 3 has not written step 1. Rows are chunked per the `bulk-write.ts`
  discipline; each chunk's writes run inside `engine.transaction()`. On failure,
  committed chunks are compensated newest-first, each in its own transaction. On
  restart, a rediscovered run resumes forward from the first chunk lacking
  `chunk_done`, or unwinds, per the plan's `onCrash` policy. Forward and
  compensate callbacks receive an `attempt` counter; `attempt > 1` means the prior
  outcome is UNKNOWN and the callback must recheck by natural key before
  re-writing — the same at-least-once contract `bulk-write.ts` already documents,
  reused rather than re-derived.

  **The invariant that carries the design:** `chunk_done(i)` is written **inside**
  the chunk's own transaction, so `done ⇔ committed` holds by construction;
  `chunk_started(i)` is written autonomously **before** it. That asymmetry is what
  gives `started ∧ ¬done` exactly one meaning — _the outcome is unknown_ — which
  is the only state a crash can leave and the only state recovery reasons about.
  Making both writes symmetric would look tidier and would destroy recovery.

  **New: `sys_migration_journal` (`@objectstack/platform-objects`).** Rows keyed
  `(run_id, seq)` under a unique index, so a resumed run that miscomputes its next
  sequence fails loudly rather than double-recording an event. Registered
  unconditionally alongside `sys_migration` because recovery must be discoverable
  with **zero host wiring** — a journal some kernels compose and others do not is
  a journal a boot scanner cannot rely on (ADR-0078). Distinct in grain from
  `sys_migration`, which holds one durable verdict per named migration; this holds
  many rows per _run_. Read-only over the API; writes go through the runner in
  system context.

  **The runner refuses rather than degrades**, in four places: the runtime cannot
  roll back; any preflight fails; the plan declares `onCrash: 'compensate'` but a
  step cannot compensate; or a resume's plan hash disagrees with the journal
  (resuming a changed plan would apply chunk boundaries the journal never
  described). A compensation failure halts and is journalled — never swallowed —
  and the run ends `failed`, not `compensated`, because a database in a state no
  clean story covers must not be reported as a tidy rollback.

  **`engineCanRollBack` is now shared.** The two-level probe (engine method AND
  default-driver `beginTransaction`) was the same condition written twice — here
  and in `batchData`'s atomic gate. It now lives in `@objectstack/core` and
  `@objectstack/metadata-protocol` imports it, as a type predicate so callers do
  not each re-narrow the optional member by hand. Two copies of "can this runtime
  actually roll back?" drift by one clause and leave one caller believing it has
  atomicity it does not have.

  Boot reconciliation and `os migrate resume` land separately; `findInterruptedRuns`
  is the discovery primitive they will consume, and is exported here.

  **Docs:** ADR-0118 (plugin-reachable transactions) is renumbered **ADR-0119**.
  It merged one day after an unrelated ADR-0118 (非用户 actor 的平台契约) and the
  earlier merge holds the number; citations of "ADR-0118 D1/D2/D3/D4" written
  before 2026-08-03 mean the renumbered record.

- 071d0dc: feat(runtime,cli,core): boot reconciliation and `os migrate resume` for the migration journal — an interrupted run can no longer go unnoticed (ADR-0119 D2, #4617)

  Completes ADR-0119 D2. The runner and `sys_migration_journal` landed in #4668; this is the discovery channel that makes an interrupted run findable by someone who does not already know it happened.

  **`MigrationRecoveryPlugin` (`@objectstack/runtime`)** — at `kernel:ready`, scans the journal for runs that started and never concluded, and warns per run: how many chunks committed, which have an **unknown** outcome (`chunk_started` with no `chunk_done`), whether a compensation was left half-finished, and the exact command that will act. It also owns the `migration-plans` registry service.

  **`os migrate resume` (`@objectstack/cli`)** — lists interrupted runs (read-only, the default), or acts on one with `--run <id>`, under confirmation. Exits non-zero when a run ends `failed`, so a scripted recovery cannot move on from a migration that needs a human.

  **`MigrationPlanRegistry` (`@objectstack/core`)** — where a resume finds the plan it has to re-run.

  ## Boot discovers, the CLI acts

  This is the design decision, and it is deliberate rather than incidental.

  Resuming is a large, irreversible, potentially hour-long write against production data. Doing that as an unrequested side effect of a process starting is the kind of behaviour an operator finds out about from a graph. It is also not always possible at boot: a resume needs the plan's live callbacks, and the package that owns them may not be loaded in whichever process happened to restart first.

  So boot surfaces the run and names the command; the command acts, under explicit operator intent. ADR-0119 D2's per-plan `onCrash` policy still decides **what** acting means — resume forward from the first chunk lacking `chunk_done`, or unwind what committed — it just does not decide **when**, and "when" is the part a human should own.

  Deferring is safe precisely because of the runner's re-entrancy: `started ∧ ¬done` is durable, so an interrupted run stays exactly as recoverable an hour later as it was at boot. Nothing decays while the operator decides.

  ## Why a plan registry exists at all

  A journal cannot hold a plan. `forward` and `compensate` are functions and `load()` reads the live database, so none of it crosses a process boundary — which is why the journal records the plan **hash**, not the plan. Recovery therefore needs the plan handed back by the code that owns it, and `migration-plans` is that seam: between "the journal knows a run stopped at chunk 7" and "something in this process knows what chunk 7 was supposed to do".

  A run whose plan no loaded package registers is **reported**, never silently skipped — the operator is told which plan id is missing. "Nothing to resume" and "the code that owns this run is not here" are different facts, and only one of them is safe to ignore.

  ## Degradation

  No engine, or no `sys_migration_journal` registered (a lean kernel that never composed platform-objects) → the scan is skipped in **silence**: such a kernel has no interrupted runs to find, and a warning there would train operators to ignore this plugin's output, which is the one thing it cannot afford. A scan that **fails**, by contrast, is reported — "I could not check" and "there is nothing to find" are different answers.

  11 new tests pin the split (boot writes nothing to the journal), the three states an operator must tell apart (clean / interrupted / half-unwound), and both degradation paths.

### Patch Changes

- 833b512: fix(core): 插件 init/start 的超时守卫定时器在 race 结束时被清除,进程不再空转 `startupTimeout` (#4813)

  `ObjectKernel.initPluginWithTimeout()` / `startPluginWithTimeout()` 各自 `setTimeout` armed
  一根超时守卫,然后**把它扔了**:插件赢下 race 之后,那根定时器既没 `clearTimeout` 也没
  `unref()`,带着 ref 一直挂到 `startupTimeout` 走完。于是每个进程在活干完之后还要空转整整
  一个 `startupTimeout` —— `ObjectQLPlugin` 是 120 秒。

  实测(`examples/app-crm`,同一条 `migrate recorded-by --json`,同一个构建链,唯一差别是本
  改动):

  |        | 墙钟   |
  | :----- | :----- |
  | 修复前 | 122.4s |
  | 修复后 | 3.1s   |

  JSON 与 `✅ Graceful shutdown complete` 两次都在 ~3 秒出现 —— 后面那 119 秒纯粹是 8 根
  孤儿定时器(4 个 init + 4 个 start)钉着事件循环。`os serve` 里同样漏,只是那里进程本来
  就长命,看不出来。

  **为什么是 `clearTimeout` 而不是 `unref()`。** 隔壁 `shutdown()` 的守卫用的是 `unref()`,
  但那个写法在这里是错的,而且不是风格问题:`unref()` 让定时器不再钉住事件循环,**同时也
  让它不再是一个守卫** —— 若 hook 永不 settle 且没有别的东西撑着事件循环,Node 会在定时器
  触发之前直接退出,超时被**静默吞掉**,谁也不会收到那个 error。守卫必须在 race 未决期间
  保持 ref'd,在 race 落定的那一刻被回收,这正是 `finally { clearTimeout(guard) }` 表达的
  语义。两个守卫合并为一个私有 helper `raceStartupTimeout()`,措辞与理由写在它的 doc
  comment 里。

  `startupTimeout` 的取值一个都没动 —— 慢启动的插件需要那个上限,问题从来不在时长,而在
  没人回收。

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
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
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
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
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
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
  - @objectstack/spec@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- 32ccb23: feat(spec,core,runtime)!: ADR-0112 batch 1 — one error-code vocabulary, SCREAMING_SNAKE, schema-enforced (#3841)

  Settles #3841 per ADR-0112: the top-level `error.code` vocabulary is
  SCREAMING_SNAKE, in two tiers.

  - **`StandardErrorCode` members renamed in place** (`validation_error` →
    `VALIDATION_ERROR`, all 53). Breaking for importers that branch on the old
    lowercase members; the type name and member _meanings_ are unchanged.
  - **New `ERROR_CODE_LEDGER`** (`@objectstack/spec/api`): service-specific codes
    (`AUTH_REQUIRED`, `VALIDATION_FAILED`, `ATTACHMENT_DOWNLOAD_DENIED`, …) are
    registered per owning package. `ErrorCode` = standard ∪ registered.
  - **`ApiErrorSchema.code` is now `ErrorCode`**, not `z.string()` — an
    unregistered code fails parse, so the envelope conformance suites assert
    values, not just shape.
  - **`FieldErrorSchema.code` widened to `z.string()`** (ADR-0112 D6): field-level
    codes are a separate vocabulary the enum never described; #3977 owns its real
    catalog.
  - **Derived codes changed case on the wire**: `standardErrorCodeForHttpStatus`
    now yields SCREAMING members (`permission_denied` → `PERMISSION_DENIED`,
    `method_not_allowed` → `METHOD_NOT_ALLOWED`, …) — this map was #3842's
    designated one-file sweep point for exactly this decision.
  - **`ANONYMOUS_DENY_CODE` is `'UNAUTHENTICATED'`** (was `'unauthenticated'`) —
    the promoted code on anonymous-denied requests and the REST `enforceAuth`
    body change spelling with it.

  `error-catalog.mdx` and the error-handling guides are rewritten to the single
  vocabulary; a spec test now locks the catalog page's headings to the enum so
  they cannot drift apart again. Remaining lowercase emitters (cloud-connection,
  plugin-auth envelope codes, metadata-protocol, …) are the batch-2 sweep.

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

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

- d13004a: feat(core,runtime): plugin ordering is a declared, kernel-enforced contract (ADR-0116, #4131)

  `kernel.use()` registration order was never a contract — the kernel resolves
  init/start order from the plugin dependency graph — but a plugin that needed a
  service at init _when its provider is composed_ while also booting _without_
  the provider had no way to declare that. `AppPlugin` was the standing example:
  it grabs `manifest`/`objectql` synchronously in `init()`, declared nothing
  (a hard dependency would break empty-env / metadata-only / mock-engine
  kernels), and so its correctness rode on which array slot each caller put it
  in. That convention failed the same way twice (`DefaultDatasourcePlugin`'s
  first cut; then #4085, disguised for months as "crashes when the artifact is
  missing").

  The kernel `Plugin` contract gains three additive fields, enforced by both
  `ObjectKernel` and `LiteKernel` through one shared implementation
  (`plugin-order.ts` — the previously duplicated topological sort is unified
  there):

  - **`optionalDependencies: string[]`** — order-if-present: hoisted ahead
    exactly like `dependencies` when composed (real topology edges, including
    cycle detection), silently skipped when absent.
  - **`requiresServices: string[]`** — services resolved synchronously during
    `init()` with no fallback. Validated **before Phase 1**: a required service
    whose only declared provider initializes later fails the boot with an error
    naming both plugins, both slots, and the fix — before any init side
    effects. Re-checked immediately before the plugin's own init, where a still-
    missing service becomes a named composition error exactly where the old
    bare `Service not found` crash fired.
  - **`providesServices: string[]`** — services a plugin's `init()`
    unconditionally registers; powers the validation and the diagnostics.

  Plugins that declare nothing get the diagnosis too: a `getService` miss
  during Phase 1 now appends which plugin was initializing and — when a
  composed plugin declares the service — who provides it and how to declare the
  ordering. The `Service '<name>' not found` prefix and the factory-backed
  `is async - use await` message are unchanged.

  First adopters: `AppPlugin` declares
  `optionalDependencies: ['com.objectstack.engine.objectql']` +
  `requiresServices: ['manifest']` (cleared on the empty-env no-op path), so
  the #4085 composition — AppPlugin registered before the engine — now boots
  correctly in every slot; `ObjectQLPlugin` declares
  `providesServices: ['objectql', 'data', 'manifest', 'lifecycle']` and
  `MetadataPlugin` declares `providesServices: ['metadata']`.

  Everything is additive — plugins that declare nothing keep their exact
  ordering semantics; no existing declaration changes meaning.

- e4c2dc8: Order temporal operands correctly when one side is a JS `Date` on the two
  type-blind filter backends (ADR-0053 D-A3 / #4191).

  `utcInstantMs` joins `nextUtcCalendarDay` in `@objectstack/spec/data`
  (re-exported from `@objectstack/core`): it reads the UTC instant a temporal
  operand denotes, accepting only unambiguous spellings — a `Date`, epoch ms, a
  bare `YYYY-MM-DD`, and an ISO timestamp with or without an explicit zone (a
  zone-naive one being UTC, per D-B2) — and returning `null` for everything
  else, notably a bare wall clock, which denotes no instant.

  Both type-blind evaluators now use it to compare a `Date` against wire text,
  which JS relational operators cannot do: `<` and friends coerce with hint
  `number`, so the `Date` becomes its epoch and the string becomes `NaN`.

  - `formula`'s `matchesFilterCondition` (the RLS write-side `check`) dropped
    every `Date`-valued row in 10 of the 16 shared conformance cases. The
    post-image is the caller's raw write payload, so an SDK write of
    `new Date()` hit this directly, and fail-closed turned it into a **denied
    write**.
  - `service-analytics`' preview evaluator diverged on the same 10 cases in
    BOTH directions, because `String(new Date())` sorts after every `'2026-…'`
    comparand — a drafted chart both lost rows and gained ones, then changed
    its numbers at publish. Rows from a mongo-backed dataset arrive as BSON
    `Date`s, so this was reachable in normal use.

  Comparisons that did not involve a `Date` are unchanged.

### Patch Changes

- 2af1988: fix(formula,spec,core): the RLS write-side `check` evaluator honours calendar-day upper bounds (ADR-0053 D-D)

  `@objectstack/formula`'s `matchesFilterCondition` — the evaluator behind RLS
  write-side `check` policies (ADR-0058 D4) — compared a bare `YYYY-MM-DD` `$lte`
  bound literally. On a `datetime` post-image that meant a policy of the shape
  `{ signed_on: { $lte: '{today}' } }` **denied every write made after 00:00**:
  the write-side twin of the read-side data loss #3777 fixed, and the last of the
  platform's filter backends that disagreed about what a bare day means as a
  bound.

  `$lte` and a `$between` max now evaluate half-open against the next calendar
  day, matching the SQL compiler, the memory and mongo drivers, and the analytics
  preview evaluator. Unchanged, per the same semantics table: full-ISO bounds keep
  exact-instant semantics, `$gte`/`$gt`/`$lt` keep their midnight anchoring, and a
  plain `YYYY-MM-DD` value compares identically (string ordering makes the two
  forms equivalent). The evaluator stays fail-closed on a null bound.

  **Where the rule now lives.** `nextUtcCalendarDay` moved from
  `@objectstack/core` to `@objectstack/spec/data` — beside `date-macros.zod.ts`,
  whose vocabulary it interprets. `formula` cannot depend on `core`, and a second
  copy of the rule is exactly the divergence #3777 catalogued; `spec` is the one
  package all six consumers already depend on, so this adds no dependency edge.

  No import changes are required: `@objectstack/core` re-exports the symbol, so
  existing `import { nextUtcCalendarDay } from '@objectstack/core'` keeps working.
  New code should prefer `@objectstack/spec/data`.

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

- 7777e8f: fix(spec)!: retire the never-built typed-event system; the lifecycle registry now lists the events that actually fire (#4212 follow-up)

  The lifecycle-event surface promised a typed-event system that was never
  built, in three layers. `kernel/plugin-lifecycle-events.zod.ts` shipped ten
  payload schemas (`PluginRegisteredEvent`, `PluginErrorEvent`,
  `HookTriggeredEvent`, `KernelReadyEvent`, …) and a 21-name
  `PluginLifecycleEventType` enum — zero consumers for every export, and the
  enum was wrong in both directions: 17 names nothing fires, 10 real events
  missing. `contracts/plugin-lifecycle-events.ts` declared the same 17 dead
  names in `IPluginLifecycleEvents` next to 5 real ones, plus an
  `ITypedEventEmitter` interface nothing implements. All of it read as a
  promise; anyone who coded against it (hooking `plugin:started`, awaiting
  `plugin:error`) registered a handler that could never fire, with no error
  saying so — the same silent-drop shape as the #4212 lifecycle-hook family.

  Removed, with zero consumers verified repo-wide:

  - `kernel/plugin-lifecycle-events.zod.ts` and every export: `EventPhase`,
    `PluginEventBase`, `PluginRegisteredEvent`, `PluginLifecyclePhaseEvent`,
    `PluginErrorEvent`, `ServiceRegisteredEvent`, `ServiceUnregisteredEvent`,
    `HookRegisteredEvent`, `HookTriggeredEvent`, `KernelEventBase`,
    `KernelReadyEvent`, `KernelShutdownEvent`, `PluginLifecycleEventType`
    (schemas and inferred types).
  - `ITypedEventEmitter` from `contracts/plugin-lifecycle-events.ts`.
  - The 17 never-fired names from `IPluginLifecycleEvents`.

  `IPluginLifecycleEvents` is now the registry of the **14 events with a real
  emitter** — `kernel:{ready,bootstrapped,listening,shutdown}`, `app:seeded`,
  `metadata:reloaded` (payload `metadata` now optional, matching the documented
  contract), `external.schema.drift`, `ai:routes`, `auth:configure`, and the
  `{service}:ready` convention family (`mcp`, `automation`, `analytics`,
  `external-datasource`, `datasource-admin`) — each payload as observed at its
  fire site. A new `LifecycleEventName` union types
  `PluginContext.hook`/`trigger` in `@objectstack/core` as
  `LifecycleEventName | (string & {})`: known names autocomplete, custom
  cross-plugin names stay legal, existing callers compile unchanged. A pinning
  test asserts two-way equality between the interface keys and the fire-site
  inventory.

  FROM → TO:

  - `PluginLifecycleEventType` → `LifecycleEventName` (the union of names that
    fire). There is no runtime enum; the bus is open by design.
  - Event payload schemas (`KernelReadyEvent`, `PluginErrorEvent`, …) → the
    payload tuples on `IPluginLifecycleEvents`. No wire format existed or
    exists; payloads are in-process arguments.
  - `ITypedEventEmitter` → `PluginContext.hook`/`trigger` (the emitter that
    actually exists).
  - Handlers for the 17 dead names → delete them; they never ran. For plugin
    phase observation use the boot report (ADR-0084); for per-plugin errors the
    kernel throws/logs at the failing phase.

  Plain deletion rather than `retiredKey()` tombstones, per the #4233
  precedent: these keys were never authorable — they described runtime event
  payload records no config author can write, so the silent-strip class the
  authorable-surface ratchet guards against is vacuous. Its baseline entries
  and the `json-schema.manifest.json` keys are dropped deliberately in this PR.
  No ADR-0087 conversion: no stack metadata names these types; there is nothing
  for `os migrate meta` to rewrite.

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

- 857a6cf: fix(cli,core,metadata,runtime): `os serve` boots with no compiled artifact — the platform does not need an application to start (#4085)

  The artifact (`dist/objectstack.json`) defines an **application**. ObjectStack is
  a development platform, so it has to start without one — but `os serve
objectstack.config.ts` died during boot whenever the artifact was absent:

  ```
    Loading objectstack.config.ts...
  [StandaloneStack] artifact read FAILED: path='…/dist/objectstack.json' error=ENOENT…

    ✗ Service 'manifest' is async - use await
  ```

  Exit 1 — on a **known-good app** (`examples/app-todo` fails the same way with
  only its `dist/objectstack.json` moved aside), and on every freshly authored
  project between `os init` and its first `os compile`. The message named neither
  the missing artifact nor a fix, so it read as an internal kernel fault.

  Three separate faults, each of which alone was enough to refuse the boot:

  - **`serve` registered the config-derived `AppPlugin` before the stack's own
    `plugins[]`.** Registration order _is_ the kernel's init/start order, and that
    slot sits ahead of `ObjectQLPlugin` (which registers `manifest`/`objectql`) and
    `DefaultDatasourcePlugin` (which connects the database the app seeds through).
    The wrap is now **appended** to `plugins[]`, the same slot
    `createStandaloneStack` gives its artifact-derived `AppPlugin` — so config-boot
    and artifact-boot share one plugin order. The artifact path never hit this,
    which is exactly what made a plugin-**order** bug look artifact-related.

  - **`ctx.getService()` reported a never-registered service as "is async".**
    `PluginLoader.getService` is an `async` method, so its return value is _always_
    a Promise and its internal "not found" rejection can never surface
    synchronously — the kernel read the answer off that Promise and told every
    caller to `await` a service that did not exist, while the `not found` branch
    below it was unreachable. It now decides from the registry: absent ⇒
    `[Kernel] Service 'x' not found`, registered-but-uninstantiated ⇒ the unchanged
    `Service 'x' is async - use await`. The same crash now reads
    `[Kernel] Service 'manifest' not found`, which points at the layer that is
    actually wrong.

  - **`MetadataPlugin` treated an absent `local-file` artifact as fatal.**
    `createStandaloneStack` always points it at `dist/objectstack.json`, so a stack
    with no app at all could not boot. A **missing** local artifact is now "nothing
    compiled yet": it logs, starts empty, and leaves the artifact watcher armed, so
    a later `os compile` hydrates the running server. The tolerance is
    ENOENT-only — a malformed or unreadable artifact stays fatal — and
    `bootstrap: 'artifact-only'` (sealed runtime, where the artifact _is_ the
    deployment) keeps failing loudly rather than silently serving an empty runtime.

  `[StandaloneStack] artifact read FAILED … ENOENT` is likewise no longer shouted
  at callers for whom "no artifact" is a healthy state; a present-but-unusable
  artifact keeps the loud warning.

  Pinned by an e2e pair that drives the real `os serve` with **no `os compile`
  anywhere**: an app defined only by `objectstack.config.ts` (asserting its object
  is in the started plugin set, not merely that boot survived) and a bare
  `export default {}` platform. The #4012 fixture drops the `os compile` this bug
  had forced on it.

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
- Updated dependencies [2af1988]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
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
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
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
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
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

## 17.0.0-rc.0

### Minor Changes

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

- 763931e: feat(filters): evaluate `{filter-token}` placeholders server-side (#3582)

  Filter values travel as JSON, so a time- or user-scoped slice writes a
  placeholder instead of code:

  ```ts
  filter: { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' }
  ```

  The vocabulary has been in `@objectstack/spec` for a while (`date-macros.zod.ts`,
  `context-tokens.zod.ts`) and `objectstack build` rejects tokens outside it
  (#3574). What was missing is the half that _substitutes a value_: **nothing on
  the server ever did**. A placeholder reached the driver as the literal string
  `'{current_year_start}'`, compared as text, and matched nothing.

  That failure is invisible — an empty widget looks exactly like a metric that is
  legitimately zero — so apps worked around it by computing dates at module load,
  which freezes "this year" into the built artifact and quietly goes stale.

  **New: `resolveFilterTokens()` in `@objectstack/core`**, wired into the two
  server-side seams every filter passes through:

  - **ObjectQL read path** — `find` / `findOne` / `count` / `aggregate`, so REST
    queries, related lists, saved-view filters and flow `find_records` all resolve.
    It runs before the middleware chain, so only author-supplied filters are
    inspected; RLS/sharing filters are injected downstream from concrete values.
  - **Analytics dataset executor** — a dataset's intrinsic `filter`, a widget's
    `runtimeFilter`, measure-scoped filters, and time-dimension `dateRange`s.
    This path needs its own call: `NativeSQLStrategy` compiles raw SQL and binds
    comparands directly, so a dashboard widget never passes through `engine.find()`.

  Behavioural notes:

  - Date tokens resolve to ISO strings (`YYYY-MM-DD`, or a full timestamp for
    `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`). Turning that into a column's
    on-disk form stays the driver's job (`SqlDriver.temporalFilterValue`), so
    there is still exactly one source of truth for the storage convention.
  - Calendar boundaries follow `ExecutionContext.timezone`; one instant is pinned
    per filter tree, so a `>= {current_month_start}` / `< {next_month_start}` pair
    can never straddle a boundary.
  - `{current_org_id}` reads `ExecutionContext.tenantId`; `{current_user_id}` reads
    `userId`. A request carrying neither now **throws** instead of resolving to
    `null` — a null comparand degrades to `IS NULL` on most drivers and would hand
    back the rows the filter was written to exclude.
  - An unrecognised placeholder **throws**, carrying the near-miss fix
    (`{current_user}` → `{current_user_id}`, `{this_quarter_start}` →
    `{current_quarter_start}`). This matches what `objectstack build` already
    enforces. Consequence, previously implicit and now load-bearing: a filter value
    that is _entirely_ `{...}` is always read as a placeholder, so a literal value
    of that shape is not expressible — rename the value.

  Also in this change: `notify` no longer sends the six-character string
  `"undefined"` as an audience member. `to: ['{record.owner.manager}']` walks
  `.manager` on a scalar foreign-key id, resolves to nothing, and `String(undefined)`
  turned that into a phantom recipient — the emit "succeeded", addressed nobody,
  and said nothing. Unresolved recipients are now dropped, and a node with no
  recipient left fails naming the offending template and pointing at the start
  node's `config.expand` (#3475), which does hydrate the relation.

- 4cca74c: fix(i18n)!: the `translation` metadata type speaks the same `objects.` shape everything else does (#3778)

  A translation authored in the product saved successfully and then rendered
  nothing. Not a resolver gap — a contract split. The `translation` metadata type
  (`allowRuntimeCreate: true`, so Studio/the metadata API/an agent can author it)
  was registered against `AppTranslationBundleSchema`, an object-first shape keyed
  on `o.<object>`. Every resolver, `os i18n extract`, `os i18n check`, the objectui
  hooks, and all nine shipped bundles read `objects.<object>`. Nothing bridged the
  two, so the save path and the read path never met.

  **Why converge instead of bridge.** A converter was the obvious fix and the
  wrong one: it would be throwaway code, and it would start producing _working_
  `o.`-shaped rows — closing the migration-free window that exists precisely
  because the feature never functioned. The retired shape's real-world footprint
  was zero: all three `*.translation.ts` files in the tree (platform-objects,
  CRM and todo examples) were already `objects.`-shaped, contradicting the type's
  own registered schema. Converging is a registration fix, not a migration.

  **Breaking.** `AppTranslationBundleSchema`, `ObjectTranslationNodeSchema`, and
  their types are **deleted** — no deprecation cycle. Nothing worked end-to-end
  through them, so there is no functioning consumer to protect, and a
  deprecated-but-present schema is exactly the exemplar an AI agent copies into
  new code. The optional `II18nService.getAppBundle` / `loadAppBundle` methods go
  with them: zero implementers, so they advertised a capability the runtime never
  delivered.

  **The replacement.** `TranslationItemSchema` — one locale of the same
  `TranslationData` groups a file bundle uses, plus the `locale` it translates,
  with a `defineTranslation()` factory. An item is one entry of a
  `TranslationBundle`; that is the whole type.

  Three details are deliberate, all aimed at the failure being silent rather than
  loud:

  - **`locale` is required**, not inferred from the item name. The sync skips an
    item whose locale it cannot resolve, and a skip is invisible to whoever — or
    whatever — authored it. (The name fallback still covers rows written before
    this.)
  - **Retired keys are rejected, not stripped.** Zod drops undeclared keys
    silently, which would reproduce this bug exactly: save succeeds, nothing
    renders. A pre-parse guard turns that silence into a 422 naming the group to
    use (`'o' … — use 'objects.<object_name>'`). It runs ahead of the parse so the
    retired keys stay out of the schema itself — the generated JSON Schema and the
    Studio editor never advertise a shape that cannot work.
  - **`ObjectTranslationData.label` is now optional.** Partial translation is the
    normal state and every resolver already treats each key as independent.
    Requiring it forced authors to restate the source label just to validate,
    filling bundles with fake translations that mask real coverage gaps.

  Also in this change: the authored-translation sync warns (naming the row and the
  fix) when it meets a row still in the retired shape instead of loading it into
  nowhere, and no longer merges publish bookkeeping (`_lockReason`,
  `_packageVersion`, …) into the translation layer. `GET
/i18n/labels/:object/:locale`'s fallback now reads the nested
  `objects.<obj>.fields.<field>.label` data it is actually given — it scanned for
  flat dotted `o.<obj>.fields.<field>` keys, a third dialect no producer ever
  wrote, so it always returned `{}`.

  Migration: author every translation — file or runtime item — under `objects.`.
  `o` → `objects`, `app` → `apps`, `nav` → `apps.<app>.navigation.<id>.label`,
  `dashboard` → `dashboards`, `_globalOptions` →
  `objects.<obj>.fields.<field>.options`, `_meta.locale` → top-level `locale`,
  `_actions.confirmMessage` → `_actions.confirmText`. `reports`, `notifications`,
  `errors`, and `namespace` had no runtime consumer and have no replacement.

### Patch Changes

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
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
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
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0

## 16.1.0

### Minor Changes

- b20201f: fix(service-automation): `runAs:'user'` runs data ops with the triggering user's
  real permission sets + positions, not a bare member fallback (#3356, follow-up to
  #1888)

  Since #1888 the automation engine honours `flow.runAs` (`system` elevates), but
  the `runAs:'user'` credential propagation was hollow. A record-change-triggered
  `runAs:'user'` flow ran its data nodes (`update_record`, …) with a **zero-grant**
  principal — only the `member`/`everyone` baseline — even when the triggering user
  was fully authorized. Two faces by object config: a `private` object 403'd the
  in-flow write (`not permitted for positions [org_member, everyone]` — the user's
  permission sets were invisible); a `public_read_write` object let the write
  through but **silently stripped** readonly/FLS-gated fields. The root cause: the
  ObjectQL record-change hook session carries only a `userId` — never the writer's
  positions/permission sets — and nothing in between resolved them, so the comment
  promising "enforces RLS exactly as the user who made the change" never held.

  The fix resolves the triggering user's **actual** authorization at run setup, from
  the same tables a direct REST request resolves through:

  - **`@objectstack/core`** factors the userId-driven core of `resolveAuthzContext`
    into a new exported `resolveUserAuthzGrants(ql, userId, opts)` — the single place
    that reads `sys_member` / `sys_user_position` / `sys_*_permission_set` and
    derives positions, permission-set names, `platform_admin`, and posture. The
    HTTP resolver now delegates to it (behaviour byte-identical; the full contract
    suite still passes), so a non-HTTP surface that already knows the user id builds
    the SAME envelope instead of re-implementing the reads.
  - **`@objectstack/service-automation`** gains `AutomationEngine.setUserGrantsResolver`,
    wired by the plugin to `resolveUserAuthzGrants` over the objectql/data engine.
    For a `runAs:'user'` run whose trigger left the authz envelope unresolved (no
    `permissions`), the engine now resolves the user's positions + permission sets
    once at run setup and threads them into every data node's ObjectQL context —
    so the run enforces RLS/FLS exactly as that user. Contexts that already carry
    `permissions` are left untouched (a REST trigger, and notably an ADR-0090 agent
    ceiling acting on-behalf-of a user — always non-empty — so a deliberately
    narrowed identity is never re-broadened). `runAs:'system'` is unchanged, and a
    resolver error fails safe (warns, keeps the bare user — never elevates).
  - **`@objectstack/trigger-record-change`** stops forwarding the misleading
    half-populated `positions` (empty in practice, and never `permissions`) from the
    hook session; it forwards `userId` + tenant only and lets the engine resolve the
    full grants authoritatively.

  When no ObjectQL engine is present (bare engine / tests) the resolver is unwired
  and run identity is unchanged from before.

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0

## 16.0.0

### Minor Changes

- dd9f223: feat(analytics): scope a datetime date-bucket drill to the reference-tz midnight instants (#1752 follow-up)

  Closes the one gap left by the initial #1752 change: a `datetime` date dimension
  bucketed under a **non-UTC reference timezone** previously fell back to a superset
  drill (its bucket boundary is that tz's midnight _instant_, which `YYYY-MM-DD`
  calendar bounds can't express).

  - **`@objectstack/core`** adds `zonedDateStartToUtcMs(ymd, tz)` — the UTC instant
    at which a calendar day begins in a reference timezone (the inverse of
    `calendarPartsInTz`). DST-safe: the offset is read from the platform tz
    database via `Intl`, with a two-pass resolution for the rare offset-boundary
    case; an unset/`'UTC'`/invalid zone returns plain UTC midnight.
  - **`@objectstack/service-analytics`** now emits `drillRanges` bounds per the
    field's temporal type (ADR-0053): a `datetime` field → ISO **instant** bounds
    at the reference tz's midnight (works under any tz, incl. DST); a `date` field
    → `YYYY-MM-DD` calendar bounds (tz-naive, exact under any tz). An unknown field
    type is still emitted only under UTC and omitted (superset) under a non-UTC tz.

  No objectui change is needed — the client already forwards whatever bound values
  the server sends into the drill filter and the `filter[field][gte|lt]` URL.

- 290e2f0: feat(analytics): emit a half-open date-range drill scope for granularity-bucketed date dimensions (#1752)

  A report/dashboard cell grouped by a `dateGranularity` date dimension ("2026-Q2")
  covers a SPAN of records, so drilling it needs a range (`>= start AND < nextStart`),
  which the equality drill contract (`drillRawRows`) can't express — date dims were
  therefore excluded from drill metadata and a drill landed on an unscoped superset.

  - **`@objectstack/core`** adds `bucketKeyToCalendarRange(key, granularity)`, the
    inverse of `bucketDateValue`: it turns a canonical bucket key into its half-open
    `[start, end)` calendar span (`YYYY-MM-DD`, `end` exclusive). Pure, timezone-naive
    calendar arithmetic; returns `null` for unbucketable / out-of-range keys so the
    caller falls back to an unscoped (superset) drill rather than emit a wrong bound.
  - **`@objectstack/service-analytics`** emits a `drillRanges` sidecar (aligned to
    `rows` by index — the range companion to `drillRawRows`) for `date` +
    `dateGranularity` dimensions, computed from the canonical bucket key in the
    pre-label-resolution snapshot pass. A `datetime` field under a non-UTC reference
    timezone is omitted (host drills a superset) until instant-boundary support
    lands; a tz-naive `date` field is exact under any timezone (ADR-0053).

  Consumed by objectui's report drill-through to scope the drilled record list to the
  clicked time bucket.

### Patch Changes

- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- 5f05de2: **`createLogger({ file })` now actually writes the file under ESM.** `openFileStream` loaded `fs` with a lazy `require()` to keep the browser-safe logger entry out of the `fs` bundle graph; esbuild rewrites that to its `__require` shim in the ESM output, which throws `Dynamic require of "fs" is not supported`, and a bare `catch {}` swallowed it. Since the workspace is `type: module`, every Node ESM consumer — `os serve`, `os dev` — silently got no file logging at all, while the CJS build kept working. The builtin now loads via `process.getBuiltinModule` (opaque to bundlers, works in both module systems, with a `require` fallback for Node < 20.16), and a `file` destination that cannot be opened reports itself on stderr instead of disappearing.

  Turning the destination back on also fixed three faults that were unreachable while it never opened: `child()` opened a second stream per child and orphaned it, destroying a child logger closed the stream its parent and siblings were still writing to, and an async open failure (e.g. an unwritable path) hit an `'error'` event with no listener and took the process down.

- 021ba4c: fix(core): ObjectLogger honors NO_COLOR and TTY detection before emitting ANSI colors

  The kernel/plugin logger (`ctx.logger`, wired by `os serve` / `os dev`) colorized its
  `pretty`-format level tags unconditionally, so `NO_COLOR=1` runs and piped/CI output
  still carried ANSI escapes (e.g. `\x1b[31m…ERROR\x1b[0m`), breaking plain-text log
  scanners (see scripts/publish-smoke.sh, which had to strip ANSI before grepping).

  Per the no-color.org convention, color is now emitted only when the destination stream
  (stdout, or stderr for error/fatal) is an interactive TTY **and** `NO_COLOR` is unset or
  empty — any non-empty `NO_COLOR` value disables color. Interactive terminals keep the
  existing colorized output. The optional file destination now always receives plain text.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
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

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- dd9f223: feat(analytics): scope a datetime date-bucket drill to the reference-tz midnight instants (#1752 follow-up)

  Closes the one gap left by the initial #1752 change: a `datetime` date dimension
  bucketed under a **non-UTC reference timezone** previously fell back to a superset
  drill (its bucket boundary is that tz's midnight _instant_, which `YYYY-MM-DD`
  calendar bounds can't express).

  - **`@objectstack/core`** adds `zonedDateStartToUtcMs(ymd, tz)` — the UTC instant
    at which a calendar day begins in a reference timezone (the inverse of
    `calendarPartsInTz`). DST-safe: the offset is read from the platform tz
    database via `Intl`, with a two-pass resolution for the rare offset-boundary
    case; an unset/`'UTC'`/invalid zone returns plain UTC midnight.
  - **`@objectstack/service-analytics`** now emits `drillRanges` bounds per the
    field's temporal type (ADR-0053): a `datetime` field → ISO **instant** bounds
    at the reference tz's midnight (works under any tz, incl. DST); a `date` field
    → `YYYY-MM-DD` calendar bounds (tz-naive, exact under any tz). An unknown field
    type is still emitted only under UTC and omitted (superset) under a non-UTC tz.

  No objectui change is needed — the client already forwards whatever bound values
  the server sends into the drill filter and the `filter[field][gte|lt]` URL.

- 290e2f0: feat(analytics): emit a half-open date-range drill scope for granularity-bucketed date dimensions (#1752)

  A report/dashboard cell grouped by a `dateGranularity` date dimension ("2026-Q2")
  covers a SPAN of records, so drilling it needs a range (`>= start AND < nextStart`),
  which the equality drill contract (`drillRawRows`) can't express — date dims were
  therefore excluded from drill metadata and a drill landed on an unscoped superset.

  - **`@objectstack/core`** adds `bucketKeyToCalendarRange(key, granularity)`, the
    inverse of `bucketDateValue`: it turns a canonical bucket key into its half-open
    `[start, end)` calendar span (`YYYY-MM-DD`, `end` exclusive). Pure, timezone-naive
    calendar arithmetic; returns `null` for unbucketable / out-of-range keys so the
    caller falls back to an unscoped (superset) drill rather than emit a wrong bound.
  - **`@objectstack/service-analytics`** emits a `drillRanges` sidecar (aligned to
    `rows` by index — the range companion to `drillRawRows`) for `date` +
    `dateGranularity` dimensions, computed from the canonical bucket key in the
    pre-label-resolution snapshot pass. A `datetime` field under a non-UTC reference
    timezone is omitted (host drills a superset) until instant-boundary support
    lands; a tz-naive `date` field is exact under any timezone (ADR-0053).

  Consumed by objectui's report drill-through to scope the drilled record list to the
  clicked time bucket.

### Patch Changes

- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- 5f05de2: **`createLogger({ file })` now actually writes the file under ESM.** `openFileStream` loaded `fs` with a lazy `require()` to keep the browser-safe logger entry out of the `fs` bundle graph; esbuild rewrites that to its `__require` shim in the ESM output, which throws `Dynamic require of "fs" is not supported`, and a bare `catch {}` swallowed it. Since the workspace is `type: module`, every Node ESM consumer — `os serve`, `os dev` — silently got no file logging at all, while the CJS build kept working. The builtin now loads via `process.getBuiltinModule` (opaque to bundlers, works in both module systems, with a `require` fallback for Node < 20.16), and a `file` destination that cannot be opened reports itself on stderr instead of disappearing.

  Turning the destination back on also fixed three faults that were unreachable while it never opened: `child()` opened a second stream per child and orphaned it, destroying a child logger closed the stream its parent and siblings were still writing to, and an async open failure (e.g. an unwritable path) hit an `'error'` event with no listener and took the process down.

- 021ba4c: fix(core): ObjectLogger honors NO_COLOR and TTY detection before emitting ANSI colors

  The kernel/plugin logger (`ctx.logger`, wired by `os serve` / `os dev`) colorized its
  `pretty`-format level tags unconditionally, so `NO_COLOR=1` runs and piped/CI output
  still carried ANSI escapes (e.g. `\x1b[31m…ERROR\x1b[0m`), breaking plain-text log
  scanners (see scripts/publish-smoke.sh, which had to strip ANSI before grepping).

  Per the no-color.org convention, color is now emitted only when the destination stream
  (stdout, or stderr for error/fatal) is an interactive TTY **and** `NO_COLOR` is unset or
  empty — any non-empty `NO_COLOR` value disables color. Interactive terminals keep the
  existing colorized output. The optional file destination now always receives plain text.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
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

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1

## 15.1.0

### Minor Changes

- f531a26: refactor(security): converge the anonymous-deny decision into one shared function + a source-enumerating ratchet (#2567 Phase 2)

  Phase 1 gated every HTTP surface (REST `/data`, dispatcher `/graphql` + `/meta`,
  raw-hono `/data`) against the secure-by-default `requireAuth` posture, but each
  seam hand-rolled the same `!userId && !isSystem → 401` check. Phase 2 removes
  that duplication and pins the surfaces so a new ungated entry point fails CI.

  - **New `shouldDenyAnonymous` in `@objectstack/core`** (`security/anonymous-deny.ts`)
    — the single anonymous-deny decision + shared 401 body/constants, mirroring the
    `auth-gate.ts` pattern (pure function so the seams can never drift). All five
    seams — REST `enforceAuth`, dispatcher `handleGraphQL` / `handleMetadata` /
    `handleAI`, hono `denyAnonymous` — now delegate to it. **Pure refactor: no
    runtime behavior change** (verified by the unchanged Phase-1 handler + e2e
    proofs). Identity resolution and the dynamic exemptions (public-form grants,
    share-link tokens) are untouched — they run upstream and only ever hand the
    seam an already-resolved context.
  - **A `discover()` ratchet on the authz-conformance matrix** — it statically
    enumerates the data/meta/graphql HTTP entry points from source (curated
    per-file probes, control-plane routes excluded) and asserts each is classified
    by a matrix `covers` key. A new `/data`/`/meta`/`/graphql` route (or a
    removed/stale `covers`) now fails CI as UNCLASSIFIED / STALE, not in review. A
    companion negative test proves the ratchet bites.

  A design trap is guarded: `isAuthGateAllowlisted(undefined)` returns `true`, so a
  body-routed seam (GraphQL, which has no request path) must pass no path — the
  shared function's non-empty-path guard denies anonymous unconditionally there,
  never falling through to the control-plane allowlist.

- f531a26: feat(kernel): add `kernel:bootstrapped` lifecycle anchor — the phase that fires after every `kernel:ready` handler has settled but before `kernel:listening` (HTTP socket open). `kernel:ready` handlers run sequentially in plugin-registration order, so a handler that consumes data produced by a later-starting plugin (e.g. the security bootstrap seeds `sys_position`; the app plugin's seed loader inserts records) would race the very rows it needs. `kernel:bootstrapped` is the correct anchor for reconcile/backfill work: every producer's ready handler has finished by the time it fires. Both `ObjectKernel` and `LiteKernel` trigger it. The sharing-rule boot backfill moves from `kernel:listening` to `kernel:bootstrapped` (semantics-only; behaviour unchanged).

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
- Updated dependencies [4109153]
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

## 15.0.0

### Minor Changes

- 13749ec: ADR-0095 D2/D3: the authorization kernel now resolves an explicit **posture
  ladder** — a monotonic principal tier `PLATFORM_ADMIN > TENANT_ADMIN > MEMBER >
EXTERNAL` — once, in `resolveAuthzContext`, and carries it on
  `ResolvedAuthzContext.posture`.

  - **D2 — the ladder.** New `@objectstack/core/security` module `posture-ladder.ts`
    reuses the spec `AuthzPosture` enum and pins the rung → row-visibility
    injection-rule mapping (exactly one rule per rung) plus its two ADR-required
    invariants as unit-tested properties: strict nesting (rung _n_'s visible set ⊇
    rung _n−1_'s) and the `EXTERNAL` deny-by-default semantics (explicitly shared
    rows only — OWD baselines and sharing rules never widen it). `EXTERNAL` is
    defined and test-locked now but never resolved: no external principal type
    exists yet (portal/ADR-0093), so the resolver's floor is `MEMBER`.
  - **D3 — capability-derived, single track.** The rung derives from held
    **capability grants**, never a better-auth role: `PLATFORM_ADMIN` from the
    unscoped `admin_full_access` grant (the same `viewAllRecords`/`modifyAllRecords`
    evidence the superuser bypass trusts), `TENANT_ADMIN` from the
    `organization_admin` grant. The better-auth `role='admin'` remains only a
    _provisioning source_ of those grants (`auto-org-admin-grant.ts`,
    `mapMembershipRole`); no enforcement path reads the raw role, closing the
    #2836 dual-track adjudication class by construction.
  - New spec export `ORGANIZATION_ADMIN` (the org-admin capability-grant name),
    alongside the existing `ADMIN_FULL_ACCESS`.

  **Behavior-preserving.** Enforcement is unchanged — the per-object Layer 0
  exemption and per-side superuser bypass still gate access exactly as before;
  `posture` is an additive, derived, explainable field. The `authz-matrix-gate`
  unit snapshot and the dogfood authz-conformance matrix stay green. No migration
  required.

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0

## 14.4.0

### Minor Changes

- 82e745e: ADR-0091 L1 — grant validity windows: effective-dated assignments, resolution-time filtering, explain expired state, authoring lint.

  - **plugin-security (objects)**: `sys_user_position` and `sys_user_permission_set` gain the D1 lifecycle columns — `valid_from`, `valid_until` (half-open `[from, until)`, UTC; null = unbounded, existing rows unchanged), `reason`, `delegated_from`, `last_certified_at`, `certified_by`.
  - **core**: new shared predicate `isGrantActive` / `isGrantExpired` (`@objectstack/core`), and `resolveAuthzContext` now filters BOTH grant tables through it (D2, fail-closed — an expired unscoped `admin_full_access` grant no longer derives `platform_admin`). Present-but-unparseable bounds fail closed.
  - **plugin-security (explain)**: `buildContextForUser` applies the same filter and returns `expiredGrants`; the principal layer reports the dedicated "held until … — expired" contributor state so "why did access disappear" is self-answering. Spec `ExplainLayerSchema` contributors gain an optional `state: 'active' | 'expired'`.
  - **plugin-sharing**: `PositionGraphService.expandPositionUsers` filters expired holders — sharing-rule recipients stop including them at resolution time.
  - **lint (D7)**: two new error rules over seed data — `security-grant-expired-at-authoring` (a `valid_until` in the past, or unparseable, is a grant that can never resolve) and `security-delegation-missing-reason` (a `delegated_from` row without `reason` breaks the D3 dual audit). Also re-exported the missing `SECURITY_MASTER_DETAIL_UNGRANTED` constant.

  No background job is involved anywhere — per ADR-0049, an expired grant simply stops resolving, in every edition.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0

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
