# @objectstack/metadata-protocol

## 17.0.0

### Major Changes

- debe2f6: refactor(spec)!: `api` is code-only — withdraw a runtime create door the endpoint matcher could never read (#5488, ADR-0049 remove side)

  <!-- adr-0087: registered api-runtime-create-withdrawn -->

  **FROM → TO:** `PUT /api/v1/meta/api/{name}` (200 "Saved") → declare the endpoint as a
  stack artifact (`**/*.api.ts`, or `defineStack({ apis })`) and ship it through
  `publishPackage`. The runtime write now answers **403 `NOT_CREATABLE`**, in `?mode=draft`
  as well as direct-active. The artifact route is **unchanged** — a `**/*.api.ts` file valid
  before this release is valid after it, byte for byte.

  `DEFAULT_METADATA_TYPE_REGISTRY`'s `api` entry declared `allowRuntimeCreate: true` and the
  runtime never honoured it. Measured on a real showcase boot (`objectstack dev --fresh`, 47
  plugins):

  ```
  PUT /api/v1/meta/api/e8_backdoor   → 200 {"success":true,…,"message":"Saved …"}
  GET /api/v1/apps/showcase/backdoor → 404      (anonymous AND authenticated)
  ```

  …and **no** `[EndpointMatcher] … EXCLUDED` line anywhere in the boot log: the endpoint was
  not gated out, it was never in the index at all. The serving criterion belongs to
  `IMetadataService.matchEndpoint` → `EndpointMatcher` → `MetadataManager.listForIndex('api')`,
  which reads the manager's own registry plus its registered loaders
  (`["filesystem","memory"]` on dev/serve). A runtime write lands in `sys_metadata`, which is
  in neither. So the declaration promised a capability that could not exist.

  A declared-but-unhonoured capability is ADR-0049 false compliance, and "answers Saved, then
  404s forever" is its most dangerous shape for the AI authors ADR-0033 targets. The
  maintainer ruled REMOVE on 2026-08-07 rather than converge the read path: making the matcher
  read `sys_metadata` re-opens cache, invalidation, tenancy and the ADR-0110 D3
  miss-vs-outage distinction on a new read path, and there is no business pull for
  Studio-authored endpoints today — 17.x serves declarative endpoints through stack artifacts,
  which is what showcase uses (#5040 E8, LIVE).

  ## The retirement kit

  - **`allowRuntimeCreate: false`** on the `api` registry entry. With `allowOrgOverride`
    already `false`, the type is now **code-only** — the `job` / `agent` / `capability` shape —
    so the existing #5086 inlet refuses before persistence, on every kernel, with
    `code: 'NOT_CREATABLE'`, `status: 403` and a prescription derived from the entry's own
    `filePatterns[0]`. No new refusal mechanism was written for this.
  - **`gateApiDraftsForPublish` is retired** (`metadata-protocol`), together with its nine
    tests and the `PUBLISH_DRAFTS_NAMESPACE_REMEDY` string only it appended. It landed two
    days earlier in PR #5279 and is removed **deliberately and on the record**, not lost in a
    refactor: it gated a draft→active promotion into a state the matcher can never read, and
    with the inlet closed no `api` draft can exist for it to judge. The in-place comment at
    its old call site carries the reasoning.
  - **The `metadata-plugin.zod.ts` decision block is rewritten as a recorded overturn.** It
    used to record CODE-ONLY as "considered and rejected"; its three bullets are kept verbatim
    with what became of each, so the reversal is auditable rather than silently contradicted.
  - **The `api` create seed is removed** and `api` joins `KNOWN_UNSEEDED`. A pre-filled "New
    API Endpoint" form whose save can only 403 is the UI half of the same false compliance.
  - **Pins, not deletions.** The two #5271 tripwire pins that asserted
    `allowRuntimeCreate: true` are **replaced** by retirement pins asserting the new verdict —
    their comments predicted this exact consequence, and both predictions were correct. Every
    rejection case asserts `code` **and** `status` (ADR-0112 envelope), never `toThrow()`
    alone (#6142).

  ## What did NOT change

  `validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure` remain the one judge
  of what is servable, on the route that serves: the stack schema, `publishPackage` (#5189),
  and again at load in `buildEndpointIndex` (PR #5203). ADR-0121's "publish REJECTS" ruling is
  intact. `deleteMetaItem` stays ungated so pre-existing rows can be cleaned up, and
  `OS_METADATA_WRITABLE=api` remains the single operator escape hatch — note it unlocks the
  **write** only; the endpoint still will not be served, which is why it is a diagnostic
  rather than a workaround.

  **Re-entry path**, recorded by the ruling: if #2657 Part B promotes `apis` to a registered
  type **with a real consumption path**, the flag and the publish gate come back together —
  implementation first, declaration second.

- ac37fc6: fix(metadata-protocol)!: batch per-row results now deliver the declared `BatchOperationResultSchema` shape (#4793)

  **Breaking wire change** on the per-row `results` entries of the three
  bulk-write endpoints — `POST /data/:object/batch`, `/updateMany`,
  `/deleteMany`. The rows had drifted from the schema that declares them:
  `BatchOperationResultSchema`, the client SDK's exported `BatchOperationResult`
  type and the reference docs all said `errors: ApiError[]` / `data` / `index`,
  while the wire carried `error: string` / `record` and never sent `index`. A
  TypeScript consumer written against the published type compiled, validated,
  and read `undefined` at runtime. The wire now delivers exactly what is
  declared (a conformance pin parses every emitted row against the schema, so
  the two cannot silently fork again).

  **FROM → TO, per row:**

  | Before (legacy wire) | After (declared schema)     | Your fix                                                                                           |
  | -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
  | `row.error` (string) | `row.errors` (`ApiError[]`) | read `row.errors?.[0]?.message`; branch on `row.errors?.[0]?.code`                                 |
  | `row.record`         | `row.data`                  | rename the read                                                                                    |
  | — (never sent)       | `row.index` (number)        | new — the row's position in the request array; use it to correlate failure rows that carry no `id` |
  | `row.droppedFields`  | `row.droppedFields`         | unchanged                                                                                          |

  **Rollback marking is structured now.** The `ROLLED_BACK:` /
  `NOT_ATTEMPTED:` message-string prefixes that #4620 introduced (see the
  `many-data-atomic-real-or-refused` changeset — its description of those
  markers is superseded by this entry) are promoted to first-class
  `ApiError.code` values, registered in the spec's ERROR_CODE_LEDGER:

  - `errors[0].code === 'ROLLED_BACK'` — the row was written, then undone by the
    atomic batch rollback; `message` carries the causal row's index and error.
  - `errors[0].code === 'NOT_ATTEMPTED'` — the row never ran; an earlier row's
    failure aborted the batch.
  - the causal row keeps its own error code (e.g. `RECORD_NOT_FOUND`,
    `VALIDATION_FAILED`; an unclassified engine throw maps to `INTERNAL_ERROR`,
    with `httpStatus` mirrored when the error carried one).

  Branch on the code — do **not** regex message prefixes; the prefixes are gone.

  **Who is affected:** only readers of the _legacy_ keys — which were never in
  the schema or the SDK types, so they were reachable only via `as any` or bare
  JS. Code written against `BatchOperationResult` (the published contract) needed
  this change to start working and needs no migration. There is no
  dual-emission or compatibility fallback: this is a hard cut inside the v17
  major window, and the old keys simply no longer exist on the wire.

- 859cb83: `field` loses `allowRuntimeCreate` — a standalone `field` write is refused instead of silently doing nothing (#7893, ADR-0049 enforce-or-remove, maintainer-ruled 2026-08-12)

  **BEHAVIOUR CHANGE — what now gets refused, and what to do instead.**

  |                                                             | Before                                                                                                                                         | After                                                                    |
  | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
  | `PUT /api/v1/meta/field/{object}.{name}`                    | `200 {"success":true,"state":"active"}` — row persisted, `_diagnostics.valid: true`, and the field **never** appeared in the object's `fields` | `403 NOT_CREATABLE`, naming the remedy                                   |
  | `PUT /api/v1/meta/fields/{object}.{name}` (plural)          | `200` — same, via the URL fold closed in #7894                                                                                                 | `403 NOT_CREATABLE` — folds onto the singular and earns the same verdict |
  | `PUT /api/v1/meta/object/{name}` with the field in `fields` | `200`, and the field **is** read back                                                                                                          | unchanged — this is the route to use                                     |

  **The one-line fix:** author the field inside its object and write the whole
  object — `PUT /api/v1/meta/object/{object}` with the new entry in `fields` — or
  declare it in the object source (`**/*.object.ts`) and redeploy. The refusal
  body says exactly this.

  **Adding a field at runtime is not lost.** `object` keeps
  `allowRuntimeCreate: true`, so the operation still works on the route that
  actually composes; what is withdrawn is a second, broken _spelling_ of it. This
  is deliberately **not** the `api` (#5488) rationale reused — that ruling rested
  on "zero business pull", and "add a field" is the opposite, a core Studio/CRM
  operation.

  **Why it was removed rather than built.** `field` is the one declared type with
  no standalone existence: fields are authored inside the object
  (`ObjectSchema.fields`), so a `field` write minted a _separate_ `sys_metadata`
  row keyed `('field','<object>.<name>')` and nothing composed fragment rows into
  their parent — `applyRegistryWriteThrough` routes only `type === 'object'`, and
  `filePatterns` (`**/*.field.ts`) match nothing in any app. Measured end-to-end:
  the write answered 200 `state=active` and `GET /meta/object/showcase_task` then
  listed `fields = [title, status]` with the new field absent, forever. The row
  was even self-readable by name with `_diagnostics.valid: true` — well-formed and
  universally inert. Building the read path is a feature spanning at least three
  packages (a composition step that does not exist, ~20 `gate.fields` call sites,
  physical schema/migrations, cold boot); if ever wanted it is a separate card,
  implementation first and declaration second.

  **Existing rows.** `field` rows already written through the retired channel stay
  in `sys_metadata` and are **inert** — they were inert before this change too,
  because no read path ever composed them into an object. Nothing that used to
  work stops working, and no stored data is reinterpreted. They remain
  self-readable by name and still report `_diagnostics.valid: true`, which asserts
  only that the isolated document is well-formed (#8169 — the envelope has no "in
  effect" axis). Delete them at leisure: `deleteMetaItem` is deliberately not
  gated by this refusal, so repair stays possible.

  **Not changed:** #7743's overlay refusal. Overwriting a field a code package
  ships is still `403 NOT_OVERRIDABLE` — a different gate for a different
  question. Making field _overrides_ legal was never part of this decision.

  **Escape hatch:** an operator may set `OS_METADATA_WRITABLE=field` on a single
  deployment. Note this unlocks the _write_ only — the field still will not reach
  its object, so it is a diagnostic, not a workaround.

  The retirement kit:

  - `field` flipped to `allowRuntimeCreate: false` in
    `DEFAULT_METADATA_TYPE_REGISTRY`, with the ruling, the measurement and the
    rejected options recorded at the entry.
  - ADR-0087 D3 `SemanticMigration` `field-runtime-create-withdrawn` (major 17).
    There is **no** D2 conversion, deliberately: `allowRuntimeCreate` is a
    platform registry value, not an authorable one, so no authored source
    changes — an `**/*.object.ts` file valid before this change is valid after it,
    byte for byte. What changed is a runtime HTTP verdict.
  - The refusal's prescription no longer reads `field`'s own `filePatterns` back:
    `**/*.field.ts` names a route that has never worked, so `codeOnlySourceHint`
    gives fragment types their real remedy instead.
  - `field` auto-enrolled into the derived code-only refusal suite (both kernel
    topologies), and the plural spelling is pinned as folding onto the same gate —
    on the CREATE tier as well as the overlay one (#7894 closed the plural door;
    this card verifies the fold reaches the tier it retired).

  <!-- adr-0087: registered field-runtime-create-withdrawn -->

- 65f184b: fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

  `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
  foreign key. The write path filled it with `actor ?? 'system'`, so every
  metadata write without a caller actor (boot sync, migration, an internal call)
  stored the **string** `'system'` in a column whose declared type says "the id
  of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
  (`'usr_system'`) is not auto-provisioned on the current runtime either, so the
  value resolved to nothing under any reading. Any consumer that read the field
  by its declaration — `expand`, an owner column in a report, an audit timeline
  showing "who changed this" — got an id that could not be dereferenced.

  It had already cost twice. #4441 had to exempt every `readonly` field from the
  write-path referential-integrity check, because otherwise ordinary metadata
  authoring (package create / publish / clone) was rejected. #4551's
  dangling-reference audit had to skip the same set for the same reason. The
  field ended up the platform's only reference column that is neither enforced
  nor audited.

  **The fix is on the write path, not the declaration.** `recorded_by` stays a
  `lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
  "system-initiated (boot sync, migration, scheduled job)" — the standard
  expression of "no link", and already what this column's `set_null` delete
  behaviour means. No magic system-user account (a row that can never sign in yet
  holds an identity is a new security surface), and no `actor_kind` companion
  column.

  **Breaking — the repository contract is now explicitly nullable.**

  | Surface                                   | Before   | After                                 |
  | :---------------------------------------- | :------- | :------------------------------------ |
  | `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
  | `MetadataEvent.actor`                     | `string` | `string \| null`                      |
  | `MetadataItem.authoredBy`                 | `string` | `string \| null`                      |

  `actor` stays required rather than becoming optional on purpose: every call
  site must state which of the two it is, so a forgotten actor cannot silently
  become a fake foreign key. Migrating a caller:

  - **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
    or a label to satisfy the type: pass `null` instead.
  - **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
    the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
    that the _stored_ value no longer lies, not that no label may ever be shown).

  Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
  and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
  indistinguishable from a real user id to anything that resolves the field. They
  now surface `null`.

  **Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
  rewritten to `NULL` by a new command, which runs the conversion through the
  ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
  It is a dry run by default and safe to re-run — it selects only rows still
  holding the sentinel, so a second `--apply` converts nothing.

  The rewrite is **semantically equivalent, not a reinterpretation**: this column
  has only ever held that one sentinel, written by exactly one expression
  (`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
  expressible in the declared type.

  Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
  declaration already says "user id, system id, or `'system'`", so its `'system'`
  default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
  skip also stay — see the PR for why they are still correct.

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

- f61c8cf: feat(spec,metadata-protocol)!: a sort node spelling its direction `direction` is a 400, not a silently reversed page (#4721)

  **FROM → TO:** `orderBy: [{ field: 'updated_at', direction: 'desc' }]` →
  `orderBy: [{ field: 'updated_at', order: 'desc' }]`. One word. If you are on the
  `{field, direction}` shape because you moved code over from
  `IReportService.orderBy`, that contract is unchanged — it is `orderBy` on the
  QueryAST / `EngineQueryOptions` axis that has always been `{field, order}`.

  ## What was wrong

  `SortNodeSchema` was a plain `z.object`, so zod's default `.strip` applied.
  Measured on `main` before this change:

  ```
  SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
    →  { field: 'updated_at', order: 'asc' }
  ```

  `direction` was discarded and `order` fell back to its `asc` default. The sort
  therefore ran in the **opposite** direction and the request succeeded. Paired
  with `limit` — which is how a caller asks for "the latest N" — that is not a
  reordered page but a **different set of rows**, returned under an ordinary 200
  with nothing in the response to distinguish it from the answer that was asked
  for.

  `direction` is not a typo. It is the live vocabulary of a neighbouring contract,
  `IReportService.orderBy` (`@objectstack/spec/contracts`), and
  `plugin-auth/objectql-adapter.ts` already translates between the two by hand — a
  translation known to be necessary and enforced nowhere, which is the ADR-0049
  shape.

  ## What changed

  Both doors onto that shape, in one change:

  1. **`SortNodeSchema`** (`spec/src/data/query.zod.ts`) is now `strictObject`
     with `aliases: { direction: 'order' }`. An unknown key is rejected, and
     `direction` specifically gets the translation in the error message — edit
     distance can never bridge `direction` → `order`, so a bare "unrecognized key"
     would leave the caller exactly where the silent strip did.
  2. **`normalizeSortNodes`** (`metadata-protocol/src/protocol.ts`), the ingress
     every REST/RPC `orderBy` funnels through, refuses `{ field, direction }` with
     `400 INVALID_SORT` naming `order` and quoting the corrected node. Closing only
     the schema would repeat the door asymmetry of #1535/#4522: `SortNodeSchema` is
     reachable by three paths the REST normalizer never sees.

  | `orderBy` you send                                     | Before                      | After                                                       |
  | :----------------------------------------------------- | :-------------------------- | :---------------------------------------------------------- |
  | `[{ field: 'x', order: 'desc' }]`                      | descending                  | unchanged — descending                                      |
  | `[{ field: 'x', direction: 'desc' }]`                  | **200, ascending**          | `400 INVALID_SORT`, message names `order`                   |
  | `[{ field: 'x', order: 'desc', direction: 'asc' }]`    | 200, descending             | `400 INVALID_SORT`                                          |
  | `'-x'` / `['-x']` / `{ x: 'desc' }`                    | descending                  | unchanged                                                   |
  | `{ direction: 'desc' }` (the `{field: direction}` map) | sorts by column `direction` | unchanged — a column may legitimately be called `direction` |

  Scope is deliberately narrow: **`QuerySchema`'s top level is untouched** and
  still accepts undeclared keys (`QuerySchema.safeParse({ object: 'sales',
nonsenseKey: 1 }).success === true`). That is tracked in the #4001 campaign map
  for its own batch, not smuggled in here.

  Related: #4674, #4720, #4363, #4371, #4001, ADR-0049.

  <!-- adr-0087: registered sort-node-direction-rejected -->

### Minor Changes

- 0800433: Lint an action nobody placed (ADR-0078 Phase 3, Tier-A `action-locations`).

  New advisory rule `action-no-placement`: an action that declares no
  `locations` and that no list view places by name renders on **no** surface —
  it parses, publishes, and appears in Setup, while no user can ever click it.
  ADR-0078 names this shape in its opening paragraph and Phase 3 asks for
  exactly this rule; the shared completeness predicate it envisioned was never
  built, so this lands standalone, one verified shape at a time.

  What made it verifiable now: objectui#3142 collapsed four disagreeing
  renderers onto one placement predicate. Before that, `action:bar` and the
  record header rendered an _undeclared_ action anyway, so the shape only looked
  inert on paper. As of objectui 17.1 it is measurably inert.

  Two things are deliberately **not** flagged:

  - **`locations: []`** — the documented headless action (callable over REST /
    MCP / AI, no UI surface). ADR-0110 D3 refuses an undeclared handler, so a
    headless declaration is the only legal way to expose one. The rule therefore
    distinguishes "nowhere, deliberately" (`[]`) from an unstated placement (key
    absent) and only reports the latter.
  - **Actions a view places by name** — `bulkActions`, `bulkActionDefs`
    (including `execution: 'aggregate'` defs, whose whole point is an action with
    no single-record home) and `rowActions`, across all three list-view tiers:
    `views[i].list`, `views[i].listViews.<key>` and the object-embedded
    `objects[i].listViews.<key>`.

  Advisory, never fatal — a view in another installed package may be the one
  placing the action, the same reason `validateSemanticRoles` and
  `lintLivenessProperties` warn rather than gate.

  Also: the action form schema in `@objectstack/metadata-protocol` no longer
  declares `shortcut` / `bulkEnabled`. Both were retired as `retiredKey()`
  tombstones in spec 17, and this schema is what the Studio designer renders its
  fallback form from — so advertising them handed authors two inputs that could
  only ever produce an unsaveable draft (objectui#3145 removed the matching
  dedicated controls). And `content/docs/ui/actions.mdx` now says which surface
  is the exception to location filtering, instead of a blanket claim its own
  showcase contradicted.

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

- 98877c9: feat(spec,metadata-protocol): `IObjectQLEngine.transaction` joins the slot contract, and `batchData`'s `atomic` flag becomes real — rollback or refusal, never silent best-effort (ADR-0119 D1/D4, #4612)

  **D1 — the contract fix.** `ObjectQL.transaction()` — ADR-0034's ambient
  transaction, shipped since v8.0.0 — was reachable from plugin space only
  through `as unknown as` casts: the metadata protocol's atomic publish and its
  `transactionalBatch` discovery probe, and the sys-metadata repository's
  `withTxn`, each declared a private structural slice of an engine none of them
  import. It is now declared on `IObjectQLEngine`, required per that contract's
  own rule, with its caveats written into the TSDoc as part of the declared
  meaning rather than left to be discovered: it covers the **default driver
  only**, and when that driver has no `beginTransaction` the callback runs with
  no transaction and no rollback. `MetadataHostEngine` and the sys-metadata
  repository's engine surface now type their optional member as
  `IObjectQLEngine['transaction']`, so a narrow host surface can no longer drift
  from the real signature. Runtime `typeof === 'function'` probes stay — that is
  test-double defence the type system does not replace.

  **D4 — the honesty fix.** `batchData`'s `options.atomic` promised "rollback
  entire batch on any failure (transaction mode)" and delivered a `break`
  statement. Every write before the failure stayed committed, and — the part that
  did the real damage — the response reported those rows `success: true` under
  the one flag whose job is to guarantee they were undone.

  Now an explicitly atomic batch runs inside ONE `engine.transaction()`: the
  first failure rolls back every prior write, and the response says so
  (`succeeded: 0`, with rows marked `ROLLED_BACK:` / the causal error /
  `NOT_ATTEMPTED:`, and no row reporting success). On a runtime that cannot roll
  back — no `transaction()`, or a default driver without `beginTransaction` — an
  atomic request is **refused** with `501 NOT_IMPLEMENTED` rather than silently
  degrading, matching the cross-object `/batch` route. `atomic` takes precedence
  over `continueOnError`, whose own description already scoped it to
  `atomic=false`. In atomic mode the upsert path no longer falls back to an
  insert when its update throws: inside an aborted transaction that fallback can
  only fail with a secondary error that buries the real cause.

  **Aligned declaration.** `BatchOptionsSchema.atomic` declared `.default(true)`
  while no enforcement site delivered atomicity — and the REST route forwards the
  original request body rather than the parsed output, so the declared default
  never reached the loop at all. The default is now `false`: the declaration is
  aligned down to what every site already does, rather than up to what none of
  them did. Honouring the old `true` would have silently flipped the failure
  semantics of every existing batch caller and hard-failed ordinary batches on
  any driver that cannot transact. Callers who were explicitly sending
  `atomic: true` now get what they always asked for; callers sending nothing keep
  today's behaviour exactly.

  If you were passing `atomic: true` and relying on partial results surviving a
  failure, that was the bug — switch to `atomic: false` (or omit it) for
  best-effort semantics.

  ADR-0119 also rules on two items landing separately: D2 specifies a
  framework-owned migration-journal runner for multi-step migrations too large
  for one transaction, and D3 retires the declared-but-unimplemented
  `IDataEngine.batch?`.

- f16e54e: ADR-0029 D9: a tenant object overlay registers as its own contributor LAYER instead of splicing the packaged owner out

  租户对 `object` 的定制（`sys_metadata` 行）此前以默认的 `own` 身份进入 `SchemaRegistry`。当该行的 `package_id` 与代码包所有者相同时，`registerObject` 会走"重复注册"分支把**打包的 contributor 直接摘掉**——打包定义不是被遮蔽，而是在写入时被销毁，注册表里不存在第二份副本；`loadMetaFromDb` 每次启动都无声重放这次销毁。

  D9 把这个层次关系显式化：

  - **第三种非拥有的 contributor 种类 `overlay`**，对基础层是替换语义。解析变成 `base = overlay ?? own`，extender 照旧叠在上面。**解析结果逐字节不变**（含 `_provenance: 'org'`）——变的只是注册表"记得"什么：打包的 owner 依然在下面。
  - `assertSingleOwnerPerObject` **一字未改**（overlay 不是 owner），新增一类违规：孤儿 overlay（有 overlay 没有 owner）。
  - **基础层的选择问"种类"，永远不问优先级**。`DEFAULT_OVERLAY_PRIORITY = 150` 只用于列举顺序：extender 的优先级是作者声明的，不能让某个包用 `priority: 140` 把租户的 overlay 挤出基础层。
  - **artifact 身份改为读 owner contributor 的层**，而不是合并后的文档。这一条不是层次化改动的自然推论：合并结果按设计仍带 `_provenance: 'org'`，所以只有从 owner 层读，`isArtifactBacked` 才不再说谎。
  - `provisionPrimary` / `provisionSearchCompanion` 的门从"是不是 `own`"改成"**是不是基础层**"，否则每个被 overlay 的对象的 `nameField` 都会变。
  - 行上的 `package_id` 是层的**来源标记**，从来不是所有权主张：同包正常；**无包（`sys_metadata` 哨兵）予以接受**（此前的抛错是借用 `own` 槽位的副产品）；绑定到**其他包**的行在生产者侧被明确拒绝，新错误码 `OBJECT_OVERLAY_PACKAGE_MISMATCH`（422），启动时计入 `loadMetaFromDb` 的 `errors`。
  - **迟到安装**：代码包为一个租户行已占据的对象名注册时，代码层成为 owner，租户的贡献被重新归类为它的 overlay 层——不再抛 "already owned by"，也不再把租户的定制吞掉。
  - 删除退化为**减法**：`SchemaRegistry.removeObjectOverlay(name)` 只摘掉 overlay 层，打包 owner 原地不动，因此"恢复"根本不是一次重新注册。

  **行为变化（记录在案的成本）**：谓词诚实之后，`object` 声明的 `allowOrgOverride: false` 会被**一致地**执行——对打包对象的 overlay 写入**每次**都以 `NOT_OVERRIDABLE` 拒绝，而不是只拒第一次（此前第一次被拒、并因销毁证据而让后续每次都从 `allowRuntimeCreate` 那一档混过去）。同一谓词也喂给 `deleteMetaItem` 的两档鉴权与仓库的 `assertAllowed`，所以重置该定制同样需要那道文档化的运维口子 `OS_METADATA_WRITABLE=object`——现在它必须在定制的**整个生命周期**内保持打开，而不只是第一次保存时。

  `ObjectContributor.ownership` 与 `ObjectOwnershipEnum` 的联合类型因此加宽（loader 设定，永不可由作者书写），这是 `objectui` / `cloud` 消费方可见的公开类型变化。

- 3028326: fix(metadata-protocol,objectql): the #4463 runtime authoring gate now runs on every kernel that has not declared itself the package author's channel (#6710)

  The 26 shared author-time rules (`AUTHORING_RULES` — the same table `os validate`
  / `os build` / `os lint` run) were gated behind
  `if (this.environmentId === undefined) return;`. That short-circuit was meant to
  be ADR-0005's "the package author's own bootstrap channel" carve-out, and the
  carve-out itself is legitimate. The key was not: `environmentId` is a ROW-SCOPING
  key, and two very different topologies leave it undefined.

  **The defect.** The CLI's lightweight host-config assembler — `serve.ts`'s
  `config.objects && !hasObjectQL` auto-register branch, which constructs
  `new ObjectQLPlugin()` with no options — also boots with no `environmentId`.
  That is the shape any `objectstack.config.ts` with instantiated plugins gets
  (`isHostConfig` → `shouldBootWithLibrary === false`), including the flagship
  showcase app. Its `PUT /api/v1/meta/*` is an **end-user** surface, so a
  self-hosted app server ran **zero** of the 26 rules on every publish. For a
  Studio tenant or an MCP/AI author this gate is not the weakest of four doors —
  it is the only one, because a `sys_metadata` overlay row is never in the CLI's
  config file and there is no `os lint` for it. Measured at boot level: the kernel
  reports `environmentId === undefined` and #4463's own broken-CEL approval flow
  (`record.owner ==`) runs straight past the gate into persistence.

  **The fix — the channel is declared, not inferred.** A new plugin option states
  what a kernel _is_, and gate activation reads that instead of row scope:

  ```ts
  new ObjectQLPlugin({ authoringChannel: "package-author" });
  createMetadataProtocolPlugin({ authoringChannel: "package-author" });
  ```

  `'environment'` (the default, and what you get by omitting the option) runs the
  rules. `'package-author'` is the ADR-0005 carve-out and belongs only on the
  genuine control-plane assembly — the kernel installing packages on the
  platform's own behalf. The option is threaded through `assembleMetadataProtocol`,
  the one seam both mounts share, so the built-in and delegated (ADR-0076 Step 2)
  mounts cannot disagree.

  **Omitting it means more enforcement, never less.** That direction is the point:
  the failure mode being designed out is a future assembly variant nobody thought
  about silently reopening this hole, which is exactly how the host-config
  topology got here. It is also why the option is a channel NAME and not a
  boolean — `skipAuthoringRules: true` would be the same bytes with the opposite
  meaning, a switch for making a red publish go away. #5086 had already retired
  the same proxy key for the code-only refusal, for the same reason.

  **What changes for you.** A kernel that serves metadata writes to end users
  should change nothing — it now enforces the rules it always should have. A
  kernel that genuinely is a control plane must add `authoringChannel:
'package-author'`; until it does it runs gated in the safe direction, and the
  existing per-write `OS_ALLOW_UNLINTED_METADATA_WRITES=1` hatch (#4463 D4)
  degrades a refusal to a loud log. `environmentId` keeps every one of its other
  jobs unchanged — the `environment_id` stamp and filter, the ADR-0005 overlay
  whitelist, the #3050 authoring gate's scope, and local metadata-storage
  provisioning. Only this one activation moved.

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

- 11066f6: feat(spec,metadata-protocol,rest,client): the direct-mount surfaces (`packages`, `datasources/:name/external/*`) become discoverable, and the SDK follows the advertised base (#6633)

  The rest surface's `/discovery` never advertised `routes.packages` — routes
  mounted but not advertised, the unstated half of ADR-0076 D12 — so the SDK's
  `packages.*` always fell back to the hard-coded `/api/v1/packages`; and the
  SDK's `datasources.external.*` had no discovery mechanism at all, hard-coding
  `/api/v1/datasources/...` in each of its five methods. On any deployment with a
  non-default API base, both families built wrong URLs (measured in #6633).
  Maintainer ruling 2026-08-08 (route B, prerequisite for #6306):

  - **spec** (minor, additive): `ApiRoutesSchema` declares a `datasources` key —
    the base of the federation-admin family. Optional like `mcp`: absent = not
    mounted.
  - **metadata-protocol** (minor, additive): `getDiscovery()` advertises
    `routes.packages: '/api/v1/packages'` iff the `package` service is
    registered (`serviceToRouteKey` gains the mapping; the route flows through a
    non-slot table because `package` is not a `CoreServiceName`). `datasources`
    is deliberately NOT advertised by this builder — the mount belongs to the
    REST host it cannot see (same disposition as `mcp`).
  - **rest** (minor): `/discovery` advertises `routes.packages` and
    `routes.datasources` as projections of the RECORDED direct mounts (#5822) —
    advertisement and mounting derive from one fact, so #6306's later mount-base
    move carries the advertisement along by construction. Not mounted ⇒ not
    advertised. An end-to-end parity pin (`discovery-advertised-direct-mounts.
parity.test.ts`) drives the composed surface and goes red on any change that
    moves only one side.
  - **client** (patch, behavior fix): the five `datasources.external.*` methods
    derive their base via `getRoute('datasources')` — connected clients follow
    the advertised base; unconnected clients (or servers that advertise no
    `datasources` key) keep building byte-identical `/api/v1/...` URLs.

  No key is removed and no wire shape changes for existing deployments: servers
  gain two advertised keys, and the SDK changes URLs only when a server
  advertises the new keys with a non-default base.

- 77022a9: feat(spec,runtime,metadata-protocol)!: one schema for both discovery producers — `capabilities` canonical, `features`/`endpoints` retired, `scoping` declared (#4828)

  `/discovery` is a machine-readable surface, but nothing compared what the two
  producers emit against what `packages/spec` declares. The only schema the
  protocol layer referenced was `GetDiscoveryResponseSchema` —
  `DiscoverySchema.partial().required({version}).extend({apiName})` — so
  `.partial()` hid every missing REQUIRED key while zod's default unknown-key
  strip hid every UNDECLARED emitted one. The two producers then drifted in
  opposite directions through the same blind spot.

  `DiscoverySchema` is now authoritative for producers, and each producer package
  carries a `discovery-schema-conformance.test.ts` that parses its LIVE shape
  against it and checks its emitted key set against the protocol schema's shape.

  **Breaking for anyone reading the dispatcher's `/.well-known/objectstack` body:**

  - `features` → **`capabilities`**, the name `DiscoverySchema` has always
    declared, in the declared `{ enabled }` shape. The same flags survive. This
    fixes a real defect: the SDK's `client.capabilities` getter reads
    `discoveryInfo.capabilities`, so against a dispatcher-served host it returned
    `undefined` for every flag while the answers sat one key away under `features`.
  - `endpoints` — **removed**. It duplicated `routes` verbatim as a
    "backward compatibility" alias; a consumer census across `objectstack`,
    `objectui` and `cloud` found no reader. Use `routes`.
  - `environment` is now **mapped** into its declared enum instead of passing
    `NODE_ENV` through raw (`test` → `development`, `staging` → `sandbox`,
    unrecognized → `development`, never `production` on a guess). `NODE_ENV=test`
    and `staging` previously advertised values outside the declared enum.

  **Additive elsewhere:**

  - `DiscoverySchema` declares `scoping` (optional) — the environment-scoping
    posture the REST endpoint has always emitted and `packages/client` has always
    consumed, now part of the contract instead of an undeclared extra.
  - The REST `/discovery` body gains the required `name` / `environment` /
    `locale`, so it can satisfy `DiscoverySchema` at all. `locale` is derived from
    the registered i18n service, the same way the dispatcher derives it.
  - `name` is canonical on both producers. `apiName` remains as a deprecated alias
    carrying the identical value and is **scheduled for removal in protocol 18**.
  - New exports: `DiscoveryEnvironmentSchema`, `DiscoveryEnvironment`,
    `resolveDiscoveryEnvironment`.

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

- edff010: fix(filter): a `where` on a virtual `formula` field is refused, not answered with zero rows (#8296)

  **BREAKING** — this is a public API contract change on the query engine, not a
  plain bug fix: a `where` on a `formula` field used to succeed (with the wrong
  answer) and now throws. Every call site that reaches `assertFilterIsMaterializable`
  — `engine.find`, `findOne`, `count`, `aggregate`, `update`, `delete` — can newly
  raise `400 INVALID_FIELD` for input it previously accepted with a `200`. Graded
  `minor`, not `major`: every publishable package sits in the Changesets `fixed`
  lockstep group during the launch window (`scripts/check-changeset-no-major.mjs`),
  so a `major` here would promote the whole ~70-package stack for one engine seam.
  See "What to change if this refuses one of your queries" below for the fix.

  `formula` is the one field type no driver materialises a column for. Three query
  axes can name a field; until now only two of them said so.

  | axis       | verdict for a `formula` field                          |
  | :--------- | :----------------------------------------------------- |
  | SORT       | `400 INVALID_SORT`, ingress (#6994) and engine (#7095) |
  | SEARCH     | `400 INVALID_FIELD`, refused by name (#6674)           |
  | **FILTER** | **accepted — 200, 0 rows, no error**                   |

  `assertFilterFieldsExist` computed exactly one verdict — is this name a field of
  the object — and a `formula` field IS one, so the predicate cleared the door and
  reached a driver with no column behind it. Measured on a real `ObjectQL`, with
  `is_open` a `formula` over the stored `status` column:

  ```
  where { is_open: true  }              ->  0 rows, no error
  where { is_open: false }              ->  0 rows, no error
  CONTROL where { status: 'open' }      ->  4 rows
  CONTROL where { subtask_total: 5 }    ->  1 row     (`summary` HAS a column)
  ```

  Both directions are wrong and the `false` one is the dangerous one: the same
  predicate against a STORED boolean returns every row, so a filter meaning "not
  yet done" silently became "no records at all" — a row SET changed under a 200,
  which no amount of inspecting the response can reveal. The formula READS
  correctly in that very same response, so the field is visibly populated and
  simultaneously unfilterable.

  Both doors now refuse it with `400 INVALID_FIELD`, naming the offending key path
  and prescribing the remedy the sort and search axes already share:

  - **ingress** — `assertFilterFieldsExist` grows a second verdict, after
    `unknown`, covering everything that reaches `findData`: the list route,
    `POST /data/:object/query`, the export route and the RPC dispatcher, in every
    filter spelling (`where` / `filter` / `filters` / `$filter`, the array sugar,
    and nested `$and` / `$or`);
  - **engine** — `assertFilterIsMaterializable` closes the half the ingress cannot
    reach. It is author-reachable, not merely internal: a saved report's
    `query.filter` is forwarded verbatim into `engine.find`, exactly as #7095
    measured for `query.orderBy`. It runs at the engine's one filter-lowering
    seam, so `find`, `findOne`, `count`, `aggregate`, `update` and `delete` all
    answer alike, and it judges the CALLER's `where` only — a middleware-injected
    RLS or sharing predicate is the platform's own and is never refused.

  Both doors judge the field by the same `@objectstack/spec/data` predicate the
  search axis uses (`isVirtualSearchField` / `SEARCH_VIRTUAL_TYPES`) rather than a
  locally minted type list, so a gate and the drivers cannot disagree about which
  types have a column.

  **`summary` and `autonumber` are unaffected and still filter** — both get real
  stored columns; the set is exactly `formula`. Reading, projecting and computing a
  formula field are untouched; only the predicate is refused.

  **What to change if this refuses one of your queries:** denormalise the value
  onto the object (a stored field, written when the source changes) and filter
  that. There is no mechanical rewrite in either direction — the platform cannot
  invent the stored column, and it must not filter post-hoc after the formulas are
  evaluated, because the driver has already applied `limit` / `offset`, so a
  post-hoc predicate would filter an arbitrary PAGE. Grep your saved reports,
  flows, dashboards and view filters for a filtered field whose object declares it
  as a `formula`.

  **In-tree sweep — source AND tests.** No shipped example app's _metadata_ filters
  a formula field: the ones the examples declare (`crm_contact.full_name`,
  `crm_opportunity.expected_revenue` / `days_to_close`, `crm_lead.is_closed`,
  `showcase_project.budget_remaining`, `showcase_field_zoo.f_formula`) appear only
  as view columns, form fields, permission entries and record-level CEL
  predicates — never in a `where` / `filter`. One in-tree TEST did filter one and
  is updated in this change: `examples/app-todo/test/derived-flag-removal.test.ts`
  registers a test-local formula-shaped object to record _why_ two inert flags were
  removed rather than derived, and pinned the behaviour this refusal abolishes —
  filtering a formula answering 0 rows with no error. It now asserts the
  `400 INVALID_FIELD` envelope instead; its conclusion is unchanged, because a
  formula still cannot be filtered. The first sweep read app source only, which is
  the wrong half: current behaviour is pinned in tests, so a behaviour change lands
  there first.

  <!-- adr-0087: not-required (no-migration-prescription) this is a runtime query-validation behavior change, not a spec/metadata key rename or removal -- no field, key or stored value moves, so there is nothing for the migration ledger or `objectstack migrate meta` to register. The guidance above (denormalise onto a stored field and filter that) is behavioral advice for API consumers, not a mechanical rewrite of stored metadata. -->

- 4c80fd6: fix(metadata-protocol): `deleteMany` / `updateMany` honour `atomic` for real, or refuse it (#4620)

  ADR-0119 D4 made `batchData`'s `atomic` flag a real guarantee. Its two siblings
  in the same file were out of that PR's confirmed scope and kept the defect:

  - **`deleteManyData` was fake-atomic.** `atomic: true` opened no transaction; it
    only `break`-ed the loop, so every row deleted before the failure stayed
    **deleted** while the response called itself atomic and reported those rows
    `success: true`. Worse than the `batchData` case it was copied from, because a
    partial delete has no natural undo — a client cannot reconstruct the rows from
    its own request.
  - **`updateManyData` ignored `atomic` entirely.** The option was accepted,
    declared in `BatchOptionsSchema` with an all-or-nothing contract, and never
    read: a caller asking for atomicity silently got best-effort, with no signal.

  Both now run the **same** atomic arm as `batchData`, extracted into one shared
  runner so a fourth copy of transaction handling cannot drift into a fourth lie:

  - `atomic: true` runs the whole batch inside ONE `engine.transaction()`; the
    first failure rolls back every prior write.
  - A rolled-back batch reports **zero successes**. Rows that had succeeded are
    marked `ROLLED_BACK: record <i> failed — <cause>`, rows never reached are
    `NOT_ATTEMPTED: atomic batch aborted by record <i>`, and the causal row keeps
    its own error — so a client can tell "attempted, undone" from "never ran".
  - `atomic` outranks `continueOnError`, whose contract text already scoped it to
    `atomic=false`.

  **Behaviour change to be aware of:** a runtime that cannot roll back (no
  `engine.transaction()`, or a default driver without `beginTransaction`) now
  **refuses** an `atomic: true` `deleteMany` / `updateMany` with `501
NOT_IMPLEMENTED` instead of silently running best-effort — the same fail-closed
  gate `batchData` uses. That silent downgrade is the defect class this fixes; if
  you want best-effort, ask for it (`atomic: false`, or omit the option), or probe
  the runtime's transaction support before sending. Non-atomic behaviour of both
  endpoints — including the `continueOnError` interaction and their response
  shapes — is unchanged.

- 5e247fd: fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

  `GET /api/v1/meta/object/:name` answered a **different set of fields** depending
  on which link of its resolution chain produced the answer, for the same object:

  - **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
    injected system columns — `created_at`, `created_by`, `updated_at`,
    `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
    when the author declared none of them;
  - **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
    body) → the stored document VERBATIM, so every one of those columns was simply
    absent.

  Whether an object carries an overlay is invisible to the caller, so the same
  request reported the platform's own columns or not, and nothing in the response
  said which had happened. `/meta` is the machine-readable contract clients and AI
  authors code against: an author reading an overlay-backed object saw no
  `created_at` / `owner_id` / `organization_id` and reasonably concluded the
  columns do not exist — while every one of them is real in the database,
  filterable, orderable, and enforced read-only on write.

  **Every `/meta` object read exit now serves the effective schema.** The
  single-item read, the list, the cached/ETag branch, both draft reads and the
  layered read's `effective` layer all report the injected columns, with the same
  `readonly` / `system` markers the engine enforces (`owner_id` stays
  `readonly: false` — ownership is transferable). This is the presence half of the
  seam #4513 closed the value half of.

  Three things deliberately did **not** change:

  - **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
    read exits only, so Studio's "what you customised" diff never shows a column
    nobody wrote. Only `effective` is injected.
  - **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
    The write path gained the strip counterpart: a field byte-identical to the
    platform's own definition is removed again on save, so a served document handed
    straight back stores exactly what it stored before — same checksum, same
    history diff. A declared `owner_id` carrying the author's own label is _not_
    the platform's definition and survives untouched.
  - **A declared system column stays the author's.** Injection only ever adds a
    column nobody declared; it never rewrites one that was.

  Which columns an object carries is `resolveInjectedSystemColumns`
  (`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
  consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
  `systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
  `ownership` table, the `sys_*` namespace) is answered in one place and re-derived
  in none. **What** each column looks like moves to `@objectstack/metadata-core`
  (`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
  `@objectstack/objectql` so the symbols still resolve there) — the same relocation,
  for the same dependency cycle, as the audit-governance table in #4513:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
  path could not import the definitions from the registry that provisions them.
  One table now feeds the injection pass and the read exits, so they cannot drift.

  One key is deliberately not carried onto a served document: `organization_id`'s
  `indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
  ADR-0049) and rejected by name by the strict schema — and its only consumer is
  `driver-mongodb`'s schema builder, which reads the registered schema and never a
  served document. It stays at the injection site; that the registry-backed read
  answers `_diagnostics: { valid: false }` because of it is filed as #6810.

- 83cf2d3: feat(migrate,metadata-protocol): `os migrate meta --stored` rewrites sys_metadata rows so the read-path chain has a finish line (#4327)

  #4317 closed the correctness gap from the read side: every stored-row
  rehydration seam replays the full ADR-0087 conversion chain, retired entries
  included, so a row written under any past protocol is _served_ canonical
  forever. What it deliberately did not do is make the rows themselves canonical.
  A pre-17 row keeps its legacy bytes, the chain re-lowers it on every load, and
  each affected row logs one conversion notice per process — deduped, but back
  every boot. Until now the only things that ever rewrote such a row were a Studio
  re-save and `duplicatePackage`.

  **`os migrate meta --stored`** is the pass that ends it for a deployment that
  runs it. It walks `sys_metadata` — `active` and `draft`, every organization —
  replays the same `applyConversionsToStoredItem` chain, and re-saves each changed
  body through the normal write path, so a rewritten row gets a
  `sys_metadata_history` entry, a fresh checksum and the mutation projectors,
  exactly like an author's save. The history row's `source` is `migrate-stored`,
  so a later diff distinguishes an upgrade from somebody's edit.

  ```bash
  os migrate meta --stored                    # preview: per-row report, writes nothing
  os migrate meta --stored --apply            # rewrite the rows (prompts)
  os migrate meta --stored --apply --yes --json   # CI / scripts
  os migrate meta --stored --type view        # restrict to a type (repeatable)
  ```

  **Preview is the default and `--apply` is the only writing mode** — the house
  rule its siblings already keep (#3617's "a dry run changes nothing"), and it
  applies with more force here because what moves is metadata: every affected
  row's checksum and a history entry per row. An apply run also refuses to start
  while another process holds the SQLite database, for the same reason
  `os migrate files-to-references --apply` does.

  **Nothing gates on this having run.** #3855's conclusion stands — an
  operator-run migration cannot be relied upon, so the read path remains the
  guarantee for every deployment, and no `sys_migration` flag is recorded (a flag
  would advertise enforcement that does not exist). What a run buys is hygiene —
  rows stop carrying pre-protocol dialects, so diffs, exports and history are
  clean going forward, and the recurring notices go quiet — plus one thing that
  was previously unobtainable: **an operator can assert it.** A run with nothing
  left to do exits `0`, a deployment with rows still on an old dialect exits `1`,
  so "my metadata is on protocol N" becomes a CI check rather than a belief.

  Three things the pass declines, and reports rather than counting as done:
  `flow` rows (their seam is `AutomationEngine.registerFlow`, which holds the
  executor registry the node-type conflict guard needs), types with no repository
  write path (`agent` — rewriting there would record no history and force a draft
  live), and rows that still fail the current schema after conversion (a genuine
  contract violation the write path is right to refuse; it keeps reading through
  the chain and stays fixable in Studio).

  Also new, and usable without the CLI: `protocol.migrateStoredMetadata()` returns
  the same structured report an admin route would render, and `saveMetaItem`
  accepts an optional `source` for the history/audit rows. `source` is not
  request-derived — the REST layer builds its save request field by field and
  never forwards a client-supplied value, so provenance stays something the server
  states rather than something a caller claims.

- ac244ad: fix(metadata-protocol): refuse an org-scoped write of a type that has no per-org channel (#6190)

  `allowOrgOverride` and `allowRuntimeCreate` are orthogonal tiers, and the
  runtime-create tier never consulted the ORG dimension:
  `SysMetadataRepository.put` stamps `organization_id` on the row whatever the
  type is. So a Studio-authored item of an `allowOrgOverride: false` type
  persisted a per-org row the platform can never read back — `loadMetaFromDb`
  loads env-wide rows only. The write path was strictly more permissive than the
  read path, and the row was lost at the next restart with no log line.

  Measured consequences, both silent before this change:

  - **`flow`** binds its triggers for the life of the process that wrote it, then
    stops firing after the next restart.
  - **`object`** is worse and fails CLOSED: absent from the registry after boot
    while its physical table still holds the data, so every record in it answers
    404 `OBJECT_NOT_FOUND`.

  `saveMetaItem` (draft and publish modes) and the draft→active promotion
  (`publishMetaItem`, `publishPackageDrafts`) now refuse such a write with 403
  `NOT_OVERRIDABLE` before anything is persisted, naming the organization, the
  flag that produced the verdict, the consequence, and the two legitimate
  alternatives (save it env-wide, or ship the per-org variant as its own
  deployment — ADR-0005: "Per-org variants are a deployment, not an overlay").

  **Which types change behaviour.** The predicate is derived from
  `DEFAULT_METADATA_TYPE_REGISTRY`, never a hand-written list: 18 of its 27
  entries declare `allowOrgOverride: false` with `allowRuntimeCreate: true` —
  `object`, `field`, `hook`, `seed`, `mapping`, `page`, `app`, `action`,
  `dataset`, `flow`, `datasource`, `external_catalog`, `doc`, `book`,
  `permission`, `position`, `tool`, `skill`. (`api` was the 19th when the ruling
  was made; #5488 has since withdrawn its runtime-create door entirely, so it is
  refused as code-only before this gate is consulted.) Unaffected: `view`,
  `dashboard`, `report`, `translation`, `email_template` (they have a per-org
  channel and their org rows are read back on demand), plus plugin types with no
  static registry entry, which keep today's behaviour. Env-wide writes of every
  type are unchanged.

  `OS_METADATA_WRITABLE` deliberately does **not** unlock the org dimension: it
  unlocks the write, not the read, so honouring it here would re-open the phantom
  in exactly the deployments most likely to have one.

  **No data migration is included.** Per the maintainer ruling, rows written
  before this gate are residue handled non-destructively — made audible by the
  cold-boot warning and disposed of operationally. They are not rewritten or
  deleted, and `migrateStoredMetadata` now reports them instead of rewriting
  them, which makes that pass a second residue detector.

- e1f2d8e: The runtime publish gate's per-write snapshot now carries the sibling collections the three cross-collection security rules compare against (#8309, slice 2 of #7891).

  `RuntimeStackContext` gains `permissions` and `books` beside `objects`, the gate's baseline/candidate differential carries all three in both passes (with replace-not-erase semantics for a write into any of them), and `TYPE_TO_STACK_KEY` maps `permission` → `permissions` and `book` → `books` ahead of their `runtimeTypes` registration (#8310). The snapshot construction is exported as `buildRuntimeWriteSnapshots` so tests exercise the real thing instead of a mirror. `@objectstack/metadata-protocol`'s gate call site gathers the two collections from the live registry per publish, the same way it always gathered `objects`.

  This repairs the measured defect behind `RUNTIME_NEEDS_FULL_SNAPSHOT`: a per-write snapshot holding exactly one permission set invented 38 phantom `security-master-detail-ungranted` findings where the whole-stack run produces 4 (PR #7886). Per-write and whole-stack verdicts for `security-master-detail-ungranted`, `security-private-no-readscope` and `security-book-audience-unknown-set` now agree. No verdict changes at the door until #8310 declares `permission`/`book` in `runtimeTypes` — the sibling collections cancel in the differential for every currently-gated type.

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

- 4b945fc: Author-time rules now gate the RUNTIME metadata write path, not just the CLI (#4463)

  The 26 author-time rules `os validate` / `os build` / `os lint` share (#4409) ran on
  those three commands and nowhere else. Every runtime metadata write — Studio's
  designer, REST `/meta` item CRUD, an MCP/AI agent authoring a flow — reaches
  `saveMetaItem`, which did a per-type Zod `safeParse` and stopped. For a tenant that
  was not the weakest of four doors, it was the **only** door: a `sys_metadata`
  overlay row is not in the CLI's config file, so there was no command they could run
  instead. An approval flow whose `expression` approver is broken CEL
  (`record.owner ==`) is Zod-valid, so it saved, registered, and failed at the node's
  entry the first time it fired — the exact body `os lint` had rejected since #4409.

  **One shared core, one runtime gate.**

  - The rule registry moved from `packages/cli` into `@objectstack/lint`
    (`AUTHORING_RULES`), and the CLI now calls it there. Five rule modules moved with
    it (`lintFlowPatterns`, `lintLivenessProperties`, `lintAutonumberFormats`,
    `lintViewRefs`, `data-model-rules`), unchanged. There is one table; a second one
    cannot be introduced without failing `authoring-rule-wiring.test.ts`.
  - New kernel-safe subpath export **`@objectstack/lint/runtime`** — the entry the
    metadata write path imports. Running the gate loads neither `typescript` nor
    `sucrase`, pinned by a new `runtime-lazy-deps.test.ts` alongside the existing
    `lazy-deps.test.ts`, which is unchanged.
  - Each registry entry now declares `surfaces` (`cli` / `runtime-publish`) plus
    either the metadata `runtimeTypes` it judges or a written `surfaceReason`. The
    ratchet fails an entry that answers neither.

  **Behaviour**

  - A `state: 'active'` `saveMetaItem` — and the draft→active promotion in
    `publishMetaItem` — of a **flow** runs the flow / approval / expression /
    reference rule families. A gating finding is refused with **422
    `INVALID_METADATA`**, in the same structured envelope the Zod failure already
    used, with `rule` / `path` / `where` / `message` / `hint` per issue.
  - **Draft saves are never gated** — a draft is allowed to be half-finished and
    cannot execute.
  - Only the write is judged: the rules run twice (context with and without the
    submitted item) and only findings the item _added_ can refuse it, so a
    pre-existing violation in a stored row never blocks an unrelated save. Stored
    rows keep being read.
  - Escape hatch **`OS_ALLOW_UNLINTED_METADATA_WRITES=1`** turns the refusal into a
    loud log for a migration window. Unset it once the metadata is fixed — the
    runtime executes what it published.

  Only `flow` writes are gated in this pass; every other metadata type carries a
  recorded reason in the registry.

- 89d7b35: feat(spec,metadata-protocol): the runtime authoring gate's advisory findings reach the save response (#4717)

  #4463 put the shared author-time rule registry on the runtime write path — the
  fourth door, and for a Studio tenant or an MCP/AI author the ONLY one, because a
  `sys_metadata` overlay row is not in the CLI's config file and there is no
  `os lint` to run against it. It gated on `error` findings only. The rest — the
  advisory half — were produced, walked into a `console.warn` deduped once per
  process per `type|name|rule|path`, and then went out of scope. #4715 named that
  honestly when it shipped: running a rule and discarding its conclusion is a
  smaller version of the hole the gate was built to close.

  That case is reachable today, not theoretical. A flow whose only defect is a
  `delete_record` node declaring `multi: true` with no `filter` yields
  `errors = 0 / advisories = 1`: the write **succeeds**, the row persists, the
  flow registers, and the author never learns that their nightly sweep deletes
  every row of the object on every run.

  **What changed**

  - `SaveMetaItemResponseSchema` declares an OPTIONAL `advisories` array, whose
    element is the newly-declared `RuntimeAuthoringIssueSchema` — the SAME
    `rule` / `path` / `where` / `message` / `hint` / `severity` shape the 422
    `invalid_metadata` envelope already carries (#4463 D3, "reuse the Zod
    envelope"). It is declared once: `@objectstack/metadata-protocol` re-exports
    it as its `RuntimeAuthoringIssue` instead of keeping a second hand-written
    interface for the same six keys, so the refusal and the success channel
    cannot drift into two dialects.
  - `evaluateRuntimeAuthoringGate` returns a `RuntimeAuthoringVerdict`
    (`{ error, advisories }`) instead of `Error | null`. This is an ADDED return
    channel, not a threaded value: the success path previously returned `null` and
    had nowhere to put a verdict at all.
  - `saveMetaItem` attaches the advisories to its success response.

  **Additive and conditional.** The key is emitted ONLY when at least one advisory
  was raised — never as `[]` — so a clean save's response bytes are byte-for-byte
  what they were before, and a caller that ignores the field behaves exactly as
  today. Absence means "nothing to report", never "the gate did not run".

  **`rulesRun` is deliberately NOT on the response.** The gate appends its own
  `PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING` when the type is `flow`, so not
  every id it would list resolves in the lint registry; exposing the array would
  need the declaration to say the ids are _gate_ ids. A field can be added later,
  not removed.

  **⚠️ Save door only — the asymmetry is deliberate, not an oversight.** The gate
  runs on BOTH write doors: `saveMetaItem` and the draft→active promotion, on
  purpose, so `?mode=draft` followed by publish is not a bypass (#4463 D1).
  Studio's designer uses draft-then-publish on every edit, so the publish door is
  the dominant Studio flow and it does **not** carry this field yet. That door's
  own response contract only just landed (#7294); carrying the advisories over is
  tracked separately rather than bundled here, so this change stays one optional
  field on one already-declared envelope.

  Rendering the findings in Studio is the objectui half of #4717 and is queued in
  that repo behind this change.

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

- 9f7a7c2: fix(metadata-protocol): refuse a sort naming a `formula` field instead of dropping it silently (#6994)

  The list path's SORT gate (`assertSortFieldsExist`) refuses a sort naming a field
  the object does not have (#4226) and a dotted path that would have to cross into
  a related record (#4256). It did **not** refuse a name that is a real,
  non-dotted field of the object whose **type** materialises no column — a
  `formula` field is in the object's field map, so it passed the unknown check,
  and it carries no dot, so it passed the dotted check.

  It then reached a driver that has no column for it. Re-measured on a real
  `SqlDriver` (better-sqlite3, on-disk) driving a real `ObjectQL` engine with this
  protocol on top, over five rows inserted `C A E B D` and a formula field
  `sort_key` whose expression is `record.title`:

  ```
  CONTROL   orderBy title asc     -> ["A","B","C","D","E"]   a real column really sorts
  BASELINE  no sort               -> ["C","A","E","B","D"]   insertion order

  FORMULA   orderBy sort_key asc  -> ["C","A","E","B","D"]   5 rows, 200
              its sort_key values -> ["C","A","E","B","D"]
  FORMULA   orderBy sort_key desc -> ["C","A","E","B","D"]   byte-identical to asc

  RAW SQL   order by sort_key     -> sqlite: no such column: sort_key
  ```

  `asc` and `desc` coming back identical is what makes this a dropped sort rather
  than a coincidence: `SqlDriver.createColumn` returns early for `formula` (it is
  virtual — computed on read, after `driver.find` has already returned), sqlite
  answers `no such column`, and the #3821 unknown-column backstop retries the
  query **without** the `ORDER BY`. The response even carries the values it was
  asked to order by, out of order, under a 200 — so it contradicts the request in
  plain view and still reports success. `sort` + `top` is how a caller asks for
  "the latest N", which this turned into an arbitrary N.

  **Now:** `400 INVALID_SORT`, naming the field and its type, and prescribing the
  same remedy in the same words as the dotted refusal (#6924) and the SEARCH axis
  (#6673) — denormalise onto a **stored field, written when the source changes**.
  Precedence on this axis is `unknown` > `dotted` > unmaterializable, so both
  older verdicts answer exactly what they answered before.

  **`summary` / `rollup` is not affected** and deliberately not in the refused
  set: a summary field gets a real, maintained `float` column and genuinely sorts.
  The spec's `COMPUTED_VALUE_TYPES` (`formula`/`summary`/`autonumber`) is the
  WRITE contract and is the wrong set to gate a sort with — it would refuse two
  types that work.

  **Scope.** This is an ingress gate, so it covers what reaches `findData`: the
  REST list route, `POST /data/:object/query`, the export route, and the RPC
  dispatcher. An internal caller that reaches `engine.find()` directly (hooks,
  flows, reports) still gets the silent drop — closing that half means deciding
  whether the engine refuses or keeps its documented internal-caller tolerance,
  which is a separate contract decision and is tracked separately.

  If you were sorting a list by a formula field, that sort was never applied; the
  call now fails loudly instead of returning rows in an arbitrary order.

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

- 304423e: feat(automation,migrate): `os migrate meta --stored` now covers flow rows too (#4454)

  #4327 gave the stored-metadata conversion chain a finish line for every
  metadata type except `flow` — the one type where the most stored dialect
  actually lives, since the graduated conversions `flow-node-crud-filter-alias`,
  `flow-node-crud-object-alias`, `flow-node-notify-config-aliases` and
  `flow-node-script-config-aliases` are all flow-node entries. Flow-node
  conversions carry ADR-0078's open-namespace conflict guard, which has to consult
  the _live_ executor registry to tell a rename from a clobber, and the metadata
  layer has no way to obtain one. Flows were reported `skipped` with that reason.
  They are now converted.

  **One canonicalization policy, two shapes.**
  `AutomationEngine.canonicalizeStoredFlow` is the single implementation and
  `registerFlow` calls it, so the load seam and the migration can never disagree
  about what "canonical" means. It returns `parsed` (for execution — the
  `FlowSchema.parse` + #4347 region output, schema defaults materialized) and
  `storable` (for persistence).

  **`storable` excludes schema defaults, and that is the load-bearing decision.**
  Measured rather than assumed: driving a pre-17 flow through all three steps
  _removes_ nothing — `FlowSchema` is strict since #4001, so an unrecognized key
  throws instead of being silently dropped, which means the
  `graftNormalizedOperators` precedent (it exists because the _view_ parse strips
  Studio-only auxiliary keys) does not transfer — and _adds_ only defaults:
  `version`, `runAs`, per-edge `type` / `isDefault`. Persisting a default the
  author never wrote would pin every migrated row to today's value while untouched
  rows follow tomorrow's: two populations with different behaviour, which is
  exactly the drift this pass exists to remove. So the write-back is the
  conversion result plus the `{dialect, source}` envelopes the schema derives for
  edge conditions, and nothing else.

  One subtlety worth knowing if you extend this: that envelope is a schema
  transform, not a conversion, so it emits **no** notice while still changing the
  body. Reading notices alone — correct for every other metadata type — would call
  such a row canonical and leave it re-deriving on every boot. Both passes are
  copy-on-write, so identity is the exact test for flows.

  **New: `AutomationServicePluginOptions.armRuntime`** (default `true`, so every
  server, dev stack and test host is unaffected). Set `false` and the plugin
  brings up the engine and the complete node registry — built-ins plus whatever
  `automation:ready` contributes, because a _partial_ registry would make the
  conflict guard read a live custom node type as unowned and rewrite over it — and
  then stops before anything is armed:

  | Skipped when `armRuntime: false`                         | Why it must be                                                                                |
  | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
  | flow pull + `kernel:ready` / `metadata:reloaded` re-sync | `registerFlow` calls `activateFlowTrigger` — record triggers and scheduled jobs would go live |
  | declarative connector materialization                    | opens real connections; an MCP provider spawns a child process                                |
  | suspended-run wait-timer re-arm                          | would resume someone's paused approval mid-migration                                          |

  `os migrate meta --stored` boots the plugin in that mode. A migration process
  must not become a second server.

  A refused rename — the guard firing because the old node-type token is a live
  name something else owns in this environment — fails that row loudly, naming the
  token and its owner. Never a silent skip, never a clobber. A flow that cannot
  canonicalize at all (a strict-schema violation, a malformed control-flow region)
  is reported as failed with the parse message rather than persisted as a guess;
  such a row cannot register today either, so the report is telling you about a
  flow that is already broken at runtime.

- aac90a5: feat(spec,runtime,metadata-protocol,client)!: one closed capability vocabulary — every discovery producer emits every key (#5672)

  `#4828` renamed the runtime dispatcher's top-level `features` map to the
  canonical `capabilities`, which collapsed the _spelling_ split between the two
  discovery producers. It did not touch the deeper one: the two went on filling
  **disjoint key sets**.

  | producer                                                                             | keys it filled                                                                        |
  | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
  | `getDiscovery()` — `@objectstack/metadata-protocol`, upstream of REST `/discovery`   | `comments` `automation` `cron` `search` `export` `chunkedUpload` `transactionalBatch` |
  | `getDiscoveryInfo()` — `@objectstack/runtime` dispatcher, `/.well-known/objectstack` | `search` `websockets` `files` `analytics` `ai` `notifications` `i18n`                 |

  Only `search` overlapped. `DiscoverySchema.capabilities` was an open
  `z.record`, so both shapes parsed clean and no gate could see the split — while
  `packages/client`'s `capabilities` getter **asserted** the result was a
  `WellKnownCapabilities`. Against a dispatcher-served host
  `client.capabilities.transactionalBatch` was therefore statically `boolean` and
  actually `undefined`, as were `comments`, `cron`, `export` and `chunkedUpload`.

  Per the maintainer's 2026-08-06 ruling, the vocabulary is now closed and
  mandatory.

  **What a consumer sees.** Before: which capability flags exist depended on
  which kind of host answered, and a flag you were typed to receive could simply
  be missing. After: every discovery response carries **every** flag, always a
  boolean. A capability the host does not deliver is `enabled: false` — never an
  absent key — so a client can read a flag without knowing whether it reached a
  dispatcher, the REST endpoint, or anything else. `client.capabilities` no longer
  asserts its own return type: it enumerates the spec's key list, so the type is
  true by construction, and it reads a key an older server omits as `false`
  (fail-closed, matching the wire rule).

  **`@objectstack/spec`.** `WellKnownCapabilitiesSchema` becomes the one
  vocabulary and gains the six flags that were previously the dispatcher's alone
  (`websockets`, `files`, `analytics`, `ai`, `notifications`, `i18n`) — all six
  were already real answers on the wire, so this declares them rather than
  inventing them. `DiscoverySchema.capabilities` changes from an optional open
  record to a **required closed object** derived from that vocabulary, one entry
  per key. New exports: `WELL_KNOWN_CAPABILITY_KEYS` (the key list, derived from
  the schema so nothing can hand-list a fourth dialect) and
  `CapabilityDescriptorSchema` / `CapabilityDescriptor` (the `enabled` +
  optional `features` / `description` entry shape, previously inline).

  Required, not optional, is the `scoping` precedent read the other way round:
  `scoping` is optional because only one producer can honestly answer it, whereas
  every producer can answer `capabilities` — and an optional block would leave a
  consumer back at `undefined` for every flag.

  **Producers.** Each answers all thirteen keys from its own facts, with the basis
  recorded per key in the code. The dispatcher now measures `comments` off the
  `sys_comment` object in the registry it already resolves for its `/data` domain,
  and `automation` / `cron` / `export` / `chunkedUpload` off the same service
  predicates that gate its route advertisements. Its one honest `false` is
  `transactionalBatch`: the atomic cross-object `/batch` route is mounted by
  `@objectstack/rest`, and this dispatcher has no batch branch at all, so claiming
  the runtime's `transaction()` here would advertise an endpoint the host does not
  serve. `getDiscovery()` answers the six new flags off the service registry it
  already reads, gated on serveability so a self-declared stub does not advertise
  a capability it cannot back.

  **Gates.** The three `discovery-schema-conformance.test.ts` suites built by
  `#5682` and extended to `routes` by `#5743` gain a fullness criterion — every
  vocabulary key present, every `enabled` a real boolean, no key outside the
  vocabulary — with the allowance derived from the schema rather than written out.

  **Upgrading.** A producer or fixture that builds a `DiscoverySchema`-shaped
  document must now include a complete `capabilities` block; build it from
  `WELL_KNOWN_CAPABILITY_KEYS` rather than by hand. Consumers need no change:
  they receive strictly more keys than before, and any flag they already read
  keeps its meaning. The lenient wire wrapper `GetDiscoveryResponseSchema` still
  allows the block to be absent, so a response from an older server still parses.

- 3da3da5: feat(metadata-protocol)!: cross-tenant uninstall must be declared — `deletePackage` refuses a call that names neither an organization nor `allTenants` (#7780)

  **This changes the contract of a destructive operation, and a caller that omits
  the organization today starts getting a 400. That is the point of the change,
  not a side effect of it.**

  `protocol.deletePackage` selected its rows with `{ package_id }` and added an
  organization predicate only when the caller supplied one. With no
  `organizationId` the predicate matched **every organization's rows** — measured
  during #7705 at 5 of 5 deleted, including a foreign organization's.

  Nobody chose that. It fell out of a missing argument, and the two doors of
  `DELETE /api/v1/packages/:id` disagreed about which semantic they were invoking:

  - the direct-mount REST registrar (`packages/rest/src/package-routes.ts`) passes
    no organization and got the cross-tenant reading;
  - the dispatcher twin (`packages/runtime/src/domains/packages.ts`) resolves one
    and got the org-scoped reading.

  Worse, the two are indistinguishable at the call site. `resolveActiveOrganizationId`
  (#4127) is entirely `catch`-wrapped, so any throw on the auth seam returns
  `undefined` — an accidental org-less call and a deliberate environment-wide one
  are byte-identical, and the accident silently selected the widest possible
  reading of a destructive operation.

  Maintainer ruling (2026-08-12), quoted unchanged:

  > 跨租户卸载必须显式声明,缺省缺参永远不等于「全部租户」.

  **What changes**

  - `deletePackage` gains `allTenants?: boolean`, the explicit carrier for
    cross-tenant semantics.
  - A call with neither `organizationId` nor `allTenants: true` is refused with
    `TENANT_SCOPE_REQUIRED` (HTTP 400) and deletes nothing. An explicit
    `allTenants: false` is treated as undeclared: it is not an affirmative request
    for cross-tenant semantics, so it cannot authorise them.
  - A call supplying **both** `organizationId` and `allTenants: true` is refused
    with the same code and status. The two are contradictory, not redundant — one
    scopes to a tenant, the other clears every tenant — and both silent
    resolutions are worse than a refusal: resolving narrow-first makes
    `allTenants: true` silently inert, and resolving explicit-first ignores a named
    organization and deletes every tenant's rows, which is the original defect
    wearing a flag. Rejecting is also the only reading that stays correct when a
    request is composed from two places (a resolver supplying the org, config
    supplying the flag). The message names both offending parameters.
  - The REST direct-mount door now declares `allTenants: true`. It has no
    organization to resolve (`packages/rest` carries no org plumbing at all), so of
    the two remedies the ruling allows, only declaring the intent is available
    there. Its observable behaviour is unchanged; what changed is that the width is
    now stated at the call site instead of inferred from an absent argument.

  **What deliberately does NOT change**

  The no-organization branch is still **not** narrowed to `organization_id IS
NULL`. #7705 proved that narrowing orphans every org-scoped row — the same
  defect pointed the other way. The remedy here is explicitness, not narrowing.

  **Callers that must be updated**

  Any caller of `deletePackage` that omits `organizationId` and intends an
  environment-wide uninstall must now pass `allTenants: true`. The refusal message
  names both remedies.

  Registered on the ADR-0087 migration chain (step 17,
  `package-uninstall-explicit-all-tenants`) rather than exempted: a consumer really
  does have to act — an uninstall that succeeded yesterday now answers 400 until it
  states its tenant scope — and which scope it meant is an intent no transform can
  recover, which is the same disposition `rest-requireauth-default-flip` took for
  its own default flip.

  <!-- adr-0087: registered package-uninstall-explicit-all-tenants -->

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

- 1818998: feat(spec,objectql,metadata-protocol): validate-only data operation — ask for the write's verdict instead of predicting it (#6037, #4633 ruling D)

  `import`'s dry run predicted the write path's verdict with a hand-copied mirror
  of the engine's rules (`rest/src/import-coerce.ts`). A copy cannot structurally
  keep up with the family it mirrors — ADR-0104 value shapes, `format` checks,
  object-level `validations`, the state machine — so ruling D replaces prediction
  with the verdict itself.

  **New:** `DataProtocol.validateData(request)` returns the write path's verdict
  for candidate rows and persists nothing.

  ```ts
  const verdict = await protocol.validateData({
    object: "lead",
    mode: "insert", // or 'update', which judges only supplied keys
    data: [{ first_name: "John", email: "not-an-email" }],
  });
  // → { valid: false,
  //     results: [{ valid: false, errors: [{ field: 'email', code: 'invalid_email', … }], warnings: [] }],
  //     posture: { valueShapeStrict: true, mediaValueShapeStrict: false } }
  ```

  **Declaration and execution land together, deliberately.** `engine.validate()`
  (objectql) calls the same `validateRecord` / `evaluateValidationRules` that
  `insert()` calls, and `metadata-protocol` implements `validateData` on top of
  it. Agreement between preview and write is therefore guaranteed by
  construction, and a test asserts it directly by running both against one engine
  in both postures. This is the ruling's own clause, not a style choice:
  `BatchOptions.validateOnly` was retired in #4052 as a flag that promised a dry
  run while the batch surfaces persisted regardless, so a caller previewing a
  mutation had it EXECUTED. The new operation avoids that spelling too — the
  tombstone still stands and still rejects `validateOnly`.

  **The verdict is the target deployment's, not an absolute.** The response
  carries the ADR-0104 `posture` it was reached under. On a self-certified
  deployment a bad value shape is an error; on a warn-first one the same row is
  valid and the finding appears in `warnings` with the same `code` — one finding
  that changed buckets, not two vocabularies. An unconditionally-strict preview
  was considered and rejected (#4633 option B): it would fail rows on every
  un-migrated deployment that the write would have accepted, which teaches
  authors to distrust the one gate in front of a bulk import.

  Two boundaries worth knowing, both deliberate and both documented at the
  implementation:

  - **No hooks run.** `beforeInsert` fires before validation on the real path, so
    a hook deriving a _business_ field could change a verdict this does not
    simulate. Firing arbitrary user hooks in a preview — mail, outbound calls,
    writes to other objects — is the #4052 defect in a new spelling, so the gap is
    documented rather than closed. Audit/ownership stamps are `system`/`readonly`
    and validation skips them regardless.
  - **Warn-first admissions are not recorded as certification evidence.** The
    `#4769` sink exists so a boot cannot certify a contract it has just written
    against; a preview writes nothing, so recording there would let a _preview_
    block a later migration.

  Additive: `validateData` is optional on `DataProtocol`, and nothing existing
  changes shape. `valueShapeStrictEffective` / `mediaStrictEffective` are now
  exported from objectql's record validator so the response reports the posture
  that actually decided the verdict rather than the raw deployment flag.

  Unblocks #4633's consumption half (rest/import adopting the operation and
  retiring the `import-coerce.ts` mirror).

- ce92674: feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

  A validation rule authored as its own artifact bound to nothing and gated no
  write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
  no `objectName` — and all six variants are `strictObject`, so an author could
  not supply one either. No merge step existed. The only code that expected such a
  key was a reference-tracker row scanning a field the schema would have stripped.
  Meanwhile the engine evaluates exactly one shape: the object's own
  `validations[]` array, on insert and on every matched update row.

  So a rule created through the standalone door — a `*.validation.ts` file, or
  Studio's Validations list — parsed, saved, reported success, and intercepted
  nothing. Including a `state_machine` rule, which ADR-0020 routes through this
  same vocabulary: an author could believe they had locked down record state
  transitions and have changed nothing at all.

  Under ADR-0088 the kind fails the admission test on its first clause: a rule has
  no independent lifecycle, because it only means something against an object. And
  unlike the sibling disconnects closed in this batch, it could not be bridged into
  one — the shape has nowhere to name its object.

  **The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
  variants are unchanged and fully live; the engine's evaluation path is not
  modified by this change. It is the _kind_ that was inert, not the schema. The
  liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
  override (alongside `webhook` and `query`), because an ungoverned live schema is
  exactly how the next drift would hide.

  **Migration.** Move the rule into the owning object's `validations:` array — the
  rule body is identical, same schema, same six variants:

  ```ts
  // before — a standalone *.validation.ts, which never ran
  export default defineValidation({ name: 'amount_positive', type: 'script', … })

  // after — on the object, where rules are evaluated
  ObjectSchema.create({
    name: 'invoice',
    validations: [{ name: 'amount_positive', type: 'script', … }],
  })
  ```

  Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
  patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
  member, the schema-map entry, the create seed, Studio's Validations nav item and
  its hand-crafted form, and the dangling reference-tracker row. Standalone rows
  already in `sys_metadata` are left alone — they were never evaluated, so nothing
  changes behaviorally.

- dadb43f: refactor(spec,client,metadata-protocol,runtime)!: retire the workflow service slot — declared end to end, implemented nowhere (#4451)

  The `workflow` slot was ADR-0078's silently-inert declaration at every layer at
  once: a `CoreServiceName` nothing ever registered or resolved (ADR-0115
  Evidence 5 — "no code in this repository resolves either slot", verified across
  both repositories), an `IWorkflowService` contract with zero implementations, a
  `WorkflowProtocol` whose three methods no code ever provided, a discovery
  `routes.workflow` field no builder could truthfully populate, and a
  `/api/v1/workflow` advertisement for a path no host ever mounted (the
  pre-#3586 `DEFAULT_DISPATCHER_ROUTES` already listed it among routes that
  never existed). The capability it promised is live elsewhere and has been for
  majors: record state machines are enforced by the `state_machine` validation
  rule, approvals are first-class flow nodes on the approvals runtime
  (ADR-0019), and record-triggered automation is lifecycle hooks +
  `record_change` flows (`service-automation`).

  FROM → TO:

  - `CoreServiceName 'workflow'` / `ServiceRequirementDef.workflow` /
    `CORE_SERVICE_PROVIDER['workflow']` → removed; there is no slot to fill.
  - `IWorkflowService` (`@objectstack/spec/contracts`) → removed; no
    implementation ever existed. Register nothing — use the mechanisms above.
  - `WorkflowProtocol` + `GetWorkflowConfigRequest/Response`,
    `WorkflowState`, `GetWorkflowStateRequest/Response`,
    `WorkflowTransitionRequest/Response` (`@objectstack/spec/api`) → removed,
    along with the seven published JSON schemas. Delete the import; nothing
    ever answered these shapes.
  - Discovery `routes.workflow` / `services.workflow` / `features.workflow`
    (metadata-protocol + runtime builders) → absent. A reader keying on them
    only ever saw `unavailable` / `false`; delete the read.
  - `RouterConfig.mounts.workflow` → removed; there was never a surface to
    mount at it.
  - `RestApiRouteCategory 'workflow'` → removed; categorize automation-adjacent
    routes as `'automation'`.
  - `@objectstack/client` re-exports of the four workflow types → removed with
    their source. (The `client.workflow.*` methods were already removed earlier
    in the v17 cycle — this retires the types they returned.)
  - Also removed: the stray `graphql` entry in `CORE_SERVICE_PROVIDER` and the
    `graphql: { route: '/graphql' }` discovery entry — `graphql` was never a
    `CoreServiceName`, and the dispatcher had already dropped `/graphql` as out
    of the product plan (#2462 follow-on).

  The retirement kit: the `workflow-service-slot-retired` semantic migration
  (major 17) carries this prescription into `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool. These are TS/API surfaces and a
  discovery response field — never stored in stack metadata — so there is no
  load-path conversion and nothing for `os migrate meta` to rewrite; the
  21 `authorable-surface.json` baseline lines and 7 `json-schema.manifest.json`
  entries for the deleted schemas are dropped deliberately in the same change
  (the plugin-runtime precedent: a prescription nobody can receive is noise —
  nothing parses these shapes any more).

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

- b3efeb7: feat(spec): `Field.autonumber` declares the field `readonly: true` (#5628)

  `FieldSchema.readonly` is a **two-part** contract: "never editable in forms"
  AND server-enforced on both write paths. #5503 closed the server half for
  `autonumber` **by type** — a caller-supplied record number is stripped before
  any driver sees it, flag or no flag. The form half is keyed on the **flag**, and
  `Field.autonumber` never set it. So an authoring/rendering layer that decides
  editability from `field.readonly` drew an editable "record number" input whose
  value the server was already guaranteed to discard: the user types one, the
  create succeeds, and the record comes back carrying the number the sequence
  issued instead. Data was never at risk (that half has been enforced since
  #5503/#5627); what was wrong is what the form told the user.

  `Field.autonumber(...)` now emits `readonly: true`. The injection is applied
  **after** the author's config, so it cannot be spread away, and the authoring
  type rejects the one config that contradicts it — `Field.autonumber({ readonly:
false })` is a **compile error** rather than a silently coerced value, because
  an "editable record number" is not a state the runtime can deliver. Restating
  `readonly: true` stays legal. A hand-written `{ type: 'autonumber' }` literal
  (YAML/JSON metadata, or a plain object in TS) is unchanged and unaffected: it is
  covered by the by-type server enforcement, which never depended on the flag.

  Two consequences worth knowing:

  - **A flow that writes an autonumber field is now caught at `os validate`.**
    `flow-update-readonly-field` reads the static flag, so an `update_record` node
    writing a builder-authored record number — already a silent no-op at run time
    — is now reported at design time instead of in server WARN logs.
  - **The historical-import exemption is unchanged**, and stays that way by
    construction. The DataProtocol create ingress (`stripReadonlyForInsert`,
    #3043) knows only the `isSystem` exemption, while the engine's runtime-owned
    strip also honours `preserveAudit` (#3493 — a migration reinstating legacy
    record numbers). Now that the field carries the flag, the ingress would have
    deleted that value _before_ the engine could keep it, so the ingress skips
    runtime-owned field types outright and leaves them to the engine strip, which
    runs on every insert path (including the direct `engine.insert` callers the
    ingress never sees). Author-declared `readonly` on every other field type is
    stripped at the ingress exactly as wide as before.

  The set backing "which types the runtime owns" is now declared once in the
  protocol — `RUNTIME_OWNED_FIELD_TYPES`, exported from `@objectstack/spec/data`
  — and read by both consumers (objectql's write-path strips, the DataProtocol
  ingress) instead of each carrying its own literal.

- c497d26: fix(objectql): `autonumber` 是运行时拥有的字段,写路径不再接受调用者提交的单号 (#5503)

  `autonumber` 的值一直被文档声明为运行时所有 —— `applyAutonumbers` 的注释写着
  "the runtime owns the value, not the client",两个记录校验器也正是因此在 insert
  与 update 上都豁免了 `required` 检查。缺的是另一半:**没有任何一层写路径阻止客户端
  自己填这个值**。于是一个普通的 REST 调用者可以:

  - `POST /data/:object` 携带显式单号 → 原样落库,序列被绕过;
  - `PATCH /data/:object/:id` 携带该字段 → 200 且改写落库,业务单号被篡改。

  这与已修复的 #4447(`created_at` 可被普通 PATCH 伪造)是同一缺陷族。区别在于:
  声明了 `readonly: true` 的字段早已被 #2948 / #3043 的剥离机制保护,而 `autonumber`
  字段身上根本没有这个标记,剥离循环从它旁边直接走过去了。

  **修法:在引擎/校验层把 `type: 'autonumber'` 视为隐含 readonly,insert 与 update
  同权。** 非 system 上下文提交的单号,在派发给任何驱动之前就被剥离:

  - **UPDATE** —— `stripReadonlyFields`(`packages/objectql`)的判定从"作者声明的
    `readonly: true`"扩展为"作者声明的 **或** 运行时拥有的字段类型"
    (`isRuntimeOwnedField`,当前恰好只有 `autonumber`)。单行更新与 `multi` 批量更新
    共用这一个剥离点,因此两条路径同时被覆盖。
  - **INSERT** —— 引擎新增一个更窄的 `stripRuntimeOwnedFields`,只剥离运行时拥有的
    字段。它**不**接管作者声明的 `readonly` 在 insert 上的语义:那条防线按 #3413 的
    设计留在 DataProtocol 入口(#3043),因为 create 确实可能合法地写入只读列,而直接
    调用 `engine.insert` 的可信内部写入者(身份预置、元数据仓库、事件游标)必须不受影响。
    单号没有这种两可性 —— 谁都不该在 create 时自带单号。

  剥离发生在引擎里、派发之前,这正是修复**与驱动无关**的原因:声明
  `supports.autonumber === true` 的 SQL 驱动(持久序列)拿到的行里根本没有这个键,
  所以它的序列必然胜出 —— 没有任何驱动需要改动一行代码。测试直接断言递交给
  `driver.create` 的负载,而不是打补丁到驱动上。

  **豁免语义保持不变**,与 update 侧原有的白名单完全一致:

  - `isSystem` 写入(seed 回放、迁移、内部预置)整体跳过剥离;
  - `preserveAudit`(#3493)的"历史数据导入"仍可写入原始单号 —— 把遗留系统的历史
    单号迁移进来正是这个白名单存在的业务场景,而 `autonumber` 属于作者声明的业务字段
    (`system !== true`),恰好落在 `isPreservableUnderAudit` 允许的范围内;
  - `beforeInsert` / `beforeUpdate` 钩子计算出的值不受影响 —— 只有**调用者提交**的键
    才是剥离候选。

  **这是一次静默剥离,所以它被上报而不是被吞掉。** 引擎 insert 路径上的
  `onFieldsDropped`(#3407)此前只是为了与 `update()` 对称而存在、从不触发,并留了一
  句"若 insert 将来出现静默剥离,必须在剥离点接上监听器"——现在正是那个剥离点。
  事件沿用既有的 `readonly` 原因码(对调用者而言,隐含只读与声明只读被丢弃的理由完全
  相同,不值得为一个没有消费者会区分的差别在 `packages/spec` 里分叉词表)。
  `createManyData` 与 `insertManyData` 也补上了监听器转发:后者保持**逐行精度**——
  引擎事件是整批的并集,但剥离只会移除**行自身提交过**的键,因此可以准确归属回具体行。
  导入器优先走的正是 `insertManyData` 这条部分成功路径。

  **与 `strictReadonlyWrites`(#5126 / #5610)叠加。** 该开关是"剥离即拒绝"的进程内出路,
  本次改动使它自然覆盖单号,两条路径同权:

  - **UPDATE 无需新代码** —— autonumber 限肢走的正是 `stripReadonlyFields` →
    `reportDroppedFields` → `assertNoStrictDrops` 这条 #5126 已经铺好的接缝,因此 strict
    开启时,调用者提交的单号与声明 `readonly` 的字段一样被拒绝,整笔写入不落库;
  - **INSERT 需要接上** —— #5126 当时把该开关在 insert 上留作惰性,并写下条件:"insert
    一旦有了剥离,两个成员就在那个剥离点一起接上"。本次正是那个剥离点,于是
    `onFieldsDropped` 与 `strictReadonlyWrites` 一并兑现:默认剥离+上报,strict 开启则在
    任何驱动调用之前抛 `ERR_READONLY_FIELD_REJECTED`,且**监听器不触发**(被拒绝的写入
    并未完成,这是 #5126 自己的设计要点)。

  接缝处**没有新增任何策略**:#5126 明确写着 strict "不引入第二套策略,它只是把既有策略
  报出来",且"剥离拿不走的字段也不会被拒绝"。照此逐字适用,`isSystem` 与 `preserveAudit`
  两个豁免在 strict 下依旧被接受(它们根本不会走到剥离分支)。

  `ReadonlyFieldRejectedError` 新增可选的 `operation`(默认 `'update'`,#5126 的 UPDATE
  文案逐字节不变):动词与补救办法确实因操作而异 —— INSERT 的拒绝必然关于运行时拥有的值,
  其合法写入者是 `isSystem` 与历史导入 `preserveAudit`,而 `readonlyWhen` 在 create 上
  根本锁不住任何东西。

  **升级影响。** 普通(非历史)导入若把遗留单号列映射到 `autonumber` 字段,该值现在会
  被丢弃并改由序列发号,同时在响应的 `droppedFields` 里上报、在服务端日志里留下一条
  带补救办法的 `warn`。要保留原始单号,请把导入标记为历史导入
  (`treat_as_historical` → `preserveAudit`),这与 #3493 为只读业务字段确立的划分一致。

  `packages/spec` 未改动:`autonumber` builder 是否应当直接注入 `readonly: true` 是
  spec 层的独立议题,与这条引擎侧防线不冲突。

- 744b8f5: fix(metadata-protocol,spec): a bulk write that STOPS now reports every record — `NOT_ATTEMPTED` rows instead of a truncated `results` array, and counters that reconcile (#7539)

  `POST /data/:object/batch` with no `options` (so `atomic` defaults `false`,
  ADR-0119 D4) and three records — valid, failing, valid — answered:

  ```
  200 { "total": 3, "succeeded": 1, "failed": 1,
        "results": [ { idx 0: ok }, { idx 1: VALIDATION_FAILED } ] }
  ```

  Two results for three records, no entry for idx 2, and `succeeded + failed` (2)
  `!= total` (3). The un-attempted record was invisible **twice over**: it
  produced no `results[]` entry and was counted in neither bucket, so the only
  trace of it was an arithmetic mismatch a client had to notice and interpret.

  `buildBatchDataResponse` read `total` from the REQUEST (`records.length`) while
  `results` / `succeeded` / `failed` came from a loop that had stopped early. Its
  two siblings under-reported identically — the same defect on `updateManyData`
  and `deleteManyData`, whose per-object bulk counters lost the tail whenever a
  row failed without `continueOnError`. All three now go through one shared
  reconciler rather than a fourth copy of the same arithmetic.

  **What changed is the REPORT, not the semantics.** Every record now gets a row
  saying what happened to it: records after the failure carry
  `errors[0].code === 'NOT_ATTEMPTED'` — the same registered ADR-0112 code the
  atomic arm has emitted since #4793, because "never ran" means the same thing to
  a client whether the batch stopped to roll back or stopped because it was told
  to. The message names the causal row index and `continueOnError`, since on this
  arm the caller's next action is a flag rather than a fixed row. `results` now
  always covers all `total` records, and `succeeded` / `failed` partition it, so
  `succeeded + failed === total === results.length` on both arms.

  **The stop itself is unchanged, deliberately.** Without `continueOnError` the
  first failure still ends the run, records written before it stay written
  (nothing is rolled back on this arm), and the tail is still not attempted.
  That is the declared contract, not an accident:
  `BatchOptionsSchema.continueOnError` reads _"If true (and atomic=false),
  continue processing remaining records after errors"_, ADR-0119 D4 scopes the
  flag to exactly `atomic=false`, and D4's test plan holds non-atomic batches to
  "behave exactly as before". If `atomic: false` alone continued past a failure,
  `continueOnError` would be inert. Callers who want every valid row to land
  should send `continueOnError: true` — unchanged, and now the only difference
  between the two is whether the tail is attempted, not whether it is reported.

  **Upgrade note.** A non-atomic batch that stops now returns more `results` rows
  and a larger `failed` count than before, for the same request and the same
  writes. `failed` counts every row that is not a success — matching the atomic
  rollback response, which has always counted never-reached rows this way. A
  client that summed `succeeded + failed` and compared it to `total` to detect
  truncation no longer needs to; one that treated `failed` as "rows the server
  tried and could not write" should branch on `errors[0].code` instead, where
  `NOT_ATTEMPTED` distinguishes "skipped" from "attempted and failed". No schema
  field was added or removed.

- 9f5cc79: A bulk write's per-row `errors[].httpStatus` carries the status its producer declared, in any spelling (#8570)

  `toRowApiError` set the limb from `err.status` alone, so two well-defined client
  refusals shipped a batch row with no status at all: objectql's `ValidationError`
  (a 400 recognisable by shape, which deliberately declares no `status`) and
  `plugin-approvals`' record lock (a 409 spelled `statusCode`). Sibling rows in the
  same response did carry one — `rowRequiredIdError` → 400,
  `recordNotFoundError` → 404 — so a caller branching on `httpStatus` to tell "fix
  your input" from "the server broke" got an answer for some failure rows and
  silence for others, with nothing saying which. Same single-spelling defect #7525
  fixed at the HTTP door, one layer down.

  The limb now asks `resolveThrownHttpError` — the resolver the HTTP doors and the
  row's `message` limb already answer with — so a refusal declaring `.status`,
  `.statusCode` or the `VALIDATION_FAILED` shape reaches the row as the status it
  always meant. Rows whose throw declared nothing (a driver fault, a hook throwing
  a bare `Error`) still carry no `httpStatus`: the resolver's 500 there is the
  caller's fallback, not a producer's claim, and stamping it would add a field to
  the wire for those populations rather than restore a declared one. `code` reads
  the same resolution, so a row can no longer contradict itself.

  `ThrownHttpError` gains `declaredStatus` — the resolved status minus the
  fallback, absent when the throw declared none. `status` is unchanged, and every
  boundary that answers with the status itself keeps reading it; the new field is
  for sinks that mirror a status onto response DATA, where a fallback would be an
  invention.

- ec74646: Withhold undeclared driver text from a bulk write's per-row `errors[].message` (#8502)

  `toRowApiError` interpolated whatever it caught into a batch row's message, so a
  driver fault under `deleteManyData` answered
  `{ code: "INTERNAL_ERROR", message: "SQLITE_ERROR: no such table: leave_request" }`
  on response DATA riding a 200 — where no HTTP boundary's 5xx withhold can reach
  it. Driven against a real driver the leaked text is worse than the tidy example:
  a delete's raw message carries the failing statement's `WHERE` clause and its
  bound record id, and a create's carries the whole `INSERT` with its values. The
  causal row's message is also copied onto every `NOT_ATTEMPTED` / `ROLLED_BACK`
  sibling, so one leaked sentence was repeated across the batch.

  A caught sentence now reaches a caller only when its producer declared a
  client-facing refusal, asked through `resolveThrownHttpError` — the same
  resolver the HTTP doors answer with — so all three declarations this sink
  actually receives are honoured: a 4xx `status`, a 4xx `statusCode`, and the
  `VALIDATION_FAILED` shape that carries neither. Per-field authoring feedback
  from the engine's validator, `RECORD_NOT_FOUND`, `VALIDATION_FAILED` and
  `plugin-approvals`' `RECORD_LOCKED` are unchanged, byte for byte. Anything
  undeclared — a driver fault, or a hook that throws a bare `Error` — gets a
  stable sentence naming the operation, and the original goes to the server log.

  The `code` limb is untouched (#8441 already gates it on catalog membership), and
  no `httpStatus` is minted where the wire did not carry one.

  **Behaviour change for hook authors**: a hook that refuses by throwing an
  undeclared `Error` no longer has its sentence echoed on the row. Declare the
  refusal — a 4xx `status` or `statusCode`, or `validationFailure(message, fields)`
  from `@objectstack/types` — and the message is served verbatim, as it now is on
  the single-record path.

- e96ad55: fix(metadata-protocol): `batchData`'s upsert fork decides update-or-insert by EXISTENCE, not caller visibility (#5099)

  The fork asked `findOne` under the CALLER's context — the read RLS/sharing
  narrows (#3455). An existing row outside the caller's read scope therefore
  answered `null` and took the INSERT arm: on a store with a unique id constraint
  the insert duplicate-keyed (an authorization/update scenario reported as a key
  collision — the same misdirection class as #5088), and on a store without one
  it wrote a **second row** for an id that already exists.

  The fork now uses the same existence probe (`probeRecord`, system context) as
  the single-record path and the update/delete bulk faces (#4620: one reading per
  file). Whether the caller may WRITE the row it proves stays exactly where it
  was — #1994's pre-image check inside `engine.update` — so the row's outcome is
  the write policy's own answer instead of a spurious `duplicate key` error.

  **Observable change under row-level visibility**: upserting an id that exists
  outside your read scope no longer attempts an insert. The row now answers
  whatever the by-id update path answers for that record (for a masked pre-image
  check, the same 404 a direct update returns). The existence oracle is not
  widened: the previous duplicate-key failure already revealed that the id
  exists.

  The non-atomic fallback (update threw → blind insert) is removed with it, on
  both arms. With existence decided before the fork, the fallback could only
  bury a real update failure under the duplicate-key error of inserting a row
  just proven to exist — the same masking ADR-0119 D4 already forbade inside the
  atomic arm. A row whose update fails now reports that failure.

  Cost note: each by-id upsert row now performs one existence read before the
  write — the same probe cost #4435 accepted for the single-record path and
  #5088 accepted for the update/delete bulk faces.

- bbdbf28: fix(metadata-protocol,objectql): a boot that could not read `sys_metadata` says so at `error`, instead of reporting "no persisted metadata" at debug (#5897)

  `loadMetaFromDb` — the boot step that hydrates `sys_metadata` overlay rows into
  the SchemaRegistry — returned `{ loaded, errors, invalid }`, and no field in
  that shape could express **"this hydration never read the store"**. An
  unreachable database and a genuinely empty one both answered `loaded: 0`.

  Its only production consumer, `ObjectQLPlugin.restoreMetadataFromDb`, therefore
  had nothing to branch on: its single branch chose between two log lines, and
  the "nothing came back" side was
  `logger.debug('No persisted metadata found in database')`. So a kernel that
  could not read a word of its persisted metadata stated at **debug** level that
  there was none, and went on to report ready.

  What that costs is not hypothetical — it is written into the plugin's own
  Phase 2 comment. With the registry empty, `registry.getObject` answers "not
  declared" where the truth is "we could not look": unknown-column query guards,
  hooks and relationships silently degrade, and overlay objects get neither a
  synced table nor a metadata bridge. This is ADR-0110 D3 (an outage is not a
  miss) on the boot side, after the same rule landed for `DatabaseLoader`
  (#5108), `listForIndex` (#5089) and the overlay reads (#5532 / #5707).

  **What changed**

  - `loadMetaFromDb` returns `storeUnavailable: boolean`, set on exactly the
    branch that already prints `[Protocol] DB hydration skipped` — a read that
    failed for a reason `isMissingTableError` does _not_ call benign. A store
    that has merely not been provisioned yet (first boot, before migrations)
    keeps `storeUnavailable: false`, because `loaded: 0` genuinely is the truth
    there (#5841).
  - `restoreMetadataFromDb` reads it and logs at **`error`**, naming the
    consequence (nothing was restored, the kernel keeps reporting healthy, and
    which capabilities silently degrade) and the fix (check the datasource behind
    `sys_metadata` — connection, credentials, table existence — then restart).
    Per AGENTS.md "Degradation log levels": persisted state and runtime state
    disagreeing while the system still looks healthy is the `error` class. An
    empty-but-readable store keeps its quiet debug line, so first boots do not
    start emitting durability errors.

  **Not changed**: control flow. Boot still degrades and continues — refusing to
  boot on an unreadable overlay store would turn a transient outage into an
  outright one. What changes is that the degradation is now distinguishable from
  health, and reported as such.

  **Impact on duck-typed `ProtocolWithDbRestore` implementers**: none required.
  `ObjectQLPlugin` matches the `protocol` service structurally, and the new field
  is declared **optional** on its side of the contract, exactly as `invalid`
  already is. A shim that predates the field keeps type-checking and is read as
  "not an outage" — the only verdict it was able to express before — so its
  behaviour is byte-for-byte what it was. The trade-off is deliberate and worth
  naming: an optional field cannot _force_ a third-party shim to start reporting
  outages, so such a shim stays as silent as it is today. Requiring the field
  would have made that impossible to ignore at the cost of breaking every
  external implementer for a bit only one in-repo producer sets; the in-repo
  producer (`ObjectStackProtocolImplementation`) declares and returns it
  **required**, so the path that actually runs in every ObjectStack kernel is
  fully covered.

- 58434f5: fix(metadata-protocol): boot hydration grafts each overlay row's protection envelope from ITS OWN package (#4624)

  `loadMetaFromDb` (boot hydration) kept a **third** inline copy of the
  overlay→SchemaRegistry registration rule, and its artifact lookup was
  **unscoped** — the exact pre-#1828 shape ADR-0048 removed from `getMetaItems`:
  with two installed packages shipping the same `type`/`name`, a name-colliding
  overlay row grafted the **first-registered** package's
  `_lock`/`_lockReason`/`_packageId`/`_provenance` onto another package's row at
  every kernel boot. A row customized under package B could come up wearing
  package A's identity and lock.

  The non-object branch now delegates to the ONE shared
  `hydrateOverlayIntoRegistry` (introduced by #4521 for the read-side hydration
  and the write-through), passing the row's own `package_id` — one rule, one
  implementation, and the ADR-0048 package-scoped lookup applies at boot exactly
  as it does on read and write.

  No other boot behaviour changes:

  - **Boot order** — when packaged artifacts have not loaded yet at hydration
    time, the scoped lookup finds nothing, exactly like the unscoped one did,
    and the row registers unchanged.
  - **Package-less (global) rows** — `package_id IS NULL` keeps the legacy
    best-effort first-match graft, identical to the read-side hydration.
  - **Row selection** — the helper carries no environment gate; which rows
    `loadMetaFromDb` loads is decided by its query, unchanged here.

- 75bb3af: fix(metadata-protocol): the by-id BULK write faces refuse a row that names no record (#5088)

  `updateMany`, and `batch`'s `update` and `delete` branches, now answer
  `RECORD_NOT_FOUND` (404) for a row whose id resolves to nothing — the same code
  and the same message (`Record <id> not found in <object>`) the single-record
  `PATCH` / `DELETE` have answered since #4435.

  Before this, #4435's "a write that touched zero rows must not report success"
  was live on only 2 of the 5 write faces in `protocol.ts` (`updateData`'s
  existence probe and `deleteMany`'s `deleted === false`). The three bulk faces
  went straight to the engine, with two visible consequences:

  - **`updateMany` / `batch.update`** — a stale id entered the write pipeline.
    With no stored row to overlay, #4770's record materialisation (stored ⊕
    payload) produced a payload-only record, a hook `condition` reading any
    untouched field found it absent, and #4775's unevaluable-condition abort
    fired. The row failed `INTERNAL_ERROR` with a diagnostic accusing a _correct_
    hook of naming an undeclared field, so an operator with one stale id in a
    batch was told their hook was broken and pointed at the object's field list.
    Under `atomic: true` that row also poisoned the batch, taking every later row
    to `NOT_ATTEMPTED`. Hooks, automation and audit rows no longer fire at all for
    a record that does not exist.
  - **`batch.delete`** — discarded the driver's return and reported
    `success: true` unconditionally, so a batch of typo'd ids reported every one
    of them deleted. It now reads the driver contract's positive not-found value
    (`=== false`), exactly as `deleteMany` does.

  Existence is asked with the same `probeRecord` the single-record path uses: it
  answers EXISTENCE, not visibility, so the by-id write policy stays #1994's
  decision inside `engine.update` and the `rls-by-id-write` proof can still go
  red. `upsert` is deliberately unchanged (a missing id still inserts), as are
  the predicate bulk writes (`multi: true`, no per-row id) and the `atomic`
  response shape — the causal row keeps its position, later rows stay
  `NOT_ATTEMPTED`, and rows with real ids behave exactly as before.

  Note for high-volume callers: each by-id row in these three faces now costs one
  extra existence read before its write.

- 43ca399: fix(runtime): `callData`'s ObjectQL fallback answers a missing record id with 404 `RECORD_NOT_FOUND` (#5138)

  `callData` (the data bridge behind `/data`, the MCP bridge and the declarative
  endpoint executor) is protocol-first with an ObjectQL fallback. The fallback
  gave **three different answers to one fact** — that `id` names no row:

  | verb     | before                                                      | on the wire             |
  | -------- | ----------------------------------------------------------- | ----------------------- |
  | `get`    | `return … : null`                                           | `200 { data: null }`    |
  | `update` | `throw new Error('[ObjectStack] Not Found')` — no `.status` | **500**                 |
  | `delete` | no existence check at all                                   | `200 { deleted: true }` |

  The protocol path has answered `404 RECORD_NOT_FOUND` on all three verbs since
  #4435 (re-asserted for the batch path by #5088), so the answer to the same
  request depended on something no caller can see: whether the deployment
  registered the `protocol` slot (`MetadataPlugin` / `@objectstack/metadata-protocol`).
  All three fallback branches now throw the SAME envelope the protocol throws.

  Two of these were actively harmful. `update` reported a caller mistake as an
  internal fault — every dispatcher exit reads `.status` → `.statusCode` → 500, so
  a 4xx fact entered error reporting and alerting as a 5xx. `delete` reported
  success for a row that never existed, which is the hardest class to notice: an
  integrator reading `200` records the cleanup as done.

  The envelope is not re-spelled. `recordNotFoundError` is now exported from
  `@objectstack/metadata-protocol` and imported by the fallback, so there is one
  construction point and the two paths behind one `callData` cannot drift apart
  again.

  **Upgrade note.** If you run an assembly WITHOUT the metadata-protocol plugin
  (lean hosts, and the MCP multi-env path that threads a raw driver), these three
  calls change their answer for a missing id — from `200`/`200`/`500` to `404
{ code: 'RECORD_NOT_FOUND', message: 'Record <id> not found in <object>' }`.
  Deployments that DO register the protocol slot are unaffected: they already
  answered `404` and this release does not touch that path. A client that
  branched on `data === null` from `GET /data/:object/:id` should branch on the
  `404` instead; a client that treated `DELETE` as idempotent should treat `404`
  as "already gone". Declarative endpoints (`object_operation`) inherit the same
  answer, since they reuse `/data`'s delegation.

  `delete`'s existence check is a `find` probe, not a read of what `ql.delete`
  returned: `IDataDriver.delete` declares `Promise< boolean >` and the protocol
  can read it, but `IDataEngine.delete` declares `Promise< any >` and the engine
  returns its driver's result through the hook chain — testing that for `false`
  would be reading a signal the contract does not promise, and it fails in the
  direction this fixes.

- ae31a19: fix(spec,metadata-protocol): `capability` 补齐三处注册 —— 授权面不再接受任意 JSON (#5961)

  `capability` 是「enforced but undeclared」——#5271 给 `api` 关掉的那个
  `declared ≠ enforced` 的镜像。平台早就把它当成一个 metadata kind 在用:
  `PLURAL_TO_SINGULAR` 从 #5870 起就有 `capabilities` → `capability`,
  `AppPlugin` 用这个名字注册 stack 声明的 capability,
  `bootstrapDeclaredCapabilities` 再读回来 seed `sys_capability`。但三处注册表
  里都没有它:`MetadataTypeSchema`(kind 枚举)、`BUILTIN_METADATA_TYPE_SCHEMAS`
  (schema 解析)、`DEFAULT_METADATA_TYPE_REGISTRY`(谁可以写、怎么加载)。

  后果有两条,第二条才是这个 issue 属于授权缺陷而非整洁度问题的原因:

  - `getMetadataTypeSchema('capability')` 返回 `undefined`,于是 `saveMetaItem`
    走了它自己文档化的「未注册类型 → 不校验直接存」分支,
    `PUT /api/v1/meta/capability/:name` 接受**任意 JSON** 落进 `sys_metadata`。
    capability 是靠**名字字符串**被解析的——授予侧 `systemPermissions`、
    要求侧 `requiredPermissions` 都是——所以一行任意 JSON 直接落在活的授权命名
    空间里。
  - `isRuntimeCreateAllowed` 镜像 `getMetaTypes()` 的合成规则:没有静态注册表条目
    的类型被当作可运行时创建。所以缺的那一行不只是「没关上门」,它**把门打开了**。
    `/meta/types` 同步发布了这个虚构:`allowRuntimeCreate: true` + 无 schema,
    metadata-admin 引擎据此渲染成一个 raw-JSON 文本框。

  ### 改了什么

  - **`BUILTIN_METADATA_TYPE_SCHEMAS['capability'] = CapabilityDeclarationSchema`**。
    既有的 422 `invalid_metadata` 路径就此覆盖 `capability`,`/meta/types` 发出真
    JSON Schema。
  - **`DEFAULT_METADATA_TYPE_REGISTRY` 新增 `capability` 条目,
    `allowRuntimeCreate: false` + `allowOrgOverride: false`**。ADR-0066 D1:包
    DEFINE capability,权限集 GRANT,资源 REQUIRE。管理员在运行时凭空造一个
    capability 在这个三分里没有位置——代码里不会有任何地方 require 那个名字,这行
    只是授权命名空间里一个无人引用的授予目标。这一对标志就是 #5086 的 CODE-ONLY
    声明,`saveMetaItem` 在**任何** kernel 上都以 403 `not_creatable` 拒绝,并从条
    目自己的 `filePatterns[0]` 读回「该去哪儿声明」。`supportsOverlay: false`——
    capability 只是名字/标签/scope,没有 merge 语义,而允许租户 overlay 一个包发布
    的声明等于允许把 `scope` 从 `org` 抬成 `platform`。`loadOrder: 12` 早于
    `permission`/`position`(15),使权限集的 `systemPermissions` 解析时 capability
    已经存在。
  - **`MetadataTypeSchema` 枚举补 `'capability'`**。
  - **`CapabilityDeclarationSchema` 声明 ADR-0010 保护信封并收紧为 `.strict()`**。
    信封是必须的:loader 对每个已注册类型都调 `applyProtection`,不声明就会 422 掉
    loader 自己的输出(#4001 在 `permission`/`position` 上补过同一个洞)。收紧则与
    `api` 不同——`ApiEndpointSchema` 同时是**存储行**的解析器,所以它留在
    `STILL_STRIP`;而没有任何地方拿这个 schema 重新解析 `sys_capability` 行
    (`bootstrapDeclaredCapabilities` 通过 `capabilityRowFields` 按名读字段),
    所以收紧零成本,买到的是一个授权面本就该有的 declared = enforced 姿态。
    改用 `strictObject` 书写,已知键从 shape 派生,不新增手抄键表。

  **包声明通道完全没动。** `AppPlugin` 通过 `registerInMemory` 注册 stack 的
  `capabilities[]`,文件系统 loader 按 `filePatterns` glob——两条都不经过
  `saveMetaItem`,所以 `bootstrapDeclaredCapabilities` 依旧照常 seed。
  `OS_METADATA_WRITABLE=capability` 仍是 ADR-0005 那唯一一道运维逃生门,而在它后面
  写入现在由 `CapabilityDeclarationSchema` 判定(422),不再原样落盘。

  ⛔ `role` / `profile` / `policy` **不搭车**:它们没有 `PLURAL_TO_SINGULAR` 映射、
  没有声明 schema、没有读回接缝,是另一个问题,另开单。这条以断言形式钉在
  `capability-metadata-kind.test.ts` 里,因为「capability 有了条目,邻居也该有」
  正是下一个显而易见却错误的改动。

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

- 53aeb02: fix(metadata-protocol): classify a failed index build from the ERROR, not its message (#6699)

  `classifyIndexFailure` — the function both runtime partial-index migrations in
  this package classify a failed `CREATE UNIQUE INDEX` with — carried its own
  private unique-violation vocabulary and answered from the **message channel
  only**. That made it the fifth such copy in the repo, and the one #6250's
  inventory missed: it lives in a package none of the other four touched, so it
  was never in that table and none of the queued follow-ups covered it.

  The first arm now delegates to `@objectstack/types`' `isUniqueViolationError`
  (#6250 / PR #6541) — the one named answer to "is this a unique-constraint
  violation?" — and `probeThenReplaceIndex` passes it the **caught error object**
  instead of `err.message`. A string-only swap would have compiled unchanged and
  kept the defect: the point of the shared predicate is the `code` / `errno` /
  `cause` channels, which unwrapping the message throws away.

  **What changes at runtime.** A driver that reports the conflict on `code` or
  `errno` while giving unhelpful prose — SQLite's `SQLITE_CONSTRAINT_UNIQUE`,
  MySQL's `ER_DUP_ENTRY` / errno `1062`, Postgres' SQLSTATE `23505`, or the
  condition one step down `error.cause` behind a pooled wrapper's `Write failed`
  — was classified `failed`. It is now `conflict`, which is the verdict that
  produces the report ADR-0120 D4 requires: the key that is not enforced, the
  query that lists the offending rows, and the pointer at `os migrate plan`.
  Every message-channel verdict is unchanged — the shared predicate's message
  limb covers all three shipped dialects' prose.

  **Two things deliberately preserved.** The arm order still checks the
  duplicate-row question BEFORE the dialect question, because MySQL's duplicate
  error mentions the key and some drivers wrap both facts in one string; and the
  dialect arm (`unsupported`) is still this module's own message-based
  vocabulary, since the shared predicate answers the first arm only and has no
  opinion about dialect support.

  `classifyIndexFailure`'s parameter widens from `string` to `unknown`, so every
  existing string call still compiles and is judged exactly as before. Callers
  holding a caught error should pass it directly rather than `err.message`.

- 1f82d1e: fix(metadata-protocol): `allowRuntimeCreate: false` is enforced on every kernel — `PUT /meta` no longer creates `job` / `agent` items the registry declares code-only (#5086)

  #4509 set `allowRuntimeCreate: false` on `job` and promised the refusal without
  qualification — _no "create job" in Studio or via `PUT /meta`_. ADR-0063 §2 says
  the same for `agent`. The gate that keeps that promise existed, and worked, but
  it sat behind `environmentId !== undefined`:

  ```ts
  if (this.environmentId !== undefined) {
    // …not_overridable / not_creatable…
  }
  ```

  `environmentId` is a **row-scoping key**, not an authorization signal. Every
  kernel assembled without one ran with the entire ADR-0005 authorization gate
  disengaged — and that is not an exotic topology. The CLI's lightweight
  assembler builds exactly that for a host config (`isHostConfig` → the
  `createStandaloneStack` branch is skipped → `new ObjectQLPlugin()` with no
  `environmentId`), which is the flagship showcase and every self-hosted app
  server shaped like it. On those, the issue's repro answered:

  ```
  PUT /api/v1/meta/job/rc3_runtime_job
      {"name":"rc3_runtime_job","label":"J",
       "schedule":{"type":"cron","expression":"0 0 * * *"},"handler":"nope"}
  → 200 {"success":true,"message":"Saved customization overlay (env-wide) — type=job, …"}
  ```

  `handler: "nope"` names no function in any compiled bundle. The row persists,
  lists, and can never be scheduled — the record #4509 exists to prevent, saved
  and reported as success. It is the ADR-0049 failure mode one level up: the
  _enforcement flag itself_ was the silently-inert declaration, and Studio (which
  reads the flag to hide "create") honoured a rule the API underneath did not.

  **What changed.** A type whose registry entry sets BOTH `allowRuntimeCreate:
false` AND `allowOrgOverride: false` declares that it has no runtime write
  channel at all. `saveMetaItem` now refuses it on every kernel, before
  persistence, in draft mode as well as publish:

  | write                                       | before        | now                   |
  | ------------------------------------------- | ------------- | --------------------- |
  | `PUT /meta/job/*` on a single-kernel host   | `200 success` | `403 NOT_CREATABLE`   |
  | `PUT /meta/agent/*` on a single-kernel host | `200 success` | `403 NOT_CREATABLE`   |
  | same, over a name a code package ships      | `200 success` | `403 NOT_OVERRIDABLE` |
  | project-scoped (cloud) kernels              | `403`         | `403` (unchanged)     |

  The refusal names the type, the flags that produced the verdict, the source
  file pattern to declare it in (read from the type's own registry entry, so a
  newly-flagged type carries an accurate hint the day it is flagged) and the
  `OS_METADATA_WRITABLE` escape hatch.

  **Scope, deliberately.** The rest of the ADR-0005 two-tier gate keeps its
  single-kernel carve-out: that ADR's "single-kernel deployments keep their
  existing behaviour" sentence is about the _overlay whitelist_, predates
  `allowRuntimeCreate` entirely, and a type that stays runtime-creatable
  (`object`, `hook`, `field`, `seed`, `mapping`, …) is untouched here. So is
  `deleteMetaItem` — removing a code-only row that predates this refusal is
  repair and must stay possible. `OS_METADATA_WRITABLE` remains the one door:
  unlocking a type there unlocks it here too.

  **Upgrading.** If a deployment relies on runtime-created `job` or `agent` rows,
  move them into source (`**/*.job.ts`, `**/*.agent.ts`) and redeploy — a `job`
  authored at runtime never had a reachable `handler` in the first place. To keep
  writing them while migrating, set `OS_METADATA_WRITABLE=job,agent`.

- bf32d4a: fix(metadata-protocol): the cold-boot org-scoped audit scans the LIVE metadata-type registry (#6992)

  `reportUnhydratableOrgScopedRows` — the boot line that says which org-scoped
  `sys_metadata` rows hydration walked past (#6190, PR #6600) — built its scanned
  type list by walking `DEFAULT_METADATA_TYPE_REGISTRY`. A metadata type with no
  entry there is registered at runtime by a plugin (`theme`, `connector`,
  `webhook`, `sharing_rule`, `analytics_cube`, …), so it was absent from the scan
  — while `loadMetaFromDb`'s filter (`organization_id: null`) is type-BLIND and
  skips its org-scoped rows exactly like a `flow`'s. That family was the one
  getting **neither** the write refusal nor the warning.

  The scan now unions the declared non-org-overridable types with every **live**
  type the registry does not declare at all, read through the same accessor
  `getMetaTypes()` lists from (`engine.registry.getRegisteredTypes()` plus the
  `metadata` service's) — extracted as `listLiveMetadataTypes()` so the listing
  and the audit cannot drift into two vocabularies of "which types exist here".

  Measured on a real `app-showcase` boot, at the instant the audit fires: 7 live
  types have no registry entry (`analytics_cube`, `connector`, `data`, `package`,
  `sharing_rule`, `theme`, `webhook`), all from the SchemaRegistry, which
  manifests populate during kernel Phase 1 — before the audit runs in
  `ObjectQLPlugin.start()` Phase 2. The widening is live, not defeated by boot
  order.

  **What an operator sees.** Still exactly one aggregated line per boot, same
  `[metadata_org_scoped_unhydrated]` tag and same `type×count (names)` detail with
  a 5-name sample cap — the widening adds segments to that line, never new lines.
  Two wording changes carry the new family: the line no longer claims "types the
  registry declares NOT per-org overridable" (false for a type with no
  declaration) and instead says "types with NO per-org channel"; and each
  plugin-registered type is marked `[plugin-registered]`, because the remediation
  differs — a declared type's org-scoped write is refused from now on, so its rows
  are residue that cannot grow, whereas an undeclared type's write is **not**
  refused and the same names return after every restart until the author stops.

  **The write refusal is deliberately unchanged.** `orgScopedWriteRefusal` keeps
  its "statically-declared types only" predicate: a warning is free and should be
  maximal, a refusal removes a capability, and widening it would extend a ruling
  reasoned over the declared registry onto a surface nobody measured. The
  divergence is now stated in the audit's TSDoc and pinned by a test, so it reads
  as a decision rather than as drift.

- 5b843fb: fix(automation,spec): the cold-boot flow bind must survive the read path's own annotations (cloud#971)

  `getMetaItems({ type: 'flow' })` decorates every served item with
  `_diagnostics` (and `_draft` on a preview read). The cold-boot bind fed that
  served document straight into `engine.registerFlow` → `FlowSchema.parse`, and
  since #4001 closed the metadata schemas an unrecognized key **throws** instead
  of being dropped — so every flow failed to register on every boot with
  `unrecognized_keys: ["_diagnostics"]`. Not fatal only by luck: the
  record-change plugin binds record flows a second way, so automations kept
  firing behind one WARN per flow. A flow whose only binding path is this one
  would have gone silently dead.

  Fixed at the read seam (`readFlowDefsFromProtocol`), not by loosening
  `FlowSchema`: the payload is malformed because we decorated it, so the
  producer's annotation is the producer's to remove.

  `@objectstack/spec` gains `METADATA_READ_DECORATIONS` / `stripReadDecorations`
  (`kernel/metadata-read-decorations`) — the list moves out of
  `metadata-protocol`, where it was module-private, so the producer and its
  cross-layer consumers share one definition. `metadata-protocol` re-exports
  `stripReadDecorations` unchanged; no public surface is removed.

- 74f2f11: fix(metadata-protocol): the ADR-0070 D1 refusal tells an operator with the hatch open that it does not reach package writability (#8361)

  `OS_METADATA_WRITABLE` unlocks a metadata **type**; it has never unlocked a
  package's **writability**. #8146 wrote that sentence into both package-door
  emitters in `SysMetadataRepository`, so a refusal emitted while the variable is
  set says so instead of leaving the operator to guess. On the override side that
  clause is reachable, and #8184 made it reachable on scoped kernels too.

  On the **create** side it was reachable from nowhere an author actually writes
  from. `saveMetaItem`'s ADR-0070 D1 gate refuses on a strictly wider predicate
  than the repository's package door — no "did the caller name a base" limb, no
  registry limbs above it — so it threw first on every kernel, with its own
  sentence, which had no hatch clause in it. Measured before the fix, with
  `OS_METADATA_WRITABLE=permission` set and a runtime-only create aimed at a
  read-only package:

  ```text
  [writable_package_required] Cannot save permission/runtime_reviewer: the package
  'com.example.showcase' is read-only (provided by code or an installed app).
  Switch to a writable package in the package selector, or create a new one, and retry.
  ```

  Byte-identical with the hatch open and with it shut. The operator is told the
  base is read-only — true — and never told that the variable they set a moment
  ago cannot make it writable. Milder than the false prescription #8146 closed on
  the override side (D1 never told anyone to set the variable), so nobody retried
  forever; the missing half is guidance, which is why this ships as a diagnostic
  fix.

  **What changed.** D1 now calls the repository's existing emitter,
  `SysMetadataRepository.readOnlyBaseCreateError`, instead of spelling a second
  sentence for the same condition — the create-side mirror of what #8184 did on
  the override side, and the same one-emitter direction: two independently
  authored refusals behind one condition is how a vocabulary drifts. The same
  request now answers:

  ```text
  [writable_package_required] Cannot create permission/runtime_reviewer in package
  'com.example.showcase': that package is read-only (provided by code or an installed
  app), so it is not a writable base. Switch to a writable package in the package
  selector, or create a new one, and retry. (OS_METADATA_WRITABLE is set for
  'permission': it unlocks the metadata TYPE, not package writability, so it does not
  make a read-only package a writable base.)
  ```

  With the hatch **shut** the clause is absent and the sentence keeps the remedy
  that is true there — the clause is selected, never appended.

  **No acceptance decision moves.** D1's predicate is untouched: every create it
  refused it still refuses, with the same `WRITABLE_PACKAGE_REQUIRED` code, the
  same 422, the same `packageId`, and the same ADR-0070 `docs` pointer; every
  create it admitted — into a writable base, or naming no base at all — still
  lands. Only the sentence the refusal carries changed.

  `readOnlyBaseCreateError` gained an optional trailing `name` so the delegated
  sentence can keep naming the item the way D1's always did. Omitted, its output
  is byte-identical to what shipped in #8146 — which is what the direct
  `repository.put` callers (`promoteDraft`, `restoreVersion`, `revertCommit`) see,
  and until this change they were the _only_ callers reaching that clause at all.

- b3363e9: feat(spec,client): declare the publish door's response — `PublishMetaItemResponseSchema` (#7294)

  `POST /api/v1/meta/:type/:name/publish` has been served since long before this
  change, and had no contract behind it: the string `PublishMetaItem` appeared
  nowhere under `packages/spec/src/`, and the endpoint was absent from
  `plugin-rest-api.zod.ts`'s metadata table. So `version` on the publish response
  sat in exactly the state `version` on the _save_ response sat in before #5745 —
  the ADR-0008 optimistic-concurrency token, the value a caller echoes back as
  `If-Match` to get a 409 instead of a lost update, riding a public wire surface
  with nothing declaring it. `PublishMetaItemResponse` could not be named at the
  type level either, which is why `client.metadata.publishItem()` resolved to
  `any`.

  This carries the #5745 "declared = returned" discipline one door over, with the
  same three artifacts the save door has:

  - **`PublishMetaItemResponseSchema`** declares the FULL measured body —
    `success` / `version` / `seq` required, `message` and the three conditional
    side-effect receipts (`seedApplied` / `materializeApplied` /
    `projectionApplied`) optional. Optionality is measured, not assumed: the sole
    producer's single response literal always sets the first three, and attaches
    each receipt only when the matching side effect ran, so an absent receipt
    means "that side effect did not run", never "it failed".
  - **The endpoint declaration**, so the catalog names the route it serves and
    points at the schema. No `requestSchema`: the body's only read key is
    `message`, taken only when already a string, so the route cannot 400 a
    malformed body and declaring one would advertise a gate that does not run.
  - **A producer-side conformance gate**
    (`publish-meta-response-conformance.test.ts`), driving a real
    `publishMetaItem` against a real ObjectQL engine through the schema across
    the plain shape and every receipt path. A field added to the response, or
    dropped from the schema, now turns that red instead of silently vanishing at
    parse.

  `client.metadata.publishItem()` is typed `Promise<PublishMetaItemResponse>` and
  the type is re-exported, matching `saveItem` / `SaveMetaItemResponse`.

  Also fixes a declared-≠-returned gap one layer down: `publishMetaItem`'s own
  `Promise<...>` annotation omitted `projectionApplied` while the implementation
  assigned it, so the method's type denied a key its callers were receiving.

  No behavior change — nothing about the response body moved. This declares what
  was already on the wire.

- 2c28df9: fix(metadata-protocol): `deleteMetaItem`'s catch re-wrap carries the error `code` (#7426)

  `deleteMetaItem` is the one verb in `protocol.ts` that re-wraps a thrown error
  instead of rethrowing it: both of its catches build a fresh `Error` carrying the
  "failed to delete" context. They carried `status` forward and dropped `code`, so
  a refusal thrown by `SysMetadataRepository` with a full ADR-0112 envelope reached
  the caller as **403 with `code: undefined`**, its code surviving only as prose
  inside the message. That made the envelope depend on the deployment topology: on
  a project kernel (`environmentId` set) the same refusal comes from
  `deleteMetaItem`'s own two-tier block and arrived intact with
  `code: 'NOT_OVERRIDABLE'`, while a control-plane kernel — which skips that block
  entirely — answered the code-less 403.

  Both re-wrap exits now carry `code` forward, gated on membership in the declared
  ADR-0112 vocabulary (`StandardErrorCode ∪ ERROR_CODE_LEDGER`) — verbatim the
  predicate `toRowApiError` in the same file already applies to decide which thrown
  code may become a wire code. A driver's own dialect (`42P01`,
  `SQLITE_CONSTRAINT`, `ECONNREFUSED`) is not in the catalog and stays out of the
  envelope, so restoring the code for refusals does not smuggle an unregistered
  code onto a surface `ApiErrorSchema` declares as a closed union.

  What a caller sees change, per failure kind through those two catches:

  - repository authorization refusal (`NOT_OVERRIDABLE`) — was `403` + no code,
    now `403` + `NOT_OVERRIDABLE`;
  - engine failure carrying a **registered** code (`ERR_DATASOURCE_UNAVAILABLE`,
    `ERR_DRIVER_CONNECT`) — was `status` only, now `status` + that code;
  - engine failure carrying an **unregistered** driver code, or none at all —
    unchanged (`500`, no code), and pinned so it stays that way;
  - `ConflictError` — unchanged (`409` + `METADATA_CONFLICT`); it is translated one
    branch above the re-wrap and never passes through it.

  `status` is untouched at both sites. The message text is unchanged — the code is
  added to the envelope, it does not restate the sentence — so the 5xx prose
  sanitisation in `@objectstack/rest` is unaffected; that layer already forwards a
  declared `code` when one is present.

- 20bc357: fix(spec,metadata-protocol,runtime): discovery stops advertising routes for the kernel-internal cache/queue/job slots (#4318)

  The metadata-protocol discovery builder declared `/api/v1/cache`, `/api/v1/queue`
  and `/api/v1/jobs` — three paths that existed nowhere else in the repository: no
  dispatcher domain, no adapter mount, no plugin registration, and the shipped
  providers (`service-cache`/`-queue`/`-job`) are in-process contracts that will
  never mount one. Every default boot therefore advertised a route inside the same
  `ServiceInfo` whose `handlerReady: false` said the opposite — a single record
  contradicting itself (ADR-0076 D12).

  These slots are route-less now, like `realtime` — but unlike `realtime` an
  unmarked real implementation stays `available`: the slot's contract is
  in-process, so "no HTTP surface" is not reduced capability for it. `handlerReady`
  is reported `false` on both discovery builders — for a route-less slot it is not
  a proxy for anything, it is the fact itself (the dispatcher used to claim
  `handlerReady: true` here for an unmarked occupant, a handler that does not
  exist). The explanatory message is written once, as
  `inProcessServiceMessage(slot)` in `@objectstack/spec/system`, so the two
  builders cannot drift apart.

- 0373d52: Both discovery builders now derive the `data` service entry from the implementation in the slot, closing the hardcoded "kernel-provided" block (#4130).

  #4089 computed `metadata`; `data` was the last entry that judged itself, reporting `status: 'available'` and `handlerReady: true` unconditionally. That was true — but by a convention in a different package, not by anything either builder checked: ObjectQL is the slot's only producer, and plugin-dev always loads `ObjectQLPlugin` as a child, so plugin-dev's `data` stub (`find()` returns `[]`, `insert()` mints an id and stores nothing) never reaches the slot. A second producer, or a trimmed dev config, and the hardcode starts lying about the platform's most load-bearing capability.

  Both builders now read the registered service's `__serviceInfo`:

  - a real engine carries no marker ⇒ `available` + `handlerReady: true`, byte-identical to the hardcode it replaces (verified on a real kernel boot);
  - a self-declared stub ⇒ its own `status` and `message`, with `handlerReady: false` (the default for `stub`), so a consumer that gates on `handlerReady` stops treating an empty query engine as a real one.

  `handlerReady` is derived here rather than pinned `true` as it is for `metadata`, because the two routes differ: `/meta` answers from the protocol whatever fills the metadata slot, while `/data` needs the `protocol` or an objectql-shaped service and 503s without them — and the only stack where a stub occupies the `data` slot is one where ObjectQL never registered. No routing, gating or dispatch behavior changes: the `data` domain resolves its engine directly and never consulted this slot.

- 2a2a9fb: fix(spec,metadata-protocol,runtime): one place decides what an unset `NODE_ENV` advertises (#5936)

  A deployment whose operator never exported `NODE_ENV` must not describe itself as
  `development` on `/discovery`: `environment` is a machine-readable field, a client
  reads it to answer "am I talking to production?", and it may skip production warnings
  or loosen a destructive action's confirmation on the answer. #5673 ruled that in and
  fixed it — but only for one of the two producers, because that dispatch put
  `packages/spec` out of scope. The other one, `MetadataProtocol.getDiscovery()` (served
  by `@objectstack/rest`), went on answering `development` for exactly that input.

  The default now lives in the shared mapper, `resolveDiscoveryEnvironment`: an absent —
  or blank — value resolves to `production`, and both producers pass the operator's value
  through as they read it, neither carrying a default of its own. That is what makes it
  one decision instead of two copies, and it means the next discovery producer inherits
  the right answer without anyone remembering to copy a line. Patching only
  metadata-protocol would have left a second copy of the default — precisely the drift the
  shared table was created to prevent (#4828).

  "Unset" includes a blank value: `NODE_ENV=` exports an empty string, the runtime's
  `getEnv` has always folded that into its default, and had the mapper treated blank as
  "anything else" the two producers would have drifted again on that one input.

  **#4828's rule is untouched, and it points the other way on purpose.** A value that IS
  set but is not a spelling this repo recognises (`qa`, `preview`) still degrades to
  `development`, so nothing ever claims `production` on a guess. Absence is not a guess —
  it is the host declining to say.

  Behaviour change to expect: a host that exports no `NODE_ENV` and serves `/discovery`
  through `@objectstack/rest` now advertises `environment: "production"` where it
  previously advertised `"development"`. A deployment that genuinely is development should
  say so — `NODE_ENV=development` — which is what the runtime dispatcher has already
  required since #5673.

  The mapping table above `NODE_ENV_TO_DISCOVERY_ENVIRONMENT` is corrected in the same
  pass: its `unset / anything else -> development` row had been false for the runtime
  caller since #5673 and is now two rows, one per rule.

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

- 8201000: fix(metadata-protocol): refuse a dotted `fields`/`$select` entry instead of widening the response to every field (#7532)

  `POST /api/v1/data/:object/query` with `{"fields":["name","account.name"]}` answered
  `200` carrying **every** business field — strictly more data than was asked for — and
  no resolved `account.name`. `GET /api/v1/data/:object?$select=name,account.name` did
  the same. A parameter whose entire purpose is to return LESS had "return more" as its
  failure mode, pointing away from both FLS and data minimisation.

  `assertProjectionFieldsExist` validated only `f.split('.')[0]`, so a dotted entry
  cleared the #4226 unknown-name gate on its **head** segment (`account` really is a
  field) and travelled on to the driver as a projection column. Measured on a real
  `SqlDriver` (better-sqlite3):

  ```
  no projection                  -> account amount created_at id name status updated_at
  fields ['name']                -> name                        (a plain name narrows)
  fields ['name','account.name'] -> account amount created_at id name status updated_at
  fields ['account.name']        -> account amount created_at id name status updated_at
  ```

  The dotted rows are byte-identical to no projection at all. Knex renders
  `"account"."name"` against a table that was never joined, sqlite answers `no such
column`, and the driver's #3821 recovery ladder retries `select('*')` because rows
  matter more than the projection.

  A dotted entry on this axis is now `400 INVALID_FIELD`, with the `unknown` > `dotted`
  precedence {@link assertSortFieldsExist} already applies, so the two axes report the
  same complaint first. The message names the relationship it tried to cross and sends
  the caller to `expand` — the sanctioned door for related data here — or to
  denormalising the value onto the queried object. A dotted path whose head is a real
  but non-reference column gets its own wording, since `expand` would be the wrong
  prescription for it.

  This also settles the second half of the report: an unknown **plain** column was a
  `400` while an unknown **dotted** one was a `200` with every field, so one mistake got
  opposite verdicts on one endpoint depending on how it was spelled. Both doors —
  `POST /query` body `fields` and `GET ?$select=` — fold into the same slot before the
  gate and are pinned separately.

  Nothing that worked stops working: no driver ever resolved these paths. Plain
  projections still narrow, unknown plain columns still refuse per #4226, an unknown
  head still gets the unknown-name verdict with its did-you-mean, and `expand` still
  delivers related records. The engine's internal-caller projection tolerance and
  `SqlDriver`'s recovery ladder are deliberately untouched — refusing at ingress is what
  stops a request reaching them with a projection no driver can apply.

- 8eb5d8b: fix(metadata-protocol): a draft preview no longer reports itself invalid because of its own `_draft` badge (#7656)

  `GET /api/v1/meta/<type>/<name>?preview=draft` answered with `_diagnostics.valid:
false` and _"Unrecognized key(s) on this object: `_draft`"_ for drafts that were
  perfectly valid — the read stamped `_draft:true` onto the item so the console
  could badge it, then validated the item **with that key still on it** against a
  closed schema. The verdict was about the reader, not the document, and it reached
  both exits: the single-item preview read and the draft overlay in the list.

  `computeMetadataDiagnostics` now removes every key on the shared
  `METADATA_READ_DECORATIONS` list before its re-parse, instead of the private
  one-key copy it carried (which removed `_diagnostics` only, and predated `_draft`
  joining that list). That list exists precisely so the read path's own annotations
  cannot be mistaken for document content by anything that re-parses a served
  document — the write path's verbatim persist (#4326) and the cold-boot flow bind
  (cloud#971) are the other two consumers; read-time diagnostics are the third.

  The item schema is **unchanged and still closed**: `_draft` remains rejected by
  name when it appears in a stored body, which is what keeps the write-path strip
  load-bearing. Only the reader stopped feeding its own badge to it.

  Genuinely invalid drafts are unaffected — they still read back `valid:false` with
  their own errors, on both exits.

- bcea363: fix(metadata-protocol): let an org-scoped caller see env-wide `sys_metadata` rows in `duplicatePackage` / `reassignOrphanedMetadata` (#7819, tier 2)

  Both methods scanned `sys_metadata` with a strict `organization_id` equality:

  ```ts
  if (request.organizationId) where.organization_id = request.organizationId;
  ```

  `organization_id = 'org'` matches no row whose column is NULL, so an org-scoped
  caller could not see any row recorded env-wide. Both scans now accept org-scoped
  **or** env-wide rows — the same `$or` `deletePackage` (#7705), `listCommits`
  (#7779) and the tier-1 sites (#7857) already carry.

  ## These two were filed UNVERIFIED, so step one was a measurement

  #7819 carried four sites. Tier 1 shipped on measured evidence; these two were a
  grep match with a plausible mechanism, on a **different table** (`sys_metadata`,
  not `sys_metadata_commit`) with callers nobody had driven. "Latent, not live"
  would have been a complete outcome and no fix. Reachability was checked on a
  real engine before a line was edited, and both halves came back live:

  1. **A caller passes an org.** One production caller each, both in
     `packages/runtime/src/domains/packages.ts`: `POST /packages/:id/duplicate`
     and `POST /packages/:id/adopt-orphans`, each forwarding
     `resolveActiveOrganizationId` — the same door tier 1 measured.
  2. **Env-wide rows exist in that table.** Not incidentally: a `saveMetaItem`
     from a session with no active org writes `organization_id = NULL`, and
     `resolveActiveOrganizationId` answers `undefined` both for such a session and
     for any throw on the auth seam. For the orphan site, a `saveMetaItem` naming
     **no package at all still succeeds today** and lands `package_id = null,
organization_id = null` — the current write path mints exactly the orphan the
     scan could not see, so that population is live rather than the legacy residue
     the docstring can be read as describing.

  Both projected symptoms then reproduced, and both were worse than projected.

  ## `duplicatePackage` — a partial copy reporting success, and a copy wired back to its source

  Measured before the fix: a source package holding one env-wide row and one
  org-scoped row, duplicated by an org caller, answered
  `{success: true, copiedCount: 1, failedCount: 0}`.

  The sharper consequence is the **rename map**, which is built only from the rows
  the scan returns. With the env-wide `object` rows missing it came out empty, so a
  copied view was renamed `iojn2_list` while its `data.object` still read
  `iojn_widget` — a duplicate silently wired back to the base it was cloned from,
  reporting success. An all-env-wide source degraded just as quietly the other way:
  `{success: false, copiedCount: 0, failedCount: 0}`, nothing copied and nothing
  named as failed.

  ### Widening the scan alone was **not** a fix

  With the scan widened and the write left as it was, the object copy landed in
  `failed[]` with `NOT_OVERRIDABLE`: `object` is declared `allowOrgOverride=false`,
  so stamping the request's org onto the copy is refused — boot hydration loads
  env-wide rows only, and an org-scoped `object` row would vanish on the next
  restart (ADR-0005, #6190).

  Since an `object` therefore **cannot exist org-scoped**, every object row in a
  source package is env-wide, and an org-scoped `duplicatePackage` could never copy
  a single one. Objects being what a base is mostly made of, ADR-0070 D4's
  "duplicate base" gesture was structurally unable to duplicate a base whenever an
  org was active — a larger defect than the card projected.

  So each copy now lands in **the scope of the row it came from**, not the
  request's: the same rule #7559 gave `revertCommit`, for the same stated reason —
  this loop now processes a batch that "legitimately mixes an env-wide artifact
  with an org overlay". Scoped to the org-scoped door alone; with no
  `organizationId` every copy is still written env-wide exactly as before.

  ### One hazard this fix introduces rather than inherits

  Widening the scan makes a collision newly possible: an item can now appear twice,
  as an env-wide row **plus** this org's overlay of it. Both copies would land on
  the same target key (`type, name, organization_id, COALESCE(package_id, '')`), so
  the surviving body would be decided by driver row order. The caller's own org now
  shadows env-wide — ADR-0005 overlay precedence, the same order
  `resolveMetaItemOrgScope` applies — and that is pinned as its own case.

  ## `reassignOrphanedMetadata` — the sharper member

  Measured before the fix: two orphans, one env-wide and one org-scoped, adopted by
  an org caller answered `{success: true, reassignedCount: 1}`, leaving the
  env-wide orphan at `package_id = null` with nothing reporting it skipped.
  **Finding orphans is this method's entire purpose**, so a class of orphan it
  structurally cannot see is a wrong answer, not a partial one.

  ADR-0070 D5 settles the scope question the widening raises (an org-scoped caller
  now rebinds rows every org can see): the unit is explicitly the **environment** —
  "bulk-assign legacy orphans to a default base named for the environment",
  completing when "an environment has no orphans" — in a deployment model whose own
  words are "there is no per-org overlay dimension here… the relevant axis is code
  package vs writable base, not 'org'". Under the model this method was designed
  for, every orphan is env-wide, so the strict equality made it **inert** for an
  org-scoped caller in precisely that deployment.

  ## The no-org branch is deliberately NOT narrowed

  On both sites, exactly as #7705, #7779 and tier 1 left theirs. The exposure is
  worst at `reassignOrphanedMetadata`, whose no-org `where` is `{}` and already
  scans every organization's rows; narrowing either door to `organization_id IS
NULL` would re-create this bug pointed the other way. Both doors are pinned as
  they stand so they cannot drift silently. Whether the orphan door _should_ be
  that wide is #7780's open product question — a maintainer call, not decided here.

  ## Pin

  `packages/runtime/src/package-duplicate-adopt-org-scope.integration.test.ts` — a
  real `ObjectQL` over a real `SqlDriver` on better-sqlite3, seeded through the real
  publish path, because the question is whether `organization_id = 'org'` matches a
  NULL column: a property of the driver's SQL, not of a stub's `filter()`. Every
  existing suite over these two methods either stubs `engine.find`
  (`packages/objectql/src/protocol-package-lifecycle.test.ts`) or never passes an
  org (the ADR-0070 dogfood), which is exactly why none could see this family. It
  lives in `packages/runtime` because `metadata-protocol` cannot import `objectql`
  (dependency cycle).

  Twelve cases: the premise measured out of SQLite; the live-orphan producer; the
  positive for each site; the reference-rewrite consequence; the org-shadows-env
  precedence; both negative directions per site (another organization's rows,
  another package's rows, owned rows); and the no-org door on each site.

  **Reverse verification**, direction predicted before running: restoring the strict
  equality turns red exactly the two positives, the reference-rewrite case, and the
  two orphan cases that assert the env-wide orphan is adopted — five — leaving the
  negative directions and both no-org doors green, since strict equality is
  _narrower_ than the `$or`. Measured: **5 failed | 7 passed**, exactly those five.

  ⚠️ These suites resolve `@objectstack/metadata-protocol` through its **`dist`**
  and source-map traces back to `src`, so a source-only revert measures nothing
  while looking like it measured something. The package was rebuilt between every
  measurement above.

- 8aacf94: fix(metadata-protocol): `duplicatePackage` stops minting pre-protocol flow rows (#4498)

  `duplicatePackage` canonicalizes each source row before re-saving it, under a
  stated guarantee: "duplication never mints new rows in a pre-protocol dialect."
  It delivered that through `convertStoredItem`, which opens with
  `if (singular === 'flow') return { item: data, notices: [] }` — so for flows the
  guarantee was **not** delivered.

  It did not fail loudly either. `FlowNodeSchema.config` is an open `z.record`, so
  a pre-17 body (a `delete_record` carrying `config.filters`) sails through
  `saveMetaItem`'s schema gate and lands verbatim in a brand-new row.

  **Why this mattered more than an un-migrated row.** ADR-0087 justifies the whole
  stored-metadata design on new writes always being canonical, _therefore_ the
  stored pass being "a strictly shrinking concern". `duplicatePackage` was a live
  producer contradicting that for flows: an operator could run
  `os migrate meta --stored --apply`, get a clean report, duplicate a package, and
  be back to having pre-protocol rows — with the report still saying protocol N
  until the next run.

  **The capability was already reachable.** The reason for the flow skip is real —
  flow-node conversions carry ADR-0078's open-namespace conflict guard, which needs
  the automation engine's live executor registry to tell a rename from a clobber.
  But the protocol is constructed with an accessor for the kernel's service table
  (the same one `analytics` and `package` are read from), and the automation
  service registers under `automation`. A new private `resolveFlowCanonicalizer`
  reads `canonicalizeStoredFlow` (#4454) off it, so every caller running next to a
  live engine gets flow coverage without threading anything.

  - **`duplicatePackage`** canonicalizes flow rows through it. A refused rename
    fails that item into the existing `failed[]` naming the token — copying the
    un-renamed body would mint exactly the row this fixes. A flow that cannot
    canonicalize fails the same way. With no engine reachable (a control-plane or
    metadata-only host) the source body is copied as-is: no worse than the source
    row already is, and failing an unrelated duplication over it would be its own
    regression.
  - **`migrateStoredMetadata`'s `canonicalizeFlow` becomes an override.** It now
    defaults to the resolver. The CLI stopped passing one — it boots its inert
    engine into the same kernel, so both routes reached the same instance, and two
    routes to one capability is how they drift. The parameter stays for callers
    with no registry and for testing the flow branch without an engine.
  - **Resolution is lazy, per call.** Plugin init order does not guarantee
    `automation` is in the table when the protocol is assembled (the CLI adds it
    after ObjectQL by design), so caching `undefined` from a too-early read would
    disable flow canonicalization for the life of the process.

  Two smaller honesty fixes ride along: a source item that fails _conversion_ (a
  tombstoned key throws) is now reported as such instead of as `unparseable
metadata`, and `migrateStoredMetadata`'s "no engine" skip reason says no
  automation service is reachable rather than blaming the caller for not supplying
  one.

  Reads are unchanged. `getMetaItems` / `getMetaItem` / `getMetaItemLayered` /
  `loadMetaFromDb` still skip flows — they are reads, covered by `registerFlow`
  canonicalizing at execution, and are not producing bad data. Duplication was the
  one that writes.

- 40e8653: fix(metadata-protocol): `duplicatePackage` no longer drops a locale from a two-tier i18n bundle (#7932)

  Duplicating a package as an org-scoped caller copied **one locale of a
  two-locale email-template customization** and reported `success: true`.

  `duplicatePackage`'s source-row scan deduplicates the scanned `sys_metadata`
  rows with a `NUL`-separated key built from the row's `type` and `name` only,
  keeping the org-scoped row over the env-wide one. That key is `(type, name)`
  with **no discriminator**, so for a type whose identity the spec declares as a
  **pair** it collapses two rows that are two different things.
  `EmailTemplateDefinitionSchema` declares exactly such a type: multiple rows with
  the same `name` but different `locale` form an i18n bundle, resolved by
  `(name, locale)`.

  **Why the exposure is narrow, and why it is nevertheless real.**
  `sys_metadata`'s overlay uniqueness is
  `idx_sys_metadata_overlay_active = (type, name, organization_id, package_id)`,
  and the table has **no locale column** — an `email_template`'s locale lives in
  the `metadata` JSON body. So within **one** org, two rows differing only by body
  locale cannot exist and no collapse is possible. Across the **env-wide**
  (`organization_id IS NULL`) and **org** tiers they can, and this scan — widened
  to span both tiers in #7819 — is the one place the two tiers meet. An env-wide
  `auth.welcome` customized in `en-US` plus an org-scoped `auth.welcome`
  customized in `zh-CN` are two distinct bundle members; the scan kept only the
  org one. Registry-shipped (code-authored) members are unaffected, because this
  scan reads `sys_metadata` overlays only — the exposure is limited to templates
  customized at **both** scopes.

  The dedup key now appends the canonical-normalized discriminator **when the type
  declares one, and nothing otherwise** — the same shape #7774 gave `metaItemKey`
  and `mergePackageAwareOverlay` for the `GET /meta/<type>` list. `email_template`
  is the only type in `ITEM_KEY_DISCRIMINATORS` today, so **every other type's key
  is byte-identical** to what it was before and this change's blast radius is
  provable rather than argued.

  **Precedence is unchanged wherever it was ever meaningful.** An org row still
  overrides the env-wide row of the _same_ bundle member; a member that declares
  no locale is still keyed as the canonical (`en-US`) member, so the bundle-blind
  and bundle-aware answers continue to agree for a single-member "bundle". Only
  rows that were never the same thing stay separate. The no-`organizationId` door
  never ran this dedup and is untouched.

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

- 6908830: <!-- adr-0087: registered engine-find-formula-order-by-refused -->

  fix(objectql)!: `engine.find` / `engine.findOne` refuse an ORDER BY they cannot materialise (#7095)

  `engine.find()` and `engine.findOne()` are a **public API**, and an `orderBy`
  naming a `formula` field — which used to return rows successfully, in an
  arbitrary order — now **throws `400 INVALID_SORT`**.

  #6994 closed this at the REST ingress (`assertSortFieldsExist`), covering
  everything that reaches `findData`: the list route, `POST /data/:object/query`,
  the export route and the RPC dispatcher. A caller reaching the engine directly
  passed through none of it. Measured on the base of this change, real `ObjectQL`
  over a driver that really sorts:

  ```
  engine.find(o, { orderBy: [{ field: <formula>, order: 'asc'  }] }) -> C A E B D
  engine.find(o, { orderBy: [{ field: <formula>, order: 'desc' }] }) -> C A E B D
                                               asc === desc (byte-identical)
  ```

  A `formula` value is computed on read, so no driver materialises a column for
  it: the ORDER BY reached the driver, found nothing, and the unknown-column
  backstop returned the rows unordered under a success — carrying the very values
  they were asked to be ordered by. With `limit`, "the latest N" was an arbitrary
  N that no amount of inspecting the response could reveal.

  - FROM `orderBy: [{ field: '<formula field>' }]` → TO: denormalise the value
    onto the object (a stored field, written when the source changes) and sort by
    that. This is the same remedy, in the same words, that the REST door has
    prescribed since #6924 / #6994 and that the SEARCH axis prescribes since
    #6673 — a caller refused at two doors is not sent two different ways.

  **`summary` / rollup fields are NOT affected** and still sort in both
  directions: they get a real, maintained column. The family this refuses is
  `formula`, not "computed" — widening it to the spec's `COMPUTED_VALUE_TYPES`
  (the _write_ contract) would break two types that work, and a control test pins
  that.

  **Who was actually reaching this.** The #7095 ruling required the internal-caller
  tolerance to survive only behind a pinned internal path, and only if a _measured_
  internal call site relied on it. The sweep of every in-tree `orderBy` reaching
  the engine directly — hooks, flows, reports, queue/job adapters, sharing,
  metadata loaders, expand sub-reads — found **none**: every hardcoded internal
  sort names a real stored column (`created_at`, `updated_at`, `version`,
  `priority`, `scheduled_for`, `started_at`, `next_run_at`, `recorded_at`, `id`),
  and no shipped object in the repo declares a `formula` field at all. So **no
  internal path shipped**, and there is no flag to opt back into the drop — a
  negative test pins that the public options shape refuses one.

  The one **author-reachable** consumer is why leaving this at ingress was not
  tenable: a saved report's `query.orderBy` is forwarded verbatim into
  `engine.find` by `plugin-reports`, bypassing the ingress gate entirely. A report
  authored to sort by a formula field used to run and return an arbitrary order;
  it now fails loudly with the remedy in the message.

  **One path deliberately does NOT become a refusal.** A nested `expand` sort
  raises this same error inside `expandRelatedRecords`, but that sub-read sits in a
  pre-existing graceful-degradation `catch` which swallows _every_ expand failure
  and retains the raw foreign keys. That path therefore moves from **silent** to
  **observable** — a warning naming the field and the fix — rather than refusing.
  Reversing that backstop is a decision about all expand failure modes (#3821) and
  is not ridden in on this change; it is measured and pinned as-is.

  **What did NOT change:** the ingress gate is untouched — same message, same
  `unknown` > `dotted` > unmaterializable precedence, same `param` name that the
  engine cannot know. The engine door judges only the third verdict: unknown and
  dotted sort names still reach the driver from a direct call exactly as before,
  because refusing those is a posture change on two further axes rather than a
  free extension of this one. Reading a formula field, and the projection axis'
  `SELECT *` tolerance, are also untouched.

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

- b201ca8: fix(metadata-protocol): enforce the `field` overlay lock — an artifact-backed field PUT is refused instead of accepted 200 (#7743)

  The metadata-type registry declares `field` with `allowOrgOverride: false`, and a
  field a code package ships is an artifact. Yet
  `PUT /api/v1/meta/field/showcase_task.title` answered **200** `state:'active'`
  with an admin bearer, the row persisted, and it read back with
  `_diagnostics.valid=true`. Reproduced on `showcase_task.status`. The door
  answered success twice over for a write the registry forbids.

  **Why the declaration was never consulted.** `field` is the ONE type in
  `DEFAULT_METADATA_TYPE_REGISTRY` whose artifacts are not standalone registry
  items: its `filePatterns` (`**/*.field.ts`) match nothing in any app, because
  fields are authored _inside_ the object (`ObjectSchema.fields`). So the object's
  loader registers one `object` item and no `field` items at all, and
  `getArtifactItem('field', 'showcase_task.title')` missed on a field the package
  unambiguously ships.

  That miss is a load-bearing authorization input, not a cosmetic one.
  `isArtifactBacked` is what picks the write INTENT for
  `SysMetadataRepository.assertAllowed` (`override-artifact` vs `runtime-only`) and
  what arms `saveMetaItem`'s own `NOT_OVERRIDABLE` gate. With the lookup empty, an
  override of a packaged field was classified as a runtime-only **create** — and
  `field` carries `allowRuntimeCreate: true`, so `allowOrgOverride: false` was
  never reached. Both doors read the same predicate, so both are closed by making
  it truthful: `isArtifactBacked` now resolves a `<object>.<field>` name through
  the object's artifact and answers about the field the package actually ships.

  **The other tier is untouched, deliberately.** `allowRuntimeCreate: true` is
  real: a genuinely new field the object's artifact does not carry is still
  accepted, and so is a field of a runtime-created (non-packaged) object. This
  closes the overlay tier only.

  **Scoped to `field`, measured rather than assumed.** Every other declared type
  either registers its artifacts standalone with a `_packageId` — `action` (70 on
  the showcase), `page` (33), `permission` (16), `dataset` (9), `doc` (9), `hook`
  (4), `report` (4) — or genuinely ships no artifacts, where "not artifact-backed"
  is the true answer. `action` is the instructive one: also nested inside the
  object document, yet registered standalone, and already refused correctly.
  `object` / `view` / `dashboard` / `job` were measured as already correct in the
  same run and behave identically after this change.

  The refusal is pinned at the **live route** (`packages/runtime`), driving the
  real dispatcher, protocol and repository on both topologies — the environment
  kernel and the no-`environmentId` showcase, which refuse at different sites. The
  27 existing protocol-level cases in `overlay-precedence.test.ts` were green
  throughout the defect's life precisely because the route was not in their
  coverage.

  Two defects found alongside this one are filed rather than folded in: the
  accepted write is also **inert** (#7893 — a legitimately created field never
  appears in the object's `fields`), and the **plural** URL spelling
  `/meta/fields/<name>` still walks around this lock because `PLURAL_TO_SINGULAR`
  has no `fields` key (#7894, which spans four types). The plural gap is
  characterized by a test that names it and goes red when it is closed.

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

- d53bd0b: `findData`'s shared list-query normalizer now checks the ARITY of every query
  parameter it reads, instead of coercing a repeated one blind (#7321).

  `IHttpRequest.query` is `Record< string, string | string[] >` and the array arm
  is produced by a real first-party adapter (`NodeHttpServer` hands `?x=1&x=2`
  through as `['1','2']`). Every coercion in this normalizer was written for the
  string arm, so a repeated parameter was coerced into a value nobody asked for
  and served under a 200:

  - `?$top=1&$top=2` → `Number(['1','2'])` is `NaN` → the driver was called with
    `limit: NaN`. Same for `$skip` / `offset`.
  - `?status=open&status=won` → the leftover-key bucket lowered it to
    `where: { status: ['open','won'] }`, and a bare array is not a valid field
    spec — it matches no row on any backend. An empty page, 200 OK.
  - `?$search=a&$search=b`, `?$count=true&$count=false` and a repeated body
    `object` behaved the same way, each in its own flavour.

  Those are now refused with `400` / `error.code: INVALID_REQUEST` — the code this
  same normalizer already answers for the identical condition reached the other
  way (two SPELLINGS of one slot given different values, #4181 → #3795). A
  one-element array is one occurrence and is unwrapped, not refused; an empty
  array is no occurrence.

  **Unchanged on purpose — this is a per-parameter judgement, not a sweep.**
  `$select` / `select` / `fields`, `$expand` / `populate` / `expand`,
  `$searchFields`, `$orderby` / `sort` / `orderBy`, `$filter` / `filter` /
  `filters` / `where` (whose array arm is a FILTER AST, not a repetition),
  `groupBy` and `aggregations` all accept the array arm on purpose and keep it
  byte for byte. A blanket "reject repeated parameters" rule would have broken
  every one of them.

  Not reachable on today's production Hono adapter, which collapses repeated
  parameters to the first value before any handler runs; it becomes reachable when
  that collapse is removed (#6878 route 2).

- dba7747: fix(metadata-protocol): `getUiView` 的响应体不再多发三个未声明键,与 `GetUiViewResponseSchema` 对齐

  `GET /ui/view/:object/:type` 由 `getUiView` 产出、REST 层 `res.json(view)` 裸发(不套信封、不校验)。它的声明是 `GetUiViewResponseSchema`(= `ViewSchema`),但实发 body 里的 `list.object` / `form.object` / `form.label` 三个键,`ListViewSchema` / `FormViewSchema` 这两个 `strictObject` 从未声明,实测 `safeParse` 直接 `unrecognized_keys` 判红。因为 `GetUiViewResponseSchema` 在全仓没有任何运行时读者,这处分裂此前没有任何断言看得见。

  **FROM → TO**

  ```
  FROM  { list: { type, object, label, columns, sort, searchableFields } }
  TO    { object, list: { type, label, columns, sort, searchableFields } }

  FROM  { form: { type, object, label, sections } }
  TO    { object, form: { type, sections } }
  ```

  - **迁移**:读 `object` 的消费者上移一层 —— `body.list.object` / `body.form.object` 改读 `body.object`。这是**相同的值换了层级**,不是删除:`ViewSchema` 一直在容器层声明 `object`(「Object this container binds to」),成员层那份本就是冗余副本。
  - `form.label`(原 `` `Edit ${…}` ``)**不上移、直接摘除**:它是渲染串而非元数据,任何 view schema 都没有声明过它;标题由 UI 自行拼(调用方本就知道自己请求的是哪个对象)。`list.label` **不受影响** —— `ListViewSchema` 正式声明了 `label`,保持原样。
  - 定级 **patch** 而非 minor/major:三键的消费面实测为零 —— `client-react` 的 `useView` 把 body 当 `any` 透传(`UseMetadataResult.data: any`),objectui 全仓 `meta.getView` 零命中(其 `getView(objectName, viewId)` 走的是 `client.meta.getItem('view', …)`,另一条通路)。无编译期破坏面,无类型改判。
  - `packages/spec` **零改动**:本次是把实现修正到既有声明,不是改声明迁就实现。

  **未验面**:`cloud` 仓未在本次验证范围内(按 #5540 口径如实标注)。若该仓有直接读 `body.list.object` / `body.form.object` 的代码,需按上面的迁移上移一层;`form.label` 的读者需自行拼标题。

  常驻 pin:`packages/metadata-protocol/src/protocol.ui-view-response-conformance.test.ts` —— 用**生产端真实组装路径**(实调 `getUiView`)喂 `GetUiViewResponseSchema.safeParse`,而非手拼 fixture。反向验证已跑:恢复任一多发键 → pin 转红并点名该键。

- 769511c: fix(metadata-protocol): a Studio-saved form authored with `groups` reaches the stored row as `sections` (#7134)

  #6926 / PR #7128 folded `FormViewSchema.groups` onto the canonical `sections` at
  the producer, which made the declared alias true for every consumer of a
  **parsed** form. It did not reach a form authored in **Studio**. `saveMetaItem`
  parses the body through that very schema — so since #7128 it already _computes_
  the folded body — and then discards `parsed.data` on purpose, because a
  wholesale swap would strip the Studio-only round-trip keys (`isPinned`,
  `isDefault`, `sortOrder`) that ride along with an overlay. The authored spelling
  was therefore persisted verbatim, and the row reached `sections`-reading
  consumers still spelled `groups`.

  Measured consequence on the public-form routes in `@objectstack/rest`, for a
  form saved from Studio rather than declared in code:

  - `GET /forms/:slug` published an **empty** field schema (#6601's narrowing
    found no declared fields to publish);
  - `POST /forms/:slug/submit` computed an empty `allowedFields` whitelist and
    **refused the submit outright** (#6920).

  **The fix is a new sibling of `graftNormalizedOperators`, not a fallback in the
  consumer.** Per Prime Directive #12 the producer stays strict and
  `rest-server.ts` is untouched — a `?? match.form?.groups` there would fossilize
  the alias into a second de-facto contract and leave the next consumer blind.
  `graftFoldedFormSections` walks the authored body and `parsed.data` in lockstep
  and replays exactly one normalization: at any position where the author wrote
  `groups`, the parse dropped it, and the parse produced `sections` in its place,
  the authored array is moved to `sections` verbatim. That is the exact
  post-condition of the producer's fold, so no list of "places a form can live" is
  maintained — the flattened runtime overlay, `config` on a `ViewItem`, and
  `form` / `formViews.*` on a container are all covered by one walk, and a form
  slot added later is covered without an edit.

  A **sibling** rather than a parameter on the existing helper because
  `graftNormalizedOperators` walks by structure and copies a changed _scalar_ at a
  key both sides carry; `groups` → `sections` is a _key move_ — one key removed,
  another added — which its per-key loop cannot express. Both grafts now run on
  every save, the fold first.

  Nothing else about the save changes: the body is still persisted verbatim, the
  moved array keeps the authored shape (no schema defaults are stamped onto it),
  `sections` still wins when the author wrote both keys (empty array included, the
  producer's own precedence rule), and the Studio round-trip keys still survive.

  ⚠️ Rows persisted **before** this change still carry `groups`; they are healed by
  the author's next save, the same way #4542's flow rows are. Nothing is
  backfilled at read.

  `packages/spec` is unchanged — this narrows what is _stored_, never what is
  _accepted_; `groups` remains legal at input.

- 427344c: fix(i18n): the object catalog no longer overwrites an explicitly-set `label` / `pluralLabel` / `description`

  `translateObject` resolved an object's three scalars as `catalog ?? document`. The
  i18n catalog is keyed by object name and is the packaged translation of the
  **packaged** declaration, so consulting it first discarded every value authored on
  top of that declaration: a code-shipped `objectExtensions` scalar, and — the severe
  half — a tenant's own Studio rename, which answered `200` and then appeared on
  neither `GET /meta/object` nor `GET /meta/object/:name`, i.e. neither read a
  writable form derives from.

  The catalog now applies only while the document's scalar still equals the packaged
  base value; a scalar that differs was authored by somebody, and the catalog yields
  to it. Comparison-based, per scalar, with no provenance flag carried through the
  fold: `@objectstack/metadata-protocol` exposes the packaged owner declaration
  (`getPackagedObjectBase`) and `@objectstack/rest` hands it to the translator at the
  three sites that localize an object document. A host whose protocol does not
  answer keeps the previous behaviour exactly, so nothing loses a translation it has
  today. `?layers=true` stays untranslated and diagnostic, unchanged.

- c733ae8: fix(metadata-protocol): the dialect arm of `classifyIndexFailure` walks `cause` to the same depth the conflict arm does (#6848)

  `classifyIndexFailure` had two arms reading two different wrap-depths. #6699
  moved the first arm onto `@objectstack/types`' `isUniqueViolationError`, which
  follows `error.cause` four levels down because pool and query-builder layers
  re-throw with the original attached. The second — the dialect arm — kept reading
  `err.message` and stopping there.

  So a dialect refusal arriving behind a wrapper (outer prose `Write failed` or
  `pool query failed`, the actual `near "WHERE": syntax error` one step down
  `cause`) was graded `failed` instead of `unsupported`. The private
  `indexFailureText` helper now collects the message channel of the thrown value
  **and** of each `cause` below it, bounded at the same `MAX_CAUSE_DEPTH` of 4 the
  predicate uses and counted the same way (the thrown value is depth 0). The
  dialect vocabulary itself is unchanged — only the text fed to it.

  **Why the verdict matters beyond wording.** The two consumers dispose of
  `unsupported` and `failed` differently. `view-definition-active-index.ts` treats
  them the same (keep the previous index, report at `error`; only the wording
  differs). But `ensureOverlayStateIndex` builds the composite **fallback lookup
  index** on the `unsupported` branch and on no other — offered precisely because
  a dialect that cannot take the partial form should still get the lookup. Under
  a `failed` verdict that branch never ran, so `fallback` came back
  `not-attempted` rather than `ensured` / `refused` and the degradation target was
  silently never attempted.

  **Dormant, not a live regression.** No driver shipped today produces the wrapped
  shape — each hands knex's error back with the dialect text on the outer message,
  which is why every existing case matched on the first read. This closes an
  asymmetry before a wrapping raw-SQL driver can land on it; it is also not a
  regression from #6699, which only made the contrast visible by deepening the
  first arm.

  Two details worth knowing if you touch this: the collected levels are joined
  with a **newline**, never a space, because two of the dialect alternatives are
  multi-word (`where clause`, `near "where"`) and a space would let a phrase be
  synthesised across a wrapper boundary that no single driver wrote. And a looping
  `cause` chain is **bounded rather than detected** — no visited set — which is
  exactly what the predicate this mirrors does.

  Arm order is unchanged and still load-bearing: a conflict reported anywhere in
  the chain still beats a dialect refusal in the outer prose.

- 65159ae: fix(metadata-protocol): 分层读的 overlay 读失败不再被画成「这一项没有定制」(#5707)

  `getMetaItemLayered` 是 Studio「code / overlay / effective」对比视图背后的那次读
  (`GET /api/v1/meta/:type/:name?layers=true`)。它的 `sys_metadata` overlay 读裹着一个
  裸 `catch`,注释写着 "DB unavailable — overlay stays null" 然后照「没有 overlay 行」
  返回。

  那不是一个中性的兜底值。这个信封在**同一次响应里同时给出三个正面断言**,而且是 200:

  - `overlay: null` —— 「这一项从来没有被定制过」;
  - `overlayScope: null` —— 「org 和 env 两个作用域都没有行」;
  - `effective === code` —— 「现在生效的就是打包件原样」。

  对比视图存在的意义正是回答作者「我改过什么」。故障期它回答「什么都没改过」——
  和 #5532 同一个错误(可用性故障被讲成作者的声明事实),只是落在 diff 视图而不是 404 上。
  本次沿用 #5532 / PR #5705 的判定,补上该 PR 按 scope 刻意没有覆盖到的这一处读。

  **改了什么**:这一处 `catch` 改为调用同文件的 `rethrowUnlessMetadataStoreUnprovisioned`
  —— `isMissingTableError`(表尚未建 → 确实没有 overlay 行)良性放行,其余上抛
  `status: 503` / `code: SERVICE_UNAVAILABLE`,驱动原始错误挂在 `cause` 上。没有新增
  判定逻辑,也没有新的返回形状:分层信封仍是 code / overlay / effective 三**层**,而不是
  每层三**态** —— 「读不到」不是一层,所以照失败上报,不再冒充某一层的取值。

  **wire 可见变化**

  | 场景                           | 之前                                                                | 之后                                                     |
  | ------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
  | `sys_metadata` 不可达          | `200` + `overlay: null` / `overlayScope: null` / `effective = code` | `503` + `SERVICE_UNAVAILABLE`(`cause` 带驱动报文),可重试 |
  | org 作用域读失败、env 行本可读 | `200`,连那行 env overlay 也一并报告为「没有」                       | `503`,同上                                               |
  | `sys_metadata` 尚未建表        | `200` + 只有 code 层                                                | 不变                                                     |
  | 存储正常                       | 不变                                                                | 不变                                                     |

  REST 侧无需改动:`?layers=true` 与普通读共用同一个 `handleRouteError`,#5437 / #5464
  的消毒与日志口原样接住。已测量的消费方处置也都已就位:objectui 的
  `MetadataClient.layered()` 对非 2xx 一律 `throw`(只有 404 映射为空信封),
  ResourceEditPage 的加载 `try/catch` 把它渲染成错误态而不是空白页;
  `plugin-security` 的三个消费点里,两处本就有 `catch` 兜底,唯一没有的
  `projectPermissionMutation` 在 503 化后反而更安全 —— 此前的静默 `null` 会让权限集
  投影悄悄退回打包基线(`customized: false`),没有 declared body 时甚至会把记录
  retire,而协议的 `runMutationProjector` 契约是 never throws,会把 503 收敛成
  `projectionApplied: { success: false }`。

- 30bed70: fix(metadata-protocol): a legacy env overlay on a rolled-back overlayable type can be REMOVED again (#6960)

  #6483 / PR #6608 flipped `permission` / `position` / `page` / `app` / `dataset` /
  `book` to `allowOrgOverride: false`. That closed the **write** door and
  deliberately left the **read** path alone — `supportsOverlay` stayed `true`, so
  an overlay row authored _before_ the rollback still merges overlay-wins and
  still shapes the effective body.

  Removing such a row was refused, at two places and on two different topologies:

  - `deleteMetaItem`'s `environmentId !== undefined` branch answered
    `403 not_overridable` **before** it ever probed for the row — so even an
    artifact-backed item with nothing customized was refused;
  - `SysMetadataRepository`'s delete gate refused the same removal
    `intent: 'override-artifact'`, and that check is **topology-independent**, so
    a control-plane kernel (no `environmentId`, which skips the first gate
    entirely) was refused there instead.

  Net effect for an environment that upgraded across the rollback while holding
  such a row: the ordinary "Reset to package default" flow answered 403 with the
  item still customized, and `OS_METADATA_WRITABLE` was the only documented way
  out.

  **What changes.** Per the maintainer's ruling of 2026-08-10, the **delete** side
  moves: removing an overlay of a type whose loader merges overlays at read time
  is allowed through the ordinary delete path, on both kernel topologies, without
  the operator hatch. Deleting an overlay restores the code-declared state — the
  narrowing direction, which cannot widen anything — so refusing it served no
  security purpose while trapping the repair behind an escape hatch.

  **What does NOT change, deliberately.**

  - **Create and update stay refused exactly as before.** The asymmetry is the
    ruling, not an oversight: `saveMetaItem`'s gate and `SysMetadataRepository.put`
    are untouched, and both gates' doc comments now record why, so the asymmetry
    is not later "fixed" into symmetry.
  - **The `object` tier does not move.** The relaxation is keyed on the registry's
    `supportsOverlay` flag, not on `allowOrgOverride`, so it stops at the tier
    boundary: `object` declares `supportsOverlay: false` (its overlay registers as
    its own contributor layer, ADR-0029 D9) and keeps refusing both verbs, which
    is D9.6's declared cost.

  Zero affected rows in the in-repo corpus today (measured at PR #6608), so this
  is a correctness-of-contract change with no live victim.

- e15e870: Record the whole metadata lifecycle in the audit trail, not only `save`.

  `publishMetaItem` and `rollbackMetaItem` reached `recordMetadataAudit` only
  through `assertLockAllowsWrite`, which writes a row on the **deny** path and
  returns before any write on allow — so a _refused_ publish was audited and a
  _successful_ one was not. The 409 `METADATA_CONFLICT` refusal is raised outside
  that helper and wrote nothing either, leaving a caller who repeatedly lost an
  optimistic-concurrency race indistinguishable, in the trail, from one who never
  tried.

  A successful publish now writes an `operation: 'publish'` row and a successful
  rollback an `operation: 'rollback'` row, both `outcome: 'allowed'`, in the same
  position and shape as the existing `save` and `delete` rows. All four routes
  that can raise the 409 (save, publish, rollback, delete) now write one
  `outcome: 'denied'`, `code: 'metadata_conflict'` row through a single shared
  helper. Audit writes remain best-effort: a failing audit table logs and never
  fails the underlying operation.

  Batch `publishPackageDrafts` is deliberately unchanged — it promotes drafts
  inside one `engine.transaction()`, where an audit row would roll back with the
  batch rather than record the attempt, which is a different contract from the
  sites above. Tracked separately.

- d719048: fix(metadata-protocol): `listCommits` no longer hides a package's env-wide commit history (#7779)

  `protocol.listCommits` selected the ADR-0067 timeline with the same strict
  `organization_id` equality that #7705 (PR #7771) had just replaced one function
  above it:

  ```ts
  const where = { package_id: request.packageId };
  if (request.organizationId) where.organization_id = request.organizationId;
  ```

  `organization_id = '<org>'` matches no row whose column is NULL, so a session
  with an active organization was shown **none** of the commits recorded
  env-wide. The commits were in `sys_metadata_commit` the whole time; the read
  could not see them.

  **Env-wide commit rows are actually written — this was live, not latent, and
  that was measured before the fix was written.** `recordPackageCommit` stores
  `organization_id: request.organizationId ?? null`, and the only door into a
  publish (the dispatcher's `POST /packages/:id/publish-drafts`) forwards an
  organization only when `resolveActiveOrganizationId` yields one. That resolver
  answers `undefined` both for a session with no active organization and for _any_
  throw on the auth seam, since its whole body is `catch`-wrapped. A publish made
  before an organization is selected — or during a transient auth failure — is
  therefore recorded env-wide permanently, because the timeline is append-only.
  Driven on a real engine over SQLite, a no-org publish wrote
  `organization_id: null` and the org-scoped read of that same package then
  returned `[]`.

  **The blast radius is wider than audit.** `rollbackToPackageCommit` derives the
  set of commits it must undo _from this list_, so a commit the list could not see
  was a commit the rollback silently skipped: measured before the fix, an
  org-scoped rollback past an env-wide commit answered
  `{success: true, revertedCommits: []}` while that commit's changes stayed live.
  A rollback that reports success and rolls back nothing is a correctness defect,
  not a reporting one.

  An org-scoped read now matches its own organization **or** env-wide — the
  `$or [{organization_id: oid}, {organization_id: null}]` shape this package
  already uses for the #3115 "orphaned draft" fix, the shape #7705 applied to the
  sibling `deletePackage` read, and the shape the SQL driver's own implicit tenant
  wall uses (`field = :tenant OR field IS NULL`, #2734).

  Both directions that must not widen are pinned: another organization's commits
  stay invisible to an org-scoped read, and another package's commits are never
  returned. Newest-first ordering is unchanged. The **no-org** branch is
  deliberately left package-wide rather than narrowed to `organization_id IS
NULL` — narrowing it would hide every org-scoped commit from that door instead,
  re-creating this bug pointed the other way, which is exactly why #7705 left its
  own no-org branch alone.

  **Known remaining gap, reported on #7779 rather than fixed here** (this card
  holds `protocol.ts`, a serialized file, for `listCommits` alone): `revertCommit`
  and `rollbackToPackageCommit`'s own target lookups still carry the identical
  strict equality. The consequence is now _loud_ instead of silent — the rollback
  above reports `success: false` naming the commit it could not resolve, rather
  than claiming success over a no-op. That is strictly better and non-destructive,
  but it is not the whole repair, and the new suite asserts it so the remainder
  cannot drift unnoticed before its own card lands.

- 877545c: `MetadataProtocol.listCommits` 不再把 commit store 读不到答成「这个 package 没有提交历史」

  `listCommits` 读 `sys_metadata_commit` 的 `catch` 此前对任何失败都返回 `[]`,零日志、不按错误类型区分 —— 它的 JSDoc 甚至把这写成了设计(“Returns [] if the commit store is unavailable”)。于是 ADR-0067 的提交时间线上,「确实没有历史」与「有历史但库读不到」返回值完全一致,而这条时间线正是 `revertCommit` 的选择面:故障期间 UI 显示「无可回滚项」,`rollbackToPackageCommit` 更会在一次都没回滚的情况下返回 `success: true`。

  现在按错误类型区分,与本文件既有的 `sys_metadata` 覆盖层读法(#5532 / #5707 / #5840)同一处方:表未 provision(首启)仍返回 `[]`;其余失败一律包成 503 `SERVICE_UNAVAILABLE` 上抛,驱动原始错误挂在 `cause` 上。调用方由此能把 outage 与 miss 分开。

  行为变化:`GET /packages/:id/commits` 在 commit store 故障时返回 503 而不再是 `{ commits: [] }`。

- 444a07c: fix(metadata-protocol): boot hydration classifies "store not provisioned yet" by error type, not by a copied message regex (#5841)

  `loadMetaFromDb` — the boot step that hydrates `sys_metadata` overlay rows into
  the SchemaRegistry — decided whether a failed read was the benign first-boot
  case by running its own `/no such table/i` over `e.message`. That was a second,
  hand-copied vocabulary of "which driver errors are benign", sitting a few
  thousand lines below the first: the same file already imports
  `isMissingTableError` from `@objectstack/metadata/errors` and asks it in
  `rethrowUnlessMetadataStoreUnprovisioned` (#5532), as do this package's
  `SysMetadataRepository` (#4867) and `DatabaseLoader` (#5108).

  A copy is wrong in both directions, and only one of them is loud:

  - **SQLite** says `no such table: sys_metadata`, which the copy matched — by
    luck of which driver the author was running.
  - **PostgreSQL** says `relation "sys_metadata" does not exist` (SQLSTATE
    `42P01`) and **MySQL/MariaDB** says `Table 'app.sys_metadata' doesn't exist`
    (errno 1146). Neither matches the regex, so a perfectly healthy first boot on
    either driver printed `[Protocol] DB hydration skipped: …` — a warning about
    a working system that no operator can act on.
  - Conversely, any driver phrasing a _different_ failure as "no such table" was
    read as benign and swallowed without a line.

  The seam now asks `isMissingTableError`, so the classification follows driver
  `code` / `errno` / message / one step down the `cause` chain, and a driver quirk
  is taught to the platform once. Observable change for operators: no spurious
  first-boot warning on Postgres/MySQL, and a real failure that happens to be
  worded like a missing table is no longer silently benign. The warning line also
  reports non-`Error` rejections properly instead of printing `undefined`.

  Not changed here: a non-benign read failure is still answered with a
  `console.warn` plus `{ loaded: 0, errors: 0, invalid: 0 }`, so the return value
  still cannot distinguish "the store holds no overlay rows" from "the store could
  not be read" (ADR-0110 D3, on the boot side). That is a change to the method's
  return contract and to its consumer in `ObjectQLPlugin.restoreMetadataFromDb`,
  and is tracked separately as #5841 fact 2.

- 288e5a4: fix(metadata-protocol): the ADR-0010 lock gate refuses an uncertain write instead of allowing it (#5706)

  `getEffectiveLock` is the single source of truth for the ADR-0010 §3.3 lock
  gate, and both of its callers are write-path admission — `assertLockAllowsWrite`
  (save / publish / rollback) and `assertLockAllowsDelete`. Its overlay read was
  wrapped in a bare `catch` that fell through to `lock: 'none'`.

  `'none'` is not a neutral placeholder there. It is the verdict "the author
  declared no protection", and `evaluateLockForWrite` / `evaluateLockForDelete`
  turn it straight into "allow". So a `sys_metadata` read that **failed** became a
  write that was **performed**, on an item whose overlay row declared it
  protected. Measured before the fix, with the overlay row carrying `_lock` and
  only the gate's own read rejecting: `saveMetaItem` returned `success: true`
  after updating a `_lock: 'no-overlay'` item, and `deleteMetaItem` returned
  `success: true` after deleting a `_lock: 'no-delete'` one — while the very same
  rows, read successfully, produce `403 ITEM_LOCKED`. The audit trail did not
  record the miscarriage either: the allowed path writes its ordinary
  `outcome: 'allowed'` row, so nothing afterwards showed the write should have
  been denied.

  **Wire-visible change.** When the lock state cannot be read, `save`, `publish`,
  `rollback` and `delete` now fail with `503` / `SERVICE_UNAVAILABLE` (the driver
  error attached as `cause`) instead of proceeding as if the item were unlocked.
  Refusing one uncertain write is the intended trade against performing one that
  had to be refused. Callers that retry on 503 need no change; callers that
  treated a successful save as proof the item was unlocked never had that
  guarantee.

  The discrimination reuses `rethrowUnlessMetadataStoreUnprovisioned`, introduced
  in #5705 for this file's overlay reads, rather than inventing a second
  predicate: an unprovisioned `sys_metadata` genuinely has no overlay row, so
  `'none'` is the truth and first boot still saves normally; every other error is
  an outage.

  Unaffected, and covered by regression tests: artifact-level locks (answered from
  the in-memory registry before the overlay read is reached), a genuine miss on a
  healthy store (still allowed), and control-plane kernels (`environmentId`
  undefined), which never enter either gate.

- f6e59f7: fix(metadata-protocol): the delete heal no longer unregisters an object bound to an installed package

  Deleting a metadata overlay row for an `object` whose `package_id` names an installed package took the object off the whole data plane until the next restart: every CRUD call answered `OBJECT_NOT_FOUND` / 404 while the table still held the rows, and the delete receipt said `reset: true`.

  `SchemaRegistry.registerObject` replaces (splices out) the same-package `own` contributor rather than shadowing it, so hydrating such a row destroys the packaged definition at write time and stamps `_provenance: 'org'`. Tier 3 of `restoreArtifactRegistryView` then consulted `isArtifactBacked` — which for an `object` is exactly that provenance — and read "not code-shipped" for an object the package still ships.

  Tier 3 now also refuses when the owner contributor's package binding names a currently-installed package, and says so in the log. The binding survives the overwrite (the replacement fires only when the package ids match); the definition does not.

  Known cost, deliberate: a package-bound runtime-authored object is indistinguishable from a package-shipped one by binding alone, so a genuinely deleted one stays registered until the next restart — listable, and rowless. A surplus entry is the cheap error here; a wrongly retired one 404s data CRUD for every tenant.

- dbe92a7: fix(metadata-protocol): boot 重水合按行的真实 package 绑定登记对象归属(#4636 裁 B 收官)

  `loadMetaFromDb` 的 object 分支从 `engine.find` 返回的行上读 `record.packageId`,而 `sys_metadata` 的列是 snake_case 的 `package_id` —— 该表达式恒为 `undefined || 'sys_metadata'`,于是每次重启都把**绑定了包**的对象 overlay 登记在 `'sys_metadata'` 哨兵下。改为读 `package_id`,与写路径、`getMetaItems`、以及相邻的非 object 分支一致。

  用户可见的行为差异:归属键同时就是包过滤键(`getAllObjects(packageId)`),所以此前一个对象在**创建时**出现在自己所属包的侧边栏过滤里,**重启之后就消失**;更要紧的是重启后的第一次编辑——boot 登记 `'sys_metadata'`、保存登记 `app.<slug>`,`registerObject` 抛 `already owned by package …` 被 `applyObjectRegistryMutation` 吞成 `console.warn`,保存回 `success: true` 而内存 schema 停在重启时的版本,这一笔编辑被静默丢弃(cloud#970 的重启面)。两侧统一到真实 id 后,过滤与编辑都跨重启成立。

  `@objectstack/objectql` 仅同步 `registry.ts` 中 `isTenantAuthored` 的契约注释:PR1 标注的「这半句描述的是契约,还不是代码」随本次落地摘除。

- 63b33e6: One canonical type key at the `/meta` read/write/delete boundary (#4432).

  #3985 made the per-type gates accept both spellings of the `/meta` type segment
  (`/meta/actions` and `/meta/action`). It did not FOLD them, so the two spellings
  addressed two different namespaces and the layers below disagreed about which
  one an item lived in. `saveMetaItem`, `getMetaItem`, `getMetaItems`,
  `getMetaItemLayered`, `getMetaItemCached` and `deleteMetaItem` now fold the type
  to its canonical singular (Prime Directive #3) as their first act, so every layer
  below them reads one key.

  The damaging consequence was not the duplicate row — it was the shadowing.
  `getMetaItems` hydrated overlay rows back into the SchemaRegistry under the
  CALLER's spelling, so one plural-spelled read minted a plural registry entry;
  from the next read on, `listItems('actions')` was no longer empty, the singular
  fallback that had been supplying every code-authored action stopped running, and
  a single overlay row hid the entire code-authored listing — on a spelling no
  DELETE could address, because the delete path resolved the singular. Listing and
  dispatch then disagreed about an item that had been deleted.

  Reads of data AT REST still try the other spelling as a fallback: rows written
  under a plural `type` before this fix are real, and nothing rewrites them on
  upgrade. What changed is that nothing WRITES or REGISTERS a non-canonical key any
  more.

- 114e727: fix(objectql,metadata-protocol): deleting a runtime-created overlay retires its registry entry, so list/get/dispatch agree (#5079)

  Deleting a metadata item an admin had **created** at runtime (`DELETE
/api/v1/meta/<type>/<name>` for a name no code package ships) removed the
  `sys_metadata` row and reported `reset: true`, while every read surface kept
  serving the deleted item for the life of the process: `GET /meta/<type>` still
  enumerated it, `GET /meta/<type>/<name>` still returned its body, and the
  ADR-0110 D3 declaration gate still resolved a declaration for it. No TTL was
  involved — only a restart cleared it. This is the residual branch of #4432
  ("every surface in agreement"), the mirror image of the write direction #4521
  fixed.

  **Cause.** #4521 made `saveMetaItem` write an overlay through into the engine's
  `SchemaRegistry` under the PLAIN key, so a saved item is dispatchable and not
  merely listable. The delete side's registry heal
  (`restoreArtifactRegistryView`) only knew how to _un-shadow a packaged
  artifact_: `SchemaRegistry.removeRuntimeShadow` deletes the plain key **only**
  when a composite `<packageId>:<name>` artifact remains underneath, so that the
  name stays resolvable. For a runtime-created item there is no artifact —
  the row _was_ the item — so the heal declined and nothing else ever removed the
  entry.

  **Fix — at the producer, not the readers.** `restoreArtifactRegistryView` now
  walks the layers under the deleted overlay and stops at the first one that can
  serve the name: (1) a composite-key artifact, (2) a MetadataService baseline,
  and (3) — new — nothing, in which case the plain-key entry is retired via the
  new `SchemaRegistry.removeOverlayEntry(type, name)`. The registry now makes the
  same distinction the delete receipt already makes (#5927): "reset to artifact
  default" vs "it no longer exists".

  Two boundaries are preserved deliberately:

  - **A packaged artifact is never unregistered.** `removeOverlayEntry` refuses a
    plain-key entry that is itself an artifact (`_packageId` set, not the
    `sys_metadata` rehydration sentinel, not tenant-authored) — the same
    predicate `getArtifactItem` applies to its own bare-key fallback — and never
    touches composite keys. Resetting a customization of a shipped item still
    reveals the shipped value.
  - **An outage is not an absence (ADR-0110 D3).** The layer-2 baseline read now
    decides whether an entry is retired, so it goes through the diagnosed read: a
    metadata plane that could not answer stops the walk instead of retiring an
    entry on the strength of a read that never happened.

  Measured on the showcase app: before, `POST /api/v1/actions/<object>/<name>`
  after the delete answered 404 with the _handler-miss_ wording ("… not found"),
  because the declaration was still resolvable from the stale entry; it now
  answers the ADR-0110 "has no declaration" 404 — byte-identical to the state
  before the item was ever created.

- 7372d46: fix(metadata-protocol): keep every i18n bundle member through the `/meta` list merge (#7774)

  #7730 taught the `SchemaRegistry` that an `email_template`'s identity is
  `(name, locale)`, so `listItems('email_template')` returns every member of a
  declared i18n bundle. `GET /meta/<type>` then merges that listing with two
  higher layers, and both merges keyed by `(package, name)` with no
  discriminator — so the bundle survived registration only to collapse one layer
  later, and the list served a single locale.

  **Both merges now key on the pair.** `metaItemKey` takes an optional third
  component and `mergePackageAwareOverlay` buckets per slot rather than per name;
  both derive the value from the shared discriminator table, and both are
  byte-identical for a type that declares no discriminator — which is every type
  except `email_template` today.

  - **The MetadataService merge** is the path the issue named: with a `metadata`
    service installed and answering non-empty for the type, the second member's
    `Map.set` overwrote the first.
  - **The `sys_metadata` overlay merge** was predicted to need no change, on the
    ground that overlay rows are unique on `type+name+organization_id+package_id`
    and carry no locale column. That is true of the rows and beside the point:
    the base of that merge is the registry's bundle, so bucketing by bare name
    dropped a locale as soon as a single overlay row existed for the type — and
    the row that survived was the overlay body, whichever member it customizes.
    An overlay (or a draft preview) now lands on its own locale member and the
    rest of the bundle is served untouched. Across the env-wide and org tiers,
    rows that customize different members are likewise two slots instead of one;
    org-over-env precedence is unchanged within a member.

  **The discriminator table moved to `@objectstack/metadata-core`.**
  `ITEM_KEY_DISCRIMINATORS` was declared in `@objectstack/objectql`'s
  `registry.ts`, and `@objectstack/objectql` depends on
  `@objectstack/metadata-protocol`, so the protocol package could not import it
  without closing a dependency cycle. metadata-core is the package both already
  depend on and depends on neither — the same criterion that sank the engine
  write-verb dispatch predicates (#5619) and the audit-field governance table
  (#4513) there. **No public surface changes:** `registry.ts` re-exports
  `ITEM_KEY_DISCRIMINATORS` under its original name from its original module, so
  every existing import keeps working; `@objectstack/metadata-core` gains it plus
  `readDiscriminatorValue` / `itemDiscriminator` as additive exports. The
  registry's storage-key _format_ (`name@<locale>` composite keys and their
  parser) deliberately did not move — it encodes the registry's own Map keys,
  which no other package reads.

  For an app this is Studio's metadata list and `GET /meta/email_template`
  showing both the en-US and the zh-CN copy of a template instead of whichever
  one the merge happened to keep.

- d5031f6: fix(metadata-protocol): `GET /api/v1/meta/<type>` stops listing a skill twice after a runtime PUT (#7654)

  `PUT /api/v1/meta/skill/<name>` returned 200 and then `GET /api/v1/meta/skill`
  served the skill **twice** — the store-override row and the package row, side by
  side, disagreeing about `active`. Nothing about the pair told a caller which one
  was the effective document.

  `getMetaItems` merges three layers, and two of them answered the identity
  question differently:

  - `mergePackageAwareOverlay` — the `sys_metadata` overlay merge — resolves per
    `(slot, package)` and treats a **package-less** row as _standing in for_ each
    package's row of that name, which is exactly how
    `getMetaItem(name, packageId=P)` resolves.
  - the MetadataService merge one layer below keyed a hand-rolled `Map` on
    `(package, name)` with **strict** equality, so a package-less row occupied a
    slot of its own instead of standing in for anything.

  A runtime PUT carries no `?package=`, so the row it writes is
  `package_id IS NULL`. For a type whose baseline arrives through the
  MetadataService rather than the SchemaRegistry — `skill`, `agent`, `tool` reach
  it through that service's own loaders — the registry listing is empty, so the
  overlay merge had no base row to take provenance from and left the override body
  with no `_packageId`. Its key then missed the package-bearing baseline row in
  the merge below, the "already present, do not overwrite" guard never fired, and
  both rows were served.

  The MetadataService merge now runs **that same package-aware resolution** rather
  than a second implementation of it: the runtime listing is the base layer and
  the registry-plus-overlay result is the higher one, so the documented precedence
  (a `sys_metadata` customization wins over the artifact baseline) is preserved
  while the two steps can no longer disagree about what a package-less row means.

  **Not a `skill` special case.** The same shape was measured duplicating for
  `agent`, `tool` and `page`; the mechanism is the merge's attribution rule, not
  the type, and the fix closes the mirrored attribution too (a package-less
  baseline under a package-bearing higher row). Where a name is shipped by two
  packages, both rows are still served — ADR-0048 resolution is unchanged — and a
  package-less override now reaches both of their slots.

  Also visible: the surviving row carries the `_packageId` of the package it
  overrides, so provenance, the package filter and the disabled-package filter see
  an override the way they already see a registry item.

  Unaffected: i18n bundles (`email_template`) keep every locale — the slot, and so
  the discriminator, is computed by the same function either way — and a type with
  no `metadata` service installed takes the same path it always did.

- a6cd2c1: fix(meta): `/meta/object/:name` reports the `__search` companion column, agreeing with `GET /meta/object` (#8038)

  The two `/meta` reads of an object answered the "does this object have a
  `__search` column?" question two different ways, split cleanly by PROVENANCE.
  Measured end-to-end on the showcase, booted from a compiled artifact with
  `OS_SEARCH_PINYIN_ENABLED=true` (69 objects served):

  - **22 package objects** carried the companion on `GET /meta/object` and were
    served **without** it by `GET /meta/object/:name` — all 22 of them, and by
    `?layers=true`'s `effective` layer too.
  - **45 platform objects** carried it on both routes and always had.

  (The two objects with no title-eligible field — `showcase_project_membership`
  and `sys_session` — have no companion on either route, correctly.)

  Nothing about an object caused this; where its by-name read was ANSWERED FROM
  did. The companion is provisioned at the SchemaRegistry's
  object-materialization seam, so `GET /meta/object` — composed from
  `listItems('object')` — serves a materialized body. The by-name read consults
  the `metadata` SERVICE first, and on a deployment booted from a compiled
  artifact (`artifactSource`: every sealed/served runtime, and `objectstack
serve`) that service holds the author's DECLARATION, captured before
  materialization. Platform objects are registered straight into the registry, so
  their by-name read never meets that copy and agreed all along. Which side a
  caller lands on is invisible in the response.

  This is the third thing to arrive through this exact gap, and it is fixed the
  way the second one was ruled: #7556 folded the missing `objectExtensions`, and
  #6562 ruled (maintainer, 2026-08-08, Option B) that a `/meta` object read serves
  the **effective runtime schema** and the minority path converges on the
  registry-backed majority — that is what `governServedItem` already does for the
  injected system columns (`created_at`, `owner_id`, `organization_id`). The
  companion is the same kind of thing coming through the same door, so it
  converges at the same read exits, from the same authority: the registry that
  made the provisioning decision. It is deployment-gated
  (`OS_SEARCH_PINYIN_ENABLED`, or an explicit `searchCompanion` option), and the
  gate is read off that registry rather than re-derived from the environment, so
  the pass and the decision cannot disagree.

  **This is a payload change for every consumer of these routes.** Objects served
  by the by-name read on an artifact-booted deployment now carry one additional
  hidden field declaration — `__search` (`hidden`, `system`, `readonly`,
  `searchable: false`) — where they previously did not, matching what the list
  read has always served for the same object. Nothing is removed, and the
  `?layers=true` `code` and `overlay` layers stay byte-verbatim: they are what the
  package shipped and what the tenant customised, and the convergence deliberately
  lands only on read exits and on `effective` (#6562 ruling constraint 1).

  Unrelated to #7642, which strips `__search` from RECORD bodies on the data path.
  That is row values; this is the schema description, where the companion's
  presence is the documented shape — #7561 exists precisely because `/meta`
  re-parses the served object body and the stamp had to be spec-valid there.

  **Write path.** The read adds a real field declaration, so the write path takes
  it back off again, exactly as #6562's `stripInjectedSystemColumns` does for the
  injected columns: without it the ordinary GET → edit → PUT stored the platform's
  own column as a tenant customisation. Measured on the runtime-created object
  path — the write door type `object` has open by default — the stored row went
  from `fields: [name]` to `fields: [__search, name]` on a single round-trip. The
  strip is exact: only an entry byte-identical to what the provisioning seam would
  stamp is removed, recomputed from that function rather than transcribed, so a
  body carrying anything else under that name keeps it.

- 6beb708: fix(metadata-protocol): a just-saved overlay is dispatchable immediately, not after the next listing (#4521)

  The #4432 F1 verification found that immediately after a successful
  `PUT /api/v1/meta/action/<name>`, `GET /api/v1/meta/action` already listed the
  overlay while `POST /api/v1/actions/<object>/<name>` answered the ADR-0110
  "has no declaration" 404 — and a later POST succeeded. Nothing expired in
  between: the _listing_ is what repaired it.

  The lagging cache was the engine's `SchemaRegistry`. The runtime dispatch path
  (`resolveRouteActionDeclaration`) reads it as the live view of metadata, but
  `saveMetaItem` only wrote through it for `object` — every other overlay type
  reached the registry solely via the READ-side hydration in `getMetaItems`, so
  "has anyone listed this type yet?" silently decided whether a saved action
  could be invoked.

  The fix is at the producer, per Prime Directive #12 — no retry, sleep, or
  fallback was added at the dispatch site:

  - `saveMetaItem` (publish mode), draft publishing (`runPublishSideEffects`),
    and `rollbackMetaItem` now write EVERY overlay type through the registry via
    a shared `applyRegistryWriteThrough`, so an item that is listable is
    dispatchable in the same breath.
  - The write-through and the read-side hydration share one implementation
    (`hydrateOverlayIntoRegistry`), including the ADR-0010 §3.3 protection-envelope
    graft and the ADR-0048 package-scoped artifact lookup — a read and a write
    can no longer leave the registry in two different states for the same row.
  - Unchanged boundaries: drafts still never leak into the live registry, the
    `environmentId` scoping gate matches the read side, ADR-0110's 404 for a
    genuinely absent declaration stands, and DELETE ("reset to artifact default")
    still restores the packaged artifact — the overlay is a plain-key shadow, not
    an in-place overwrite.

- d56012f: fix(metadata-protocol,spec): the plural `/meta` URL stops walking around the two-tier registry gate (#7894)

  `canonicalMetaType` — the ONE canonical spelling of a metadata type at the `/meta`
  read/write/delete boundary (#4432) — folded plural to singular through
  `PLURAL_TO_SINGULAR`. That map is a MANIFEST-COLLECTION map: its keys are the
  properties an author writes in `defineStack()` (`objects: [...]`, `apps: [...]`),
  and `kernel/metadata-authoring-lint.ts` iterates it to decide which stack-level
  collections exist.

  Four registry types are legitimately absent from it, because none of them is a
  stack collection: `field` (fields live inside `ObjectSchema.fields`), `seed`,
  `external_catalog` and `translation`. At the URL boundary that absence did not
  read as "not a collection" — it read as "unknown type", and an unknown type takes
  the PLUGIN-REGISTERED path, which every authorization gate is permissive toward by
  construction: `isRuntimeCreateAllowed` synthesises `allowRuntimeCreate: true`,
  `orgScopedWriteRefusal` returns `null` for anything with no static registry entry,
  and `SysMetadataRepository.assertAllowed` returns early.

  So, measured on a booted showcase with an admin bearer:

      PUT /api/v1/meta/field/showcase_task.title    403 NOT_OVERRIDABLE
      PUT /api/v1/meta/fields/showcase_task.title   200  "Saved fields '...'"

  The plural URL was a door around the singular URL's lock, and the row persisted
  under `type='fields'` — a second namespace for the same item, which is the defect
  class #4432 was filed about. `field` was exploitable today; `seed` and
  `external_catalog` were structurally exposed.

  **The fix splits the two roles.** A new `META_URL_TO_SINGULAR` in
  `@objectstack/spec/shared` is the URL-spelling contract, DERIVED from
  `DEFAULT_METADATA_TYPE_REGISTRY` (Prime Directive #8) and unioned with every
  existing manifest spelling, so:

  - a newly DECLARED metadata type arrives with its URL spelling already mapped and
    can never again fall through to the plugin path — hand-adding the four missing
    keys would have fixed only today's four;
  - no spelling that resolved before resolves differently now, including the six
    that name plugin-registered kinds with no registry entry at all (`themes`,
    `webhooks`, `connectors`, `sharingRules`, `ragPipelines`, `analyticsCubes`) and
    the camelCase forms (`emailTemplates`);
  - `external_catalog` and `email_template` become addressable in snake plural
    (`external_catalogs`, `email_templates`) as well as camelCase.

  `PLURAL_TO_SINGULAR` is left untouched, so the authoring lint gains no `fields:`
  collection — a top-level `fields: [...]` does not exist and would collide
  conceptually with `ObjectSchema.fields`.

  The boundary also stops forwarding a spelling it cannot honour. An unrecognised
  plural of a DECLARED type (`/meta/capabilitys`) is now refused with
  `INVALID_REQUEST` / `400`, naming both the offending spelling and the canonical
  one, instead of answering 200 and minting a namespace under the typo. The rule is
  deliberately static — it fires only when a spelling's singular is a type the
  platform itself declares — so a plugin-registered runtime kind can never trip it,
  whatever it is named and whenever it registers.

  Behaviour change to be aware of when upgrading: `PUT`/`DELETE` against
  `/meta/fields/...`, `/meta/seeds/...`, `/meta/translations/...` and
  `/meta/external_catalogs/...` are now judged by the singular type's contract —
  authorization gates AND its Zod schema. A call that previously succeeded because
  the spelling was unknown may now be correctly refused. Rows already written under
  a plural `type` are real and are not rewritten on upgrade (reads of data at rest
  already try the other spelling).

- 1a53a02: fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

  `#4447` made the audit-provenance family (`created_at`, `created_by`,
  `updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
  `applySystemFields` forces `{ readonly: true, system: true }` over a _declared_
  audit field, and `ObjectQL.update` strips a non-system caller's write to it.

  The **read** path never learned it. A `/meta` object read resolves through
  `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
  those three has been through `applySystemFields` — so an object whose built
  artifact ships a materialized `created_at` carrying FieldSchema defaults
  (`readonly: false`) reported that value to every client while writes to that
  same field were being refused. Measured before the fix, all of the read exits
  agreed with each other and disagreed with the engine:

  ```
  single  read: {"type":"datetime","label":"Created At","readonly":false}
  list    read: {"type":"datetime","label":"Created At","readonly":false}
  cached  read: {"type":"datetime","label":"Created At","readonly":false}
  layered read: {"type":"datetime","label":"Created At","readonly":false}
  ```

  One field, two answers — and the machine-readable one, the only face a client
  or an AI author writing code off `/meta` can see, was the wrong one.

  **What changes.** Every `/meta` object read exit now reports the audit family
  the way the engine enforces it. That covers the single-item read (both the
  singular and plural type spelling), the list read, the cached/ETag branch, the
  `?preview=draft` and `?state=draft` reads, and the layered read's `effective`
  layer. `GET` bodies for objects that declare an audit field will show
  `readonly: true, system: true` where they previously showed `readonly: false`
  or omitted the keys; nothing else about the document changes, and the ETag for
  such an object changes once.

  **What deliberately does not change.**

  - The layered read's `code` and `overlay` layers stay raw — showing the
    package's declaration beside the governed `effective` value is the
    diagnostic's whole point.
  - `sys_metadata` still stores exactly what the author saved; the correction is
    applied on the way out, so no phantom customization appears in the diff.
  - An object that opts out of the audit family (`systemFields: false`,
    `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
    engine enforces nothing there, so a read that claimed otherwise would be the
    same lie pointing the other way.
  - Only `readonly` and `system` are forced. Every other key an author writes —
    `label`, `description`, `hidden`, `group`, and `type` for an external object
    mapping a differently-typed remote column — stays theirs.

  The governance table moved from `packages/objectql/src/registry.ts` to
  `@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
  `applyAuditFieldGovernance` normalizer the read path applies), by the same
  criterion and for the same cycle as the `#5619` engine-dispatch predicates:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
  read path cannot import the table from the registry that enforces it, and a
  second copy would agree only until someone edited one side. `objectql`
  re-exports the symbol from its original path, so its public API is unchanged.

- 75fd301: `/meta` object reads now materialize a served base the way the registry materializes its own

  `GET /meta/object/:name` served `nameField: undefined` for an object whose by-name read is
  answered from the `metadata` service (an artifact-booted deployment), while `GET /meta/object`
  and the registry's own resolved schema served the ADR-0079 designation for the same object at
  the same moment. Every title-rendering decision derived from the by-name answer — forms, record
  headers, lookup labels — was made against a document the platform itself did not agree with.

  The cause was structural rather than specific to `nameField`. A `/meta` object read resolves
  `sys_metadata` overlay to MetadataService to SchemaRegistry, and only the last of those three has
  been through the registry's object-materialization seam; each convergence installed at the read
  exits so far reached for ONE named stamp, so each further stamp arrived as a further bug report
  (injected system columns, then the `__search` companion, then this).

  `SchemaRegistry.registerObject`'s materialization block is now a single method, and
  `materializeServedObjectOnto` replays that same code onto a body that never came through
  `registerObject`. The `/meta` read exits ask for the whole seam instead of naming one stamp, so a
  stamp added to the block converges on served documents the day it is added. The convergence
  withholds a title designation the registry itself declined, so it can only move a served copy onto
  the registry's answer and never manufacture one.

- 1c625ca: metadata: `getDiagnosed` — a metadata read that FAILED stops arriving as "nobody declared this"

  `MetadataManager.loadDiagnosed` computes the ADR-0110 D3 verdict (a MISS and an OUTAGE
  are different facts with opposite security meanings) and `get()` discarded it two hops
  later: `load()` kept only `.data`, `get()` turned that `null` into `undefined`. Every
  consumer of `get()` therefore received one `undefined` for two opposite facts and could
  not have told them apart even if it had wanted to.

  **New read.** `MetadataManager.getDiagnosed(type, name)` returns
  `{ data, degraded, errors }` — the registry-first counterpart of `loadDiagnosed`, declared
  as an optional member of `IMetadataService`. A registry hit is never degraded (it
  consulted no loader); a clean miss is never degraded (every loader answered).

  **`get()` is unchanged — zero breaking.** Same signature, same answer, same behaviour for
  every existing caller, including the microtask-level ordering `register()`'s watchers
  depend on. Only callers that ASK for the verdict pay for it. Making `get()` throw on
  `degraded` was deliberately not done: the boot path degrades on purpose.

  **Consumers switched**, each with a disposition argued for its own context rather than one
  blanket rule:

  - `getMetaItem` / `getMetaItemCached` — a degraded MetadataService read with nothing in
    the registry now raises `503 SERVICE_UNAVAILABLE` instead of falling through to
    `404 RESOURCE_NOT_FOUND`. This is the half that made the existing `#5532` comment ("
    reaching here now means a real miss") untrue.
  - `getMetaItemLayered` — the `code` layer joins the rule its `overlay` layer already
    followed. `code: null` is a positive claim, and `lockSource = code ?? overlay ?? {}`
    derives from it, so an outage could render an item the packager locked
    (`_lock: 'full'`) as `editable: true, deletable: true`.
  - `ObjectQLPlugin`'s `object` metadata-event refresh — logs `warn` naming the consequence
    (the registry keeps the previous definition; nothing retries) and the fix, instead of
    `debug` "metadata service has no fresh body". `warn` and not `error` because the write
    already landed; only a re-read failed.

  Hosts whose `metadata` slot is a shim that predates `getDiagnosed` are read as
  "not degraded" — exactly what they could express before — so their behaviour is unchanged.

- c2c67bf: Stop putting a raw driver `code` on the batch verbs' `failed[]` (#8441).

  #8333 closed the `error` **string** on these payloads and deliberately left the
  sibling `code` limb alone — a different field with a different rule. Measured
  afterwards, on the fixed branch, `publishPackageDrafts` still answered
  `{ error: 'publish failed', code: 'SQLITE_ERROR' }`: the sentence withheld and
  the driver's own dialect still shipping beside it. `revertCommit` measured the
  same. Both ride response DATA, so no HTTP boundary's withhold reaches them, and
  `code` is a field clients branch on.

  `code` writes `ApiErrorSchema.code`, a **closed union** (ADR-0112 D4), so the
  rule here is catalog membership — `StandardErrorCode ∪ ERROR_CODE_LEDGER`, the
  same predicate `carryCatalogedErrorCode` and `toRowApiError` already apply —
  and **not** the 4xx question #8333 asks of the message. A catalogued code now
  passes through byte for byte; an uncatalogued one is replaced by the code its
  declared status maps to, or `INTERNAL_ERROR` when it declared none. No new error
  code was minted, and an error carrying no code still produces no `code` key.

  Nothing a caller branches on is lost: `BATCH_ABORTED` on the collateral rows,
  the repository's `VERSION_NOT_FOUND` / `NOT_OVERRIDABLE` / `ITEM_LOCKED`, and a
  ledger-registered engine code such as `ERR_DATASOURCE_UNAVAILABLE` all survive —
  the last one on a 503 whose sentence is withheld, which is exactly the case that
  shows the two limbs answer different questions about the same error. The Studio
  publish surface still highlights the offending field of a rejected draft from
  `INVALID_METADATA` plus its structured `issues`.

  `discardPackageDrafts` and `deletePackage` build the same limb and needed no
  filter: both wrap `deleteMetaItem`, whose re-wrap exits already gate `code`
  through the catalog, so no driver dialect survives to them. That is measured and
  pinned rather than assumed.

- f58b1a8: Stop putting caught driver text on the batch verbs' response payloads (#8333).

  `publishPackageDrafts`, the publish side effects and their materializer, the seed
  apply, `duplicatePackage`, `revertCommit`, `rollbackToPackageCommit` and
  `migrateStoredMetadata` each reported a failure by copying the caught error's
  sentence onto a field of the response — `failed[].error`, `materializeApplied`'s
  `failures[].error`, `seedApplied.error`, `rows[].reason`. Those are DATA, not
  messages, so no HTTP boundary's 5xx message withhold ever reached them: a
  `sys_metadata` outage shipped `SQLITE_ERROR: no such table: sys_metadata` to the
  client on an otherwise successful-looking response.

  All eight now follow the rule #8136 installed for the uninstall cluster: a caught
  sentence is quoted back only when that error **declared itself a client-facing
  refusal** (a 4xx `status` in the ADR-0112 envelope). Anything else gets a stable
  sentence and the original goes to the server log, which these sites did not
  previously write at all.

  Authoring feedback is unaffected, and that was measured before anything changed
  rather than assumed. Every authored refusal reaching these collectors already
  declares 4xx, so it is still quoted verbatim — a failed package publish still
  tells the author which field of which draft is wrong, with its `code` and
  structured `issues` intact.

  One producer needed declaring rather than converting: `applySeedBodies` parsed
  the seed request with `SeedLoaderRequestSchema.parse()`, so a malformed seed body
  surfaced as a raw `ZodError` that declared nothing. It is now a `safeParse` that
  raises a real `422 INVALID_METADATA` envelope, so `seedApplied.error` carries the
  same curated, path-pointing summary every other authoring surface produces
  instead of a multi-line dump of zod internals.

- 5905d7f: fix(metadata-protocol): stop interpolating raw driver text into client-facing messages (#8136)

  Option C of #8086, at the producer. `packages/metadata-protocol` interpolated
  raw driver/engine error text into messages and response payloads that reach API
  clients. Measured on the uninstall path: `DELETE /api/v1/packages/:id` answered
  `500 INTERNAL_ERROR` with the body message `SQLITE_ERROR: no such table:
sys_metadata` — a physical table name on the wire.

  Three downstream sanitizers already existed for this class, and each had a hole
  traceable to the producer. Two of those holes are structural, not accidental:

  - The boundary belts run `looksLikeInternalErrorLeak`, a **heuristic over the
    message**. It now knows the two dialects this repo runs (#8132 / #8263), but a
    phrasing test can only ever know the dialects someone has met — MySQL, MSSQL
    and Oracle each phrase "this table is missing" differently again, and all
    three are measured invisible to it.
  - `deletePackage`'s per-item `failed[]` and `cleanups[]` ride onto a
    `PACKAGE_DELETE_PARTIAL` **400** inside `details`. That is data, not a
    message, so no 5xx message withhold at any HTTP boundary ever sees it.

  **The rule, now stated once at the producer.** A caught error's sentence is
  quoted back to a caller only when that error **declared itself a client-facing
  refusal** — a 4xx `status` in the ADR-0112 envelope. Anything undeclared (a bare
  `Error` from a driver) or declared a server fault gets a stable sentence naming
  the operation that failed, and the original error rides on `cause` so the
  operator's log still receives it whole. This is a positive list rather than a
  negative heuristic, so a dialect nobody here has run is handled correctly by
  default.

  Behaviour changes visible to an API client, all on failure paths:

  - A driver failure on the uninstall's `sys_metadata` read is now refused with the
    declared envelope this package already uses for that exact condition —
    **503 `SERVICE_UNAVAILABLE`** with the "metadata store could not be read"
    sentence — instead of an undeclared 500 carrying the driver's own text. It
    remains a failure: an unreachable store is never reported as an uninstall that
    removed nothing.
  - `deleteMetaItem`'s two failure exits keep the `Failed to delete customization
overlay` prefix and their existing `status`, but no longer append the driver's
    message.
  - `deletePackage`'s `cleanups[].error` reports `cleanup failed` for a cleanup
    that failed without declaring a refusal.

  Self-correcting refusals are deliberately untouched: `[item_locked]`,
  `[writable_package_required]`, `[no_draft]`, `[tenant_scope_required]` and the
  rest declare a 4xx and still reach the caller verbatim, including inside
  `failed[]` on a partial uninstall.

- d08ba50: Stop putting raw driver text on the seed loader's `errors[].message` (#8442).

  #8333 closed the `error` **string** on `applySeedBodies`, but the same response
  object carries a second channel the seed loader fills itself. Measured on
  current `main`, a `sys_metadata` outage under a seed write still answered
  `"Failed to write acct record #0 (name=acme): SQLITE_ERROR: no such table:
sys_metadata"` — and `seedApplied` rides a **200** publish response, so no HTTP
  boundary's message withhold reaches it.

  `errors[].message` is free text, so #8441's catalog-membership rule (which
  governs `code`, a closed union) does not apply: this is #8333's question — did
  the producer AUTHOR this sentence for a caller? But #8333's **answer**, a
  numeric 4xx `status`, is insufficient at this producer, because this sink
  receives a population `protocol.ts`'s collectors never see: the data engine's
  **validation layer**. An `@objectstack/objectql` `ValidationError` carries
  `code: 'VALIDATION_FAILED'` and deliberately **no** `status` — deciding it means
  400 is "the job of whichever boundary serves it", and for the seed channel this
  loader is that boundary. So a caught sentence is quoted when the error declared
  itself a client refusal by **either** shape: a 4xx `status`, or the
  `VALIDATION_FAILED` shape that `@objectstack/types`' `validationFailureDetails`
  already recognises (imported, not re-spelled). Everything else is replaced by a
  stable line and goes to the log instead.

  That distinction is the whole fix rather than a nuance. On this producer the
  structured keys do **not** carry the offending field: `field` is the literal
  `'(write)'` and `targetField`/`attemptedValue` name the record's external key,
  so "which key was rejected and why" exists only inside the validation sentence.
  Applying the 4xx test alone would have blanked exactly the per-record authoring
  feedback `errors[]` exists for — trading an authoring surface for a disclosure,
  the trade #8441 refused.

  Nothing an author needs is lost. Every structured key is untouched (they are
  built from the seed declaration and the record, never from the caught error),
  the authored prefix is unchanged byte for byte, and a real malformed seed record
  still reports which record and which key — pinned through the **real** ObjectQL
  validator, not a hand-built error. The withheld driver line still reaches
  `logger.error`, marked as withheld from the response, so the operator half of
  the diagnostic is intact.

  Both payload producers are covered: the pass-1 record write and the pass-2
  deferred-reference back-fill. The loader's authored messages (unresolved
  references, dropped references, dynamic-value failures) never quoted a driver
  and are unchanged.

- ebf7d98: fix(metadata-protocol): the metadata write refusal reports the package door — `ITEM_LOCKED` / `WRITABLE_PACKAGE_REQUIRED` are emitted where they apply (#7682)

  `PUT /api/v1/meta/object/showcase_task` answered `403 NOT_OVERRIDABLE`
  ("'object' is not allowOrgOverride in the registry") — the **same** code, status
  and sentence whether `?package=` pointed at a **read-only** package or a
  **writable** one. The refusal discriminated on the metadata TYPE's registry
  flags and never read the base the caller named, so the two codes the error-code
  ledger registers to this package for the package-writability condition —
  `ITEM_LOCKED` and `WRITABLE_PACKAGE_REQUIRED` — were never emitted on this path
  at all. Declared, not enforced.

  `SysMetadataRepository.assertAllowed` now reads the named base through the
  shared `isWritablePackage` predicate (the same one `saveMetaItem`'s ADR-0070 D1
  gate and the `/packages` lifecycle gate use — imported, not re-spelled), and a
  refused write that named a read-only base says so:

  - **`override-artifact`** (an artifact backs the name, and it ships from a
    package the deployment provides) → `403 ITEM_LOCKED`, carrying
    `lockSource: 'package'` — ADR-0010's own reserved value for a lock the package
    layer asserts — plus the package id. `WRITABLE_PACKAGE_REQUIRED` would be the
    wrong prescription here: switching bases cannot help, because the artifact is
    code-shipped wherever the caller points. This is the server-side counterpart
    of the "Read-only" badge Studio already renders.
  - **`runtime-only`** (no artifact under this name — a NEW item authored into a
    read-only base) → `422 WRITABLE_PACKAGE_REQUIRED` with the package id, the
    same code, status and prescription `saveMetaItem` already emits for exactly
    this condition. One vocabulary, now stated at the single persistence route as
    well, so callers that do not pass through that gate cannot skip it.

  **No allow decision moves.** Every write that succeeded before still succeeds:
  this is the code selection inside the refusal branch, not a new gate. That
  distinction is load-bearing rather than cautious — an ADR-0005 org overlay names
  the read-only package it customizes _by construction_, so a package door that
  refused would close the overlay model itself. Writes that name no base keep the
  previous `NOT_OVERRIDABLE` / `NOT_CREATABLE` codes verbatim, and the DELETE verb
  is unchanged (#6960 moved that side on purpose; `DeleteOptions` names no
  package).

  The `OS_METADATA_WRITABLE` hatch is likewise untouched — structurally, because
  its limb returns before the new door — and is deliberately left **uncovered** by
  this change's tests, which the suite docblock records so the gap reads as a
  decision. The maintainer ruling of 2026-08-12 on #8146 holds that a hatch write
  into a read-only package should REFUSE, so a test of today's answer would be
  green _because the bug is present_; #8146 ships the refusal and its own
  rejection pin (`code` + `status`) together.

  Re-measured on current `main` while this was in flight, and carried here because
  it is new evidence for that decision: the hatch write still succeeds, and the row
  lands bound **into** the read-only package (`package_id = com.example.showcase`,
  `organization_id = null`) rather than as the per-org override the variable's own
  documentation describes ("treats them as `allowOrgOverride: true`" — a
  _type_-level unlock, which says nothing about the package dimension).

  Reachability, stated so it is not mistaken for more than it is: this refusal is
  what answers on the host-config topology (`environmentId` undefined — the CLI's
  lightweight assembler, i.e. the flagship showcase and self-hosted servers shaped
  like it), which is the topology the defect was measured on. On a scoped kernel
  `saveMetaItem` refuses earlier, in `protocol.ts`, still with the undiscriminated
  `NOT_OVERRIDABLE`; that second refusal point is filed separately.

- e6db317: fix(metadata-protocol): 元数据存储读不到不再被讲成「这一项不存在」(#5532)

  `sys_metadata` 整体不可达时,`GET /api/v1/meta/object/acct` 会回一个「不存在」——
  真相是「读不到」。两个事实的处置方向完全相反(去建一个 / 去修后端),而 Studio、
  Setup 在元数据库故障期就是照前者渲染的:每一个对象都显示成「不存在」。

  根因在产出方:`getMetaItems` / `getMetaItem` 的四处 customization-overlay 读各自
  裹着一个裸 `catch {}`,注释写着 "DB not available" 然后照 miss 处理。空值一路穿过
  读链,每个消费方给它起了一个不同却同样错的名字:

  - `getMetaItemCached` → `Metadata item <type>/<name> not found`
  - `?state=draft` → `NO_DRAFT` / 404「没有待发布的草稿」(发布流程读作「没什么可发的」)
  - `getMetaItems` → `items: []`「这个环境一个都没声明」

  ADR-0110 D3 已经为这件事立过规矩:miss 与 outage 是两个不同的事实、安全含义相反。
  #5108 按这条修掉了 `DatabaseLoader` 的复数读,#5089 修掉了 `listForIndex`;本次是
  同一条规矩在协议自己的 overlay 读上,单数与复数一并覆盖。

  **改了什么**

  1. **区分按错误类型判定,不按异常猜。** 唯一良性的读失败是「`sys_metadata` 还没被
     创建」——那时确实没有 overlay 行,落回 registry 就是真相,首次启动也不该爆炸。
     判定走 `isMissingTableError`,与 `DatabaseLoader`(#5108)、本包
     `SysMetadataRepository`(#4867)同一个谓词,一个驱动怪癖只教给平台一次。其余
     一律视为故障。
  2. **故障照实上报。** 上抛 `status: 503` / `code: SERVICE_UNAVAILABLE`
     (`HttpStatusErrorCodeMap[503]`,ADR-0112 的标准目录码,不新造词汇),驱动原始
     错误挂在 `cause` 上。REST 层现有的 #5437 / #5464 消毒与日志口原样接住:客户端拿
     到 503 + code(文案按 5xx 规则 withheld),运维在日志里拿到完整的驱动报文。
  3. **终末 not found 结构化。** 真 miss 现在带 `status: 404` /
     `code: RESOURCE_NOT_FOUND`。

  **wire 可见变化**(把错误答案改成对的答案):

  | 场景             | 之前                                                            | 之后                                 |
  | ---------------- | --------------------------------------------------------------- | ------------------------------------ |
  | 元数据存储不可达 | `404`/`400`/`500` 说「不存在」「没有草稿」「什么都没声明」      | `503` + `SERVICE_UNAVAILABLE`,可重试 |
  | 真的没有这一项   | `500` + `INTERNAL_ERROR`(#5489 之前是 `400` 且内部措辞逐字上线) | `404` + `RESOURCE_NOT_FOUND`         |

  `sys_metadata` 尚未建表这一路径行为不变:仍旧落回 registry / MetadataService,
  真查不到时回结构化 404。

- 7f02367: fix(metadata-protocol): `OS_METADATA_WRITABLE` no longer unlocks a write into a read-only package (#8146)

  With the documented operator hatch set, `PUT /api/v1/meta/permission/showcase_contributor?package=com.example.showcase`
  answered **200** against `com.example.showcase` — a **read-only** package — while
  Studio rendered that same permission matrix fully disabled behind a "Read-only"
  badge. Two surfaces answered the same question differently, and the row landed
  `{ package_id: 'com.example.showcase', organization_id: null }`: bound _into_ the
  package the deployment ships.

  **Maintainer ruling, 2026-08-12 (option B): the badge is telling the truth and
  the server should refuse.** The hatch is a **metadata-type-level** unlock by its
  own shipped documentation — `content/docs/deployment/environment-variables.mdx`
  defines it as treating named types "as `allowOrgOverride: true` … overridden
  per-org", and this package's CHANGELOG records that it "deliberately does not
  unlock the org dimension". A type-level unlock says nothing about the **package**
  dimension, so the 200 was a bug rather than a policy choice.

  The package door now sits **above** the hatch limb and **below** every registry
  limb in `SysMetadataRepository.assertAllowed`. A hatch write that **names** a
  read-only base is refused with the codes the error-code ledger already registers
  for the package-writability condition:

  - **`override-artifact`** → `403 ITEM_LOCKED`, carrying `lockSource: 'package'`
    and the package id — the server-side counterpart of Studio's badge.
  - **`runtime-only`** → `422 WRITABLE_PACKAGE_REQUIRED`, the same code and
    prescription `saveMetaItem` already emits for ADR-0070 D1.

  **What deliberately keeps working — the hatch is narrowed, not retired.** Only a
  write that _names_ a read-only base is refused. Verified by measurement before
  the change was written, and pinned as tests:

  - a **package-less** hatch write still lands the env-wide overlay
    (`{ package_id: null, organization_id: null }`);
  - under an org kernel it still lands the **per-org override** the variable's
    documentation promises (`{ package_id: null, organization_id: <org> }`);
  - a hatch write naming a **writable** base still lands;
  - an **ADR-0005 org overlay** of a code-shipped item is untouched — it names the
    read-only package it customizes by construction and returns at the registry
    limb, above the door.

  No documentation changes and no capability is retired.

  **The refusal no longer prescribes the step the caller already took.** When the
  hatch is open, the `ITEM_LOCKED` message states that `OS_METADATA_WRITABLE`
  unlocks the type and not package writability, and points at the remedy that
  actually works (retry without `?package=`). The previous sentence — "set
  `OS_METADATA_WRITABLE=<type>`" — would otherwise be emitted _while that variable
  is set_, which is the shape that makes an automated client retry forever. With
  the hatch closed, that sentence is still offered, because then it is true.

  **Known boundary (#8184, not fixed here):** on a scoped kernel
  (`environmentId !== undefined`) `saveMetaItem` refuses earlier, in `protocol.ts`,
  with the undiscriminated `NOT_OVERRIDABLE`, so this refusal is not reachable on
  that topology. Not a regression — that branch answered `NOT_OVERRIDABLE` before
  this change too.

- e3c8ed0: fix(metadata-protocol): an object extension reaches the by-name `/meta` read, not just the list (#7556)

  **Behaviour change, and it is a payload gaining fields.** `GET /meta/object/:name`
  (and `?layers=true`, and the cached/compound spellings that delegate to the same
  read) now serve an object's RESOLVED schema — the base layer with its
  `objectExtensions` contributors folded on — where they previously served the base
  layer alone. Any consumer of that route sees the extension's fields appear.
  Deployments with no `objectExtensions` see a byte-identical payload; the fold is
  applied only to a name something actually extends.

  Levels: `metadata-protocol` is `patch` — it restores the contract the route was
  already specified to answer (`GET /meta/object` and the data plane both already
  resolved the same way, and the divergence was the defect). `objectql` is `minor`
  because it gains one additive public API, `SchemaRegistry.foldObjectExtendersOnto`.

  The defect: `GET /meta/object` composes its objects from
  `SchemaRegistry.listItems('object')`, whose object branch resolves through
  `resolveObject` — a base layer with its `extend` contributors folded on (ADR-0029
  D9.2). The by-name read consults the `metadata` SERVICE first, because that copy
  is the HMR-fresh one, and served whatever it returned. For every other metadata
  type the two agree. For `object` they did not: a deployment booted from a
  compiled artifact (`artifactSource` — `objectstack serve`, sealed runtimes, the
  cloud) ingests `objects` and `objectExtensions` as SEPARATE collections, so the
  service's copy is the owner's declaration with no extender in it. An in-process
  dev boot happened to be immune, because ObjectQL's
  `bridgeObjectsToMetadataService` seeds that service from `registry.getAllObjects()`
  — bodies that are already folded — which is why this survived so long.

  Measured on the showcase, whose account extension contributes three fields: they
  were served by the list read and persisted through the data API round-trip, and
  were absent from the by-name read and from BOTH layers of `?layers=true`. Not
  cosmetic — the edit and new forms derive from the by-name response, so three
  fields that a client could read and write through the API could never be set in
  the UI.

  The fix folds the registry's `extend` contributors onto the MetadataService body
  at the two places that adopt one: the by-name read and the `code` layer of the
  layered view (`effective` is `overlay ?? code`, so an object with no tenant
  overlay is corrected on both layers by that single fold). The fold itself is the
  registry's own — `foldObjectExtendersOnto` reuses the same private fold
  `resolveObject` and `resolveOwnerLayer` apply, rather than growing a second copy
  that could drift. The `overlay` layer is deliberately left alone: it reports what
  a tenant customised, and a code-declared extension is not that.

  Pinned as AGREEMENT rather than presence, in
  `packages/rest/src/meta-object-extension-agreement.test.ts`: the by-name read and
  the list read are both measured off real handlers over a real protocol over a
  real registry, across four hosts that genuinely differ (artifact-ingested,
  bridged in-process, no metadata service, and an object nothing extends), plus an
  anti-vacuity case pinning that those hosts ARE discriminated. Asserting "the
  route returns the extension fields" would pass again the day someone
  special-cased that route, which is the same defect one layer over. The
  end-to-end proof on a real showcase over real HTTP is
  `packages/qa/dogfood/test/showcase-object-extension-meta-read.dogfood.test.ts`,
  which boots the artifact path on purpose — the shared in-process harness cannot
  see this bug.

- fa6dd59: fix(metadata-protocol): an object's overlay row is a base layer, not its resolved schema (#8027)

  **Behaviour change, and it is a payload gaining fields.** When a `sys_metadata`
  overlay row exists for an object, `GET /meta/object/:name`, `GET /meta/object`
  and the `effective` layer of `?layers=true` now serve that object's RESOLVED
  schema — the overlay row as the base layer with its `objectExtensions`
  contributors folded on (ADR-0029 D9.2) — where they previously served the stored
  row verbatim. Any consumer of those routes sees the extension's fields appear on
  customised objects. An object with no overlay row, and an object nothing
  extends, are byte-identical (measured; see below).

  **A second payload change, in the other direction:** on an in-process
  (`bridged`) boot the by-name read and the `code` layer previously served every
  extender-contributed `validation` and `index` TWICE. That duplication is
  removed. It was a live regression introduced by #7556 (PR #8015) and is
  explained under "the fold is not idempotent" below.

  The defect: an overlay row for an object — an admin renaming the object's label
  in Studio — was adopted as the resolved schema. `getMetaItem` took the stored row
  as `item` and returned it; `getMetaItems` did the same through
  `mergePackageAwareOverlay`, which picks a per-slot winner WHOLESALE rather than
  merging fields; and `getMetaItemLayered`'s `effective` is `overlay ?? code`, so
  it inherited the same body. D9.2 defines the resolution as `overlay ?? own` with
  the `extend` contributors folded ON, which is exactly what
  `SchemaRegistry.resolveObject` does for an overlay it knows about, and what
  #7556 made the by-name read do for the MetadataService copy. The `sys_metadata`
  path was the one adopter that never folded.

  Measured with one `extend` contributor (three fields) and one env-wide overlay
  row: `byName` and `listed` both served the object with NO extension fields,
  while `layers.code` served them (#7556 folds it) and `layers.effective` did not
  — so a single `?layers=true` response reported a `code` layer that has the
  fields and an `effective` layer that does not, with an `overlay` layer showing a
  customisation that explained none of the difference. The practical cost is the
  #7556 shape again: an admin who customises a label silently removes three
  extension-contributed fields from every writable form, while the data API keeps
  accepting and persisting them.

  **The fold is not idempotent, and that is the hazard this fix had to clear
  rather than assume away.** `mergeObjectDefinitions` CONCATENATES `validations`
  and `indexes` (`fields` is a key-keyed spread and the scalar props are
  last-writer-wins, so those were always safe), so folding a body that has already
  been through the fold duplicates both — and a duplicated index does not fail a
  test, it fails a deployment. The precondition #7556 documented ("callers must
  apply this only to a base that has not been through the fold") turned out to be
  one no caller can honour, and two shipped call sites already violated it:

  1. **The MetadataService body on an in-process boot.** ObjectQL's
     `bridgeObjectsToMetadataService` seeds that service from
     `registry.getAllObjects()` — bodies that are already resolved — so #7556's
     fold ran on a folded base and served every extender validation and index
     twice. Its own pin could not see this: it compares FIELD NAMES, and the field
     spread is idempotent.
  2. **A stored overlay row.** The write path persists the request body verbatim
     (ADR-0005 §Validation), so the ordinary Studio GET → edit → PUT round-trip
     stores whatever the read served — and since #7556 that read is folded. The
     row is _defined_ by D9.2 as the base layer, but nothing enforces it, and
     seeded / imported / migrated / pre-existing rows are unconstrained besides.

  So `SchemaRegistry.foldObjectExtendersOnto` was made IDEMPOTENT instead of
  documented harder: an entry the `extend` contributors are about to add, already
  present in the base, is removed first and then re-added by the fold exactly
  once. Extenders are still concatenated against each other — two contributors
  declaring an identical rule still yield two, matching `resolveObject` — so
  nothing the fold did on an unfolded base is narrowed, and such a base is
  returned by reference, byte-identical.

  Levels: `metadata-protocol` is `patch` — it restores the contract these routes
  were already specified to answer, and it is the same reasoning #7556 used for
  the same routes. `objectql` is `patch` — no new public API (`foldObjectExtendersOnto`
  already exists since #7556); its documented contract moves from "not idempotent,
  callers must guarantee an unfolded base" to "idempotent", which is a defect fix
  rather than a capability, and no caller can be relying on duplicated validations.

  Pinned against the REGISTRY'S RESOLVED SCHEMA, in
  `packages/rest/src/meta-object-overlay-extension-fold.test.ts`, deliberately not
  as agreement between the two routes: #7556's `byName === listed` pin is green
  throughout this defect, because here both routes agree — on a body that has
  already lost the fields. Its author said so explicitly rather than let the pin
  imply coverage it did not have. Eight cases over real handlers / real protocol /
  real registry: the overlay case on both routes and on `layers.effective`; `code`
  and `effective` agreeing when the row customises nothing; `layers.overlay` still
  reporting only what the tenant stored (an extension is not a tenant
  customisation — the boundary #7556 drew); an already-folded row and a bridged
  host holding the idempotency; the no-overlay and no-extension controls; and an
  anti-vacuity case pinning that the fixtures ARE discriminated.

  Byte-identity measured directly, by dumping all three surfaces for nine hosts
  under this branch and under the pre-fix behaviour: 8 of 9 identical. The one that
  differs is the extended object on a `bridged` host, where the pre-fix payload
  carries `['owner_rule','ext_rule','ext_rule']` / `['owner_idx','ext_idx','ext_idx']`
  and this branch carries each once — the #7556 regression, repaired.

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

- 7e1b480: fix(metadata-protocol): 删除回执不再对 runtime-only 项谎称"已重置为 artifact 默认值"

  `deleteMetaItem` 的四句成功回执(repository 路径两句 + legacy raw-engine 路径两
  句)原本无条件把每一次删除都叙述成"摘掉一层 overlay、回落到 artifact 默认值"。
  但对一个 **runtime-only** 项 —— 管理员在 Studio 里新建的 `object` / `flow` /
  `hook`,没有任何 code package 提供同名 artifact —— 底下根本没有默认值可回落:那
  一行就是这个项的全部,删掉之后它在任何层都不复存在。回执却把管理员指向一个从未
  存在过的基线。

  判据与 #5265 / PR #5926 在 save 侧用的是同一个:`isArtifactBacked` —— 也就是
  `intent: 'override-artifact' | 'runtime-only'` 的来源,本方法内早已算出。新增的
  方法级绑定**替换**了 `intent` 原来的那次 inline 调用,所以分句后 registry 读取次
  数不增反减。

  |                                     | FROM                                                                         | TO                                                       |
  | :---------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------- |
  | 覆盖了 artifact,删除即回落          | `Customization overlay deleted — <t>/<n> reset to artifact default. [seq=N]` | 逐字不变                                                 |
  | runtime-only,删除即消失             | 同上                                                                         | `Deleted <type> '<name>' — it no longer exists. [seq=N]` |
  | 覆盖了 artifact,本就没有 overlay 行 | `No customization overlay found for <t>/<n> — already at artifact default.`  | 逐字不变                                                 |
  | runtime-only,本就不存在             | 同上                                                                         | `No <type> '<name>' found — nothing to delete.`          |

  `success` / `reset` / `seq` 三个字段一字未动 —— `message` 没有任何消费方解析,仅
  作展示。草稿两句(`Draft discarded — …` / `No pending draft for …`)本来就没有声
  称过 overlay 或 reset,对两类项都为真,故逐字保留。legacy raw-engine 路径不写
  history、不发 watch 事件,两句因此本就不带 `[seq=…]`,该差异为既有设计,分句未
  触碰。

- 69b509f: fix(metadata-protocol): 元数据审计历史与全局搜索按 `order` 排序,不再按 `direction` (#4674)

  `protocol.ts` 里两处内部 `engine.find` 调用把排序写成 `{ field, direction: 'desc' }`。QueryAST 的排序形状是 `SortNodeSchema` = `{ field, order }`,两个真实驱动都只认 `.order` 且没有 `direction` 回退——`undefined === 'desc'` 为假,于是两个查询实际都在**升序**运行。`direction` 是 `IReportService` 的词汇,是另一份契约,这正是错误拼写看起来合理的原因。

  由于两个查询都带 `limit`,方向错误不只是把一页重排,而是**改变了哪些行会被返回**:

  - **元数据审计历史**取到的是最旧的 `limit` 条事件——一个对象生命的开头,而永远不是它最近的变更。在长期存在的对象上,编辑者要找的东西一条也看不到。
  - **全局搜索**取到的是最陈旧的 `perObject` 条匹配,最近编辑过的记录恰好被 `limit` 截断掉——而那正是搜索者最可能想要的。

  两处的 `as any` / `: any` 一并去掉:`EngineQueryOptions.orderBy` 是 `SortNodeSchema[]`,本来就会拒绝 `direction`,而类型擦除正是让它溜过去的原因。恢复类型是这次改动价值的大头,因为对内部调用方来说 `tsc` 就是那条被执行的渠道。

- 725c7b0: fix(metadata-protocol): an org-scoped metadata DELETE no longer evicts the env-wide registry entry (#6780)

  `restoreArtifactRegistryView` — the three-tier heal that repairs the in-memory
  `SchemaRegistry` after an overlay-row delete — was `(type, name)`-addressed and
  org-blind. Every tier writes the PLAIN key (`removeRuntimeShadow` drops it, the
  layer-2 re-register rewrites it, `removeOverlayEntry` retires it), and per
  ADR-0005 that one plain-key entry belongs to the **env-wide** row: an org-scoped
  overlay never enters the process-wide registry at all (#6602). `deleteMetaItem`
  called the heal on all three of its paths without passing the delete's own
  scope, so org A resetting **its own** customization reached in and evicted the
  entry every other org and the control plane read.

  Measured before the fix on an unscoped (control-plane) kernel — the shape #5086
  found the flagship showcase booting with:

  ```
  after env-wide save   : "Env grid"
  after org A save      : "Env grid"     # #6602 holding — the org row stays out
  delete receipt (org A) : { success: true, reset: true, … }
  after org A DELETE    : undefined      # the eviction
  rows left             : [{ name: "shared_grid", org: null, state: "active" }, …]
  ```

  The env-wide row is still in `sys_metadata`; only its registry entry is gone.
  While it is gone, direct registry readers answer as if the item does not exist
  — ADR-0110 D3's declaration gate, `resolveRouteActionDeclaration`, and
  fail-closed `assertObjectRegistered` (404). One tenant's "reset my
  customization" therefore degraded every other tenant's runtime until restart.
  The no-row **self-heal** branch was the cheaper door still: an org that had
  never customized anything could evict the entry with a single no-op DELETE
  (`reset: false`, "nothing to delete") — so a gate on the delete-ful branch
  alone would have left it open.

  The scope verdict now lives INSIDE the helper as a **required**
  `organizationId` parameter — the `hydrateOverlayIntoRegistry` shape #6602 used
  on the register side — rather than as a test repeated at each call site. There
  are four call sites, not the two the report named: `deleteMetaItem` has three
  (self-heal, post-`repo.delete`, legacy raw-engine path) and `revertCommit` one.
  A required parameter makes the next caller answer at compile time; an optional
  one would default an omission back to "env-wide" and reinstate the hole. PR
  #6807's call-site gate on the revert limb is now redundant-not-contradictory
  and was folded into the argument it passes — its pin still covers the batch
  path, and it goes red if the gate is ever removed.

  **Register wide, retire narrow.** The write-through's `object` carve-out stays
  un-org-gated and deliberately does not transfer to removal: it rests on
  `assertObjectRegistered` failing CLOSED, so a surplus entry degrades to
  "listable but rowless" and the next reload heals it, whereas a wrongly retired
  entry 404s data CRUD for every tenant.

  Unchanged: row-level delete behaviour (an org-scoped delete still removes the
  org row, and the org's next read falls through to the env-wide body); the
  env-wide delete's full three-tier walk (#6687 tier 1 un-shadowing, #5079 tier 3
  retirement); and the kernel-scope gate, which still guards re-registration
  only because that is a fact about the kernel, not about the row.

- 4bb6f01: fix(metadata-protocol): an org-scoped overlay row no longer reaches the process-wide SchemaRegistry (#6602)

  ADR-0005 (revised 2026-05) says only **env-wide** rows (`organization_id IS NULL`)
  enter the process-wide `SchemaRegistry`; per-org overlays are served on demand and
  never grafted into the registry every org in the process shares. The registry has
  exactly one plain key per `(type, name)` and no org dimension to hold two orgs'
  bodies apart, so a per-org body sitting under that key IS the other orgs' body.

  Boot obeyed the rule — `loadMetaFromDb` filters `organization_id: null` and says so
  in its own comment. Both **runtime** seams did not:

  - **The write-through.** `applyRegistryWriteThrough` gated on `environmentId` alone.
    Its TSDoc already claimed the rule ("a project-scoped row must not be registered
    into a registry that unscoped callers share. The write must not be more permissive
    about that than the read is") while the code said nothing about `organization_id`.
    On an unscoped kernel a per-org `view` write hydrated straight into the registry
    under the plain key.
  - **The read hydration.** `getMetaItems` merges this caller's org rows into the
    env-wide set and then hydrated the whole merged set under the same
    `environmentId === undefined` gate — so one org-scoped listing call grafted that
    org's bodies too, and would have undone a write-side-only fix at the next listing.

  Both were observable rather than theoretical: once org A's body sat under the plain
  key, org B's listing started from org A's body, and where the names did not collide
  org A's item was simply **in** org B's list. Per #5086 a host config boots
  `new ObjectQLPlugin()` with no `environmentId`, so the flagship showcase runs on
  exactly this kernel shape.

  **The fix restores the stated invariant at both seams at once, in one place.**
  `hydrateOverlayIntoRegistry` is the single choke point all three hydration callers
  (boot, read-side, write-through) already route through since #4521, so the row-scope
  verdict now lives there — and its `organizationId` argument is **required**, not
  optional: an omitted org would default to "env-wide" and reinstate the hole, while a
  required one makes every caller state the row's scope to compile. The kernel-scope
  gate (`environmentId === undefined`) stays with the callers, because that is a fact
  about the kernel, not about the row.

  Not changed, deliberately:

  - **What org readers see.** The merged listing, `getMetaItem`'s org-preferred read,
    and the org-scoped write itself are all untouched — this closes a registry leak,
    never a write or a read. Per-org overlays keep working exactly as ADR-0005
    designed them: served on demand.
  - **#4521 read-your-writes.** An env-wide save is still dispatchable the moment it
    lands, with no listing call in between.
  - **The `object` branch.** An `object` is `allowOrgOverride: false` and its physical
    table is env-wide, so the registry entry backing it is env-wide too;
    `assertObjectRegistered` fails closed on a missing entry, so gating that branch
    would make a runtime-created object unreachable for data CRUD rather than merely
    un-listed. That branch has never carried the `environmentId` gate either, for the
    same reason.
  - **The delete chain.** `restoreArtifactRegistryView` stays `(type, name)`-addressed:
    with both entry seams refusing org rows there is nothing org-scoped in the registry
    for it to mis-address, so no re-keying is needed (pinned in both directions).

- e39dd66: 冷启动跳过的 org 作用域元数据行不再无声消失

  `loadMetaFromDb` 按 ADR-0005(2026-05 修订)只水合 `organization_id IS NULL` 的行,
  per-org overlay 由 `getMetaItem`/`getMetaItems` 按需加载——对注册表里
  `allowOrgOverride: true` 的类型(`view`/`dashboard`/`report` 等)这是设计本身。但对
  **其余类型**,一条 org 作用域的行是平台根本没有 per-org 通道的行,而在此之前这个跳过
  是**完全静默**的。

  实测标本是 `flow`:它是 `allowOrgOverride: false`(#6283 / PR #6478 按 ADR-0005:57
  回滚),同时 `allowRuntimeCreate: true`,所以租户在 Studio 里新建一条 flow 仍会写出
  `sys_metadata.organization_id = '<org>'`——运行时 `PUT /metadata/:type/:name` 把
  `resolveActiveOrganizationId` 透传给 `saveMetaItem`,而 `SysMetadataRepository.put`
  对任何类型都按 `organization_id: this.organizationId` 落库。该 flow 在本进程内一直正常
  触发(发布时写穿进了进程级 registry),下一次重启后被这条过滤器丢掉,`kernel:ready` 的
  绑定器读的是 `getMetaItems({ type: 'flow' })`(不带 org),于是它**再也不触发,且没有任何
  日志说它消失了**——`kernel:bootstrapped` 的 unbound 审计也看不见它(它压根没注册)。

  现在冷启动会打一条聚合的 `warn`,按类型给出计数、抽样的 `name@org`,以及后果本身
  (「A 'flow' listed here will NOT bind its triggers in this process」)和处置建议。
  查询默认为空:两个收窄谓词(`organization_id IS NOT NULL` + 类型清单,清单由
  `DEFAULT_METADATA_TYPE_REGISTRY` 派生而非手写)让健康部署读不到行、也不打印任何东西;
  驱动若无法下推其中一个谓词,退化为多读几行而不是打出误报(JS 侧会复核两个谓词)。

  加载行为**未改变**:这次只是把缺席变响亮。这类行到底该不该存在(写入侧拒绝 / 强制写成
  env-wide / 让绑定器按 org 读)是 #6190 上待裁决的契约问题。

- bed427f: fix(metadata-protocol): `ensureOverlayIndex` probes before it drops, and says what it could not enforce (#6418)

  `sys_metadata`'s overlay-uniqueness migration ran **DROP then CREATE**:

  ```text
  DROP INDEX IF EXISTS idx_sys_metadata_overlay_active   ← always succeeds
  CREATE UNIQUE INDEX  idx_sys_metadata_overlay_active … ← may fail
  ```

  with nothing that puts the dropped index back, and both `catch` blocks empty. On
  the dialects that _do_ support the form (SQLite / PostgreSQL), a `CREATE` that
  failed on existing rows therefore left the table with **no** unique index at all
  — and no line in the log. ADR-0005 overlay uniqueness is the base of metadata
  correctness: with two ACTIVE rows for one
  `(type, name, organization_id, package_id)`, which one `getMetaItem` returns is
  undefined.

  The degradation branch could not save it either. It fired only when the driver's
  message matched `/partial|where clause|syntax/i`, which duplicate-row errors
  (`UNIQUE constraint failed` / `duplicate key value`) do not — so the one failure
  that is about DATA fell through to a bare `// best-effort` comment. MySQL was
  safe only by accident: `DROP INDEX IF EXISTS` is not legal MySQL, so the drop
  failed first and the old index survived.

  **The order is now probe-first**, ported from the sibling
  `view-definition-active-index.ts` (#5839 / #6417) and extracted into a shared
  `partial-index-probe.ts` both migrations use: build the partial UNIQUE under a
  throwaway probe name, and only once that has demonstrably succeeded drop the
  real name and rebuild it. On any dialect or dataset that cannot take the form,
  whatever index was protecting the table is left exactly as it was — degraded to
  yesterday's behaviour, never below it. Both sections get this treatment
  (`…_overlay_active` and `…_overlay_draft`), and the two are independent so a
  failure on one no longer decides the other.

  **The empty catches are replaced by ADR-0120 D4's disposition**: classify the
  failure, keep the previous index, name the key that is not enforced and what
  that costs, ship the exact query that lists the offending rows, point at
  `os migrate plan`, and let the boot continue — reported at `error`, because what
  goes missing is an integrity guarantee the platform states it enforces while
  everything else keeps looking healthy.

  Two things deliberately do **not** change. The key spelling stays byte-identical
  (`(type, name, organization_id, COALESCE(package_id, ''))`) — this is an
  ordering and reporting fix, not a re-keying. And the dialect fallback stays a
  **non-UNIQUE** composite index: one ACTIVE row and one DRAFT row for the same
  key legitimately coexist on this table, so a full UNIQUE would reject legal
  data. What changes about the fallback is that it is now issued additively
  (`IF NOT EXISTS`, no preceding drop, so it can never replace a stronger index)
  and that the report says plainly what is and is not enforced.

- f7e5624: Fix: the #3050 pre-persistence authoring gate now keys on the declared `authoringChannel` instead of `environmentId`, so ADR-0090 D11 object posture enforcement reaches host-config deployments.

  The gate call site in `saveMetaItem` was wrapped in `if (this.environmentId !== undefined)`. The CLI's lightweight host-config assembler constructs `new ObjectQLPlugin()` with no options, leaving `environmentId` undefined while serving an end-user `PUT /api/v1/meta/*` — so plugin-security's object posture gate (`owd_widening_forbidden` / `owd_external_wider`) ran on no self-hosted deployment at all. This is the same proxy-signal hazard #6710 retired for the sibling #4463 gate; the two doors now read one declared key.

  Behaviour change for self-hosted deployments: an object write whose `externalSharingModel` is wider than its `sharingModel` — or an environment overlay that widens a packaged object's OWD — is now refused with `403` (`owd_external_wider` / `owd_widening_forbidden`) on the draft path, the active path and package authoring, instead of being accepted. Fix the posture in the object definition; widening a packaged object legitimately is authored in the package source and published (ADR-0090 D7). A kernel that declares `authoringChannel: 'package-author'` is unaffected — package authoring stays gated at build time by `validateSecurityPosture`.

- 8f1851e: fix(engine-core): disabling a package now stops its objects being served, and a failed uninstall stops answering 200 (#7557)

  ## Disabling a package is now an enforcement for its objects

  A package at `status: 'disabled'` had its nav entries and views correctly
  dropped, while `GET /api/v1/data/<object>` still answered **200 with every
  row** and `GET /api/v1/meta/objects` still listed the object. The status was
  consulted by some readers and skipped by others, so "disabled" meant different
  things depending on which surface you asked.

  Both skips were deliberate and both gave the same reason — filtering objects
  "would break data queries that depend on their schema". That conflated two
  different kinds of reader, and they are now separated explicitly:

  - **Resolution readers keep serving.** `registry.getObject` and
    `registry.listItems('object')` still return a disabled package's objects.
    Migrations, cross-package references and the runtime authoring gate's object
    universe all resolve through them, and blanking them would break authoring
    that has nothing to do with the disabled package. Disable remains reversible
    and still destroys no data.
  - **API readers now stop.** The `/meta/*` listing drops the objects (the
    `object`/`objects` exemption in `getMetaItems` is gone; `package` is still
    never filtered, or a disabled package could never be re-enabled), and the data
    plane refuses.

  **The data-plane refusal is loud, not silent.** `assertObjectRegistered` — the
  single gate every `findData`/`getData` entry point funnels through — now answers
  a new error code:

  ```
  404  { "error": { "code": "OBJECT_PACKAGE_DISABLED",
                    "message": "Object 'x' belongs to a disabled package and is not
                                being served. Re-enable the package to restore access." } }
  ```

  The 404 status matches the closest existing sibling, `OBJECT_API_DISABLED` for
  `enable.apiEnabled: false`, so "this object exists but is switched off" keeps
  one status across both switches. The distinct **code** is what makes it
  actionable: a bare `OBJECT_NOT_FOUND` sends a caller — an AI agent especially —
  hunting for a typo or re-creating an object that is merely switched off, while
  this one names the cause and therefore the fix. `OBJECT_PACKAGE_DISABLED` is
  registered in the ADR-0112 ledger under `@objectstack/metadata-protocol`.

  If you have a client that treats a disabled package's objects as queryable, it
  now receives a 404 with the code above instead of rows. Re-enabling the package
  restores every surface.

  ## A failed uninstall is no longer wrapped in a 200

  `DELETE /packages/:id` on the dispatcher door stated `success: true`
  unconditionally and forwarded the protocol's own `{ success: false,
deletedCount: 0 }` underneath it, so the status line and the payload disagreed
  and any caller reading the status recorded an uninstall that had not happened.
  Per-item failures now answer **400 `PACKAGE_DELETE_PARTIAL`**, carrying the
  failed items and the uninstall cleanup outcomes (a failed permission revocation
  is a ghost grant, so it must survive the failure path).

  The rule is copied deliberately from the direct-mount REST door of the same
  route, which already answered this way — two doors to one route answering
  differently is how the divergence arrived. That includes its carve-out: **zero
  metadata rows is still a successful uninstall**, because a runtime-registered
  package that never published metadata has nothing in `sys_metadata`. The
  failure predicate is therefore `failedCount > 0`, not `!persisted.success`.

  An all-rows-failed uninstall now answers 400 rather than the 404 its zero
  `deletedCount` previously implied.

  **Not fixed here:** the separate persistence defect where `deletePackage` finds
  zero rows while package-bound `sys_metadata` rows demonstrably exist, leaving
  them behind on an otherwise-clean uninstall. That is a `sys_metadata` query
  defect one layer below this handler and is reported for its own fix; see #7557.

- fda61e4: fix(metadata-protocol): `publishPackageDrafts` now writes the audit rows a batch publish always owed

  Studio's "publish whole app" (`POST /packages/:id/publish-drafts`) promoted every
  draft in a package and wrote **no `sys_metadata_audit` rows at all** — neither the
  allowed-outcome `publish` rows nor a `denied` row for a refusal. The route calls
  `promoteDraftForPublish` directly rather than `publishMetaItem`, so the row added
  for the single-item routes never ran for it: a batch that published twenty
  artifacts left the compliance trail exactly as empty as a batch nobody ran.

  Both outcomes are now recorded, and **where** they are recorded is the fix:

  - **allowed** — one `publish` / `allowed` row per promoted item, written in Phase 2
    off `promoted[]`, with `source: 'protocol.publishPackageDrafts'` so the trail
    distinguishes "publish whole app" from a single-item publish. The row is keyed on
    the scope the draft was promoted in, not the request's active org, because
    env-wide drafts are promoted env-wide.
  - **denied** — one `publish` / `denied` row with `code: 'batch_aborted'` when the
    batch rolls back, written from the rollback handler, **outside** the
    `engine.transaction()`. Written inside it, the refusal's own row would roll back
    with the batch it records — leaving nothing behind about a refused publish, which
    is the defect the single-item audit rows exist to close.

  The causal reason rides in `note`, which is served by `GET /api/v1/meta/:type/:name/audit`
  and therefore carries the client-facing text rather than raw driver output.

- 61ea810: fix(runtime): refuse to disable or delete a read-only package on the `/packages` lifecycle routes (#7560)

  `PATCH /packages/<id>/disable` and `DELETE /packages/<id>` answered **200** on a
  platform package, and the `DELETE` really removed it from the running process's
  registry listing. One authorized API call took platform functionality out of a
  live deployment. Reproduced on two platform packages in the QA run behind #7514.

  **Blast radius, measured.** The card reported that the packages come back after a
  restart — true for `DELETE` (they are code-loaded, so nothing is permanently
  destroyed), but **not** for `disable`: `setPackageDisabled` persists the choice
  to `<OS_HOME>/package-state/<env>.json`, which `SchemaRegistry` replays at boot.
  A disabled platform package stayed disabled across restarts.

  **Two axes, not one.** #7033 / PR #7083 gave the whole `/packages` domain caller
  authorization (`manage_metadata` on writes, the ADR-0106 D4 set on reads, an
  anonymous floor) — _who may call the route_. This is the second, missing check
  on the same routes: _what the route may do once the caller is allowed_. An
  authorized admin — and `isSystem` — is now refused, because read-only is a
  property of the **package**, not of the caller. The caller gate is unchanged;
  tightening it would not have fixed this and would have broken legitimate admins.

  **No new vocabulary.** The refusal is ADR-0070's existing one, reused: `422` /
  `WRITABLE_PACKAGE_REQUIRED`, the code `saveMetaItem` already throws when asked to
  author _into_ a read-only package. The predicate behind it moved out of
  `ObjectStackProtocolImplementation`'s private method into
  `@objectstack/metadata-protocol`'s exported `isWritablePackage(engine, id)` and
  is now **referenced** by both callers — a second hand-kept copy of "which
  packages are read-only" is exactly the drift that let `DELETE` remove a platform
  package while `saveMetaItem` was refusing to add one field to it. Both read-only
  signals are covered: a booted code package (`engine.manifests`) and a
  platform-delivered manifest `scope` of `system` / `cloud`.

  Packages an org owns (project-scoped bases, ADR-0048 authoring workspaces) still
  disable, re-enable and delete exactly as before — pinned in both directions, on
  the registry listing rather than on the status code, since the listing is where
  the original defect's harm actually showed.

- 252f71b: fix(metadata-protocol): a single-record update binds the row the CALLER named, not the row the body names (#6479)

  `PATCH /data/:object/:id` decided which row to write **twice, differently**. The
  protocol's `updateData` probed existence and validated `If-Match` /
  `expectedVersion` against the path `:id`, built `{ where: { id: request.id } }`,
  and then handed the request body to the engine verbatim — where the dispatch
  reads the payload first, so a truthy scalar `data.id` outranks `where.id`.

  So `PATCH /data/task/rec_1` with a body of `{"id":"rec_2","title":"x"}`:

  - probed **rec_1** for existence (404 gate, #4435);
  - version-checked **rec_1** against the caller's `If-Match`;
  - **wrote rec_2**; and
  - answered `{ id: "rec_1", record: <rec_2's readback> }` — a receipt whose two
    halves name different rows.

  rec_2 was never probed and never version-checked, so the most common client
  shape there is — GET a record, edit a field, PUT the whole body back — performed
  a **silent cross-row write straight past its own optimistic-concurrency check**
  whenever the body carried another row's id (a mis-clicked list row, a stale
  refresh, a generated client that copied the wrong field).

  `updateData` now merges the path id over the payload before dispatch
  (`{ ...request.data, id: request.id }`) — the same shape the **bulk** ingress has
  always used for this question (`ql.update(op.object, { ...data, id }, …)`), so the
  two ingresses give one answer instead of two. The probed row, the OCC-checked
  row, the written row and the receipt's `id`/`record` are now the same row: the
  one in the URL.

  Nothing else moves:

  - **The engine is untouched.** ObjectQL's payload-first dispatch (#5748) and its
    by-id payload strip (#6435) are unchanged and still correct for a caller who
    hands ObjectQL a payload and nothing else; this was a gap at the REST/protocol
    ingress, which had already named the row.
  - **No new rejection, no request-shape change.** A body `id` equal to the path
    id behaves exactly as before, and a differing one is now simply overridden
    rather than refused — `UpdateDataRequestSchema` still accepts the same bodies.
  - **Non-record payloads pass through untouched** (`undefined`, `null`, an array),
    so the engine's own diagnostics for a malformed call still surface unchanged.

  Callers that deliberately relied on the body's `id` redirecting a
  single-record PATCH must address the intended row in the URL instead — the bulk
  endpoint has never honoured a body id either.

- a5d2573: feat(metadata-protocol): publishing a platform-level scheduled `create_record` flow is refused on a multi-organization deployment unless it declares `organization_id` (#6285)

  A scheduled flow that creates records now has to say which organization those
  records belong to — but only where the answer matters, and only where nothing
  else can supply it.

  ## What was open

  `ScheduleTrigger` builds its context as
  `{ event: 'schedule', params: { jobId, flowName, schedule } }` — no `tenantId`.
  PR #6153 closed the engine half of #5494 on the rule "stamp what the engine
  KNOWS": a run whose trigger resolved an organization carries it through, and the
  driver's tenant machinery fills `organization_id` on rows that omit it. A
  schedule resolves none, so nothing fills anything — and the dominant production
  shape of the whole issue is a nightly sweep, which fires on a schedule and not
  by hand. Every row it created was born `organization_id` NULL.

  That is not a cosmetic NULL. A `(organization_id, …)` unique index does not
  constrain across NULL and an org-scoped query does not see the row, so the
  damage is duplicate and invisible records — hotcrm#698's duplicate numbering —
  in a stored shape no later fix can retroactively repartition.

  ## What now happens

  At the runtime publish gate, this exact combination is refused with the existing
  422 `INVALID_METADATA` envelope (`code` + `status` + `issues[]`, ADR-0112):

  - the deployment enforces an organization wall
    (`postureEnforcesWall(resolveTenancyPosture())` — `group` or `isolated`,
    ADR-0105 D1), **and**
  - the flow is platform-level (the write carries no organization), **and**
  - it binds to the **schedule** trigger, **and**
  - it contains a `create_record` node, **and**
  - that node declares no `fields.organization_id`.

  Every limb's negation still publishes: a single-organization deployment, an
  org-scoped write, any other trigger, a flow that creates nothing, and — the
  fix an author actually applies — a node that declares
  `config.fields.organization_id`. That key is not new: `CreateRecordConfigSchema`
  has always carried `fields`, and #6153's fill-only stamping already guarantees
  an author-supplied value wins over any engine fill. One issue is reported per
  offending node, including nodes nested inside `loop` / `try_catch` / `parallel`
  regions, each addressed at the key the author must write.

  Drafts are never gated (#4463 D1) and the draft to active promotion is, so the
  draft door is not a bypass. `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades the
  refusal to a loud log exactly as it does for the 26 shared rules, and
  `os migrate meta --stored` stays carved out.

  ## Where the judgement lives, and why

  Runtime publish gate only; `os validate` / `os build` / `os lint` do **not**
  judge this. Both inputs the rule needs are facts about the **deployment**, and
  the CLI runs on a build machine — a shared rule would sentence every
  single-organization repository on whatever `OS_TENANCY_POSTURE` happened to be
  exported in CI. The gate's caller performs the two readings and passes them as
  arguments, so the judgement itself stays a pure function of its inputs.

  Migration note for a multi-organization deployment: an existing scheduled flow
  keeps running untouched — the gate blocks new writes only, never stored rows —
  but the next time one is republished it will be refused until the
  `organization_id` is declared, which is the same edit that stops it writing
  outside the organization partition.

- da538b1: seed-loader: a pass-2 back-fill dropped for a missing source-record id is now reported, not silently discarded

  `resolveDeferredUpdates()` looked the source record's internal id up in `insertedRecords`
  and, when it was not there, ran off the end of an `if` with no `else`. Pass 2 had already
  RESOLVED the target, and the back-fill then evaporated: no write, no entry in
  `errors`/`allErrors` (so the load still reported `success: true`), no `errored`, and not
  one log line. The only trace was the `referencesDeferred` the record booked in pass 1 and
  never gave back — a dangling number with nothing in the result explaining it, while the
  declared association stayed absent forever.

  It now records the loss through `recordDeferredError` (→ `errors`/`allErrors` + `errored`,
  so the load reports `success: false`) and logs it once at `error`, per the same objective
  criterion applied in #4729/#4997 and the "Degradation log levels" rule. The two ways to
  get here are worded differently because they are different failures: an EMPTY
  `recordExternalId` — `externalIdKey` returns `''` when any component of a composite
  externalId is blank — is the pure silent loss, where the row wrote perfectly, nothing else
  in the load reports anything and the reference stays NULL forever; a real key that is
  simply absent from the map means the source row never landed, and that write failure was
  already reported at `error`, so this line points at it instead of restating it.

  A load that hits this path previously returned `success: true` with clean counters and now
  returns `success: false` with the loss counted — the seed data was always incomplete; it
  just was not saying so.

- 2ab1257: `preserveAudit` is an UPDATE-path exemption — the contract now says so, and a non-system INSERT that asks for it is told loudly instead of silently stripped (#6640)

  `FieldSchema.readonly`'s `.describe()` promised the opt-in historical-import exemption
  (`preserveAudit`, #3493) on **both** write paths, and
  `docs/protocol/objectql/security.mdx` agreed. Only UPDATE ever implemented it. The
  create-side strip lives at the DataProtocol ingress (`stripReadonlyForInsert`, #3043) and
  has never read `preserveAudit` at all — `context.isSystem` is its only exemption — while
  the engine's update-side strip consults `isPreservableUnderAudit`.

  REST import's `treatAsHistorical` puts `preserveAudit: true` on the write context and
  creates through `createData`, i.e. through exactly that ingress. So **one** historical
  import kept an author-declared `readonly` business column (`closed_at`, `resolved_by`) on
  the rows it UPDATED and silently dropped it from the rows it CREATED. The trigger is not
  exotic: the audit family itself is `readonly: true` in the registry's `AUDIT_FIELD_DEFS`,
  so an ordinary export→historical-import round-trip carries readonly columns on every row.

  Maintainer ruling (2026-08-08), option 2 with a binding loudness rider — the enforcement
  is the truth and the contract narrows to it:

  - **Contract narrowed.** The `.describe()` text and the security doc now state the
    exemption as UPDATE-path only. The INSERT entry keeps honouring `isSystem` alone;
    replaying archival readonly facts on create requires a system context. Honouring
    `preserveAudit` here instead would have handed a NON-system caller — `treatAsHistorical`
    arrives on an ordinary REST import request — the approval/status columns #3043 exists to
    protect, in one POST.
  - **The ignored request stops being silent.** A non-system INSERT that requests
    `preserveAudit` and actually loses fields now logs a `WARN` naming the object, every
    stripped field, the UPDATE-only rule, and the `isSystem` remedy. It fires once per
    ingress call (the union across a batch, as `mergeDroppedFieldEvents` already does), and
    only when something was really removed — an ordinary create that never asked for the
    exemption stays exactly as quiet as #3043 designed it.

  **No behaviour change to the strip itself, and no acceptance-surface change** — the
  accepted set is byte-identical; only the describe text, the docs, and the new warning are
  new.

  Warning rather than refusal, measured rather than assumed: `runImport` collects a per-row
  write error into a failed row instead of aborting, so refusing at the ingress would not
  stop a historical import — it would convert every row it CREATES into a failure while the
  rows it updates still succeed. Measured on a throwing variant, the historical import of 2
  new rows went from `{created: 2, errors: 0}` to `{created: 0, errors: 2}`. Breaking the
  shipped `treatAsHistorical` flow for new rows is the condition under which the ruling names
  the loud WARNING — strip still applied — as the containment-correct landing.

- 8a102d0: fix(metadata-protocol): a package publish refused by a lock or a 409 now leaves its own audit row (#8594)

  `publishPackageDrafts` — Studio's "publish whole app" — promotes every draft
  inside ONE `engine.transaction()` (ADR-0067 D2, "a commit cannot half-land").
  `promoteDraftForPublish` runs inside that closure, and it used to write its
  **denial** audit rows there: the ADR-0010 lock refusal (`code: 'item_locked'`,
  with the `lock_state` column) and the optimistic-lock 409
  (`code: 'metadata_conflict'`).

  On a transactional engine both rolled back with the batch. The refusal is what
  aborted the batch, so the row describing that refusal was destroyed by the very
  rollback it caused — the defect #7748 exists to close, surviving on this one
  route. A compliance query filtering `code = 'item_locked'` found **nothing** for
  a package publish refused by a lock, however many times it had been attempted.

  The `batch_aborted` row added in #8400 gave a refused batch _a_ trail, but it
  carries the batch's fact ("the whole batch rolled back; nothing landed"), not the
  item-level verdict's vocabulary or its lock column — so the query above still
  came back empty.

  **What changed.** `promoteDraftForPublish` no longer writes those rows. It hands
  each refusal its own row as data, and each of its two callers records it on its
  own side of its own transaction:

  - `publishMetaItem` (single-item) records it where it always effectively landed —
    that route opens no transaction of its own, and its rows are unchanged, still
    filed under `source: 'protocol.publishMetaItem'`;
  - `publishPackageDrafts` (batch) records it from the rollback handler, outside
    the transaction, filed under `source: 'protocol.publishPackageDrafts'`.

  The placement no longer depends on the engine's capabilities either: an engine
  with no `transaction()` at all lands the same row in the same place.

  **What a refused batch now leaves.** Two rows for the causal item, each carrying
  a different fact and neither replacing the other: the inner verdict
  (`item_locked` with its `lock_state`, or `metadata_conflict` naming the losing
  race) and #8400's `batch_aborted`. A refusal that never reached either gate — a
  driver fault, `NOT_OVERRIDABLE`, `INVALID_METADATA` — still leaves exactly the
  one `batch_aborted` row it left before; no code value is minted for it.

  No new `code` value: ADR-0112 D6b keeps `sys_metadata_audit.code` a closed
  persisted vocabulary, and the values that now land are the ones that were already
  in it. Nothing about ADR-0067 D2 changes — a refused batch still promotes
  nothing, records no commit, and reports `publishedCount: 0`.

- 79822b5: fix(metadata-protocol): stop `promoteDraft`'s draft drain from swallowing every failure (#4981)

  Publishing a draft is two writes: a transactional `put` that promotes the body onto
  the active row, then a `delete` that drains the now-redundant `state='draft'` row.
  The drain was guarded by a bare `catch {}` whose comment named exactly one cause —
  "a concurrent publisher may have already drained the draft" — while its behaviour
  covered **all** of them: connection drops, statement timeouts, missing privileges,
  driver faults, `parentVersion` mismatches.

  The result was a silent, self-perpetuating inconsistency. `publishDraft` returned
  success, the active row was correct and durable, and a stale `state='draft'` row
  stayed in `sys_metadata` holding the body that had just been published. Nothing
  logged it and nothing retried it, so Studio/Setup kept reporting "unpublished
  changes" for an artifact that had none, and the next publish of that artifact
  promoted the same already-published body again — which overwrites the active row if
  anything published or reverted in between.

  **The drain now discriminates by cause.** `ConflictError` — the only error
  `delete()` raises from its own pre-driver row lookup — stays silent, because both of
  its arms are genuinely benign: `actualHead === null` is the concurrent-publisher
  race the old comment described, and a differing head means a _newer_ draft was saved
  while the publish was in flight, so the surviving row is real pending work that must
  not be dropped. Every other failure is reported at `error` level (per the
  `warn`-vs-`error` rule: the system keeps looking healthy while something it claims to
  have cleaned up is still there), naming the orphaned artifact, the consequence, and
  the remedy, with the original cause attached.

  **`promoteDraft` still returns success, deliberately.** The drain runs _after_ the
  `put` has committed, so throwing would misreport a durably successful publish as a
  failure and invite the caller to retry — and a retried publish is precisely the
  harmful path, because it re-promotes the stale draft. The failure is surfaced
  without lying about the publish instead: alongside the log, the result carries a new
  optional `draftDrainFailed` field (`{ ref, draftHash, cause }`, exported as
  `DraftDrainFailure`) so callers can react without parsing logs. It is an additive
  optional field on an existing result object — absent on every clean publish — so no
  existing caller changes.

  No protocol or spec shape changed. The drain seam is registered with
  `pnpm check:durability-log-level` (as the named callee `dropPromotedDraftRow`) so
  the catch cannot quietly go back to swallowing everything.

- 15e61fb: fix(metadata-protocol): `publishPackageDrafts` 现在对 `api` draft 跑 ADR-0121 端点发布门 (#5206 step 2)

  `protocol.publishPackageDrafts` 是 Studio「全部发布」的真实入径(ADR-0033 /
  ADR-0067 D2)。在此之前,它唯一的按类型前置检查是对象命名空间前缀
  (`validateObjectNamespacePrefix`,仅 `d.type === 'object'`),于是一条 `api`
  draft **不经任何一道门**就被提升为 `active` —— 与 #5189 在
  `MetadataManager.publishPackage` 上修掉的是同一形状、另一条路。

  安全后果早已被 PR #5203 的装载期兜底挡住:端点匹配器在建索引时用同一个
  `firstFailure` 重判每一条存量条目,没过门的被排除出索引并 `error` 点名。所以
  这次修的是**拒绝得太晚**:ADR-0121 的原文是「publish 拒绝」,作者应当在
  publish 当场拿到点名 key 的处方,而不是到装载期日志里才发现自己的端点在答
  404。

  **判据只有一份。** 本改动调用 `@objectstack/spec/api` 导出的
  `validateApiEndpointDeclarations`(#5203 公开)—— 就是 stack schema 跑的那个
  函数、`publishPackage` 跑的那个函数、装载期兜底跑的那个 `firstFailure`。拒绝
  文案直接用门函数自己的消息(已包含端点名、越界的 key 和改法),本包不复述任何
  一条「什么算可服务」的规则。

  与 `publishPackage` 不同,这条路**有身份**:包的 `manifest.namespace` 本来就
  为对象前缀规则读过了,所以这里跑的是**全量门**,命名空间门(ADR-0121 D1/D2)
  包含在内。命名空间门**不**以「包声明了 namespace」为条件 —— 门函数自己的前置
  判据(声明了 `apis:` 的 stack 必须显式声明 `manifest.namespace`)本身就是一条
  判据,对「压根没有 namespace」的包跳过它,等于给最不可能过编译期的那批包留一
  个洞。对象前缀规则对无 namespace 的包网开一面,是因为一个裸对象名只是命名气味;
  一个无命名空间的端点是一个**无主 URL**。

  **行为变化(用户可见)**:

  - 一条 `api` draft 若违反端点门(最典型:ADR-0121 D6 —— `authRequired: false`
    却没有 `rateLimit.enabled: true` 的预算),`publishPackageDrafts` 现在返回
    `success: false` / `publishedCount: 0`,该条目进入 `failed[]`,`code`
    为 `ENDPOINT_GATE`;body 连 `ApiEndpointSchema` 都不满足的,`code` 为
    `ENDPOINT_SCHEMA`(解析是判定的前置,不是第六道门 —— 判不了的形状也服务不
    了)。
  - **失败粒度沿用既有语义,未发明新的批次语义**:与命名空间前缀违规完全一致,
    这是一次**提升任何东西之前**的前置拒绝,整批不落地(`published: []`),同批
    的健康 draft 保持 draft 态。这既是 ADR-0067 D2 的「一次 commit 不能落一半」,
    也是 #5189 在另一条路上的同一姿势(`itemsPublished: 0`)。两类违规现在合并
    在**同一份报告**里返回,作者一次往返就能看全。
  - 判定范围是**本批被提升的 draft**,与紧邻它的对象前缀规则一致。与同包已
    `active` 的端点撞车不在此拦截 —— 匹配器对全库重复声明有确定性裁决并 `error`
    点名(`buildEndpointIndex`);把范围扩到整包 active 集合意味着「因为你没在发
    布的东西而拒绝这次发布」,那是另一份契约,不是一个 bug 修复。

  装载期兜底(#5203)原样保留,未移除也未削弱:publish 是**更早**的那道门,不是
  最后那道门的替代品。

  `api` 进 `DEFAULT_METADATA_TYPE_REGISTRY` / `BUILTIN_METADATA_TYPE_SCHEMAS`
  (即 Studio 直写路径的 422)是 #5206 的第 1 步,拆在子单 #5271(spec 车道);
  本改动**不依赖**它落地。

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

  | Was                                                               | Now                                                                                                                                                                                   |
  | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`                                                                                                                             |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                                                                                                                                                   |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | the same `expand`, keeping the FK in your own projection (`fields: ['title', 'owner_id']`) — **not** a dotted `fields` path, which no driver resolves and the ingress refuses (#7532) |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias`                                                                                                                      |

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

- 72bd873: fix(metadata-protocol): 保存成功的回执不再一律自称 "customization overlay"

  `saveMetaItem` 的成功 `message` 原本只有两种句式,都写死了 "customization
  overlay"。但 `DEFAULT_METADATA_TYPE_REGISTRY` 里有一批类型声明
  `supportsOverlay: false` 而按设计可以运行时写入(`object` / `field` / `hook` /
  `seed` / `mapping` / `flow` / `action`),对它们的一次全新创建并没有覆盖任何
  artifact,却也被回执成 "saved a customization overlay"。

  判据不是 `supportsOverlay`,也不是 `allowOrgOverride`(spec 的 TSDoc 把这两件事
  分得很清楚:前者是 loader 的合并能力,后者是运行时写入的许可),而是写路径**早已
  算出**的 `isArtifactBacked` —— 也就是 `intent: 'override-artifact' |
'runtime-only'` 的来源。回执现在只说这条已知事实,不新增任何读路径查询。

  |                                 | FROM                                                                       | TO                                                  |
  | :------------------------------ | :------------------------------------------------------------------------- | :-------------------------------------------------- |
  | 覆盖了 code package 的 artifact | `Saved customization overlay (org=…, state=…) — type=…, name=… [seq=N]`    | 逐字不变                                            |
  | 无 artifact 的运行时写入        | `Saved customization overlay (env-wide, state=…) — type=…, name=… [seq=N]` | `Saved <type> '<name>' (env-wide, state=…) [seq=N]` |

  org 维度照旧在括号里(`org=<id>` / `env-wide`),`state=` 与 `[seq=N]` 两个分支都
  保留,所以读取 `seq`(HMR 游标)或 `state` 的消费方不受影响;`message` 本身没有
  任何消费方解析,仅作 toast 展示。

  回执不区分「新建」与「更新既有 DB-only 行」:唯一可用的事实 `parentVersion ===
null` 的作用域是 `(state, packageId)`,一个已有 active 行的首个 draft 也会读成
  "没有父版本",据此写 `Created …` 只是把一句假话换成另一句假话。中性动词
  "Saved" 如实,且不为一句文案发明新的查询。

- dde9202: fix(metadata-protocol): 读路径 `_diagnostics` 保留 union 分支给出的真实拒绝理由 (#5598)

  `computeMetadataDiagnostics` 给 `getMetaItems()` / `getMetaItem()` 服务出去的每份
  文档挂 `_diagnostics` 信封,模块头写明它的用途是让 Studio 渲染 validity badge、
  **内联字段错误**和治理看板。但它把 zod 的 `error.issues` 直接 `.map()` 成信封条目,
  而 zod 会把一个失败 `z.union` 的**全部分支**折叠成一条顶层 issue —— `path` 是 `''`,
  message 是字面量 `"Invalid input"`。`ViewMetadataSchema` 顶层本身就是 union
  (`z.preprocess(stripViewConsoleDecorations, z.union([...]))`),所以库里**每一个**
  有缺陷的 view 文档读出来都退化成这一条没有字段名的记录,内联字段错误无处可标。

  这不只是"少了点信息",而是**同一份文档在两条路径上判决不一致**:#5364(PR #5596)
  修好写路径之后,作者**保存**一个有缺陷的 view 能看到出错的键名,**打开**同一份已存
  在库里的文档却仍然只得到一条 `Invalid input`。

  改法是复用而不是再抄一份策略:读路径改调同包 #5596 已落地的
  `zodIssuesToMetadataIssues`,分支选取口径(丢弃只报根部 KIND 不匹配的分支;报得最少
  的分支胜出;`unrecognized_keys` 破平局;并列全出且有上限;嵌套 union 按绝对路径递归)
  由该函数**单点定义**,读写两路径按构造一致。这是同一机制的第 5 个消费者
  (#4971 / #5014 / #5341 / #5364 是前四个)。

  对消费者是**纯增量**:union 自己那条记录仍然排在 `errors[0]`,只是后面跟上了解释它的
  分支条目,所以任何读 `errors[0]` 的既有代码读到的还是同一条。没走 union 的普通字段级
  拒绝(`path` / `message` / `code`)逐字节不变;spec 合法的文档仍然是 `{ valid: true }`,
  展开不会凭空造出拒绝。

- 47a4e67: fix(objectql): deleting an `object` really unregisters it — a name-addressed `SchemaRegistry.unregisterObject` (#6808)

  Deleting a runtime-created `object` removed its `sys_metadata` row and left the
  object serving. `deleteMetaItem` ends its repository delete with
  `restoreArtifactRegistryView` (the #6687 three-tier heal), and every verb that
  walk uses — `removeRuntimeShadow`, `registerItem`, `removeOverlayEntry` —
  addresses `SchemaRegistry`'s generic `metadata` map. An `object` is written into
  **two** places on the way in:

  ```ts
  registry.registerItem("object", item, "name"); // metadata map
  registry.registerObject({ ...item, _provenance: "org" }, pkg); // objectContributors
  ```

  The heal only undid the first. Measured with the real `SysMetadataRepository`
  over an in-memory engine:

  ```
  BEFORE delete: metadata['object'] -> ["myapp_invoice"] | objectContributors -> ["myapp_invoice"]
  AFTER  delete: metadata['object'] -> []                | objectContributors -> ["myapp_invoice"]
  registry.getObject('myapp_invoice')        -> STILL SERVED
  registry.getItem('object','myapp_invoice') -> STILL SERVED   (it special-cases back to getObject)
  ```

  The surviving half is the load-bearing one. `getObject` is what the data plane
  dispatches on (`assertObjectRegistered`, #3770), so the row was gone from
  `sys_metadata` while the object stayed resolvable, syncable and **writable** for
  the life of the process — a `createData` against the deleted object still
  inserted rows. Reachable on the ordinary Studio delete path, and on
  `revertCommit`'s soft-remove limb, which #6807 had just wired to the same heal.

  There was no one-line fix because `SchemaRegistry` had no per-name object
  removal at all: the only removal verb was `unregisterObjectsByPackage`, which is
  addressed by PACKAGE. Routing a single delete through it would mean synthesising
  a package identity for a runtime-created object and tearing down every sibling
  object registered under it — a far wider blast radius than the delete the
  operator asked for.

  So `SchemaRegistry` gains the verb that was missing:

  - **`unregisterObject(name, { force? })`** — removes one object's contributor
    entry and the per-object state `registerObject` created (merged-object cache,
    `objectRevision`). Names resolve through the same path `getObject` uses, so it
    removes precisely the entry that was being served. Package namespaces are left
    alone: they are per-package and shared by every object that package ships.
  - **The ADR-0029 guard is borrowed, not re-invented.** An object still extended
    by another package refuses loudly, naming every extender — the same judgement
    `unregisterObjectsByPackage(force)` already encodes, with the address changed
    from package to name. Both facts it needs (owner, extenders) were already in
    the contributor list, so no new bookkeeping was added.

  `restoreArtifactRegistryView` calls it from **tier 3 only**, and only for a name
  that is not artifact-backed — the tier that has already established no lower
  layer serves the name. Tiers 1 and 2 concluded a
  packaged artifact or a MetadataService baseline still does, and an object that is
  still served must stay registered: `assertObjectRegistered` fails CLOSED, so
  retiring it there would turn "reset to artifact default" into a data-plane
  outage. It also carries the same artifact refusal `removeOverlayEntry` applies
  one line up, asked through the protocol's own `isArtifactBacked`: a code-shipped
  object is never retired by this walk. That is not already covered by the gates in
  front of it — the two-tier delete authorization runs only when `environmentId !==
undefined`, and the no-row leg of a control-plane delete reaches the heal without
  touching the repository's `assertAllowed` at all.

  Because the heal runs after the repository delete has committed, an extender
  refusal is caught and logged by name rather than propagated (the row is gone
  either way) — and deliberately not left to the heal's silent outer `catch`, so a
  runtime that disagrees with `sys_metadata` is visible rather than inferred.

  `unregisterObjectsByPackage` keeps its signature and semantics unchanged.

- 7f1d4d0: fix(data): an unknown field inside `where` / `$filter` / a filter AST is rejected, not answered with an empty list (#7534)

  `POST /api/v1/data/showcase_invoice/query` with `{"where":{"not_a_field":"x"}}`
  answered `200 {"records":[],"total":0}` — no `code`, no mention of the unknown
  name — and identically through the `$filter` door and the filter-AST door. The
  bare-key door on the same object with the same field name, in the same run,
  answered `400 INVALID_FIELD`.

  So one endpoint family gave **two verdicts for one mistake**, chosen by which
  door the caller used, and the losing verdict is indistinguishable from "no
  data". That is the exact failure #4134 was filed about: an unknown name is
  lowered into a field-equality predicate that can only match zero rows.

  This is **not** a regression of #4134 — that gate still holds on the door it
  covers (measured at the branch point alongside the three failures). It is the
  sibling door its fix never reached: `assertQueryParamsAreFields` gated only the
  **implicit** filters `findData` derives from leftover query parameters, while
  the **explicit** axes reached the driver ungated — even though
  `resolveQueryFields` was written as "ONE resolution shared by all four read
  axes".

  **The gate.** A new `assertFilterFieldsExist` calls that same existing
  resolution — additively; `resolveQueryFields` itself is unchanged — on the
  normalized `where`. One call covers all three doors because they are not three
  code paths: `where` / `filter` / `filters` / `$filter` resolve to one slot at
  the #3795 fold, and a filter AST is lowered by `parseFilterAST` — the single
  sink for that sugar — before the gate runs. The gate therefore reads the same
  `FilterCondition` the driver will read, which is what keeps "the field the gate
  saw" from drifting away from "the column that reached the driver".

  Rejections carry the envelope the write path and the bare-key door already
  produce — `400 INVALID_FIELD` + `field` + `fields` + `object` — plus `param`
  naming the caller's own wire spelling (`$filter`, not `where`), and a message
  that states the zero-row consequence, since that is the part a caller cannot
  infer from a `200`.

  **Deliberately unchanged.**

  - **Precedence.** The gate runs _after_ the #4134 param gate, so a request that
    gets both a bare key and its filter wrong answers exactly as it did before;
    and _before_ the #4164 implicit/explicit merge, which is what still lets it
    name the axis the caller actually used.
  - **Reach.** Structure is discarded — `$and` / `$or` / `$not` are recursed
    into — but a field key's VALUE is not descended into: it is either an operator
    bag (`{$gte: 18}`) or a nested-relation condition (`{owner_id: {region:
'NA'}}`) whose keys belong to a _different_ object. Judging those against this
    object's field map would refuse legitimate relation filters. A dotted path is
    judged on its head segment, the same reach the bare-key door has on
    `owner_id.name`. An unrecognised `$`-combinator is skipped without descending —
    a hole rather than a false rejection, the right failure direction for a gate
    that exists to stop wrong answers.
  - **The honest zero.** A real field that genuinely matches nothing is still a
    `200` with `total: 0`. A filter that cannot be _run_ at all is still
    `INVALID_FILTER` (#4121 / #4181), which answers first; this gate answers only
    "does this field exist".

  ## Upgrade note — data import: a `matchField` naming no field now fails the row

  The gate sits at the `findData` ingress, so it also reaches the record-matching
  lookup the CSV/JSON import runner performs for `update` and `upsert` writes.
  This is a **user-visible behaviour change on a second surface**, and it is
  deliberate — the ruling on #7534 was to keep it rather than exempt the import
  path.

  **Before.** A `matchFields` entry naming a field the target object does not have
  produced a filter that could only match zero rows. The lookup read that as
  `'none'` — "no existing record" — and an `upsert` therefore fell through to a
  **create**. The import reported success while writing duplicate rows the caller
  believed were being matched and updated, and nothing in the response
  distinguished that from a genuinely new record.

  **Now.** That row fails with `400 INVALID_FIELD` naming the field. The failure
  is contained by the row loop's own `try`/`catch`, so it is reported as one
  failed row in the import results and **the rest of the import proceeds** — it is
  not an aborted job.

  **Remedy.** Correct the `matchFields` name to a field that exists on the object.
  The rejection names the offending field and, when it reads like a typo, suggests
  the closest real field name.

  Exempting the import path would have meant _adding_ code — catching
  `INVALID_FIELD` and restoring `'none'` — to preserve a silent data-correctness
  bug of exactly the family this change closes, so the invariant is restored
  instead.

  **Unaffected: reference resolution.** The import runner's `resolveRef` probes
  candidate display fields (`name`, `title`, `label`, `full_name`, `email`,
  `username`) that legitimately may not exist on the object being referenced, and
  it already wraps each probe in a deliberate `catch` that moves on to the next
  candidate. A `400` lands exactly where the empty result did, so reference
  resolution behaves as before.

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

- 2873eb9: fix(metadata-protocol): rolling back a package-bound overlay row no longer 409s (#6215)

  Every rollback of a metadata item authored inside a Studio package workspace
  failed — and failed by blaming a concurrent edit that never happened:

  ```
  [metadata_conflict] object/myapp_invoice advanced during rollback.
  Expected parent sha256:00ca6e72c... but current is null.
  ```

  Both user-facing paths were affected, because both are one call:
  `rollbackMetaItem` (the per-item version-history revert) and `revertCommit`
  (the package-commit revert) go through `SysMetadataRepository.restoreVersion`.
  Only rows with **no** package binding — the legacy shape — rolled back at all,
  while ADR-0070 pushes authoring toward always resolving a writable base
  package, so the failing share was growing.

  **Cause.** `restoreVersion` read the current active row package-agnostically
  and then re-put the historical body without saying which row it meant. `put`
  scopes its optimistic-lock lookup by package, and an unstated `packageId`
  resolves to the _unbound_ row (`package_id IS NULL`) rather than "any package"
  — so for a row bound to `app.<slug>` the lock looked up a row that does not
  exist, read its parent hash as `null`, compared that against the real hash the
  first read had just returned, and threw `ConflictError`. The mismatch was
  between two reads of the _same_ restore, not between two writers.

  **Fix.** `restoreVersion` now reads the raw active row once and takes BOTH
  facts from it — the parent hash and the ADR-0048 `package_id` — then states
  that binding on the write, the same way `promoteDraft` already did. The row the
  lock is taken on is therefore, by construction, the row that gets written.

  This also closes the defect's second face: had the parent check ever passed,
  `put` would have found no row in its `IS NULL` scope and **inserted a duplicate
  unbound row** beside the bound one instead of updating it. `sys_metadata`'s
  partial unique index keys on `COALESCE(package_id,'')`, so a real database
  would have accepted that duplicate.

  Unchanged: package-less rows still roll back exactly as before, and a row that
  _genuinely_ advanced between the rollback's read and its write is still refused
  with `METADATA_CONFLICT` / 409. The refusal is narrowed to the case it always
  claimed to report, not retired.

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

- a2c82a8: fix(metadata-protocol): attribute a revert commit to the scope of the commit it reverts (#7860)

  `revertCommit` recorded its compensating commit under the **requesting
  session's** organization:

  ```ts
  const orgId = request.organizationId ?? null;
  // …
  await this.recordPackageCommit({ orgId, packageId: row.package_id, … });
  ```

  `packageId` on that same call is already read off the reverted `row`; the org
  was the one field still taken from whoever asked. It now reads
  `row.organization_id ?? null` — the rule #7559 gave this function's **items**
  (`resolveMetaItemOrgScope`) and #7819 tier 2 gave `duplicatePackage`'s copies,
  applied to the commit **record** that documents them.

  ## Filed as a question, settled by measurement

  The card was explicit that this was **not** filed as a defect: the behaviour is
  self-consistent for the caller who performed the revert, and it asked for a
  measurement before any choice between "attribute to the request" and "attribute
  to the reverted row". Measured on a real ObjectQL + `SqlDriver`
  (`better-sqlite3`), after an org-scoped revert of an env-wide commit:

  | reader                       | before            | after             |
  | :--------------------------- | :---------------- | :---------------- |
  | the actor (`org_active`)     | `[revert, apply]` | `[revert, apply]` |
  | **a different organization** | **`[apply]`**     | `[revert, apply]` |
  | no-org (direct-mount REST)   | `[revert, apply]` | `[revert, apply]` |

  The middle row is a concrete reporting defect, which is what settled the
  question rather than a preference. What makes it more than cosmetic is the
  artifact state measured alongside it: `sys_metadata` held **no** row for the
  reverted view afterwards. Items revert in the **row's** scope (#7559), so the
  artifact really was withdrawn env-wide — the effect was global while the record
  was private, and a reader in another organization saw an `apply` commit that
  was never compensated for an artifact already gone. Since #7814
  `rollbackToPackageCommit` **plans** from `listCommits`, so this list is not
  merely an observability surface.

  The mirror direction is the same mismatch pointed the other way, and the same
  line fixes it: a no-org caller reverting an **org-scoped** commit stamped the
  revert env-wide, so every other organization read a dangling `Revert: …` whose
  `parentCommitId` names a commit that door cannot see. Measured before:
  `[revert]` for an unrelated org; after: `[]`.

  The invariant both collapse to: **a revert commit is visible to exactly the
  readers who can see the commit it reverts.**

  ## Reachability

  Only since #7819 tier 1. Before it the target lookup answered
  `COMMIT_NOT_FOUND` (404) for an env-wide row, so an org-scoped caller could not
  reach the attribution line with a mismatched scope at all — a dormant quirk
  whose reachability was created by a fix in the same function.

  ## Verification

  `packages/runtime/src/package-revert-commit-attribution-org-scope.integration.test.ts`
  — real engine, real driver, seeded through the real publish path (a stubbed
  `engine.find` cannot see NULL semantics). Ablation, with a rebuild between
  measurements because these suites resolve `metadata-protocol` through its
  `dist`: restoring the request-derived `orgId` turned exactly 3 of the 4 cases
  red — `expected [ 'apply' ] to deeply equal [ 'revert', 'apply' ]` — and left
  green precisely the case predicted to be unaffected, the actor's and the no-org
  door's timelines. The sibling #7819 and #7814 suites stay green (18/18).

- 756fd12: fix(metadata-protocol): let an org-scoped caller revert an env-wide commit (#7819, tier 1)

  `revertCommit` and `rollbackToPackageCommit`'s target lookup each resolved
  their target commit with a strict `organization_id` equality:

  ```ts
  const where = { id: request.commitId };
  if (request.organizationId) where.organization_id = request.organizationId;
  ```

  `organization_id = 'org'` matches no row whose column is NULL, so an org-scoped
  caller got `COMMIT_NOT_FOUND` (404) for any commit recorded env-wide — a row
  that demonstrably exists and that the **same caller's** `listCommits` hands
  back. Both lookups now accept org-scoped **or** env-wide rows, the same `$or`
  `deletePackage` (#7705) and `listCommits` (#7779) already carry.

  Env-wide commit rows are not hypothetical: `recordPackageCommit` stores
  `request.organizationId ?? null`, and the publish door forwards an org only when
  `resolveActiveOrganizationId` yields one — a resolver that answers `undefined`
  for a session with no active organization _and_ for any throw on the auth seam.
  A publish made before an org was selected lands its commit env-wide,
  permanently, since the timeline is append-only.

  **User-visible change.** An org-scoped rollback past an env-wide publish now
  performs the rollback instead of refusing it. #7814 had already converted this
  from silent to loud (pre-#7814: `{success: true, revertedCommits: []}` with the
  changes still live; after it: `success: false` naming the commit), so this
  closes a blocked-but-attributable operation rather than a silent data defect.

  ## Why the `$or` here, and not the other two remedies

  Unlike the earlier members of this family, `where` is keyed on `id` — a
  primary-key lookup — so the org predicate reads like an **authorization filter
  on a unique key** rather than scan scoping, and widening it would be widening an
  authorization boundary. Measured against the only door, it is not one:

  1. Authorization on `POST /packages/:id/commits/:commitId/revert` and
     `POST /packages/:id/rollback` is `requireManageMetadata`, checked **before**
     the protocol call. The org never gates the call.
  2. The `organizationId` that arrives is the session's _active org selection_
     from `resolveActiveOrganizationId`, whose body is entirely `catch`-wrapped.
  3. On any auth-seam throw it answers `undefined`, which **omits** the predicate
     — the widest reading, every organization's commits. A boundary that fails
     **open** is not a boundary.

  That rules out remedy 3 (keep the check, distinguish "not yours" from "no such
  commit"): there is no authorization here to make precise, and asserting one
  would be inventing a boundary, not repairing one. Remedy 2 (drop the predicate
  outright, defensible on an id lookup) was rejected because it would newly let an
  org caller revert **another organization's** commit by id — a widening this card
  never asked for. The `$or` admits the env-wide rows and refuses that one.

  The decisive in-code evidence is that the **body already accepted what the
  lookup refused**: #7559 made `revertCommit` resolve each item's scope from the
  row rather than the request, precisely because "a batch legitimately mixes an
  env-wide artifact with an org overlay". `rollbackToPackageCommit` made the
  contradiction self-evident — since #7814 it plans from `listCommits` (org +
  env-wide) and fed each id straight back into a lookup that refused half of them.

  The **no-org branch is deliberately not narrowed** to `organization_id IS NULL`,
  exactly as #7705 and #7779 left theirs: the direct-mount REST registrar passes
  no `organizationId` at all, and restricting that door to env-wide rows would
  make every org-scoped commit unrevertable — the same bug pointed the other way.

  ## Pin

  `packages/runtime/src/package-revert-commit-org-scope.integration.test.ts` — a
  real `ObjectQL` over a real `SqlDriver` on better-sqlite3, seeded through the
  real publish path, because the question is whether `organization_id = 'org'`
  matches a NULL column: a property of the driver's SQL, not of a stub's
  `filter()`. (It lives in `packages/runtime` because `metadata-protocol` cannot
  import `objectql` — dependency cycle.) Eight cases: the premise measured out of
  SQLite, the positive for each site, **both** negative directions (another
  organization's commit refused on each site; another package's commits not
  reached by the planner), and the no-org door on each site. Refusals are asserted
  on `code` **and** `status` per ADR-0112, never on "it threw".

  `package-list-commits-org-scope.integration.test.ts` (#7814) carried the handoff
  assertion that pinned this defect as known-incomplete
  (`rollback.success === false`, `failed == [c2]`); it now asserts the rollback
  succeeds and reverts `c2`, and survives as the family's end-to-end case.

  **Reverse verification**, direction predicted before running: restoring the
  strict equality turns exactly the two positive cases red plus the updated
  handoff assertion, and leaves both negative directions and both no-org doors
  green, since strict equality is _narrower_ than the `$or`. Measured: 3 failed |
  11 passed, exactly those three.

  ## A blind test double, taught rather than accommodated

  `packages/objectql/src/protocol-commit-history.test.ts` went red on two
  org-scoped revert cases. Measured, not assumed: its `matchesWhere` was pure flat
  equality, so it compared `row['$or']` against the array and matched nothing.

  The double was the blind party, not the fix — both failing rows carry the
  **caller's own** org (`organization_id: 'org_a'`, request org `'org_a'`), so
  they match the first `$or` branch outright: the same row the strict equality
  already accepted. Neither case's subject (#6602's registry org-asymmetry)
  involves the commit lookup at all; it is merely the door they enter through.

  It now understands `$or`/`$and`, **conjoined with the sibling keys in the
  entries loop** — the corrected form #7846 landed across six doubles in this
  package (part of #7620), not the early-returning `if ($or) return …some(…)`
  shape those six carried before it. That shape discards sibling keys, so
  `{ id, $or: [...] }` would stop constraining `id` and the lookup could return
  some _other_ commit whose org matched. This file was not among #7846's six
  because it had no operator handling to correct, so it reads as a new member of
  the #7620 lane rather than a regression of it.

  ⚠️ Recorded deliberately: this makes the double a _reimplementation_ of `$or`,
  so any assertion whose **subject** is the org predicate would be measuring the
  double rather than the protocol. No case in that file has that subject — which
  is exactly why it could never see this family — and a comment there says so and
  asks that org-scoping cases not be added. The operator's real behaviour against
  a real driver stays pinned on the real engine in `packages/runtime`.

  ## Scope

  Tier 1 of #7819 only. The two remaining strict equalities in this file —
  `duplicatePackage` and `reassignOrphanedMetadata`, a different table
  (`sys_metadata`) whose step one is the unanswered "are these states even
  reachable" — are deliberately untouched, and #7819 stays open to carry them.

- 271cee1: fix(metadata-protocol): a successful `revertCommit` refreshes the SchemaRegistry (#6621)

  `revertCommit` persisted its change and left the running process serving the
  body it had just reverted away. The single-item revert `rollbackMetaItem` has
  ended its restore with a registry write-through since #4521 — "a rollback is a
  live write like any other: the restored body must be the one the runtime
  dispatches on immediately, not after someone lists the type" — and the batch
  path over the same repository call had no equivalent on either limb.

  Measured before the fix, real `SysMetadataRepository`, an `object` saved twice
  (v2 adds a `due_date` field) and then reverted:

  ```
  revertCommit                          ->  { success: true, revertedCount: 1, failed: [] }
  stored sys_metadata row fields        ->  ["name","amount"]              # reverted
  SchemaRegistry.getObject(...) fields  ->  [...,"name","amount","due_date"]  # NOT reverted
  ```

  So the undo reported success while data CRUD kept dispatching the pre-revert
  schema, healing only at the next restart. It is type-agnostic and older than
  the `object` support that made it loud: an overlay `view` showed the same split
  (stored `Cases`, registry still `Renamed`). `rollbackToPackageCommit` reverts
  through the same loop, so a whole-package rollback could report success and
  change nothing the running process could see.

  Both limbs now refresh the registry, each reusing the seam its single-item
  sibling already uses:

  - **Restore limb** — writes the restored body through under the row's OWN
    ownership key, read from the row before the restore (#4636; stated as the
    `sys_metadata` sentinel instead, `registerObject` throws `already owned by
package "app.<slug>"` into a best-effort warning and the stale body survives).
    The row's own organization is passed per item, so an org-scoped row inherits
    ADR-0005's rule that only env-wide rows enter the process-wide registry.
  - **Soft-remove limb** — runs the same three-tier heal `deleteMetaItem` runs
    after its own repository delete: an overlay that shadows a packaged artifact
    falls back to the artifact rather than vanishing, and only a name no layer
    serves at all is retired. A flat unregister would have deleted names a code
    package still ships. This heal is gated to env-wide reverts: an org-scoped row
    never entered the shared registry, so healing on its behalf would retire the
    entry every other organization reads.

  No contract change — ADR-0067 already defines what a revert leaves behind; this
  makes the runtime agree with it without waiting for a restart.

- 75e6871: fix(metadata-protocol): `revertCommit`'s soft-remove limb states its write intent per item, so a commit that CREATED an object can be reverted (#6620)

  `ObjectStackProtocolImplementation.revertCommit` has two limbs. #6563 (PR #6642)
  fixed the one that RESTORES an edited artifact, where the intent was unstated and
  fell through to `restoreVersion`'s `?? 'override-artifact'` default. The other
  limb — an artifact the commit CREATED, which the revert soft-removes — stated the
  same intent as a literal constant:

  ```
  intent: 'override-artifact',
  ```

  `SysMetadataRepository.delete` opens with `this.assertAllowed(ref.type, opts.intent)`,
  the same gate `put` uses, and it refuses every type whose registry entry is not
  `allowOrgOverride`. `object` is exactly such a type, so every created object of a
  reverted commit came back in `failed[]`:

  ```
  [NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.
  Overlay-allowed: view, page, dashboard, app, action, report, dataset, ...
  ```

  This is the FIRST-BUILD undo — the Studio / AI flow that publishes a brand-new app
  and then undoes it. Every object the commit created stayed behind, the call
  answered `success: false` with a populated `failed[]`, and the package was left
  half-reverted: its overlay-allowed items removed, its objects not.
  `rollbackToPackageCommit` reverts through the same loop and inherited it, and
  there the symptom was quieter still — a per-item refusal never throws, so the
  rollback recorded the commit as reverted and answered `success: true` while the
  created object was untouched.

  The limb now derives the intent from the artifact the way the sibling DELETE
  caller `deleteMetaItem` already does — `isArtifactBacked` gives
  `'override-artifact'`, otherwise `'runtime-only'` — and does it **per item**,
  because one first-build commit routinely creates a runtime object beside a
  packaged-artifact name. All three delete/revert callers (`deleteMetaItem`,
  `rollbackMetaItem`, both `revertCommit` limbs) now derive the same fact the same
  way.

  The repository's gate is deliberately unchanged: it is right for callers that
  genuinely mean "override a packaged artifact", and the defect was this caller
  never saying which of the two cases each item is. An object a code package really
  ships still resolves to `'override-artifact'` and is still refused with
  `NOT_OVERRIDABLE`, which is pinned alongside the fix.

- e6025e9: fix(metadata-protocol): `revertCommit` states its write intent per item, so an `object` overlay can be reverted at all (#6563)

  `ObjectStackProtocolImplementation.revertCommit` restored an edited artifact
  through `repo.restoreVersion(ref, prevVersion, { actor, source, message })` — with
  no `intent`. `SysMetadataRepository.restoreVersion` therefore fell back to its
  `?? 'override-artifact'` default, `put` opened with
  `assertAllowed(ref.type, opts.intent)`, and that gate refuses every type whose
  registry entry is not `allowOrgOverride`. `object` is exactly such a type, so
  every `object` item of a reverted commit came back in `failed[]`:

  ```
  [NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.
  Overlay-allowed: view, page, dashboard, app, action, report, dataset, ...
  ```

  The package-commit undo (ADR-0067) therefore could not revert the metadata type
  Studio and AI-built apps create most, while the same edit reverted fine one
  artifact at a time through the version-history revert — the two user-facing
  revert paths disagreed about what is revertable. The failure was per item, so
  the call still answered `success` overall with a populated `failed[]`, which
  reads as a flaky revert rather than a systematic refusal.
  `rollbackToPackageCommit` reverts through the same loop and inherited it, and
  there the symptom was quieter still: a per-item refusal never throws, so the
  rollback recorded the commit as reverted and answered `success: true` while the
  object was untouched.

  `revertCommit` now derives the intent from the artifact the way its sibling
  `rollbackMetaItem` already does — `isArtifactBacked` gives `'override-artifact'`,
  otherwise `'runtime-only'` — and does it **per item**, because a commit is a
  batch that routinely mixes a runtime-created object with an overlay on a
  packaged view.

  The repository's default is deliberately unchanged: it is right for callers that
  genuinely mean "override a packaged artifact", and the defect was this caller
  never saying which of the two cases it is. So the gate is not widened — an
  object a code package really ships still resolves to `'override-artifact'` and
  is still refused with `NOT_OVERRIDABLE`, which is pinned alongside the fix.

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

- 1ee48bc: fix(objectql,metadata-protocol): a tenant-authored overlay must not read back as a code artifact

  `saveMetaItem` refuses to write an artifact-backed item of a type that has not
  opted into overlay writes (`not_overridable`), and it asks
  `registry.getArtifactItem` who is artifact-backed. That answer was "anything
  whose `_packageId` is not the literal string `sys_metadata`" — a sentinel that
  only holds on the save path. The boot-time rehydration of `sys_metadata`
  registers each row under its REAL package id (`app.<slug>`), which every
  runtime-authored item has carried since packages became mandatory.

  So an app the user had just built through Studio (or the AI build agent) came
  back from the next kernel rebuild looking code-shipped, and the following edit
  was refused with a 403 — permanently. Live capture: two identical `modify_field`
  calls on the same object seconds apart, the first published LIVE and the second
  `not_overridable`, because the first one's auto-publish triggered the rebuild in
  between (cloud#970).

  Provenance is the axis that actually separates the two (ADR-0010 `_provenance`:
  `'package'` for loader-introduced items, `'org'` for tenant-authored), so ask it:
  the `sys_metadata` hydration now stamps `_provenance: 'org'`, and
  `getArtifactItem` no longer treats such an item as an artifact. An item with no
  provenance under a real package id is unchanged, so nothing that was protected
  becomes writable.

- b30963d: fix(runtime): the package-publish door no longer discloses driver text on `seedApplied` (#8443)

  `POST /api/v1/packages/:id/publish-drafts` answered, on a **200**:

  ```json
  {
    "success": true,
    "data": {
      "seedApplied": {
        "success": false,
        "error": "SQLITE_ERROR: no such table: sys_metadata"
      }
    }
  }
  ```

  The door keeps a route-level seed apply for protocols that do not apply seeds
  inside `publishPackageDrafts` themselves. That fallback is a second copy of
  `metadata-protocol`'s `applySeedBodies`, and it kept the ADR-0112 defect the
  original was fixed for: a caught error's sentence interpolated onto a
  client-facing payload. `seedApplied` rides on a success body as **data**, so no
  HTTP boundary's 5xx message withhold can reach it — the disclosure had to be
  closed at the producer.

  Driven for real before being changed, which found **two** carriers on that one
  field rather than the one reported:

  - the door's `catch` — a driver failure under the seed loader's
    dependency-graph read, which is unguarded;
  - the per-read `errors[]` entries — a driver failure reading the just-published
    seed body back. This is the carrier a `sys_metadata` outage reaches first, so
    a fix confined to the `catch` would have left the commonest outage shape
    disclosing exactly as before.

  Both now follow the rule already in force next door: a caught sentence is
  quoted only when the error **declared** itself a client-facing refusal (4xx
  `status`); anything else gets a stable line and the original goes to the server
  log.

  **Authoring feedback is preserved, not blanked.** A malformed seed body used to
  arrive in the same `catch` as a raw `ZodError` — undeclared, so the withhold
  would have replaced a real authoring error with `seed apply failed`. The seed
  request is now parsed with `safeParse` and its rejection minted as a declared
  `INVALID_METADATA` / 422, so the author receives a curated summary naming the
  seed and the key (strictly better than the multi-line dump of zod internals the
  field used to carry). Self-correcting refusals such as `[item_locked]` continue
  to reach the caller verbatim.

  `@objectstack/metadata-protocol` exports `clientFacingFailureText` and
  `seedRequestValidationError` so the runtime door applies the producer's own
  decision instead of restating it — **an enabling export only; no behaviour in
  that package changes.**

- 705e5c8: fix(metadata-protocol): a flow save that skipped canonicalization says so (#4580)

  `saveMetaItem` canonicalizes flow bodies before the schema gate (#4542). When the
  canonicalizer throws — it is stricter than the gate: strict parse, cycle
  detection, control-flow region validation — the save falls back to the raw body
  so a work-in-progress draft with a temporary cycle stays saveable. That fallback
  is correct and unchanged. It was also completely silent.

  Of the four postures at this seam, three announce themselves: a clean
  canonicalization heals the row, a refused rename fails with `409
FLOW_CONVERSION_CONFLICT` naming the token, and a host with no automation service
  is reported by `os migrate meta --stored`. The throw-fallback said nothing, so a
  save that skipped canonicalization was indistinguishable from one that healed the
  row — and a body that is _both_ a legacy dialect and unparseable by the strict
  canonicalizer re-persisted verbatim. That is the exact #4542 symptom, arriving
  silently, while the boot warning for legacy stored rows tells the author that
  re-saving is the remedy.

  The fallback now emits a `console.warn` naming the flow and the canonicalizer's
  own error, deduped once per flow per process (the `convertStoredItem` pattern —
  Studio autosaves the same draft repeatedly, and a WIP cycle throws on every
  write). This aligns the write seam with ADR-0087 D2's "loud" posture, where
  conversions emit notices, reads warn once per row, and `migrateStoredMetadata`
  reports `failed` with the message.

  No behavior change: the body still saves, the schema gate stays the arbiter, and
  `registerFlow` still refuses to arm a malformed flow. Refusing the save in
  publish mode was considered and rejected — publish is the default mode, so it
  would silently tighten validation for every existing caller, and it could only be
  enforced on hosts that have an automation service, making the same body saveable
  on a control-plane host and a 422 on an automation host.

- 5ab0842: refactor(metadata-protocol): 删除 `saveMetaItem` 里已不可达的 legacy raw-engine 写入分支 (#5264)

  `saveMetaItem` 过去有两条持久化路径:repository 写入路径(追加
  `sys_metadata_history`、发 watch 事件、带单调 `seq`),以及其后的 legacy
  raw-engine 分支(直接 `engine.insert` / `engine.update` 写 `sys_metadata`,
  没有 history 行、没有 watch 事件、没有 `seq`,回执形如
  `Saved customization overlay (env-wide) — type=…`)。后者的进入条件是
  `isOverlayAllowed(type) || isRuntimeCreateAllowed(type)` 为假。

  **没有行为变化 —— 这条分支在运行时已经到不了。** #5086(PR #5263)把
  code-only 类型的拒绝提到了同一方法更早的位置,并且不再以 `environmentId`
  为条件:它抛错的判据与上面那个条件恰好互为反面,读的还是同一个规范化后的
  类型键(`canonicalizeMetaRequestType` 在方法开头折叠单复数,两个标志读取器
  内部又各自折叠一次)。`OS_METADATA_WRITABLE` 也不是缺口:在那里解锁一个
  类型会让 `isOverlayAllowed` 为真,从而走回 repository 路径。因此凡是能走到
  分叉点的写入,一律走 repository 路径。

  保留 `useRepoPath` 的代价不是多几行代码,而是它是一份 grep 得到、读起来
  像活代码的样板:照它推理会得出「`sys_metadata` 存在一个不写 history 的
  合法写入口」——现在没有了。

  `deleteMetaItem` 里结构对称的那条 legacy 分支**一行未动**:它在
  control-plane kernel(`environmentId === undefined`)上删除 code-only 遗留行
  时仍然可达且必要(#5263 特意没有收紧删除侧,因为删除是修复动作),该分支上
  新增了说明它为何还活着的注释。

- f61edce: fix(metadata-protocol): `saveMetaItem` canonicalizes flow bodies on write — a Studio edit now heals a legacy flow row like every other type's (#4542)

  The once-per-boot stored-conversion warning promises that re-saving a row
  ("Studio edit → save") persists the canonical shape. That held for every type
  except `flow`: the read path serves stored flows verbatim (the ADR-0078
  open-namespace conflict guard needs the engine's live executor registry, so
  `convertStoredItem` skips them), and `FlowNodeSchema.config` is an open
  `z.record`, so the legacy dialect an author was served (`config.filters`, pre-17
  node aliases) sailed back through `saveMetaItem`'s schema gate and re-persisted
  verbatim. A flow row stayed `pending` in `os migrate meta --stored` no matter
  how many times an author edited it — only the migration itself could retire it.

  `saveMetaItem` now runs the #4498 resolver (`resolveFlowCanonicalizer`) on flow
  bodies **before** the schema gate and persists `storable` — conversions plus the
  derived condition envelopes, deliberately not the schema's defaults (ADR-0087).
  The pass is copy-on-write, so already-canonical bodies (including the ones
  `migrateStoredMetadata` and `duplicatePackage` hand in) are untouched.

  Failure postures, same as the duplication seam:

  - **A refused node-type rename** (the old token is a live name owned by a custom
    executor here) refuses the save with `409 FLOW_CONVERSION_CONFLICT`, naming
    the token and path — never a silent legacy persist. 409 rather than 422
    because the body may be perfectly valid: the refusal comes from environment
    state, so resubmitting the same body cannot help.
  - **A body the canonicalizer cannot parse** falls back to the raw save and
    today's schema gate — in draft AND publish mode. `canonicalizeStoredFlow` is
    stricter than the gate (cycle detection, control-flow regions), and a
    work-in-progress draft with a temporary cycle must not become unsaveable;
    `registerFlow` still refuses to arm a malformed flow either way.
  - **No automation service reachable** (a control-plane or metadata-only host):
    the save behaves exactly as before — a host must not start refusing flow
    writes it accepted yesterday. `os migrate meta --stored` reports what it
    could not canonicalize.

  Reads are still unchanged — served bodies keep the stored dialect ("reads
  diagnose, never drop"); the heal happens on the way back in.

- d275c10: fix(metadata-protocol): 元数据保存的 422 保留 union 分支处方,Studio 重新拿得到字段名 (#5364)

  `saveMetaItem` 的 spec-conformance 检查在自己的注释里承诺 "structured Zod issues
  so the Studio form can highlight the offending field"。顶层 `z.union` 让这句承诺
  彻底落空:zod 把一个失败 union 的**所有**分支折叠成**一条**顶层 issue,`path` 是
  空串、`message` 是字面量 `"Invalid input"`,而旧代码的 `parsed.error.issues.map(…)`
  映射的正是这一条。

  代价不是"文案不够好",而是**字段定位本身消失了**。`ViewMetadataSchema` 顶层就是一个
  union(`view.zod.ts` 的 `z.preprocess(…, z.union([…]))`),所以**每一次** view 保存
  失败都退化成:

  ```json
  [{ "path": "", "message": "Invalid input", "code": "invalid_union" }]
  ```

  一个字段名都没有到达作者,Studio 表单没有任何东西可以高亮;422 的摘要行也只是
  `... failed spec validation: <root>: Invalid input`。被丢掉的分支里躺着的恰恰是
  #4001 那批策展处方(点名真实键名的 unrecognized_keys)和带绝对路径、带合法枚举的
  逐槽位判决。

  现在这些分支被展开进 `issues[]`:union 自己那条**保留不动**(展开是严格叠加的,
  今天读 `issues[0]` 的消费者不会少读到任何东西),后面跟上真正解释这次拒绝的分支,
  路径按绝对路径拼好——分支 issue 的 `path` 是**相对于 union** 的,这是 #5014 付过
  学费的坑。422 的 `message` 摘要行随之变得可读。

  分支选择策略与已落地的两处**逐条一致**:丢弃只报根部 kind 不匹配的分支;报得最少
  的分支胜出;`unrecognized_keys` 破平局;声明顺序决定其余;并列的全部输出(上限 3);
  嵌套 union 递归展开(上限 3 层)。这是同一机制的**第三份**拷贝——`packages/spec`
  的 `formatZodError`(#4971)只导出字符串渲染器,`packages/rest` 的
  `zodIssuesToFields`(#5014)产出 ADR-0114 的 `{field, code}` 目录条目,而本处的信封
  是 `{path, message, code}` 且 `code` 透传 zod 原码——形态不同,**判决必须相同**,
  否则同一个错误会因为作者是从终端发布、还是 POST 数据 API、还是在 Studio 里保存,
  拿到三套说法。

  行为边界:合法的元数据照常保存,非法的元数据照常被 422 拒绝且不落库;变的只是
  `issues[]` 从"一条无字段的 `Invalid input`"变成"那一条 + 真正解释它的分支"。

- 003feae: fix(metadata-protocol): the metadata write refusal stops depending on deployment topology (#8184)

  `PUT /api/v1/meta/object/showcase_task?package=READONLY_PKG` answered **two
  different machine-readable codes for one condition**, selected by the kernel's
  `environmentId` — a row-scoping key, not a topology declaration:

  | kernel                                                                                                           | answer                                             |
  | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
  | host-config / CLI lightweight assembler (`environmentId` undefined — the flagship showcase, self-hosted servers) | `403 ITEM_LOCKED`, `lockSource: 'package'`         |
  | project / cloud per-environment kernel (`environmentId` set)                                                     | `403 NOT_OVERRIDABLE` — the package was never read |

  `saveMetaItem` carries its own artifact-backed refusal behind
  `if (this.environmentId !== undefined)`, and it threw before
  `SysMetadataRepository.assertAllowed` — the topology-independent package door
  (#7682, then #8146's hatch ruling) — ever ran. So a client that learned to
  handle `ITEM_LOCKED` on a self-hosted deployment never saw it on a cloud one,
  and an operator reading `NOT_OVERRIDABLE` was told the type had no overlay
  channel when the real obstacle was the read-only base they had named.

  Not a regression: that branch answered `NOT_OVERRIDABLE` before #8185 and
  #8320 too. Those cards made the divergence visible by fixing the other half.

  **The scoped branch now consults the same `isWritablePackage` predicate and
  throws the repository's own emitter** — called, not copied — so the code, the
  status, `lockSource`, `packageId` and the sentence are byte-identical on both
  topologies, and neither door can drift when the other moves.

  **Same limb ordering as the repository, because the ordering is the rule:**

  - **Below every registry limb.** The branch is guarded by `!overlayAllowed`, so
    an `allowOrgOverride` type never reaches the door. An ADR-0005 org overlay of
    a code-shipped item _always_ names the read-only package it customizes; a
    door one limb higher would close the overlay model outright.
  - **Above the hatch limb.** `isOverlayAllowed` folds `OS_METADATA_WRITABLE` in,
    so an open hatch takes the write past this branch to the repository door,
    which applies the same rule with its own hatch-aware remedy — the refusal
    never prescribes the step the caller already took. Both directions pinned.

  **Narrow, exactly as the repository is.** Only a write that _names_ a read-only
  base is re-coded; a package-less write keeps `NOT_OVERRIDABLE` verbatim, and a
  package-less hatch write still lands `{ package_id: null, organization_id: null }`
  env-wide and `{ package_id: null, organization_id: <org> }` under an org kernel.
  Refusing a hatch write that names no read-only base (the broad reading) would
  retire the hatch's only documented use and remains a maintainer decision plus a
  docs/ADR change.

  The `runtime-only` create side needed no change: the ADR-0070 D1 gate further
  down `saveMetaItem` is already topology-independent and already answers
  `422 WRITABLE_PACKAGE_REQUIRED` on every kernel.

- 69ac82c: fix(metadata-protocol,rest,spec): derive `capabilities.search` from what serves `/search`, not from an empty service slot (#7541)

  Every REST host advertised `capabilities.search = { enabled: false }` in
  `/discovery` while `GET /api/v1/search?q=…` answered `200` with real hits. This
  is Prime Directive #10 inverted: not an advertised endpoint that 404s, but a
  live endpoint **no conforming client will ever call**, because the document
  whose only job is to say what is available said it was not.

  **Two producers, two unrelated predicates.** The capability bit came from a
  registered `search` service slot (`registeredServices.has('search')`), while the
  route refused on something else entirely — `registerSearchEndpoints` returns
  `501 NOT_IMPLEMENTED` exactly when `typeof protocol.searchAll !== 'function'`.
  Nothing in either repository registers that slot (`CORE_SERVICE_PROVIDER`
  records this, verified), and the protocol implements `searchAll`
  unconditionally, so the two answers were not merely capable of disagreeing —
  they disagreed on every host that exists.

  `search` was the last well-known capability still on bare slot presence. Its
  neighbours were moved onto serveability with the rule stated in the builder —
  _"the predicate is deliberately the SAME one that decides whether the route is
  advertised — what we advertise and what we claim cannot disagree"_ — most
  recently `chunkedUpload` in #5672. This brings `search` onto that footing: **one
  predicate, both ends.**

  - `@objectstack/metadata-protocol` — `capabilities.search` is now
    `typeof this.searchAll === 'function'`, the route's own refusal predicate.
  - `@objectstack/rest` — the `/discovery` producer ANDs that with
    `api.enableSearch`, the flag that decides whether this server mounts the route
    at all. Exactly the two-layer conjunction `transactionalBatch` already uses
    with `api.enableBatch`: the protocol states what it can serve, the server
    states what it mounted, and a deployment that opts out reports `false` rather
    than promising a 404. Nothing was added to the route itself.

  **`services.search` is unchanged, and deliberately so.** The slot answers a
  different question — `CoreServiceName` declares it "Search Engine
  (Elastic/Meili)" and `ISearchService` is an index/query contract — so it still
  reports _which engine occupies the slot_, while the capability reports _whether
  the surface is served_. On an ordinary host those now differ
  (`capabilities.search.enabled: true` beside `services.search.status:
'unavailable'`), and both statements are true. So that the two halves of one
  document do not read as contradicting each other, `@objectstack/spec` gives the
  slot a `REMEDY_DETAIL` sentence — the same treatment `ui` carries for the same
  shape (#4146) — which keeps the unchanged "no implementation ships" fact and
  adds which question the entry answers. The `status` itself stays
  `unavailable`: no engine is registered, and saying otherwise would be the
  original defect pointed the other way.

  **Client impact.** A client that gated its search UI on
  `capabilities.search.enabled` was hiding a working feature on every deployment;
  it now sees `true` wherever the endpoint really serves, and `false` when the
  protocol cannot search (route `501`) or the server did not mount it (`404`).

- 4e74c18: fix(search): `$search` compiles to `$icontains`, so textual matching is actually case-insensitive

  `$search` was case-SENSITIVE on textual fields, contrary to three places that
  all declared the opposite: the `search.cross-field-object-search` checklist item
  title, `search-filter.ts`'s own docblock (_"Matching: case-insensitive"_), and
  the `search-conformance` ledger row. Searching `Retail` returned "Acme Retail";
  searching `retail` returned nothing.

  The cause was operator choice, not operator behaviour. `fieldClausesForTerm`
  emitted `{field: {$contains: term}}`, and `$contains` is contractually
  case-SENSITIVE (#4706 Q2 = A) — `$icontains` is the case-insensitive one.
  SQLite's `LIKE` used to fold ASCII incidentally and hid the mismatch; #6518's
  `LIKE`→`GLOB` change removed that accident and exposed it.

  **Nothing about either operator changed.** `$contains` remains case-sensitive
  and `$icontains` remains the ASCII-folding twin; only which one `$search`
  compiles to moved. Every filter backend already answers `$icontains` (#6520 /
  #6682), so no driver changes were needed.

  Fixed in both producers of search clauses:

  - `objectql` `search-filter.ts` — per-object `find({ $search })`, for textual
    fields and for the select raw-value fallback.
  - `metadata-protocol` `searchAll` — the global-search palette behind
    `GET /api/v1/search`, which built the same AND-of-OR from `$contains` under a
    comment asserting `$contains` was the case-insensitive operator.

  Deliberately unchanged: the select label→value path (`optionValuesMatching`
  folds in JS and emits an exact-value `$in`), and the `__search` companion
  clause, which stays `$contains` because both of its sides are already lowercase.

  The three declarations are reconciled with the behaviour, and the dogfood pin
  that stayed green through the whole defect — its only case assertion was a
  select label, which passes on a case-sensitive build — now carries the
  `['name']`-narrowed lowercase-vs-capitalized assertion that catches it.

- 4ac12ef: fix(spec,lint): a virtual `formula` field in `searchableFields` is refused loudly, not admitted verbatim (#6674)

  #4254 closed the fail-open on the unknown-name axis: a `$searchFields` entry the
  engine would not scan is `400 INVALID_FIELD`, never a silently widened search.
  The same shape survived one axis over, on names that are perfectly real.

  The declared branch of `resolveSearchFieldResolution` filtered entries by
  EXISTENCE only, so a `formula` field declared in `searchableFields` entered the
  allowed set — and the ingress gate, which reads that same set, accepted it for
  exactly that reason. Measured on `origin/main`:

  ```
  AUTO:          {"allowed":["name","project_name"],"source":"auto"}                formula excluded
  DECL-FORMULA:  {"allowed":["name","project_name_formula"],"source":"declared"}    admitted verbatim
  ?search=Apollo&searchFields=project_name_formula  ->  200, 0 rows                 silent
  ```

  Zero rows is the defect. A formula value is computed on read and no driver
  materializes a column for it (`driver-sql` `fieldHasColumn`, driver-turso's
  "Virtual — no column"), so the `$contains` the engine expands `$search` into has
  nothing to scan: 0 rows on driver-memory (the property is absent from the stored
  row) and 0 rows WITH NO ERROR on driver-sql/better-sqlite3. The declaration read
  as search coverage and delivered none.

  - **`@objectstack/spec` — the deciding face.** The declared branch now filters on
    existence AND scannability: an entry naming a virtual field is not admitted.
    New exports `SEARCH_VIRTUAL_TYPES` (exactly `formula`, pinned) and
    `isVirtualSearchField` — one judgment, so the resolution, the gate and the
    linter cannot drift about which types have a column. The resolution itself
    stays non-throwing: it is consulted on every search by internal callers that
    never pass an ingress, which is why #4254 put the loudness at the ingress.
  - **`@objectstack/metadata-protocol` — `400 INVALID_FIELD` with its own reason.**
    Split out before the declared/auto branch, because both of those messages are
    wrong for it: "outside the declared set" is false when the entry IS in the
    list, and the auto-default's "declare `searchableFields` to choose the
    searchable set" would instruct the author to write the declaration being
    refused. The new message names the field, its type, that the value is computed
    on read and never stored, and the fix (mirror onto a stored text field).
  - **`@objectstack/lint` — a build error at authoring time**, on the object's own
    `searchableFields` as well as a view's narrowing, under the existing
    `searchable-field-unsearchable` rule (no new rule id). This narrows the
    canonical surface, which #4830 had deliberately left existence-only.

  The carve-out that made canonical existence-only is deliberately KEPT and pinned
  by controls in all three packages: the dividing line is STORAGE, not search
  quality. A `json` or `lookup` column declared in `searchableFields` is still the
  author's choice and still executed — a `$contains` over the stored JSON text or
  the stored foreign key. Narrow and rarely useful, but a scan that CAN match, so
  it is neither a 400 nor a finding. Only "there is no column at all" is refused.

  **Compatibility.** A corpus sweep of this repo plus `objectui` and `cloud` found
  ZERO authored `searchableFields` naming a formula-typed field, so nothing in the
  tree changes verdict. For an already-published object that does carry one:
  loading is unaffected (no schema-parse change — `searchableFields` is still
  `z.array(z.string())`, this is a resolution and enforcement rule); a plain
  `?search=` keeps returning the SAME rows, because the dropped entry matched none
  of them; only a request that NAMES the formula field flips from `200` with no
  rows to `400 INVALID_FIELD` — including objectui's list search, which echoes the
  declaration verbatim. An object whose `searchableFields` is ENTIRELY formula
  entries filters to empty and falls through to the auto-default, exactly as an
  all-stale declaration has since #4254; the linter reports the declaration rather
  than leaving that swap silent.

- 0657f6b: fix(seed): enforce `Seed.env` — environment-scoped datasets no longer seed everywhere

  `Seed.env` was authorable, defaulted and type-checked, but inert. `SeedLoaderService`
  filtered on the **loader config's** `env`, and none of the six call sites that build a
  `SeedLoaderRequest` (app boot, per-org replay, hot reload, package apply, draft publish,
  marketplace install) ever passed one — so `config.env` was always `undefined`, the filter
  short-circuited, and `dataset.env` was never read. A dataset marked `env: ['dev']` seeded
  into production exactly as if it were marked `['prod']`, which is the dangerous direction:
  the rows most likely to carry that marking are demo users, fake customers and seeded
  credentials.

  The loader now resolves the environment itself, at the one funnel every seeding path goes
  through:

  - **Source is `NODE_ENV`** — the environment source this repo already uses everywhere
    (`os start` defaults it to `production`, `os dev` / `serve --dev` set `development`,
    vitest sets `test`). No new environment variable and no new authorable key. `production`
    / `development` / `test` and the seed-enum spellings `prod` / `dev` are accepted,
    case-insensitively.
  - **An explicit `config.env` still wins**, so a host can seed "as" another environment.
  - **A dataset that declares no `env`** (the schema default `['prod','dev','test']`) seeds
    in every environment, exactly as before — no existing deployment loses rows.
  - **When the environment cannot be determined** (NODE_ENV unset, or a value like
    `staging`), the loader stays permissive and seeds everything — but logs a **warning**
    naming each environment-scoped dataset, the accepted `NODE_ENV` values and the
    `config.env` escape hatch. Fail-open is deliberate: fail-closed would also drop an
    `env: ['prod']` dataset on a production host that merely forgot to export `NODE_ENV`,
    a silent data-loss regression worse than the over-seeding it prevents.
  - **Skipped datasets are always named** in an `info` log, so "my demo rows are missing" is
    one log line to answer rather than a mystery.

  The resolved environment is also what seed CEL expressions now bind `env` to, so a seed's
  `env` and the loader's filter can no longer disagree.

  No API or schema change: `Seed.env` and `SeedLoaderConfig.env` are unchanged, and no
  package export was added.

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

- 1d29e6d: fix(metadata-protocol): a seed failure that is COUNTED as an error now logs at `error` (#4729)

  `SeedLoaderService`'s pass-2 deferred back-fill carried a comment stating that a
  failed back-fill "must be a reported, counted error, **never** a silent warning"
  — and the line under it called `logger.warn`. The count was right (the failure
  lands in `result.errors`, flips `success: false`) but the level contradicted it,
  and that log line is the only trace a seed leaves in a host's console. `warn` is
  the level #4420 proved nobody reads.

  **What changed**

  - The failed back-fill logs at **`error`**, and the line now owes what
    AGENTS.md → "Degradation log levels" requires of one: the **consequence**
    (`<object>.<field>` stays NULL on a named record, the row itself was seeded so
    every row counter reads clean, the circular relationship is half-written) and
    the **fix** (nothing retries it — repair the write error, which is either a
    transient failure that outlasted the retry budget or a validation rule vetoing
    the update, then re-run the seed).
  - The rest of the file was audited against the same criterion — _is this failure
    counted in the load's `errors` (i.e. does it make `success: false`)?_ Five more
    sites answered yes while logging `warn`, and were raised to `error`: a failed
    batch insert row, a record dropped because its `cel` expression could not
    resolve, the two invalid-reference paths that DROP a reference field (the row
    lands without its association and the row counters stay clean — framework#3932),
    and the two write-failure catches on the sequential/update paths. The two
    dropped-reference lines also gained the consequence and fix in the message.
  - Deliberately left at `warn`, and now documented as audited: "Halting on first
    error" (a control-flow notice about failures already reported at `error`), the
    `NODE_ENV` scope warning (a functional, fail-open degradation), and the
    roll-up-summary recompute (records _were_ written; whether a stale summary
    column is the same class is #4998).
  - The seam is now pinned by CI, not only by tests: the back-fill write was
    extracted as `writeDeferredReference` and added — with `writeRecord` — to
    `DURABILITY_CRITICAL_CALLEES` in `scripts/check-durability-degradation-log-level.mjs`,
    so `pnpm check:durability-log-level` fails if either catch is ever quietened
    again.

  No API, schema or result-object change: the same errors are reported in
  `SeedLoaderResult` exactly as before. What changed is the level and the wording
  of what a seeding host sees in its log.

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

- c5a5996: fix(seed-loader): a roll-up summary left stale by a seed is now loud and counted

  The loader recovers a post-write roll-up summary recompute that exhausts its
  retries (`ERR_SUMMARY_RECOMPUTE`), and that recovery is correct: the rows WERE
  written, so re-writing them would duplicate them (framework#3147). What was
  wrong was the rank of the consequence. A roll-up summary is a **persisted
  derived column** on the parent record, so after this the database is internally
  inconsistent — the detail rows say one thing and the column that summarizes them
  says another — and nothing recomputes it until some later write happens to touch
  the same parent, which after a seed may never happen.

  The entire event used to be one `warn` line reading _"records were written
  (summary values may be stale)"_. It named no object, counted nothing, and left
  `success: true` with every row counter clean, so no operator could see which
  aggregate was wrong and no caller could detect it at all
  ([#4998](https://github.com/objectstack-ai/objectstack/issues/4998)).

  **It now logs at `error`**, naming the seeded object and the exact stale column
  (`account.total_billed`), stating the consequence (the summary and its detail
  rows disagree, nothing self-heals, and the seed still reports success) and the
  remedy (fix the recompute error and re-run the seed, or trigger any write on the
  affected parent to force a recompute), with the original cause attached. This is
  the AGENTS.md "Degradation log levels" rule (#4632): persisted state and runtime
  state disagreeing while everything looks normal is `error`, not `warn`.

  **And it is counted** — `SeedLoadResult.summariesStale` and
  `SeedLoaderResult.summary.totalSummariesStale`, mirroring `referencesDropped` /
  `totalReferencesDropped`, which exists for the same shape one layer down ("the
  row was written, something derived from it was lost"). A log line is not
  something a caller can branch on; these counters are.

  `success` deliberately stays `true`. It answers _"did the rows land"_, and they
  did — every consumer treats `success: false` as "the write failed", so flipping
  it would hand the protocol seed-apply surface a `false` with an **empty** errors
  array and fail package/marketplace installs that in fact wrote every row. The
  counter carries the signal instead; a caller that wants to treat a stale
  aggregate as fatal reads `summary.totalSummariesStale > 0`.

  Both counters are additive with a `0` default, so an existing producer or
  consumer of `SeedLoaderResult` is unaffected — a payload written before this
  release still parses, with `0`.

- 5ea8e1e: fix(metadata-protocol): a seed record dropped for an unresolvable reference now says so at `error` (#4997)

  When a seed's `lookup` / `master_detail` / `user` reference could not be
  resolved and no pass 2 would run (`multiPass: false`), the loader dropped the
  **whole record** — the right call, since writing it would put the raw
  natural-key string into the FK column or, on an upsert UPDATE, corrupt the row
  already there. The drop was counted (`errored`) and reported
  (`result.errors` → `success: false`), and the code comment above it claimed
  "LOUD", but the branch made **no logger call at all**. On the console a seed
  that silently dropped N records was indistinguishable from a clean one, and the
  `packages/runtime` seed call sites that only `await` the load never look at
  `result.success` — so the loss surfaced later as "the app installed but the data
  isn't there".

  That branch now logs at `error`, per AGENTS.md → "Degradation log levels"
  (#4632): the line names the record (`<object>` record #i), the field, the target
  `<object>.<field>` it could not find, and the **consequence** (the whole record
  was not seeded — not merely the association), followed by all three **remedies**
  — seed the target object first, enable `multiPass` so pass 2 back-fills the
  reference, or fix the natural key in the seed data.

  The same objective criterion (does the outcome enter `errors`/`allErrors`?)
  found one more never-logged branch in the same file and aligned it: a **deferred
  reference still unresolved after pass 2** was counted exactly like its sibling
  whose back-fill _write_ fails — which has logged at `error` since #4729 — and
  logged nowhere. It now reports that the row was seeded while the relationship is
  permanently missing, and how to complete it.

  The **dry-run** branch stays deliberately quiet and is pinned that way by test:
  a dry run writes nothing, its caller is by definition reading the result object,
  and an `error` line about a simulated outcome only trains readers to skim
  `error`. No counters, result shapes or messages in `result.errors` changed —
  this is console output that was missing, not a contract change.

- 666f542: fix(seed-loader): the per-org tenant stamp is an id, not a natural key — stop
  re-resolving it and dropping it

  In a multi-org deployment the SeedLoader's per-organization replay landed
  **every row org-less**, so a freshly created organization booted with a CRM
  whose tables held data nobody could see: the tenant wall (`organization_id =
<active org>`) hides a NULL-org row from all members, including the org's own
  owner.

  The stamp and the reference pass disagreed about what `organization_id` holds.
  The loader writes `config.organizationId` — the replay target's **id** — into
  the record; the reference pass then sees a field declared as a lookup →
  `sys_organization` and resolves its value as a **natural key**, probing
  `sys_organization.name`. That misses, and a missed reference is dropped rather
  than kept, taking the tenant attribution with it. The `id` fallback probe cannot
  rescue it either: under replay every probe is AND-scoped with `organization_id =
<target org>`, and `sys_organization` — being the tenant table itself — carries
  no such column, so that probe matches nothing by construction.

  What hid it for so long is the **id shape**. `looksLikeInternalId` recognises
  UUID and Mongo ObjectId and short-circuits resolution for both, so any fixture
  that minted UUID organization ids passed. Every organization better-auth
  actually creates is `org_<base36>` — including the default organization
  `ensureDefaultOrganization` bootstraps on first boot — and that shape is not
  recognised. The defect therefore fired on real deployments and on nothing else.

  The loader now remembers that it wrote the stamp itself and skips resolution for
  that one field. A seed that authors `organization_id` explicitly still goes
  through resolution, so naming an organization by its natural key keeps working.

  Reported by `apps/ee-tenant-crm-showcase` in the cloud repo, which reproduces
  the whole path end-to-end: two organizations over one database, each replaying
  the artifact's seed datasets into its own private copy.

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

- e474853: fix(security): `sys_session.token` stops serializing on the data API — `internal: true`, with the write-response strip relocated to the generic-data-path ingress (#7823)

  <!-- adr-0087: not-required (no-migration-prescription) One field-level flag added
  to one existing declaration, plus an internal relocation of where that flag's
  write-response half is enforced (engine write sites → the metadata-protocol
  ingress). Nothing authorable is renamed, retired or tombstoned, so there is no
  conversion to register. The behavioural changes are that a field which already
  DECLARED it was never exposed stops being exposed, and that better-auth's
  session-lifecycle routes keep working while it does. -->

  `sys_session.token` — the **live bearer credential** for an active session —
  declared `description: 'Opaque session token — never exposed in UI'` and then
  serialized anyway on the generic data path.

  **Scope the persona precisely: this is an ADMIN-CROSS-USER disclosure**, not an
  any-authenticated-caller one. Measured on a real engine (`bootStack(showcaseStack)`,
  in-process HTTP + sqlite-wasm):

  - **admin**, `GET /data/sys_session` (list) — 200, `token` present on every row,
    the admin's own **and every other user's**;
  - **admin**, `GET /data/sys_session/{another user's id}` — 200, that member's
    token verbatim;
  - **admin**, `?select=id,token` — 200, present;
  - anonymous — 401, fully denied;
  - member — self-scoped reads only, and a cross-user get-by-id still answers
    **404**: the `sys_session_self` RLS policy was already holding that line and
    is untouched here.

  **Why this is more than exposure.** The sibling column closed by #7728
  (`sys_api_key.key`) is a stored SHA-256 hash. This one is not: the disclosure was
  **replay-proven** — a member's token, taken exactly as it came back to the admin
  off the data API, authenticates as that member when sent as
  `Authorization: Bearer <token>`. So the defect was admin-to-member
  **impersonation**, and any admin-adjacent read (an integration, a leaked admin
  API response, a support tool) inherited it.

  **The fix is one declaration plus one relocation** (maintainer ruling
  2026-08-13, "A-prime + compose"):

  - `sys_session.token` is declared `internal: true` — the opt-in,
    type-independent flag minted by #7728 meaning _the declared value is never
    returned on the generic data path_. The engine's READ-path strip is
    unchanged and closes the disclosure.
  - The flag's **write-response** half moves out of the engine's insert/update
    result paths — where it conflated "never on the generic data path" with
    "never returned to the engine-level writer" and broke `signIn`/`signUp`
    (better-auth reads the minted session row back off the insert result) —
    into the **generic-data-path ingress**: every `*Data` write face in
    `@objectstack/metadata-protocol` routes its response records through the
    single exported helper `omitInternalFieldsFromWriteResponse`, held there by
    a tripwire test that enumerates the ingress surface and fails on any face
    the sentinel reaches (or any new `*Data` face with no recipe). The
    `sys_api_key.key` PATCH-body closure (#7728's fourth surface) is preserved
    at the ingress, byte-for-byte for callers. `@objectstack/rest`'s
    cross-object batch update — the one write mouth outside the protocol —
    applies the same shared strip.
  - better-auth's session-lifecycle readbacks (revoke-other-sessions,
    sliding-expiry refresh, expired-session cleanup) read `token` back off
    adapter find results, which the read strip starves — measured:
    `POST /auth/revoke-other-sessions` answered `200 {"status":true}` while the
    other session kept authenticating. The adapter now re-attaches the token
    through `Engine.resolveInternalField` (#8118's privileged batch accessor) —
    no engine carve-out, no second accessor. Plain bearer validation never
    needed the readback and is untouched.

  `hidden: true` was never the broken contract (spec defines it as "Hidden from
  default UI", never as "stripped from serialization"); the broken contract was the
  field's own description.

  **Not retyped, deliberately.** `Field.secret` would encrypt at rest and replace
  the column with a `sys_secret` ref, destroying the by-token session lookup
  better-auth performs on every authenticated request — it would break
  authentication in order to fix a disclosure. `Field.password` is inert here: the
  read mask skips `password` on `managedBy: 'better-auth'` objects, and it collects
  by **TYPE** regardless, which a `text` column never satisfies. Two independent
  barriers, so the column stays `text`.

  **Storage, filtering and indexing are untouched** — the strip runs on the rows the
  driver has already produced, after the predicate has been evaluated and the unique
  index on `token` used. The regression proof drives both directions: sessions still
  mint, the minted bearer still authenticates (`GET /auth/get-session` ⇒ 200), a
  `where: { token }` lookup still resolves the row server-side while that same row
  comes back with no `token` key, and revoke-other-sessions / expired-session
  cleanup are pinned on the ROW they act on, not the status code that lied.
  Without those, a change that simply broke authentication would satisfy every
  "absent" assertion.

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

- 6443b79: fix(data): the dotted-path `400 INVALID_SORT` hint prescribes a **stored** field, not a formula (#6924)

  `assertSortFieldsExist` refuses a dotted `orderBy` (`?sort=account.company_name`)
  and then told the author how to fix it: _"Denormalise the value onto '<object>'
  (a formula or rollup field that copies it into a real column) and sort by that."_
  That prescription cannot be built. Following it lands the author back inside the
  exact silent degradation the refusal had just saved them from.

  Measured on a REAL `SqlDriver` (better-sqlite3) and on `InMemoryDriver`, with a
  `formula` field named directly in `orderBy` (non-dotted, so this gate lets it
  through):

  ```
  control   orderBy title asc     -> A B C D E      a real column really sorts
  baseline  no sort               -> C A E B D      insertion order
  orderBy   <formula field> asc   -> C A E B D  200 insertion order
  orderBy   <formula field> desc  -> C A E B D  200 direction-blind
  ```

  A `formula` field is virtual — `SqlDriver.createColumn` returns early for it and
  no column is created (sqlite answers `no such column`), the engine evaluates the
  expression _after_ the driver returns, and the #3821 unknown-column backstop
  retries WITHOUT the sort. The response is `200`, every row present, order
  arbitrary: the failure mode #4226/#4256 exist to stop.

  The hint now reads: _"Denormalise the value onto '<object>' (a stored field,
  written when the source changes) and sort by that. Not a formula field: it is
  virtual, no driver materialises a column for one, and ORDER BY on it is silently
  dropped."_ — "stored" being the same word #6673 landed for the identical
  correction on the search axis.

  `rollup`/`summary` is dropped from the hint for a different reason, and the
  measurement is worth recording because it contradicts the reported diagnosis: a
  `summary` field **does** get a real, maintained column (`orderBy <summary> desc`
  returned `E D C B A` over values `5 4 3 2 1`), so it is not unmaterializable. It
  simply cannot do this job — a rollup aggregates CHILD records
  (`count`/`sum`/`min`/`max`/`avg`) and so cannot carry a looked-up parent's column
  onto the queried object.

  **This overturns a recorded decision.** #4256 (closed `completed`) explicitly
  chose the "formula or rollup" wording as its remedy for dotted-path sort, and its
  own still-pending changeset (`sort-dotted-path-rejected.md`) describes it; that
  file is left as the accurate record of what #4256 shipped, and this entry
  supersedes its prescription. `content/docs/protocol/objectql/query-syntax.mdx`
  ("Sorting on Related Fields") taught the same denormalization and is corrected in
  the same change, so code and docs stop agreeing with each other about something
  untrue.

  Not fixed here, filed separately: the platform still accepts a **non-dotted**
  `orderBy` naming a `formula` field and answers `200` in arbitrary order. That is
  an engine/driver-side refusal question, not hint text.

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

- dca25e1: fix(metadata-protocol): `SysMetadataRepository` 的 `event_seq` / `version` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4867)

  `SysMetadataRepository.nextEventSeq()` 与 `nextItemVersion()` 各有一个同形的 `catch`,把读
  `sys_metadata_history` 的**全部**失败折成同一个答案:

  ```ts
  } catch {
    // Table not provisioned yet (fresh DB) — start at 1.
    return 1;
  }
  ```

  这是 #4825 刚在 `DatabaseLoader`(TSDoc 自称 legacy、非事务的那条路径)上修掉的形状,原样长在
  **canonical 路径**上 —— #4825 正文把 `SysMetadataRepository` 称作「历史写入应当收敛过去的地方」。
  而且这里有两个数字:

  - **`event_seq`** —— 历史排序与 rollback 定位的依据。表里已有 N 行时,一次瞬时读失败(连接抖动、
    超时、权限)让下一条拿到 `1`,与既有行撞号;
  - **`version`** —— `nextItemVersion()` 的 TSDoc 明说它刻意从 history 取 MAX「so delete + recreate
    continues incrementing instead of restarting at 1」。一次读失败正好把它**恢复成它明确要避免的那个
    行为**:lineage 从 1 重启并与既有 lineage 撞号,而 `MetadataManager.rollback(type, name, version)`
    与 `POST /api/v1/meta/:type/:name/rollback` 正是按这个数字定位快照 —— 撞号之后回滚可能落到另一条
    记录的同号版本上。

  关键危害与 #4825 相同,是「**落盘的字节是错的**」而不是「字节没落盘」:insert 成功、日志一行没有、
  系统对外完全正常,重试不修、重启也不修。

  **「在事务里」并不能挡住它。** 事务解决的是*并发*撞号;它对「从一次失败的读推导出来的数字」没有任何
  意见,一个成功提交的事务照样把错号提交得同样持久。事务真正给出的是干净的补救:抛出去,整笔写入回滚,
  而不是提交一个编造的号。

  现在按**错误类型**判别,复用 #4825 落地的那套判别器(不另起一套):

  - **良性的「表还没建」** —— 没有行,就没有可撞的号,`1` 确实是下一个号,静默返回,fresh DB 照常启动;
  - **其余一切读失败** —— 按 AGENTS.md「Degradation log levels」以 `error` 上报**后果**(写入已被中止、
    事务回滚、什么都没提交;若按旧行为发 `1` 会与既有行撞号,使版本顺序不可信、回滚目标可能指向另一条
    记录的同号版本,且无人能发现、重启也修不回来)与**修复动作**(修数据源/驱动错误后重试写入),然后
    **原样抛出**,让事务回滚。一次故障只说一次,恢复时补一条 `info`。

  ### `@objectstack/metadata` 新增子路径导出 `@objectstack/metadata/errors`

  判别器 `isMissingTableError()`(#4728/#4825 家族)此前是 `@objectstack/metadata` 的内部工具,而本次
  消费者在另一个包。三个选项中选了「从现有归属地**显式导出**」:在 `metadata-protocol` 里复制一份会重建
  #4825 刚消灭的双源问题(同一个问题两套「哪些驱动错误算良性」的词汇表,谁先学会一个驱动怪癖谁就先漂移);
  下沉到公共依赖本轮不可行(`packages/spec` 冻结、`packages/types` 有并行改动),且本次导出并不妨碍维护者
  之后再下沉。

  新增的是一个**叶子子路径**而不是包入口导出:`@objectstack/metadata` 的根入口会拖进 manager、全部
  loader 与其 YAML/文件系统依赖,只为一个 40 行谓词付这个重量,正是把下一个作者推回「复制一份」的原因。
  `@objectstack/metadata/errors` 只 re-export 一个叶子模块,跨包依赖边因此仍是叶子边,也是将来下沉时
  一个可 grep、可删除的单点。仅导出 `isMissingTableError`;同族的 `isSchemaAlreadyExistsError` 在包外
  没有消费者,保持内部(导出一个无人 import 的符号是白许的承诺)。

  无 API 破坏、无 schema 变更、无 `packages/spec` 改动。

- 52d1a7d: Fix commit-revert answering `VERSION_NOT_FOUND` over a row `/history` lists, and the package-level revert route answering 500

  **Revert (`revertCommit` / `rollbackMetaItem`).** Both revert callers resolved their overlay repository from the caller's _active organization_, while the publish that recorded the commit routes each draft to the draft's **own** scope (the ADR-0005 / #3115 rule `SysMetadataRepository.listDrafts` states, and `publishPackageDrafts` already follows). So an env-wide artifact — what Studio and AI authoring write — published from a console request carrying an active org stored its `sys_metadata_history` rows at `organization_id = NULL` and was then read back at `organization_id = <org>`: no match, and the revert answered `VERSION_NOT_FOUND: No history row at version 2` for a version the history endpoint lists. The revert now resolves the scope the item's lineage actually lives in (the caller's own overlay first, env-wide second), per item for a batch revert. The same resolution reaches the `#6602` registry heal and the `#4636` package-binding read, which an org-scoped revert of an env-wide row was previously skipping while reporting success.

  **`POST /packages/:id/revert`.** The route now answers a declared 4xx instead of 500 (ADR-0112). The cause was entirely in the thrown shape, not the route: `MetadataManager.revertPackage` threw bare `Error`s carrying no `code` or `status`, and `errorFromThrown` — which the route's handler already reaches through one enclosing `catch` — falls back to 500 only when it finds neither. An unknown package id now answers `RESOURCE_NOT_FOUND` / 404 and a never-published package `RESOURCE_CONFLICT` / 409; 500 remains only as the fallback for a genuinely unexpected throw.

- ecd83fd: fix(metadata-protocol): uninstall no longer orphans a package's env-wide `sys_metadata` rows (#7705)

  `protocol.deletePackage` selected the rows to remove with a strict
  `organization_id` equality:

  ```ts
  const where = { package_id: request.packageId };
  if (request.organizationId) where.organization_id = request.organizationId;
  ```

  Against rows stored **env-wide** (`organization_id IS NULL`) that predicate
  matches nothing, so an uninstall issued by a session with an active
  organization removed only whichever rows happened to be org-scoped and left
  every env-wide row behind — while reporting a nonzero `deletedCount` and
  `success: true` over the survivors. The package's metadata stayed in
  `sys_metadata` after its uninstall "succeeded", and a reinstall then collided
  with the rows that were never removed.

  Env-wide is where a package's metadata normally lands, which is why this was
  the common case rather than a corner: the REST `PUT /meta/:type/:name` save
  path does not thread the session's active organization, and AI-authored
  metadata is written env-wide too. Measured on a real engine over SQLite, an
  org-scoped uninstall of a package holding three env-wide rows and one
  org-scoped row deleted **1 of 4** and reported success.

  An org-scoped uninstall now matches its own organization **or** env-wide, the
  same `$or [{organization_id: oid}, {organization_id: null}]` shape this package
  already uses for the #3115 "orphaned draft" fix, and the same shape the SQL
  driver's own implicit tenant wall uses (`field = :tenant OR field IS NULL`,
  #2734).

  Scoping is unchanged in both directions that must not widen: another
  organization's rows for the same package are still out of scope for an
  org-scoped uninstall, and another package's rows are never touched. An
  uninstall issued with **no** organization is also unchanged — it stays
  package-wide, because the direct-mount REST door passes no organization at all
  and narrowing that branch to env-wide-only would orphan every org-scoped row
  instead.

- 38f53a0: fix(metadata-protocol): `updateMany` classifies an id-less row as a caller error, matching `batchData`'s update branch (#5100)

  `runUpdateManyLoop` lacked the `!record.id` guard #4793 gave `runBatchDataLoop`'s
  update branch, so the two by-id update faces classified the same malformed row
  differently: `VALIDATION_FAILED`/400 on batch, but on `updateMany` the row fell
  through to the #5088 existence probe as `{ id: undefined }` and came back
  `RECORD_NOT_FOUND`/404 with `undefined` interpolated into the message — a
  request-shape error reported as a data-state one, with the row's fate left to
  each driver's undefined-where-key handling.

  Not reachable over REST (`UpdateManyRecordSchema` requires `id`, #3939) — the
  change is observable only to in-process callers of the protocol method, whose
  id-less rows now answer `VALIDATION_FAILED`/400 (`Record id is required for
update`) before any engine round-trip, identically on both faces (#4620: one
  classification per file, enforced by a cross-face parity test). `record.data`
  handling is aligned to the batch branch's `record.data || {}` in the same
  change.

- ad5fe25: fix(spec,objectql,metadata-protocol): a `user` field carries its target in the TYPE — bare `{type:'user'}` is not targetless

  `field.zod` defines `user` as "a lookup specialized to the `sys_user` system
  object … target fixed to the `sys_user` system object", and `Field.user()` —
  unlike `Field.lookup(reference, …)` — takes no target argument and writes
  `reference: 'sys_user'` itself. The target is a constant of the type.

  Two callers read `field.reference` raw and so disagreed: the protocol's expand
  gate refused `?expand=<a bare user field>` with `400 INVALID_FIELD … declares no
target object`, and objectql's expand loop skipped it. Metadata authored without
  the redundant `reference` — hand-written JSON, an AI author, a Studio form — was
  read as under-specified when it was complete. Live capture (cloud#983): an
  AI-built app's very first screen rendered an error page over that 400.

  New: `referenceTargetOf` in `@objectstack/spec/data` — the single arbiter of
  "what does this reference field point at", next to `REFERENCE_VALUE_TYPES` (the
  set those same two callers already share for "is this a reference at all"). Both
  halves of the expand path read it, so the gate can no longer refuse a field the
  engine would have expanded, nor bless one it skips.

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

- 0e1f667: fix(metadata-protocol): expand a runtime-authored `defineView` container so the views it declares are actually served (#7736)

  Publishing views through the runtime metadata API using the documented
  `defineView` container shape succeeded at every step and produced nothing a user
  could see. `PUT` the container to the draft endpoint, `POST` to publish, then
  query the object — an empty list. Reading the row directly by name returned the
  full body, badged `_diagnostics.valid: true`, and a server restart changed
  nothing.

  **Why.** "Object has-many View" (ADR-0017 §2, §3.2) makes container ingestion
  **dual-read**: register the container under the bare `<object>` key for
  back-compatible single-item reads, _and_ register every named view as an
  independent `ViewItem` under `<object>.<viewKey>`. Only the expanded items carry
  the `viewKind` + `object` pair that every object-bound read path filters on, so
  the expanded layer — never the container — is what `GET /meta/view?object=`,
  `getViewsByObject()` and the view switcher actually read.

  Both **source** registrars do this: the ObjectQL boot loop (`engine.ts`) and the
  metadata artifact/HMR loader (`plugin.ts`). The **runtime** door did not. A
  container written through it was stored verbatim, carrying neither `object` nor
  `viewKind`, and `getMetaItems` then dropped it from enumeration — correctly, on
  its stated assumption that "the registrar expands it into independent
  ViewItems". For a runtime-written row no registrar ever had, so the container was
  filtered out and the expansion it was filtered out _in favour of_ did not exist.
  Measured on the card's repro: the stored container expands cleanly to two items
  that would match the switcher, and both object-bound exits answered zero.

  **Where the fix goes.** At `hydrateOverlayIntoRegistry` — the one choke point all
  three runtime hydration callers already share (boot `loadMetaFromDb`, read-side
  `getMetaItems`, write-through `applyRegistryWriteThrough`). That matters,
  because there are **two independent object-bound readers**: the REST route reads
  through `getMetaItems`, while `getViewsByObject()` reads `MetadataManager.list`.
  Expanding at either read exit fixes the card's literal repro and leaves its
  sibling answering empty. One expansion at the shared seam serves every reader,
  survives a restart, and keeps read-your-writes — the "single, universally-applied
  location" #7163 asked for after the same defect was closed one seam further in.

  The canonical-shape filter is deliberately **left alone**. Its invariant — a
  container's expanded items are also present — is precisely what was false here,
  and this restores it rather than loosening the filter, which would surface the
  legacy wrapper shape to every list consumer (Studio list, REST, AI retriever)
  and still show the switcher nothing, since a container carries no `viewKind`.

  Nothing extra is persisted: the container is still stored as exactly one
  byte-identical row and the ViewItems are derived on hydration, so an edited
  container cannot leave stale expanded rows behind. An already-independent
  `ViewItem`, a non-view type, and an object with no container authored are all
  unaffected — pinned, along with the headline behaviour, in
  `view-container-runtime-expansion.test.ts`.

- 3d4c545: fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

  `sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

  现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

  - **名额可回收**——归档视图不再占用名额，同名视图可以重建；
  - **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
  - **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
  - **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

  `metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

  已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。

- bb7cb41: fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

  #5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
  as a runtime partial UNIQUE index, and deliberately changed only the index's
  **row scope** — that is what made it strictly weaker than the index it replaced
  and therefore incapable of failing on existing data. It also left the other
  half of the same index broken, and pinned that gap honestly rather than closing
  it.

  SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
  views and `organization_id` is NULL for environment-level ones, so
  `(name, organization_id, owner)` constrained **personal views only**. Measured
  on real SQLite over the driver's own DDL:

  ```text
  two ACTIVE personal views, same (name, org, owner) : REJECTED
  two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
  two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
  ```

  Two same-name shared views inside one tenant were therefore reachable, while
  `name` is declared as the globally unique qualified view id (`object.viewKey`)
  — so the view switcher, which aggregates and de-duplicates by `name`, and every
  read path that locates a view by name, had no defined answer about which row
  they got.

  **What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
  The same runtime migration materializes the key NULL-safe, folding each nullable
  part's NULLs into one bucket that is unique among itself:

  ```sql
  CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
    (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
    WHERE state = 'active'
  ```

  Both spellings are copied from an existing in-repo precedent rather than
  invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
  column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
  `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
  discriminator. Neither can collide with real data — an organization id may never
  equal `'__global__'`, and an owner is a user id, never the empty string.
  **Storage is untouched**: rows keep their NULLs, only the index folds them, so
  `WHERE owner = ''` still matches nothing.

  Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
  shared views too), a shared view and a personal view may still share a name, and
  so may two tenants' or two environments' rows.

  **This is a tightening, so it can fail to build.** Unlike #5839, rows that
  violate the new key exist in the wild today, precisely because nothing rejected
  them. The migration probes before it replaces anything, and on a conflict takes
  ADR-0120 D4's disposition: the previous index is left in place (the table is
  never left unconstrained), the report names the key that is not enforced, ships
  the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
  points at `os migrate plan` — and the boot continues. Resolve the duplicate
  active shared views, restart, and the tightening applies itself.

  Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
  composite, which is ADR-0120 D3's own degradation. That report is **raised from
  `info` to `error`**: under #5839 alone the dialect lost slot recycling, a
  functional degradation the next user hits immediately, but it now loses an
  integrity guarantee the platform states it enforces while continuing to look
  healthy — AGENTS.md's durability arm. The line names both gaps that stay open
  there and the duplicate-listing query. The unclassifiable-failure arm is raised
  with it, so the failure nobody can name is never reported more quietly than the
  one that has a name.

- 50a8d11: fix(metadata-protocol): the view-definition conflict report's remedy query now runs on PostgreSQL, not only SQLite (#6772)

  `buildDuplicateProbeSql()` — the query `ensureViewDefinitionActiveIndex` ships
  **inside** its `error`-level degradation report, as ADR-0120 D4's "name the
  offending rows" — projected two bare columns while grouping by only their
  `COALESCE` forms:

  ```sql
  SELECT name, organization_id, owner, COUNT(*) AS duplicate_rows
  FROM sys_view_definition WHERE state = 'active'
  GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '')
  HAVING COUNT(*) > 1
  ```

  PostgreSQL requires every non-aggregated projection to appear **verbatim** in
  `GROUP BY`; wrapped in an expression does not count. So the query an operator is
  handed fails with

  ```text
  ERROR:  column "sys_view_definition.organization_id" must appear in the GROUP BY
          clause or be used in an aggregate function
  ```

  on one of exactly **two** dialects that can build the partial index the report is
  explaining. The operator copy-pastes the remedy out of an error message and gets
  a second error instead of the conflicting rows. SQLite accepts the bare form,
  which is why the existing real-SQLite test stayed green and the defect shipped;
  MySQL/MariaDB reaches the same string through the `unsupported` arm.

  Each folded column is now projected through its own `COALESCE` under a bucket-key
  alias — the shape `overlay-index.ts`'s `buildOverlayDuplicateProbeSql()` already
  uses for the sibling migration (#6770):

  ```sql
  SELECT name, COALESCE(organization_id, '__global__') AS organization_id_key,
         COALESCE(owner, '') AS owner_key, COUNT(*) AS duplicate_rows
  FROM sys_view_definition WHERE state = 'active'
  GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '')
  HAVING COUNT(*) > 1
  ```

  Every bare projection is now a bare `GROUP BY` term, so the query is legal on
  both dialects. The projection and the `GROUP BY` are built from the same array,
  so they cannot drift apart again. Nothing is lost by reading bucket keys instead
  of stored values: neither sentinel can occur in real data, so
  `organization_id_key = '__global__'` means `organization_id IS NULL` and
  `owner_key = ''` means `owner IS NULL`.

  The function's "Dialect-neutral: `COALESCE`, `GROUP BY` and `HAVING` are ANSI on
  every engine this platform runs on" comment was true about the three constructs
  and false about the query built from them; it now states the projection rule the
  query has to satisfy, and why the real-SQLite test cannot see it.

  No behaviour change to any index, write path or status: only the text of the
  remedy query inside the two degradation reports.

- c9bf940: fix(metadata-protocol): 对象 overlay 写路径按真实 package id 记录 registry 归属,并由服务端强制盖 `_provenance: 'org'`

  `applyObjectRegistryMutation` 此前把每一次对象写入都硬编码登记在 `'sys_metadata'` 哨兵下。
  该归属键同时就是包过滤键(`SchemaRegistry.getAllObjects(packageId)` 匹配的是
  `contributor.packageId`),因此通过 Studio 包工作区新建的对象,在自己所属包的过滤结果里
  一直是空的,直到有别的路径重新登记它。现在改为使用该行真实的 `package_id`;哨兵只保留
  给「没有绑定任何包」的写入,`rollbackMetaItem` 则从行本身读出绑定(而不是从请求读)。

  同一次改动里,服务端在**副本**上无条件盖 `_provenance: 'org'`,不再采信请求体里的值:
  只搬归属键而不盖章会立刻复活 cloud#970 —— `applyProtection` 会把带包 id 且自身没有
  provenance 的 body 默认标成 `'package'`,`getArtifactItem` 据此认定它是代码制品,
  `object` 又声明了 `allowOrgOverride: false`,于是用户刚建好的对象在下一次保存时收到
  `403 not_overridable`。`metadata-read-decorations.ts` 有意不剥离 `_provenance`,
  Studio 的 GET → PUT 往返会把它原样送回,所以这个事实必须由服务端陈述。

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
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [0800433]
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
- Updated dependencies [85a966f]
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
- Updated dependencies [c1e67e0]
- Updated dependencies [1bd5652]
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
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
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
- Updated dependencies [9dcc0ae]
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
- Updated dependencies [9f5cc79]
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
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [533a0a4]
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
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e9b5265]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [c4ab50b]
- Updated dependencies [3133cda]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
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
- Updated dependencies [d0e5537]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [c794f78]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
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
- Updated dependencies [641363a]
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
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [55da611]
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
- Updated dependencies [0f17114]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [ecc61ab]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [db0d53c]
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
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
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
- Updated dependencies [06ffad3]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [d5e9f6e]
- Updated dependencies [e48d861]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [d4a687a]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [38182ff]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [d4edb5d]
- Updated dependencies [5524f84]
- Updated dependencies [a648e96]
- Updated dependencies [af5b96b]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [eb26126]
- Updated dependencies [be59695]
- Updated dependencies [91f4c78]
- Updated dependencies [b0e5a37]
- Updated dependencies [169b58a]
- Updated dependencies [fd7cfde]
- Updated dependencies [b2e1057]
- Updated dependencies [9bf4588]
- Updated dependencies [ec6fad8]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [01fd9e1]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [cafec0a]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [c4df271]
- Updated dependencies [729a43a]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [459f925]
- Updated dependencies [c7e7900]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
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
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [10575f3]
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
- Updated dependencies [123067c]
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
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [5d3ced9]
- Updated dependencies [4b50be4]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [90336e6]
- Updated dependencies [461ccda]
- Updated dependencies [7d80695]
- Updated dependencies [7f4a8a1]
- Updated dependencies [4bda5f8]
- Updated dependencies [8b82686]
- Updated dependencies [d06b3dc]
- Updated dependencies [a5ca08d]
- Updated dependencies [5582e18]
- Updated dependencies [58f3220]
- Updated dependencies [424c510]
- Updated dependencies [6ce10bd]
- Updated dependencies [f022c4d]
- Updated dependencies [f238970]
- Updated dependencies [5087ac6]
- Updated dependencies [8e53e5d]
- Updated dependencies [ade7be4]
- Updated dependencies [06fc07a]
- Updated dependencies [61fde5e]
- Updated dependencies [2343099]
- Updated dependencies [7618ee8]
- Updated dependencies [6965160]
- Updated dependencies [ecff951]
- Updated dependencies [df72328]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [95b4f0d]
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
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [ac6c0be]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [1da39f5]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [f2b8ac9]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [beefe89]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [2f1e2a5]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [018d22c]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [f012f55]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [b821b29]
- Updated dependencies [af96af6]
- Updated dependencies [4e9e184]
- Updated dependencies [9960cd2]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [fda61e4]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [17749fc]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [5b8f95b]
- Updated dependencies [cb43296]
- Updated dependencies [e1f2d8e]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [78ed1f4]
- Updated dependencies [19bca8c]
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
- Updated dependencies [cc2de0e]
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
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [73580e7]
- Updated dependencies [a34fd2e]
- Updated dependencies [9555b07]
- Updated dependencies [8db4587]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [4340f13]
- Updated dependencies [7fec5d6]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [cd584d5]
- Updated dependencies [65f184b]
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
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [9bc846b]
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
- Updated dependencies [bf1edef]
- Updated dependencies [ca522e9]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [da1a64c]
- Updated dependencies [5e3c83b]
- Updated dependencies [d25a0ec]
- Updated dependencies [4b945fc]
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
- Updated dependencies [7967133]
- Updated dependencies [59e9b7c]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [ba5e957]
- Updated dependencies [e41c1f2]
- Updated dependencies [fc87586]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [29ff3c2]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [95829a0]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [ddd6650]
- Updated dependencies [54299ca]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
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
- Updated dependencies [3de535b]
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
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [dca25e1]
- Updated dependencies [6b441a8]
- Updated dependencies [c073b8c]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [8599c21]
- Updated dependencies [60f0dd8]
- Updated dependencies [52d1a7d]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [078e28b]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [7309c81]
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
- Updated dependencies [20963e7]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [e92e2c3]
- Updated dependencies [a0fdc56]
- Updated dependencies [946a131]
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
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [1bb679c]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [89be40c]
- Updated dependencies [92e13a0]
- Updated dependencies [cdbffca]
- Updated dependencies [333769d]
- Updated dependencies [ea8e849]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/lint@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/metadata@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Major Changes

- debe2f6: refactor(spec)!: `api` is code-only — withdraw a runtime create door the endpoint matcher could never read (#5488, ADR-0049 remove side)

  <!-- adr-0087: registered api-runtime-create-withdrawn -->

  **FROM → TO:** `PUT /api/v1/meta/api/{name}` (200 "Saved") → declare the endpoint as a
  stack artifact (`**/*.api.ts`, or `defineStack({ apis })`) and ship it through
  `publishPackage`. The runtime write now answers **403 `NOT_CREATABLE`**, in `?mode=draft`
  as well as direct-active. The artifact route is **unchanged** — a `**/*.api.ts` file valid
  before this release is valid after it, byte for byte.

  `DEFAULT_METADATA_TYPE_REGISTRY`'s `api` entry declared `allowRuntimeCreate: true` and the
  runtime never honoured it. Measured on a real showcase boot (`objectstack dev --fresh`, 47
  plugins):

  ```
  PUT /api/v1/meta/api/e8_backdoor   → 200 {"success":true,…,"message":"Saved …"}
  GET /api/v1/apps/showcase/backdoor → 404      (anonymous AND authenticated)
  ```

  …and **no** `[EndpointMatcher] … EXCLUDED` line anywhere in the boot log: the endpoint was
  not gated out, it was never in the index at all. The serving criterion belongs to
  `IMetadataService.matchEndpoint` → `EndpointMatcher` → `MetadataManager.listForIndex('api')`,
  which reads the manager's own registry plus its registered loaders
  (`["filesystem","memory"]` on dev/serve). A runtime write lands in `sys_metadata`, which is
  in neither. So the declaration promised a capability that could not exist.

  A declared-but-unhonoured capability is ADR-0049 false compliance, and "answers Saved, then
  404s forever" is its most dangerous shape for the AI authors ADR-0033 targets. The
  maintainer ruled REMOVE on 2026-08-07 rather than converge the read path: making the matcher
  read `sys_metadata` re-opens cache, invalidation, tenancy and the ADR-0110 D3
  miss-vs-outage distinction on a new read path, and there is no business pull for
  Studio-authored endpoints today — 17.x serves declarative endpoints through stack artifacts,
  which is what showcase uses (#5040 E8, LIVE).

  ## The retirement kit

  - **`allowRuntimeCreate: false`** on the `api` registry entry. With `allowOrgOverride`
    already `false`, the type is now **code-only** — the `job` / `agent` / `capability` shape —
    so the existing #5086 inlet refuses before persistence, on every kernel, with
    `code: 'NOT_CREATABLE'`, `status: 403` and a prescription derived from the entry's own
    `filePatterns[0]`. No new refusal mechanism was written for this.
  - **`gateApiDraftsForPublish` is retired** (`metadata-protocol`), together with its nine
    tests and the `PUBLISH_DRAFTS_NAMESPACE_REMEDY` string only it appended. It landed two
    days earlier in PR #5279 and is removed **deliberately and on the record**, not lost in a
    refactor: it gated a draft→active promotion into a state the matcher can never read, and
    with the inlet closed no `api` draft can exist for it to judge. The in-place comment at
    its old call site carries the reasoning.
  - **The `metadata-plugin.zod.ts` decision block is rewritten as a recorded overturn.** It
    used to record CODE-ONLY as "considered and rejected"; its three bullets are kept verbatim
    with what became of each, so the reversal is auditable rather than silently contradicted.
  - **The `api` create seed is removed** and `api` joins `KNOWN_UNSEEDED`. A pre-filled "New
    API Endpoint" form whose save can only 403 is the UI half of the same false compliance.
  - **Pins, not deletions.** The two #5271 tripwire pins that asserted
    `allowRuntimeCreate: true` are **replaced** by retirement pins asserting the new verdict —
    their comments predicted this exact consequence, and both predictions were correct. Every
    rejection case asserts `code` **and** `status` (ADR-0112 envelope), never `toThrow()`
    alone (#6142).

  ## What did NOT change

  `validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure` remain the one judge
  of what is servable, on the route that serves: the stack schema, `publishPackage` (#5189),
  and again at load in `buildEndpointIndex` (PR #5203). ADR-0121's "publish REJECTS" ruling is
  intact. `deleteMetaItem` stays ungated so pre-existing rows can be cleaned up, and
  `OS_METADATA_WRITABLE=api` remains the single operator escape hatch — note it unlocks the
  **write** only; the endpoint still will not be served, which is why it is a diagnostic
  rather than a workaround.

  **Re-entry path**, recorded by the ruling: if #2657 Part B promotes `apis` to a registered
  type **with a real consumption path**, the flag and the publish gate come back together —
  implementation first, declaration second.

### Minor Changes

- f16e54e: ADR-0029 D9: a tenant object overlay registers as its own contributor LAYER instead of splicing the packaged owner out

  租户对 `object` 的定制（`sys_metadata` 行）此前以默认的 `own` 身份进入 `SchemaRegistry`。当该行的 `package_id` 与代码包所有者相同时，`registerObject` 会走"重复注册"分支把**打包的 contributor 直接摘掉**——打包定义不是被遮蔽，而是在写入时被销毁，注册表里不存在第二份副本；`loadMetaFromDb` 每次启动都无声重放这次销毁。

  D9 把这个层次关系显式化：

  - **第三种非拥有的 contributor 种类 `overlay`**，对基础层是替换语义。解析变成 `base = overlay ?? own`，extender 照旧叠在上面。**解析结果逐字节不变**（含 `_provenance: 'org'`）——变的只是注册表"记得"什么：打包的 owner 依然在下面。
  - `assertSingleOwnerPerObject` **一字未改**（overlay 不是 owner），新增一类违规：孤儿 overlay（有 overlay 没有 owner）。
  - **基础层的选择问"种类"，永远不问优先级**。`DEFAULT_OVERLAY_PRIORITY = 150` 只用于列举顺序：extender 的优先级是作者声明的，不能让某个包用 `priority: 140` 把租户的 overlay 挤出基础层。
  - **artifact 身份改为读 owner contributor 的层**，而不是合并后的文档。这一条不是层次化改动的自然推论：合并结果按设计仍带 `_provenance: 'org'`，所以只有从 owner 层读，`isArtifactBacked` 才不再说谎。
  - `provisionPrimary` / `provisionSearchCompanion` 的门从"是不是 `own`"改成"**是不是基础层**"，否则每个被 overlay 的对象的 `nameField` 都会变。
  - 行上的 `package_id` 是层的**来源标记**，从来不是所有权主张：同包正常；**无包（`sys_metadata` 哨兵）予以接受**（此前的抛错是借用 `own` 槽位的副产品）；绑定到**其他包**的行在生产者侧被明确拒绝，新错误码 `OBJECT_OVERLAY_PACKAGE_MISMATCH`（422），启动时计入 `loadMetaFromDb` 的 `errors`。
  - **迟到安装**：代码包为一个租户行已占据的对象名注册时，代码层成为 owner，租户的贡献被重新归类为它的 overlay 层——不再抛 "already owned by"，也不再把租户的定制吞掉。
  - 删除退化为**减法**：`SchemaRegistry.removeObjectOverlay(name)` 只摘掉 overlay 层，打包 owner 原地不动，因此"恢复"根本不是一次重新注册。

  **行为变化（记录在案的成本）**：谓词诚实之后，`object` 声明的 `allowOrgOverride: false` 会被**一致地**执行——对打包对象的 overlay 写入**每次**都以 `NOT_OVERRIDABLE` 拒绝，而不是只拒第一次（此前第一次被拒、并因销毁证据而让后续每次都从 `allowRuntimeCreate` 那一档混过去）。同一谓词也喂给 `deleteMetaItem` 的两档鉴权与仓库的 `assertAllowed`，所以重置该定制同样需要那道文档化的运维口子 `OS_METADATA_WRITABLE=object`——现在它必须在定制的**整个生命周期**内保持打开，而不只是第一次保存时。

  `ObjectContributor.ownership` 与 `ObjectOwnershipEnum` 的联合类型因此加宽（loader 设定，永不可由作者书写），这是 `objectui` / `cloud` 消费方可见的公开类型变化。

- 3028326: fix(metadata-protocol,objectql): the #4463 runtime authoring gate now runs on every kernel that has not declared itself the package author's channel (#6710)

  The 26 shared author-time rules (`AUTHORING_RULES` — the same table `os validate`
  / `os build` / `os lint` run) were gated behind
  `if (this.environmentId === undefined) return;`. That short-circuit was meant to
  be ADR-0005's "the package author's own bootstrap channel" carve-out, and the
  carve-out itself is legitimate. The key was not: `environmentId` is a ROW-SCOPING
  key, and two very different topologies leave it undefined.

  **The defect.** The CLI's lightweight host-config assembler — `serve.ts`'s
  `config.objects && !hasObjectQL` auto-register branch, which constructs
  `new ObjectQLPlugin()` with no options — also boots with no `environmentId`.
  That is the shape any `objectstack.config.ts` with instantiated plugins gets
  (`isHostConfig` → `shouldBootWithLibrary === false`), including the flagship
  showcase app. Its `PUT /api/v1/meta/*` is an **end-user** surface, so a
  self-hosted app server ran **zero** of the 26 rules on every publish. For a
  Studio tenant or an MCP/AI author this gate is not the weakest of four doors —
  it is the only one, because a `sys_metadata` overlay row is never in the CLI's
  config file and there is no `os lint` for it. Measured at boot level: the kernel
  reports `environmentId === undefined` and #4463's own broken-CEL approval flow
  (`record.owner ==`) runs straight past the gate into persistence.

  **The fix — the channel is declared, not inferred.** A new plugin option states
  what a kernel _is_, and gate activation reads that instead of row scope:

  ```ts
  new ObjectQLPlugin({ authoringChannel: "package-author" });
  createMetadataProtocolPlugin({ authoringChannel: "package-author" });
  ```

  `'environment'` (the default, and what you get by omitting the option) runs the
  rules. `'package-author'` is the ADR-0005 carve-out and belongs only on the
  genuine control-plane assembly — the kernel installing packages on the
  platform's own behalf. The option is threaded through `assembleMetadataProtocol`,
  the one seam both mounts share, so the built-in and delegated (ADR-0076 Step 2)
  mounts cannot disagree.

  **Omitting it means more enforcement, never less.** That direction is the point:
  the failure mode being designed out is a future assembly variant nobody thought
  about silently reopening this hole, which is exactly how the host-config
  topology got here. It is also why the option is a channel NAME and not a
  boolean — `skipAuthoringRules: true` would be the same bytes with the opposite
  meaning, a switch for making a red publish go away. #5086 had already retired
  the same proxy key for the code-only refusal, for the same reason.

  **What changes for you.** A kernel that serves metadata writes to end users
  should change nothing — it now enforces the rules it always should have. A
  kernel that genuinely is a control plane must add `authoringChannel:
'package-author'`; until it does it runs gated in the safe direction, and the
  existing per-write `OS_ALLOW_UNLINTED_METADATA_WRITES=1` hatch (#4463 D4)
  degrades a refusal to a loud log. `environmentId` keeps every one of its other
  jobs unchanged — the `environment_id` stamp and filter, the ADR-0005 overlay
  whitelist, the #3050 authoring gate's scope, and local metadata-storage
  provisioning. Only this one activation moved.

- 11066f6: feat(spec,metadata-protocol,rest,client): the direct-mount surfaces (`packages`, `datasources/:name/external/*`) become discoverable, and the SDK follows the advertised base (#6633)

  The rest surface's `/discovery` never advertised `routes.packages` — routes
  mounted but not advertised, the unstated half of ADR-0076 D12 — so the SDK's
  `packages.*` always fell back to the hard-coded `/api/v1/packages`; and the
  SDK's `datasources.external.*` had no discovery mechanism at all, hard-coding
  `/api/v1/datasources/...` in each of its five methods. On any deployment with a
  non-default API base, both families built wrong URLs (measured in #6633).
  Maintainer ruling 2026-08-08 (route B, prerequisite for #6306):

  - **spec** (minor, additive): `ApiRoutesSchema` declares a `datasources` key —
    the base of the federation-admin family. Optional like `mcp`: absent = not
    mounted.
  - **metadata-protocol** (minor, additive): `getDiscovery()` advertises
    `routes.packages: '/api/v1/packages'` iff the `package` service is
    registered (`serviceToRouteKey` gains the mapping; the route flows through a
    non-slot table because `package` is not a `CoreServiceName`). `datasources`
    is deliberately NOT advertised by this builder — the mount belongs to the
    REST host it cannot see (same disposition as `mcp`).
  - **rest** (minor): `/discovery` advertises `routes.packages` and
    `routes.datasources` as projections of the RECORDED direct mounts (#5822) —
    advertisement and mounting derive from one fact, so #6306's later mount-base
    move carries the advertisement along by construction. Not mounted ⇒ not
    advertised. An end-to-end parity pin (`discovery-advertised-direct-mounts.
parity.test.ts`) drives the composed surface and goes red on any change that
    moves only one side.
  - **client** (patch, behavior fix): the five `datasources.external.*` methods
    derive their base via `getRoute('datasources')` — connected clients follow
    the advertised base; unconnected clients (or servers that advertise no
    `datasources` key) keep building byte-identical `/api/v1/...` URLs.

  No key is removed and no wire shape changes for existing deployments: servers
  gain two advertised keys, and the SDK changes URLs only when a server
  advertises the new keys with a non-default base.

- 5e247fd: fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

  `GET /api/v1/meta/object/:name` answered a **different set of fields** depending
  on which link of its resolution chain produced the answer, for the same object:

  - **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
    injected system columns — `created_at`, `created_by`, `updated_at`,
    `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
    when the author declared none of them;
  - **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
    body) → the stored document VERBATIM, so every one of those columns was simply
    absent.

  Whether an object carries an overlay is invisible to the caller, so the same
  request reported the platform's own columns or not, and nothing in the response
  said which had happened. `/meta` is the machine-readable contract clients and AI
  authors code against: an author reading an overlay-backed object saw no
  `created_at` / `owner_id` / `organization_id` and reasonably concluded the
  columns do not exist — while every one of them is real in the database,
  filterable, orderable, and enforced read-only on write.

  **Every `/meta` object read exit now serves the effective schema.** The
  single-item read, the list, the cached/ETag branch, both draft reads and the
  layered read's `effective` layer all report the injected columns, with the same
  `readonly` / `system` markers the engine enforces (`owner_id` stays
  `readonly: false` — ownership is transferable). This is the presence half of the
  seam #4513 closed the value half of.

  Three things deliberately did **not** change:

  - **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
    read exits only, so Studio's "what you customised" diff never shows a column
    nobody wrote. Only `effective` is injected.
  - **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
    The write path gained the strip counterpart: a field byte-identical to the
    platform's own definition is removed again on save, so a served document handed
    straight back stores exactly what it stored before — same checksum, same
    history diff. A declared `owner_id` carrying the author's own label is _not_
    the platform's definition and survives untouched.
  - **A declared system column stays the author's.** Injection only ever adds a
    column nobody declared; it never rewrites one that was.

  Which columns an object carries is `resolveInjectedSystemColumns`
  (`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
  consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
  `systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
  `ownership` table, the `sys_*` namespace) is answered in one place and re-derived
  in none. **What** each column looks like moves to `@objectstack/metadata-core`
  (`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
  `@objectstack/objectql` so the symbols still resolve there) — the same relocation,
  for the same dependency cycle, as the audit-governance table in #4513:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
  path could not import the definitions from the registry that provisions them.
  One table now feeds the injection pass and the read exits, so they cannot drift.

  One key is deliberately not carried onto a served document: `organization_id`'s
  `indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
  ADR-0049) and rejected by name by the strict schema — and its only consumer is
  `driver-mongodb`'s schema builder, which reads the registered schema and never a
  served document. It stays at the injection site; that the registry-backed read
  answers `_diagnostics: { valid: false }` because of it is filed as #6810.

- ac244ad: fix(metadata-protocol): refuse an org-scoped write of a type that has no per-org channel (#6190)

  `allowOrgOverride` and `allowRuntimeCreate` are orthogonal tiers, and the
  runtime-create tier never consulted the ORG dimension:
  `SysMetadataRepository.put` stamps `organization_id` on the row whatever the
  type is. So a Studio-authored item of an `allowOrgOverride: false` type
  persisted a per-org row the platform can never read back — `loadMetaFromDb`
  loads env-wide rows only. The write path was strictly more permissive than the
  read path, and the row was lost at the next restart with no log line.

  Measured consequences, both silent before this change:

  - **`flow`** binds its triggers for the life of the process that wrote it, then
    stops firing after the next restart.
  - **`object`** is worse and fails CLOSED: absent from the registry after boot
    while its physical table still holds the data, so every record in it answers
    404 `OBJECT_NOT_FOUND`.

  `saveMetaItem` (draft and publish modes) and the draft→active promotion
  (`publishMetaItem`, `publishPackageDrafts`) now refuse such a write with 403
  `NOT_OVERRIDABLE` before anything is persisted, naming the organization, the
  flag that produced the verdict, the consequence, and the two legitimate
  alternatives (save it env-wide, or ship the per-org variant as its own
  deployment — ADR-0005: "Per-org variants are a deployment, not an overlay").

  **Which types change behaviour.** The predicate is derived from
  `DEFAULT_METADATA_TYPE_REGISTRY`, never a hand-written list: 18 of its 27
  entries declare `allowOrgOverride: false` with `allowRuntimeCreate: true` —
  `object`, `field`, `hook`, `seed`, `mapping`, `page`, `app`, `action`,
  `dataset`, `flow`, `datasource`, `external_catalog`, `doc`, `book`,
  `permission`, `position`, `tool`, `skill`. (`api` was the 19th when the ruling
  was made; #5488 has since withdrawn its runtime-create door entirely, so it is
  refused as code-only before this gate is consulted.) Unaffected: `view`,
  `dashboard`, `report`, `translation`, `email_template` (they have a per-org
  channel and their org rows are read back on demand), plus plugin types with no
  static registry entry, which keep today's behaviour. Env-wide writes of every
  type are unchanged.

  `OS_METADATA_WRITABLE` deliberately does **not** unlock the org dimension: it
  unlocks the write, not the read, so honouring it here would re-open the phantom
  in exactly the deployments most likely to have one.

  **No data migration is included.** Per the maintainer ruling, rows written
  before this gate are residue handled non-destructively — made audible by the
  cold-boot warning and disposed of operationally. They are not rewritten or
  deleted, and `migrateStoredMetadata` now reports them instead of rewriting
  them, which makes that pass a second residue detector.

- 89d7b35: feat(spec,metadata-protocol): the runtime authoring gate's advisory findings reach the save response (#4717)

  #4463 put the shared author-time rule registry on the runtime write path — the
  fourth door, and for a Studio tenant or an MCP/AI author the ONLY one, because a
  `sys_metadata` overlay row is not in the CLI's config file and there is no
  `os lint` to run against it. It gated on `error` findings only. The rest — the
  advisory half — were produced, walked into a `console.warn` deduped once per
  process per `type|name|rule|path`, and then went out of scope. #4715 named that
  honestly when it shipped: running a rule and discarding its conclusion is a
  smaller version of the hole the gate was built to close.

  That case is reachable today, not theoretical. A flow whose only defect is a
  `delete_record` node declaring `multi: true` with no `filter` yields
  `errors = 0 / advisories = 1`: the write **succeeds**, the row persists, the
  flow registers, and the author never learns that their nightly sweep deletes
  every row of the object on every run.

  **What changed**

  - `SaveMetaItemResponseSchema` declares an OPTIONAL `advisories` array, whose
    element is the newly-declared `RuntimeAuthoringIssueSchema` — the SAME
    `rule` / `path` / `where` / `message` / `hint` / `severity` shape the 422
    `invalid_metadata` envelope already carries (#4463 D3, "reuse the Zod
    envelope"). It is declared once: `@objectstack/metadata-protocol` re-exports
    it as its `RuntimeAuthoringIssue` instead of keeping a second hand-written
    interface for the same six keys, so the refusal and the success channel
    cannot drift into two dialects.
  - `evaluateRuntimeAuthoringGate` returns a `RuntimeAuthoringVerdict`
    (`{ error, advisories }`) instead of `Error | null`. This is an ADDED return
    channel, not a threaded value: the success path previously returned `null` and
    had nowhere to put a verdict at all.
  - `saveMetaItem` attaches the advisories to its success response.

  **Additive and conditional.** The key is emitted ONLY when at least one advisory
  was raised — never as `[]` — so a clean save's response bytes are byte-for-byte
  what they were before, and a caller that ignores the field behaves exactly as
  today. Absence means "nothing to report", never "the gate did not run".

  **`rulesRun` is deliberately NOT on the response.** The gate appends its own
  `PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING` when the type is `flow`, so not
  every id it would list resolves in the lint registry; exposing the array would
  need the declaration to say the ids are _gate_ ids. A field can be added later,
  not removed.

  **⚠️ Save door only — the asymmetry is deliberate, not an oversight.** The gate
  runs on BOTH write doors: `saveMetaItem` and the draft→active promotion, on
  purpose, so `?mode=draft` followed by publish is not a bypass (#4463 D1).
  Studio's designer uses draft-then-publish on every edit, so the publish door is
  the dominant Studio flow and it does **not** carry this field yet. That door's
  own response contract only just landed (#7294); carrying the advisories over is
  tracked separately rather than bundled here, so this change stays one optional
  field on one already-declared envelope.

  Rendering the findings in Studio is the objectui half of #4717 and is queued in
  that repo behind this change.

- 9f7a7c2: fix(metadata-protocol): refuse a sort naming a `formula` field instead of dropping it silently (#6994)

  The list path's SORT gate (`assertSortFieldsExist`) refuses a sort naming a field
  the object does not have (#4226) and a dotted path that would have to cross into
  a related record (#4256). It did **not** refuse a name that is a real,
  non-dotted field of the object whose **type** materialises no column — a
  `formula` field is in the object's field map, so it passed the unknown check,
  and it carries no dot, so it passed the dotted check.

  It then reached a driver that has no column for it. Re-measured on a real
  `SqlDriver` (better-sqlite3, on-disk) driving a real `ObjectQL` engine with this
  protocol on top, over five rows inserted `C A E B D` and a formula field
  `sort_key` whose expression is `record.title`:

  ```
  CONTROL   orderBy title asc     -> ["A","B","C","D","E"]   a real column really sorts
  BASELINE  no sort               -> ["C","A","E","B","D"]   insertion order

  FORMULA   orderBy sort_key asc  -> ["C","A","E","B","D"]   5 rows, 200
              its sort_key values -> ["C","A","E","B","D"]
  FORMULA   orderBy sort_key desc -> ["C","A","E","B","D"]   byte-identical to asc

  RAW SQL   order by sort_key     -> sqlite: no such column: sort_key
  ```

  `asc` and `desc` coming back identical is what makes this a dropped sort rather
  than a coincidence: `SqlDriver.createColumn` returns early for `formula` (it is
  virtual — computed on read, after `driver.find` has already returned), sqlite
  answers `no such column`, and the #3821 unknown-column backstop retries the
  query **without** the `ORDER BY`. The response even carries the values it was
  asked to order by, out of order, under a 200 — so it contradicts the request in
  plain view and still reports success. `sort` + `top` is how a caller asks for
  "the latest N", which this turned into an arbitrary N.

  **Now:** `400 INVALID_SORT`, naming the field and its type, and prescribing the
  same remedy in the same words as the dotted refusal (#6924) and the SEARCH axis
  (#6673) — denormalise onto a **stored field, written when the source changes**.
  Precedence on this axis is `unknown` > `dotted` > unmaterializable, so both
  older verdicts answer exactly what they answered before.

  **`summary` / `rollup` is not affected** and deliberately not in the refused
  set: a summary field gets a real, maintained `float` column and genuinely sorts.
  The spec's `COMPUTED_VALUE_TYPES` (`formula`/`summary`/`autonumber`) is the
  WRITE contract and is the wrong set to gate a sort with — it would refuse two
  types that work.

  **Scope.** This is an ingress gate, so it covers what reaches `findData`: the
  REST list route, `POST /data/:object/query`, the export route, and the RPC
  dispatcher. An internal caller that reaches `engine.find()` directly (hooks,
  flows, reports) still gets the silent drop — closing that half means deciding
  whether the engine refuses or keeps its documented internal-caller tolerance,
  which is a separate contract decision and is tracked separately.

  If you were sorting a list by a formula field, that sort was never applied; the
  call now fails loudly instead of returning rows in an arbitrary order.

- 1818998: feat(spec,objectql,metadata-protocol): validate-only data operation — ask for the write's verdict instead of predicting it (#6037, #4633 ruling D)

  `import`'s dry run predicted the write path's verdict with a hand-copied mirror
  of the engine's rules (`rest/src/import-coerce.ts`). A copy cannot structurally
  keep up with the family it mirrors — ADR-0104 value shapes, `format` checks,
  object-level `validations`, the state machine — so ruling D replaces prediction
  with the verdict itself.

  **New:** `DataProtocol.validateData(request)` returns the write path's verdict
  for candidate rows and persists nothing.

  ```ts
  const verdict = await protocol.validateData({
    object: "lead",
    mode: "insert", // or 'update', which judges only supplied keys
    data: [{ first_name: "John", email: "not-an-email" }],
  });
  // → { valid: false,
  //     results: [{ valid: false, errors: [{ field: 'email', code: 'invalid_email', … }], warnings: [] }],
  //     posture: { valueShapeStrict: true, mediaValueShapeStrict: false } }
  ```

  **Declaration and execution land together, deliberately.** `engine.validate()`
  (objectql) calls the same `validateRecord` / `evaluateValidationRules` that
  `insert()` calls, and `metadata-protocol` implements `validateData` on top of
  it. Agreement between preview and write is therefore guaranteed by
  construction, and a test asserts it directly by running both against one engine
  in both postures. This is the ruling's own clause, not a style choice:
  `BatchOptions.validateOnly` was retired in #4052 as a flag that promised a dry
  run while the batch surfaces persisted regardless, so a caller previewing a
  mutation had it EXECUTED. The new operation avoids that spelling too — the
  tombstone still stands and still rejects `validateOnly`.

  **The verdict is the target deployment's, not an absolute.** The response
  carries the ADR-0104 `posture` it was reached under. On a self-certified
  deployment a bad value shape is an error; on a warn-first one the same row is
  valid and the finding appears in `warnings` with the same `code` — one finding
  that changed buckets, not two vocabularies. An unconditionally-strict preview
  was considered and rejected (#4633 option B): it would fail rows on every
  un-migrated deployment that the write would have accepted, which teaches
  authors to distrust the one gate in front of a bulk import.

  Two boundaries worth knowing, both deliberate and both documented at the
  implementation:

  - **No hooks run.** `beforeInsert` fires before validation on the real path, so
    a hook deriving a _business_ field could change a verdict this does not
    simulate. Firing arbitrary user hooks in a preview — mail, outbound calls,
    writes to other objects — is the #4052 defect in a new spelling, so the gap is
    documented rather than closed. Audit/ownership stamps are `system`/`readonly`
    and validation skips them regardless.
  - **Warn-first admissions are not recorded as certification evidence.** The
    `#4769` sink exists so a boot cannot certify a contract it has just written
    against; a preview writes nothing, so recording there would let a _preview_
    block a later migration.

  Additive: `validateData` is optional on `DataProtocol`, and nothing existing
  changes shape. `valueShapeStrictEffective` / `mediaStrictEffective` are now
  exported from objectql's record validator so the response reports the posture
  that actually decided the verdict rather than the raw deployment flag.

  Unblocks #4633's consumption half (rest/import adopting the operation and
  retiring the `import-coerce.ts` mirror).

### Patch Changes

- b3efeb7: feat(spec): `Field.autonumber` declares the field `readonly: true` (#5628)

  `FieldSchema.readonly` is a **two-part** contract: "never editable in forms"
  AND server-enforced on both write paths. #5503 closed the server half for
  `autonumber` **by type** — a caller-supplied record number is stripped before
  any driver sees it, flag or no flag. The form half is keyed on the **flag**, and
  `Field.autonumber` never set it. So an authoring/rendering layer that decides
  editability from `field.readonly` drew an editable "record number" input whose
  value the server was already guaranteed to discard: the user types one, the
  create succeeds, and the record comes back carrying the number the sequence
  issued instead. Data was never at risk (that half has been enforced since
  #5503/#5627); what was wrong is what the form told the user.

  `Field.autonumber(...)` now emits `readonly: true`. The injection is applied
  **after** the author's config, so it cannot be spread away, and the authoring
  type rejects the one config that contradicts it — `Field.autonumber({ readonly:
false })` is a **compile error** rather than a silently coerced value, because
  an "editable record number" is not a state the runtime can deliver. Restating
  `readonly: true` stays legal. A hand-written `{ type: 'autonumber' }` literal
  (YAML/JSON metadata, or a plain object in TS) is unchanged and unaffected: it is
  covered by the by-type server enforcement, which never depended on the flag.

  Two consequences worth knowing:

  - **A flow that writes an autonumber field is now caught at `os validate`.**
    `flow-update-readonly-field` reads the static flag, so an `update_record` node
    writing a builder-authored record number — already a silent no-op at run time
    — is now reported at design time instead of in server WARN logs.
  - **The historical-import exemption is unchanged**, and stays that way by
    construction. The DataProtocol create ingress (`stripReadonlyForInsert`,
    #3043) knows only the `isSystem` exemption, while the engine's runtime-owned
    strip also honours `preserveAudit` (#3493 — a migration reinstating legacy
    record numbers). Now that the field carries the flag, the ingress would have
    deleted that value _before_ the engine could keep it, so the ingress skips
    runtime-owned field types outright and leaves them to the engine strip, which
    runs on every insert path (including the direct `engine.insert` callers the
    ingress never sees). Author-declared `readonly` on every other field type is
    stripped at the ingress exactly as wide as before.

  The set backing "which types the runtime owns" is now declared once in the
  protocol — `RUNTIME_OWNED_FIELD_TYPES`, exported from `@objectstack/spec/data`
  — and read by both consumers (objectql's write-path strips, the DataProtocol
  ingress) instead of each carrying its own literal.

- ae31a19: fix(spec,metadata-protocol): `capability` 补齐三处注册 —— 授权面不再接受任意 JSON (#5961)

  `capability` 是「enforced but undeclared」——#5271 给 `api` 关掉的那个
  `declared ≠ enforced` 的镜像。平台早就把它当成一个 metadata kind 在用:
  `PLURAL_TO_SINGULAR` 从 #5870 起就有 `capabilities` → `capability`,
  `AppPlugin` 用这个名字注册 stack 声明的 capability,
  `bootstrapDeclaredCapabilities` 再读回来 seed `sys_capability`。但三处注册表
  里都没有它:`MetadataTypeSchema`(kind 枚举)、`BUILTIN_METADATA_TYPE_SCHEMAS`
  (schema 解析)、`DEFAULT_METADATA_TYPE_REGISTRY`(谁可以写、怎么加载)。

  后果有两条,第二条才是这个 issue 属于授权缺陷而非整洁度问题的原因:

  - `getMetadataTypeSchema('capability')` 返回 `undefined`,于是 `saveMetaItem`
    走了它自己文档化的「未注册类型 → 不校验直接存」分支,
    `PUT /api/v1/meta/capability/:name` 接受**任意 JSON** 落进 `sys_metadata`。
    capability 是靠**名字字符串**被解析的——授予侧 `systemPermissions`、
    要求侧 `requiredPermissions` 都是——所以一行任意 JSON 直接落在活的授权命名
    空间里。
  - `isRuntimeCreateAllowed` 镜像 `getMetaTypes()` 的合成规则:没有静态注册表条目
    的类型被当作可运行时创建。所以缺的那一行不只是「没关上门」,它**把门打开了**。
    `/meta/types` 同步发布了这个虚构:`allowRuntimeCreate: true` + 无 schema,
    metadata-admin 引擎据此渲染成一个 raw-JSON 文本框。

  ### 改了什么

  - **`BUILTIN_METADATA_TYPE_SCHEMAS['capability'] = CapabilityDeclarationSchema`**。
    既有的 422 `invalid_metadata` 路径就此覆盖 `capability`,`/meta/types` 发出真
    JSON Schema。
  - **`DEFAULT_METADATA_TYPE_REGISTRY` 新增 `capability` 条目,
    `allowRuntimeCreate: false` + `allowOrgOverride: false`**。ADR-0066 D1:包
    DEFINE capability,权限集 GRANT,资源 REQUIRE。管理员在运行时凭空造一个
    capability 在这个三分里没有位置——代码里不会有任何地方 require 那个名字,这行
    只是授权命名空间里一个无人引用的授予目标。这一对标志就是 #5086 的 CODE-ONLY
    声明,`saveMetaItem` 在**任何** kernel 上都以 403 `not_creatable` 拒绝,并从条
    目自己的 `filePatterns[0]` 读回「该去哪儿声明」。`supportsOverlay: false`——
    capability 只是名字/标签/scope,没有 merge 语义,而允许租户 overlay 一个包发布
    的声明等于允许把 `scope` 从 `org` 抬成 `platform`。`loadOrder: 12` 早于
    `permission`/`position`(15),使权限集的 `systemPermissions` 解析时 capability
    已经存在。
  - **`MetadataTypeSchema` 枚举补 `'capability'`**。
  - **`CapabilityDeclarationSchema` 声明 ADR-0010 保护信封并收紧为 `.strict()`**。
    信封是必须的:loader 对每个已注册类型都调 `applyProtection`,不声明就会 422 掉
    loader 自己的输出(#4001 在 `permission`/`position` 上补过同一个洞)。收紧则与
    `api` 不同——`ApiEndpointSchema` 同时是**存储行**的解析器,所以它留在
    `STILL_STRIP`;而没有任何地方拿这个 schema 重新解析 `sys_capability` 行
    (`bootstrapDeclaredCapabilities` 通过 `capabilityRowFields` 按名读字段),
    所以收紧零成本,买到的是一个授权面本就该有的 declared = enforced 姿态。
    改用 `strictObject` 书写,已知键从 shape 派生,不新增手抄键表。

  **包声明通道完全没动。** `AppPlugin` 通过 `registerInMemory` 注册 stack 的
  `capabilities[]`,文件系统 loader 按 `filePatterns` glob——两条都不经过
  `saveMetaItem`,所以 `bootstrapDeclaredCapabilities` 依旧照常 seed。
  `OS_METADATA_WRITABLE=capability` 仍是 ADR-0005 那唯一一道运维逃生门,而在它后面
  写入现在由 `CapabilityDeclarationSchema` 判定(422),不再原样落盘。

  ⛔ `role` / `profile` / `policy` **不搭车**:它们没有 `PLURAL_TO_SINGULAR` 映射、
  没有声明 schema、没有读回接缝,是另一个问题,另开单。这条以断言形式钉在
  `capability-metadata-kind.test.ts` 里,因为「capability 有了条目,邻居也该有」
  正是下一个显而易见却错误的改动。

- 53aeb02: fix(metadata-protocol): classify a failed index build from the ERROR, not its message (#6699)

  `classifyIndexFailure` — the function both runtime partial-index migrations in
  this package classify a failed `CREATE UNIQUE INDEX` with — carried its own
  private unique-violation vocabulary and answered from the **message channel
  only**. That made it the fifth such copy in the repo, and the one #6250's
  inventory missed: it lives in a package none of the other four touched, so it
  was never in that table and none of the queued follow-ups covered it.

  The first arm now delegates to `@objectstack/types`' `isUniqueViolationError`
  (#6250 / PR #6541) — the one named answer to "is this a unique-constraint
  violation?" — and `probeThenReplaceIndex` passes it the **caught error object**
  instead of `err.message`. A string-only swap would have compiled unchanged and
  kept the defect: the point of the shared predicate is the `code` / `errno` /
  `cause` channels, which unwrapping the message throws away.

  **What changes at runtime.** A driver that reports the conflict on `code` or
  `errno` while giving unhelpful prose — SQLite's `SQLITE_CONSTRAINT_UNIQUE`,
  MySQL's `ER_DUP_ENTRY` / errno `1062`, Postgres' SQLSTATE `23505`, or the
  condition one step down `error.cause` behind a pooled wrapper's `Write failed`
  — was classified `failed`. It is now `conflict`, which is the verdict that
  produces the report ADR-0120 D4 requires: the key that is not enforced, the
  query that lists the offending rows, and the pointer at `os migrate plan`.
  Every message-channel verdict is unchanged — the shared predicate's message
  limb covers all three shipped dialects' prose.

  **Two things deliberately preserved.** The arm order still checks the
  duplicate-row question BEFORE the dialect question, because MySQL's duplicate
  error mentions the key and some drivers wrap both facts in one string; and the
  dialect arm (`unsupported`) is still this module's own message-based
  vocabulary, since the shared predicate answers the first arm only and has no
  opinion about dialect support.

  `classifyIndexFailure`'s parameter widens from `string` to `unknown`, so every
  existing string call still compiles and is judged exactly as before. Callers
  holding a caught error should pass it directly rather than `err.message`.

- bf32d4a: fix(metadata-protocol): the cold-boot org-scoped audit scans the LIVE metadata-type registry (#6992)

  `reportUnhydratableOrgScopedRows` — the boot line that says which org-scoped
  `sys_metadata` rows hydration walked past (#6190, PR #6600) — built its scanned
  type list by walking `DEFAULT_METADATA_TYPE_REGISTRY`. A metadata type with no
  entry there is registered at runtime by a plugin (`theme`, `connector`,
  `webhook`, `sharing_rule`, `analytics_cube`, …), so it was absent from the scan
  — while `loadMetaFromDb`'s filter (`organization_id: null`) is type-BLIND and
  skips its org-scoped rows exactly like a `flow`'s. That family was the one
  getting **neither** the write refusal nor the warning.

  The scan now unions the declared non-org-overridable types with every **live**
  type the registry does not declare at all, read through the same accessor
  `getMetaTypes()` lists from (`engine.registry.getRegisteredTypes()` plus the
  `metadata` service's) — extracted as `listLiveMetadataTypes()` so the listing
  and the audit cannot drift into two vocabularies of "which types exist here".

  Measured on a real `app-showcase` boot, at the instant the audit fires: 7 live
  types have no registry entry (`analytics_cube`, `connector`, `data`, `package`,
  `sharing_rule`, `theme`, `webhook`), all from the SchemaRegistry, which
  manifests populate during kernel Phase 1 — before the audit runs in
  `ObjectQLPlugin.start()` Phase 2. The widening is live, not defeated by boot
  order.

  **What an operator sees.** Still exactly one aggregated line per boot, same
  `[metadata_org_scoped_unhydrated]` tag and same `type×count (names)` detail with
  a 5-name sample cap — the widening adds segments to that line, never new lines.
  Two wording changes carry the new family: the line no longer claims "types the
  registry declares NOT per-org overridable" (false for a type with no
  declaration) and instead says "types with NO per-org channel"; and each
  plugin-registered type is marked `[plugin-registered]`, because the remediation
  differs — a declared type's org-scoped write is refused from now on, so its rows
  are residue that cannot grow, whereas an undeclared type's write is **not**
  refused and the same names return after every restart until the author stops.

  **The write refusal is deliberately unchanged.** `orgScopedWriteRefusal` keeps
  its "statically-declared types only" predicate: a warning is free and should be
  maximal, a refusal removes a capability, and widening it would extend a ruling
  reasoned over the declared registry onto a surface nobody measured. The
  divergence is now stated in the audit's TSDoc and pinned by a test, so it reads
  as a decision rather than as drift.

- b3363e9: feat(spec,client): declare the publish door's response — `PublishMetaItemResponseSchema` (#7294)

  `POST /api/v1/meta/:type/:name/publish` has been served since long before this
  change, and had no contract behind it: the string `PublishMetaItem` appeared
  nowhere under `packages/spec/src/`, and the endpoint was absent from
  `plugin-rest-api.zod.ts`'s metadata table. So `version` on the publish response
  sat in exactly the state `version` on the _save_ response sat in before #5745 —
  the ADR-0008 optimistic-concurrency token, the value a caller echoes back as
  `If-Match` to get a 409 instead of a lost update, riding a public wire surface
  with nothing declaring it. `PublishMetaItemResponse` could not be named at the
  type level either, which is why `client.metadata.publishItem()` resolved to
  `any`.

  This carries the #5745 "declared = returned" discipline one door over, with the
  same three artifacts the save door has:

  - **`PublishMetaItemResponseSchema`** declares the FULL measured body —
    `success` / `version` / `seq` required, `message` and the three conditional
    side-effect receipts (`seedApplied` / `materializeApplied` /
    `projectionApplied`) optional. Optionality is measured, not assumed: the sole
    producer's single response literal always sets the first three, and attaches
    each receipt only when the matching side effect ran, so an absent receipt
    means "that side effect did not run", never "it failed".
  - **The endpoint declaration**, so the catalog names the route it serves and
    points at the schema. No `requestSchema`: the body's only read key is
    `message`, taken only when already a string, so the route cannot 400 a
    malformed body and declaring one would advertise a gate that does not run.
  - **A producer-side conformance gate**
    (`publish-meta-response-conformance.test.ts`), driving a real
    `publishMetaItem` against a real ObjectQL engine through the schema across
    the plain shape and every receipt path. A field added to the response, or
    dropped from the schema, now turns that red instead of silently vanishing at
    parse.

  `client.metadata.publishItem()` is typed `Promise<PublishMetaItemResponse>` and
  the type is re-exported, matching `saveItem` / `SaveMetaItemResponse`.

  Also fixes a declared-≠-returned gap one layer down: `publishMetaItem`'s own
  `Promise<...>` annotation omitted `projectionApplied` while the implementation
  assigned it, so the method's type denied a key its callers were receiving.

  No behavior change — nothing about the response body moved. This declares what
  was already on the wire.

- 2a2a9fb: fix(spec,metadata-protocol,runtime): one place decides what an unset `NODE_ENV` advertises (#5936)

  A deployment whose operator never exported `NODE_ENV` must not describe itself as
  `development` on `/discovery`: `environment` is a machine-readable field, a client
  reads it to answer "am I talking to production?", and it may skip production warnings
  or loosen a destructive action's confirmation on the answer. #5673 ruled that in and
  fixed it — but only for one of the two producers, because that dispatch put
  `packages/spec` out of scope. The other one, `MetadataProtocol.getDiscovery()` (served
  by `@objectstack/rest`), went on answering `development` for exactly that input.

  The default now lives in the shared mapper, `resolveDiscoveryEnvironment`: an absent —
  or blank — value resolves to `production`, and both producers pass the operator's value
  through as they read it, neither carrying a default of its own. That is what makes it
  one decision instead of two copies, and it means the next discovery producer inherits
  the right answer without anyone remembering to copy a line. Patching only
  metadata-protocol would have left a second copy of the default — precisely the drift the
  shared table was created to prevent (#4828).

  "Unset" includes a blank value: `NODE_ENV=` exports an empty string, the runtime's
  `getEnv` has always folded that into its default, and had the mapper treated blank as
  "anything else" the two producers would have drifted again on that one input.

  **#4828's rule is untouched, and it points the other way on purpose.** A value that IS
  set but is not a spelling this repo recognises (`qa`, `preview`) still degrades to
  `development`, so nothing ever claims `production` on a guess. Absence is not a guess —
  it is the host declining to say.

  Behaviour change to expect: a host that exports no `NODE_ENV` and serves `/discovery`
  through `@objectstack/rest` now advertises `environment: "production"` where it
  previously advertised `"development"`. A deployment that genuinely is development should
  say so — `NODE_ENV=development` — which is what the runtime dispatcher has already
  required since #5673.

  The mapping table above `NODE_ENV_TO_DISCOVERY_ENVIRONMENT` is corrected in the same
  pass: its `unset / anything else -> development` row had been false for the runtime
  caller since #5673 and is now two rows, one per rule.

- 6908830: <!-- adr-0087: registered engine-find-formula-order-by-refused -->

  fix(objectql)!: `engine.find` / `engine.findOne` refuse an ORDER BY they cannot materialise (#7095)

  `engine.find()` and `engine.findOne()` are a **public API**, and an `orderBy`
  naming a `formula` field — which used to return rows successfully, in an
  arbitrary order — now **throws `400 INVALID_SORT`**.

  #6994 closed this at the REST ingress (`assertSortFieldsExist`), covering
  everything that reaches `findData`: the list route, `POST /data/:object/query`,
  the export route and the RPC dispatcher. A caller reaching the engine directly
  passed through none of it. Measured on the base of this change, real `ObjectQL`
  over a driver that really sorts:

  ```
  engine.find(o, { orderBy: [{ field: <formula>, order: 'asc'  }] }) -> C A E B D
  engine.find(o, { orderBy: [{ field: <formula>, order: 'desc' }] }) -> C A E B D
                                               asc === desc (byte-identical)
  ```

  A `formula` value is computed on read, so no driver materialises a column for
  it: the ORDER BY reached the driver, found nothing, and the unknown-column
  backstop returned the rows unordered under a success — carrying the very values
  they were asked to be ordered by. With `limit`, "the latest N" was an arbitrary
  N that no amount of inspecting the response could reveal.

  - FROM `orderBy: [{ field: '<formula field>' }]` → TO: denormalise the value
    onto the object (a stored field, written when the source changes) and sort by
    that. This is the same remedy, in the same words, that the REST door has
    prescribed since #6924 / #6994 and that the SEARCH axis prescribes since
    #6673 — a caller refused at two doors is not sent two different ways.

  **`summary` / rollup fields are NOT affected** and still sort in both
  directions: they get a real, maintained column. The family this refuses is
  `formula`, not "computed" — widening it to the spec's `COMPUTED_VALUE_TYPES`
  (the _write_ contract) would break two types that work, and a control test pins
  that.

  **Who was actually reaching this.** The #7095 ruling required the internal-caller
  tolerance to survive only behind a pinned internal path, and only if a _measured_
  internal call site relied on it. The sweep of every in-tree `orderBy` reaching
  the engine directly — hooks, flows, reports, queue/job adapters, sharing,
  metadata loaders, expand sub-reads — found **none**: every hardcoded internal
  sort names a real stored column (`created_at`, `updated_at`, `version`,
  `priority`, `scheduled_for`, `started_at`, `next_run_at`, `recorded_at`, `id`),
  and no shipped object in the repo declares a `formula` field at all. So **no
  internal path shipped**, and there is no flag to opt back into the drop — a
  negative test pins that the public options shape refuses one.

  The one **author-reachable** consumer is why leaving this at ingress was not
  tenable: a saved report's `query.orderBy` is forwarded verbatim into
  `engine.find` by `plugin-reports`, bypassing the ingress gate entirely. A report
  authored to sort by a formula field used to run and return an arbitrary order;
  it now fails loudly with the remedy in the message.

  **One path deliberately does NOT become a refusal.** A nested `expand` sort
  raises this same error inside `expandRelatedRecords`, but that sub-read sits in a
  pre-existing graceful-degradation `catch` which swallows _every_ expand failure
  and retains the raw foreign keys. That path therefore moves from **silent** to
  **observable** — a warning naming the field and the fix — rather than refusing.
  Reversing that backstop is a decision about all expand failure modes (#3821) and
  is not ridden in on this change; it is measured and pinned as-is.

  **What did NOT change:** the ingress gate is untouched — same message, same
  `unknown` > `dotted` > unmaterializable precedence, same `param` name that the
  engine cannot know. The engine door judges only the third verdict: unknown and
  dotted sort names still reach the driver from a direct call exactly as before,
  because refusing those is a posture change on two further axes rather than a
  free extension of this one. Reading a formula field, and the projection axis'
  `SELECT *` tolerance, are also untouched.

- d53bd0b: `findData`'s shared list-query normalizer now checks the ARITY of every query
  parameter it reads, instead of coercing a repeated one blind (#7321).

  `IHttpRequest.query` is `Record< string, string | string[] >` and the array arm
  is produced by a real first-party adapter (`NodeHttpServer` hands `?x=1&x=2`
  through as `['1','2']`). Every coercion in this normalizer was written for the
  string arm, so a repeated parameter was coerced into a value nobody asked for
  and served under a 200:

  - `?$top=1&$top=2` → `Number(['1','2'])` is `NaN` → the driver was called with
    `limit: NaN`. Same for `$skip` / `offset`.
  - `?status=open&status=won` → the leftover-key bucket lowered it to
    `where: { status: ['open','won'] }`, and a bare array is not a valid field
    spec — it matches no row on any backend. An empty page, 200 OK.
  - `?$search=a&$search=b`, `?$count=true&$count=false` and a repeated body
    `object` behaved the same way, each in its own flavour.

  Those are now refused with `400` / `error.code: INVALID_REQUEST` — the code this
  same normalizer already answers for the identical condition reached the other
  way (two SPELLINGS of one slot given different values, #4181 → #3795). A
  one-element array is one occurrence and is unwrapped, not refused; an empty
  array is no occurrence.

  **Unchanged on purpose — this is a per-parameter judgement, not a sweep.**
  `$select` / `select` / `fields`, `$expand` / `populate` / `expand`,
  `$searchFields`, `$orderby` / `sort` / `orderBy`, `$filter` / `filter` /
  `filters` / `where` (whose array arm is a FILTER AST, not a repetition),
  `groupBy` and `aggregations` all accept the array arm on purpose and keep it
  byte for byte. A blanket "reject repeated parameters" rule would have broken
  every one of them.

  Not reachable on today's production Hono adapter, which collapses repeated
  parameters to the first value before any handler runs; it becomes reachable when
  that collapse is removed (#6878 route 2).

- dba7747: fix(metadata-protocol): `getUiView` 的响应体不再多发三个未声明键,与 `GetUiViewResponseSchema` 对齐

  `GET /ui/view/:object/:type` 由 `getUiView` 产出、REST 层 `res.json(view)` 裸发(不套信封、不校验)。它的声明是 `GetUiViewResponseSchema`(= `ViewSchema`),但实发 body 里的 `list.object` / `form.object` / `form.label` 三个键,`ListViewSchema` / `FormViewSchema` 这两个 `strictObject` 从未声明,实测 `safeParse` 直接 `unrecognized_keys` 判红。因为 `GetUiViewResponseSchema` 在全仓没有任何运行时读者,这处分裂此前没有任何断言看得见。

  **FROM → TO**

  ```
  FROM  { list: { type, object, label, columns, sort, searchableFields } }
  TO    { object, list: { type, label, columns, sort, searchableFields } }

  FROM  { form: { type, object, label, sections } }
  TO    { object, form: { type, sections } }
  ```

  - **迁移**:读 `object` 的消费者上移一层 —— `body.list.object` / `body.form.object` 改读 `body.object`。这是**相同的值换了层级**,不是删除:`ViewSchema` 一直在容器层声明 `object`(「Object this container binds to」),成员层那份本就是冗余副本。
  - `form.label`(原 `` `Edit ${…}` ``)**不上移、直接摘除**:它是渲染串而非元数据,任何 view schema 都没有声明过它;标题由 UI 自行拼(调用方本就知道自己请求的是哪个对象)。`list.label` **不受影响** —— `ListViewSchema` 正式声明了 `label`,保持原样。
  - 定级 **patch** 而非 minor/major:三键的消费面实测为零 —— `client-react` 的 `useView` 把 body 当 `any` 透传(`UseMetadataResult.data: any`),objectui 全仓 `meta.getView` 零命中(其 `getView(objectName, viewId)` 走的是 `client.meta.getItem('view', …)`,另一条通路)。无编译期破坏面,无类型改判。
  - `packages/spec` **零改动**:本次是把实现修正到既有声明,不是改声明迁就实现。

  **未验面**:`cloud` 仓未在本次验证范围内(按 #5540 口径如实标注)。若该仓有直接读 `body.list.object` / `body.form.object` 的代码,需按上面的迁移上移一层;`form.label` 的读者需自行拼标题。

  常驻 pin:`packages/metadata-protocol/src/protocol.ui-view-response-conformance.test.ts` —— 用**生产端真实组装路径**(实调 `getUiView`)喂 `GetUiViewResponseSchema.safeParse`,而非手拼 fixture。反向验证已跑:恢复任一多发键 → pin 转红并点名该键。

- c733ae8: fix(metadata-protocol): the dialect arm of `classifyIndexFailure` walks `cause` to the same depth the conflict arm does (#6848)

  `classifyIndexFailure` had two arms reading two different wrap-depths. #6699
  moved the first arm onto `@objectstack/types`' `isUniqueViolationError`, which
  follows `error.cause` four levels down because pool and query-builder layers
  re-throw with the original attached. The second — the dialect arm — kept reading
  `err.message` and stopping there.

  So a dialect refusal arriving behind a wrapper (outer prose `Write failed` or
  `pool query failed`, the actual `near "WHERE": syntax error` one step down
  `cause`) was graded `failed` instead of `unsupported`. The private
  `indexFailureText` helper now collects the message channel of the thrown value
  **and** of each `cause` below it, bounded at the same `MAX_CAUSE_DEPTH` of 4 the
  predicate uses and counted the same way (the thrown value is depth 0). The
  dialect vocabulary itself is unchanged — only the text fed to it.

  **Why the verdict matters beyond wording.** The two consumers dispose of
  `unsupported` and `failed` differently. `view-definition-active-index.ts` treats
  them the same (keep the previous index, report at `error`; only the wording
  differs). But `ensureOverlayStateIndex` builds the composite **fallback lookup
  index** on the `unsupported` branch and on no other — offered precisely because
  a dialect that cannot take the partial form should still get the lookup. Under
  a `failed` verdict that branch never ran, so `fallback` came back
  `not-attempted` rather than `ensured` / `refused` and the degradation target was
  silently never attempted.

  **Dormant, not a live regression.** No driver shipped today produces the wrapped
  shape — each hands knex's error back with the dialect text on the outer message,
  which is why every existing case matched on the first read. This closes an
  asymmetry before a wrapping raw-SQL driver can land on it; it is also not a
  regression from #6699, which only made the contrast visible by deepening the
  first arm.

  Two details worth knowing if you touch this: the collected levels are joined
  with a **newline**, never a space, because two of the dialect alternatives are
  multi-word (`where clause`, `near "where"`) and a space would let a phrase be
  synthesised across a wrapper boundary that no single driver wrote. And a looping
  `cause` chain is **bounded rather than detected** — no visited set — which is
  exactly what the predicate this mirrors does.

  Arm order is unchanged and still load-bearing: a conflict reported anywhere in
  the chain still beats a dialect refusal in the outer prose.

- 30bed70: fix(metadata-protocol): a legacy env overlay on a rolled-back overlayable type can be REMOVED again (#6960)

  #6483 / PR #6608 flipped `permission` / `position` / `page` / `app` / `dataset` /
  `book` to `allowOrgOverride: false`. That closed the **write** door and
  deliberately left the **read** path alone — `supportsOverlay` stayed `true`, so
  an overlay row authored _before_ the rollback still merges overlay-wins and
  still shapes the effective body.

  Removing such a row was refused, at two places and on two different topologies:

  - `deleteMetaItem`'s `environmentId !== undefined` branch answered
    `403 not_overridable` **before** it ever probed for the row — so even an
    artifact-backed item with nothing customized was refused;
  - `SysMetadataRepository`'s delete gate refused the same removal
    `intent: 'override-artifact'`, and that check is **topology-independent**, so
    a control-plane kernel (no `environmentId`, which skips the first gate
    entirely) was refused there instead.

  Net effect for an environment that upgraded across the rollback while holding
  such a row: the ordinary "Reset to package default" flow answered 403 with the
  item still customized, and `OS_METADATA_WRITABLE` was the only documented way
  out.

  **What changes.** Per the maintainer's ruling of 2026-08-10, the **delete** side
  moves: removing an overlay of a type whose loader merges overlays at read time
  is allowed through the ordinary delete path, on both kernel topologies, without
  the operator hatch. Deleting an overlay restores the code-declared state — the
  narrowing direction, which cannot widen anything — so refusing it served no
  security purpose while trapping the repair behind an escape hatch.

  **What does NOT change, deliberately.**

  - **Create and update stay refused exactly as before.** The asymmetry is the
    ruling, not an oversight: `saveMetaItem`'s gate and `SysMetadataRepository.put`
    are untouched, and both gates' doc comments now record why, so the asymmetry
    is not later "fixed" into symmetry.
  - **The `object` tier does not move.** The relaxation is keyed on the registry's
    `supportsOverlay` flag, not on `allowOrgOverride`, so it stops at the tier
    boundary: `object` declares `supportsOverlay: false` (its overlay registers as
    its own contributor layer, ADR-0029 D9) and keeps refusing both verbs, which
    is D9.6's declared cost.

  Zero affected rows in the in-repo corpus today (measured at PR #6608), so this
  is a correctness-of-contract change with no live victim.

- f6e59f7: fix(metadata-protocol): the delete heal no longer unregisters an object bound to an installed package

  Deleting a metadata overlay row for an `object` whose `package_id` names an installed package took the object off the whole data plane until the next restart: every CRUD call answered `OBJECT_NOT_FOUND` / 404 while the table still held the rows, and the delete receipt said `reset: true`.

  `SchemaRegistry.registerObject` replaces (splices out) the same-package `own` contributor rather than shadowing it, so hydrating such a row destroys the packaged definition at write time and stamps `_provenance: 'org'`. Tier 3 of `restoreArtifactRegistryView` then consulted `isArtifactBacked` — which for an `object` is exactly that provenance — and read "not code-shipped" for an object the package still ships.

  Tier 3 now also refuses when the owner contributor's package binding names a currently-installed package, and says so in the log. The binding survives the overwrite (the replacement fires only when the package ids match); the definition does not.

  Known cost, deliberate: a package-bound runtime-authored object is indistinguishable from a package-shipped one by binding alone, so a genuinely deleted one stays registered until the next restart — listable, and rowless. A surplus entry is the cheap error here; a wrongly retired one 404s data CRUD for every tenant.

- dbe92a7: fix(metadata-protocol): boot 重水合按行的真实 package 绑定登记对象归属(#4636 裁 B 收官)

  `loadMetaFromDb` 的 object 分支从 `engine.find` 返回的行上读 `record.packageId`,而 `sys_metadata` 的列是 snake_case 的 `package_id` —— 该表达式恒为 `undefined || 'sys_metadata'`,于是每次重启都把**绑定了包**的对象 overlay 登记在 `'sys_metadata'` 哨兵下。改为读 `package_id`,与写路径、`getMetaItems`、以及相邻的非 object 分支一致。

  用户可见的行为差异:归属键同时就是包过滤键(`getAllObjects(packageId)`),所以此前一个对象在**创建时**出现在自己所属包的侧边栏过滤里,**重启之后就消失**;更要紧的是重启后的第一次编辑——boot 登记 `'sys_metadata'`、保存登记 `app.<slug>`,`registerObject` 抛 `already owned by package …` 被 `applyObjectRegistryMutation` 吞成 `console.warn`,保存回 `success: true` 而内存 schema 停在重启时的版本,这一笔编辑被静默丢弃(cloud#970 的重启面)。两侧统一到真实 id 后,过滤与编辑都跨重启成立。

  `@objectstack/objectql` 仅同步 `registry.ts` 中 `isTenantAuthored` 的契约注释:PR1 标注的「这半句描述的是契约,还不是代码」随本次落地摘除。

- 114e727: fix(objectql,metadata-protocol): deleting a runtime-created overlay retires its registry entry, so list/get/dispatch agree (#5079)

  Deleting a metadata item an admin had **created** at runtime (`DELETE
/api/v1/meta/<type>/<name>` for a name no code package ships) removed the
  `sys_metadata` row and reported `reset: true`, while every read surface kept
  serving the deleted item for the life of the process: `GET /meta/<type>` still
  enumerated it, `GET /meta/<type>/<name>` still returned its body, and the
  ADR-0110 D3 declaration gate still resolved a declaration for it. No TTL was
  involved — only a restart cleared it. This is the residual branch of #4432
  ("every surface in agreement"), the mirror image of the write direction #4521
  fixed.

  **Cause.** #4521 made `saveMetaItem` write an overlay through into the engine's
  `SchemaRegistry` under the PLAIN key, so a saved item is dispatchable and not
  merely listable. The delete side's registry heal
  (`restoreArtifactRegistryView`) only knew how to _un-shadow a packaged
  artifact_: `SchemaRegistry.removeRuntimeShadow` deletes the plain key **only**
  when a composite `<packageId>:<name>` artifact remains underneath, so that the
  name stays resolvable. For a runtime-created item there is no artifact —
  the row _was_ the item — so the heal declined and nothing else ever removed the
  entry.

  **Fix — at the producer, not the readers.** `restoreArtifactRegistryView` now
  walks the layers under the deleted overlay and stops at the first one that can
  serve the name: (1) a composite-key artifact, (2) a MetadataService baseline,
  and (3) — new — nothing, in which case the plain-key entry is retired via the
  new `SchemaRegistry.removeOverlayEntry(type, name)`. The registry now makes the
  same distinction the delete receipt already makes (#5927): "reset to artifact
  default" vs "it no longer exists".

  Two boundaries are preserved deliberately:

  - **A packaged artifact is never unregistered.** `removeOverlayEntry` refuses a
    plain-key entry that is itself an artifact (`_packageId` set, not the
    `sys_metadata` rehydration sentinel, not tenant-authored) — the same
    predicate `getArtifactItem` applies to its own bare-key fallback — and never
    touches composite keys. Resetting a customization of a shipped item still
    reveals the shipped value.
  - **An outage is not an absence (ADR-0110 D3).** The layer-2 baseline read now
    decides whether an entry is retired, so it goes through the diagnosed read: a
    metadata plane that could not answer stops the walk instead of retiring an
    entry on the strength of a read that never happened.

  Measured on the showcase app: before, `POST /api/v1/actions/<object>/<name>`
  after the delete answered 404 with the _handler-miss_ wording ("… not found"),
  because the declaration was still resolvable from the stale entry; it now
  answers the ADR-0110 "has no declaration" 404 — byte-identical to the state
  before the item was ever created.

- 1a53a02: fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

  `#4447` made the audit-provenance family (`created_at`, `created_by`,
  `updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
  `applySystemFields` forces `{ readonly: true, system: true }` over a _declared_
  audit field, and `ObjectQL.update` strips a non-system caller's write to it.

  The **read** path never learned it. A `/meta` object read resolves through
  `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
  those three has been through `applySystemFields` — so an object whose built
  artifact ships a materialized `created_at` carrying FieldSchema defaults
  (`readonly: false`) reported that value to every client while writes to that
  same field were being refused. Measured before the fix, all of the read exits
  agreed with each other and disagreed with the engine:

  ```
  single  read: {"type":"datetime","label":"Created At","readonly":false}
  list    read: {"type":"datetime","label":"Created At","readonly":false}
  cached  read: {"type":"datetime","label":"Created At","readonly":false}
  layered read: {"type":"datetime","label":"Created At","readonly":false}
  ```

  One field, two answers — and the machine-readable one, the only face a client
  or an AI author writing code off `/meta` can see, was the wrong one.

  **What changes.** Every `/meta` object read exit now reports the audit family
  the way the engine enforces it. That covers the single-item read (both the
  singular and plural type spelling), the list read, the cached/ETag branch, the
  `?preview=draft` and `?state=draft` reads, and the layered read's `effective`
  layer. `GET` bodies for objects that declare an audit field will show
  `readonly: true, system: true` where they previously showed `readonly: false`
  or omitted the keys; nothing else about the document changes, and the ETag for
  such an object changes once.

  **What deliberately does not change.**

  - The layered read's `code` and `overlay` layers stay raw — showing the
    package's declaration beside the governed `effective` value is the
    diagnostic's whole point.
  - `sys_metadata` still stores exactly what the author saved; the correction is
    applied on the way out, so no phantom customization appears in the diff.
  - An object that opts out of the audit family (`systemFields: false`,
    `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
    engine enforces nothing there, so a read that claimed otherwise would be the
    same lie pointing the other way.
  - Only `readonly` and `system` are forced. Every other key an author writes —
    `label`, `description`, `hidden`, `group`, and `type` for an external object
    mapping a differently-typed remote column — stays theirs.

  The governance table moved from `packages/objectql/src/registry.ts` to
  `@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
  `applyAuditFieldGovernance` normalizer the read path applies), by the same
  criterion and for the same cycle as the `#5619` engine-dispatch predicates:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
  read path cannot import the table from the registry that enforces it, and a
  second copy would agree only until someone edited one side. `objectql`
  re-exports the symbol from its original path, so its public API is unchanged.

- 7e1b480: fix(metadata-protocol): 删除回执不再对 runtime-only 项谎称"已重置为 artifact 默认值"

  `deleteMetaItem` 的四句成功回执(repository 路径两句 + legacy raw-engine 路径两
  句)原本无条件把每一次删除都叙述成"摘掉一层 overlay、回落到 artifact 默认值"。
  但对一个 **runtime-only** 项 —— 管理员在 Studio 里新建的 `object` / `flow` /
  `hook`,没有任何 code package 提供同名 artifact —— 底下根本没有默认值可回落:那
  一行就是这个项的全部,删掉之后它在任何层都不复存在。回执却把管理员指向一个从未
  存在过的基线。

  判据与 #5265 / PR #5926 在 save 侧用的是同一个:`isArtifactBacked` —— 也就是
  `intent: 'override-artifact' | 'runtime-only'` 的来源,本方法内早已算出。新增的
  方法级绑定**替换**了 `intent` 原来的那次 inline 调用,所以分句后 registry 读取次
  数不增反减。

  |                                     | FROM                                                                         | TO                                                       |
  | :---------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------- |
  | 覆盖了 artifact,删除即回落          | `Customization overlay deleted — <t>/<n> reset to artifact default. [seq=N]` | 逐字不变                                                 |
  | runtime-only,删除即消失             | 同上                                                                         | `Deleted <type> '<name>' — it no longer exists. [seq=N]` |
  | 覆盖了 artifact,本就没有 overlay 行 | `No customization overlay found for <t>/<n> — already at artifact default.`  | 逐字不变                                                 |
  | runtime-only,本就不存在             | 同上                                                                         | `No <type> '<name>' found — nothing to delete.`          |

  `success` / `reset` / `seq` 三个字段一字未动 —— `message` 没有任何消费方解析,仅
  作展示。草稿两句(`Draft discarded — …` / `No pending draft for …`)本来就没有声
  称过 overlay 或 reset,对两类项都为真,故逐字保留。legacy raw-engine 路径不写
  history、不发 watch 事件,两句因此本就不带 `[seq=…]`,该差异为既有设计,分句未
  触碰。

- 725c7b0: fix(metadata-protocol): an org-scoped metadata DELETE no longer evicts the env-wide registry entry (#6780)

  `restoreArtifactRegistryView` — the three-tier heal that repairs the in-memory
  `SchemaRegistry` after an overlay-row delete — was `(type, name)`-addressed and
  org-blind. Every tier writes the PLAIN key (`removeRuntimeShadow` drops it, the
  layer-2 re-register rewrites it, `removeOverlayEntry` retires it), and per
  ADR-0005 that one plain-key entry belongs to the **env-wide** row: an org-scoped
  overlay never enters the process-wide registry at all (#6602). `deleteMetaItem`
  called the heal on all three of its paths without passing the delete's own
  scope, so org A resetting **its own** customization reached in and evicted the
  entry every other org and the control plane read.

  Measured before the fix on an unscoped (control-plane) kernel — the shape #5086
  found the flagship showcase booting with:

  ```
  after env-wide save   : "Env grid"
  after org A save      : "Env grid"     # #6602 holding — the org row stays out
  delete receipt (org A) : { success: true, reset: true, … }
  after org A DELETE    : undefined      # the eviction
  rows left             : [{ name: "shared_grid", org: null, state: "active" }, …]
  ```

  The env-wide row is still in `sys_metadata`; only its registry entry is gone.
  While it is gone, direct registry readers answer as if the item does not exist
  — ADR-0110 D3's declaration gate, `resolveRouteActionDeclaration`, and
  fail-closed `assertObjectRegistered` (404). One tenant's "reset my
  customization" therefore degraded every other tenant's runtime until restart.
  The no-row **self-heal** branch was the cheaper door still: an org that had
  never customized anything could evict the entry with a single no-op DELETE
  (`reset: false`, "nothing to delete") — so a gate on the delete-ful branch
  alone would have left it open.

  The scope verdict now lives INSIDE the helper as a **required**
  `organizationId` parameter — the `hydrateOverlayIntoRegistry` shape #6602 used
  on the register side — rather than as a test repeated at each call site. There
  are four call sites, not the two the report named: `deleteMetaItem` has three
  (self-heal, post-`repo.delete`, legacy raw-engine path) and `revertCommit` one.
  A required parameter makes the next caller answer at compile time; an optional
  one would default an omission back to "env-wide" and reinstate the hole. PR
  #6807's call-site gate on the revert limb is now redundant-not-contradictory
  and was folded into the argument it passes — its pin still covers the batch
  path, and it goes red if the gate is ever removed.

  **Register wide, retire narrow.** The write-through's `object` carve-out stays
  un-org-gated and deliberately does not transfer to removal: it rests on
  `assertObjectRegistered` failing CLOSED, so a surplus entry degrades to
  "listable but rowless" and the next reload heals it, whereas a wrongly retired
  entry 404s data CRUD for every tenant.

  Unchanged: row-level delete behaviour (an org-scoped delete still removes the
  org row, and the org's next read falls through to the env-wide body); the
  env-wide delete's full three-tier walk (#6687 tier 1 un-shadowing, #5079 tier 3
  retirement); and the kernel-scope gate, which still guards re-registration
  only because that is a fact about the kernel, not about the row.

- 4bb6f01: fix(metadata-protocol): an org-scoped overlay row no longer reaches the process-wide SchemaRegistry (#6602)

  ADR-0005 (revised 2026-05) says only **env-wide** rows (`organization_id IS NULL`)
  enter the process-wide `SchemaRegistry`; per-org overlays are served on demand and
  never grafted into the registry every org in the process shares. The registry has
  exactly one plain key per `(type, name)` and no org dimension to hold two orgs'
  bodies apart, so a per-org body sitting under that key IS the other orgs' body.

  Boot obeyed the rule — `loadMetaFromDb` filters `organization_id: null` and says so
  in its own comment. Both **runtime** seams did not:

  - **The write-through.** `applyRegistryWriteThrough` gated on `environmentId` alone.
    Its TSDoc already claimed the rule ("a project-scoped row must not be registered
    into a registry that unscoped callers share. The write must not be more permissive
    about that than the read is") while the code said nothing about `organization_id`.
    On an unscoped kernel a per-org `view` write hydrated straight into the registry
    under the plain key.
  - **The read hydration.** `getMetaItems` merges this caller's org rows into the
    env-wide set and then hydrated the whole merged set under the same
    `environmentId === undefined` gate — so one org-scoped listing call grafted that
    org's bodies too, and would have undone a write-side-only fix at the next listing.

  Both were observable rather than theoretical: once org A's body sat under the plain
  key, org B's listing started from org A's body, and where the names did not collide
  org A's item was simply **in** org B's list. Per #5086 a host config boots
  `new ObjectQLPlugin()` with no `environmentId`, so the flagship showcase runs on
  exactly this kernel shape.

  **The fix restores the stated invariant at both seams at once, in one place.**
  `hydrateOverlayIntoRegistry` is the single choke point all three hydration callers
  (boot, read-side, write-through) already route through since #4521, so the row-scope
  verdict now lives there — and its `organizationId` argument is **required**, not
  optional: an omitted org would default to "env-wide" and reinstate the hole, while a
  required one makes every caller state the row's scope to compile. The kernel-scope
  gate (`environmentId === undefined`) stays with the callers, because that is a fact
  about the kernel, not about the row.

  Not changed, deliberately:

  - **What org readers see.** The merged listing, `getMetaItem`'s org-preferred read,
    and the org-scoped write itself are all untouched — this closes a registry leak,
    never a write or a read. Per-org overlays keep working exactly as ADR-0005
    designed them: served on demand.
  - **#4521 read-your-writes.** An env-wide save is still dispatchable the moment it
    lands, with no listing call in between.
  - **The `object` branch.** An `object` is `allowOrgOverride: false` and its physical
    table is env-wide, so the registry entry backing it is env-wide too;
    `assertObjectRegistered` fails closed on a missing entry, so gating that branch
    would make a runtime-created object unreachable for data CRUD rather than merely
    un-listed. That branch has never carried the `environmentId` gate either, for the
    same reason.
  - **The delete chain.** `restoreArtifactRegistryView` stays `(type, name)`-addressed:
    with both entry seams refusing org rows there is nothing org-scoped in the registry
    for it to mis-address, so no re-keying is needed (pinned in both directions).

- e39dd66: 冷启动跳过的 org 作用域元数据行不再无声消失

  `loadMetaFromDb` 按 ADR-0005(2026-05 修订)只水合 `organization_id IS NULL` 的行,
  per-org overlay 由 `getMetaItem`/`getMetaItems` 按需加载——对注册表里
  `allowOrgOverride: true` 的类型(`view`/`dashboard`/`report` 等)这是设计本身。但对
  **其余类型**,一条 org 作用域的行是平台根本没有 per-org 通道的行,而在此之前这个跳过
  是**完全静默**的。

  实测标本是 `flow`:它是 `allowOrgOverride: false`(#6283 / PR #6478 按 ADR-0005:57
  回滚),同时 `allowRuntimeCreate: true`,所以租户在 Studio 里新建一条 flow 仍会写出
  `sys_metadata.organization_id = '<org>'`——运行时 `PUT /metadata/:type/:name` 把
  `resolveActiveOrganizationId` 透传给 `saveMetaItem`,而 `SysMetadataRepository.put`
  对任何类型都按 `organization_id: this.organizationId` 落库。该 flow 在本进程内一直正常
  触发(发布时写穿进了进程级 registry),下一次重启后被这条过滤器丢掉,`kernel:ready` 的
  绑定器读的是 `getMetaItems({ type: 'flow' })`(不带 org),于是它**再也不触发,且没有任何
  日志说它消失了**——`kernel:bootstrapped` 的 unbound 审计也看不见它(它压根没注册)。

  现在冷启动会打一条聚合的 `warn`,按类型给出计数、抽样的 `name@org`,以及后果本身
  (「A 'flow' listed here will NOT bind its triggers in this process」)和处置建议。
  查询默认为空:两个收窄谓词(`organization_id IS NOT NULL` + 类型清单,清单由
  `DEFAULT_METADATA_TYPE_REGISTRY` 派生而非手写)让健康部署读不到行、也不打印任何东西;
  驱动若无法下推其中一个谓词,退化为多读几行而不是打出误报(JS 侧会复核两个谓词)。

  加载行为**未改变**:这次只是把缺席变响亮。这类行到底该不该存在(写入侧拒绝 / 强制写成
  env-wide / 让绑定器按 org 读)是 #6190 上待裁决的契约问题。

- bed427f: fix(metadata-protocol): `ensureOverlayIndex` probes before it drops, and says what it could not enforce (#6418)

  `sys_metadata`'s overlay-uniqueness migration ran **DROP then CREATE**:

  ```text
  DROP INDEX IF EXISTS idx_sys_metadata_overlay_active   ← always succeeds
  CREATE UNIQUE INDEX  idx_sys_metadata_overlay_active … ← may fail
  ```

  with nothing that puts the dropped index back, and both `catch` blocks empty. On
  the dialects that _do_ support the form (SQLite / PostgreSQL), a `CREATE` that
  failed on existing rows therefore left the table with **no** unique index at all
  — and no line in the log. ADR-0005 overlay uniqueness is the base of metadata
  correctness: with two ACTIVE rows for one
  `(type, name, organization_id, package_id)`, which one `getMetaItem` returns is
  undefined.

  The degradation branch could not save it either. It fired only when the driver's
  message matched `/partial|where clause|syntax/i`, which duplicate-row errors
  (`UNIQUE constraint failed` / `duplicate key value`) do not — so the one failure
  that is about DATA fell through to a bare `// best-effort` comment. MySQL was
  safe only by accident: `DROP INDEX IF EXISTS` is not legal MySQL, so the drop
  failed first and the old index survived.

  **The order is now probe-first**, ported from the sibling
  `view-definition-active-index.ts` (#5839 / #6417) and extracted into a shared
  `partial-index-probe.ts` both migrations use: build the partial UNIQUE under a
  throwaway probe name, and only once that has demonstrably succeeded drop the
  real name and rebuild it. On any dialect or dataset that cannot take the form,
  whatever index was protecting the table is left exactly as it was — degraded to
  yesterday's behaviour, never below it. Both sections get this treatment
  (`…_overlay_active` and `…_overlay_draft`), and the two are independent so a
  failure on one no longer decides the other.

  **The empty catches are replaced by ADR-0120 D4's disposition**: classify the
  failure, keep the previous index, name the key that is not enforced and what
  that costs, ship the exact query that lists the offending rows, point at
  `os migrate plan`, and let the boot continue — reported at `error`, because what
  goes missing is an integrity guarantee the platform states it enforces while
  everything else keeps looking healthy.

  Two things deliberately do **not** change. The key spelling stays byte-identical
  (`(type, name, organization_id, COALESCE(package_id, ''))`) — this is an
  ordering and reporting fix, not a re-keying. And the dialect fallback stays a
  **non-UNIQUE** composite index: one ACTIVE row and one DRAFT row for the same
  key legitimately coexist on this table, so a full UNIQUE would reject legal
  data. What changes about the fallback is that it is now issued additively
  (`IF NOT EXISTS`, no preceding drop, so it can never replace a stronger index)
  and that the report says plainly what is and is not enforced.

- 252f71b: fix(metadata-protocol): a single-record update binds the row the CALLER named, not the row the body names (#6479)

  `PATCH /data/:object/:id` decided which row to write **twice, differently**. The
  protocol's `updateData` probed existence and validated `If-Match` /
  `expectedVersion` against the path `:id`, built `{ where: { id: request.id } }`,
  and then handed the request body to the engine verbatim — where the dispatch
  reads the payload first, so a truthy scalar `data.id` outranks `where.id`.

  So `PATCH /data/task/rec_1` with a body of `{"id":"rec_2","title":"x"}`:

  - probed **rec_1** for existence (404 gate, #4435);
  - version-checked **rec_1** against the caller's `If-Match`;
  - **wrote rec_2**; and
  - answered `{ id: "rec_1", record: <rec_2's readback> }` — a receipt whose two
    halves name different rows.

  rec_2 was never probed and never version-checked, so the most common client
  shape there is — GET a record, edit a field, PUT the whole body back — performed
  a **silent cross-row write straight past its own optimistic-concurrency check**
  whenever the body carried another row's id (a mis-clicked list row, a stale
  refresh, a generated client that copied the wrong field).

  `updateData` now merges the path id over the payload before dispatch
  (`{ ...request.data, id: request.id }`) — the same shape the **bulk** ingress has
  always used for this question (`ql.update(op.object, { ...data, id }, …)`), so the
  two ingresses give one answer instead of two. The probed row, the OCC-checked
  row, the written row and the receipt's `id`/`record` are now the same row: the
  one in the URL.

  Nothing else moves:

  - **The engine is untouched.** ObjectQL's payload-first dispatch (#5748) and its
    by-id payload strip (#6435) are unchanged and still correct for a caller who
    hands ObjectQL a payload and nothing else; this was a gap at the REST/protocol
    ingress, which had already named the row.
  - **No new rejection, no request-shape change.** A body `id` equal to the path
    id behaves exactly as before, and a differing one is now simply overridden
    rather than refused — `UpdateDataRequestSchema` still accepts the same bodies.
  - **Non-record payloads pass through untouched** (`undefined`, `null`, an array),
    so the engine's own diagnostics for a malformed call still surface unchanged.

  Callers that deliberately relied on the body's `id` redirecting a
  single-record PATCH must address the intended row in the URL instead — the bulk
  endpoint has never honoured a body id either.

- a5d2573: feat(metadata-protocol): publishing a platform-level scheduled `create_record` flow is refused on a multi-organization deployment unless it declares `organization_id` (#6285)

  A scheduled flow that creates records now has to say which organization those
  records belong to — but only where the answer matters, and only where nothing
  else can supply it.

  ## What was open

  `ScheduleTrigger` builds its context as
  `{ event: 'schedule', params: { jobId, flowName, schedule } }` — no `tenantId`.
  PR #6153 closed the engine half of #5494 on the rule "stamp what the engine
  KNOWS": a run whose trigger resolved an organization carries it through, and the
  driver's tenant machinery fills `organization_id` on rows that omit it. A
  schedule resolves none, so nothing fills anything — and the dominant production
  shape of the whole issue is a nightly sweep, which fires on a schedule and not
  by hand. Every row it created was born `organization_id` NULL.

  That is not a cosmetic NULL. A `(organization_id, …)` unique index does not
  constrain across NULL and an org-scoped query does not see the row, so the
  damage is duplicate and invisible records — hotcrm#698's duplicate numbering —
  in a stored shape no later fix can retroactively repartition.

  ## What now happens

  At the runtime publish gate, this exact combination is refused with the existing
  422 `INVALID_METADATA` envelope (`code` + `status` + `issues[]`, ADR-0112):

  - the deployment enforces an organization wall
    (`postureEnforcesWall(resolveTenancyPosture())` — `group` or `isolated`,
    ADR-0105 D1), **and**
  - the flow is platform-level (the write carries no organization), **and**
  - it binds to the **schedule** trigger, **and**
  - it contains a `create_record` node, **and**
  - that node declares no `fields.organization_id`.

  Every limb's negation still publishes: a single-organization deployment, an
  org-scoped write, any other trigger, a flow that creates nothing, and — the
  fix an author actually applies — a node that declares
  `config.fields.organization_id`. That key is not new: `CreateRecordConfigSchema`
  has always carried `fields`, and #6153's fill-only stamping already guarantees
  an author-supplied value wins over any engine fill. One issue is reported per
  offending node, including nodes nested inside `loop` / `try_catch` / `parallel`
  regions, each addressed at the key the author must write.

  Drafts are never gated (#4463 D1) and the draft to active promotion is, so the
  draft door is not a bypass. `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades the
  refusal to a loud log exactly as it does for the 26 shared rules, and
  `os migrate meta --stored` stays carved out.

  ## Where the judgement lives, and why

  Runtime publish gate only; `os validate` / `os build` / `os lint` do **not**
  judge this. Both inputs the rule needs are facts about the **deployment**, and
  the CLI runs on a build machine — a shared rule would sentence every
  single-organization repository on whatever `OS_TENANCY_POSTURE` happened to be
  exported in CI. The gate's caller performs the two readings and passes them as
  arguments, so the judgement itself stays a pure function of its inputs.

  Migration note for a multi-organization deployment: an existing scheduled flow
  keeps running untouched — the gate blocks new writes only, never stored rows —
  but the next time one is republished it will be refused until the
  `organization_id` is declared, which is the same edit that stops it writing
  outside the organization partition.

- 2ab1257: `preserveAudit` is an UPDATE-path exemption — the contract now says so, and a non-system INSERT that asks for it is told loudly instead of silently stripped (#6640)

  `FieldSchema.readonly`'s `.describe()` promised the opt-in historical-import exemption
  (`preserveAudit`, #3493) on **both** write paths, and
  `docs/protocol/objectql/security.mdx` agreed. Only UPDATE ever implemented it. The
  create-side strip lives at the DataProtocol ingress (`stripReadonlyForInsert`, #3043) and
  has never read `preserveAudit` at all — `context.isSystem` is its only exemption — while
  the engine's update-side strip consults `isPreservableUnderAudit`.

  REST import's `treatAsHistorical` puts `preserveAudit: true` on the write context and
  creates through `createData`, i.e. through exactly that ingress. So **one** historical
  import kept an author-declared `readonly` business column (`closed_at`, `resolved_by`) on
  the rows it UPDATED and silently dropped it from the rows it CREATED. The trigger is not
  exotic: the audit family itself is `readonly: true` in the registry's `AUDIT_FIELD_DEFS`,
  so an ordinary export→historical-import round-trip carries readonly columns on every row.

  Maintainer ruling (2026-08-08), option 2 with a binding loudness rider — the enforcement
  is the truth and the contract narrows to it:

  - **Contract narrowed.** The `.describe()` text and the security doc now state the
    exemption as UPDATE-path only. The INSERT entry keeps honouring `isSystem` alone;
    replaying archival readonly facts on create requires a system context. Honouring
    `preserveAudit` here instead would have handed a NON-system caller — `treatAsHistorical`
    arrives on an ordinary REST import request — the approval/status columns #3043 exists to
    protect, in one POST.
  - **The ignored request stops being silent.** A non-system INSERT that requests
    `preserveAudit` and actually loses fields now logs a `WARN` naming the object, every
    stripped field, the UPDATE-only rule, and the `isSystem` remedy. It fires once per
    ingress call (the union across a batch, as `mergeDroppedFieldEvents` already does), and
    only when something was really removed — an ordinary create that never asked for the
    exemption stays exactly as quiet as #3043 designed it.

  **No behaviour change to the strip itself, and no acceptance-surface change** — the
  accepted set is byte-identical; only the describe text, the docs, and the new warning are
  new.

  Warning rather than refusal, measured rather than assumed: `runImport` collects a per-row
  write error into a failed row instead of aborting, so refusing at the ingress would not
  stop a historical import — it would convert every row it CREATES into a failure while the
  rows it updates still succeed. Measured on a throwing variant, the historical import of 2
  new rows went from `{created: 2, errors: 0}` to `{created: 0, errors: 2}`. Breaking the
  shipped `treatAsHistorical` flow for new rows is the condition under which the ruling names
  the loud WARNING — strip still applied — as the containment-correct landing.

- 47a4e67: fix(objectql): deleting an `object` really unregisters it — a name-addressed `SchemaRegistry.unregisterObject` (#6808)

  Deleting a runtime-created `object` removed its `sys_metadata` row and left the
  object serving. `deleteMetaItem` ends its repository delete with
  `restoreArtifactRegistryView` (the #6687 three-tier heal), and every verb that
  walk uses — `removeRuntimeShadow`, `registerItem`, `removeOverlayEntry` —
  addresses `SchemaRegistry`'s generic `metadata` map. An `object` is written into
  **two** places on the way in:

  ```ts
  registry.registerItem("object", item, "name"); // metadata map
  registry.registerObject({ ...item, _provenance: "org" }, pkg); // objectContributors
  ```

  The heal only undid the first. Measured with the real `SysMetadataRepository`
  over an in-memory engine:

  ```
  BEFORE delete: metadata['object'] -> ["myapp_invoice"] | objectContributors -> ["myapp_invoice"]
  AFTER  delete: metadata['object'] -> []                | objectContributors -> ["myapp_invoice"]
  registry.getObject('myapp_invoice')        -> STILL SERVED
  registry.getItem('object','myapp_invoice') -> STILL SERVED   (it special-cases back to getObject)
  ```

  The surviving half is the load-bearing one. `getObject` is what the data plane
  dispatches on (`assertObjectRegistered`, #3770), so the row was gone from
  `sys_metadata` while the object stayed resolvable, syncable and **writable** for
  the life of the process — a `createData` against the deleted object still
  inserted rows. Reachable on the ordinary Studio delete path, and on
  `revertCommit`'s soft-remove limb, which #6807 had just wired to the same heal.

  There was no one-line fix because `SchemaRegistry` had no per-name object
  removal at all: the only removal verb was `unregisterObjectsByPackage`, which is
  addressed by PACKAGE. Routing a single delete through it would mean synthesising
  a package identity for a runtime-created object and tearing down every sibling
  object registered under it — a far wider blast radius than the delete the
  operator asked for.

  So `SchemaRegistry` gains the verb that was missing:

  - **`unregisterObject(name, { force? })`** — removes one object's contributor
    entry and the per-object state `registerObject` created (merged-object cache,
    `objectRevision`). Names resolve through the same path `getObject` uses, so it
    removes precisely the entry that was being served. Package namespaces are left
    alone: they are per-package and shared by every object that package ships.
  - **The ADR-0029 guard is borrowed, not re-invented.** An object still extended
    by another package refuses loudly, naming every extender — the same judgement
    `unregisterObjectsByPackage(force)` already encodes, with the address changed
    from package to name. Both facts it needs (owner, extenders) were already in
    the contributor list, so no new bookkeeping was added.

  `restoreArtifactRegistryView` calls it from **tier 3 only**, and only for a name
  that is not artifact-backed — the tier that has already established no lower
  layer serves the name. Tiers 1 and 2 concluded a
  packaged artifact or a MetadataService baseline still does, and an object that is
  still served must stay registered: `assertObjectRegistered` fails CLOSED, so
  retiring it there would turn "reset to artifact default" into a data-plane
  outage. It also carries the same artifact refusal `removeOverlayEntry` applies
  one line up, asked through the protocol's own `isArtifactBacked`: a code-shipped
  object is never retired by this walk. That is not already covered by the gates in
  front of it — the two-tier delete authorization runs only when `environmentId !==
undefined`, and the no-row leg of a control-plane delete reaches the heal without
  touching the repository's `assertAllowed` at all.

  Because the heal runs after the repository delete has committed, an extender
  refusal is caught and logged by name rather than propagated (the row is gone
  either way) — and deliberately not left to the heal's silent outer `catch`, so a
  runtime that disagrees with `sys_metadata` is visible rather than inferred.

  `unregisterObjectsByPackage` keeps its signature and semantics unchanged.

- 2873eb9: fix(metadata-protocol): rolling back a package-bound overlay row no longer 409s (#6215)

  Every rollback of a metadata item authored inside a Studio package workspace
  failed — and failed by blaming a concurrent edit that never happened:

  ```
  [metadata_conflict] object/myapp_invoice advanced during rollback.
  Expected parent sha256:00ca6e72c... but current is null.
  ```

  Both user-facing paths were affected, because both are one call:
  `rollbackMetaItem` (the per-item version-history revert) and `revertCommit`
  (the package-commit revert) go through `SysMetadataRepository.restoreVersion`.
  Only rows with **no** package binding — the legacy shape — rolled back at all,
  while ADR-0070 pushes authoring toward always resolving a writable base
  package, so the failing share was growing.

  **Cause.** `restoreVersion` read the current active row package-agnostically
  and then re-put the historical body without saying which row it meant. `put`
  scopes its optimistic-lock lookup by package, and an unstated `packageId`
  resolves to the _unbound_ row (`package_id IS NULL`) rather than "any package"
  — so for a row bound to `app.<slug>` the lock looked up a row that does not
  exist, read its parent hash as `null`, compared that against the real hash the
  first read had just returned, and threw `ConflictError`. The mismatch was
  between two reads of the _same_ restore, not between two writers.

  **Fix.** `restoreVersion` now reads the raw active row once and takes BOTH
  facts from it — the parent hash and the ADR-0048 `package_id` — then states
  that binding on the write, the same way `promoteDraft` already did. The row the
  lock is taken on is therefore, by construction, the row that gets written.

  This also closes the defect's second face: had the parent check ever passed,
  `put` would have found no row in its `IS NULL` scope and **inserted a duplicate
  unbound row** beside the bound one instead of updating it. `sys_metadata`'s
  partial unique index keys on `COALESCE(package_id,'')`, so a real database
  would have accepted that duplicate.

  Unchanged: package-less rows still roll back exactly as before, and a row that
  _genuinely_ advanced between the rollback's read and its write is still refused
  with `METADATA_CONFLICT` / 409. The refusal is narrowed to the case it always
  claimed to report, not retired.

- 271cee1: fix(metadata-protocol): a successful `revertCommit` refreshes the SchemaRegistry (#6621)

  `revertCommit` persisted its change and left the running process serving the
  body it had just reverted away. The single-item revert `rollbackMetaItem` has
  ended its restore with a registry write-through since #4521 — "a rollback is a
  live write like any other: the restored body must be the one the runtime
  dispatches on immediately, not after someone lists the type" — and the batch
  path over the same repository call had no equivalent on either limb.

  Measured before the fix, real `SysMetadataRepository`, an `object` saved twice
  (v2 adds a `due_date` field) and then reverted:

  ```
  revertCommit                          ->  { success: true, revertedCount: 1, failed: [] }
  stored sys_metadata row fields        ->  ["name","amount"]              # reverted
  SchemaRegistry.getObject(...) fields  ->  [...,"name","amount","due_date"]  # NOT reverted
  ```

  So the undo reported success while data CRUD kept dispatching the pre-revert
  schema, healing only at the next restart. It is type-agnostic and older than
  the `object` support that made it loud: an overlay `view` showed the same split
  (stored `Cases`, registry still `Renamed`). `rollbackToPackageCommit` reverts
  through the same loop, so a whole-package rollback could report success and
  change nothing the running process could see.

  Both limbs now refresh the registry, each reusing the seam its single-item
  sibling already uses:

  - **Restore limb** — writes the restored body through under the row's OWN
    ownership key, read from the row before the restore (#4636; stated as the
    `sys_metadata` sentinel instead, `registerObject` throws `already owned by
package "app.<slug>"` into a best-effort warning and the stale body survives).
    The row's own organization is passed per item, so an org-scoped row inherits
    ADR-0005's rule that only env-wide rows enter the process-wide registry.
  - **Soft-remove limb** — runs the same three-tier heal `deleteMetaItem` runs
    after its own repository delete: an overlay that shadows a packaged artifact
    falls back to the artifact rather than vanishing, and only a name no layer
    serves at all is retired. A flat unregister would have deleted names a code
    package still ships. This heal is gated to env-wide reverts: an org-scoped row
    never entered the shared registry, so healing on its behalf would retire the
    entry every other organization reads.

  No contract change — ADR-0067 already defines what a revert leaves behind; this
  makes the runtime agree with it without waiting for a restart.

- 75e6871: fix(metadata-protocol): `revertCommit`'s soft-remove limb states its write intent per item, so a commit that CREATED an object can be reverted (#6620)

  `ObjectStackProtocolImplementation.revertCommit` has two limbs. #6563 (PR #6642)
  fixed the one that RESTORES an edited artifact, where the intent was unstated and
  fell through to `restoreVersion`'s `?? 'override-artifact'` default. The other
  limb — an artifact the commit CREATED, which the revert soft-removes — stated the
  same intent as a literal constant:

  ```
  intent: 'override-artifact',
  ```

  `SysMetadataRepository.delete` opens with `this.assertAllowed(ref.type, opts.intent)`,
  the same gate `put` uses, and it refuses every type whose registry entry is not
  `allowOrgOverride`. `object` is exactly such a type, so every created object of a
  reverted commit came back in `failed[]`:

  ```
  [NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.
  Overlay-allowed: view, page, dashboard, app, action, report, dataset, ...
  ```

  This is the FIRST-BUILD undo — the Studio / AI flow that publishes a brand-new app
  and then undoes it. Every object the commit created stayed behind, the call
  answered `success: false` with a populated `failed[]`, and the package was left
  half-reverted: its overlay-allowed items removed, its objects not.
  `rollbackToPackageCommit` reverts through the same loop and inherited it, and
  there the symptom was quieter still — a per-item refusal never throws, so the
  rollback recorded the commit as reverted and answered `success: true` while the
  created object was untouched.

  The limb now derives the intent from the artifact the way the sibling DELETE
  caller `deleteMetaItem` already does — `isArtifactBacked` gives
  `'override-artifact'`, otherwise `'runtime-only'` — and does it **per item**,
  because one first-build commit routinely creates a runtime object beside a
  packaged-artifact name. All three delete/revert callers (`deleteMetaItem`,
  `rollbackMetaItem`, both `revertCommit` limbs) now derive the same fact the same
  way.

  The repository's gate is deliberately unchanged: it is right for callers that
  genuinely mean "override a packaged artifact", and the defect was this caller
  never saying which of the two cases each item is. An object a code package really
  ships still resolves to `'override-artifact'` and is still refused with
  `NOT_OVERRIDABLE`, which is pinned alongside the fix.

- e6025e9: fix(metadata-protocol): `revertCommit` states its write intent per item, so an `object` overlay can be reverted at all (#6563)

  `ObjectStackProtocolImplementation.revertCommit` restored an edited artifact
  through `repo.restoreVersion(ref, prevVersion, { actor, source, message })` — with
  no `intent`. `SysMetadataRepository.restoreVersion` therefore fell back to its
  `?? 'override-artifact'` default, `put` opened with
  `assertAllowed(ref.type, opts.intent)`, and that gate refuses every type whose
  registry entry is not `allowOrgOverride`. `object` is exactly such a type, so
  every `object` item of a reverted commit came back in `failed[]`:

  ```
  [NOT_OVERRIDABLE] 'object' is not allowOrgOverride in the registry.
  Overlay-allowed: view, page, dashboard, app, action, report, dataset, ...
  ```

  The package-commit undo (ADR-0067) therefore could not revert the metadata type
  Studio and AI-built apps create most, while the same edit reverted fine one
  artifact at a time through the version-history revert — the two user-facing
  revert paths disagreed about what is revertable. The failure was per item, so
  the call still answered `success` overall with a populated `failed[]`, which
  reads as a flaky revert rather than a systematic refusal.
  `rollbackToPackageCommit` reverts through the same loop and inherited it, and
  there the symptom was quieter still: a per-item refusal never throws, so the
  rollback recorded the commit as reverted and answered `success: true` while the
  object was untouched.

  `revertCommit` now derives the intent from the artifact the way its sibling
  `rollbackMetaItem` already does — `isArtifactBacked` gives `'override-artifact'`,
  otherwise `'runtime-only'` — and does it **per item**, because a commit is a
  batch that routinely mixes a runtime-created object with an overlay on a
  packaged view.

  The repository's default is deliberately unchanged: it is right for callers that
  genuinely mean "override a packaged artifact", and the defect was this caller
  never saying which of the two cases it is. So the gate is not widened — an
  object a code package really ships still resolves to `'override-artifact'` and
  is still refused with `NOT_OVERRIDABLE`, which is pinned alongside the fix.

- 4ac12ef: fix(spec,lint): a virtual `formula` field in `searchableFields` is refused loudly, not admitted verbatim (#6674)

  #4254 closed the fail-open on the unknown-name axis: a `$searchFields` entry the
  engine would not scan is `400 INVALID_FIELD`, never a silently widened search.
  The same shape survived one axis over, on names that are perfectly real.

  The declared branch of `resolveSearchFieldResolution` filtered entries by
  EXISTENCE only, so a `formula` field declared in `searchableFields` entered the
  allowed set — and the ingress gate, which reads that same set, accepted it for
  exactly that reason. Measured on `origin/main`:

  ```
  AUTO:          {"allowed":["name","project_name"],"source":"auto"}                formula excluded
  DECL-FORMULA:  {"allowed":["name","project_name_formula"],"source":"declared"}    admitted verbatim
  ?search=Apollo&searchFields=project_name_formula  ->  200, 0 rows                 silent
  ```

  Zero rows is the defect. A formula value is computed on read and no driver
  materializes a column for it (`driver-sql` `fieldHasColumn`, driver-turso's
  "Virtual — no column"), so the `$contains` the engine expands `$search` into has
  nothing to scan: 0 rows on driver-memory (the property is absent from the stored
  row) and 0 rows WITH NO ERROR on driver-sql/better-sqlite3. The declaration read
  as search coverage and delivered none.

  - **`@objectstack/spec` — the deciding face.** The declared branch now filters on
    existence AND scannability: an entry naming a virtual field is not admitted.
    New exports `SEARCH_VIRTUAL_TYPES` (exactly `formula`, pinned) and
    `isVirtualSearchField` — one judgment, so the resolution, the gate and the
    linter cannot drift about which types have a column. The resolution itself
    stays non-throwing: it is consulted on every search by internal callers that
    never pass an ingress, which is why #4254 put the loudness at the ingress.
  - **`@objectstack/metadata-protocol` — `400 INVALID_FIELD` with its own reason.**
    Split out before the declared/auto branch, because both of those messages are
    wrong for it: "outside the declared set" is false when the entry IS in the
    list, and the auto-default's "declare `searchableFields` to choose the
    searchable set" would instruct the author to write the declaration being
    refused. The new message names the field, its type, that the value is computed
    on read and never stored, and the fix (mirror onto a stored text field).
  - **`@objectstack/lint` — a build error at authoring time**, on the object's own
    `searchableFields` as well as a view's narrowing, under the existing
    `searchable-field-unsearchable` rule (no new rule id). This narrows the
    canonical surface, which #4830 had deliberately left existence-only.

  The carve-out that made canonical existence-only is deliberately KEPT and pinned
  by controls in all three packages: the dividing line is STORAGE, not search
  quality. A `json` or `lookup` column declared in `searchableFields` is still the
  author's choice and still executed — a `$contains` over the stored JSON text or
  the stored foreign key. Narrow and rarely useful, but a scan that CAN match, so
  it is neither a 400 nor a finding. Only "there is no column at all" is refused.

  **Compatibility.** A corpus sweep of this repo plus `objectui` and `cloud` found
  ZERO authored `searchableFields` naming a formula-typed field, so nothing in the
  tree changes verdict. For an already-published object that does carry one:
  loading is unaffected (no schema-parse change — `searchableFields` is still
  `z.array(z.string())`, this is a resolution and enforcement rule); a plain
  `?search=` keeps returning the SAME rows, because the dropped entry matched none
  of them; only a request that NAMES the formula field flips from `200` with no
  rows to `400 INVALID_FIELD` — including objectui's list search, which echoes the
  declaration verbatim. An object whose `searchableFields` is ENTIRELY formula
  entries filters to empty and falls through to the auto-default, exactly as an
  all-stale declaration has since #4254; the linter reports the declaration rather
  than leaving that swap silent.

- 6443b79: fix(data): the dotted-path `400 INVALID_SORT` hint prescribes a **stored** field, not a formula (#6924)

  `assertSortFieldsExist` refuses a dotted `orderBy` (`?sort=account.company_name`)
  and then told the author how to fix it: _"Denormalise the value onto '<object>'
  (a formula or rollup field that copies it into a real column) and sort by that."_
  That prescription cannot be built. Following it lands the author back inside the
  exact silent degradation the refusal had just saved them from.

  Measured on a REAL `SqlDriver` (better-sqlite3) and on `InMemoryDriver`, with a
  `formula` field named directly in `orderBy` (non-dotted, so this gate lets it
  through):

  ```
  control   orderBy title asc     -> A B C D E      a real column really sorts
  baseline  no sort               -> C A E B D      insertion order
  orderBy   <formula field> asc   -> C A E B D  200 insertion order
  orderBy   <formula field> desc  -> C A E B D  200 direction-blind
  ```

  A `formula` field is virtual — `SqlDriver.createColumn` returns early for it and
  no column is created (sqlite answers `no such column`), the engine evaluates the
  expression _after_ the driver returns, and the #3821 unknown-column backstop
  retries WITHOUT the sort. The response is `200`, every row present, order
  arbitrary: the failure mode #4226/#4256 exist to stop.

  The hint now reads: _"Denormalise the value onto '<object>' (a stored field,
  written when the source changes) and sort by that. Not a formula field: it is
  virtual, no driver materialises a column for one, and ORDER BY on it is silently
  dropped."_ — "stored" being the same word #6673 landed for the identical
  correction on the search axis.

  `rollup`/`summary` is dropped from the hint for a different reason, and the
  measurement is worth recording because it contradicts the reported diagnosis: a
  `summary` field **does** get a real, maintained column (`orderBy <summary> desc`
  returned `E D C B A` over values `5 4 3 2 1`), so it is not unmaterializable. It
  simply cannot do this job — a rollup aggregates CHILD records
  (`count`/`sum`/`min`/`max`/`avg`) and so cannot carry a looked-up parent's column
  onto the queried object.

  **This overturns a recorded decision.** #4256 (closed `completed`) explicitly
  chose the "formula or rollup" wording as its remedy for dotted-path sort, and its
  own still-pending changeset (`sort-dotted-path-rejected.md`) describes it; that
  file is left as the accurate record of what #4256 shipped, and this entry
  supersedes its prescription. `content/docs/protocol/objectql/query-syntax.mdx`
  ("Sorting on Related Fields") taught the same denormalization and is corrected in
  the same change, so code and docs stop agreeing with each other about something
  untrue.

  Not fixed here, filed separately: the platform still accepts a **non-dotted**
  `orderBy` naming a `formula` field and answers `200` in arbitrary order. That is
  an engine/driver-side refusal question, not hint text.

- 3d4c545: fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

  `sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

  现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

  - **名额可回收**——归档视图不再占用名额，同名视图可以重建；
  - **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
  - **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
  - **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

  `metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

  已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。

- bb7cb41: fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

  #5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
  as a runtime partial UNIQUE index, and deliberately changed only the index's
  **row scope** — that is what made it strictly weaker than the index it replaced
  and therefore incapable of failing on existing data. It also left the other
  half of the same index broken, and pinned that gap honestly rather than closing
  it.

  SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
  views and `organization_id` is NULL for environment-level ones, so
  `(name, organization_id, owner)` constrained **personal views only**. Measured
  on real SQLite over the driver's own DDL:

  ```text
  two ACTIVE personal views, same (name, org, owner) : REJECTED
  two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
  two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
  ```

  Two same-name shared views inside one tenant were therefore reachable, while
  `name` is declared as the globally unique qualified view id (`object.viewKey`)
  — so the view switcher, which aggregates and de-duplicates by `name`, and every
  read path that locates a view by name, had no defined answer about which row
  they got.

  **What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
  The same runtime migration materializes the key NULL-safe, folding each nullable
  part's NULLs into one bucket that is unique among itself:

  ```sql
  CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
    (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
    WHERE state = 'active'
  ```

  Both spellings are copied from an existing in-repo precedent rather than
  invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
  column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
  `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
  discriminator. Neither can collide with real data — an organization id may never
  equal `'__global__'`, and an owner is a user id, never the empty string.
  **Storage is untouched**: rows keep their NULLs, only the index folds them, so
  `WHERE owner = ''` still matches nothing.

  Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
  shared views too), a shared view and a personal view may still share a name, and
  so may two tenants' or two environments' rows.

  **This is a tightening, so it can fail to build.** Unlike #5839, rows that
  violate the new key exist in the wild today, precisely because nothing rejected
  them. The migration probes before it replaces anything, and on a conflict takes
  ADR-0120 D4's disposition: the previous index is left in place (the table is
  never left unconstrained), the report names the key that is not enforced, ships
  the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
  points at `os migrate plan` — and the boot continues. Resolve the duplicate
  active shared views, restart, and the tightening applies itself.

  Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
  composite, which is ADR-0120 D3's own degradation. That report is **raised from
  `info` to `error`**: under #5839 alone the dialect lost slot recycling, a
  functional degradation the next user hits immediately, but it now loses an
  integrity guarantee the platform states it enforces while continuing to look
  healthy — AGENTS.md's durability arm. The line names both gaps that stay open
  there and the duplicate-listing query. The unclassifiable-failure arm is raised
  with it, so the failure nobody can name is never reported more quietly than the
  one that has a name.

- 50a8d11: fix(metadata-protocol): the view-definition conflict report's remedy query now runs on PostgreSQL, not only SQLite (#6772)

  `buildDuplicateProbeSql()` — the query `ensureViewDefinitionActiveIndex` ships
  **inside** its `error`-level degradation report, as ADR-0120 D4's "name the
  offending rows" — projected two bare columns while grouping by only their
  `COALESCE` forms:

  ```sql
  SELECT name, organization_id, owner, COUNT(*) AS duplicate_rows
  FROM sys_view_definition WHERE state = 'active'
  GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '')
  HAVING COUNT(*) > 1
  ```

  PostgreSQL requires every non-aggregated projection to appear **verbatim** in
  `GROUP BY`; wrapped in an expression does not count. So the query an operator is
  handed fails with

  ```text
  ERROR:  column "sys_view_definition.organization_id" must appear in the GROUP BY
          clause or be used in an aggregate function
  ```

  on one of exactly **two** dialects that can build the partial index the report is
  explaining. The operator copy-pastes the remedy out of an error message and gets
  a second error instead of the conflicting rows. SQLite accepts the bare form,
  which is why the existing real-SQLite test stayed green and the defect shipped;
  MySQL/MariaDB reaches the same string through the `unsupported` arm.

  Each folded column is now projected through its own `COALESCE` under a bucket-key
  alias — the shape `overlay-index.ts`'s `buildOverlayDuplicateProbeSql()` already
  uses for the sibling migration (#6770):

  ```sql
  SELECT name, COALESCE(organization_id, '__global__') AS organization_id_key,
         COALESCE(owner, '') AS owner_key, COUNT(*) AS duplicate_rows
  FROM sys_view_definition WHERE state = 'active'
  GROUP BY name, COALESCE(organization_id, '__global__'), COALESCE(owner, '')
  HAVING COUNT(*) > 1
  ```

  Every bare projection is now a bare `GROUP BY` term, so the query is legal on
  both dialects. The projection and the `GROUP BY` are built from the same array,
  so they cannot drift apart again. Nothing is lost by reading bucket keys instead
  of stored values: neither sentinel can occur in real data, so
  `organization_id_key = '__global__'` means `organization_id IS NULL` and
  `owner_key = ''` means `owner IS NULL`.

  The function's "Dialect-neutral: `COALESCE`, `GROUP BY` and `HAVING` are ANSI on
  every engine this platform runs on" comment was true about the three constructs
  and false about the query built from them; it now states the projection rule the
  query has to satisfy, and why the real-SQLite test cannot see it.

  No behaviour change to any index, write path or status: only the text of the
  remedy query inside the two degradation reports.

- c9bf940: fix(metadata-protocol): 对象 overlay 写路径按真实 package id 记录 registry 归属,并由服务端强制盖 `_provenance: 'org'`

  `applyObjectRegistryMutation` 此前把每一次对象写入都硬编码登记在 `'sys_metadata'` 哨兵下。
  该归属键同时就是包过滤键(`SchemaRegistry.getAllObjects(packageId)` 匹配的是
  `contributor.packageId`),因此通过 Studio 包工作区新建的对象,在自己所属包的过滤结果里
  一直是空的,直到有别的路径重新登记它。现在改为使用该行真实的 `package_id`;哨兵只保留
  给「没有绑定任何包」的写入,`rollbackMetaItem` 则从行本身读出绑定(而不是从请求读)。

  同一次改动里,服务端在**副本**上无条件盖 `_provenance: 'org'`,不再采信请求体里的值:
  只搬归属键而不盖章会立刻复活 cloud#970 —— `applyProtection` 会把带包 id 且自身没有
  provenance 的 body 默认标成 `'package'`,`getArtifactItem` 据此认定它是代码制品,
  `object` 又声明了 `allowOrgOverride: false`,于是用户刚建好的对象在下一次保存时收到
  `403 not_overridable`。`metadata-read-decorations.ts` 有意不剥离 `_provenance`,
  Studio 的 GET → PUT 往返会把它原样送回,所以这个事实必须由服务端陈述。

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
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e9b5265]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [d0e5537]
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
- Updated dependencies [55da611]
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
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [d5e9f6e]
- Updated dependencies [e48d861]
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
- Updated dependencies [01fd9e1]
- Updated dependencies [cafec0a]
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
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [4bda5f8]
- Updated dependencies [8b82686]
- Updated dependencies [d06b3dc]
- Updated dependencies [a5ca08d]
- Updated dependencies [424c510]
- Updated dependencies [6ce10bd]
- Updated dependencies [5087ac6]
- Updated dependencies [7618ee8]
- Updated dependencies [6965160]
- Updated dependencies [ecff951]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [7c6261a]
- Updated dependencies [08863dd]
- Updated dependencies [1da39f5]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [f012f55]
- Updated dependencies [d0d5205]
- Updated dependencies [9960cd2]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [cd584d5]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [9bc846b]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [ca522e9]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [59e9b7c]
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
- Updated dependencies [3de535b]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [8599c21]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [1bb679c]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [92e13a0]
- Updated dependencies [ea8e849]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/lint@17.0.0-rc.6
  - @objectstack/metadata-core@17.0.0-rc.6
  - @objectstack/metadata@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/lint@17.0.0-rc.5
  - @objectstack/metadata@17.0.0-rc.5
  - @objectstack/metadata-core@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- f61c8cf: feat(spec,metadata-protocol)!: a sort node spelling its direction `direction` is a 400, not a silently reversed page (#4721)

  **FROM → TO:** `orderBy: [{ field: 'updated_at', direction: 'desc' }]` →
  `orderBy: [{ field: 'updated_at', order: 'desc' }]`. One word. If you are on the
  `{field, direction}` shape because you moved code over from
  `IReportService.orderBy`, that contract is unchanged — it is `orderBy` on the
  QueryAST / `EngineQueryOptions` axis that has always been `{field, order}`.

  ## What was wrong

  `SortNodeSchema` was a plain `z.object`, so zod's default `.strip` applied.
  Measured on `main` before this change:

  ```
  SortNodeSchema.parse({ field: 'updated_at', direction: 'desc' })
    →  { field: 'updated_at', order: 'asc' }
  ```

  `direction` was discarded and `order` fell back to its `asc` default. The sort
  therefore ran in the **opposite** direction and the request succeeded. Paired
  with `limit` — which is how a caller asks for "the latest N" — that is not a
  reordered page but a **different set of rows**, returned under an ordinary 200
  with nothing in the response to distinguish it from the answer that was asked
  for.

  `direction` is not a typo. It is the live vocabulary of a neighbouring contract,
  `IReportService.orderBy` (`@objectstack/spec/contracts`), and
  `plugin-auth/objectql-adapter.ts` already translates between the two by hand — a
  translation known to be necessary and enforced nowhere, which is the ADR-0049
  shape.

  ## What changed

  Both doors onto that shape, in one change:

  1. **`SortNodeSchema`** (`spec/src/data/query.zod.ts`) is now `strictObject`
     with `aliases: { direction: 'order' }`. An unknown key is rejected, and
     `direction` specifically gets the translation in the error message — edit
     distance can never bridge `direction` → `order`, so a bare "unrecognized key"
     would leave the caller exactly where the silent strip did.
  2. **`normalizeSortNodes`** (`metadata-protocol/src/protocol.ts`), the ingress
     every REST/RPC `orderBy` funnels through, refuses `{ field, direction }` with
     `400 INVALID_SORT` naming `order` and quoting the corrected node. Closing only
     the schema would repeat the door asymmetry of #1535/#4522: `SortNodeSchema` is
     reachable by three paths the REST normalizer never sees.

  | `orderBy` you send                                     | Before                      | After                                                       |
  | :----------------------------------------------------- | :-------------------------- | :---------------------------------------------------------- |
  | `[{ field: 'x', order: 'desc' }]`                      | descending                  | unchanged — descending                                      |
  | `[{ field: 'x', direction: 'desc' }]`                  | **200, ascending**          | `400 INVALID_SORT`, message names `order`                   |
  | `[{ field: 'x', order: 'desc', direction: 'asc' }]`    | 200, descending             | `400 INVALID_SORT`                                          |
  | `'-x'` / `['-x']` / `{ x: 'desc' }`                    | descending                  | unchanged                                                   |
  | `{ direction: 'desc' }` (the `{field: direction}` map) | sorts by column `direction` | unchanged — a column may legitimately be called `direction` |

  Scope is deliberately narrow: **`QuerySchema`'s top level is untouched** and
  still accepts undeclared keys (`QuerySchema.safeParse({ object: 'sales',
nonsenseKey: 1 }).success === true`). That is tracked in the #4001 campaign map
  for its own batch, not smuggled in here.

  Related: #4674, #4720, #4363, #4371, #4001, ADR-0049.

### Minor Changes

- 77022a9: feat(spec,runtime,metadata-protocol)!: one schema for both discovery producers — `capabilities` canonical, `features`/`endpoints` retired, `scoping` declared (#4828)

  `/discovery` is a machine-readable surface, but nothing compared what the two
  producers emit against what `packages/spec` declares. The only schema the
  protocol layer referenced was `GetDiscoveryResponseSchema` —
  `DiscoverySchema.partial().required({version}).extend({apiName})` — so
  `.partial()` hid every missing REQUIRED key while zod's default unknown-key
  strip hid every UNDECLARED emitted one. The two producers then drifted in
  opposite directions through the same blind spot.

  `DiscoverySchema` is now authoritative for producers, and each producer package
  carries a `discovery-schema-conformance.test.ts` that parses its LIVE shape
  against it and checks its emitted key set against the protocol schema's shape.

  **Breaking for anyone reading the dispatcher's `/.well-known/objectstack` body:**

  - `features` → **`capabilities`**, the name `DiscoverySchema` has always
    declared, in the declared `{ enabled }` shape. The same flags survive. This
    fixes a real defect: the SDK's `client.capabilities` getter reads
    `discoveryInfo.capabilities`, so against a dispatcher-served host it returned
    `undefined` for every flag while the answers sat one key away under `features`.
  - `endpoints` — **removed**. It duplicated `routes` verbatim as a
    "backward compatibility" alias; a consumer census across `objectstack`,
    `objectui` and `cloud` found no reader. Use `routes`.
  - `environment` is now **mapped** into its declared enum instead of passing
    `NODE_ENV` through raw (`test` → `development`, `staging` → `sandbox`,
    unrecognized → `development`, never `production` on a guess). `NODE_ENV=test`
    and `staging` previously advertised values outside the declared enum.

  **Additive elsewhere:**

  - `DiscoverySchema` declares `scoping` (optional) — the environment-scoping
    posture the REST endpoint has always emitted and `packages/client` has always
    consumed, now part of the contract instead of an undeclared extra.
  - The REST `/discovery` body gains the required `name` / `environment` /
    `locale`, so it can satisfy `DiscoverySchema` at all. `locale` is derived from
    the registered i18n service, the same way the dispatcher derives it.
  - `name` is canonical on both producers. `apiName` remains as a deprecated alias
    carrying the identical value and is **scheduled for removal in protocol 18**.
  - New exports: `DiscoveryEnvironmentSchema`, `DiscoveryEnvironment`,
    `resolveDiscoveryEnvironment`.

- aac90a5: feat(spec,runtime,metadata-protocol,client)!: one closed capability vocabulary — every discovery producer emits every key (#5672)

  `#4828` renamed the runtime dispatcher's top-level `features` map to the
  canonical `capabilities`, which collapsed the _spelling_ split between the two
  discovery producers. It did not touch the deeper one: the two went on filling
  **disjoint key sets**.

  | producer                                                                             | keys it filled                                                                        |
  | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
  | `getDiscovery()` — `@objectstack/metadata-protocol`, upstream of REST `/discovery`   | `comments` `automation` `cron` `search` `export` `chunkedUpload` `transactionalBatch` |
  | `getDiscoveryInfo()` — `@objectstack/runtime` dispatcher, `/.well-known/objectstack` | `search` `websockets` `files` `analytics` `ai` `notifications` `i18n`                 |

  Only `search` overlapped. `DiscoverySchema.capabilities` was an open
  `z.record`, so both shapes parsed clean and no gate could see the split — while
  `packages/client`'s `capabilities` getter **asserted** the result was a
  `WellKnownCapabilities`. Against a dispatcher-served host
  `client.capabilities.transactionalBatch` was therefore statically `boolean` and
  actually `undefined`, as were `comments`, `cron`, `export` and `chunkedUpload`.

  Per the maintainer's 2026-08-06 ruling, the vocabulary is now closed and
  mandatory.

  **What a consumer sees.** Before: which capability flags exist depended on
  which kind of host answered, and a flag you were typed to receive could simply
  be missing. After: every discovery response carries **every** flag, always a
  boolean. A capability the host does not deliver is `enabled: false` — never an
  absent key — so a client can read a flag without knowing whether it reached a
  dispatcher, the REST endpoint, or anything else. `client.capabilities` no longer
  asserts its own return type: it enumerates the spec's key list, so the type is
  true by construction, and it reads a key an older server omits as `false`
  (fail-closed, matching the wire rule).

  **`@objectstack/spec`.** `WellKnownCapabilitiesSchema` becomes the one
  vocabulary and gains the six flags that were previously the dispatcher's alone
  (`websockets`, `files`, `analytics`, `ai`, `notifications`, `i18n`) — all six
  were already real answers on the wire, so this declares them rather than
  inventing them. `DiscoverySchema.capabilities` changes from an optional open
  record to a **required closed object** derived from that vocabulary, one entry
  per key. New exports: `WELL_KNOWN_CAPABILITY_KEYS` (the key list, derived from
  the schema so nothing can hand-list a fourth dialect) and
  `CapabilityDescriptorSchema` / `CapabilityDescriptor` (the `enabled` +
  optional `features` / `description` entry shape, previously inline).

  Required, not optional, is the `scoping` precedent read the other way round:
  `scoping` is optional because only one producer can honestly answer it, whereas
  every producer can answer `capabilities` — and an optional block would leave a
  consumer back at `undefined` for every flag.

  **Producers.** Each answers all thirteen keys from its own facts, with the basis
  recorded per key in the code. The dispatcher now measures `comments` off the
  `sys_comment` object in the registry it already resolves for its `/data` domain,
  and `automation` / `cron` / `export` / `chunkedUpload` off the same service
  predicates that gate its route advertisements. Its one honest `false` is
  `transactionalBatch`: the atomic cross-object `/batch` route is mounted by
  `@objectstack/rest`, and this dispatcher has no batch branch at all, so claiming
  the runtime's `transaction()` here would advertise an endpoint the host does not
  serve. `getDiscovery()` answers the six new flags off the service registry it
  already reads, gated on serveability so a self-declared stub does not advertise
  a capability it cannot back.

  **Gates.** The three `discovery-schema-conformance.test.ts` suites built by
  `#5682` and extended to `routes` by `#5743` gain a fullness criterion — every
  vocabulary key present, every `enabled` a real boolean, no key outside the
  vocabulary — with the allowance derived from the schema rather than written out.

  **Upgrading.** A producer or fixture that builds a `DiscoverySchema`-shaped
  document must now include a complete `capabilities` block; build it from
  `WELL_KNOWN_CAPABILITY_KEYS` rather than by hand. Consumers need no change:
  they receive strictly more keys than before, and any flag they already read
  keeps its meaning. The lenient wire wrapper `GetDiscoveryResponseSchema` still
  allows the block to be absent, so a response from an older server still parses.

### Patch Changes

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

- c497d26: fix(objectql): `autonumber` 是运行时拥有的字段,写路径不再接受调用者提交的单号 (#5503)

  `autonumber` 的值一直被文档声明为运行时所有 —— `applyAutonumbers` 的注释写着
  "the runtime owns the value, not the client",两个记录校验器也正是因此在 insert
  与 update 上都豁免了 `required` 检查。缺的是另一半:**没有任何一层写路径阻止客户端
  自己填这个值**。于是一个普通的 REST 调用者可以:

  - `POST /data/:object` 携带显式单号 → 原样落库,序列被绕过;
  - `PATCH /data/:object/:id` 携带该字段 → 200 且改写落库,业务单号被篡改。

  这与已修复的 #4447(`created_at` 可被普通 PATCH 伪造)是同一缺陷族。区别在于:
  声明了 `readonly: true` 的字段早已被 #2948 / #3043 的剥离机制保护,而 `autonumber`
  字段身上根本没有这个标记,剥离循环从它旁边直接走过去了。

  **修法:在引擎/校验层把 `type: 'autonumber'` 视为隐含 readonly,insert 与 update
  同权。** 非 system 上下文提交的单号,在派发给任何驱动之前就被剥离:

  - **UPDATE** —— `stripReadonlyFields`(`packages/objectql`)的判定从"作者声明的
    `readonly: true`"扩展为"作者声明的 **或** 运行时拥有的字段类型"
    (`isRuntimeOwnedField`,当前恰好只有 `autonumber`)。单行更新与 `multi` 批量更新
    共用这一个剥离点,因此两条路径同时被覆盖。
  - **INSERT** —— 引擎新增一个更窄的 `stripRuntimeOwnedFields`,只剥离运行时拥有的
    字段。它**不**接管作者声明的 `readonly` 在 insert 上的语义:那条防线按 #3413 的
    设计留在 DataProtocol 入口(#3043),因为 create 确实可能合法地写入只读列,而直接
    调用 `engine.insert` 的可信内部写入者(身份预置、元数据仓库、事件游标)必须不受影响。
    单号没有这种两可性 —— 谁都不该在 create 时自带单号。

  剥离发生在引擎里、派发之前,这正是修复**与驱动无关**的原因:声明
  `supports.autonumber === true` 的 SQL 驱动(持久序列)拿到的行里根本没有这个键,
  所以它的序列必然胜出 —— 没有任何驱动需要改动一行代码。测试直接断言递交给
  `driver.create` 的负载,而不是打补丁到驱动上。

  **豁免语义保持不变**,与 update 侧原有的白名单完全一致:

  - `isSystem` 写入(seed 回放、迁移、内部预置)整体跳过剥离;
  - `preserveAudit`(#3493)的"历史数据导入"仍可写入原始单号 —— 把遗留系统的历史
    单号迁移进来正是这个白名单存在的业务场景,而 `autonumber` 属于作者声明的业务字段
    (`system !== true`),恰好落在 `isPreservableUnderAudit` 允许的范围内;
  - `beforeInsert` / `beforeUpdate` 钩子计算出的值不受影响 —— 只有**调用者提交**的键
    才是剥离候选。

  **这是一次静默剥离,所以它被上报而不是被吞掉。** 引擎 insert 路径上的
  `onFieldsDropped`(#3407)此前只是为了与 `update()` 对称而存在、从不触发,并留了一
  句"若 insert 将来出现静默剥离,必须在剥离点接上监听器"——现在正是那个剥离点。
  事件沿用既有的 `readonly` 原因码(对调用者而言,隐含只读与声明只读被丢弃的理由完全
  相同,不值得为一个没有消费者会区分的差别在 `packages/spec` 里分叉词表)。
  `createManyData` 与 `insertManyData` 也补上了监听器转发:后者保持**逐行精度**——
  引擎事件是整批的并集,但剥离只会移除**行自身提交过**的键,因此可以准确归属回具体行。
  导入器优先走的正是 `insertManyData` 这条部分成功路径。

  **与 `strictReadonlyWrites`(#5126 / #5610)叠加。** 该开关是"剥离即拒绝"的进程内出路,
  本次改动使它自然覆盖单号,两条路径同权:

  - **UPDATE 无需新代码** —— autonumber 限肢走的正是 `stripReadonlyFields` →
    `reportDroppedFields` → `assertNoStrictDrops` 这条 #5126 已经铺好的接缝,因此 strict
    开启时,调用者提交的单号与声明 `readonly` 的字段一样被拒绝,整笔写入不落库;
  - **INSERT 需要接上** —— #5126 当时把该开关在 insert 上留作惰性,并写下条件:"insert
    一旦有了剥离,两个成员就在那个剥离点一起接上"。本次正是那个剥离点,于是
    `onFieldsDropped` 与 `strictReadonlyWrites` 一并兑现:默认剥离+上报,strict 开启则在
    任何驱动调用之前抛 `ERR_READONLY_FIELD_REJECTED`,且**监听器不触发**(被拒绝的写入
    并未完成,这是 #5126 自己的设计要点)。

  接缝处**没有新增任何策略**:#5126 明确写着 strict "不引入第二套策略,它只是把既有策略
  报出来",且"剥离拿不走的字段也不会被拒绝"。照此逐字适用,`isSystem` 与 `preserveAudit`
  两个豁免在 strict 下依旧被接受(它们根本不会走到剥离分支)。

  `ReadonlyFieldRejectedError` 新增可选的 `operation`(默认 `'update'`,#5126 的 UPDATE
  文案逐字节不变):动词与补救办法确实因操作而异 —— INSERT 的拒绝必然关于运行时拥有的值,
  其合法写入者是 `isSystem` 与历史导入 `preserveAudit`,而 `readonlyWhen` 在 create 上
  根本锁不住任何东西。

  **升级影响。** 普通(非历史)导入若把遗留单号列映射到 `autonumber` 字段,该值现在会
  被丢弃并改由序列发号,同时在响应的 `droppedFields` 里上报、在服务端日志里留下一条
  带补救办法的 `warn`。要保留原始单号,请把导入标记为历史导入
  (`treat_as_historical` → `preserveAudit`),这与 #3493 为只读业务字段确立的划分一致。

  `packages/spec` 未改动:`autonumber` builder 是否应当直接注入 `readonly: true` 是
  spec 层的独立议题,与这条引擎侧防线不冲突。

- e96ad55: fix(metadata-protocol): `batchData`'s upsert fork decides update-or-insert by EXISTENCE, not caller visibility (#5099)

  The fork asked `findOne` under the CALLER's context — the read RLS/sharing
  narrows (#3455). An existing row outside the caller's read scope therefore
  answered `null` and took the INSERT arm: on a store with a unique id constraint
  the insert duplicate-keyed (an authorization/update scenario reported as a key
  collision — the same misdirection class as #5088), and on a store without one
  it wrote a **second row** for an id that already exists.

  The fork now uses the same existence probe (`probeRecord`, system context) as
  the single-record path and the update/delete bulk faces (#4620: one reading per
  file). Whether the caller may WRITE the row it proves stays exactly where it
  was — #1994's pre-image check inside `engine.update` — so the row's outcome is
  the write policy's own answer instead of a spurious `duplicate key` error.

  **Observable change under row-level visibility**: upserting an id that exists
  outside your read scope no longer attempts an insert. The row now answers
  whatever the by-id update path answers for that record (for a masked pre-image
  check, the same 404 a direct update returns). The existence oracle is not
  widened: the previous duplicate-key failure already revealed that the id
  exists.

  The non-atomic fallback (update threw → blind insert) is removed with it, on
  both arms. With existence decided before the fork, the fallback could only
  bury a real update failure under the duplicate-key error of inserting a row
  just proven to exist — the same masking ADR-0119 D4 already forbade inside the
  atomic arm. A row whose update fails now reports that failure.

  Cost note: each by-id upsert row now performs one existence read before the
  write — the same probe cost #4435 accepted for the single-record path and
  #5088 accepted for the update/delete bulk faces.

- bbdbf28: fix(metadata-protocol,objectql): a boot that could not read `sys_metadata` says so at `error`, instead of reporting "no persisted metadata" at debug (#5897)

  `loadMetaFromDb` — the boot step that hydrates `sys_metadata` overlay rows into
  the SchemaRegistry — returned `{ loaded, errors, invalid }`, and no field in
  that shape could express **"this hydration never read the store"**. An
  unreachable database and a genuinely empty one both answered `loaded: 0`.

  Its only production consumer, `ObjectQLPlugin.restoreMetadataFromDb`, therefore
  had nothing to branch on: its single branch chose between two log lines, and
  the "nothing came back" side was
  `logger.debug('No persisted metadata found in database')`. So a kernel that
  could not read a word of its persisted metadata stated at **debug** level that
  there was none, and went on to report ready.

  What that costs is not hypothetical — it is written into the plugin's own
  Phase 2 comment. With the registry empty, `registry.getObject` answers "not
  declared" where the truth is "we could not look": unknown-column query guards,
  hooks and relationships silently degrade, and overlay objects get neither a
  synced table nor a metadata bridge. This is ADR-0110 D3 (an outage is not a
  miss) on the boot side, after the same rule landed for `DatabaseLoader`
  (#5108), `listForIndex` (#5089) and the overlay reads (#5532 / #5707).

  **What changed**

  - `loadMetaFromDb` returns `storeUnavailable: boolean`, set on exactly the
    branch that already prints `[Protocol] DB hydration skipped` — a read that
    failed for a reason `isMissingTableError` does _not_ call benign. A store
    that has merely not been provisioned yet (first boot, before migrations)
    keeps `storeUnavailable: false`, because `loaded: 0` genuinely is the truth
    there (#5841).
  - `restoreMetadataFromDb` reads it and logs at **`error`**, naming the
    consequence (nothing was restored, the kernel keeps reporting healthy, and
    which capabilities silently degrade) and the fix (check the datasource behind
    `sys_metadata` — connection, credentials, table existence — then restart).
    Per AGENTS.md "Degradation log levels": persisted state and runtime state
    disagreeing while the system still looks healthy is the `error` class. An
    empty-but-readable store keeps its quiet debug line, so first boots do not
    start emitting durability errors.

  **Not changed**: control flow. Boot still degrades and continues — refusing to
  boot on an unreadable overlay store would turn a transient outage into an
  outright one. What changes is that the degradation is now distinguishable from
  health, and reported as such.

  **Impact on duck-typed `ProtocolWithDbRestore` implementers**: none required.
  `ObjectQLPlugin` matches the `protocol` service structurally, and the new field
  is declared **optional** on its side of the contract, exactly as `invalid`
  already is. A shim that predates the field keeps type-checking and is read as
  "not an outage" — the only verdict it was able to express before — so its
  behaviour is byte-for-byte what it was. The trade-off is deliberate and worth
  naming: an optional field cannot _force_ a third-party shim to start reporting
  outages, so such a shim stays as silent as it is today. Requiring the field
  would have made that impossible to ignore at the cost of breaking every
  external implementer for a bit only one in-repo producer sets; the in-repo
  producer (`ObjectStackProtocolImplementation`) declares and returns it
  **required**, so the path that actually runs in every ObjectStack kernel is
  fully covered.

- 75bb3af: fix(metadata-protocol): the by-id BULK write faces refuse a row that names no record (#5088)

  `updateMany`, and `batch`'s `update` and `delete` branches, now answer
  `RECORD_NOT_FOUND` (404) for a row whose id resolves to nothing — the same code
  and the same message (`Record <id> not found in <object>`) the single-record
  `PATCH` / `DELETE` have answered since #4435.

  Before this, #4435's "a write that touched zero rows must not report success"
  was live on only 2 of the 5 write faces in `protocol.ts` (`updateData`'s
  existence probe and `deleteMany`'s `deleted === false`). The three bulk faces
  went straight to the engine, with two visible consequences:

  - **`updateMany` / `batch.update`** — a stale id entered the write pipeline.
    With no stored row to overlay, #4770's record materialisation (stored ⊕
    payload) produced a payload-only record, a hook `condition` reading any
    untouched field found it absent, and #4775's unevaluable-condition abort
    fired. The row failed `INTERNAL_ERROR` with a diagnostic accusing a _correct_
    hook of naming an undeclared field, so an operator with one stale id in a
    batch was told their hook was broken and pointed at the object's field list.
    Under `atomic: true` that row also poisoned the batch, taking every later row
    to `NOT_ATTEMPTED`. Hooks, automation and audit rows no longer fire at all for
    a record that does not exist.
  - **`batch.delete`** — discarded the driver's return and reported
    `success: true` unconditionally, so a batch of typo'd ids reported every one
    of them deleted. It now reads the driver contract's positive not-found value
    (`=== false`), exactly as `deleteMany` does.

  Existence is asked with the same `probeRecord` the single-record path uses: it
  answers EXISTENCE, not visibility, so the by-id write policy stays #1994's
  decision inside `engine.update` and the `rls-by-id-write` proof can still go
  red. `upsert` is deliberately unchanged (a missing id still inserts), as are
  the predicate bulk writes (`multi: true`, no per-row id) and the `atomic`
  response shape — the causal row keeps its position, later rows stay
  `NOT_ATTEMPTED`, and rows with real ids behave exactly as before.

  Note for high-volume callers: each by-id row in these three faces now costs one
  extra existence read before its write.

- 43ca399: fix(runtime): `callData`'s ObjectQL fallback answers a missing record id with 404 `RECORD_NOT_FOUND` (#5138)

  `callData` (the data bridge behind `/data`, the MCP bridge and the declarative
  endpoint executor) is protocol-first with an ObjectQL fallback. The fallback
  gave **three different answers to one fact** — that `id` names no row:

  | verb     | before                                                      | on the wire             |
  | -------- | ----------------------------------------------------------- | ----------------------- |
  | `get`    | `return … : null`                                           | `200 { data: null }`    |
  | `update` | `throw new Error('[ObjectStack] Not Found')` — no `.status` | **500**                 |
  | `delete` | no existence check at all                                   | `200 { deleted: true }` |

  The protocol path has answered `404 RECORD_NOT_FOUND` on all three verbs since
  #4435 (re-asserted for the batch path by #5088), so the answer to the same
  request depended on something no caller can see: whether the deployment
  registered the `protocol` slot (`MetadataPlugin` / `@objectstack/metadata-protocol`).
  All three fallback branches now throw the SAME envelope the protocol throws.

  Two of these were actively harmful. `update` reported a caller mistake as an
  internal fault — every dispatcher exit reads `.status` → `.statusCode` → 500, so
  a 4xx fact entered error reporting and alerting as a 5xx. `delete` reported
  success for a row that never existed, which is the hardest class to notice: an
  integrator reading `200` records the cleanup as done.

  The envelope is not re-spelled. `recordNotFoundError` is now exported from
  `@objectstack/metadata-protocol` and imported by the fallback, so there is one
  construction point and the two paths behind one `callData` cannot drift apart
  again.

  **Upgrade note.** If you run an assembly WITHOUT the metadata-protocol plugin
  (lean hosts, and the MCP multi-env path that threads a raw driver), these three
  calls change their answer for a missing id — from `200`/`200`/`500` to `404
{ code: 'RECORD_NOT_FOUND', message: 'Record <id> not found in <object>' }`.
  Deployments that DO register the protocol slot are unaffected: they already
  answered `404` and this release does not touch that path. A client that
  branched on `data === null` from `GET /data/:object/:id` should branch on the
  `404` instead; a client that treated `DELETE` as idempotent should treat `404`
  as "already gone". Declarative endpoints (`object_operation`) inherit the same
  answer, since they reuse `/data`'s delegation.

  `delete`'s existence check is a `find` probe, not a read of what `ql.delete`
  returned: `IDataDriver.delete` declares `Promise< boolean >` and the protocol
  can read it, but `IDataEngine.delete` declares `Promise< any >` and the engine
  returns its driver's result through the hook chain — testing that for `false`
  would be reading a signal the contract does not promise, and it fails in the
  direction this fixes.

- 1f82d1e: fix(metadata-protocol): `allowRuntimeCreate: false` is enforced on every kernel — `PUT /meta` no longer creates `job` / `agent` items the registry declares code-only (#5086)

  #4509 set `allowRuntimeCreate: false` on `job` and promised the refusal without
  qualification — _no "create job" in Studio or via `PUT /meta`_. ADR-0063 §2 says
  the same for `agent`. The gate that keeps that promise existed, and worked, but
  it sat behind `environmentId !== undefined`:

  ```ts
  if (this.environmentId !== undefined) {
    // …not_overridable / not_creatable…
  }
  ```

  `environmentId` is a **row-scoping key**, not an authorization signal. Every
  kernel assembled without one ran with the entire ADR-0005 authorization gate
  disengaged — and that is not an exotic topology. The CLI's lightweight
  assembler builds exactly that for a host config (`isHostConfig` → the
  `createStandaloneStack` branch is skipped → `new ObjectQLPlugin()` with no
  `environmentId`), which is the flagship showcase and every self-hosted app
  server shaped like it. On those, the issue's repro answered:

  ```
  PUT /api/v1/meta/job/rc3_runtime_job
      {"name":"rc3_runtime_job","label":"J",
       "schedule":{"type":"cron","expression":"0 0 * * *"},"handler":"nope"}
  → 200 {"success":true,"message":"Saved customization overlay (env-wide) — type=job, …"}
  ```

  `handler: "nope"` names no function in any compiled bundle. The row persists,
  lists, and can never be scheduled — the record #4509 exists to prevent, saved
  and reported as success. It is the ADR-0049 failure mode one level up: the
  _enforcement flag itself_ was the silently-inert declaration, and Studio (which
  reads the flag to hide "create") honoured a rule the API underneath did not.

  **What changed.** A type whose registry entry sets BOTH `allowRuntimeCreate:
false` AND `allowOrgOverride: false` declares that it has no runtime write
  channel at all. `saveMetaItem` now refuses it on every kernel, before
  persistence, in draft mode as well as publish:

  | write                                       | before        | now                   |
  | ------------------------------------------- | ------------- | --------------------- |
  | `PUT /meta/job/*` on a single-kernel host   | `200 success` | `403 NOT_CREATABLE`   |
  | `PUT /meta/agent/*` on a single-kernel host | `200 success` | `403 NOT_CREATABLE`   |
  | same, over a name a code package ships      | `200 success` | `403 NOT_OVERRIDABLE` |
  | project-scoped (cloud) kernels              | `403`         | `403` (unchanged)     |

  The refusal names the type, the flags that produced the verdict, the source
  file pattern to declare it in (read from the type's own registry entry, so a
  newly-flagged type carries an accurate hint the day it is flagged) and the
  `OS_METADATA_WRITABLE` escape hatch.

  **Scope, deliberately.** The rest of the ADR-0005 two-tier gate keeps its
  single-kernel carve-out: that ADR's "single-kernel deployments keep their
  existing behaviour" sentence is about the _overlay whitelist_, predates
  `allowRuntimeCreate` entirely, and a type that stays runtime-creatable
  (`object`, `hook`, `field`, `seed`, `mapping`, …) is untouched here. So is
  `deleteMetaItem` — removing a code-only row that predates this refusal is
  repair and must stay possible. `OS_METADATA_WRITABLE` remains the one door:
  unlocking a type there unlocks it here too.

  **Upgrading.** If a deployment relies on runtime-created `job` or `agent` rows,
  move them into source (`**/*.job.ts`, `**/*.agent.ts`) and redeploy — a `job`
  authored at runtime never had a reachable `handler` in the first place. To keep
  writing them while migrating, set `OS_METADATA_WRITABLE=job,agent`.

- 65159ae: fix(metadata-protocol): 分层读的 overlay 读失败不再被画成「这一项没有定制」(#5707)

  `getMetaItemLayered` 是 Studio「code / overlay / effective」对比视图背后的那次读
  (`GET /api/v1/meta/:type/:name?layers=true`)。它的 `sys_metadata` overlay 读裹着一个
  裸 `catch`,注释写着 "DB unavailable — overlay stays null" 然后照「没有 overlay 行」
  返回。

  那不是一个中性的兜底值。这个信封在**同一次响应里同时给出三个正面断言**,而且是 200:

  - `overlay: null` —— 「这一项从来没有被定制过」;
  - `overlayScope: null` —— 「org 和 env 两个作用域都没有行」;
  - `effective === code` —— 「现在生效的就是打包件原样」。

  对比视图存在的意义正是回答作者「我改过什么」。故障期它回答「什么都没改过」——
  和 #5532 同一个错误(可用性故障被讲成作者的声明事实),只是落在 diff 视图而不是 404 上。
  本次沿用 #5532 / PR #5705 的判定,补上该 PR 按 scope 刻意没有覆盖到的这一处读。

  **改了什么**:这一处 `catch` 改为调用同文件的 `rethrowUnlessMetadataStoreUnprovisioned`
  —— `isMissingTableError`(表尚未建 → 确实没有 overlay 行)良性放行,其余上抛
  `status: 503` / `code: SERVICE_UNAVAILABLE`,驱动原始错误挂在 `cause` 上。没有新增
  判定逻辑,也没有新的返回形状:分层信封仍是 code / overlay / effective 三**层**,而不是
  每层三**态** —— 「读不到」不是一层,所以照失败上报,不再冒充某一层的取值。

  **wire 可见变化**

  | 场景                           | 之前                                                                | 之后                                                     |
  | ------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
  | `sys_metadata` 不可达          | `200` + `overlay: null` / `overlayScope: null` / `effective = code` | `503` + `SERVICE_UNAVAILABLE`(`cause` 带驱动报文),可重试 |
  | org 作用域读失败、env 行本可读 | `200`,连那行 env overlay 也一并报告为「没有」                       | `503`,同上                                               |
  | `sys_metadata` 尚未建表        | `200` + 只有 code 层                                                | 不变                                                     |
  | 存储正常                       | 不变                                                                | 不变                                                     |

  REST 侧无需改动:`?layers=true` 与普通读共用同一个 `handleRouteError`,#5437 / #5464
  的消毒与日志口原样接住。已测量的消费方处置也都已就位:objectui 的
  `MetadataClient.layered()` 对非 2xx 一律 `throw`(只有 404 映射为空信封),
  ResourceEditPage 的加载 `try/catch` 把它渲染成错误态而不是空白页;
  `plugin-security` 的三个消费点里,两处本就有 `catch` 兜底,唯一没有的
  `projectPermissionMutation` 在 503 化后反而更安全 —— 此前的静默 `null` 会让权限集
  投影悄悄退回打包基线(`customized: false`),没有 declared body 时甚至会把记录
  retire,而协议的 `runMutationProjector` 契约是 never throws,会把 503 收敛成
  `projectionApplied: { success: false }`。

- 877545c: `MetadataProtocol.listCommits` 不再把 commit store 读不到答成「这个 package 没有提交历史」

  `listCommits` 读 `sys_metadata_commit` 的 `catch` 此前对任何失败都返回 `[]`,零日志、不按错误类型区分 —— 它的 JSDoc 甚至把这写成了设计(“Returns [] if the commit store is unavailable”)。于是 ADR-0067 的提交时间线上,「确实没有历史」与「有历史但库读不到」返回值完全一致,而这条时间线正是 `revertCommit` 的选择面:故障期间 UI 显示「无可回滚项」,`rollbackToPackageCommit` 更会在一次都没回滚的情况下返回 `success: true`。

  现在按错误类型区分,与本文件既有的 `sys_metadata` 覆盖层读法(#5532 / #5707 / #5840)同一处方:表未 provision(首启)仍返回 `[]`;其余失败一律包成 503 `SERVICE_UNAVAILABLE` 上抛,驱动原始错误挂在 `cause` 上。调用方由此能把 outage 与 miss 分开。

  行为变化:`GET /packages/:id/commits` 在 commit store 故障时返回 503 而不再是 `{ commits: [] }`。

- 444a07c: fix(metadata-protocol): boot hydration classifies "store not provisioned yet" by error type, not by a copied message regex (#5841)

  `loadMetaFromDb` — the boot step that hydrates `sys_metadata` overlay rows into
  the SchemaRegistry — decided whether a failed read was the benign first-boot
  case by running its own `/no such table/i` over `e.message`. That was a second,
  hand-copied vocabulary of "which driver errors are benign", sitting a few
  thousand lines below the first: the same file already imports
  `isMissingTableError` from `@objectstack/metadata/errors` and asks it in
  `rethrowUnlessMetadataStoreUnprovisioned` (#5532), as do this package's
  `SysMetadataRepository` (#4867) and `DatabaseLoader` (#5108).

  A copy is wrong in both directions, and only one of them is loud:

  - **SQLite** says `no such table: sys_metadata`, which the copy matched — by
    luck of which driver the author was running.
  - **PostgreSQL** says `relation "sys_metadata" does not exist` (SQLSTATE
    `42P01`) and **MySQL/MariaDB** says `Table 'app.sys_metadata' doesn't exist`
    (errno 1146). Neither matches the regex, so a perfectly healthy first boot on
    either driver printed `[Protocol] DB hydration skipped: …` — a warning about
    a working system that no operator can act on.
  - Conversely, any driver phrasing a _different_ failure as "no such table" was
    read as benign and swallowed without a line.

  The seam now asks `isMissingTableError`, so the classification follows driver
  `code` / `errno` / message / one step down the `cause` chain, and a driver quirk
  is taught to the platform once. Observable change for operators: no spurious
  first-boot warning on Postgres/MySQL, and a real failure that happens to be
  worded like a missing table is no longer silently benign. The warning line also
  reports non-`Error` rejections properly instead of printing `undefined`.

  Not changed here: a non-benign read failure is still answered with a
  `console.warn` plus `{ loaded: 0, errors: 0, invalid: 0 }`, so the return value
  still cannot distinguish "the store holds no overlay rows" from "the store could
  not be read" (ADR-0110 D3, on the boot side). That is a change to the method's
  return contract and to its consumer in `ObjectQLPlugin.restoreMetadataFromDb`,
  and is tracked separately as #5841 fact 2.

- 288e5a4: fix(metadata-protocol): the ADR-0010 lock gate refuses an uncertain write instead of allowing it (#5706)

  `getEffectiveLock` is the single source of truth for the ADR-0010 §3.3 lock
  gate, and both of its callers are write-path admission — `assertLockAllowsWrite`
  (save / publish / rollback) and `assertLockAllowsDelete`. Its overlay read was
  wrapped in a bare `catch` that fell through to `lock: 'none'`.

  `'none'` is not a neutral placeholder there. It is the verdict "the author
  declared no protection", and `evaluateLockForWrite` / `evaluateLockForDelete`
  turn it straight into "allow". So a `sys_metadata` read that **failed** became a
  write that was **performed**, on an item whose overlay row declared it
  protected. Measured before the fix, with the overlay row carrying `_lock` and
  only the gate's own read rejecting: `saveMetaItem` returned `success: true`
  after updating a `_lock: 'no-overlay'` item, and `deleteMetaItem` returned
  `success: true` after deleting a `_lock: 'no-delete'` one — while the very same
  rows, read successfully, produce `403 ITEM_LOCKED`. The audit trail did not
  record the miscarriage either: the allowed path writes its ordinary
  `outcome: 'allowed'` row, so nothing afterwards showed the write should have
  been denied.

  **Wire-visible change.** When the lock state cannot be read, `save`, `publish`,
  `rollback` and `delete` now fail with `503` / `SERVICE_UNAVAILABLE` (the driver
  error attached as `cause`) instead of proceeding as if the item were unlocked.
  Refusing one uncertain write is the intended trade against performing one that
  had to be refused. Callers that retry on 503 need no change; callers that
  treated a successful save as proof the item was unlocked never had that
  guarantee.

  The discrimination reuses `rethrowUnlessMetadataStoreUnprovisioned`, introduced
  in #5705 for this file's overlay reads, rather than inventing a second
  predicate: an unprovisioned `sys_metadata` genuinely has no overlay row, so
  `'none'` is the truth and first boot still saves normally; every other error is
  an outage.

  Unaffected, and covered by regression tests: artifact-level locks (answered from
  the in-memory registry before the overlay read is reached), a genuine miss on a
  healthy store (still allowed), and control-plane kernels (`environmentId`
  undefined), which never enter either gate.

- 1c625ca: metadata: `getDiagnosed` — a metadata read that FAILED stops arriving as "nobody declared this"

  `MetadataManager.loadDiagnosed` computes the ADR-0110 D3 verdict (a MISS and an OUTAGE
  are different facts with opposite security meanings) and `get()` discarded it two hops
  later: `load()` kept only `.data`, `get()` turned that `null` into `undefined`. Every
  consumer of `get()` therefore received one `undefined` for two opposite facts and could
  not have told them apart even if it had wanted to.

  **New read.** `MetadataManager.getDiagnosed(type, name)` returns
  `{ data, degraded, errors }` — the registry-first counterpart of `loadDiagnosed`, declared
  as an optional member of `IMetadataService`. A registry hit is never degraded (it
  consulted no loader); a clean miss is never degraded (every loader answered).

  **`get()` is unchanged — zero breaking.** Same signature, same answer, same behaviour for
  every existing caller, including the microtask-level ordering `register()`'s watchers
  depend on. Only callers that ASK for the verdict pay for it. Making `get()` throw on
  `degraded` was deliberately not done: the boot path degrades on purpose.

  **Consumers switched**, each with a disposition argued for its own context rather than one
  blanket rule:

  - `getMetaItem` / `getMetaItemCached` — a degraded MetadataService read with nothing in
    the registry now raises `503 SERVICE_UNAVAILABLE` instead of falling through to
    `404 RESOURCE_NOT_FOUND`. This is the half that made the existing `#5532` comment ("
    reaching here now means a real miss") untrue.
  - `getMetaItemLayered` — the `code` layer joins the rule its `overlay` layer already
    followed. `code: null` is a positive claim, and `lockSource = code ?? overlay ?? {}`
    derives from it, so an outage could render an item the packager locked
    (`_lock: 'full'`) as `editable: true, deletable: true`.
  - `ObjectQLPlugin`'s `object` metadata-event refresh — logs `warn` naming the consequence
    (the registry keeps the previous definition; nothing retries) and the fix, instead of
    `debug` "metadata service has no fresh body". `warn` and not `error` because the write
    already landed; only a re-read failed.

  Hosts whose `metadata` slot is a shim that predates `getDiagnosed` are read as
  "not degraded" — exactly what they could express before — so their behaviour is unchanged.

- e6db317: fix(metadata-protocol): 元数据存储读不到不再被讲成「这一项不存在」(#5532)

  `sys_metadata` 整体不可达时,`GET /api/v1/meta/object/acct` 会回一个「不存在」——
  真相是「读不到」。两个事实的处置方向完全相反(去建一个 / 去修后端),而 Studio、
  Setup 在元数据库故障期就是照前者渲染的:每一个对象都显示成「不存在」。

  根因在产出方:`getMetaItems` / `getMetaItem` 的四处 customization-overlay 读各自
  裹着一个裸 `catch {}`,注释写着 "DB not available" 然后照 miss 处理。空值一路穿过
  读链,每个消费方给它起了一个不同却同样错的名字:

  - `getMetaItemCached` → `Metadata item <type>/<name> not found`
  - `?state=draft` → `NO_DRAFT` / 404「没有待发布的草稿」(发布流程读作「没什么可发的」)
  - `getMetaItems` → `items: []`「这个环境一个都没声明」

  ADR-0110 D3 已经为这件事立过规矩:miss 与 outage 是两个不同的事实、安全含义相反。
  #5108 按这条修掉了 `DatabaseLoader` 的复数读,#5089 修掉了 `listForIndex`;本次是
  同一条规矩在协议自己的 overlay 读上,单数与复数一并覆盖。

  **改了什么**

  1. **区分按错误类型判定,不按异常猜。** 唯一良性的读失败是「`sys_metadata` 还没被
     创建」——那时确实没有 overlay 行,落回 registry 就是真相,首次启动也不该爆炸。
     判定走 `isMissingTableError`,与 `DatabaseLoader`(#5108)、本包
     `SysMetadataRepository`(#4867)同一个谓词,一个驱动怪癖只教给平台一次。其余
     一律视为故障。
  2. **故障照实上报。** 上抛 `status: 503` / `code: SERVICE_UNAVAILABLE`
     (`HttpStatusErrorCodeMap[503]`,ADR-0112 的标准目录码,不新造词汇),驱动原始
     错误挂在 `cause` 上。REST 层现有的 #5437 / #5464 消毒与日志口原样接住:客户端拿
     到 503 + code(文案按 5xx 规则 withheld),运维在日志里拿到完整的驱动报文。
  3. **终末 not found 结构化。** 真 miss 现在带 `status: 404` /
     `code: RESOURCE_NOT_FOUND`。

  **wire 可见变化**(把错误答案改成对的答案):

  | 场景             | 之前                                                            | 之后                                 |
  | ---------------- | --------------------------------------------------------------- | ------------------------------------ |
  | 元数据存储不可达 | `404`/`400`/`500` 说「不存在」「没有草稿」「什么都没声明」      | `503` + `SERVICE_UNAVAILABLE`,可重试 |
  | 真的没有这一项   | `500` + `INTERNAL_ERROR`(#5489 之前是 `400` 且内部措辞逐字上线) | `404` + `RESOURCE_NOT_FOUND`         |

  `sys_metadata` 尚未建表这一路径行为不变:仍旧落回 registry / MetadataService,
  真查不到时回结构化 404。

- da538b1: seed-loader: a pass-2 back-fill dropped for a missing source-record id is now reported, not silently discarded

  `resolveDeferredUpdates()` looked the source record's internal id up in `insertedRecords`
  and, when it was not there, ran off the end of an `if` with no `else`. Pass 2 had already
  RESOLVED the target, and the back-fill then evaporated: no write, no entry in
  `errors`/`allErrors` (so the load still reported `success: true`), no `errored`, and not
  one log line. The only trace was the `referencesDeferred` the record booked in pass 1 and
  never gave back — a dangling number with nothing in the result explaining it, while the
  declared association stayed absent forever.

  It now records the loss through `recordDeferredError` (→ `errors`/`allErrors` + `errored`,
  so the load reports `success: false`) and logs it once at `error`, per the same objective
  criterion applied in #4729/#4997 and the "Degradation log levels" rule. The two ways to
  get here are worded differently because they are different failures: an EMPTY
  `recordExternalId` — `externalIdKey` returns `''` when any component of a composite
  externalId is blank — is the pure silent loss, where the row wrote perfectly, nothing else
  in the load reports anything and the reference stays NULL forever; a real key that is
  simply absent from the map means the source row never landed, and that write failure was
  already reported at `error`, so this line points at it instead of restating it.

  A load that hits this path previously returned `success: true` with clean counters and now
  returns `success: false` with the loss counted — the seed data was always incomplete; it
  just was not saying so.

- 79822b5: fix(metadata-protocol): stop `promoteDraft`'s draft drain from swallowing every failure (#4981)

  Publishing a draft is two writes: a transactional `put` that promotes the body onto
  the active row, then a `delete` that drains the now-redundant `state='draft'` row.
  The drain was guarded by a bare `catch {}` whose comment named exactly one cause —
  "a concurrent publisher may have already drained the draft" — while its behaviour
  covered **all** of them: connection drops, statement timeouts, missing privileges,
  driver faults, `parentVersion` mismatches.

  The result was a silent, self-perpetuating inconsistency. `publishDraft` returned
  success, the active row was correct and durable, and a stale `state='draft'` row
  stayed in `sys_metadata` holding the body that had just been published. Nothing
  logged it and nothing retried it, so Studio/Setup kept reporting "unpublished
  changes" for an artifact that had none, and the next publish of that artifact
  promoted the same already-published body again — which overwrites the active row if
  anything published or reverted in between.

  **The drain now discriminates by cause.** `ConflictError` — the only error
  `delete()` raises from its own pre-driver row lookup — stays silent, because both of
  its arms are genuinely benign: `actualHead === null` is the concurrent-publisher
  race the old comment described, and a differing head means a _newer_ draft was saved
  while the publish was in flight, so the surviving row is real pending work that must
  not be dropped. Every other failure is reported at `error` level (per the
  `warn`-vs-`error` rule: the system keeps looking healthy while something it claims to
  have cleaned up is still there), naming the orphaned artifact, the consequence, and
  the remedy, with the original cause attached.

  **`promoteDraft` still returns success, deliberately.** The drain runs _after_ the
  `put` has committed, so throwing would misreport a durably successful publish as a
  failure and invite the caller to retry — and a retried publish is precisely the
  harmful path, because it re-promotes the stale draft. The failure is surfaced
  without lying about the publish instead: alongside the log, the result carries a new
  optional `draftDrainFailed` field (`{ ref, draftHash, cause }`, exported as
  `DraftDrainFailure`) so callers can react without parsing logs. It is an additive
  optional field on an existing result object — absent on every clean publish — so no
  existing caller changes.

  No protocol or spec shape changed. The drain seam is registered with
  `pnpm check:durability-log-level` (as the named callee `dropPromotedDraftRow`) so
  the catch cannot quietly go back to swallowing everything.

- 15e61fb: fix(metadata-protocol): `publishPackageDrafts` 现在对 `api` draft 跑 ADR-0121 端点发布门 (#5206 step 2)

  `protocol.publishPackageDrafts` 是 Studio「全部发布」的真实入径(ADR-0033 /
  ADR-0067 D2)。在此之前,它唯一的按类型前置检查是对象命名空间前缀
  (`validateObjectNamespacePrefix`,仅 `d.type === 'object'`),于是一条 `api`
  draft **不经任何一道门**就被提升为 `active` —— 与 #5189 在
  `MetadataManager.publishPackage` 上修掉的是同一形状、另一条路。

  安全后果早已被 PR #5203 的装载期兜底挡住:端点匹配器在建索引时用同一个
  `firstFailure` 重判每一条存量条目,没过门的被排除出索引并 `error` 点名。所以
  这次修的是**拒绝得太晚**:ADR-0121 的原文是「publish 拒绝」,作者应当在
  publish 当场拿到点名 key 的处方,而不是到装载期日志里才发现自己的端点在答
  404。

  **判据只有一份。** 本改动调用 `@objectstack/spec/api` 导出的
  `validateApiEndpointDeclarations`(#5203 公开)—— 就是 stack schema 跑的那个
  函数、`publishPackage` 跑的那个函数、装载期兜底跑的那个 `firstFailure`。拒绝
  文案直接用门函数自己的消息(已包含端点名、越界的 key 和改法),本包不复述任何
  一条「什么算可服务」的规则。

  与 `publishPackage` 不同,这条路**有身份**:包的 `manifest.namespace` 本来就
  为对象前缀规则读过了,所以这里跑的是**全量门**,命名空间门(ADR-0121 D1/D2)
  包含在内。命名空间门**不**以「包声明了 namespace」为条件 —— 门函数自己的前置
  判据(声明了 `apis:` 的 stack 必须显式声明 `manifest.namespace`)本身就是一条
  判据,对「压根没有 namespace」的包跳过它,等于给最不可能过编译期的那批包留一
  个洞。对象前缀规则对无 namespace 的包网开一面,是因为一个裸对象名只是命名气味;
  一个无命名空间的端点是一个**无主 URL**。

  **行为变化(用户可见)**:

  - 一条 `api` draft 若违反端点门(最典型:ADR-0121 D6 —— `authRequired: false`
    却没有 `rateLimit.enabled: true` 的预算),`publishPackageDrafts` 现在返回
    `success: false` / `publishedCount: 0`,该条目进入 `failed[]`,`code`
    为 `ENDPOINT_GATE`;body 连 `ApiEndpointSchema` 都不满足的,`code` 为
    `ENDPOINT_SCHEMA`(解析是判定的前置,不是第六道门 —— 判不了的形状也服务不
    了)。
  - **失败粒度沿用既有语义,未发明新的批次语义**:与命名空间前缀违规完全一致,
    这是一次**提升任何东西之前**的前置拒绝,整批不落地(`published: []`),同批
    的健康 draft 保持 draft 态。这既是 ADR-0067 D2 的「一次 commit 不能落一半」,
    也是 #5189 在另一条路上的同一姿势(`itemsPublished: 0`)。两类违规现在合并
    在**同一份报告**里返回,作者一次往返就能看全。
  - 判定范围是**本批被提升的 draft**,与紧邻它的对象前缀规则一致。与同包已
    `active` 的端点撞车不在此拦截 —— 匹配器对全库重复声明有确定性裁决并 `error`
    点名(`buildEndpointIndex`);把范围扩到整包 active 集合意味着「因为你没在发
    布的东西而拒绝这次发布」,那是另一份契约,不是一个 bug 修复。

  装载期兜底(#5203)原样保留,未移除也未削弱:publish 是**更早**的那道门,不是
  最后那道门的替代品。

  `api` 进 `DEFAULT_METADATA_TYPE_REGISTRY` / `BUILTIN_METADATA_TYPE_SCHEMAS`
  (即 Studio 直写路径的 422)是 #5206 的第 1 步,拆在子单 #5271(spec 车道);
  本改动**不依赖**它落地。

- 72bd873: fix(metadata-protocol): 保存成功的回执不再一律自称 "customization overlay"

  `saveMetaItem` 的成功 `message` 原本只有两种句式,都写死了 "customization
  overlay"。但 `DEFAULT_METADATA_TYPE_REGISTRY` 里有一批类型声明
  `supportsOverlay: false` 而按设计可以运行时写入(`object` / `field` / `hook` /
  `seed` / `mapping` / `flow` / `action`),对它们的一次全新创建并没有覆盖任何
  artifact,却也被回执成 "saved a customization overlay"。

  判据不是 `supportsOverlay`,也不是 `allowOrgOverride`(spec 的 TSDoc 把这两件事
  分得很清楚:前者是 loader 的合并能力,后者是运行时写入的许可),而是写路径**早已
  算出**的 `isArtifactBacked` —— 也就是 `intent: 'override-artifact' |
'runtime-only'` 的来源。回执现在只说这条已知事实,不新增任何读路径查询。

  |                                 | FROM                                                                       | TO                                                  |
  | :------------------------------ | :------------------------------------------------------------------------- | :-------------------------------------------------- |
  | 覆盖了 code package 的 artifact | `Saved customization overlay (org=…, state=…) — type=…, name=… [seq=N]`    | 逐字不变                                            |
  | 无 artifact 的运行时写入        | `Saved customization overlay (env-wide, state=…) — type=…, name=… [seq=N]` | `Saved <type> '<name>' (env-wide, state=…) [seq=N]` |

  org 维度照旧在括号里(`org=<id>` / `env-wide`),`state=` 与 `[seq=N]` 两个分支都
  保留,所以读取 `seq`(HMR 游标)或 `state` 的消费方不受影响;`message` 本身没有
  任何消费方解析,仅作 toast 展示。

  回执不区分「新建」与「更新既有 DB-only 行」:唯一可用的事实 `parentVersion ===
null` 的作用域是 `(state, packageId)`,一个已有 active 行的首个 draft 也会读成
  "没有父版本",据此写 `Created …` 只是把一句假话换成另一句假话。中性动词
  "Saved" 如实,且不为一句文案发明新的查询。

- dde9202: fix(metadata-protocol): 读路径 `_diagnostics` 保留 union 分支给出的真实拒绝理由 (#5598)

  `computeMetadataDiagnostics` 给 `getMetaItems()` / `getMetaItem()` 服务出去的每份
  文档挂 `_diagnostics` 信封,模块头写明它的用途是让 Studio 渲染 validity badge、
  **内联字段错误**和治理看板。但它把 zod 的 `error.issues` 直接 `.map()` 成信封条目,
  而 zod 会把一个失败 `z.union` 的**全部分支**折叠成一条顶层 issue —— `path` 是 `''`,
  message 是字面量 `"Invalid input"`。`ViewMetadataSchema` 顶层本身就是 union
  (`z.preprocess(stripViewConsoleDecorations, z.union([...]))`),所以库里**每一个**
  有缺陷的 view 文档读出来都退化成这一条没有字段名的记录,内联字段错误无处可标。

  这不只是"少了点信息",而是**同一份文档在两条路径上判决不一致**:#5364(PR #5596)
  修好写路径之后,作者**保存**一个有缺陷的 view 能看到出错的键名,**打开**同一份已存
  在库里的文档却仍然只得到一条 `Invalid input`。

  改法是复用而不是再抄一份策略:读路径改调同包 #5596 已落地的
  `zodIssuesToMetadataIssues`,分支选取口径(丢弃只报根部 KIND 不匹配的分支;报得最少
  的分支胜出;`unrecognized_keys` 破平局;并列全出且有上限;嵌套 union 按绝对路径递归)
  由该函数**单点定义**,读写两路径按构造一致。这是同一机制的第 5 个消费者
  (#4971 / #5014 / #5341 / #5364 是前四个)。

  对消费者是**纯增量**:union 自己那条记录仍然排在 `errors[0]`,只是后面跟上了解释它的
  分支条目,所以任何读 `errors[0]` 的既有代码读到的还是同一条。没走 union 的普通字段级
  拒绝(`path` / `message` / `code`)逐字节不变;spec 合法的文档仍然是 `{ valid: true }`,
  展开不会凭空造出拒绝。

- 5ab0842: refactor(metadata-protocol): 删除 `saveMetaItem` 里已不可达的 legacy raw-engine 写入分支 (#5264)

  `saveMetaItem` 过去有两条持久化路径:repository 写入路径(追加
  `sys_metadata_history`、发 watch 事件、带单调 `seq`),以及其后的 legacy
  raw-engine 分支(直接 `engine.insert` / `engine.update` 写 `sys_metadata`,
  没有 history 行、没有 watch 事件、没有 `seq`,回执形如
  `Saved customization overlay (env-wide) — type=…`)。后者的进入条件是
  `isOverlayAllowed(type) || isRuntimeCreateAllowed(type)` 为假。

  **没有行为变化 —— 这条分支在运行时已经到不了。** #5086(PR #5263)把
  code-only 类型的拒绝提到了同一方法更早的位置,并且不再以 `environmentId`
  为条件:它抛错的判据与上面那个条件恰好互为反面,读的还是同一个规范化后的
  类型键(`canonicalizeMetaRequestType` 在方法开头折叠单复数,两个标志读取器
  内部又各自折叠一次)。`OS_METADATA_WRITABLE` 也不是缺口:在那里解锁一个
  类型会让 `isOverlayAllowed` 为真,从而走回 repository 路径。因此凡是能走到
  分叉点的写入,一律走 repository 路径。

  保留 `useRepoPath` 的代价不是多几行代码,而是它是一份 grep 得到、读起来
  像活代码的样板:照它推理会得出「`sys_metadata` 存在一个不写 history 的
  合法写入口」——现在没有了。

  `deleteMetaItem` 里结构对称的那条 legacy 分支**一行未动**:它在
  control-plane kernel(`environmentId === undefined`)上删除 code-only 遗留行
  时仍然可达且必要(#5263 特意没有收紧删除侧,因为删除是修复动作),该分支上
  新增了说明它为何还活着的注释。

- d275c10: fix(metadata-protocol): 元数据保存的 422 保留 union 分支处方,Studio 重新拿得到字段名 (#5364)

  `saveMetaItem` 的 spec-conformance 检查在自己的注释里承诺 "structured Zod issues
  so the Studio form can highlight the offending field"。顶层 `z.union` 让这句承诺
  彻底落空:zod 把一个失败 union 的**所有**分支折叠成**一条**顶层 issue,`path` 是
  空串、`message` 是字面量 `"Invalid input"`,而旧代码的 `parsed.error.issues.map(…)`
  映射的正是这一条。

  代价不是"文案不够好",而是**字段定位本身消失了**。`ViewMetadataSchema` 顶层就是一个
  union(`view.zod.ts` 的 `z.preprocess(…, z.union([…]))`),所以**每一次** view 保存
  失败都退化成:

  ```json
  [{ "path": "", "message": "Invalid input", "code": "invalid_union" }]
  ```

  一个字段名都没有到达作者,Studio 表单没有任何东西可以高亮;422 的摘要行也只是
  `... failed spec validation: <root>: Invalid input`。被丢掉的分支里躺着的恰恰是
  #4001 那批策展处方(点名真实键名的 unrecognized_keys)和带绝对路径、带合法枚举的
  逐槽位判决。

  现在这些分支被展开进 `issues[]`:union 自己那条**保留不动**(展开是严格叠加的,
  今天读 `issues[0]` 的消费者不会少读到任何东西),后面跟上真正解释这次拒绝的分支,
  路径按绝对路径拼好——分支 issue 的 `path` 是**相对于 union** 的,这是 #5014 付过
  学费的坑。422 的 `message` 摘要行随之变得可读。

  分支选择策略与已落地的两处**逐条一致**:丢弃只报根部 kind 不匹配的分支;报得最少
  的分支胜出;`unrecognized_keys` 破平局;声明顺序决定其余;并列的全部输出(上限 3);
  嵌套 union 递归展开(上限 3 层)。这是同一机制的**第三份**拷贝——`packages/spec`
  的 `formatZodError`(#4971)只导出字符串渲染器,`packages/rest` 的
  `zodIssuesToFields`(#5014)产出 ADR-0114 的 `{field, code}` 目录条目,而本处的信封
  是 `{path, message, code}` 且 `code` 透传 zod 原码——形态不同,**判决必须相同**,
  否则同一个错误会因为作者是从终端发布、还是 POST 数据 API、还是在 Studio 里保存,
  拿到三套说法。

  行为边界:合法的元数据照常保存,非法的元数据照常被 422 拒绝且不落库;变的只是
  `issues[]` 从"一条无字段的 `Invalid input`"变成"那一条 + 真正解释它的分支"。

- 1d29e6d: fix(metadata-protocol): a seed failure that is COUNTED as an error now logs at `error` (#4729)

  `SeedLoaderService`'s pass-2 deferred back-fill carried a comment stating that a
  failed back-fill "must be a reported, counted error, **never** a silent warning"
  — and the line under it called `logger.warn`. The count was right (the failure
  lands in `result.errors`, flips `success: false`) but the level contradicted it,
  and that log line is the only trace a seed leaves in a host's console. `warn` is
  the level #4420 proved nobody reads.

  **What changed**

  - The failed back-fill logs at **`error`**, and the line now owes what
    AGENTS.md → "Degradation log levels" requires of one: the **consequence**
    (`<object>.<field>` stays NULL on a named record, the row itself was seeded so
    every row counter reads clean, the circular relationship is half-written) and
    the **fix** (nothing retries it — repair the write error, which is either a
    transient failure that outlasted the retry budget or a validation rule vetoing
    the update, then re-run the seed).
  - The rest of the file was audited against the same criterion — _is this failure
    counted in the load's `errors` (i.e. does it make `success: false`)?_ Five more
    sites answered yes while logging `warn`, and were raised to `error`: a failed
    batch insert row, a record dropped because its `cel` expression could not
    resolve, the two invalid-reference paths that DROP a reference field (the row
    lands without its association and the row counters stay clean — framework#3932),
    and the two write-failure catches on the sequential/update paths. The two
    dropped-reference lines also gained the consequence and fix in the message.
  - Deliberately left at `warn`, and now documented as audited: "Halting on first
    error" (a control-flow notice about failures already reported at `error`), the
    `NODE_ENV` scope warning (a functional, fail-open degradation), and the
    roll-up-summary recompute (records _were_ written; whether a stale summary
    column is the same class is #4998).
  - The seam is now pinned by CI, not only by tests: the back-fill write was
    extracted as `writeDeferredReference` and added — with `writeRecord` — to
    `DURABILITY_CRITICAL_CALLEES` in `scripts/check-durability-degradation-log-level.mjs`,
    so `pnpm check:durability-log-level` fails if either catch is ever quietened
    again.

  No API, schema or result-object change: the same errors are reported in
  `SeedLoaderResult` exactly as before. What changed is the level and the wording
  of what a seeding host sees in its log.

- c5a5996: fix(seed-loader): a roll-up summary left stale by a seed is now loud and counted

  The loader recovers a post-write roll-up summary recompute that exhausts its
  retries (`ERR_SUMMARY_RECOMPUTE`), and that recovery is correct: the rows WERE
  written, so re-writing them would duplicate them (framework#3147). What was
  wrong was the rank of the consequence. A roll-up summary is a **persisted
  derived column** on the parent record, so after this the database is internally
  inconsistent — the detail rows say one thing and the column that summarizes them
  says another — and nothing recomputes it until some later write happens to touch
  the same parent, which after a seed may never happen.

  The entire event used to be one `warn` line reading _"records were written
  (summary values may be stale)"_. It named no object, counted nothing, and left
  `success: true` with every row counter clean, so no operator could see which
  aggregate was wrong and no caller could detect it at all
  ([#4998](https://github.com/objectstack-ai/objectstack/issues/4998)).

  **It now logs at `error`**, naming the seeded object and the exact stale column
  (`account.total_billed`), stating the consequence (the summary and its detail
  rows disagree, nothing self-heals, and the seed still reports success) and the
  remedy (fix the recompute error and re-run the seed, or trigger any write on the
  affected parent to force a recompute), with the original cause attached. This is
  the AGENTS.md "Degradation log levels" rule (#4632): persisted state and runtime
  state disagreeing while everything looks normal is `error`, not `warn`.

  **And it is counted** — `SeedLoadResult.summariesStale` and
  `SeedLoaderResult.summary.totalSummariesStale`, mirroring `referencesDropped` /
  `totalReferencesDropped`, which exists for the same shape one layer down ("the
  row was written, something derived from it was lost"). A log line is not
  something a caller can branch on; these counters are.

  `success` deliberately stays `true`. It answers _"did the rows land"_, and they
  did — every consumer treats `success: false` as "the write failed", so flipping
  it would hand the protocol seed-apply surface a `false` with an **empty** errors
  array and fail package/marketplace installs that in fact wrote every row. The
  counter carries the signal instead; a caller that wants to treat a stale
  aggregate as fatal reads `summary.totalSummariesStale > 0`.

  Both counters are additive with a `0` default, so an existing producer or
  consumer of `SeedLoaderResult` is unaffected — a payload written before this
  release still parses, with `0`.

- 5ea8e1e: fix(metadata-protocol): a seed record dropped for an unresolvable reference now says so at `error` (#4997)

  When a seed's `lookup` / `master_detail` / `user` reference could not be
  resolved and no pass 2 would run (`multiPass: false`), the loader dropped the
  **whole record** — the right call, since writing it would put the raw
  natural-key string into the FK column or, on an upsert UPDATE, corrupt the row
  already there. The drop was counted (`errored`) and reported
  (`result.errors` → `success: false`), and the code comment above it claimed
  "LOUD", but the branch made **no logger call at all**. On the console a seed
  that silently dropped N records was indistinguishable from a clean one, and the
  `packages/runtime` seed call sites that only `await` the load never look at
  `result.success` — so the loss surfaced later as "the app installed but the data
  isn't there".

  That branch now logs at `error`, per AGENTS.md → "Degradation log levels"
  (#4632): the line names the record (`<object>` record #i), the field, the target
  `<object>.<field>` it could not find, and the **consequence** (the whole record
  was not seeded — not merely the association), followed by all three **remedies**
  — seed the target object first, enable `multiPass` so pass 2 back-fills the
  reference, or fix the natural key in the seed data.

  The same objective criterion (does the outcome enter `errors`/`allErrors`?)
  found one more never-logged branch in the same file and aligned it: a **deferred
  reference still unresolved after pass 2** was counted exactly like its sibling
  whose back-fill _write_ fails — which has logged at `error` since #4729 — and
  logged nowhere. It now reports that the row was seeded while the relationship is
  permanently missing, and how to complete it.

  The **dry-run** branch stays deliberately quiet and is pinned that way by test:
  a dry run writes nothing, its caller is by definition reading the result object,
  and an `error` line about a simulated outcome only trains readers to skim
  `error`. No counters, result shapes or messages in `result.errors` changed —
  this is console output that was missing, not a contract change.

- dca25e1: fix(metadata-protocol): `SysMetadataRepository` 的 `event_seq` / `version` 不再从一次失败的读里凭空发号 —— 只有「表还没建」可以从 1 开始 (#4867)

  `SysMetadataRepository.nextEventSeq()` 与 `nextItemVersion()` 各有一个同形的 `catch`,把读
  `sys_metadata_history` 的**全部**失败折成同一个答案:

  ```ts
  } catch {
    // Table not provisioned yet (fresh DB) — start at 1.
    return 1;
  }
  ```

  这是 #4825 刚在 `DatabaseLoader`(TSDoc 自称 legacy、非事务的那条路径)上修掉的形状,原样长在
  **canonical 路径**上 —— #4825 正文把 `SysMetadataRepository` 称作「历史写入应当收敛过去的地方」。
  而且这里有两个数字:

  - **`event_seq`** —— 历史排序与 rollback 定位的依据。表里已有 N 行时,一次瞬时读失败(连接抖动、
    超时、权限)让下一条拿到 `1`,与既有行撞号;
  - **`version`** —— `nextItemVersion()` 的 TSDoc 明说它刻意从 history 取 MAX「so delete + recreate
    continues incrementing instead of restarting at 1」。一次读失败正好把它**恢复成它明确要避免的那个
    行为**:lineage 从 1 重启并与既有 lineage 撞号,而 `MetadataManager.rollback(type, name, version)`
    与 `POST /api/v1/meta/:type/:name/rollback` 正是按这个数字定位快照 —— 撞号之后回滚可能落到另一条
    记录的同号版本上。

  关键危害与 #4825 相同,是「**落盘的字节是错的**」而不是「字节没落盘」:insert 成功、日志一行没有、
  系统对外完全正常,重试不修、重启也不修。

  **「在事务里」并不能挡住它。** 事务解决的是*并发*撞号;它对「从一次失败的读推导出来的数字」没有任何
  意见,一个成功提交的事务照样把错号提交得同样持久。事务真正给出的是干净的补救:抛出去,整笔写入回滚,
  而不是提交一个编造的号。

  现在按**错误类型**判别,复用 #4825 落地的那套判别器(不另起一套):

  - **良性的「表还没建」** —— 没有行,就没有可撞的号,`1` 确实是下一个号,静默返回,fresh DB 照常启动;
  - **其余一切读失败** —— 按 AGENTS.md「Degradation log levels」以 `error` 上报**后果**(写入已被中止、
    事务回滚、什么都没提交;若按旧行为发 `1` 会与既有行撞号,使版本顺序不可信、回滚目标可能指向另一条
    记录的同号版本,且无人能发现、重启也修不回来)与**修复动作**(修数据源/驱动错误后重试写入),然后
    **原样抛出**,让事务回滚。一次故障只说一次,恢复时补一条 `info`。

  ### `@objectstack/metadata` 新增子路径导出 `@objectstack/metadata/errors`

  判别器 `isMissingTableError()`(#4728/#4825 家族)此前是 `@objectstack/metadata` 的内部工具,而本次
  消费者在另一个包。三个选项中选了「从现有归属地**显式导出**」:在 `metadata-protocol` 里复制一份会重建
  #4825 刚消灭的双源问题(同一个问题两套「哪些驱动错误算良性」的词汇表,谁先学会一个驱动怪癖谁就先漂移);
  下沉到公共依赖本轮不可行(`packages/spec` 冻结、`packages/types` 有并行改动),且本次导出并不妨碍维护者
  之后再下沉。

  新增的是一个**叶子子路径**而不是包入口导出:`@objectstack/metadata` 的根入口会拖进 manager、全部
  loader 与其 YAML/文件系统依赖,只为一个 40 行谓词付这个重量,正是把下一个作者推回「复制一份」的原因。
  `@objectstack/metadata/errors` 只 re-export 一个叶子模块,跨包依赖边因此仍是叶子边,也是将来下沉时
  一个可 grep、可删除的单点。仅导出 `isMissingTableError`;同族的 `isSchemaAlreadyExistsError` 在包外
  没有消费者,保持内部(导出一个无人 import 的符号是白许的承诺)。

  无 API 破坏、无 schema 变更、无 `packages/spec` 改动。

- 38f53a0: fix(metadata-protocol): `updateMany` classifies an id-less row as a caller error, matching `batchData`'s update branch (#5100)

  `runUpdateManyLoop` lacked the `!record.id` guard #4793 gave `runBatchDataLoop`'s
  update branch, so the two by-id update faces classified the same malformed row
  differently: `VALIDATION_FAILED`/400 on batch, but on `updateMany` the row fell
  through to the #5088 existence probe as `{ id: undefined }` and came back
  `RECORD_NOT_FOUND`/404 with `undefined` interpolated into the message — a
  request-shape error reported as a data-state one, with the row's fate left to
  each driver's undefined-where-key handling.

  Not reachable over REST (`UpdateManyRecordSchema` requires `id`, #3939) — the
  change is observable only to in-process callers of the protocol method, whose
  id-less rows now answer `VALIDATION_FAILED`/400 (`Record id is required for
update`) before any engine round-trip, identically on both faces (#4620: one
  classification per file, enforced by a cross-face parity test). `record.data`
  handling is aligned to the batch branch's `record.data || {}` in the same
  change.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [c1e67e0]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
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
- Updated dependencies [533a0a4]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [3133cda]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c794f78]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [641363a]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [0f17114]
- Updated dependencies [ecc61ab]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [db0d53c]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [06ffad3]
- Updated dependencies [811c30c]
- Updated dependencies [2b2175b]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [d4edb5d]
- Updated dependencies [eb26126]
- Updated dependencies [be59695]
- Updated dependencies [b2e1057]
- Updated dependencies [ec6fad8]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [729a43a]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [123067c]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [5d3ced9]
- Updated dependencies [4b50be4]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [461ccda]
- Updated dependencies [5582e18]
- Updated dependencies [58f3220]
- Updated dependencies [f238970]
- Updated dependencies [06fc07a]
- Updated dependencies [61fde5e]
- Updated dependencies [95b4f0d]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [b5459bc]
- Updated dependencies [1624f4a]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [2f1e2a5]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [b821b29]
- Updated dependencies [af96af6]
- Updated dependencies [089767f]
- Updated dependencies [5b8f95b]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [73580e7]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [bf1edef]
- Updated dependencies [7b005b4]
- Updated dependencies [da1a64c]
- Updated dependencies [5e3c83b]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ddd6650]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [dca25e1]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [20963e7]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [e92e2c3]
- Updated dependencies [946a131]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/lint@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/metadata@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4
  - @objectstack/metadata-core@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- ac37fc6: fix(metadata-protocol)!: batch per-row results now deliver the declared `BatchOperationResultSchema` shape (#4793)

  **Breaking wire change** on the per-row `results` entries of the three
  bulk-write endpoints — `POST /data/:object/batch`, `/updateMany`,
  `/deleteMany`. The rows had drifted from the schema that declares them:
  `BatchOperationResultSchema`, the client SDK's exported `BatchOperationResult`
  type and the reference docs all said `errors: ApiError[]` / `data` / `index`,
  while the wire carried `error: string` / `record` and never sent `index`. A
  TypeScript consumer written against the published type compiled, validated,
  and read `undefined` at runtime. The wire now delivers exactly what is
  declared (a conformance pin parses every emitted row against the schema, so
  the two cannot silently fork again).

  **FROM → TO, per row:**

  | Before (legacy wire) | After (declared schema)     | Your fix                                                                                           |
  | -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
  | `row.error` (string) | `row.errors` (`ApiError[]`) | read `row.errors?.[0]?.message`; branch on `row.errors?.[0]?.code`                                 |
  | `row.record`         | `row.data`                  | rename the read                                                                                    |
  | — (never sent)       | `row.index` (number)        | new — the row's position in the request array; use it to correlate failure rows that carry no `id` |
  | `row.droppedFields`  | `row.droppedFields`         | unchanged                                                                                          |

  **Rollback marking is structured now.** The `ROLLED_BACK:` /
  `NOT_ATTEMPTED:` message-string prefixes that #4620 introduced (see the
  `many-data-atomic-real-or-refused` changeset — its description of those
  markers is superseded by this entry) are promoted to first-class
  `ApiError.code` values, registered in the spec's ERROR_CODE_LEDGER:

  - `errors[0].code === 'ROLLED_BACK'` — the row was written, then undone by the
    atomic batch rollback; `message` carries the causal row's index and error.
  - `errors[0].code === 'NOT_ATTEMPTED'` — the row never ran; an earlier row's
    failure aborted the batch.
  - the causal row keeps its own error code (e.g. `RECORD_NOT_FOUND`,
    `VALIDATION_FAILED`; an unclassified engine throw maps to `INTERNAL_ERROR`,
    with `httpStatus` mirrored when the error carried one).

  Branch on the code — do **not** regex message prefixes; the prefixes are gone.

  **Who is affected:** only readers of the _legacy_ keys — which were never in
  the schema or the SDK types, so they were reachable only via `as any` or bare
  JS. Code written against `BatchOperationResult` (the published contract) needed
  this change to start working and needs no migration. There is no
  dual-emission or compatibility fallback: this is a hard cut inside the v17
  major window, and the old keys simply no longer exist on the wire.

- 65f184b: fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

  `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
  foreign key. The write path filled it with `actor ?? 'system'`, so every
  metadata write without a caller actor (boot sync, migration, an internal call)
  stored the **string** `'system'` in a column whose declared type says "the id
  of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
  (`'usr_system'`) is not auto-provisioned on the current runtime either, so the
  value resolved to nothing under any reading. Any consumer that read the field
  by its declaration — `expand`, an owner column in a report, an audit timeline
  showing "who changed this" — got an id that could not be dereferenced.

  It had already cost twice. #4441 had to exempt every `readonly` field from the
  write-path referential-integrity check, because otherwise ordinary metadata
  authoring (package create / publish / clone) was rejected. #4551's
  dangling-reference audit had to skip the same set for the same reason. The
  field ended up the platform's only reference column that is neither enforced
  nor audited.

  **The fix is on the write path, not the declaration.** `recorded_by` stays a
  `lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
  "system-initiated (boot sync, migration, scheduled job)" — the standard
  expression of "no link", and already what this column's `set_null` delete
  behaviour means. No magic system-user account (a row that can never sign in yet
  holds an identity is a new security surface), and no `actor_kind` companion
  column.

  **Breaking — the repository contract is now explicitly nullable.**

  | Surface                                   | Before   | After                                 |
  | :---------------------------------------- | :------- | :------------------------------------ |
  | `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
  | `MetadataEvent.actor`                     | `string` | `string \| null`                      |
  | `MetadataItem.authoredBy`                 | `string` | `string \| null`                      |

  `actor` stays required rather than becoming optional on purpose: every call
  site must state which of the two it is, so a forgotten actor cannot silently
  become a fake foreign key. Migrating a caller:

  - **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
    or a label to satisfy the type: pass `null` instead.
  - **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
    the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
    that the _stored_ value no longer lies, not that no label may ever be shown).

  Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
  and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
  indistinguishable from a real user id to anything that resolves the field. They
  now surface `null`.

  **Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
  rewritten to `NULL` by a new command, which runs the conversion through the
  ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
  It is a dry run by default and safe to re-run — it selects only rows still
  holding the sentinel, so a second `--apply` converts nothing.

  The rewrite is **semantically equivalent, not a reinterpretation**: this column
  has only ever held that one sentinel, written by exactly one expression
  (`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
  expressible in the declared type.

  Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
  declaration already says "user id, system id, or `'system'`", so its `'system'`
  default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
  skip also stay — see the PR for why they are still correct.

### Minor Changes

- 0800433: Lint an action nobody placed (ADR-0078 Phase 3, Tier-A `action-locations`).

  New advisory rule `action-no-placement`: an action that declares no
  `locations` and that no list view places by name renders on **no** surface —
  it parses, publishes, and appears in Setup, while no user can ever click it.
  ADR-0078 names this shape in its opening paragraph and Phase 3 asks for
  exactly this rule; the shared completeness predicate it envisioned was never
  built, so this lands standalone, one verified shape at a time.

  What made it verifiable now: objectui#3142 collapsed four disagreeing
  renderers onto one placement predicate. Before that, `action:bar` and the
  record header rendered an _undeclared_ action anyway, so the shape only looked
  inert on paper. As of objectui 17.1 it is measurably inert.

  Two things are deliberately **not** flagged:

  - **`locations: []`** — the documented headless action (callable over REST /
    MCP / AI, no UI surface). ADR-0110 D3 refuses an undeclared handler, so a
    headless declaration is the only legal way to expose one. The rule therefore
    distinguishes "nowhere, deliberately" (`[]`) from an unstated placement (key
    absent) and only reports the latter.
  - **Actions a view places by name** — `bulkActions`, `bulkActionDefs`
    (including `execution: 'aggregate'` defs, whose whole point is an action with
    no single-record home) and `rowActions`, across all three list-view tiers:
    `views[i].list`, `views[i].listViews.<key>` and the object-embedded
    `objects[i].listViews.<key>`.

  Advisory, never fatal — a view in another installed package may be the one
  placing the action, the same reason `validateSemanticRoles` and
  `lintLivenessProperties` warn rather than gate.

  Also: the action form schema in `@objectstack/metadata-protocol` no longer
  declares `shortcut` / `bulkEnabled`. Both were retired as `retiredKey()`
  tombstones in spec 17, and this schema is what the Studio designer renders its
  fallback form from — so advertising them handed authors two inputs that could
  only ever produce an unsaveable draft (objectui#3145 removed the matching
  dedicated controls). And `content/docs/ui/actions.mdx` now says which surface
  is the exception to location filtering, instead of a blanket claim its own
  showcase contradicted.

- 98877c9: feat(spec,metadata-protocol): `IObjectQLEngine.transaction` joins the slot contract, and `batchData`'s `atomic` flag becomes real — rollback or refusal, never silent best-effort (ADR-0119 D1/D4, #4612)

  **D1 — the contract fix.** `ObjectQL.transaction()` — ADR-0034's ambient
  transaction, shipped since v8.0.0 — was reachable from plugin space only
  through `as unknown as` casts: the metadata protocol's atomic publish and its
  `transactionalBatch` discovery probe, and the sys-metadata repository's
  `withTxn`, each declared a private structural slice of an engine none of them
  import. It is now declared on `IObjectQLEngine`, required per that contract's
  own rule, with its caveats written into the TSDoc as part of the declared
  meaning rather than left to be discovered: it covers the **default driver
  only**, and when that driver has no `beginTransaction` the callback runs with
  no transaction and no rollback. `MetadataHostEngine` and the sys-metadata
  repository's engine surface now type their optional member as
  `IObjectQLEngine['transaction']`, so a narrow host surface can no longer drift
  from the real signature. Runtime `typeof === 'function'` probes stay — that is
  test-double defence the type system does not replace.

  **D4 — the honesty fix.** `batchData`'s `options.atomic` promised "rollback
  entire batch on any failure (transaction mode)" and delivered a `break`
  statement. Every write before the failure stayed committed, and — the part that
  did the real damage — the response reported those rows `success: true` under
  the one flag whose job is to guarantee they were undone.

  Now an explicitly atomic batch runs inside ONE `engine.transaction()`: the
  first failure rolls back every prior write, and the response says so
  (`succeeded: 0`, with rows marked `ROLLED_BACK:` / the causal error /
  `NOT_ATTEMPTED:`, and no row reporting success). On a runtime that cannot roll
  back — no `transaction()`, or a default driver without `beginTransaction` — an
  atomic request is **refused** with `501 NOT_IMPLEMENTED` rather than silently
  degrading, matching the cross-object `/batch` route. `atomic` takes precedence
  over `continueOnError`, whose own description already scoped it to
  `atomic=false`. In atomic mode the upsert path no longer falls back to an
  insert when its update throws: inside an aborted transaction that fallback can
  only fail with a secondary error that buries the real cause.

  **Aligned declaration.** `BatchOptionsSchema.atomic` declared `.default(true)`
  while no enforcement site delivered atomicity — and the REST route forwards the
  original request body rather than the parsed output, so the declared default
  never reached the loop at all. The default is now `false`: the declaration is
  aligned down to what every site already does, rather than up to what none of
  them did. Honouring the old `true` would have silently flipped the failure
  semantics of every existing batch caller and hard-failed ordinary batches on
  any driver that cannot transact. Callers who were explicitly sending
  `atomic: true` now get what they always asked for; callers sending nothing keep
  today's behaviour exactly.

  If you were passing `atomic: true` and relying on partial results surviving a
  failure, that was the bug — switch to `atomic: false` (or omit it) for
  best-effort semantics.

  ADR-0119 also rules on two items landing separately: D2 specifies a
  framework-owned migration-journal runner for multi-step migrations too large
  for one transaction, and D3 retires the declared-but-unimplemented
  `IDataEngine.batch?`.

- 4c80fd6: fix(metadata-protocol): `deleteMany` / `updateMany` honour `atomic` for real, or refuse it (#4620)

  ADR-0119 D4 made `batchData`'s `atomic` flag a real guarantee. Its two siblings
  in the same file were out of that PR's confirmed scope and kept the defect:

  - **`deleteManyData` was fake-atomic.** `atomic: true` opened no transaction; it
    only `break`-ed the loop, so every row deleted before the failure stayed
    **deleted** while the response called itself atomic and reported those rows
    `success: true`. Worse than the `batchData` case it was copied from, because a
    partial delete has no natural undo — a client cannot reconstruct the rows from
    its own request.
  - **`updateManyData` ignored `atomic` entirely.** The option was accepted,
    declared in `BatchOptionsSchema` with an all-or-nothing contract, and never
    read: a caller asking for atomicity silently got best-effort, with no signal.

  Both now run the **same** atomic arm as `batchData`, extracted into one shared
  runner so a fourth copy of transaction handling cannot drift into a fourth lie:

  - `atomic: true` runs the whole batch inside ONE `engine.transaction()`; the
    first failure rolls back every prior write.
  - A rolled-back batch reports **zero successes**. Rows that had succeeded are
    marked `ROLLED_BACK: record <i> failed — <cause>`, rows never reached are
    `NOT_ATTEMPTED: atomic batch aborted by record <i>`, and the causal row keeps
    its own error — so a client can tell "attempted, undone" from "never ran".
  - `atomic` outranks `continueOnError`, whose contract text already scoped it to
    `atomic=false`.

  **Behaviour change to be aware of:** a runtime that cannot roll back (no
  `engine.transaction()`, or a default driver without `beginTransaction`) now
  **refuses** an `atomic: true` `deleteMany` / `updateMany` with `501
NOT_IMPLEMENTED` instead of silently running best-effort — the same fail-closed
  gate `batchData` uses. That silent downgrade is the defect class this fixes; if
  you want best-effort, ask for it (`atomic: false`, or omit the option), or probe
  the runtime's transaction support before sending. Non-atomic behaviour of both
  endpoints — including the `continueOnError` interaction and their response
  shapes — is unchanged.

- 83cf2d3: feat(migrate,metadata-protocol): `os migrate meta --stored` rewrites sys_metadata rows so the read-path chain has a finish line (#4327)

  #4317 closed the correctness gap from the read side: every stored-row
  rehydration seam replays the full ADR-0087 conversion chain, retired entries
  included, so a row written under any past protocol is _served_ canonical
  forever. What it deliberately did not do is make the rows themselves canonical.
  A pre-17 row keeps its legacy bytes, the chain re-lowers it on every load, and
  each affected row logs one conversion notice per process — deduped, but back
  every boot. Until now the only things that ever rewrote such a row were a Studio
  re-save and `duplicatePackage`.

  **`os migrate meta --stored`** is the pass that ends it for a deployment that
  runs it. It walks `sys_metadata` — `active` and `draft`, every organization —
  replays the same `applyConversionsToStoredItem` chain, and re-saves each changed
  body through the normal write path, so a rewritten row gets a
  `sys_metadata_history` entry, a fresh checksum and the mutation projectors,
  exactly like an author's save. The history row's `source` is `migrate-stored`,
  so a later diff distinguishes an upgrade from somebody's edit.

  ```bash
  os migrate meta --stored                    # preview: per-row report, writes nothing
  os migrate meta --stored --apply            # rewrite the rows (prompts)
  os migrate meta --stored --apply --yes --json   # CI / scripts
  os migrate meta --stored --type view        # restrict to a type (repeatable)
  ```

  **Preview is the default and `--apply` is the only writing mode** — the house
  rule its siblings already keep (#3617's "a dry run changes nothing"), and it
  applies with more force here because what moves is metadata: every affected
  row's checksum and a history entry per row. An apply run also refuses to start
  while another process holds the SQLite database, for the same reason
  `os migrate files-to-references --apply` does.

  **Nothing gates on this having run.** #3855's conclusion stands — an
  operator-run migration cannot be relied upon, so the read path remains the
  guarantee for every deployment, and no `sys_migration` flag is recorded (a flag
  would advertise enforcement that does not exist). What a run buys is hygiene —
  rows stop carrying pre-protocol dialects, so diffs, exports and history are
  clean going forward, and the recurring notices go quiet — plus one thing that
  was previously unobtainable: **an operator can assert it.** A run with nothing
  left to do exits `0`, a deployment with rows still on an old dialect exits `1`,
  so "my metadata is on protocol N" becomes a CI check rather than a belief.

  Three things the pass declines, and reports rather than counting as done:
  `flow` rows (their seam is `AutomationEngine.registerFlow`, which holds the
  executor registry the node-type conflict guard needs), types with no repository
  write path (`agent` — rewriting there would record no history and force a draft
  live), and rows that still fail the current schema after conversion (a genuine
  contract violation the write path is right to refuse; it keeps reading through
  the chain and stays fixable in Studio).

  Also new, and usable without the CLI: `protocol.migrateStoredMetadata()` returns
  the same structured report an admin route would render, and `saveMetaItem`
  accepts an optional `source` for the history/audit rows. `source` is not
  request-derived — the REST layer builds its save request field by field and
  never forwards a client-supplied value, so provenance stays something the server
  states rather than something a caller claims.

- 4b945fc: Author-time rules now gate the RUNTIME metadata write path, not just the CLI (#4463)

  The 26 author-time rules `os validate` / `os build` / `os lint` share (#4409) ran on
  those three commands and nowhere else. Every runtime metadata write — Studio's
  designer, REST `/meta` item CRUD, an MCP/AI agent authoring a flow — reaches
  `saveMetaItem`, which did a per-type Zod `safeParse` and stopped. For a tenant that
  was not the weakest of four doors, it was the **only** door: a `sys_metadata`
  overlay row is not in the CLI's config file, so there was no command they could run
  instead. An approval flow whose `expression` approver is broken CEL
  (`record.owner ==`) is Zod-valid, so it saved, registered, and failed at the node's
  entry the first time it fired — the exact body `os lint` had rejected since #4409.

  **One shared core, one runtime gate.**

  - The rule registry moved from `packages/cli` into `@objectstack/lint`
    (`AUTHORING_RULES`), and the CLI now calls it there. Five rule modules moved with
    it (`lintFlowPatterns`, `lintLivenessProperties`, `lintAutonumberFormats`,
    `lintViewRefs`, `data-model-rules`), unchanged. There is one table; a second one
    cannot be introduced without failing `authoring-rule-wiring.test.ts`.
  - New kernel-safe subpath export **`@objectstack/lint/runtime`** — the entry the
    metadata write path imports. Running the gate loads neither `typescript` nor
    `sucrase`, pinned by a new `runtime-lazy-deps.test.ts` alongside the existing
    `lazy-deps.test.ts`, which is unchanged.
  - Each registry entry now declares `surfaces` (`cli` / `runtime-publish`) plus
    either the metadata `runtimeTypes` it judges or a written `surfaceReason`. The
    ratchet fails an entry that answers neither.

  **Behaviour**

  - A `state: 'active'` `saveMetaItem` — and the draft→active promotion in
    `publishMetaItem` — of a **flow** runs the flow / approval / expression /
    reference rule families. A gating finding is refused with **422
    `INVALID_METADATA`**, in the same structured envelope the Zod failure already
    used, with `rule` / `path` / `where` / `message` / `hint` per issue.
  - **Draft saves are never gated** — a draft is allowed to be half-finished and
    cannot execute.
  - Only the write is judged: the rules run twice (context with and without the
    submitted item) and only findings the item _added_ can refuse it, so a
    pre-existing violation in a stored row never blocks an unrelated save. Stored
    rows keep being read.
  - Escape hatch **`OS_ALLOW_UNLINTED_METADATA_WRITES=1`** turns the refusal into a
    loud log for a migration window. Unset it once the metadata is fixed — the
    runtime executes what it published.

  Only `flow` writes are gated in this pass; every other metadata type carries a
  recorded reason in the registry.

- 304423e: feat(automation,migrate): `os migrate meta --stored` now covers flow rows too (#4454)

  #4327 gave the stored-metadata conversion chain a finish line for every
  metadata type except `flow` — the one type where the most stored dialect
  actually lives, since the graduated conversions `flow-node-crud-filter-alias`,
  `flow-node-crud-object-alias`, `flow-node-notify-config-aliases` and
  `flow-node-script-config-aliases` are all flow-node entries. Flow-node
  conversions carry ADR-0078's open-namespace conflict guard, which has to consult
  the _live_ executor registry to tell a rename from a clobber, and the metadata
  layer has no way to obtain one. Flows were reported `skipped` with that reason.
  They are now converted.

  **One canonicalization policy, two shapes.**
  `AutomationEngine.canonicalizeStoredFlow` is the single implementation and
  `registerFlow` calls it, so the load seam and the migration can never disagree
  about what "canonical" means. It returns `parsed` (for execution — the
  `FlowSchema.parse` + #4347 region output, schema defaults materialized) and
  `storable` (for persistence).

  **`storable` excludes schema defaults, and that is the load-bearing decision.**
  Measured rather than assumed: driving a pre-17 flow through all three steps
  _removes_ nothing — `FlowSchema` is strict since #4001, so an unrecognized key
  throws instead of being silently dropped, which means the
  `graftNormalizedOperators` precedent (it exists because the _view_ parse strips
  Studio-only auxiliary keys) does not transfer — and _adds_ only defaults:
  `version`, `runAs`, per-edge `type` / `isDefault`. Persisting a default the
  author never wrote would pin every migrated row to today's value while untouched
  rows follow tomorrow's: two populations with different behaviour, which is
  exactly the drift this pass exists to remove. So the write-back is the
  conversion result plus the `{dialect, source}` envelopes the schema derives for
  edge conditions, and nothing else.

  One subtlety worth knowing if you extend this: that envelope is a schema
  transform, not a conversion, so it emits **no** notice while still changing the
  body. Reading notices alone — correct for every other metadata type — would call
  such a row canonical and leave it re-deriving on every boot. Both passes are
  copy-on-write, so identity is the exact test for flows.

  **New: `AutomationServicePluginOptions.armRuntime`** (default `true`, so every
  server, dev stack and test host is unaffected). Set `false` and the plugin
  brings up the engine and the complete node registry — built-ins plus whatever
  `automation:ready` contributes, because a _partial_ registry would make the
  conflict guard read a live custom node type as unowned and rewrite over it — and
  then stops before anything is armed:

  | Skipped when `armRuntime: false`                         | Why it must be                                                                                |
  | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
  | flow pull + `kernel:ready` / `metadata:reloaded` re-sync | `registerFlow` calls `activateFlowTrigger` — record triggers and scheduled jobs would go live |
  | declarative connector materialization                    | opens real connections; an MCP provider spawns a child process                                |
  | suspended-run wait-timer re-arm                          | would resume someone's paused approval mid-migration                                          |

  `os migrate meta --stored` boots the plugin in that mode. A migration process
  must not become a second server.

  A refused rename — the guard firing because the old node-type token is a live
  name something else owns in this environment — fails that row loudly, naming the
  token and its owner. Never a silent skip, never a clobber. A flow that cannot
  canonicalize at all (a strict-schema violation, a malformed control-flow region)
  is reported as failed with the parse message rather than persisted as a guess;
  such a row cannot register today either, so the report is telling you about a
  flow that is already broken at runtime.

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

- ce92674: feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

  A validation rule authored as its own artifact bound to nothing and gated no
  write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
  no `objectName` — and all six variants are `strictObject`, so an author could
  not supply one either. No merge step existed. The only code that expected such a
  key was a reference-tracker row scanning a field the schema would have stripped.
  Meanwhile the engine evaluates exactly one shape: the object's own
  `validations[]` array, on insert and on every matched update row.

  So a rule created through the standalone door — a `*.validation.ts` file, or
  Studio's Validations list — parsed, saved, reported success, and intercepted
  nothing. Including a `state_machine` rule, which ADR-0020 routes through this
  same vocabulary: an author could believe they had locked down record state
  transitions and have changed nothing at all.

  Under ADR-0088 the kind fails the admission test on its first clause: a rule has
  no independent lifecycle, because it only means something against an object. And
  unlike the sibling disconnects closed in this batch, it could not be bridged into
  one — the shape has nowhere to name its object.

  **The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
  variants are unchanged and fully live; the engine's evaluation path is not
  modified by this change. It is the _kind_ that was inert, not the schema. The
  liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
  override (alongside `webhook` and `query`), because an ungoverned live schema is
  exactly how the next drift would hide.

  **Migration.** Move the rule into the owning object's `validations:` array — the
  rule body is identical, same schema, same six variants:

  ```ts
  // before — a standalone *.validation.ts, which never ran
  export default defineValidation({ name: 'amount_positive', type: 'script', … })

  // after — on the object, where rules are evaluated
  ObjectSchema.create({
    name: 'invoice',
    validations: [{ name: 'amount_positive', type: 'script', … }],
  })
  ```

  Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
  patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
  member, the schema-map entry, the create seed, Studio's Validations nav item and
  its hand-crafted form, and the dangling reference-tracker row. Standalone rows
  already in `sys_metadata` are left alone — they were never evaluated, so nothing
  changes behaviorally.

- dadb43f: refactor(spec,client,metadata-protocol,runtime)!: retire the workflow service slot — declared end to end, implemented nowhere (#4451)

  The `workflow` slot was ADR-0078's silently-inert declaration at every layer at
  once: a `CoreServiceName` nothing ever registered or resolved (ADR-0115
  Evidence 5 — "no code in this repository resolves either slot", verified across
  both repositories), an `IWorkflowService` contract with zero implementations, a
  `WorkflowProtocol` whose three methods no code ever provided, a discovery
  `routes.workflow` field no builder could truthfully populate, and a
  `/api/v1/workflow` advertisement for a path no host ever mounted (the
  pre-#3586 `DEFAULT_DISPATCHER_ROUTES` already listed it among routes that
  never existed). The capability it promised is live elsewhere and has been for
  majors: record state machines are enforced by the `state_machine` validation
  rule, approvals are first-class flow nodes on the approvals runtime
  (ADR-0019), and record-triggered automation is lifecycle hooks +
  `record_change` flows (`service-automation`).

  FROM → TO:

  - `CoreServiceName 'workflow'` / `ServiceRequirementDef.workflow` /
    `CORE_SERVICE_PROVIDER['workflow']` → removed; there is no slot to fill.
  - `IWorkflowService` (`@objectstack/spec/contracts`) → removed; no
    implementation ever existed. Register nothing — use the mechanisms above.
  - `WorkflowProtocol` + `GetWorkflowConfigRequest/Response`,
    `WorkflowState`, `GetWorkflowStateRequest/Response`,
    `WorkflowTransitionRequest/Response` (`@objectstack/spec/api`) → removed,
    along with the seven published JSON schemas. Delete the import; nothing
    ever answered these shapes.
  - Discovery `routes.workflow` / `services.workflow` / `features.workflow`
    (metadata-protocol + runtime builders) → absent. A reader keying on them
    only ever saw `unavailable` / `false`; delete the read.
  - `RouterConfig.mounts.workflow` → removed; there was never a surface to
    mount at it.
  - `RestApiRouteCategory 'workflow'` → removed; categorize automation-adjacent
    routes as `'automation'`.
  - `@objectstack/client` re-exports of the four workflow types → removed with
    their source. (The `client.workflow.*` methods were already removed earlier
    in the v17 cycle — this retires the types they returned.)
  - Also removed: the stray `graphql` entry in `CORE_SERVICE_PROVIDER` and the
    `graphql: { route: '/graphql' }` discovery entry — `graphql` was never a
    `CoreServiceName`, and the dispatcher had already dropped `/graphql` as out
    of the product plan (#2462 follow-on).

  The retirement kit: the `workflow-service-slot-retired` semantic migration
  (major 17) carries this prescription into `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool. These are TS/API surfaces and a
  discovery response field — never stored in stack metadata — so there is no
  load-path conversion and nothing for `os migrate meta` to rewrite; the
  21 `authorable-surface.json` baseline lines and 7 `json-schema.manifest.json`
  entries for the deleted schemas are dropped deliberately in the same change
  (the plugin-runtime precedent: a prescription nobody can receive is noise —
  nothing parses these shapes any more).

### Patch Changes

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

- 58434f5: fix(metadata-protocol): boot hydration grafts each overlay row's protection envelope from ITS OWN package (#4624)

  `loadMetaFromDb` (boot hydration) kept a **third** inline copy of the
  overlay→SchemaRegistry registration rule, and its artifact lookup was
  **unscoped** — the exact pre-#1828 shape ADR-0048 removed from `getMetaItems`:
  with two installed packages shipping the same `type`/`name`, a name-colliding
  overlay row grafted the **first-registered** package's
  `_lock`/`_lockReason`/`_packageId`/`_provenance` onto another package's row at
  every kernel boot. A row customized under package B could come up wearing
  package A's identity and lock.

  The non-object branch now delegates to the ONE shared
  `hydrateOverlayIntoRegistry` (introduced by #4521 for the read-side hydration
  and the write-through), passing the row's own `package_id` — one rule, one
  implementation, and the ADR-0048 package-scoped lookup applies at boot exactly
  as it does on read and write.

  No other boot behaviour changes:

  - **Boot order** — when packaged artifacts have not loaded yet at hydration
    time, the scoped lookup finds nothing, exactly like the unscoped one did,
    and the row registers unchanged.
  - **Package-less (global) rows** — `package_id IS NULL` keeps the legacy
    best-effort first-match graft, identical to the read-side hydration.
  - **Row selection** — the helper carries no environment gate; which rows
    `loadMetaFromDb` loads is decided by its query, unchanged here.

- 5b843fb: fix(automation,spec): the cold-boot flow bind must survive the read path's own annotations (cloud#971)

  `getMetaItems({ type: 'flow' })` decorates every served item with
  `_diagnostics` (and `_draft` on a preview read). The cold-boot bind fed that
  served document straight into `engine.registerFlow` → `FlowSchema.parse`, and
  since #4001 closed the metadata schemas an unrecognized key **throws** instead
  of being dropped — so every flow failed to register on every boot with
  `unrecognized_keys: ["_diagnostics"]`. Not fatal only by luck: the
  record-change plugin binds record flows a second way, so automations kept
  firing behind one WARN per flow. A flow whose only binding path is this one
  would have gone silently dead.

  Fixed at the read seam (`readFlowDefsFromProtocol`), not by loosening
  `FlowSchema`: the payload is malformed because we decorated it, so the
  producer's annotation is the producer's to remove.

  `@objectstack/spec` gains `METADATA_READ_DECORATIONS` / `stripReadDecorations`
  (`kernel/metadata-read-decorations`) — the list moves out of
  `metadata-protocol`, where it was module-private, so the producer and its
  cross-layer consumers share one definition. `metadata-protocol` re-exports
  `stripReadDecorations` unchanged; no public surface is removed.

- 20bc357: fix(spec,metadata-protocol,runtime): discovery stops advertising routes for the kernel-internal cache/queue/job slots (#4318)

  The metadata-protocol discovery builder declared `/api/v1/cache`, `/api/v1/queue`
  and `/api/v1/jobs` — three paths that existed nowhere else in the repository: no
  dispatcher domain, no adapter mount, no plugin registration, and the shipped
  providers (`service-cache`/`-queue`/`-job`) are in-process contracts that will
  never mount one. Every default boot therefore advertised a route inside the same
  `ServiceInfo` whose `handlerReady: false` said the opposite — a single record
  contradicting itself (ADR-0076 D12).

  These slots are route-less now, like `realtime` — but unlike `realtime` an
  unmarked real implementation stays `available`: the slot's contract is
  in-process, so "no HTTP surface" is not reduced capability for it. `handlerReady`
  is reported `false` on both discovery builders — for a route-less slot it is not
  a proxy for anything, it is the fact itself (the dispatcher used to claim
  `handlerReady: true` here for an unmarked occupant, a handler that does not
  exist). The explanatory message is written once, as
  `inProcessServiceMessage(slot)` in `@objectstack/spec/system`, so the two
  builders cannot drift apart.

- 8aacf94: fix(metadata-protocol): `duplicatePackage` stops minting pre-protocol flow rows (#4498)

  `duplicatePackage` canonicalizes each source row before re-saving it, under a
  stated guarantee: "duplication never mints new rows in a pre-protocol dialect."
  It delivered that through `convertStoredItem`, which opens with
  `if (singular === 'flow') return { item: data, notices: [] }` — so for flows the
  guarantee was **not** delivered.

  It did not fail loudly either. `FlowNodeSchema.config` is an open `z.record`, so
  a pre-17 body (a `delete_record` carrying `config.filters`) sails through
  `saveMetaItem`'s schema gate and lands verbatim in a brand-new row.

  **Why this mattered more than an un-migrated row.** ADR-0087 justifies the whole
  stored-metadata design on new writes always being canonical, _therefore_ the
  stored pass being "a strictly shrinking concern". `duplicatePackage` was a live
  producer contradicting that for flows: an operator could run
  `os migrate meta --stored --apply`, get a clean report, duplicate a package, and
  be back to having pre-protocol rows — with the report still saying protocol N
  until the next run.

  **The capability was already reachable.** The reason for the flow skip is real —
  flow-node conversions carry ADR-0078's open-namespace conflict guard, which needs
  the automation engine's live executor registry to tell a rename from a clobber.
  But the protocol is constructed with an accessor for the kernel's service table
  (the same one `analytics` and `package` are read from), and the automation
  service registers under `automation`. A new private `resolveFlowCanonicalizer`
  reads `canonicalizeStoredFlow` (#4454) off it, so every caller running next to a
  live engine gets flow coverage without threading anything.

  - **`duplicatePackage`** canonicalizes flow rows through it. A refused rename
    fails that item into the existing `failed[]` naming the token — copying the
    un-renamed body would mint exactly the row this fixes. A flow that cannot
    canonicalize fails the same way. With no engine reachable (a control-plane or
    metadata-only host) the source body is copied as-is: no worse than the source
    row already is, and failing an unrelated duplication over it would be its own
    regression.
  - **`migrateStoredMetadata`'s `canonicalizeFlow` becomes an override.** It now
    defaults to the resolver. The CLI stopped passing one — it boots its inert
    engine into the same kernel, so both routes reached the same instance, and two
    routes to one capability is how they drift. The parameter stays for callers
    with no registry and for testing the flow branch without an engine.
  - **Resolution is lazy, per call.** Plugin init order does not guarantee
    `automation` is in the table when the protocol is assembled (the CLI adds it
    after ObjectQL by design), so caching `undefined` from a too-early read would
    disable flow canonicalization for the life of the process.

  Two smaller honesty fixes ride along: a source item that fails _conversion_ (a
  tombstoned key throws) is now reported as such instead of as `unparseable
metadata`, and `migrateStoredMetadata`'s "no engine" skip reason says no
  automation service is reachable rather than blaming the caller for not supplying
  one.

  Reads are unchanged. `getMetaItems` / `getMetaItem` / `getMetaItemLayered` /
  `loadMetaFromDb` still skip flows — they are reads, covered by `registerFlow`
  canonicalizing at execution, and are not producing bad data. Duplication was the
  one that writes.

- 63b33e6: One canonical type key at the `/meta` read/write/delete boundary (#4432).

  #3985 made the per-type gates accept both spellings of the `/meta` type segment
  (`/meta/actions` and `/meta/action`). It did not FOLD them, so the two spellings
  addressed two different namespaces and the layers below disagreed about which
  one an item lived in. `saveMetaItem`, `getMetaItem`, `getMetaItems`,
  `getMetaItemLayered`, `getMetaItemCached` and `deleteMetaItem` now fold the type
  to its canonical singular (Prime Directive #3) as their first act, so every layer
  below them reads one key.

  The damaging consequence was not the duplicate row — it was the shadowing.
  `getMetaItems` hydrated overlay rows back into the SchemaRegistry under the
  CALLER's spelling, so one plural-spelled read minted a plural registry entry;
  from the next read on, `listItems('actions')` was no longer empty, the singular
  fallback that had been supplying every code-authored action stopped running, and
  a single overlay row hid the entire code-authored listing — on a spelling no
  DELETE could address, because the delete path resolved the singular. Listing and
  dispatch then disagreed about an item that had been deleted.

  Reads of data AT REST still try the other spelling as a fallback: rows written
  under a plural `type` before this fix are real, and nothing rewrites them on
  upgrade. What changed is that nothing WRITES or REGISTERS a non-canonical key any
  more.

- 6beb708: fix(metadata-protocol): a just-saved overlay is dispatchable immediately, not after the next listing (#4521)

  The #4432 F1 verification found that immediately after a successful
  `PUT /api/v1/meta/action/<name>`, `GET /api/v1/meta/action` already listed the
  overlay while `POST /api/v1/actions/<object>/<name>` answered the ADR-0110
  "has no declaration" 404 — and a later POST succeeded. Nothing expired in
  between: the _listing_ is what repaired it.

  The lagging cache was the engine's `SchemaRegistry`. The runtime dispatch path
  (`resolveRouteActionDeclaration`) reads it as the live view of metadata, but
  `saveMetaItem` only wrote through it for `object` — every other overlay type
  reached the registry solely via the READ-side hydration in `getMetaItems`, so
  "has anyone listed this type yet?" silently decided whether a saved action
  could be invoked.

  The fix is at the producer, per Prime Directive #12 — no retry, sleep, or
  fallback was added at the dispatch site:

  - `saveMetaItem` (publish mode), draft publishing (`runPublishSideEffects`),
    and `rollbackMetaItem` now write EVERY overlay type through the registry via
    a shared `applyRegistryWriteThrough`, so an item that is listable is
    dispatchable in the same breath.
  - The write-through and the read-side hydration share one implementation
    (`hydrateOverlayIntoRegistry`), including the ADR-0010 §3.3 protection-envelope
    graft and the ADR-0048 package-scoped artifact lookup — a read and a write
    can no longer leave the registry in two different states for the same row.
  - Unchanged boundaries: drafts still never leak into the live registry, the
    `environmentId` scoping gate matches the read side, ADR-0110's 404 for a
    genuinely absent declaration stands, and DELETE ("reset to artifact default")
    still restores the packaged artifact — the overlay is a plain-key shadow, not
    an in-place overwrite.

- 69b509f: fix(metadata-protocol): 元数据审计历史与全局搜索按 `order` 排序,不再按 `direction` (#4674)

  `protocol.ts` 里两处内部 `engine.find` 调用把排序写成 `{ field, direction: 'desc' }`。QueryAST 的排序形状是 `SortNodeSchema` = `{ field, order }`,两个真实驱动都只认 `.order` 且没有 `direction` 回退——`undefined === 'desc'` 为假,于是两个查询实际都在**升序**运行。`direction` 是 `IReportService` 的词汇,是另一份契约,这正是错误拼写看起来合理的原因。

  由于两个查询都带 `limit`,方向错误不只是把一页重排,而是**改变了哪些行会被返回**:

  - **元数据审计历史**取到的是最旧的 `limit` 条事件——一个对象生命的开头,而永远不是它最近的变更。在长期存在的对象上,编辑者要找的东西一条也看不到。
  - **全局搜索**取到的是最陈旧的 `perObject` 条匹配,最近编辑过的记录恰好被 `limit` 截断掉——而那正是搜索者最可能想要的。

  两处的 `as any` / `: any` 一并去掉:`EngineQueryOptions.orderBy` 是 `SortNodeSchema[]`,本来就会拒绝 `direction`,而类型擦除正是让它溜过去的原因。恢复类型是这次改动价值的大头,因为对内部调用方来说 `tsc` 就是那条被执行的渠道。

- 1ee48bc: fix(objectql,metadata-protocol): a tenant-authored overlay must not read back as a code artifact

  `saveMetaItem` refuses to write an artifact-backed item of a type that has not
  opted into overlay writes (`not_overridable`), and it asks
  `registry.getArtifactItem` who is artifact-backed. That answer was "anything
  whose `_packageId` is not the literal string `sys_metadata`" — a sentinel that
  only holds on the save path. The boot-time rehydration of `sys_metadata`
  registers each row under its REAL package id (`app.<slug>`), which every
  runtime-authored item has carried since packages became mandatory.

  So an app the user had just built through Studio (or the AI build agent) came
  back from the next kernel rebuild looking code-shipped, and the following edit
  was refused with a 403 — permanently. Live capture: two identical `modify_field`
  calls on the same object seconds apart, the first published LIVE and the second
  `not_overridable`, because the first one's auto-publish triggered the rebuild in
  between (cloud#970).

  Provenance is the axis that actually separates the two (ADR-0010 `_provenance`:
  `'package'` for loader-introduced items, `'org'` for tenant-authored), so ask it:
  the `sys_metadata` hydration now stamps `_provenance: 'org'`, and
  `getArtifactItem` no longer treats such an item as an artifact. An item with no
  provenance under a real package id is unchanged, so nothing that was protected
  becomes writable.

- 705e5c8: fix(metadata-protocol): a flow save that skipped canonicalization says so (#4580)

  `saveMetaItem` canonicalizes flow bodies before the schema gate (#4542). When the
  canonicalizer throws — it is stricter than the gate: strict parse, cycle
  detection, control-flow region validation — the save falls back to the raw body
  so a work-in-progress draft with a temporary cycle stays saveable. That fallback
  is correct and unchanged. It was also completely silent.

  Of the four postures at this seam, three announce themselves: a clean
  canonicalization heals the row, a refused rename fails with `409
FLOW_CONVERSION_CONFLICT` naming the token, and a host with no automation service
  is reported by `os migrate meta --stored`. The throw-fallback said nothing, so a
  save that skipped canonicalization was indistinguishable from one that healed the
  row — and a body that is _both_ a legacy dialect and unparseable by the strict
  canonicalizer re-persisted verbatim. That is the exact #4542 symptom, arriving
  silently, while the boot warning for legacy stored rows tells the author that
  re-saving is the remedy.

  The fallback now emits a `console.warn` naming the flow and the canonicalizer's
  own error, deduped once per flow per process (the `convertStoredItem` pattern —
  Studio autosaves the same draft repeatedly, and a WIP cycle throws on every
  write). This aligns the write seam with ADR-0087 D2's "loud" posture, where
  conversions emit notices, reads warn once per row, and `migrateStoredMetadata`
  reports `failed` with the message.

  No behavior change: the body still saves, the schema gate stays the arbiter, and
  `registerFlow` still refuses to arm a malformed flow. Refusing the save in
  publish mode was considered and rejected — publish is the default mode, so it
  would silently tighten validation for every existing caller, and it could only be
  enforced on hosts that have an automation service, making the same body saveable
  on a control-plane host and a 422 on an automation host.

- f61edce: fix(metadata-protocol): `saveMetaItem` canonicalizes flow bodies on write — a Studio edit now heals a legacy flow row like every other type's (#4542)

  The once-per-boot stored-conversion warning promises that re-saving a row
  ("Studio edit → save") persists the canonical shape. That held for every type
  except `flow`: the read path serves stored flows verbatim (the ADR-0078
  open-namespace conflict guard needs the engine's live executor registry, so
  `convertStoredItem` skips them), and `FlowNodeSchema.config` is an open
  `z.record`, so the legacy dialect an author was served (`config.filters`, pre-17
  node aliases) sailed back through `saveMetaItem`'s schema gate and re-persisted
  verbatim. A flow row stayed `pending` in `os migrate meta --stored` no matter
  how many times an author edited it — only the migration itself could retire it.

  `saveMetaItem` now runs the #4498 resolver (`resolveFlowCanonicalizer`) on flow
  bodies **before** the schema gate and persists `storable` — conversions plus the
  derived condition envelopes, deliberately not the schema's defaults (ADR-0087).
  The pass is copy-on-write, so already-canonical bodies (including the ones
  `migrateStoredMetadata` and `duplicatePackage` hand in) are untouched.

  Failure postures, same as the duplication seam:

  - **A refused node-type rename** (the old token is a live name owned by a custom
    executor here) refuses the save with `409 FLOW_CONVERSION_CONFLICT`, naming
    the token and path — never a silent legacy persist. 409 rather than 422
    because the body may be perfectly valid: the refusal comes from environment
    state, so resubmitting the same body cannot help.
  - **A body the canonicalizer cannot parse** falls back to the raw save and
    today's schema gate — in draft AND publish mode. `canonicalizeStoredFlow` is
    stricter than the gate (cycle detection, control-flow regions), and a
    work-in-progress draft with a temporary cycle must not become unsaveable;
    `registerFlow` still refuses to arm a malformed flow either way.
  - **No automation service reachable** (a control-plane or metadata-only host):
    the save behaves exactly as before — a host must not start refusing flow
    writes it accepted yesterday. `os migrate meta --stored` reports what it
    could not canonicalize.

  Reads are still unchanged — served bodies keep the stored dialect ("reads
  diagnose, never drop"); the heal happens on the way back in.

- 0657f6b: fix(seed): enforce `Seed.env` — environment-scoped datasets no longer seed everywhere

  `Seed.env` was authorable, defaulted and type-checked, but inert. `SeedLoaderService`
  filtered on the **loader config's** `env`, and none of the six call sites that build a
  `SeedLoaderRequest` (app boot, per-org replay, hot reload, package apply, draft publish,
  marketplace install) ever passed one — so `config.env` was always `undefined`, the filter
  short-circuited, and `dataset.env` was never read. A dataset marked `env: ['dev']` seeded
  into production exactly as if it were marked `['prod']`, which is the dangerous direction:
  the rows most likely to carry that marking are demo users, fake customers and seeded
  credentials.

  The loader now resolves the environment itself, at the one funnel every seeding path goes
  through:

  - **Source is `NODE_ENV`** — the environment source this repo already uses everywhere
    (`os start` defaults it to `production`, `os dev` / `serve --dev` set `development`,
    vitest sets `test`). No new environment variable and no new authorable key. `production`
    / `development` / `test` and the seed-enum spellings `prod` / `dev` are accepted,
    case-insensitively.
  - **An explicit `config.env` still wins**, so a host can seed "as" another environment.
  - **A dataset that declares no `env`** (the schema default `['prod','dev','test']`) seeds
    in every environment, exactly as before — no existing deployment loses rows.
  - **When the environment cannot be determined** (NODE_ENV unset, or a value like
    `staging`), the loader stays permissive and seeds everything — but logs a **warning**
    naming each environment-scoped dataset, the accepted `NODE_ENV` values and the
    `config.env` escape hatch. Fail-open is deliberate: fail-closed would also drop an
    `env: ['prod']` dataset on a production host that merely forgot to export `NODE_ENV`,
    a silent data-loss regression worse than the over-seeding it prevents.
  - **Skipped datasets are always named** in an `info` log, so "my demo rows are missing" is
    one log line to answer rather than a mystery.

  The resolved environment is also what seed CEL expressions now bind `env` to, so a seed's
  `env` and the loader's filter can no longer disagree.

  No API or schema change: `Seed.env` and `SeedLoaderConfig.env` are unchanged, and no
  package export was added.

- 666f542: fix(seed-loader): the per-org tenant stamp is an id, not a natural key — stop
  re-resolving it and dropping it

  In a multi-org deployment the SeedLoader's per-organization replay landed
  **every row org-less**, so a freshly created organization booted with a CRM
  whose tables held data nobody could see: the tenant wall (`organization_id =
<active org>`) hides a NULL-org row from all members, including the org's own
  owner.

  The stamp and the reference pass disagreed about what `organization_id` holds.
  The loader writes `config.organizationId` — the replay target's **id** — into
  the record; the reference pass then sees a field declared as a lookup →
  `sys_organization` and resolves its value as a **natural key**, probing
  `sys_organization.name`. That misses, and a missed reference is dropped rather
  than kept, taking the tenant attribution with it. The `id` fallback probe cannot
  rescue it either: under replay every probe is AND-scoped with `organization_id =
<target org>`, and `sys_organization` — being the tenant table itself — carries
  no such column, so that probe matches nothing by construction.

  What hid it for so long is the **id shape**. `looksLikeInternalId` recognises
  UUID and Mongo ObjectId and short-circuits resolution for both, so any fixture
  that minted UUID organization ids passed. Every organization better-auth
  actually creates is `org_<base36>` — including the default organization
  `ensureDefaultOrganization` bootstraps on first boot — and that shape is not
  recognised. The defect therefore fired on real deployments and on nothing else.

  The loader now remembers that it wrote the stamp itself and skips resolution for
  that one field. A seed that authors `organization_id` explicitly still goes
  through resolution, so naming an organization by its natural key keeps working.

  Reported by `apps/ee-tenant-crm-showcase` in the cloud repo, which reproduces
  the whole path end-to-end: two organizations over one database, each replaying
  the artifact's seed datasets into its own private copy.

- ad5fe25: fix(spec,objectql,metadata-protocol): a `user` field carries its target in the TYPE — bare `{type:'user'}` is not targetless

  `field.zod` defines `user` as "a lookup specialized to the `sys_user` system
  object … target fixed to the `sys_user` system object", and `Field.user()` —
  unlike `Field.lookup(reference, …)` — takes no target argument and writes
  `reference: 'sys_user'` itself. The target is a constant of the type.

  Two callers read `field.reference` raw and so disagreed: the protocol's expand
  gate refused `?expand=<a bare user field>` with `400 INVALID_FIELD … declares no
target object`, and objectql's expand loop skipped it. Metadata authored without
  the redundant `reference` — hand-written JSON, an AI author, a Studio form — was
  read as under-specified when it was complete. Live capture (cloud#983): an
  AI-built app's very first screen rendered an error page over that 400.

  New: `referenceTargetOf` in `@objectstack/spec/data` — the single arbiter of
  "what does this reference field point at", next to `REFERENCE_VALUE_TYPES` (the
  set those same two callers already share for "is this a reference at all"). Both
  halves of the expand path read it, so the gate can no longer refuse a field the
  engine would have expanded, nor bless one it skips.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [0800433]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [85a966f]
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
- Updated dependencies [459f925]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [8e53e5d]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
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
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [65f184b]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [4b945fc]
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
  - @objectstack/lint@17.0.0-rc.2
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/metadata-core@17.0.0-rc.2
  - @objectstack/formula@17.0.0-rc.2

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
