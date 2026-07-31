# @objectstack/metadata-protocol

## 17.0.0-rc.1

### Major Changes

- 77fadbf: fix(metadata-protocol,objectql)!: retire the degraded analytics shim — the `analytics` slot stays empty without service-analytics (#3891, #3878)

  The protocol assembly (`assembleMetadataProtocol`, used by both
  `MetadataProtocolPlugin` and `ObjectQLPlugin`'s built-in mode) used to register
  a lightweight `analytics` fallback so `POST /api/v1/analytics/query` kept
  answering on installs without `@objectstack/service-analytics`. That fallback
  is **removed**, and with it the facade methods that existed only to serve it:
  `ObjectStackProtocolImplementation.analyticsQuery` / `getAnalyticsMeta` (the
  class no longer implements `AnalyticsProtocol`).

  Why removal instead of repair (#3891):

  - **It dropped the caller's ExecutionContext at the door.** The dispatcher
    passes `context.executionContext` (#2852), but the shim's `query` was
    unary — aggregation reached `engine.aggregate` with no context, the security
    middleware's empty-principal branch waved it through, and **no RLS or tenant
    predicate was injected**. An authenticated caller got a 200 with rows RLS
    would hide.
  - **It ignored the contract filter.** `AnalyticsQuery`'s canonical filter field
    is `where`; the shim read only a non-contract `filters` key, so a
    spec-conformant filtered request silently returned a full-table aggregate.
  - **Every security gate had to be built twice** (#3770 on the shim vs
    #3867/#3875 on the real engine) — the "duplicates logic only, harmless"
    assessment in ADR-0076 D10 did not survive contact with reality.

  `getDiscovery()` stops hardcoding analytics as an always-on kernel service —
  the entry is now computed from the service registry like every other optional
  service (`enabled: false, status: 'unavailable'` and **no advertised route**
  when absent), which also removes the pre-#2462 discovery lie the shim was
  originally invented to make true.

  **Migration.** Deployments that relied on the fallback (programmatic
  `createStandaloneStack()` / `createObjectQLKernel()` embeds, hosts whose bundle
  doesn't require `analytics`): install `@objectstack/service-analytics` and
  mount `AnalyticsServicePlugin` — the real, context-aware engine. Without it,
  `/api/v1/analytics/*` now answers **404 ROUTE_NOT_FOUND** (previously: 200 with
  unscoped, unfiltered aggregates) and discovery reports
  `analytics: { enabled: false, status: 'unavailable' }`. Callers of
  `protocol.analyticsQuery(...)` / `protocol.getAnalyticsMeta(...)` must use the
  `analytics` service (`kernel.getService('analytics')`) instead. `os serve`
  default/full presets and managed environments already force the real engine and
  are unaffected.

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

- f4d7f1d: fix(metadata-protocol,rest): the id list is the only thing deleteMany can select on (#3897)

  `deleteManyData` built the predicate its endpoint is named after and then spread
  the caller's `options` **over** it:

  ```js
  return this.engine.delete(request.object, {
    where: { id: { $in: request.ids } },
    ...request.options, // ← lands after `where`, so it can replace it
  });
  ```

  `request.options` is caller-supplied — `POST /data/:object/deleteMany` splatted
  the whole request body into the protocol request (`{ object, ...req.body }`) —
  so one body key rewrote the operation:

  ```json
  { "ids": ["a"], "options": { "multi": true, "where": {} } }
  ```

  reached `engine.delete` as an unscoped bulk delete. The engine's write
  middleware still composes RLS/sharing predicates onto the AST, so the blast
  radius is not automatically the whole table: it is **everything the caller is
  allowed to delete**. For an ordinary user with delete permission that is the
  difference between the 3 records they asked for and every record they can see;
  measured on a stock CRM dev deployment, that payload against one id removed all
  8 rows in the object and returned the raw driver count (`8`). The same spread
  also accepted `context`, i.e. a forged principal wherever the route is reachable
  without auth.

  **The id set is now authoritative, structurally.** The engine options are built
  from the validated id list and nothing else — caller `options` is a
  `BatchOptions` bag (`atomic` / `returnRecords` / `continueOnError` /
  `validateOnly`) that carries nothing `engine.delete` consumes, so merging it
  could only ever smuggle in engine keys. Ids must be scalars, so an operator
  object (`{"ids":[{"$ne":null}]}`) cannot reach `where.id` either; a malformed
  list is a `400 VALIDATION_FAILED` instead of a wider delete. The REST route
  parses the body against `DeleteManyDataRequestSchema` first, one hop earlier —
  Zod object schemas strip unknown keys, so `options.where`, top-level `where` and
  a body `context` no longer survive the ingress at all.

  **The endpoint also works now.** `deleteManyData` never set `multi`, so a
  correctly-formed `{"ids":[…]}` hit the engine's
  `'Delete requires an ID or options.multi=true'` throw — only the requests that
  triggered the override above ever completed. Deletes now go one id at a time by
  primary key, the same shape `batchData`'s `delete` case uses, which closes two
  gaps behind that: the bulk branch skips `cascadeDeleteRelations`, so
  `deleteBehavior` (`cascade` / `set_null` / `restrict`) was not honoured for the
  rows it removed; and the declared `BatchUpdateResponse` contract (per-record
  `results`, `atomic`, `continueOnError`) was unimplementable from a bulk row
  count. Both are delivered rather than declared.

  **Behaviour change.** The endpoint returns a `BatchUpdateResponse`
  (`{ success, operation, total, succeeded, failed, results }`) where it
  previously returned the driver's raw delete count — on the paths where it
  returned anything at all. The caller's execution context is threaded to every
  delete, so RLS/FLS now run under the caller here as they do on the single-record
  route.

- b09d8d9: refactor(data)!: `query.distinct` is removed, and with it the mis-wired REST count suppression (#4286 step 4)

  `distinct` promised `SELECT DISTINCT` and no driver ever rendered it — but it
  was **mis-wired rather than merely dead** (#4286 finding 2, the harsher
  ADR-0078 class): its only observable effect platform-wide was that the REST
  list path treated a distinct query as _not countable_, silently degrading
  `total`/`hasMore` to a page-local estimate while still returning duplicate
  rows. A caller — or a self-verifying agent — saw the response change and
  concluded the flag worked. It had a shipped public producer
  (`QueryBuilder.distinct()`).

  **FROM → TO**

  | Was                                      | Now                                                                               |
  | :--------------------------------------- | :-------------------------------------------------------------------------------- |
  | `distinct: true` for unique combinations | `groupBy: ['category']`                                                           |
  | `distinct: true` + count                 | `aggregations: [{ function: 'count_distinct', field: 'category', alias: '...' }]` |
  | one column's distinct values             | the SQL/memory drivers' `distinct(object, field)` door (driver-level)             |

  The one-line fix: **delete the key**; deduplicate with `groupBy` /
  `count_distinct`.

  Mechanics: `retiredKey()` tombstones on both declaration sites
  (`QuerySchema.distinct` and `EngineQueryOptionsSchema.distinct`, one shared
  prescription); `QueryBuilder.distinct()` is deleted; registered as the
  protocol-17 semantic migration `query-distinct-retired`. **Observable REST
  change (`@objectstack/metadata-protocol`):** the count-suppression branch is
  deleted — a list request that used to carry `distinct` now gets a real
  `total`/`hasMore` again (that restoration is the point, not a side effect).
  The per-aggregation `distinct` flag (`AggregationNode.distinct`) is a
  different, live member and is untouched.

- b09d8d9: feat(objectql)!: `query.having` is enforced — the engine applies it after aggregation (#4286 step 3, ADR-0049 resolved to enforce)

  `having` had been declared on the request surface since AST v2 and executed by
  nothing. #4286 finding 1 showed the gap was structural: `engine.aggregate()`
  rebuilt the driver AST with exactly `object`/`where`/`groupBy`/`aggregations`,
  so even a driver that _did_ implement HAVING could never have received it, and
  the one wire path (`findData`'s aggregate branch) dropped the clause too. It
  was the strongest enforce candidate of the #4286 set — the clause every
  SQL-literate author (human or model) expects to work next to
  `groupBy`/`aggregations` — and it is now live end to end:

  - **Engine-owned, both paths.** `applyHaving()`
    (`packages/objectql/src/having-filter.ts`) runs AFTER aggregation on the
    native-driver path and the in-memory fallback alike — the same
    correct-first / optimize-later two-tier shape date bucketing uses. Native
    SQL `HAVING` pushdown can come later behind a driver capability flag without
    changing semantics.
  - **Namespace: the aggregated row's own columns** — aggregation aliases
    (`order_count`, `total`) and groupBy projections — with the ordinary
    FilterCondition operators plus `$and`/`$or`/`$not`.
  - **An unknown operator rejects loudly.** Ignoring one (as tolerant matchers
    do) would silently return unfiltered aggregates — the exact ADR-0078
    silently-inert failure enforcement exists to end.
  - **The wire path forwards it.** `findData`'s aggregate branch passes
    `having` through, and `EngineAggregateOptionsSchema` now declares it.
  - The FLS predicate guard already walked `having` references
    (`predicate-guard.ts`), which is what made enforcement safe to turn on.

  No migration needed: queries that carried `having` before were silently
  returning every group; they now filter as written. A caller who depended on
  the clause being _ignored_ (sending `having` and expecting unfiltered
  results) sees the corrected behavior — that is the enforcement, not a
  regression.

- 4475c59: fix(metadata)!: a `$filter` array that is not a filter AST is rejected, not passed through (#4121)

  `isFilterAST` was being read as a _conversion_ gate: an array it refused was
  assigned to `options.where` unconverted, leaving each backend to make sense of a
  value the protocol had already decided it could not parse.

  Item 2 of #3948, filed as error-locality work. The investigation found it is
  more than that.

  **It closes the last silently-unfiltered shape.** #3948 made the drivers throw
  on a bare triple with an unknown operator and on any element that is neither a
  join keyword nor a condition array. What it could not reach is a lone `['and']`
  or `['or']`: the driver sets its join mode, matches no element, emits **no
  predicate**, and returns every row. `isFilterAST` refuses it (a logical node
  needs `length >= 2`), so it arrived as an opaque `where` and no driver-side
  check applied. That is now a 400.

  **For every other shape this is not a narrowing.** driver-sql throws on all of
  them, driver-memory throws, driver-mongodb reaches its own parser and fails at
  the server. Rejecting at the protocol changes _which_ error the caller sees, not
  _whether_ there is one — and the message is in the request's own vocabulary
  (`unrecognised operator "not in"`, `element 1 is number`, plus the recognised
  operator list) rather than a driver's internal builder state.

  Scoped narrowly, because the regression to fear is rejecting something valid:

  - only `Array.isArray(filter)` values are in scope — a `where` **object** is
    untouched, including `$and`/`$or`/`$gte` shapes;
  - an empty `[]` is left alone: it means "no filter", and every path already
    treats it that way;
  - `isFilterAST` accepts nested arrays, so `[[a,'=',1],[b,'=',2]]` and
    `['and', […], ['or', …]]` keep converting. A naive "arrays are suspect" rule
    would have broken exactly those, which is why the accepted shapes are pinned
    by more tests than the rejected ones.

  Errors carry `status: 400` and `code: 'INVALID_FILTER'`, matching the
  `UNSUPPORTED_QUERY_PARAM` convention alongside.

  Verified: 12 new tests driving the real `findData` normalisation, not a
  re-implementation of its rule — six for shapes that must keep converting, six
  for shapes that must be rejected, including the exact message text. Reverting the
  change fails six of them. Full `@objectstack/metadata-protocol` suite: **122
  tests across 19 files**, green.

- 8d5bb5a: feat(metadata): `saveMeta` persists the operator spellings the spec normalized (objectui#2945)

  `ViewFilterRuleSchema.operator` is `z.preprocess(normalizeFilterOperator, …)`, so
  a stored `notEquals` / `gt` / `isNull` is folded to its canonical form during
  save-time validation — and then the result was thrown away. `saveMetaItem`
  persists the authored body verbatim, deliberately: `parsed.data` strips the
  Studio-only auxiliary fields (`isPinned`, `isDefault`, `sortOrder`) that ride
  along with an overlay document (ADR-0005 §Validation).

  The consequence is that **every save mints new legacy-alias rows.** The ~30
  entries in `VIEW_FILTER_OPERATOR_ALIASES` are documented as _"a migration bridge
  [that] may be dropped in a future major"_, but there is no point at which the
  last alias row is behind you, so the bridge can never be dismantled — a
  migration that rewrote every existing row would be obsolete the moment the next
  console personalization PUT landed. That is prerequisite 2 of the vocabulary
  consolidation blocked in objectstack-ai/objectui#2945.

  `graftNormalizedOperators` grafts the normalization back on without giving up the
  verbatim body. It walks the authored value and `parsed.data` in lockstep **by
  structure** and copies across exactly one thing: an `operator` whose parsed value
  differs from the authored one.

  - **No key list to maintain.** `ViewFilterRule[]` appears at five declared sites
    today (view `filter`, `ViewTab.filter`, page `filterBy`, and two
    `component.zod.ts` block props) and the structural walk covers all of them,
    plus any added later. Enumerating paths would have reproduced in this file the
    exact duplication #2945 exists to remove.
  - **Nothing else moves.** Only an `operator` string is rewritten, and only where
    both sides are strings — so a `$`-token `FilterCondition`, a different operator
    vocabulary entirely, cannot be reshaped by accident. No key is added, removed,
    reordered or defaulted; the unary `{field, operator}` form does not acquire a
    `value` even though the schema's own output would give it one.
  - **Nothing is allocated when nothing changed**, so a body already written in
    canonical form is returned by identity.

  Behaviour change worth stating plainly: a `GET` after a `PUT` now returns the
  canonical spelling rather than the one the author sent. That is the spelling the
  spec defines, every renderer accepts it (objectstack-ai/objectui#2974,
  objectstack-ai/objectui#2989 pinned all three of objectui's translation tables to
  the full vocabulary), and it is the point of the change. Existing rows are not
  touched — this stops the bleeding, it is not the migration.

  Verified: 11 new tests, including one that drives **every** alias the spec still
  folds through the real `ViewMetadataSchema` and asserts the persisted body comes
  out canonical; full `@objectstack/metadata-protocol` suite 110 tests / 18 files
  green.

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

- 0373d52: Both discovery builders now derive the `data` service entry from the implementation in the slot, closing the hardcoded "kernel-provided" block (#4130).

  #4089 computed `metadata`; `data` was the last entry that judged itself, reporting `status: 'available'` and `handlerReady: true` unconditionally. That was true — but by a convention in a different package, not by anything either builder checked: ObjectQL is the slot's only producer, and plugin-dev always loads `ObjectQLPlugin` as a child, so plugin-dev's `data` stub (`find()` returns `[]`, `insert()` mints an id and stores nothing) never reaches the slot. A second producer, or a trimmed dev config, and the hardcode starts lying about the platform's most load-bearing capability.

  Both builders now read the registered service's `__serviceInfo`:

  - a real engine carries no marker ⇒ `available` + `handlerReady: true`, byte-identical to the hardcode it replaces (verified on a real kernel boot);
  - a self-declared stub ⇒ its own `status` and `message`, with `handlerReady: false` (the default for `stub`), so a consumer that gates on `handlerReady` stops treating an empty query engine as a real one.

  `handlerReady` is derived here rather than pinned `true` as it is for `metadata`, because the two routes differ: `/meta` answers from the protocol whatever fills the metadata slot, while `/data` needs the `protocol` or an objectql-shaped service and 503s without them — and the only stack where a stub occupies the `data` slot is one where ObjectQL never registered. No routing, gating or dispatch behavior changes: the `data` domain resolves its engine directly and never consulted this slot.

- 4f30943: Both discovery builders now compute the `metadata` service entry from the implementation that fills the slot, instead of hardcoding opposite verdicts for it (#4089).

  `metadata` sat in a "kernel-provided (always available)" block above the loop that reads `__serviceInfo`, hardcoded separately in each builder — and the two disagreed about the same slot:

  - `@objectstack/runtime`'s dispatcher declared it permanently `status: 'degraded'` with `message: 'In-memory registry; DB persistence pending'`, so a stack with `MetadataPlugin` and a real `sys_metadata` table was still reported as having no persistence.
  - `@objectstack/metadata-protocol` declared the same slot permanently `status: 'available'`, so the kernel's in-memory fallback (`createMemoryMetadata`, auto-registered when no metadata plugin is present) read exactly like a persisted registry — the `__serviceInfo` marker #4058 gave it went unread here.

  Both now read the registered service's `__serviceInfo` (via `readServiceSelfInfo`) and report what it declares:

  - kernel in-memory fallback, or plugin-dev's dev registry → `status: 'degraded'` plus that implementation's own `message`, which names what is missing and what to install.
  - `MetadataPlugin` (or any implementation carrying no marker) → `status: 'available'` with no message.

  `handlerReady: true` is now stated unconditionally on both sides: it answers "is `/api/v1/meta` mounted?", and that route is served by the protocol whichever implementation occupies the slot — a degraded service in it does not unmount the route. Nothing about routing, gating, or dispatch changes; consumers that treat `status` as a capability claim (AI agents, the console) simply stop being told two different things by two hosts.

- 86a71d1: Discovery's "install this to enable" now names a package that exists (#4093 follow-up).

  Discovery tells a consumer two things about an absent capability: that it is absent, and what to do about it. The first has been carefully honest since #2462/#4000. The second was invented from the slot name.

  The dispatcher templated `Install a ${slot} plugin to enable` across twelve slots, and `metadata-protocol` carried a hand-written table in which **ten of fifteen entries named a package that does not exist** — `plugin-redis`, `plugin-bullmq`, `job-scheduler`, `plugin-notifications`, `plugin-storage`, `plugin-automation`, `ui-plugin`, plus `plugin-ai`, `plugin-search` and `plugin-workflow` for slots nothing implements at all. That value is also surfaced as discovery's `provider`.

  A remedy naming a package that cannot be installed is a dead end handed to someone at the exact moment they are trying to fix their stack — and an agent reading discovery cannot tell it apart from a package it should install. It is the same `declared ≠ enforced` failure this lineage has been closing, one level over: not "does the capability exist" but "is the fix real".

  `CORE_SERVICE_PROVIDER` and `serviceUnavailableMessage()` in `@objectstack/spec/system` are now the one place that sentence is written, and both discovery builders read them, so the two hosts cannot tell a consumer to install different things (the drift #4089 and #4130 closed for the `metadata` and `data` entries). Entries were verified against what actually calls `registerService` for each slot rather than against name similarity — which is how `notification` turned out to be filled by `@objectstack/service-messaging`, the one slot whose package shares no word with its name.

  Four slots — `ai`, `search`, `workflow`, `graphql` — have no implementation anywhere, so they now say so instead of naming a plausible package. `ui` keeps the fuller sentence it got in #4146 (`/ui` is served by the `protocol` service; nothing registers the `ui` slot), and that sentence now reaches both builders instead of one.

  `scripts/check-service-providers.mjs` (wired into the lint workflow as `check:service-providers`) fails CI when a named package is not a real workspace package, or when a `CoreServiceName` slot has no entry — so a rename or a deletion cannot leave a stale instruction behind.

  FROM → TO: `services.<slot>.message` and `services.<slot>.provider` change text for most unavailable slots. Anything matching on the old `Install a <slot> plugin to enable` wording should match on `status: 'unavailable'` instead — the status field is the contract; the message is prose for humans and agents.

- bb192c4: Gate every dispatcher service domain on `handlerReady` instead of on slot occupancy (#4058 step 2).

  #4000 made the `/analytics` domain execute ADR-0076 D12's third conclusion ("consumers treat only `handlerReady: true` as a real capability"); every other domain still gated on "is a service registered", so a self-declared stub occupying `automation` / `notification` / `ai` / `file-storage` / `i18n` was called like a real implementation and its fabricated answer went out as a 200. Step 1 (#4082) made the two kinds of dev implementation distinguishable; this is the gate that reads the distinction.

  - The `/analytics`, `/automation`, `/notifications`, `/ai`, `/storage` and `/i18n` domains, the route-mount gate, discovery's `routes`/`features`, and the metadata-protocol builder's route advertisement now share one predicate (`isServiceServeable`): a slot whose occupant self-declares `handlerReady: false` is answered exactly as an empty slot is — the domain's existing 404, or the explicit 501 `/storage` and `/i18n` use. One predicate, so what is advertised and what is served cannot disagree.
  - `handlerReady`, not `status`, is the test. An implementation that declares `degraded` defaults to `handlerReady: true` and keeps serving — which is why the in-memory `file-storage` and `i18n` implementations are unaffected.
  - `discovery.services.*` stays presence-gated: a registered stub still reports `{ enabled: true, status: 'stub', handlerReady: false }` (with no `route`), which says strictly more than collapsing it to `unavailable` would.
  - `/ai` improves for the stub case: an occupied-but-unserveable slot used to fall through to a 503 "AI service routes not yet initialized" and lose the `GET /ai/agents` empty-list answer the console polls for on every navigation. Both are restored.

  No change for a host whose services are real implementations. If you register your own stub under one of those six slots and relied on the dispatcher calling it, either drop the `handlerReady: false` self-declaration (declare `degraded` if it genuinely serves) or install the real service. Not gated, deliberately: `/data`, `/meta`, `/auth` and the security path — their dev stubs back the dev stack's own core loop, and gating them would 404 the dev stack itself.

- ed77493: fix(objectql,spec): `filter` folds to `where` on EVERY engine method, and `top`/`limit` joins the #3795 slot table (#4346)

  The `filter` → `where` fold that #3795 settled at the protocol layer existed
  at the **engine** layer in exactly one of six methods. `ObjectQL.find()`
  folded it; `findOne`/`count`/`update`/`delete`/`aggregate` passed the option
  bag through with `ast.where === undefined`, which every driver reads as "no
  predicate" — so a caller filtering with `{ filter }` silently matched EVERY
  row:

  | call                                 | before                  | after          |
  | ------------------------------------ | ----------------------- | -------------- |
  | `findOne({filter: {status:'done'}})` | first row of the table  | a matching row |
  | `count({filter})`                    | whole-table count       | matching count |
  | `update(data, {filter, multi:true})` | **every row rewritten** | matching rows  |
  | `delete({filter, multi:true})`       | **table emptied**       | matching rows  |
  | `aggregate({filter, …})`             | aggregated all rows     | matching rows  |

  This was reachable, not theoretical: the deprecated
  `DataEngine{Query,Update,Delete,Count,Aggregate}OptionsSchema` contracts all
  declare `filter`, `ScopedContext`/`ObjectRepository` (the cross-object API
  handed to L2 hook bodies) forwards its argument verbatim, and the spec's own
  hook documentation taught the broken call
  (`users.findOne({ filter: { role: 'admin' } })` — now corrected to `where`).

  Every engine entry point now folds through the spec's own #3795 machinery
  (`RPC_QUERY_ALIAS_SLOTS` + `foldQueryAliasSlots`) instead of `find`'s
  hand-rolled copy, under the #4181 rule: an alias alone folds, redundant
  identical spellings collapse, DIFFERENT values for one slot throw
  ("Send exactly one") instead of silently picking a winner, and an explicit
  `null` alias is a withdrawal.

  **The sixth pair.** `top` → `limit` — the pair the #3795 scope note excluded
  as "the OData layer" — joins `RPC_QUERY_ALIAS_SLOTS`. The protocol normalizer
  folded it BACKWARDS (`options.limit = Number(options.top)` — the alias
  overwrote the canonical key) while `engine.find` folded it canonical-wins, so
  `{top: 1, limit: 3}` answered 1 over HTTP and 3 through a direct engine call.
  All three readers (wire normalizer, RPC schema parse, engine) now resolve the
  pair identically: `top` alone still limits, a conflicting `{top, limit}` is
  refused.

  Behavior change to note: option bags that previously smuggled conflicting
  spellings (`{where: X, filter: Y}`, `{top: 1, limit: 3}`) are now refused
  loudly on every path instead of silently resolving differently per layer.
  Pinned per method, write paths included — a regression here is silent and
  destructive, and the class went unnoticed precisely because `find` was the
  only method anyone thought to check.

- 58a03d2: fix(objectql,spec,metadata-protocol,service-queue): engine option bags are now a closed contract — unknown keys throw instead of silently doing nothing (#4371 option 2)

  The engine declares `Engine*OptionsSchema` but never parses it at runtime, so
  any option key outside the contract — a typo (`orderby`), a retired key
  (`cursor`), a wire-protocol leftover (`object`, `count`), a key that only
  works on other methods (`tenantId` on `count`) — rode along and was silently
  ignored. All six methods now reject non-null unknown keys, naming the legal
  set; retired keys (`cursor`/`distinct`) quote their #4286 tombstone; `null`
  stays a withdrawal.

  Per-method legal keys = the method's schema keys plus the documented extras:
  `searchFields` (now declared on `EngineQueryOptionsSchema` — it was read by
  the engine's `$search` expansion and sent by the protocol layer all along),
  `onFieldsDropped` on `update` (contract-declared write observability), and
  the driver pass-through keys (`transaction`, `tenantId`, `tenantIds`,
  `timezone`, `bypassTenantAudit`, `preserveAudit`) on `find`/`findOne`/
  `update`/`delete` — the methods whose bag actually reaches driver options.
  `count`/`aggregate` never forward their bag, so pass-through keys there are
  rejected rather than accepted-and-ignored. A drift pin holds the sets equal
  to the schemas.

  Also closed in the same sweep:

  - A bag-level `object` key used to OVERRIDE the resolved object on the query
    AST (`{ object, ...query }` spread order), splitting `ast.object` from the
    table actually queried. The AST now keeps the resolved name; a direct call
    passing `object` is rejected, and the protocol layer refuses a POST-body
    `object` that contradicts the route (400 `QUERY_OBJECT_MISMATCH`) instead
    of picking a winner.
  - `findData` no longer leaks protocol-layer vocabulary (`object`, `count`,
    `joins`, `windowFunctions`, `cursor`, `distinct`, non-aggregate `having`)
    onto the engine bag.
  - Nested expand ASTs (`expand: { rel: { sort } }`) reject the four wire-only
    spellings exactly like the top-level bag (#4371 option 1 did the top level).
  - The engine's OData-spelling reads (`$search`/`$searchFields`) are gone —
    the protocol normalizes to the bare keys; a direct call passing them now
    throws instead of half-working on one method.
  - `DbQueueAdapter.purge`/`purgeFailed` passed `{ id }` — a key the engine
    never read, so purge deleted NOTHING (each delete threw into a warn-level
    catch) and purgeFailed always threw. Both now pass `{ where: { id } }`;
    the test fake's `delete` no longer accepts the signature the real engine
    rejects.

  Migration for direct engine callers (wire/HTTP callers are unaffected): pass
  only the keys your method's `Engine*OptionsSchema` declares (plus the extras
  above). Anything else previously did nothing — delete it, or move it to the
  layer that owns it.

- e59786e: fix(spec): five exported symbols resolved to `any` — type the recursive schemas and gate it in CI (#4171)

  A recursive Zod schema needs an explicit annotation to break its circular
  inference, and five of them took the cheapest one available:

  ```ts
  export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => …);
  export type NavigationItem = z.infer<typeof NavigationItemSchema>;   // → any
  ```

  It compiles, it validates correctly at runtime, and it silently throws the type
  away. `NavigationItem`, `FormField`, `JoinNode` and `NormalizedFilter` were all
  `any` on the published surface, plus `FieldNodeSchema` — which had no exported
  type alias yet, so `z.infer<typeof FieldNodeSchema>` was `any` and
  `QueryAST['fields']` with it.

  That is worse than a missing export. #4115 tells every consumer that a local
  declaration under a spec export's name must be replaced by a binding to the
  spec — and for these, obeying it **replaced a precise type with `any`**.
  objectui's `NavigationItem` is a 118-line documented interface (`recordId`
  template variables, `requiresObject` / `requiresService` capability gates,
  `filters` precedence); every key of it exists in the spec's version, so by every
  available signal it read as a redundant fork safe to delete. Deleting it swapped
  a fully-typed interface for `any`, with no compile error anywhere to say so.

  It is hard to catch by inspection because `any` is mutually assignable with
  everything, so the natural "are these the same type?" check answers _yes_ in both
  directions and recommends precisely the wrong action. Same failure family as
  #4075's `[key: string]: any` on `ActionDef`: a type that agrees with everything
  reads as agreement.

  **Now annotated with the real type**, using the pattern `QueryAST` already
  follows in `data/query.zod.ts` — infer the non-recursive part, tie the recursive
  knot in the type, so the keys stay derived from the schema instead of being
  hand-maintained beside it:

  ```ts
  const BaseXSchema = z.object({ …every non-recursive key });
  export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
  export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
    children: z.array(XSchema).optional(),
  }));
  ```

  `z.infer` now resolves to the type it should always have been: `NavigationItem`
  is the nine-branch discriminated union, `FormField` the 30-key form-field
  contract (with `visibleOn` absent by construction — ADR-0089 D2 folds it into
  `visibleWhen` at the boundary), `JoinNode` and the newly exported `FieldNode`
  the query AST nodes, `NormalizedFilter` the normalized filter AST. Runtime
  validation is unchanged: every schema parses exactly what it parsed before.

  **What the types immediately caught**, none of it visible while they were `any`:

  - `account.app.ts` set `defaultOpen` on three nav groups — a key the spec has
    never declared. It worked only because objectui's `NavigationRenderer` still
    falls back to that legacy alias. Fixed at the producer per Prime Directive
    #12: the canonical key is `expanded`.
  - The MongoDB driver built its projection with `projection[field] = 1` over
    `query.fields`, so a relationship `FieldNode` would have keyed the projection
    on `"[object Object]"`. It now reads the node's field name.
  - `setup.app.ts`, `studio.app.ts` and `setup-nav.contributions.ts` are annotated
    with the PARSED `App` / `NavigationContribution` types but omitted
    `.default()`ed keys (`expanded`, `target`), as did the form fields
    `metadata-protocol` synthesizes for `getUiView` (`span`). Each now states the
    default it was relying on, matching what the surrounding literals already do
    for `active` / `isDefault` / `collapsible` / `collapsed` / `columns`.

  **Gated, not just fixed** (`check:exported-any`, wired into the required
  `TypeScript Type Check` job). `api-surface.json` records that an export _exists_
  and never what it _resolves to_, which is how these survived a whole major with
  every gate green. The new scan reads the built `.d.ts` a consumer's import
  actually resolves to and fails on any exported type that resolves to `any` — or
  any exported schema whose output is `any`, the root cause, and the only reason
  `FieldNodeSchema` was visible at all. Its `KNOWN_ANY` ledger is shrink-only and
  currently empty. It self-tests against the real zod first, so if the internals it
  reads are ever renamed the gate fails loudly instead of quietly passing
  everything forever.

- a4a9944: fix(metadata-protocol): findData must not take its execution context from the request (#3960)

  Came out of the #3946 sweep's leftover question — whether `expand`'s "advanced
  usage" (a caller-supplied `Record<string, QueryAST>` whose sub-ASTs each carry an
  `object`) is a cross-object read channel. **It is not**, and that needs saying
  because the answer is load-bearing: `expandRelatedRecords` takes its target from
  the parent schema (the expand KEY must be a real `reference` field; the sub-AST's
  `object` is never read), re-enters `engine.find` so the referenced object's RLS +
  FLS both run, `$and`-merges a nested `where` instead of spreading it over the id
  filter, and caps depth. No change needed there.

  What the investigation did turn up is one layer down. `findData` built its engine
  options as `{ ...request.query }` and then assigned `context` from
  `request.context` **conditionally**:

  - `request.query` is the caller's raw bag on every ingress — the REST
    `POST /data/:object/query` route passes `req.body` straight in as `query`;
  - `context` sits in the known-params set, so it was not swept into the
    implicit-filter bucket either — it survived the spread untouched;
  - so when no server context resolved, the caller's `context` _became_ the
    operation's execution context.

  Everything hangs off that value. plugin-security's middleware opens with
  `if (opCtx.context?.isSystem) return next()` — the entire RLS / FLS / CRUD chain
  skipped — and `__expandRead: true` collects the #2850 waiver on the object-level
  CRUD gate. Neither is ever schema-stripped on the read path:
  `ExecutionContextSchema.parse` runs only in `engine.createContext`, which reads
  do not use.

  Route-level `enforceAuth` is what kept this unreachable: anonymous data requests
  are refused unless a deployment sets `requireAuth: false`. That makes it a
  fail-OPEN default rather than a live exploit — and not something the protocol
  should delegate upward. `findData` now drops any inbound `context`
  unconditionally before the assignment, so the execution context can only come
  from `request.context`.

  Verified end-to-end at the protocol layer (a forged
  `{ isSystem, userId, __expandRead }` reached `engine.find` verbatim before, is
  dropped after). The anonymous HTTP reachability half is NOT verified — see #3960
  for exactly what was and was not reproduced. No caller regresses: the only
  in-repo builder of these args (`rest/src/import-runner.ts` `findArgsBase`) passes
  `context` at the top level, never inside `query`.

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

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                              |
  | :---------------------------------------------------------------- | :--------------------------------------------------------------- |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`        |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                              |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | `fields: ['owner.name']` (dotted path)                           |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias` |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- f5fe061: fix(data): implicit field filters compose with an explicit `filter` by AND instead of being silently dropped (#4164)

  `GET /api/v1/data/:object?filter={"status":"open"}&owner_id=usr_1` used to
  apply only the explicit filter: the bare `owner_id` predicate was neither
  merged nor reported — it rode to the engine as a stray AST key no driver
  reads, and the response over-returned. The mirror of #4134's silent zero,
  same disease, opposite direction.

  The two now compose the way the request reads: `{ $and: [explicit, implicit] }`
  — the same combinator the engine already uses to fold the `search` predicate
  into an existing `where`, and one the cross-backend filter-logic conformance
  suite pins. Contradictory sides (`?filter={"status":"open"}&status=closed`)
  apply both predicates and intersect to an honest empty set. Pagination totals
  (`total` / `hasMore`) are computed over the merged predicate, so they cannot
  disagree with `records`.

  **What changes for callers:** requests that sent both an explicit `filter` and
  bare field parameters now get the narrower, as-written result set instead of
  the explicit filter alone. Requests sending only one of the two mechanisms are
  unaffected. Thanks to #4134 (shipped previously), every bare parameter that
  reaches the merge is a verified field name, so the merge can never introduce a
  zero-matching predicate.

- 6c87cc9: fix(data): a filter the server cannot apply is rejected, not silently ignored (#4181)

  `GET /api/v1/data/:object?filter={status:done` — one missing quote — answered
  `200` with the **unfiltered** page. The JSON-parse tolerance
  (`catch { /* keep as-is */ }`) left the raw string on `where`, a shape no
  driver consumes, so the filter was dropped whole and the response was
  byte-for-byte a successful unfiltered query. The worst failure direction in
  this family: #4134 returned nothing, #4164 dropped one predicate, this
  returned everything.

  The sibling `GET /data/:object/export` route had rejected the same input since
  it was written — the list path was the outlier. That guard now lives in the
  shared normalizer, so `GET /data/:object`, `POST /data/:object/query` and the
  runtime dispatcher all give one answer:

  - Unparseable JSON → `400 INVALID_FILTER`, naming the parameter and stating the
    filter was not applied.
  - Parses but is not a filter (`?filter=5`, `?filter="done"`, `?filter=null`) →
    same rejection; usable JSON is not a usable filter.
  - Blank `?filter=` → treated as absent, as before. No error.
  - `filter` / `filters` / `$filter` / `where` are four spellings of ONE slot.
    Sending two with **different** values used to run one and discard the rest
    silently; it is now `400 INVALID_REQUEST` (each value is a valid filter — the
    _request_ is ambiguous, so it does not share the malformed-filter code).
    Redundant identical spellings pass.
  - `orderby` on the export route gets the same treatment — a sort that cannot be
    parsed is refused rather than dropped (lower stakes than a filter: the row set
    is unchanged, but a caller taking "latest N" got an arbitrary N).

  **One wire code for one condition.** #4121 landed `400 INVALID_FILTER` for
  malformed filter _arrays_ on this same code path while this fix was in flight;
  the non-array rejections above use that code too, so a caller asking "did my
  filter run?" never has to know which branch caught it. The export route's
  filter guard moves from `INVALID_REQUEST` to `INVALID_FILTER` to match — a wire
  change on an existing route, and the reason it is worth making is that a client
  otherwise has to handle two codes for one condition depending on which URL it
  called. The route's `orderby` guard keeps `INVALID_REQUEST` (it is not a
  filter).

  **What changes for callers:** requests carrying a malformed filter now fail
  loudly instead of receiving every record. Every valid filter shape — JSON
  string, live object, `FilterCondition` AST array, and all four alias spellings
  used alone — is unaffected.

- af2a095: fix(data): `searchFields` / `groupBy` / `aggregations` naming a field that does not exist are rejected, not silently degraded (#4254)

  #4226 closed `sort` / `select` / `expand`; with the filter axis (#4134 / #4164 /
  #4181 / #4121) that made four field-naming read axes that either apply or fail.
  The same machine kept leaking on the remaining three, and each failure corrupted
  something the closed axes never touched:

  ```
  search=alpha&searchFields=no_such  -> 200  MORE rows than the narrowing allowed
  groupBy=[no_such]                  -> 200  [{no_such: null, n: <true count>}]  N groups collapsed into 1
  sum(no_such)                       -> 200  0 — indistinguishable from a real zero
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `POST /data/:object/query`, the export route and the runtime dispatcher give
  one answer instead of four.

  - **`searchFields` → `400 INVALID_FIELD`.** The `select` failure with the sign
    flipped outward: the engine dropped unknown names and, when that emptied the
    override, fell back to the FULL searchable set — so a parameter that exists
    only to narrow a search widened it, and it changed which ROWS came back, not
    just which columns. Its only in-framework caller is `GET /data/:object/export`
    — the route whose `search` support just shipped so exports would stop
    downloading "the unsearched superset … in a file that looks authoritative";
    a typo'd `searchFields` did exactly that, one parameter over. Three causes,
    three messages, because the fixes differ (the split #4226 drew on expand): a
    name that is no field is a request typo; a REAL field outside the searchable
    set needs the object changed (its message names the declared
    `searchableFields` or the auto-default's type rule, whichever applies); and
    a `searchableFields` entry that names no field is a STALE DECLARATION — a
    bug on the object, called out as such because clients (objectui's list
    search) echo the declaration verbatim. The allowed set is resolved by the
    same `@objectstack/spec/data` function the engine's search expansion
    consumes (`resolveSearchFieldResolution`, moved from objectql), so the gate
    cannot drift from what search actually scans.
  - **`groupBy` → `400 INVALID_FIELD`.** The in-memory aggregation path projects
    an unknown column as `null` for every row, so all rows landed in ONE bucket
    whose count is the true row count — structurally perfect, identical to "this
    column really holds a single value". A chart draws one bar; nothing says the
    grouping never ran. Native SQL aggregation errors on the same input, so which
    backend a deployment sits on decided the answer — the "two routes, opposite
    answers" split, one axis over.
  - **`aggregations` → `400 INVALID_FIELD`.** `sum(<typo>)` folded a column of
    `undefined` to `0` — the exact number an empty quarter produces, in reports
    whose whole job is to be believed (`avg`/`min`/`max` answered `null` the same
    way). `count` with no `field` (or the `'*'` sentinel) is the one legitimate
    field-less form and passes.
  - **Unreadable SHAPES on the aggregation axes → `400 INVALID_QUERY`** — the
    standard-catalog code that had no emitter since it was written, like
    `INVALID_SORT` before #4226. A string `groupBy`, an entry naming no field, a
    function or `dateGranularity` outside the spec enums, a missing `alias`: each
    slipped past the `Array.isArray` routing guard (rows returned UNGROUPED) or
    computed a silent placeholder (`null` results, a column keyed `"undefined"`,
    one bucket per raw value under an unknown granularity).

  Tiering is unchanged from #4226: registry + field map present → authoritative;
  no registry / no field map / legacy array field map → the NAME gates skip (shape
  gates still apply — they need no schema). The engine's own tolerance is
  untouched: internal callers reaching `engine.find()` / `engine.aggregate()`
  directly are unaffected. `@objectstack/rest` also stops logging
  `INVALID_FILTER` / `INVALID_SORT` / `INVALID_QUERY` rejections as
  "[REST] Unhandled error" — they are client mistakes the response already
  explains, as `INVALID_FIELD` always was.

  Requests that name real fields are unaffected.

- bf478e1: fix(data): `sort` / `select` / `expand` naming a field that does not exist are rejected, not silently dropped (#4226)

  The list path has four axes on which a caller names a field. `filter` was
  closed over #4134 / #4164 / #4181 / #4121 — a filter the server cannot apply is
  now a 400, never a 200 over the wrong rows. The other three still leaked, all
  answering `200`:

  ```
  sort=no_such_field   -> 200  CAEBD          byte-identical to "no sort at all"
  select=no_such_field -> 200  <every field>   asked for one column, got all of them
  expand=no_such_rel   -> 200  <no such key>   no relation, no complaint
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `GET /data/:object/:id`, `POST /data/:object/query`, the export route and the
  runtime dispatcher give one answer instead of five.

  - **`sort` → `400 INVALID_SORT`.** The row set is unchanged, so this is not
    #4181's "returned everything" — it is worse in one specific way: `sort` +
    `top` is how a caller asks for "the latest N", and a dropped sort makes that
    an arbitrary N that nothing in the response reveals. This is the list half of
    the bug #4181 fixed on the export route's `orderby`. `INVALID_SORT` had sat
    in the standard catalog since it was written with no emitter.
  - **`select` → `400 INVALID_FIELD`.** `engine.find()` drops unknown columns
    (deliberate `SELECT *` tolerance) and then falls back to `*` when that empties
    the projection, and the two compose into `?select=<typo>` asking for ONE
    column and receiving EVERY column — a parameter whose purpose is to return
    less, failing by returning more, against both FLS and data minimisation. The
    partially-unknown case (`?select=title,no_such`) is refused on the same terms:
    half a projection is not the one that was asked for, and the tolerant reading
    would have to explain why `?status=<typo>` is a 400 and `?select=<typo>` is
    not, on one endpoint, about one field map.
  - **`expand` → `400 INVALID_FIELD`.** The lightest of the three — same rows,
    same columns, the relation simply is not there — but the response cannot be
    told apart from "every foreign key is null", and the client renders raw ids
    where names belong. A name that is no field at all and a name that is a field
    holding no reference (`?expand=title`) get different messages, since the fixes
    differ.

  **Sorts that were silently never applied now are.** Two wire spellings reached
  the normalizer and fell through it untouched, and every driver then declined
  them (`SqlDriver` guards its ORDER BY with `Array.isArray(orderBy)`): the
  client SDK's own declared `orderBy: string[]`, and the `{field: direction}` map
  that `GET /data/:object/export`, `GET /data/import/jobs` and objectui's calendar
  all emit. Both are now folded to `SortNode[]` — so the import-job history, which
  has asked for `created_at desc` since it was written and served insertion order,
  sorts. A sort shape that still cannot be read (a number, an entry naming no
  field, a direction that is neither `asc` nor `desc`) is `400 INVALID_SORT`
  rather than a silent no-op.

  **`$expand` of a `tree` field works.** `REFERENCE_VALUE_TYPES` lists `tree`
  among the types whose value "points at another record … the related record
  object in expanded form", and objectui requests it, but
  `engine.expandRelatedRecords` tested membership with a hand-copied `!==` chain
  that omitted it — so a hierarchy field came back as a raw parent id. The loop
  now reads the shared spec set, which is also what the new expand gate validates
  against, so the gate cannot admit a field the engine then skips.

  **What changes for callers:** requests naming a non-existent field in `sort`,
  `select` or `expand` now fail loudly instead of receiving an unsorted, widened
  or unexpanded response. Every axis naming real fields is unaffected. The
  engine's own tolerance is untouched — it guards internal callers (hooks, flows,
  expand sub-reads, registry-less hosts) that never pass through this ingress,
  the same tiering the object-existence and unknown-field gates already use.

- dd5daac: fix(data): reject unknown list query parameters instead of reading them as zero-matching field filters (#4134)

  `GET /api/v1/data/:object` reads any parameter it does not reserve as a
  field-level equality filter — that is what makes `?status=done` shorthand for
  `?filter={"status":"done"}`. When the name matched **no** field the resulting
  predicate could only ever match nothing, so `?pageSize=5` on a 10-row object
  returned `200` + `total: 0`: structurally valid, and indistinguishable from
  "this object is empty". The write path already rejected the same unknown name
  loudly (`400 INVALID_FIELD`), so one piece of knowledge — does this field
  exist — was enforced on write and silently zeroed on read.

  The read path now answers the same way, in the same envelope:

  ```json
  {
    "error": "Unknown field 'pageSize' on object 'showcase_task'. Query parameters that are not reserved are read as field filters, so an unknown name can only match zero records. Did you mean the 'top' query parameter (OData spelling '$top')?",
    "code": "INVALID_FIELD",
    "field": "pageSize",
    "object": "showcase_task"
  }
  ```

  The rejection carries a suggestion — the canonical parameter for a known
  dialect (`pageSize` / `perPage` / `page` / `sortBy` / `q` → `top` / `skip` /
  `sort` / `search`), or the closest real field name when it reads like a typo —
  and fires whether or not an explicit `filter` rode along, so the failure never
  depends on which other parameters were sent.

  **What changes for callers:** a request sending a parameter that names no field
  now gets a `400` where it used to get an empty `200`. Page size is `top` /
  `$top` / `limit`; page offset is `skip` / `$skip` / `offset`. Every documented
  parameter, every `$`-prefixed OData alias, and the full `QueryAST` body of
  `POST /data/:object/query` are unaffected. An object with a field named after a
  reserved parameter (`count`, `cursor`, `object`, `top`, `search`, …) filters it
  through the explicit form: `?filter={"count":3}`.

- 239c3a3: fix(spec)!: the #3963 / #4052 / #4158 / #4196 / #4286 retirements land in protocol **17**, not a protocol 18 that this train cannot produce (#4350)

  Ten tombstone prescriptions told authors a key "was removed in `@objectstack/spec` **18**",
  and — worse — the machine agreed with them: a whole `step18` chain step and two
  `toMajor: 18` conversions were wired for a major the release train does not reach.

  **17 is what ships.** `latest` is 16.1.0 and `rc` is `17.0.0-rc.0` — 17.0.0 has never been
  published. `.changeset/pre.json` records `@objectstack/spec` at initialVersion 16.1.0, and
  changesets computes a pre-mode bump from the last _published_ version: 16.1.0 + `major` =
  **17.0.0**, released as `17.0.0-rc.N`. `PROTOCOL_VERSION` is `'17.0.0'`, and
  `protocol-version.test.ts` pins it to the package major, so it cannot unilaterally become 18
  either. The "18" came from counting up from the in-flight `17.0.0-rc.0` instead of from
  16.1.0.

  **The prose was the smaller half.** `composeMigrationChain(from, to = PROTOCOL_MAJOR)`
  filters `m <= toMajor`, so a step keyed 18 was **unreachable**: `os migrate meta --from 16`
  walked steps 11–17 and silently skipped 18. The same ceiling applies to `composeSpecChanges`,
  so the generated `spec-changes.json`, `docs/protocol-upgrade-guide.md` and the `spec_changes`
  MCP tool — the ADR-0087 D4 primary channel — carried **none** of these seven retirements:
  `query.joins`, `query.windowFunctions` and `BatchOptions.validateOnly` appeared zero times in
  the committed manifest, and the upgrade guide contained no "18" at all. Authors would have hit
  the tombstones with no chain hop to run and no upgrade-guide row to read.

  What changed:

  - `step18` is folded into `step17` — its rationale, both `conversionIds`
    (`stack-api-require-auth-removed`, `flow-node-wait-timeout-keys-removed`) and all six
    semantic migrations move across, and `MIGRATIONS_BY_MAJOR[18]` is gone. Both conversions
    become `toMajor: 17` (`migrations.test.ts` requires a conversion's `toMajor` to equal its
    step's major), and `CONVERSIONS_BY_MAJOR[18]` merges into `[17]`.
  - All 30 hand-written "18" references become "17": the ten tombstone prescriptions
    (`query.zod.ts`, `flow.zod.ts`, `rest-server.zod.ts`, `stack.zod.ts`, `protocol.ts`), the
    `query.test.ts` pin regex that was holding the wrong number in place, the internal comments,
    the `liveness/query.json` + `liveness/README.md` notes, and the seven unconsumed changesets.
  - The seven retirements are written into the v17 release notes and upgrade checklist, where
    they had no entry at all — there is no `v18.mdx` for them to have landed in.

  No behaviour is added or withdrawn: every key retired by #3963, #4052, #4158, #4196 and #4286
  stays retired, on exactly the terms those changesets describe. What changes is that the
  prescription now names the version that will actually carry it, and `os migrate meta` actually
  applies the two stack conversions instead of stepping over them.

- a2266a6: fix(spec,data): the five RPC query aliases resolve by ONE fold — spec table, not per-reader prose (#3795)

  `RpcQueryOptionsSchema` accepts five legacy aliases next to their canonical
  QueryAST keys and stated the precedence in prose only ("the normalizer uses
  the new key"). With no fold in the schema, every reader re-implemented it —
  the #3713 condition — and the two readers disagreed:

  | pair                  | spec prose | runtime dispatcher | metadata-protocol             |
  | --------------------- | ---------- | ------------------ | ----------------------------- |
  | `where` > `filter`    | canonical  | canonical          | **alias consulted first**     |
  | `fields` > `select`   | canonical  | canonical          | **alias clobbered canonical** |
  | `offset` > `skip`     | canonical  | canonical          | **alias clobbered canonical** |
  | `expand` > `populate` | canonical  | —                  | **alias consulted first**     |
  | `orderBy` > `sort`    | canonical  | canonical          | canonical                     |

  Four of five inverted in `protocol.ts`, so `?select=a&fields=b` answered
  `[a]` on one path and `[b]` on the other — reachable from a plain HTTP
  request.

  **The mapping now lives once, in the spec** (`RPC_QUERY_ALIAS_SLOTS` +
  `foldQueryAliasSlots`, both exported), under the rule #4181 already
  established for the filter pair:

  - an **alias alone** folds into its canonical key — `filter`→`where`,
    `select`→`fields`, `sort`→`orderBy`, `skip`→`offset`, `populate`→`expand` —
    and the alias key is **dropped from the parsed output**;
  - **both spellings, same value**: redundant, tolerated, alias dropped;
  - **both spellings, different values**: irreconcilable — picking a winner IS
    the silent drop — so the parse fails (schema) / the request is `400
INVALID_REQUEST` (wire), naming the spellings and the canonical key;
  - an explicit **`null` spelling is a withdrawal**, never a conflict: a null
    alias is dropped silently, a null canonical keeps its slot-specific answer.

  `RpcQueryOptionsSchema` and the four `filter`-mixin option schemas
  (update/delete/count/aggregate requests) apply the fold as a parse transform,
  so parsed output speaks canonical keys only — a TS consumer reading
  `parsed.query.populate` now **fails to compile** instead of silently reading
  `undefined` (the #3742 / #3764 shape, one layer down; hence the minor). The
  protocol normalizer folds raw wire input by the same table (extended with the
  wire-only `filters` / `$filter` / `$expand` spellings), and the runtime
  dispatcher's second copy of the fold is deleted outright.

  **Authoring/callers unchanged for the supported cases**: every alias alone
  keeps working on every path, and identical duplicates still pass. What
  changes is mixed vocabularies with **different** values — previously answered
  differently per route, now refused loudly on all of them — and a direct
  `expand: [names]` array on `POST /data/:object/query`, which used to be read
  by its indices ("Unknown field '0'") and now lowers to the expand record like
  `populate` always did.

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

- 8d4eae7: fix(seed-loader): resolve natural-key ARRAYS for multi-value lookups

  A `multiple: true` lookup / `user` field stores an array of ids, so its seed
  value is an array of natural keys (`authors: ['Alice', 'Bob']`). Reference
  resolution only ever accepted a single string: the array tripped the
  "expected a natural-key string but got an object. Pass the target's `name`
  value as a plain string" guard — impossible advice for a field that holds
  several references — and was then DROPPED from the record. The row landed with
  the whole association missing and only a warn in the log
  ([#3911](https://github.com/objectstack-ai/objectstack/issues/3911)).

  Every element now resolves independently (in-load records first, then the
  database, then pass 2), and the field lands as an array of target ids. A lone
  string is accepted as one-element shorthand for the array shape the field
  stores. Deferral is all-or-nothing per field — a partially-resolved array is a
  corrupt association, so pass 2 re-resolves the whole authored array — and a key
  that never materializes is a reported load error naming that element, not a
  silent drop.

  An array passed to a genuinely **single-value** reference field is still
  rejected, now with advice an author can act on: declare the field
  `multiple: true`, or pass one natural key.

  `ReferenceResolution` (`@objectstack/spec/data`) gains an optional `multiple`
  flag carrying the field's array-ness into resolution; it is additive and
  defaulted-absent, so existing dependency graphs are unaffected.

  **Authoring types.** `defineSeed`'s per-field value type now widens a
  `multiple: true` lookup to `string | string[] | null` (a lone string stays legal
  — the loader accepts it as one-element shorthand). `master_detail` is inherently
  single and is not widened, and an array on a single-value lookup is still a
  compile error. To make that reachable, `Field.lookup` became generic over its
  config (`<const C extends FieldInput>`) so `multiple: true` survives as a
  literal instead of widening to `boolean`; the return type is intersected with
  `FieldInput` so its optional surface is unchanged. Type-level only — the
  returned object is byte-identical at runtime.

- a62bd9e: fix(data): a dotted-path `sort` (`?sort=account.company_name`) is rejected with `400 INVALID_SORT`, not silently unapplied (#4256)

  The one sort shape #4226 deliberately left open is now closed. A dotted path
  passed the sort gate on its head segment (`account` is a real field) and was
  then unusable by every driver: `SqlDriver` handed it to Knex, which rendered
  `"account"."company_name"` against a table that was never joined, and the
  #3821 unknown-column backstop retried **without the sort**; Mongo and the
  memory driver resolved the path against the row itself, where a foreign key is
  a scalar id. Result: `200`, every row present, arbitrary order — and since
  `sort` + `top` is how a caller asks for "the latest N", an arbitrary N with
  nothing in the response to reveal it.

  The rejection distinguishes the two mistakes a dotted path can be:

  - a head that IS a relationship (`project_id.name`) — the message names the
    relationship it tried to cross and prescribes the supported alternative:
    denormalise the value onto the queried object (formula or rollup field) and
    sort by that;
  - a head that is not (`title.length`) — the message states the contract: sort
    reaches only whole columns of the queried object, not values inside them.

  An unknown head (`no_such.title`) keeps the existing typo-shaped answer, and a
  list carrying both mistakes reports the typo first — the same precedence the
  expand gate uses.

  **What changes for callers:** requests whose sort crosses a relationship now
  fail loudly instead of receiving an ordinary-looking 200 over unordered rows.
  A survey of framework, objectui and cloud found zero callers emitting a dotted
  sort (objectui's column-header sort keys lookup columns by their flat field
  name and loads relations via `$expand`), so the practical blast radius is
  hand-authored requests — exactly the callers the silent degradation was
  misleading. Internal callers reaching `engine.find()` directly are unaffected,
  the same tiering every #4226 gate uses.

- 5d21a48: feat(spec,metadata-protocol,metadata,objectql,service-automation): stored metadata replays the full conversion chain at rehydration (#3903)

  Every mechanism the platform has for evolving the metadata contract — schema
  transforms, the ADR-0087 D2 conversion layer, the D3 migration chain, the
  protocol-17 tombstones — operated on **authored source** only. Metadata **at
  rest** (`sys_metadata` rows written by Studio or the runtime authoring APIs)
  was rehydrated unparsed and unconverted, so the authored and stored contracts
  silently diverged: a pre-17 row carrying `conditionalRequired` or `execute`
  read as whatever each ad-hoc consumer happened to do with it.

  **New spec primitive — `applyConversionsToStoredItem(type, item, options?)`**
  (exported from the package root). Wraps one stored item of a given metadata
  type and replays the **full** conversion chain over it — `retiredFromLoadPath`
  entries included, because retirement is an _authoring-surface_ event: the
  window exists to teach a live author, and a row at rest has no author to
  teach. Idempotent, never throws, never validates.

  Wired at every stored-row rehydration seam:

  - `metadata-protocol`: `loadMetaFromDb`, `getMetaItems` (active + draft
    preview), `getMetaItem` (active + draft), `getMetaItemLayered`, and
    `duplicatePackage` (a copy re-saves through the schema gate, so legacy
    sources now duplicate successfully — and the copy is canonical).
  - `metadata`: the DatabaseLoader's live-row reads (`load` / `loadMany`).
    History reads stay verbatim — history records what was written.
  - `objectql`: the authored-action / authored-hook direct table reads, so
    runtime-authored actions stored with the removed `execute` alias dispatch
    via `target` again.
  - `service-automation`: `AutomationEngine.registerFlow` now passes
    `includeRetired` — stored flows keep canonicalizing after their conversions
    graduate out of the load window. (The generic metadata seams deliberately
    skip `type: 'flow'`: flow conversions carry the open-namespace conflict
    guard, which needs this engine's live executor registry.)

  **Boot hydration diagnoses instead of shrugging.** `loadMetaFromDb` now
  returns `{ loaded, errors, invalid }`: each row is validated against its
  type's spec schema _after_ conversion, and a genuine contract violation is
  counted and warned with a stable `[metadata_spec_invalid]` marker — but still
  registered, deliberately: refusing at boot would unhook live tables and make
  the row unlistable and unfixable in Studio. The write path (`saveMetaItem` → 422) and the read-side `_diagnostics` envelope remain the enforcing gates; the
  `SchemaRegistry.registerItem` validation hook is now documented as exactly
  that diagnostic.

  **Retired accommodation.** With the chain running on every stored read path,
  the rule-validator's `requiredWhen ?? conditionalRequired` fallback — kept in
  #3883 with a retirement promise that had no mechanism — is deleted. If you
  call `evaluateValidationRules` directly with raw legacy field definitions,
  convert them first (`applyConversionsToStoredItem('object', def)`) or author
  `requiredWhen`; the platform's own read paths already hand you canonical
  shapes.

- 3245174: fix(metadata-protocol): read decorations stop round-tripping into persisted metadata bodies (#4326)

  `getMetaItem` / `getMetaItems` decorate every served document with
  `_diagnostics` (and `_draft` on preview reads), while the write path persists
  the request body **verbatim** by design (ADR-0005 §Validation — `parsed.data`
  would strip Studio-only auxiliary fields). Nothing stripped the decorations in
  between, so the standard designer round-trip — GET the served document, edit a
  field, PUT the whole body back — baked a stale read-time verdict into
  `sys_metadata.metadata`, into its checksum, and into every history diff.

  It was never user-visible: reads recompute `_diagnostics` and the fresh verdict
  shadows the persisted one. What it corrupted was the stored bytes — a
  decoration-only re-save moved the content checksum, and history diffs carried
  diagnostic noise no author wrote.

  `saveMetaItem` now strips `_diagnostics` and `_draft` from the body before the
  destructive-change diff, the schema gate, the authoring gate, and persistence
  (new `stripReadDecorations`, exported for tests). A **silent** strip, unlike the
  neighbouring layered-envelope rejection: those keys are our own decoration
  riding on a document that is otherwise exactly what the author edited, so
  rejecting the round-trip would be hostile. The ADR-0010 protection envelope
  (`_lock`, `_lockReason`, `_provenance`) and `_packageId` are deliberately left
  alone — envelope state the write path legitimately carries, not read decoration.

  Also documents the #3903 conversion boundary on `SysMetadataRepository.get`:
  its body stays verbatim because every caller wants the bytes a hash was
  computed over (parent-version lineage, existence probes) or is diffing against
  equally-verbatim history rows — conversion belongs one layer up, at the
  protocol's serving seams.

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
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
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
- Updated dependencies [7309c81]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/metadata-core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 3949a43: fix(metadata-protocol,rest): the data path really 404s unknown objects now (#3770)

  The REST API-exposure gate (`enforceApiAccess`) passes through any object it
  cannot find in metadata, and the comment there justified that with
  `// unknown object → let the data path 404`. That fallback did not exist.

  - `findData` — and every other data entry point except `cloneData` — had **no
    existence check**. The repo's only `OBJECT_NOT_FOUND` throw was in `cloneData`.
  - The engine does not reject unregistered names either: `resolveObjectName`
    falls back to `StorageNameMapping.resolveTableName({ name })`, so the object
    name is used **as the table name**.
  - The 404 was therefore only ever a side effect of the **driver** erroring on a
    missing table, which the REST layer recognised by matching the driver's error
    string.

  So the 404 held only when the table happened not to exist. When a physical table
  with that name **did** exist — out-of-band DDL, a registration that failed after
  `syncObjectSchema` had already run, a registration race — the exposure gate was
  silently skipped and the rows were served, with no layer turning it into a 404.
  (Since #3545 an authenticated caller on a plugin-security deployment is refused
  by the fail-closed posture check; anonymous callers and deployments without
  plugin-security were not.)

  **The gate.** `ObjectStackProtocolImplementation` now runs a shared
  `assertObjectRegistered` before storage is touched, on `findData`, `getData`,
  `createData`, `cloneData`, `updateData`, `deleteData`, `batchData`,
  `createManyData`, `insertManyData`, `updateManyData`, `deleteManyData` and
  `analyticsQuery`. An object absent from the schema registry is rejected with
  `OBJECT_NOT_FOUND` / 404 — an authoritative answer from the registry, raised
  _before_ the name becomes a table name, instead of an inference from driver
  prose. `cloneData`'s open-coded check is now that shared gate; its envelope is
  unchanged.

  It sits at the protocol ingress, the same boundary `apiEnabled` guards: internal
  callers (hooks, flows, migrations, raw ObjectQL) go to the engine directly and
  are unaffected. When the engine exposes no schema registry at all there is
  nothing to consult, so the gate stands down and warns once per process —
  matching the tiering #3545 recorded in `api-exposure.ts` for a whole-registry
  outage.

  **Behaviour change.** A REST data request for an object that is not in the
  schema registry now returns `404 object_not_found` even when a table of that
  name exists. Previously it returned that table's rows. If a deployment depended
  on reading a table with no registered object, register the object (its schema is
  what every other layer — exposure, RBAC/FLS/RLS, field projection — already
  needs in order to enforce anything at all).

  **One wire code.** `mapDataError` maps the protocol's `OBJECT_NOT_FOUND` to the
  canonical `object_not_found` `ApiErrorCode` — byte-identical to the envelope the
  driver-string branch already produced — so a client keying on `code` sees _what
  happened_, not _which layer noticed_. The driver-string branch stays as the
  safety net for the other failure it actually covers: an object that IS registered
  but whose physical table is missing. Callers that were reading `cloneData`'s 404
  as `code: 'OBJECT_NOT_FOUND'` on the wire now get `object_not_found`; the status
  is 404 either way.

  The misleading comment is replaced with what actually closes the hole — this
  gate for existence, plugin-security's `unresolved` posture (#3545) for
  authorization — and a note not to widen the exposure gate on the assumption that
  some other layer 404s.

- c2d9098: feat(rest/protocol): extend droppedFields write-observability to the bulk paths + client SDK (#3455)

  Follow-up to #3448 (#3431 D2): the single-write PATCH/POST `/data` paths already
  surface LEGALLY-stripped write fields (static `readonly` #2948 / `readonlyWhen`
  #3042 / #3043 create ingress) as `droppedFields`. The **bulk** write paths did
  not — the same strips happened silently on every batched row — and the typed
  client warning + CORS mirror were deferred. This closes those out.

  **Bulk passthrough (metadata-protocol).**

  - `updateManyData` and `batchData` (update/upsert rows) now register a per-row
    `onFieldsDropped` collector and attach the events to that row's result.
  - `createManyData` diffs each supplied row against its #3043-stripped form and
    returns an **aggregated** top-level `droppedFields` (one event per
    object/reason with the union of field names) — its `{ records, count }`
    response has no per-row slot, and the insert-time strip is static-`readonly`
    only, so it is schema-uniform across rows and the aggregate is faithful.
  - `insertManyData` keeps per-row precision, attaching `droppedFields` to each
    outcome.
  - **Correctness fix bundled in:** `updateManyData` and `batchData` never threaded
    the caller's execution `context` to the engine — bulk writes ran context-less,
    so RLS/FLS and `readonlyWhen` evaluated without the caller's principal, and the
    batch create-ingress strip was hard-coded to a non-system context. All engine
    calls in both methods now run under the resolved `context`.

  **Contract (spec).** `BatchOperationResultSchema` gains an optional per-row
  `droppedFields` (covers `updateMany` + `batch`, which alias
  `BatchUpdateResponseSchema`); `CreateManyDataResponseSchema` gains the optional
  aggregated `droppedFields`. Both are omit-when-empty, so existing clients are
  unaffected. `X-ObjectStack-Dropped-Fields` is deliberately **not** emitted for
  batches — one response header cannot express per-row drops, so the per-row body
  field is the canonical bulk channel.

  **Typed client warnings (@objectstack/client).** `CreateDataResult` /
  `UpdateDataResult` gain `droppedFields?: DroppedFieldsEvent[]`, giving the body
  channel a type instead of an untyped property.

  **CORS (@objectstack/hono, @objectstack/plugin-hono-server).**
  `x-objectstack-dropped-fields` is added to the default `Access-Control-Expose-Headers`
  allow-list (kept in lockstep across both Hono CORS sites) so a cross-origin
  browser can read the single-write drop header. The body `droppedFields` remains
  the primary, cross-origin-safe surface — this is a convenience mirror.

  **GraphQL — not applicable (documented).** #3455 lists a GraphQL mutation item,
  but GraphQL has no runtime: `kernel.graphql` is unassigned everywhere and
  `handleGraphQL` returns `501`, and discovery never advertises `/graphql`. There
  is no schema generator or mutation resolver to expose a typed payload field on,
  so there is nothing to wire until a GraphQL engine lands — at which point the
  protocol-layer `droppedFields` is already present and only the GraphQL schema
  projection would remain.

- 5ac93d4: feat(rest): surface silently-dropped write fields on PATCH/POST /data (#3431)

  #3413 (closes #3407) built the engine-level strip-observability channel
  (`WriteObservabilityOptions.onFieldsDropped`) and wired the flow side
  (`update_record` / `create_record` emit a step warning + `droppedFields`). The
  **REST write path was never wired**, so an external API caller writing N fields
  still got a bare `200 + record` when `readonly` (#2948) / `readonlyWhen` (#3042)
  stripping meant `< N` actually landed — the same silent-success class #3407
  fixed flow-side, just on HTTP. The only way to notice was a per-field diff of
  the returned row (which need not echo every field). This wires the channel
  through the protocol → REST, on both write verbs.

  **Passthrough (metadata-protocol).** `updateData` now registers an
  `onFieldsDropped` collector on `engine.update` and returns the events on the
  response as `droppedFields`. `createData` surfaces the #3043 static-`readonly`
  INGRESS strip too — that strip runs at the protocol ingress
  (`stripReadonlyForInsert`), _before_ the engine, so it is recovered by diffing
  the supplied payload against the stripped one (the engine's `onFieldsDropped` is
  also wired for a future insert-side engine strip). A faulty listener never
  breaks the write — the engine catches and logs.

  **Contract (spec).** `UpdateDataResponseSchema` / `CreateDataResponseSchema`
  gain an **optional** `droppedFields: DroppedFieldsEvent[]` — present only when
  ≥1 field was dropped. Optional + omit-when-empty keeps the response shape
  backward-compatible for clients that only read `record`.

  **REST surface.** PATCH `/data/:object/:id` and POST `/data/:object` echo the
  drops as an `X-ObjectStack-Dropped-Fields` response header
  (`field;reason=<reason>` tokens, comma-joined — e.g.
  `approval_status;reason=readonly`) and keep the structured `droppedFields` on
  the body. **Status/success semantics are unchanged** (200 update / 201 create) —
  a strip is legitimate semantics, not a failure (same principle as #3413). The
  FLS write gate is untouched (it already fails closed with 403).

  Out of scope (issue #3431 D2 open questions, deferred): bulk
  (`updateManyData` / `createManyData` / `batchData`) and GraphQL mutation wiring,
  typed `@objectstack/client` warnings, and adding the header to the Hono CORS
  `exposeHeaders` allow-list for cross-origin browser reads (the body
  `droppedFields` is the cross-origin-safe channel meanwhile).

- 20cb232: feat(metadata-protocol,objectql): MetadataProtocolPlugin + `registerProtocol` opt-out — ADR-0076 Step 2 PR-A (#2462)

  `createMetadataProtocolPlugin()` now owns what `ObjectQLPlugin` historically
  assembled inline: the `ObjectStackProtocolImplementation` construction +
  `protocol` registration, the metadata-storage platform objects, and the D12
  `degraded` analytics fallback (pattern: plugin-security — named plugin,
  `dependencies` on the engine, `ctx.getService('objectql')`). `ObjectQLPlugin`
  grows `registerProtocol?: boolean` (default `true`, fully backward
  compatible): pass `false` when mounting the new plugin. Protocol CONSUMERS
  stay on the engine plugin either way — DB hydration and the authored
  hook/action rebind resolve `protocol` lazily (the rebind arms from `start()`
  in delegated mode) and degrade gracefully. Mixing both assemblies fails fast
  with the fix in the message. This is the additive first leg of the
  cross-repo sequence; cloud's 3 boot sites flip in PR-B, the built-in
  assembly + re-exports retire in PR-C.

- e231abb: feat(objectql,metadata-protocol)!: single-source the protocol assembly; drop objectql's protocol re-exports — ADR-0076 Step 2 PR-C (#2462)

  The ONE assembly now lives in `@objectstack/metadata-protocol` as
  `assembleMetadataProtocol()` — `createMetadataProtocolPlugin()` (delegated
  mode, cloud) and `ObjectQLPlugin`'s built-in convenience mode
  (`registerProtocol !== false`, single-kernel/dev boots) both mount the same
  code path (~112 inline lines deleted from the engine plugin). objectql's six
  protocol re-exports (`ObjectStackProtocolImplementation`,
  `SysMetadataRepository`, `SeedLoaderService`, `runBuildProbes` + types) are
  removed — import them from `@objectstack/metadata-protocol` directly
  (breaking, shipped as minor per the launch-window convention; the only known
  importers were five test files, repointed). Scope note vs the original Step-2
  recipe: the objectql→metadata-protocol dependency is deliberately KEPT for
  the convenience mount — `@objectstack/objectql/core` was already
  protocol-free, and forcing 20 framework boot sites to mount two plugins buys
  no runtime win. "Zero protocol dependency" lands as "zero assembly ownership,
  single source".

### Patch Changes

- abceb0d: fix(seed-loader): support a composite `externalId` so join-table seeds dedupe on replay (#3434)

  A junction / join table has no single-field natural key — the PAIR of its
  foreign keys is what's unique — so its seed could only run `mode: 'insert'`,
  which re-inserts every row on each replay boot with no existing-row check
  (`decideWriteAction`'s `insert` case returns `insert` unconditionally). The
  table duplicated on every restart: the showcase `showcase_project_membership`
  fixture (3 rows) grew 3 → 6 → 9. It was masked until #3415 let the master-detail
  parents seed at all.

  - `SeedSchema.externalId` now accepts a **list** of field names
    (`externalId: ['team', 'project']`) in addition to a single field name,
    declaring a composite natural key. Default stays `'name'`.
  - `SeedLoaderService` builds the uniqueness key from all listed fields (joined
    with a `\u0000` separator that can't occur in a natural-key value). Reference
    key fields are compared by their RESOLVED parent ids — which the existing DB
    row already stores — so a composite of foreign keys matches across restarts.
    A partial key (any component absent) is treated as no key, falling back to
    insert, exactly as a missing single-field key already did.
  - A composite-key target does not participate in single-value reference
    resolution (a reference is one natural-key string), so such objects keep the
    `'name'` default when referenced by another dataset.

  The showcase membership fixture switches to `mode: 'ignore'` +
  `externalId: ['team', 'project']`, so replay boots leave the three rows
  untouched instead of duplicating them.

- 4c5a584: fix(seed-loader): resolve lookup/master_detail references for objects that only live in the engine registry (marketplace installs)

  `SeedLoaderService.buildDependencyGraph` consulted only `metadata.getObject()`
  when building the reference graph. Marketplace-installed packages register
  their objects through the `manifest` service straight into the ObjectQL
  registry — after the boot-time `bridgeObjectsToMetadataService` pass — so the
  metadata service never lists them. The reference graph came back empty for
  those objects and every lookup / master_detail seed value was written
  verbatim: `crm_contact.crm_account` held the authored natural key
  (`"Acme Corporation"`) instead of the target record's id.

  The damage compounded under RLS: `crm_contact` declares
  `sharingModel: controlled_by_parent`, whose row filter compiles to a join on
  the parent reference. With every reference dangling, the join matched nothing
  and the whole object went invisible to everyone — platform admins included —
  while the rows sat in the table (REST list `total=0`, single GET 404).

  The loader now falls back to the engine's own schema registry
  (feature-detected `engine.getSchema()`, which the ObjectQL engine exposes)
  whenever the metadata service has no definition for a seeded object. The
  metadata service remains the preferred source; engines without a schema
  registry keep the old behavior.

- 0c302a7: Exempt curated seed writes from `state_machine` validation (#3433).

  A seed is a snapshot of established facts — a project already `completed`, an
  opportunity already `closed_won` — not a record walking its lifecycle. But once
  an object declared `state_machine.initialStates` (#3165), the write path enforced
  the FSM entry point on **every** insert, so seed replay silently rejected every
  mid-lifecycle row and cascaded its master-detail children. That is the "installed
  but no data" failure for the showcase board (1 of 5 projects), and it would hit
  every marketplace template (a `closed_won` opportunity, a `closed` case) plus the
  rehydrate-heal and per-org replay paths.

  `SeedLoaderService` now marks its writes with a server-set `ExecutionContext.seedReplay`
  flag; the engine passes `skipStateMachine` to the rule evaluator for those writes,
  which skips the `state_machine` rule on both insert (`initialStates`) and update
  (transitions). The exemption is scoped to `state_machine` only — a seed must still
  satisfy every other validation (`format`, `cross_field`, `script`, `json_schema`,
  `conditional`). Because all seed paths funnel through `SeedLoaderService.SEED_OPTIONS`,
  the fix covers boot inline seed, marketplace install/heal, and per-org replay at once.

  The showcase project seed drops its three-phase FSM-walk workaround (#3415) and
  seeds each project directly at its real status again.

- 83c161f: feat(automation)!: a flow run with no trigger user may no longer touch data (#3760)

  An effective `runAs:'user'` run that resolves **no trigger user** used to execute
  its data nodes **UNSCOPED** — it presented no principal, and the data security
  middleware skips when there is no principal, so the run read and wrote every row.
  `runAs:'user'` is an access-_narrowing_ declaration; failing to resolve it must
  never resolve to a grant (ADR-0049). It now **refuses** the operation
  (`UnscopedRunDataAccessError`), naming `runAs:'system'` as the fix.

  **This was never really about schedules.** The docs, the spec, the runtime
  warning and the lint all described a schedule-shaped problem, and the lint only
  ever matched that shape. But the runtime predicate is "no user", and the
  commonest way to have no user is a **record-change flow fired by a write that
  carried none**: `isSystem` does _not_ suppress trigger dispatch — only
  `skipTriggers` does, and exactly three first-party paths set it — so every
  plugin/service system write, the approvals status mirror, and a `runAs:'system'`
  flow's own data node dispatched record-change flows with `userId: undefined`.
  Ordinary users reach those writes routinely (submitting for approval mirrors a
  status onto the target record), so the fail-open was reachable by unprivileged
  input and was the common case, not the rare one.

  Deliberately **not** implemented as "inherit the triggering write's posture and
  run as `isSystem`". That reads like a relabel but is a privilege escalation: the
  security middleware's `isSystem` short-circuit fires _before_ its
  package-managed-row, system-row, audience-anchor and delegated-admin gates, all
  of which a principal-less context still has to clear. Such a run cannot write
  `sys_user_position` today; as `isSystem` it could. "Unscoped" was never
  equivalent to "system".

  **Breaking — how to migrate.** A flow that reacts to system writes and needs to
  act beyond one user's grants declares `runAs: 'system'`, making the elevation
  explicit and audit-attributable. Otherwise ensure the trigger supplies a user.
  Flows that touch no data are unaffected (`runAs` is moot), and the failure is
  isolated: the trigger already swallows flow errors, so the originating write
  still succeeds. The engine warns at run _setup_, before any node executes.

  **#3712's user-less provenance path is subsumed, not broken.** That fix let a
  run with no trigger user write its own approval-locked record by carrying a
  provenance-only ObjectQL context (the run id, nothing else). Such a run can no
  longer perform a data operation at all — presenting no principal is exactly what
  made the write unscoped — so it is refused before the lock is consulted. The
  capability survives via the explicit route: a schedule that must write records
  declares `runAs:'system'`, which the lock hook exempts on its own `isSystem`
  branch. The `flowRunId` exemption itself stays live and load-bearing for what
  #3703 built it for — a `runAs:'user'` run that _does_ have a user — where the
  exemption is still provenance rather than privilege.

  Also in this change:

  - **`flow-schedule-runas-unscoped` → `flow-runas-unscoped`, and it now fails the
    build.** It read as a gate and behaved as a comment — `os compile` documented
    that the flow lint "NEVER fails the build" — which is close to no net at all
    for the audience it protects, very often an AI generating flows in bulk. It now
    also covers the other provably user-less triggers (`time_relative`, `api`), per
    ADR-0073 D5. It still cannot cover `record_change`, which is undecidable at
    authoring time — that is exactly why the runtime refusal exists.
  - **Three seed writes stopped firing automation.** The seed loader's pass-2
    deferred-reference back-fill and both of `AppPlugin`'s basic-insert fallbacks
    inlined a bare `{ isSystem: true }` instead of the shared seed options, so they
    seeded with record-change automation live — the self-trigger vector
    `skipTriggers` exists to prevent, on the writes that skipped it.
  - **ADR-0073 amended.** Its severity rationale ("an unprivileged user cannot
    trigger a schedule, so there is no untrusted-input path") is falsified, and its
    rejection of fail-closed ("breaks legitimate scheduled CRUD — 2/3 example flows
    relied on the default") expired when those flows were fixed to declare
    `runAs:'system'`. Refusal is an interim posture, forward-compatible with the
    ADR's `automation` principal: when that lands, the refusal point becomes the
    place that resolves it.

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
- Updated dependencies [c073b8c]
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
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0
  - @objectstack/metadata-core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/metadata-core@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

- 668dd17: **Breaking (npm type surface): retire the vestigial feed contracts + protocol surface (ADR-0052 §5 follow-up, #1959).**

  The `service-feed` runtime was deleted in #1955; `sys_comment` / `sys_activity`
  are the canonical record-collaboration/timeline backend. This removes the dead
  type surface that still pointed at the deleted runtime — every removed method was
  already unreachable (the feed REST route was never mounted → 404; the protocol
  implementation was never wired with a feed service, so `requireFeedService()`
  could only throw). No behavior changes.

  No authorable metadata key is removed (the `feeds:` object capability flag and
  the `RecordActivity` UI component config are unchanged), so `PROTOCOL_MAJOR`
  stays 15 and this ships as `minor` rather than a protocol major.

  FROM → TO migration for every removed export:

  - `@objectstack/spec/contracts` — `IFeedService`, `CreateFeedItemInput`,
    `UpdateFeedItemInput`, `ListFeedOptions`, `FeedListResult` → **removed, no
    replacement**. Comments/activity are plain records: write `sys_comment` / read
    `sys_activity` via the data engine or the REST data API.
  - `@objectstack/spec/api` — `FeedApiContracts`, `FeedApiErrorCode`,
    `FeedProtocol`, and all feed request/response schemas + types (`GetFeed*`,
    `CreateFeedItem*`, `UpdateFeedItem*`, `DeleteFeedItem*`, `AddReaction*`,
    `RemoveReaction*`, `PinFeedItem*`, `UnpinFeedItem*`, `StarFeedItem*`,
    `UnstarFeedItem*`, `SearchFeed*`, `GetChangelog*`, `ChangelogEntry`,
    `SubscribeRequest/Response`, `FeedUnsubscribeRequest`, `UnsubscribeResponse`,
    `FeedPathParams`, `FeedItemPathParams`, `FeedListFilterType`) → **removed**. Use
    the data API against `sys_comment` / `sys_activity` (`/api/v1/data/sys_comment/…`);
    reactions and threaded replies are fields on `sys_comment`.
  - `@objectstack/spec/data` — `FeedItemSchema`/`FeedItem`, `FeedActorSchema`/`FeedActor`,
    `MentionSchema`/`Mention`, `ReactionSchema`/`Reaction`,
    `FieldChangeEntrySchema`/`FieldChangeEntry`, `FeedVisibility`,
    `RecordSubscriptionSchema`/`RecordSubscription`, `SubscriptionEventType`, and the
    `data`-namespace `NotificationChannel` → **removed**. `FeedItemType` and
    `FeedFilterMode` are **kept** (live UI activity-timeline config). For notification
    channels use `NotificationChannelSchema` from `@objectstack/spec/system`.
  - `@objectstack/client` — `client.feed.*` (`list` / `create` / `update` / `delete` /
    `addReaction` / `removeReaction` / `pin` / `unpin` / `star` / `unstar` / `search` /
    `getChangelog` / `subscribe` / `unsubscribe`) and the re-exported feed response
    types → **removed**. One-line fix: use `client.data.*` on `sys_comment` /
    `sys_activity`, e.g. `client.data.create('sys_comment', { object, record_id, body })`
    and `client.data.find('sys_activity', { filters: [['record_id', '=', id]] })`.
  - `@objectstack/metadata-protocol` — `ObjectStackProtocolImplementation` no longer
    implements the 14 feed methods; its constructor
    `(engine, getServicesRegistry?, getFeedService?, environmentId?)` becomes
    `(engine, getServicesRegistry?, environmentId?)`. One-line fix: delete the third
    argument.

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

- 0e41302: fix(metadata-protocol): unscoped metadata list dedupes package-aware, not by bare name (ADR-0048 #1828)

  `getMetaItems` merged registry items, `sys_metadata` overlay rows, draft-preview
  rows, and MetadataService items into `Map`s keyed by bare `name`, so two installed
  packages shipping the same `type/name` (e.g. `page/home`) collapsed to one row
  (last-write-wins) on an unscoped `GET /meta/:type` whenever either package had an
  overlay — and the frontend prefer-local resolution, which reads that list, could
  no longer tell the two packages' rows apart.

  The three merge sites (plus the env/org pre-merge) now key by `(package, name)`,
  mirroring `getMetaItem`'s scoped-then-global-fallback resolution: colliding rows
  stay distinct each with its own `_packageId`, a package-less (env-wide) overlay
  still wins over the single artifact it customizes (ADR-0005 precedence and
  single-package behaviour unchanged), and the registry-hydration artifact graft is
  scoped to each row's own `package_id` so a collision no longer mislabels provenance.

- b8a21ad: Publish/discard package drafts in the draft's own org scope, fixing `no_draft` after saving a draft via Studio.

  Studio "Save Draft" (`PUT /meta/:type/:name?mode=draft`) never threads the session's `activeOrganizationId`, so the draft row is written env-wide (`organization_id = NULL`). "Publish" (`POST /packages/:id/publish-drafts`) resolves the active org and passed it to `promoteDraft`, which looked the draft up with a strict `organization_id = <org>` equality — so it 404'd (`[no_draft] No pending draft exists …`) on the env-wide row it could never match, even though `listDrafts` had already surfaced that draft to the publish CTA (PR #1852's `$or`). `discardPackageDrafts` had the same latent gap.

  `listDrafts` now projects each draft's own `organizationId`, and `publishPackageDrafts` / `discardPackageDrafts` promote / delete each draft in that scope (env-wide stays env-wide, per-org stays per-org). Seed-body capture and the ADR-0067 revert-plan pre-state read are scoped the same way.

  Fixes #3115.

- beaf2de: fix(metadata-protocol): strip static `readonly` on INSERT at the data-write ingress (#3043)

  #2948/#3003 made static `readonly: true` fields server-enforced on UPDATE (a
  non-system PATCH forging `approval_status: 'approved'` is silently stripped in
  the engine), but INSERT was exempt. For approval/status/verdict columns that
  exemption was the _shorter_ attack: instead of the #3003 draft-then-PATCH move, a
  non-system caller could `POST` a record already `approval_status: 'approved'` in
  one step — and the UPDATE-only strip never reached it.

  The strip now also runs on INSERT, but at the **external data-write ingress**
  (`DataProtocol.createData` / `createManyData` / `batchData` / `cloneData`) rather
  than in the engine. That seam is the single point every external programmatic
  create funnels through — the REST CRUD route, the GraphQL/MCP dispatcher
  (`bridge.create` → `callData` → `createData`), and bulk import — while **trusted
  internal writers** (better-auth's adapter, the metadata repository, the seed
  loader) call `engine.insert` directly and bypass it. Enforcing at the ingress
  protects every caller/agent path at once without stripping the internal writers
  that legitimately seed read-only columns on create (identity provisioning,
  provenance stamps, event-log cursors) — the blast radius an engine-level insert
  strip would have.

  - **Caller-forged only, at the ingress.** The payload here is raw caller input
    (the security middleware stamps `owner_id` / `organization_id` later, inside
    `engine.insert`), so only keys the caller actually sent are dropped; server
    stamps are added afterwards and are unaffected.
  - **Re-derives the default.** A stripped field falls back to its declared
    `defaultValue` in the engine (a forged `approval_status` becomes `draft`, not
    NULL).
  - **System-context exempt.** `isSystem` writes still seed read-only columns.
  - **Silent** (HTTP 2xx), per-row on batch/import. `readonlyWhen` stays
    INSERT-exempt (a conditional lock needs a prior record).
  - **Author-defined business objects only.** Platform objects (`managedBy` set,
    or the `sys_` namespace) carry their own field-write governance that a silent
    strip must not pre-empt — e.g. ADR-0086 REJECTS (403) a forged
    `managed_by:'package'` on `sys_permission_set`, and #3004 rejects a forged
    `owner_id`; several of those columns are `readonly`, so stripping them here
    would swallow the payload the guard is meant to reject. The #3043 threat is app
    approval/status fields, never `sys_` — the same boundary `applySystemFields`
    uses for ownership.

  Behavior change: a non-system create through the data API (REST / GraphQL / MCP /
  import) can no longer seed a `readonly` column from the payload. Flows that
  legitimately write read-only columns at creation must run with a system context
  (`isSystem`), the same requirement the UPDATE strip already imposes.

- 8abf133: **Breaking (discovery response shape): retire the residual feed capability surface (#3180, follow-up to #1959 / ADR-0052 §5).**

  The feed backend was retired long ago; #1959 removed the feed contracts + SDK. This
  removes the last discovery/dispatcher references to it, and fixes a real bug where the
  `comments` capability was permanently `false`.

  - `@objectstack/spec` — `WellKnownCapabilitiesSchema.feed` and `ApiRoutesSchema.feed`
    (`routes.feed`) are **removed**, and the `/api/v1/feed` entry is dropped from
    `DEFAULT_DISPATCHER_ROUTES`. FROM → TO: clients reading `discovery.capabilities.feed`
    or `discovery.routes.feed` → use `discovery.capabilities.comments`; comments/activity
    are served by the generic data API on `sys_comment` / `sys_activity`
    (`/api/v1/data/sys_comment/…`).
  - `@objectstack/metadata-protocol` — `getDiscovery()` no longer emits the always-`false`
    `feed` service/capability. **Bug fix:** the `comments` capability previously keyed off
    the deleted `'feed'` service (so it was permanently `false` after #1955); it now tracks
    the presence of the `sys_comment` object (provided by the always-on audit slate), so
    `declared === enforced`.
  - `@objectstack/client` — the internal `feed: '/api/v1/feed'` route constant is removed
    (it only existed to satisfy the now-removed `ApiRoutes.feed` type; no client code used it).

- 515f11a: fix(seed): replaying seeds no longer corrupts lookup natural keys on the upsert update path

  Every dev-server restart replayed package seeds in upsert mode, and any record whose
  lookup/master_detail was authored as a natural key could have that reference overwritten
  with NULL on the update path (`NOT NULL constraint failed` on required columns; silent
  link loss on nullable ones). Four fixes:

  - An unresolved reference now leaves the column untouched (deferred to pass 2) or drops
    the record loudly — it is never written as NULL over an existing row.
  - DB-side reference resolution probes the target dataset's declared `externalId` (e.g.
    `email`) before falling back to `name` and `id`, matching how in-memory resolution
    already keyed records.
  - A rejected update (e.g. a `state_machine` rule vetoing the replay) no longer severs
    natural-key resolution for downstream child datasets.
  - Replays are idempotent: an upsert/update whose declared fields already match the
    existing row is skipped instead of rewritten (no more `updated_at` churn or lifecycle
    re-validation on every boot).

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
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [06cb319]
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
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/metadata-core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/metadata-core@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 668dd17: **Breaking (npm type surface): retire the vestigial feed contracts + protocol surface (ADR-0052 §5 follow-up, #1959).**

  The `service-feed` runtime was deleted in #1955; `sys_comment` / `sys_activity`
  are the canonical record-collaboration/timeline backend. This removes the dead
  type surface that still pointed at the deleted runtime — every removed method was
  already unreachable (the feed REST route was never mounted → 404; the protocol
  implementation was never wired with a feed service, so `requireFeedService()`
  could only throw). No behavior changes.

  No authorable metadata key is removed (the `feeds:` object capability flag and
  the `RecordActivity` UI component config are unchanged), so `PROTOCOL_MAJOR`
  stays 15 and this ships as `minor` rather than a protocol major.

  FROM → TO migration for every removed export:

  - `@objectstack/spec/contracts` — `IFeedService`, `CreateFeedItemInput`,
    `UpdateFeedItemInput`, `ListFeedOptions`, `FeedListResult` → **removed, no
    replacement**. Comments/activity are plain records: write `sys_comment` / read
    `sys_activity` via the data engine or the REST data API.
  - `@objectstack/spec/api` — `FeedApiContracts`, `FeedApiErrorCode`,
    `FeedProtocol`, and all feed request/response schemas + types (`GetFeed*`,
    `CreateFeedItem*`, `UpdateFeedItem*`, `DeleteFeedItem*`, `AddReaction*`,
    `RemoveReaction*`, `PinFeedItem*`, `UnpinFeedItem*`, `StarFeedItem*`,
    `UnstarFeedItem*`, `SearchFeed*`, `GetChangelog*`, `ChangelogEntry`,
    `SubscribeRequest/Response`, `FeedUnsubscribeRequest`, `UnsubscribeResponse`,
    `FeedPathParams`, `FeedItemPathParams`, `FeedListFilterType`) → **removed**. Use
    the data API against `sys_comment` / `sys_activity` (`/api/v1/data/sys_comment/…`);
    reactions and threaded replies are fields on `sys_comment`.
  - `@objectstack/spec/data` — `FeedItemSchema`/`FeedItem`, `FeedActorSchema`/`FeedActor`,
    `MentionSchema`/`Mention`, `ReactionSchema`/`Reaction`,
    `FieldChangeEntrySchema`/`FieldChangeEntry`, `FeedVisibility`,
    `RecordSubscriptionSchema`/`RecordSubscription`, `SubscriptionEventType`, and the
    `data`-namespace `NotificationChannel` → **removed**. `FeedItemType` and
    `FeedFilterMode` are **kept** (live UI activity-timeline config). For notification
    channels use `NotificationChannelSchema` from `@objectstack/spec/system`.
  - `@objectstack/client` — `client.feed.*` (`list` / `create` / `update` / `delete` /
    `addReaction` / `removeReaction` / `pin` / `unpin` / `star` / `unstar` / `search` /
    `getChangelog` / `subscribe` / `unsubscribe`) and the re-exported feed response
    types → **removed**. One-line fix: use `client.data.*` on `sys_comment` /
    `sys_activity`, e.g. `client.data.create('sys_comment', { object, record_id, body })`
    and `client.data.find('sys_activity', { filters: [['record_id', '=', id]] })`.
  - `@objectstack/metadata-protocol` — `ObjectStackProtocolImplementation` no longer
    implements the 14 feed methods; its constructor
    `(engine, getServicesRegistry?, getFeedService?, environmentId?)` becomes
    `(engine, getServicesRegistry?, environmentId?)`. One-line fix: delete the third
    argument.

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

- 0e41302: fix(metadata-protocol): unscoped metadata list dedupes package-aware, not by bare name (ADR-0048 #1828)

  `getMetaItems` merged registry items, `sys_metadata` overlay rows, draft-preview
  rows, and MetadataService items into `Map`s keyed by bare `name`, so two installed
  packages shipping the same `type/name` (e.g. `page/home`) collapsed to one row
  (last-write-wins) on an unscoped `GET /meta/:type` whenever either package had an
  overlay — and the frontend prefer-local resolution, which reads that list, could
  no longer tell the two packages' rows apart.

  The three merge sites (plus the env/org pre-merge) now key by `(package, name)`,
  mirroring `getMetaItem`'s scoped-then-global-fallback resolution: colliding rows
  stay distinct each with its own `_packageId`, a package-less (env-wide) overlay
  still wins over the single artifact it customizes (ADR-0005 precedence and
  single-package behaviour unchanged), and the registry-hydration artifact graft is
  scoped to each row's own `package_id` so a collision no longer mislabels provenance.

- b8a21ad: Publish/discard package drafts in the draft's own org scope, fixing `no_draft` after saving a draft via Studio.

  Studio "Save Draft" (`PUT /meta/:type/:name?mode=draft`) never threads the session's `activeOrganizationId`, so the draft row is written env-wide (`organization_id = NULL`). "Publish" (`POST /packages/:id/publish-drafts`) resolves the active org and passed it to `promoteDraft`, which looked the draft up with a strict `organization_id = <org>` equality — so it 404'd (`[no_draft] No pending draft exists …`) on the env-wide row it could never match, even though `listDrafts` had already surfaced that draft to the publish CTA (PR #1852's `$or`). `discardPackageDrafts` had the same latent gap.

  `listDrafts` now projects each draft's own `organizationId`, and `publishPackageDrafts` / `discardPackageDrafts` promote / delete each draft in that scope (env-wide stays env-wide, per-org stays per-org). Seed-body capture and the ADR-0067 revert-plan pre-state read are scoped the same way.

  Fixes #3115.

- beaf2de: fix(metadata-protocol): strip static `readonly` on INSERT at the data-write ingress (#3043)

  #2948/#3003 made static `readonly: true` fields server-enforced on UPDATE (a
  non-system PATCH forging `approval_status: 'approved'` is silently stripped in
  the engine), but INSERT was exempt. For approval/status/verdict columns that
  exemption was the _shorter_ attack: instead of the #3003 draft-then-PATCH move, a
  non-system caller could `POST` a record already `approval_status: 'approved'` in
  one step — and the UPDATE-only strip never reached it.

  The strip now also runs on INSERT, but at the **external data-write ingress**
  (`DataProtocol.createData` / `createManyData` / `batchData` / `cloneData`) rather
  than in the engine. That seam is the single point every external programmatic
  create funnels through — the REST CRUD route, the GraphQL/MCP dispatcher
  (`bridge.create` → `callData` → `createData`), and bulk import — while **trusted
  internal writers** (better-auth's adapter, the metadata repository, the seed
  loader) call `engine.insert` directly and bypass it. Enforcing at the ingress
  protects every caller/agent path at once without stripping the internal writers
  that legitimately seed read-only columns on create (identity provisioning,
  provenance stamps, event-log cursors) — the blast radius an engine-level insert
  strip would have.

  - **Caller-forged only, at the ingress.** The payload here is raw caller input
    (the security middleware stamps `owner_id` / `organization_id` later, inside
    `engine.insert`), so only keys the caller actually sent are dropped; server
    stamps are added afterwards and are unaffected.
  - **Re-derives the default.** A stripped field falls back to its declared
    `defaultValue` in the engine (a forged `approval_status` becomes `draft`, not
    NULL).
  - **System-context exempt.** `isSystem` writes still seed read-only columns.
  - **Silent** (HTTP 2xx), per-row on batch/import. `readonlyWhen` stays
    INSERT-exempt (a conditional lock needs a prior record).
  - **Author-defined business objects only.** Platform objects (`managedBy` set,
    or the `sys_` namespace) carry their own field-write governance that a silent
    strip must not pre-empt — e.g. ADR-0086 REJECTS (403) a forged
    `managed_by:'package'` on `sys_permission_set`, and #3004 rejects a forged
    `owner_id`; several of those columns are `readonly`, so stripping them here
    would swallow the payload the guard is meant to reject. The #3043 threat is app
    approval/status fields, never `sys_` — the same boundary `applySystemFields`
    uses for ownership.

  Behavior change: a non-system create through the data API (REST / GraphQL / MCP /
  import) can no longer seed a `readonly` column from the payload. Flows that
  legitimately write read-only columns at creation must run with a system context
  (`isSystem`), the same requirement the UPDATE strip already imposes.

- 8abf133: **Breaking (discovery response shape): retire the residual feed capability surface (#3180, follow-up to #1959 / ADR-0052 §5).**

  The feed backend was retired long ago; #1959 removed the feed contracts + SDK. This
  removes the last discovery/dispatcher references to it, and fixes a real bug where the
  `comments` capability was permanently `false`.

  - `@objectstack/spec` — `WellKnownCapabilitiesSchema.feed` and `ApiRoutesSchema.feed`
    (`routes.feed`) are **removed**, and the `/api/v1/feed` entry is dropped from
    `DEFAULT_DISPATCHER_ROUTES`. FROM → TO: clients reading `discovery.capabilities.feed`
    or `discovery.routes.feed` → use `discovery.capabilities.comments`; comments/activity
    are served by the generic data API on `sys_comment` / `sys_activity`
    (`/api/v1/data/sys_comment/…`).
  - `@objectstack/metadata-protocol` — `getDiscovery()` no longer emits the always-`false`
    `feed` service/capability. **Bug fix:** the `comments` capability previously keyed off
    the deleted `'feed'` service (so it was permanently `false` after #1955); it now tracks
    the presence of the `sys_comment` object (provided by the always-on audit slate), so
    `declared === enforced`.
  - `@objectstack/client` — the internal `feed: '/api/v1/feed'` route constant is removed
    (it only existed to satisfy the now-removed `ApiRoutes.feed` type; no client code used it).

- 515f11a: fix(seed): replaying seeds no longer corrupts lookup natural keys on the upsert update path

  Every dev-server restart replayed package seeds in upsert mode, and any record whose
  lookup/master_detail was authored as a natural key could have that reference overwritten
  with NULL on the update path (`NOT NULL constraint failed` on required columns; silent
  link loss on nullable ones). Four fixes:

  - An unresolved reference now leaves the column untouched (deferred to pass 2) or drops
    the record loudly — it is never written as NULL over an existing row.
  - DB-side reference resolution probes the target dataset's declared `externalId` (e.g.
    `email`) before falling back to `name` and `id`, matching how in-memory resolution
    already keyed records.
  - A rejected update (e.g. a `state_machine` rule vetoing the replay) no longer severs
    natural-key resolution for downstream child datasets.
  - Replays are idempotent: an upsert/update whose declared fields already match the
    existing row is skipped instead of rewritten (no more `updated_at` churn or lifecycle
    re-validation on every boot).

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
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
- Updated dependencies [06cb319]
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
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/metadata-core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/metadata-core@15.1.1
- @objectstack/formula@15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(discovery): honest capabilities — standardized stub/fallback marker + realtime route honesty (ADR-0076 D12/A1.5 framework slice, #2462)

  **Spec** — new service self-description marker for honest discovery
  (ADR-0076 D12): `SERVICE_SELF_INFO_KEY` (`__serviceInfo`),
  `ServiceSelfInfoSchema` / `ServiceSelfInfo`, and `readServiceSelfInfo()`,
  which also normalizes plugin-dev's legacy `_dev: true` flag to
  `{ status: 'stub', handlerReady: false }`. A registered service that is a
  stub / dev fake / degraded fallback self-identifies via this marker; a fully
  real service carries no marker.

  **Runtime + metadata-protocol** — both discovery builders
  (`HttpDispatcher.getDiscoveryInfo` and the protocol shim's `getDiscovery`)
  now honor the marker instead of hardcoding `status: 'available',
handlerReady: true` for every registered service. Dev stubs report `stub`,
  the ObjectQL analytics fallback reports `degraded` (it keeps serving — no
  `/analytics` 404), and consumers can finally trust
  `status === 'available'` / `handlerReady === true`.

  **Realtime honesty fix** — discovery no longer advertises a
  `/realtime` route or `websockets: true`: `service-realtime` is an
  in-process pub/sub bus, no dispatcher branch or plugin mounts any
  `/realtime` HTTP surface, so the advertised route always 404'd. The
  registered service now reports `status: 'degraded', handlerReady: false`
  with no route (clients using the SDK are unaffected — it falls back to the
  conventional path, which behaves exactly as before). Also corrects the
  advertised realtime provider from the nonexistent `plugin-realtime` to
  `service-realtime`.

  **REST (A1.5)** — the REST layer's protocol dependency is narrowed from the
  `ObjectStackProtocol` god-union to the new `RestProtocol =
DataProtocol & MetadataProtocol` slice (exported from
  `@objectstack/rest`), per the ADR-0076 D9 incremental narrowing guidance.
  Type-level only; no runtime change.

- f531a26: OWD posture is now enforced on the runtime write path (#3050). `metadata-protocol` gains the ADR-0094-addendum `registerAuthoringGate(type, gate)` seam — an awaited, throwing pre-persistence hook inside `saveMetaItem` (draft and publish-mode saves; environment writes only). `plugin-security` registers the `object` posture gate on it: an environment overlay of a packaged object may only TIGHTEN `sharingModel`/`externalSharingModel` (ADR-0086 D1 — closes the `OS_METADATA_WRITABLE=object` unvalidated-widening hole), and `externalSharingModel ≤ sharingModel` (ADR-0090 D11) is now rejected at save time instead of only by CLI lint. Write-path only — stored metadata keeps loading unchanged.
- d75c7ac: Package-draft publishing is now turn-atomic (ADR-0067 Decision-2, #3066). `publishPackageDrafts` runs every draft promotion AND the `sys_metadata_commit` record inside ONE engine transaction — a mid-batch failure rolls back the whole batch (`publishedCount: 0`; the causal item carries its real error, the rest report `batch_aborted`). Side effects (registry refresh, table DDL, seed apply, materializers, ADR-0094 projections, events) run after the metadata commits and are surfaced-not-swallowed on failure. `@objectstack/objectql`'s `engine.transaction()` now JOINS an already-open ambient transaction instead of opening a nested driver transaction (deadlock on single-connection pools; escaped the outer rollback). BREAKING (behavioral): API consumers that relied on partial batch publishes ("2 of 3 landed") now get all-or-nothing; engines without `transaction()` (memory driver, minimal stubs) keep the previous sequential behavior.

### Patch Changes

- f531a26: fix(metadata-protocol): findData now rejects unknown `$`-prefixed query parameters with 400 `UNSUPPORTED_QUERY_PARAM` instead of silently treating them as implicit field-equality filters that match zero rows (#2926 ⑩). A `$`-prefixed key can never be a field name, so this is loud-failure only for the unsupported-alias class; bare-key implicit equality filtering is unchanged. The error message lists the supported aliases ($top, $skip, $orderby, $select, $count, $search, $searchFields, $filter, $expand).
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
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0
  - @objectstack/formula@15.1.0
  - @objectstack/metadata-core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/formula@15.0.0
  - @objectstack/metadata-core@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Minor Changes

- 1dede32: Make the `sys_permission_set` data record a pure projection of the metadata layer (ADR-0094; framework#2875) — one authoritative store for permission-set definitions, retiring the two-store split-brain behind the #2857 display-freshness class.

  - **`@objectstack/metadata-protocol`**: new `registerMutationProjector(type, fn)` — an awaited, best-effort per-type hook invoked after persistence inside `saveMetaItem` / `publishMetaItem` / `deleteMetaItem`, so a derived data-plane read-model is already consistent when the write returns (outcome surfaced as `projectionApplied` on the response). Complements the fire-and-forget `onMetadataMutation` listeners.
  - **`@objectstack/plugin-security`**: every non-system data-door write on `sys_permission_set` (Setup CRUD, bulk imports, any ObjectQL path) is redirected into the metadata store by an engine middleware; the record is written only by the projector. Boot reconciliation projects env overlays onto records (Studio-created sets now appear in Setup), backfills legacy data-door-only records into metadata once, and re-projects drifted records from the effective body (metadata wins). The projector also syncs the metadata manager's in-memory `permission` entry, so evaluator resolution and the Setup display can no longer disagree.

  Behavior changes: "deleting" an artifact-backed permission set through the data door now resets it to its declared body instead of removing the row; renaming a set through the data door is rejected (`400`) — clone to a new name instead; record edits that predate this change and are shadowed by a metadata definition are discarded (loud warning) at first boot, since they were never enforced.

  Moved exports (from `@objectstack/plugin-security`): `upsertEnvPermissionSet` now lives in `permission-set-projection.js` (still re-exported from the package root) and **creates** missing records; `projectEnvPermissionOnMutation` / `subscribeEnvPermissionProjection` are replaced by `projectPermissionMutation` / `registerPermissionSetProjection`.

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/metadata-core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/metadata-core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/metadata-core@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0
  - @objectstack/metadata-core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/metadata-core@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/metadata-core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/metadata-core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/metadata-core@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Minor Changes

- 1056c5f: Package uninstall now revokes the package's data-plane permission rows (#2747, ADR-0086 D3 / ADR-0090 D5 "no ghost grants").

  **`@objectstack/metadata-protocol`**: `deletePackage` gains an
  uninstall-cleanup seam — the exact mirror of the publish materializer:
  domain plugins register named cleanups via `registerUninstallCleanup(name,
fn)` and every cleanup runs with the uninstalled package id, its outcome
  reported on the new `cleanups` array of the response (a failed revocation is
  visible, never silent). `deletePackage` also unregisters the package from
  the in-memory SchemaRegistry (best-effort), so the running kernel stops
  serving it without waiting for a restart.

  **`@objectstack/plugin-security`**: registers the
  `security.package-permissions` cleanup — deletes the package's own
  `sys_permission_set` rows (`managed_by: 'package'` + matching `package_id`
  only; env-authored and foreign-package rows are never touched, ADR-0086 D4),
  their `sys_position_permission_set` / `sys_user_permission_set` bindings
  (bindings first, so no dangling grants), and the package's
  `sys_audience_binding_suggestion` rows (a reinstall re-prompts fresh).
  Also fixes the engine-call signature in the suggestion module: `find`/`delete`
  read `context` from their second argument — the previous trailing
  `{ context }` argument was ignored, so deletes ran principal-less.

  **`@objectstack/rest`**: `DELETE /api/v1/packages/:id` (no version pin) now
  goes through `protocol.deletePackage` — one uninstall semantic instead of a
  bare `sys_packages` row delete — removing the package's metadata, durable
  record, registry entry, and running the cleanups; the response carries
  `deletedCount` + `cleanups`. A version-scoped delete keeps the narrow
  durable-registry semantics.

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
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0
  - @objectstack/metadata-core@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Minor Changes

- fc7e7f7: Enforce the package namespace-prefix rule for Studio-authored packages.

  The protocol requires every object name in a package to carry the package's
  `manifest.namespace` prefix (`crm_account`); `defineStack()` enforces this at
  compile time via `validateNamespacePrefix`. Studio/runtime-authored packages
  never take that path, and they were created without a namespace at all — so the
  rule was silently inert and objects published with bare, collision-prone names.

  Two runtime changes close the gap:

  - `protocol.installPackage` now derives a default namespace from the package id
    (`com.example.leave` → `leave`) when the manifest declares none, and persists
    it on the manifest (in-memory registry + `sys_packages`). An explicitly
    declared namespace always wins (e.g. HotCRM's `crm`).
  - `protocol.publishPackageDrafts` now rejects any object draft whose name lacks
    the package namespace prefix, before promoting anything (atomic), with an
    actionable message (`Rename it to 'leave_ticket'`). Packages that declare no
    namespace are grandfathered — mirroring `defineStack`, the rule is not
    invented at enforcement time.

  The per-object prefix check and the id→namespace derivation are extracted into
  `@objectstack/spec/kernel` (`validateObjectNamespacePrefix`,
  `deriveNamespaceFromPackageId`) as the single source shared by `defineStack` and
  the runtime publish path, so the two enforcement points cannot drift.

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
  - @objectstack/formula@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/metadata-core@13.0.0

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
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/metadata-core@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- 8b3d363: Package metadata seed can no longer wedge the platform via record-change automation.

  A seeded record whose lifecycle flow self-triggered (a `record-after-update` flow
  writing back to its own trigger record) looped forever when its boolean re-entry
  guard never tripped — booleans persist as integer `1` on SQLite/libsql and CEL
  `1 != true` is `true`. During first-boot seed (which awaits automation) this hung
  the whole kernel build.

  Three layers:

  - `ExecutionContext.skipTriggers` (set by the seed-loader, threaded onto
    `HookContext.session` via `buildSession`) makes the record-change trigger skip
    flow dispatch for seed/bulk writes — seed data is end-state reference data, not
    user events. Lifecycle hooks still run.
  - `coerceBooleanFields()` converts SQLite 0/1 (and `'0'/'1'/'true'/'false'`) to
    real booleans on the after-hook view of a record (`hookContext.result` /
    `.previous`), so flow conditions see JS booleans. The value returned to the
    caller is unchanged.
  - The automation engine breaks a flow re-entering for the same record while an
    execution is still on the stack (`activeRecordFlows`), a backstop for any
    self-trigger loop.

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/metadata-core@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Minor Changes

- 60dc3ba: ADR-0087 P0 — enforce the protocol version handshake (make `engines.protocol` real).

  `PluginEnginesSchema.protocol` (ADR-0025 §3.2, protocol-first per §3.10 #3) was declared, documented, and checked by no loader or installer — an ADR-0078 "declarable-but-inert" violation. A package built against an incompatible protocol major failed deep in a schema `.parse()` or a renderer contract instead of at the boundary.

  - **`@objectstack/spec`**: exports `PROTOCOL_VERSION` / `PROTOCOL_MAJOR` (`kernel`) — the single source of truth the handshake checks against. A drift test keeps it in lockstep with the package major.
  - **`@objectstack/metadata-core`**: adds `checkProtocolCompat()` (pure, major-grained range check), `assertProtocolCompat()`, and the structured `ProtocolIncompatibleError` (`OS_PROTOCOL_INCOMPATIBLE`, carrying both versions and the `objectstack migrate meta --from N` command). It refuses only on a _positive_ mismatch determination; absent ranges are grandfathered (warn) and unrecognized ranges never cause a false rejection.
  - **`@objectstack/metadata-protocol`**: `installPackage` runs the handshake before writing to the registry — an incompatible package is refused with a machine-actionable diagnostic instead of crashing later.

  Additive and backward compatible: packages that declare no `engines.protocol` range keep loading (with a warning). Part of the ADR-0087 epic (#2643); resolves #2644.

- 1dd5dfd: feat(packages): edit a package manifest via `PATCH /packages/:id`

  Adds an editable path for a package's `name` / `description` / `version` after
  creation: `SchemaRegistry.updatePackageManifest` (merges in-memory, preserving
  lifecycle state), `protocol.updatePackage` (re-persists to `sys_packages`), and
  the `PATCH /packages/:id` route in the HTTP dispatcher. `id` / `scope` / `type`
  remain immutable.

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/metadata-core@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

### Patch Changes

- 75c310f: Rewrite the `writable_package_required` rejection message as user-facing remediation ("switch to a writable package in the package selector, or create a new one") instead of developer-facing copy that cited an internal ADR path — the message is surfaced verbatim as a Studio toast. The ADR pointer moves to a `docs` property on the error; `code`, `status`, and `packageId` are unchanged.
- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/metadata-core@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/metadata-core@12.1.0
  - @objectstack/types@12.1.0

## 12.0.0

### Minor Changes

- 9796e7c: feat(security): two-doors separation for permission sets (ADR-0086 P2)

  Splits who may change a permission set into two non-overlapping doors, enforced
  at the data layer instead of by convention:

  **块 1 — the package door (publish-time materialization).**
  `ObjectStackProtocolImplementation` gains a generic publish-time materializer
  registry (`registerPublishMaterializer(type, fn)`). When a draft of a registered
  type is published, its body is projected into a data-plane row and the result is
  surfaced on the publish response as `materializeApplied` (best-effort, never
  thrown — same contract as `seedApplied`). `promoteDraft` now returns the draft's
  `packageId` so the materializer can stamp the owning package. `plugin-security`
  registers a `permission` materializer that upserts the published set into
  `sys_permission_set` with `managed_by:'package'` + `package_id` — so a set
  authored through the studio package door (saved as a `permission` draft, then
  published) lands in the admin surface with the exact provenance the boot seeder
  already stamps, now on the runtime publish path too. The single-set upsert is
  shared with `bootstrapDeclaredPermissions` (`upsertPackagePermissionSet`), so
  both paths apply the same own-row / foreign-package / env-authored rules.

  **块 2 — the admin door (data-layer write gate).**
  The security middleware now refuses any admin-door write
  (`update`/`delete`/`transfer`/`restore`/`purge`) to a `sys_permission_set` row
  with `managed_by:'package'`, and refuses an `insert` that forges
  `managed_by:'package'`. The gate fails closed regardless of the caller's grants
  (a platform admin with `modifyAllRecords` is blocked just the same), so it is a
  real data-layer boundary rather than a UI hint. System/boot writes carry
  `isSystem` and bypass the whole middleware, so the boot seeder and the publish
  materializer are unaffected. Env-authored sets (`managed_by` `user`/`platform`
  or absent) stay freely editable through the admin door — the two doors never
  overwrite each other.

### Patch Changes

- b5be479: fix(protocol): versionless package installs now persist to sys_packages (#2532)

  `installPackage` writes both package stores, but its durable half was guarded by
  `pkgSvc?.publish && manifest.version` — silently skipping every versionless
  runtime-created base (`{id, name}` from the builder / Setup). Those packages
  lived only in the in-memory registry and vanished on restart, while their
  metadata and tables survived. The version is now defaulted (`0.1.0`) instead of
  skipping, a failed persist logs loudly instead of silently, and `deletePackage`
  drops the `sys_packages` record so an uninstalled package no longer resurrects
  at the next boot (service-package hydrates that table into the registry).

- 2d567cb: Runtime-authored (Studio) hooks now execute their `body` (#2588).

  Previously a hook authored at runtime (saved via `protocol.saveMetaItem` /
  `publish-drafts`) loaded into the registry but its L1/L2 `body` never ran — the
  metadata-service bind path passed no `bodyRunner` and the engine's
  `_defaultBodyRunner` fallback was never installed, so the binder silently
  skipped the body. Now:

  - `AppPlugin` installs the QuickJS-sandboxed hook body runner as the engine
    default at boot (`engine.setDefaultBodyRunner`), so bind paths without an
    explicit runner can execute bodies. Opt out with
    `OS_DISABLE_AUTHORED_HOOKS=1` to keep runtime-authored hook bodies inert.
  - `ObjectQLPlugin` re-binds runtime-authored hooks from their `sys_metadata`
    rows at `kernel:ready` (cold boot — env-scoped kernels never surfaced these
    rows before), on `metadata:reloaded`, and on every hook mutation through the
    new `protocol.onMetadataMutation` listener — so saves, publishes, edits, and
    deletes take effect live, without a restart. Package-artifact hooks are
    excluded from this bind path (AppPlugin already binds them with an explicit
    runner) so they no longer risk double execution.
  - `@objectstack/metadata-protocol` gains a server-side
    `onMetadataMutation(listener)` API: `saveMetaItem` / `publishMetaItem` /
    `deleteMetaItem` notify subscribers after persistence succeeds.

- e3498fb: fix(runtime): carry spec-validation issues (and the 422 status) through metadata save/publish errors

  `protocol.saveMetaItem` already validates a metadata draft against its spec Zod
  schema and, on failure, throws a rich error: HTTP `status: 422`, `code:
'invalid_metadata'`, and a structured `issues: [{ path, message, code }]` array
  (field-anchored, `superRefine` issues included). But the HTTP dispatcher's catch
  blocks collapsed all of that to a single message — the save path even hardcoded
  `400` — so a client could only show a generic "failed validation" banner with no
  way to point at the offending field. The publish path was worse: the per-draft
  catch in `publishPackageDrafts` flattened each failure into `{ type, name, error
}` and **dropped `issues` entirely**.

  Now:

  - A new `errorFromThrown(e, fallbackStatus)` dispatcher helper preserves the
    error's own `status` (so validation surfaces as **422**, not a downgraded 400)
    and attaches `{ code, issues }` under `error.details` when present. Errors that
    carry neither behave exactly as before. Used by the metadata **save** (`PUT
/meta/:type/:name`) and **publish** (`POST /packages/:id/publish-drafts`)
    catch sites.
  - `publishPackageDrafts` now carries `issues` into each `failed[]` entry, so a
    validation failure during publish is field-anchored too (it previously kept
    only the message).

  This is the server half of "surface validation at the save/publish moment, on
  the field" — the Studio can now map each issue back to its input instead of
  showing a wall-of-text banner. Purely additive to the error payload; the only
  behavior change is the more-correct 422 (was 400) for a failed metadata save.

- 806a40a: Stop runtime view personalization from permanently removing views from the switcher.

  A console personalization PUT (grid column sort, inline edit, …) sends only the raw
  view config — no top-level `viewKind`/`object`. Persisted verbatim, the overlay row
  replaced the flattened package entry wholesale on read, stripping the identity fields
  every switcher-style consumer filters on (`viewKind && object`) — one sort click and
  the view vanished until the DB row was deleted (#2555).

  Two independent guards: `saveMetaItem` now inherits the missing `viewKind`/`object`/
  `label` from the registry entry the overlay shadows before persisting, and
  `getMetaItems` heals identity-less rows already in the DB the same way on read. The
  overlay's own fields always win; `defineView` container bodies are untouched.

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0
  - @objectstack/metadata-core@12.0.0
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/metadata-core@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/metadata-core@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/types@11.8.0
- @objectstack/metadata-core@11.8.0
- @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/metadata-core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/metadata-core@11.6.0
- @objectstack/formula@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/metadata-core@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/metadata-core@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/metadata-core@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/metadata-core@11.2.0
  - @objectstack/types@11.2.0

## 11.1.0

### Minor Changes

- 13dbcf2: Extract metadata management into `@objectstack/metadata-protocol` (ADR-0076)

  `protocol.ts` (the `ObjectStackProtocol` implementation — sys_metadata CRUD, draft/publish, locks, package ownership, diagnostics) plus its `sys-metadata-repository`, `metadata-diagnostics`, `seed-loader`, and `build-probes` helpers were metadata-domain code that lived inside `@objectstack/objectql` for historical reasons. They now live in a dedicated **`@objectstack/metadata-protocol`** package.

  The protocol no longer depends on the concrete `ObjectQL` class — it is typed against an injected `MetadataHostEngine` interface (the engine is still injected at runtime). Dependency direction is now one-way (`objectql → metadata-protocol`); there is no cycle.

  **Non-breaking**: `@objectstack/objectql` re-exports every previously public symbol (`ObjectStackProtocolImplementation`, `SysMetadataRepository`, `SysMetadataEngine`, `SeedLoaderService`, `runBuildProbes`, …), so existing imports keep working.

  This is Step 1 of ADR-0076. A later step turns the protocol into a capability plugin so `objectql` itself stops depending on it (making the engine lean by construction).

  Also adds a lean **`@objectstack/objectql/core`** entry — the engine/registry/hooks/validation surface only, with no kernel plugin or metadata protocol — so a thin embedder can import just the engine and never pull `@objectstack/metadata-protocol` into its bundle. A boundary ratchet test guards the entry.

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0
  - @objectstack/formula@11.1.0
  - @objectstack/metadata-core@11.1.0
