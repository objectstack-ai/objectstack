# @objectstack/plugin-webhooks

## 17.1.0

### Patch Changes

- 90417a8: chore(plugin-webhooks): `sys_webhook` declares its data-API exposure explicitly — recording the posture, not narrowing it (#9756)
  
  `sys_webhook` shipped with no `enable` block at all, so it kept the full default
  data API. Three cards each noticed and each named the narrowing as the next
  step — #7799 (the signing secret), #7986 (the custom headers), #8025 option 2
  (the URL) — and each assumed a later one would write the line. None did, and the
  last of them closed `completed` with the line still unwritten. The posture was
  never a judgement; it was a default nobody had written down.
  
  It is written down now:
  
  ```ts
  enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'] }
  ```
  
  **The effective surface is unchanged, and that is the honest headline.** The set
  is derived from a census of who actually reaches the object, taken before
  anything was edited:
  
  | consumer | reaches it through | needs |
  |:---|:---|:---|
  | Setup/Studio console — `nav_webhooks`, four list views, `userActions` create/edit/delete | REST `/api/v1/data/sys_webhook` (gated) | `get` `list` `create` `update` `delete` |
  | Operator predicate write — "deactivate every webhook on an object" (#4639) | REST `updateMany`/`deleteMany` (gated on `bulk`) | `bulk` |
  | `AutoEnqueuer`, `bootstrapDeclaredWebhooks`, the provenance stamp, `redeliver-guard`, the secret sweep | `engine.*` and lifecycle hooks — ObjectQL directly, which never consults `enable.apiMethods` | ungated |
  
  Every primitive is required by a real consumer, so the set is all six — whose
  operation closure is what the absent block already produced. Nothing that was
  reachable becomes unreachable, and `/me/permissions` reports the identical
  `apiOperations` array. No caller needs to change anything.
  
  ⛔ **Do not read this as the read-surface narrowing those three cards asked
  for.** It is not one, and `apiMethods` cannot be one here: `url` (#8025 —
  won't-fix on masking, because the URL is the routing key an operator must be
  able to see, search, sort and edit) and a legacy row's un-migrated
  `definition_json.headers` (#7986 — still read, and warned about, by
  `readLegacyHeaders`) are served by `get`/`list`, which is exactly what the admin
  console requires. Any set that removes them removes the admin surface too. The
  sibling `sys_http_delivery` can hold `['get','list']` because it is engine-owned
  and never authored; `sys_webhook` is a first-class admin authoring surface.
  
  The equality above is pinned in `sys-webhook-api-exposure.test.ts` rather than
  left as a claim, so a later change that does move the surface has to say so.
- b278695: fix(webhooks): refuse a malformed `sys_webhook.headers_secret` at the write door instead of at the next delivery (#8566)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  renamed, retired or tombstoned. This adds a runtime validation hook on one
  plugin-owned object's existing column; the authoring envelope
  (`webhook.zod.ts`), the field declaration and every stored shape are untouched.
  The accept-set narrows, but only over values that were already unusable at
  delivery time (see below), so there is no configuration for a migration to
  prescribe a rewrite of. -->
  
  `sys_webhook.headers_secret` is a `Field.secret()` whose plaintext is **not** an
  opaque blob: it is a serialized header map with a required shape — a flat JSON
  object of string values — and `parseStoredHeaders` is its only reader. Nothing
  validated that shape on the way in. The ordinary data API accepted any string,
  encrypted it like any other secret, minted a real `sys_secret` row, and left the
  column holding a perfectly valid `secret:` ref that read back as the mask with
  `active: true`.
  
  Measured on a real engine through `engine.update()` — the ordinary data API, no
  privileged access — every one of these was **accepted** and is a value the
  plugin can never use: `{}`, `[]`, `{"X-Count": 5}`, a nested object, and
  `{X-Team: crm}` (a typo). The field is directly admin-authorable and its own
  description instructs the author to type a JSON object into it, which makes a
  typo the *expected* failure rather than an exotic one.
  
  **This is not an exposure fix and must not be read as one.** #8558/#8565 already
  closed the consumer half: a webhook whose stored header map does not come back
  as a flat string map parks the subscription and reports at `error`, rather than
  delivering header-less with a valid signature. Nothing leaks, and nothing is
  silently lost today. What this changes is **when the author finds out** — at the
  write door where they typed it, instead of at the next matching record change,
  an unbounded time later and in a different surface.
  
  **What is refused:** a `headers_secret` plaintext that does not parse back as a
  flat JSON object of string values with at least one entry, with a located
  ADR-0112 `VALIDATION_ERROR` / 400 naming `sys_webhook.headers_secret`, quoting
  the shape the field's own description asks for, and diagnosing the specific
  spelling (invalid JSON / an array / an empty object / which key's value is not a
  string). ⛔ The message never echoes the rejected value — this column carries
  credentials, and quoting the input would print an `Authorization: Bearer …` into
  logs and error bodies, re-opening in the diagnostic exactly the exposure #7986
  moved this field onto the encrypted channel to close. It names header *keys* and
  value *types* only.
  
  **What stays accepted, byte for byte:** every valid flat string map (as JSON
  text, or as an authored object the engine serializes into the same form); `null`
  to clear; an omitted key to leave the stored value unchanged; and an **echoed
  read-mask**, so the ordinary Setup-form round-trip (GET a row, edit an unrelated
  field, PATCH it back) is untouched. `""` is deliberately passed through to
  #8559's `EmptyCredentialWriteError` rather than re-refused here — one door, one
  owner, one message.
  
  **Where it runs, and why that is the whole mechanism:** a `beforeInsert` /
  `beforeUpdate` hook on `sys_webhook`, bound by `WebhookOutboxPlugin` before its
  first seeded write. It has to run *before* the engine's `encryptSecretFields` —
  one step later the plaintext is gone and the column holds an opaque ref, so a
  validator behind it would have nothing left to validate. The suite measures that
  ordering rather than asserting it: every refusal pins that **no `sys_secret`
  cipher row was minted**, which is only true if the gate ran first.
  
  A hook rather than checks on the plugin's own write paths
  (`bootstrapDeclaredWebhooks` / `headersPatch` / the migration sweep), because a
  direct `PATCH /api/v1/data/sys_webhook` goes through none of them and that is
  the measured trigger. Those paths inherit the validation through the hook and
  deliberately carry no second check.
  
  A general `secret`-channel plaintext validator — letting any `secret`-typed
  field declare its own plaintext shape — is the principled generalization and is
  recorded as the **promotion path**, not built here: it becomes the shape the
  moment a second shaped-plaintext `secret` field exists (maintainer ruling
  2026-08-13; one consumer does not justify a general capability).
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
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
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
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
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
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
- Updated dependencies [44738f7]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
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
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/service-messaging@17.1.0

## 17.0.0

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

- f2445c9: feat(spec,objectql,client,plugin-webhooks): predicate writes get an honest bulk event contract (#4639)

  A `multi: true` update/delete reaches `IDataDriver.updateMany` / `deleteMany`,
  which are contracted to resolve an affected row COUNT and nothing else. That
  satisfies neither `DataEvent.recordId` (required) nor `before` / `after` /
  `changes`, so before #4626 the engine fabricated a per-record event with
  `recordId: ''` and `after: <count>` — an event every schema-compliant consumer
  must reject, and one the webhook enqueuer's `?? 'unknown'` fallback turned into
  a real delivery naming an unidentifiable record. #4626 removed the fabrication
  and published nothing instead: honest, but it left webhooks, knowledge sync and
  `subscribeData` silent for every predicate write.

  Bulk writes now get their **own** contract rather than impersonating a
  per-record one or going dark:

  - **New `BulkDataEvent`** (`@objectstack/spec/api`): `data.records.updated` /
    `data.records.deleted` — note the plural — carrying `id`, `type`, `object`,
    `matched`, `userId?`, `timestamp`. Deliberately a separate schema from
    `DataEvent`, not a widened one: a consumer that receives
    `data.records.updated` knows from the type alone that no `recordId` is
    coming, instead of discovering an empty string at runtime.
  - **Engine** publishes it from the `multi: true` branches of `update()` /
    `delete()`, validated with `BulkDataEventSchema.parse` before publish. A
    predicate that matched **zero** rows publishes nothing (no data changed — this
    is what keeps an idle background sweep from becoming an hourly "0 records"
    delivery), and a driver that resolves a non-count publishes nothing and warns
    rather than asserting a number it cannot verify. Per-record writes are
    untouched, including a scalar `where.id` with `multi: true`, which is still a
    single-record target and still emits `data.record.deleted`.
  - **Webhooks**: two new opt-in triggers, `bulk_update` and `bulk_delete`
    (`WebhookTriggerType`, and the `sys_webhook.triggers` multi-select). They are
    **not** extra sources for `create` / `update` / `delete`: the delivered body
    has no `recordId` and no record, so routing it to existing per-record
    subscribers would hand them a payload missing every field they read — the
    same class of breakage as the old `recordId: ''`, from the other direction. A
    webhook that wants both subscribes to both. Bulk deliveries dedup on the
    producer's event uuid, since two sweeps in the same millisecond are genuinely
    different events that a timestamp-based key would collapse.
  - **Client SDK**: new `client.events.subscribeBulkData(object, cb)`, with the
    same loud boundary validation as `subscribeData`. Kept a separate method for
    the same reason — delivering a `BulkDataEvent` to a `(event: DataEvent) =>
void` callback would recreate exactly the "typed field, `undefined` at
    runtime" defect #4626 removed. `subscribeData`'s own guard was also tightened
    from `data.` to `data.record.`, so an aggregate event is ignored rather than
    rejected as off-contract.
  - **Knowledge sync** now says out loud that a predicate write leaves its index
    stale. A knowledge index is a per-record projection and `matched: 40` names no
    record, so no event shape could drive it — the durable fix is reconciliation,
    tracked in #4672.

  The event carries no `where` predicate. The only one available at publish time
  is the middleware-composed AST, whose filter embeds the security layer's
  injected row scoping (RLS, sharing) — publishing it would ship tenant scoping
  internals to whatever external URL a webhook points at.

  Also pays off a measurement debt from #4655, which claimed the write-path cost
  of event publishing had been measured but never published the numbers:
  `packages/objectql/src/engine-data-events.bench.ts` measures it. Against an
  in-memory driver, publishing costs ~7–9µs per event (insert 0.021ms vs 0.012ms,
  single-id update 0.013ms vs 0.007ms). A bulk write pays that **once** regardless
  of how many rows matched (0.040ms vs 0.034ms over a 100-row match set), so its
  relative cost shrinks as the match set grows.

- 69f1dfd: fix(webhooks): materialize stack-declared webhooks into the dispatcher (#3461)

  A webhook authored declaratively — `defineStack({ webhooks })` / `defineWebhook()`,
  validated against the spec `WebhookSchema` — was a **silent no-op**. The runtime
  dispatcher (`AutoEnqueuer`) fans out off `sys_webhook` DATA rows (`object_name` /
  `active`), which until now were only ever written by hand through the object's
  CRUD UI. Nothing turned a declared webhook (`object` / `isActive`) into a
  dispatchable row, so authoring `webhooks:` on a stack produced `webhook` metadata
  that never fired (ADR-0078). The showcase app itself shipped a `webhooks:` entry
  that did nothing.

  `@objectstack/plugin-webhooks` now bridges the two on boot:

  - **`bootstrapDeclaredWebhooks`** reads declared `webhook` metadata from the
    ObjectQL registry (where the manifest decomposition already parks
    `stack.webhooks`), validates each through `WebhookSchema.parse()` — the spec
    schema finally has a real consumer — and materializes it into a `sys_webhook`
    row, mapping `object → object_name`, `isActive → active`, and stashing the full
    envelope (headers / secret / retry / timeout) in `definition_json`. The
    auto-enqueuer's first cache refresh then picks the row up and dispatches it.
  - **Seed-not-clobber provenance** (mirrors `sys_sharing_rule`, #2909): `sys_webhook`
    gains `managed_by` / `customized` columns. Declared webhooks re-seed every boot
    as `managed_by: 'package'`, but a row an admin created (`managed_by: 'admin'`) or
    edited in Setup (`customized: true`, stamped by a `beforeUpdate` hook) is never
    overwritten — a deactivated noisy webhook survives redeploys.

  Connector-declared `webhooks` remain not-yet-enforced (that is a separate seam,
  #3197). Registering `webhook` as a first-class metadata type + enrolling it in the
  liveness `GOVERNED` set is a tracked follow-up.

  Migration: none required. Existing hand-authored `sys_webhook` rows default to
  `managed_by: 'admin'` and are never touched by the seeder. Anyone who authored
  `webhooks:` on a stack expecting it to fire will find it now does — review those
  declarations (especially `url` / `isActive`) before upgrading.

### Patch Changes

- 257d97a: ADR-0078 Phase 4, decided rather than deferred: the silent skips stop being silent at runtime. The registry — the one choke point every metadata door goes through — now emits a functional-completeness diagnostic at registration, and the webhook enqueuer's zero-trigger skip warns instead of returning `null` wordlessly.

  **The Phase 4 ruling.** The phase had two halves, and they got opposite verdicts:

  - **Generative rule sweep: rejected — not deferred.** A generator can enumerate candidates ("which optional keys might be load-bearing?") but cannot verify runtime skip sites, and a rule without its skip-site citation is a false prescription — this campaign shipped four of those and every one was caught by the verification pass a generator would skip. The route is structurally wrong; no amount of waiting produces the evidence that would fix it.
  - **Registration-time diagnostics: built now.** The evidence was already in hand, not pending: #3896 (Setup authoring inserted `sys_sharing_rule` rows directly, bypassing the schema that "required" `criteria`) and cloud's `rowColor.mapping` (an `as never` cast bypassed tsc) prove that doors which skip Zod and lint are real. The author-time gate only protects metadata that passes through `os build` / `validate` / `lint`; `SchemaRegistry.registerObject` is where _every_ door converges — declared stacks, plugin objects, `extend` contributions, `saveMetaItem`, raw `registerObject` calls.

  **Same predicate, same rule ids, different posture.** The registry calls the same `checkFieldCompleteness` that `validate-functional-completeness` uses, so the boot log carries the _same rule ids_ the lint reports (`field/summary-without-operations`, …) — an operator or an AI reading the log greps the id straight into the same docs and suppression story. But the registry **warns and never throws**: ADR-0078 §1's error severity means _the instance is dead_, not _the system is dead_ — an inert field must not kill a boot that thousands of healthy objects share. Errors block at author time; the registry's job is to make sure the silence never survives to runtime unobserved.

  One line per object with every finding aggregated (not per request — the hot path stays free; not per finding — a three-dead-field object is one greppable line). Follows `warnStrippedLegacyApiMethods` (#3543) exactly: module-level once-per-object dedup, injectable `warn`, pure observation that never mutates the schema.

  **The webhook skip now names itself.** `auto-enqueuer.ts`'s `if (triggers.size === 0) return null` sat under a comment blessing the empty case as "a manual-only webhook" — a mode #3196 removed (no manual fire path exists). The skip now warns with the author-time rule id (`webhook/without-triggers`), and the comment tells the truth. Only _active_ rows reach the parse (`where: { active: true }` — verified, not assumed), so a deliberately disabled webhook stays warning-free.

  **Scope honesty:** field rules and the webhook rule get the runtime twin. `view/layout-without-binding` stays author-time-only — views don't register through this choke point and the renderer half of the evidence lives in objectui.

  Tracked in #4544. This closes the ADR-0078 loop end to end: author-time error, runtime warning, one shared predicate deciding both.

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

- 462b713: fix(objectql,client): `subscribeData` callbacks receive real `DataEvent`s — the producer now fulfils the declared contract (#4626)

  `@objectstack/spec/api`'s `DataEvent` declares top-level `id` (uuid,
  required), `type`, `object`, `recordId` (required), `changes?`, `before?`,
  `after?`, `userId?`, `timestamp`. But the producer (the ObjectQL engine)
  published a raw `RealtimeEventPayload` envelope with `{ recordId, after,
changes }` nested under `payload` and never generated `id`/`userId`, while the
  client SDK force-cast that envelope into the callback (`callback(event as any
as DataEvent)`). Subscribers who wrote `event.recordId` / `event.changes` —
  exactly what the types promised — compiled green and read `undefined` at
  runtime. The data-side twin of #4602.

  Producer now fulfils the contract:

  - `ObjectQL.insert()` / `update()` / `delete()` build a true `DataEvent`
    (generated uuid `id`, flattened top-level fields, `userId` from the
    execution context when the write names an actor) and validate it with
    `DataEventSchema.parse` before publishing. The transport envelope is
    unchanged (`RealtimeEventPayload`, with `payload` carrying the complete
    `DataEvent`), so subscribers keep receiving `{ type, object, payload,
timestamp }` on the wire.
  - A batch insert publishes one event **per record** (as before), each with its
    own event id.
  - **A multi-row write (`multi: true` → `updateMany` / `deleteMany`) now
    publishes nothing.** Those driver methods return only an affected count, so
    there is no record for a required `recordId` to name; the engine logs a
    warning naming the gap instead of publishing the previous fabrication
    (`recordId: ''`, `after: <affected count>`), which every schema-compliant
    consumer had to reject. **Consequence: webhooks and knowledge sync no longer
    fire for bulk writes** — they previously fired once with an unusable body. A
    real bulk event contract is tracked in #4639.

  Consumers validate or read the fulfilled shape instead of guessing:

  - `@objectstack/client`'s `subscribeData` (and therefore
    `@objectstack/client-react`'s `useDataSubscription` /
    `useDataSubscriptionCallback` / `useAutoRefresh`, which delegate to it)
    unwraps the envelope and runs `DataEventSchema.safeParse` at the boundary.
    An off-contract payload is rejected loudly (handler error, callback never
    invoked) — never coerced or passed through. The `as any as DataEvent`
    double-cast is gone, and the `recordId` option now filters on the fulfilled
    event.
  - `@objectstack/plugin-webhooks`' auto-enqueuer reads the required
    `recordId` directly; its `recordId ?? id ?? after?.id ?? before?.id ??
'unknown'` fallback chain is gone, and an off-contract event is dropped with
    a warning rather than delivered under the literal id `'unknown'`. Delivered
    webhook bodies now also carry the event's `id`/`type`/`userId`; the record
    itself stays nested under `after` and the envelope keys (`object`,
    `recordId`, `action`, `timestamp`) still win.
  - `@objectstack/service-knowledge`'s event sync reads the record from `after`
    (create/update) and the id from `recordId` (delete) for `data.record.*`.
    It previously indexed the envelope itself as if it were the row, and never
    resolved an id for deletes.

- a225ef5: fix(runtime,webhooks): the path object wins on /data/:object/query, and the webhook envelope owns its keys (#3946)

  Follow-up sweep for the shape behind #3897 and #3933 — a trusted, server-derived
  value written into an object literal with a caller-controlled bag spread OVER
  it. Both of those were in the same block of REST code, so the pattern was swept
  across all 1313 non-test TypeScript files in `packages/`. Nine candidate sites;
  one real, one worth hardening, seven verified clean (recorded in #3946 so the
  next sweep does not re-litigate them).

  **`POST /data/:object/query` (runtime dispatcher).** The `/data` domain built
  `{ object: objectName, ...body }`, so `{"object":"other", …}` in the body moved
  the read to a different object than the URL named.

  This is NOT an authorization bypass, and the tests pin why: `callData` gates
  API exposure on `params.object`, so the gate followed the body and agreed with
  the read — an object hidden by `apiEnabled: false` was refused either way. What
  broke is that the URL stopped describing the operation (audit trails, logs, and
  anything keyed on the request path saw object A while object B was read), and
  that one endpoint spoke a second dialect of the contract the REST side had just
  standardised on: the path object wins. The other handlers in that file never had
  the problem — they nest caller data (`data: body`, `query: normalized`) instead
  of splatting it, and the GET-by-id branch already allowlists its query params
  against exactly this pollution.

  **Webhook delivery envelope.** `auto-enqueuer` built
  `{ object, recordId, action, timestamp, ...payload }`, letting an event payload
  rewrite the envelope a subscriber receives. Behaviour-neutral for the engine's
  own publishers — `data.record.*` payloads are `{ recordId, after, changes }`
  with record fields nested under `after`, so none of those four keys collide
  today — but the shape was wrong, and the `payload.id` fallback right above it
  suggests publishers that flatten record fields do exist. Envelope keys are
  written last now.

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

- 8af76ae: The i18n extractor's default locale now tracks the source instead of merging (#8543), and the approval vocabularies carry authored English labels in the contract (#8580).

  - `os i18n extract` merge mode no longer applies to the default locale: `en` is a copy of the source, not a translation, so an edited label/description/help now reaches the regenerated `en` bundle instead of being silently shadowed by the stale entry forever (53 stale entries had accumulated across 6 packages under the old behavior; all rewritten here). Translated locales (`zh-CN` / `ja-JP` / `es-ES`) keep merge semantics exactly as before — no existing translation is overwritten.
  - Bare-string and label-less select options now seed through the extractor's derived channel: the machine value still seeds the skeleton, but the coverage gate no longer demands "translations" of machine identifiers, and a copied value can no longer masquerade as authored display text.
  - New `@objectstack/spec/contracts` exports `APPROVAL_STATUS_LABELS` and `APPROVAL_ACTION_KIND_LABELS`: the authored English for `sys_approval_request.status` (previously living only in the generated `en` bundle) and `sys_approval_action.action` (previously shipping raw machine values such as `submit` / `request_info` — the #7232 humanization missed this sibling field). Both columns derive their option labels from these maps; the regenerated `en` bundles copy them verbatim.

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

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- 52281b0: chore(i18n): purge the dead sys_webhook_delivery translation block and guard against recurrence

  `sys_webhook_delivery` was removed when webhook delivery moved to
  `@objectstack/service-messaging` (`sys_http_delivery`, ADR-0018 M3), but a full
  translation block for it lingered in the four generated plugin-webhooks i18n
  bundles (en/zh-CN/ja-JP/es-ES) — dead weight bound to an object that no longer
  exists, and destined to be dropped silently (with any curated strings) on the
  next `os i18n extract`.

  - Removed the stale `sys_webhook_delivery` block from all four locale bundles
    (surgical; the `sys_webhook` block is untouched).
  - Corrected three stale `sys_webhook_delivery` doc comments (platform-objects
    `integration/index.ts` + `setup.app.ts`, plugin-webhooks `sys-webhook.object.ts`)
    that still named it as a plugin-webhooks-owned object.
  - Rolled out the platform-objects `bundle-ownership` test guard (#2834 ⑤ /
    ADR-0029 D8) to the eight packages that own i18n bundles, so a stray object
    block in a generated bundle now fails the build instead of dying silently.
  - That guard immediately surfaced a live-object omission: `sys_capability` was
    present in plugin-security's bundles with curated translations but had been
    dropped from its extract config — re-added to the config so the strings are
    preserved, rather than deleted.

- 30f1b74: fix(plugins): a declared item reaches its schema intact — retire the `i?.content ?? i` unwrap from plugin read paths (#8378)

  Ten production reads over `SchemaRegistry.listItems` unwrapped every declared
  item as `i?.content ?? i`, presuming a `{ name, content }` storage envelope.
  That envelope has **no producer**. Re-measured at these seams rather than
  inherited from #7519's measurement of `MetadataFacade`:

  - `registerMetadataCollections` (objectql) registers each stack-collection
    element as-is — `registerItem(type, item, 'name')`, no boxing;
  - `loadMetaFromDb` registers `convertStoredItem(JSON.parse(record.metadata))` —
    the parsed body, never the `sys_metadata` row (whose body column is
    `metadata`, not `content`);
  - the facade's own interim boxing of non-object values, the one writer that ever
    produced the shape, was removed by #8349.

  **Removal is a fix, not a cleanup.** None of the types read through these seams
  — `permission`, `position`, `capability`, `object`, `sharingRule`, `webhook`,
  `emailTemplate` — declares a stored `content` key; every one of them rejects it
  as an unrecognized key. So wherever the key did appear the unwrap replaced a
  whole authoring document with one of its values, and `''` — falsy but
  non-nullish — passed `??` and then died at the reader's own `filter(Boolean)`,
  dropping the item with no warning, no count and no row.

  **On email templates the harm was sharpest, and it is the one users will
  notice.** `content` really is a spelling an author can write there:
  `EmailTemplateDefinitionSchema` lists it in its `strictObject` **aliases** table
  (`content: 'bodyHtml'`). That table is a _rejection_ facility, not a conversion —
  it feeds `strictUnknownKeyError`, which runs only on the `unrecognized_keys`
  path and only builds a message; nothing rewrites the key, and the ADR-0087
  conversion layer has no `email_template` entry either. The schema was therefore
  always ready with the author's fix, and the unwrap was the one thing standing
  between the author and it: the HTML string reached
  `EmailTemplateDefinitionSchema.parse()`, which answered `Invalid input: expected
object, received string`, and the boot warning's `name` field came back
  `undefined` — so an operator could not even tell **which** template had failed.

  A template authored with `content` now yields what it was always meant to:

  > Unrecognized key(s) on this email template: `content`. Did you mean
  > `content` → `bodyHtml`?

  …named against the template it came from, and counted as `skipped` rather than
  vanishing.

  No behaviour changes for spec-valid metadata: the reads hand back exactly the
  documents they always did.

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- b45c71e: fix(plugin-security,plugin-sharing,plugin-webhooks,platform-objects,service-messaging,spec): five tenant-scoped declared unique indexes become per-organization (#8554)

  Five platform objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object each
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) These are the fourth act of the class ruled on
  2026-08-13, after `sys_user_preference` / `sys_capability` (#8461) and
  `sys_position` (#8556).

  | object                        | package             | was                                | now                               |
  | ----------------------------- | ------------------- | ---------------------------------- | --------------------------------- |
  | `sys_permission_set`          | `plugin-security`   | `[name]` global                    | `[name]` per organization         |
  | `sys_sharing_rule`            | `plugin-sharing`    | `[name]` global                    | `[name]` per organization         |
  | `sys_webhook`                 | `plugin-webhooks`   | `[name]` global                    | `[name]` per organization         |
  | `sys_email_template`          | `platform-objects`  | `[name, locale]` global            | `[name, locale]` per organization |
  | `sys_notification_preference` | `service-messaging` | `[user_id, topic, channel]` global | same, per organization            |

  Measured live on a real engine before the fix — two organizations, the same key,
  `OS_TENANCY_POSTURE=isolated`, driving the real shipped declarations. All five
  reproduced identically:

  ```
  org_jia POST the key   → 201
  org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
  org_yi  POST an unused → 201            ← the control that makes it an oracle
  org_yi  GET  the key   → total 0        ← refused by a row it cannot see
  ```

  Two consequences, both removed. **A cross-tenant existence oracle:** the 409 is a
  per-value answer about a row the caller cannot read, so an organization could
  enumerate another organization's permission-set, sharing-rule, webhook and
  template naming. **A functional dead end:** the second organization simply could
  not use the name, and the refusal did not say why. For
  `sys_notification_preference` the shape is the one #8323 measured on
  `sys_user_preference` — a user belonging to two organizations could not hold
  independent per-topic delivery toggles.

  ## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

  Respelling a declared index changes its generated **name**. On an existing
  database `initObjects` is additive: it creates the new per-organization composite
  at boot and **never drops the old global index**, which goes on enforcing. Until
  the retirement is applied, a deployed installation that has taken this release is
  still enumerable — that is asserted as a test, not assumed.

  Run the migration:

  ```
  os migrate plan       # shows one `replace_unique_index` per object, categorised `safe`
  os migrate apply      # no --allow-destructive needed
  ```

  Each object plans as **one pure relaxation**, not as two findings. That matters:
  if it read as "composite missing" (safe) plus "old global index orphaned"
  (destructive, opt-in), an operator applying only the safe half would keep the
  global index — keep the defect — while the plan read as applied. The `#8461`
  `replace_unique_index` arm covers all five unchanged (no driver change in this
  release), applies CREATE-before-DROP so uniqueness is never unenforced in
  between, drops the legacy index only once the replacement is confirmed present,
  preserves every row, and converges to no drift.

  Two columns are worth an operator's attention:

  - `sys_notification_preference`'s replacement index name is **hash-suffixed** —
    `uniq_sys_notification_preference_a22d7d27` — because the natural name is 70
    characters and the limit is 60. That is expected, not corruption.
  - Rows with no `organization_id` (platform/seed rows) stay unique **among
    themselves**: the organization key part is NULL-safe
    (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so seeding by name
    keeps working and a tenant may hold its own row of the same name.

  ## Not breaking

  A relaxation admits key pairs that were previously refused and refuses nothing
  that previously succeeded, so no caller that worked before fails now. Every read
  path for these five objects goes through the tenant-scoped data API, so no
  consumer resolves one of these names across organizations expecting at most one
  row. Shipped as `patch` for that reason — the same call #8556 made for the same
  shape.

  Published text carrying the bare uniqueness claim was corrected at its source and
  the generated reference pages regenerated (`security/permission.mdx`,
  `automation/webhook.mdx`, and `integration/connector.mdx`, which embeds the same
  webhook schema), together with the `sys_permission_set` field description, its
  clone-dialog help text, the `sys_webhook` field description, and the matching
  translation bundles in all four shipped locales.

- f46e987: fix(plugin-webhooks): a webhook holding an encrypted signing secret re-arms the moment the CryptoProvider registers, instead of ~60s later (#8022)

  For roughly **60 seconds after every server start**, a webhook whose
  `signing_secret` is encrypted (the population #7799 created) was **not
  subscribed**. A record change in that window produced no delivery **and no
  `sys_http_delivery` row at all** — no dead letter, no retry, no durable trace
  that anything was missed — while `GET /api/v1/data/sys_webhook/` kept reading
  `active: true`, so the webhook looked armed in Setup the whole time. It
  self-healed at the next periodic cache refresh, which is why it was invisible to
  anyone not watching that window.

  **The fail-closed behaviour is unchanged and is not the bug.** Dropping a
  subscription whose stored key cannot be recovered — rather than delivering it
  unsigned — is #7799's whole point and still holds: the signature is the
  receiver's only proof of origin, and a webhook that stops arriving gets
  investigated while one that keeps arriving unsigned teaches the receiver to
  accept unauthenticated traffic. What was wrong is that a fail-closed drop
  outlived its own cause.

  **The ordering.** It was never a race that sometimes went the other way. Plugins
  run inside `kernel:ready`, which `runtime.start()` completes; the host's
  composition root calls `engine.setCryptoProvider(...)` only _after_
  `runtime.start()` returns (`packages/cli/src/commands/serve.ts`,
  `packages/verify/src/harness.ts`). So `AutoEnqueuer`'s first subscription-cache
  build reliably preceded the capability it needs, dropped every secret-bearing
  row on what it could see, and nothing re-read until the periodic refresh.

  `ObjectQL` now reports the registration (`onCryptoProviderChange(listener)`,
  fired after the provider is in place), and the auto-enqueuer subscribes
  **before** its first build and rebuilds the cache when it fires. Re-arming is
  immediate and event-driven — no polling, and no shorter-but-still-present
  window. The re-arm deliberately does not join an in-flight refresh: the build
  most likely running at that moment is the pre-registration one, and joining it
  would report success having re-armed nothing.

  The channel is feature-detected, as `resolveSecretField` already was — this
  plugin takes no dependency on `@objectstack/objectql`. An engine without it keeps
  the previous behaviour, with the periodic refresh as the backstop.

  **The drop is also no longer quiet.** A subscription dropped for an unresolvable
  key now reports at `error` with the consequence and the fix stated in the
  message, and carries an ADR-0112 `code`/`status` pair (`INTERNAL_ERROR`/500) in
  its metadata — the same pair the seeder's refusal for the same cause already
  carried. Per AGENTS.md it is said **once** per outage per webhook rather than
  every refresh cycle, and a webhook that recovers and breaks again is loud again.

  Unaffected, and verified still true: the secret's bytes appear nowhere in
  `sys_webhook` or in a delivery row, deliveries carry `signature` and never the
  key (#7722), and a delivery whose key exists only as ciphertext after a restart
  still produces the byte-identical HMAC receivers already verify.

- 1602949: fix(plugin-webhooks): webhook custom `headers` are encrypted at rest instead of riding `definition_json` in cleartext (#7986)

  `#7799` moved the webhook **signing secret** out of `sys_webhook.definition_json`
  into an encrypted `signing_secret` column. It did not move the custom **headers**
  map — and `headers` is the ordinary place an `Authorization: Bearer …` goes.

  `sys_webhook` declares **no `enable` block at all**, so it keeps the full default
  data API: an ordinary `GET /api/v1/data/sys_webhook` handed the whole header map,
  credentials included, to every persona that can read the object. Unlike the
  delivery table's copies, nothing ages this out — the configuration row is
  retained for the life of the webhook.

  This is a **scope-of-the-original-fix** finding, not a regression: the exposure
  predates `#7799` and nothing that card did made it worse. What was wrong was the
  conclusion a reader would reasonably draw from it — that webhook credentials are
  no longer in a blob.

  **What changed.** The authored `headers` map now lands in a new
  `sys_webhook.headers_secret` column on the engine's encrypted credential channel,
  exactly as `signing_secret` does: the engine encrypts it into `sys_secret`, the
  row keeps only an opaque `secret:<id>` ref, and every read path returns a mask.
  `definition_json` carries the same envelope minus both credential passengers. The
  auto-enqueuer recovers the map server-side through `engine.resolveSecretField()`
  on the **same** cache refresh that recovers the signing key, and the existing
  boot sweep (`migrateLegacyWebhookSecrets`) now moves already-persisted cleartext
  headers out of the blob in the same single, idempotent update it uses for the
  key.

  **Nothing about authoring changes.** Authors still write
  `headers: { … }` on `defineWebhook()`, `webhook.zod.ts` is untouched, and every
  authored header is still delivered on the wire byte-for-byte.

  **The whole map moves, not just the credential-looking entries.** Only some
  entries are credentials and the platform cannot tell which. Guessing from the
  header name (`authorization`, `x-api-key`, …) is fail-**open** on exactly the
  custom spellings — `X-Acme-Token` — most likely to be one, and a heuristic that
  silently passes the header that mattered is worse than none because it reads as
  coverage. Letting the author declare which are sensitive is a change to the
  authoring envelope and belongs to the spec surface. The cost this shape is
  accused of is measured and small: `definition_json` is a raw JSON textarea
  pending a real builder, so what an admin loses is the ability to read back a
  `Content-Type` they typed.

  **Fail-closed, and symmetric with `#7799`.** With no CryptoProvider the engine
  refuses the write rather than storing cleartext; a stored map that cannot be
  decrypted **drops** the subscription rather than delivering it with its headers
  silently missing. That drop is deliberately the same trade the signing secret
  makes: against an endpoint that does not require the header, a delivery missing
  its `Authorization` **succeeds** while quietly deviating from the configuration
  the author wrote, and nothing records that it went out incomplete. Subscriptions
  dropped this way re-arm on CryptoProvider registration exactly as `#8022` made
  them — the header map is resolved on the same rebuilt cache as the key, so a
  re-arm can never produce a correctly-signed delivery with no headers on it.

  **This does not close the exposure end to end.** The same headers are still
  written in cleartext to `sys_http_delivery.headers_json` at enqueue time, and
  that table is readable over the data API (`apiMethods: ['get','list']`, 30-day
  retention). Measured after this change: the credential is still recoverable
  there. Closing that half needs a decision outside this package and is tracked on
  #7986; `sys_email.headers_json` (the same shape, on the email delivery row) is
  untouched here for the same reason.

- 06306f1: fix(service-messaging): stop persisting webhook HMAC signing secrets on every delivery row (#7722)

  `sys_http_delivery` carried the caller's `signingSecret` verbatim, once per
  delivery attempt, in a plain `signing_secret` column — and that table is
  readable over the ordinary data API (`GET /api/v1/data/sys_http_delivery`).
  Anyone who could read deliveries recovered the shared key that authenticates
  ObjectStack to the receiver, for **every** subscriber at once. The signature is
  the receiver's only proof of origin, so the blast radius reaches outside the
  deployment: a leaked key mints payloads the receiver accepts as genuine, and
  rotating it means re-coordinating with every receiver operator.

  **The row now carries the signature, not the key.** A delivery's body is
  decided at enqueue and replayed byte-for-byte by every retry and by
  `redeliver()` — so the HMAC has exactly one correct value for the row's whole
  life. `enqueue()` computes it once from the producer's secret and stores only
  the result (`signature`, `sha256=<hex>`); the secret is consumed and dropped.
  The stored value is what the receiver is handed on the wire anyway and is
  one-way in the key, so reading a delivery row tells you what was sent, not how
  to forge something else.

  Signing behaviour on the wire is unchanged: `X-Objectstack-Signature` still
  carries `sha256=HMAC-SHA256(raw body, secret)` and verifies against the
  subscriber's secret exactly as before — now pinned by tests that recompute the
  HMAC over the delivered body rather than asserting a header is merely present,
  and by an at-rest guard that byte-scans every column of a real delivery table
  after a real delivery.

  Producers are unaffected: `enqueueHttp({ …, signingSecret })` keeps its shape
  for both callers (webhook fan-out and the Flow `http` node), and the fix sits at
  the outbox, so both stop writing cleartext.

  **Upgrading.** The `signing_secret` column is no longer declared, so an existing
  database keeps it as an unmapped column holding the old cleartext until it is
  dropped: run `os migrate plan` and apply the reported `drop_column` op (it is
  classified destructive, so it is never applied unattended). Until then those
  rows also age out on the table's existing 30-day telemetry retention. Rotate any
  signing secret that was exposed. Code reading `HttpDelivery.signingSecret` off a
  row should read `signature` instead — the secret is not available there by
  design.

- bbe05de: A dropped webhook subscription now leaves a durable record, and no operator action can turn that record into an unsigned delivery (#8069).

  When the auto-enqueuer cannot decrypt a webhook's signing secret or its custom header map, it drops the subscription rather than delivering unsigned (#7799, #7986). Until now the drop left no `sys_http_delivery` row at all: every matching record change was discarded with nothing an operator reading the delivery table could find. `#8043` made that loud in the logs; it did not make it durable.

  Each discarded event is now recorded as a `sys_http_delivery` row with `status: dead`, `attempts: 0`, and the cause and remedy in the existing `error` column — so it appears in the object's existing "Failures" view with no new lifecycle state and no migration.

  The record is unsendable by construction, which is the half that matters:

  - `redeliver()` refuses any terminal row with `attempts: 0`. Such a row was never sent, so re-sending it would be a **first** delivery — and a parked row carries no HMAC signature, because the secret that would have produced one is exactly what went missing. New error code `DELIVERY_NEVER_SENT` (409 on `POST /api/v1/webhooks/redeliver`).
  - `redeliver()` also consults a producer-registered guard, so a webhook row whose `sys_webhook` subscription was deleted, or whose stored signing secret can no longer be recovered, is refused rather than replayed. A guard whose own lookup fails refuses too.
  - The parked row never carries the authored header map, so a credential is not copied onto a row that will sit out the retention window without ever being sent.

  Redelivery of a genuine dead-letter is unchanged: the same bytes, the same signature.

- bf1ea92: fix(plugin-webhooks): a stored header map that cannot be recovered parks the subscription instead of arming it and delivering the headers MISSING (#8558)

  A webhook whose `sys_webhook.headers_secret` held a value that did not come back
  as a header map was treated as **authored without custom headers**. The
  subscription armed, every matching record change was delivered, and the entire
  authored map — the ordinary place an `Authorization: Bearer …` goes — was
  silently absent. Nothing logged, nothing dropped, and
  `GET /api/v1/data/sys_webhook` kept reporting `active: true` with the header
  column masked, so both the operator and the Setup UI still read "custom headers
  are configured".

  Measured end to end against a real engine, what reached the receiver was worse
  than "a delivery with something missing": the request SUCCEEDED
  (`sys_http_delivery.status = 'success'`) carrying a byte-correct
  `X-Objectstack-Signature`. The signature is the receiver's proof the request is
  genuinely ours, so a receiver that authenticates by signature had every reason
  to accept a request that no longer matched the configuration its operator wrote.
  Against an endpoint that requires the credential the result is a 401 nobody
  attributes correctly; against one that does not — a routing `X-Tenant-Id`, an
  `X-Environment: staging` — the delivery is simply wrong and nobody finds out.

  The cause was one return value carrying two facts. `resolveWebhookHeaders`
  answered `undefined` both for _"the author configured no custom headers"_ —
  legitimate, `headers` is optional on the envelope — and for _"a map is stored
  and did not come back as one"_. Its caller acts on the first reading, so the
  second became the first. This is the sibling of the signing-secret collapse
  (#8542) on the same seam's other credential, and the file's own header comment
  already promised the opposite: _"It does not deliver partially. A row whose
  stored headers cannot be resolved DROPS the subscription."_

  **This path is wider than the signing-secret one, not symmetric to it.** A
  signing secret is an opaque scalar, so any non-empty answer is a usable key and
  only the empty string collapsed. A header map's CONTENT decides, and
  `parseStoredHeaders` answers `undefined` — correctly, for its own job — for every
  string that is not a flat JSON object of string values. Four states reach the
  seam, all confirmed against a real engine:

  - the `sys_webhook` row is deleted between the enqueuer's cache read and the
    per-row dereference;
  - the column holds something that is not a `secret:` ref — reachable only
    through a write that bypasses the engine (a column edited in SQL, a dump
    restored without its `sys_secret` rows, a seed script writing at driver level);
  - the stored value decrypts to an **empty string**;
  - the stored value decrypts to a perfectly readable string that is **not a flat
    string map** — `{}`, `[]`, `{"X-Count": 5}`, a nested object, or any typo.
    This is the widest road rather than an exotic one: `headers_secret` is an
    admin-authorable field whose own description instructs the author to type a
    JSON object into it, and every one of these spellings is accepted by the
    ordinary data API, encrypted like any other value, and left behind a
    perfectly valid ref that reads back as the mask.

  The fix is at the seam, so no consumer has to re-derive the rule: presence is
  already decidable there (`headers_secret` is a map only in the plaintext — at
  the storage layer it is an ordinary scalar `secret` column, so a set map comes
  back from the generic read path as the engine's mask and an unset one as `null`),
  and stored headers that do not come back as a map now raise rather than
  answering `undefined`. They therefore reach `AutoEnqueuer.attachHeaders` exactly
  the way a throwing resolver already did — the subscription is parked, the
  discarded event lands in `sys_http_delivery` with a cause (#8069), and the
  operator gets the existing remedy-bearing say-once `error` carrying
  `INTERNAL_ERROR` / `500` (ADR-0112) and naming `headers_secret`, so it cannot be
  confused with the signing secret's identical-looking drop.

  **Unchanged:** a webhook authored with no custom headers at all still arms and
  delivers — that is a legitimate authored configuration, and it is pinned as the
  control for this change, as is a webhook whose stored map resolves normally and
  still delivers every header including the credential entry.

  **What an operator sees after upgrading.** A webhook that was quietly delivering
  without its headers stops delivering and starts reporting. Re-save the headers
  as a flat JSON object of string values so the column holds a fresh ref, or
  **clear** the field to `null` if the webhook is meant to send no custom headers
  — an empty or unparseable header map is not the same thing as no header map,
  and only the second one means "send nothing extra".

- 719a21b: fix(plugin-webhooks): a stored signing secret that cannot be recovered parks the subscription instead of arming it and delivering UNSIGNED (#8542)

  A webhook whose `sys_webhook.signing_secret` held a value that did not resolve
  was treated as **authored unsigned**. The subscription armed, every matching
  record change was delivered, and the HMAC signature — the receiver's only proof
  the delivery came from us — was silently absent. Nothing logged, nothing
  dropped, and `GET /api/v1/data/sys_webhook` kept reporting `active: true` with
  the secret column masked, so both the operator and the Setup UI still read
  "this webhook is signed".

  The cause was one return value carrying two facts. `resolveWebhookSecret`
  answered `undefined` both for _"the author configured this webhook unsigned"_ —
  legitimate, `secret` is optional on the envelope — and for _"a key is stored and
  nothing came back"_. Its caller acts on the first reading, so the second became
  the first. That is the #7799 signing invariant failing **open**, immediately
  beside two adjacent failure modes that fail closed and loudly: a resolver that
  throws, and an engine with no encrypted-field channel, both of which drop the
  subscription and report at `error`.

  Three states reach the silent path, all confirmed against a real engine:

  - the `sys_webhook` row is deleted between the dispatcher's cache read and the
    per-row dereference;
  - the column holds something that is not a `secret:` ref — reachable only
    through a write that bypasses the engine (a column edited in SQL, a dump
    restored without its `sys_secret` rows, a seed script writing at driver
    level). The engine's own write path defends the two obvious routes: an echoed
    read-mask is dropped and cleartext is re-encrypted;
  - the stored value decrypts to an **empty string** — reachable through the
    ordinary data API, which accepts `signing_secret: ""`, encrypts it like any
    other value, and leaves the column holding a perfectly valid ref.

  The fix is at the seam, so no consumer has to re-derive the rule: presence is
  already decidable there (a set secret comes back from the generic read path as
  the engine's mask, an unset one as `null`), and a stored key that does not
  resolve now raises rather than answering `undefined`. It therefore reaches
  `AutoEnqueuer.attachSecret` exactly the way a throwing resolver already did —
  the subscription is parked, the discarded event lands in `sys_http_delivery`
  with a cause (#8069), and the operator gets the existing remedy-bearing
  say-once `error` carrying `INTERNAL_ERROR` / `500` (ADR-0112).

  **Unchanged:** a webhook authored with no secret at all still arms and delivers
  unsigned — that is a legitimate authored configuration, and it is pinned as the
  control for this change. The redelivery guard (#8069) keeps its behaviour in
  both directions: a stored-but-unresolvable key is still refused with its own
  reason, and any other failure still propagates, because "we could not check"
  must never read as "allowed".

  **What an operator sees after upgrading.** A webhook that was quietly delivering
  unsigned stops delivering and starts reporting. If the deliveries were meant to
  be signed, re-save the secret so the column holds a fresh ref. If the webhook
  was meant to be unsigned, **clear** the field to `null` — an empty secret is not
  the same thing as no secret, and only the second one means "unsigned".

- e3a6f6e: fix(webhooks): the subscriber's HMAC signing secret is no longer readable from `sys_webhook` over the data API (#7799)

  `bootstrapDeclaredWebhooks` persisted the whole validated `Webhook` envelope —
  **`secret` included** — as `definition_json: JSON.stringify(wh)`, and
  `AutoEnqueuer.parseRow` read `defn.secret` straight back out to sign deliveries.
  `definition_json` is an ordinary textarea on an admin-authorable object with no
  restrictive `enable.apiMethods`, so a plain `GET /api/v1/data/sys_webhook`
  returned the key to **every persona that can read the object**. That key is the
  receiver's only proof that a delivery came from us.

  This is the remaining half of #7722, which removed the same secret's per-attempt
  copies from `sys_http_delivery`. Unlike the delivery table, no retention window
  ever aged these out.

  **What changed.** The authored key now lands in `sys_webhook.signing_secret`, a
  new `type: 'secret'` column: the engine encrypts it into `sys_secret` on write,
  keeps only an opaque `secret:<id>` ref on the row, and returns a mask on every
  read path. `definition_json` carries the same envelope **minus** `secret`. The
  auto-enqueuer recovers the plaintext server-side when it refreshes its
  subscription cache.

  **Nothing about authoring changes.** `packages/spec/src/automation/webhook.zod.ts`
  is untouched — `defineWebhook({ secret })` is written exactly as before, and the
  delivered `X-Objectstack-Signature` is byte-identical, so no receiver has to
  change anything.

  **Existing rows are migrated.** A boot sweep moves any cleartext
  `definition_json.secret` into the encrypted column — including the rows the
  seeder deliberately never rewrites (`managed_by: 'admin'`, and package rows an
  admin froze with `customized: true`), which are the ones most likely to hold a
  real production key. The sweep is idempotent and stores the encrypted copy in
  the same update that strips the blob, so a failure can never leave a webhook
  stripped _and_ unsigned. Until a row is swept, signing keeps working from the
  legacy blob and the enqueuer warns that the value is still exposed.

  **Fail-closed.** With no `ICryptoProvider` wired the engine refuses the write
  rather than storing cleartext, so a secret-bearing webhook is skipped — and a
  legacy row is left intact — with an actionable log line carrying an ADR-0112
  `code`/`status` pair. It is never seeded with an exposed key in a new column.

  Also adds `ObjectQL.resolveSecretField(object, recordId, field)` — the privileged,
  driver-level dereference of one row's `secret`-typed field. `resolveSecret()` was
  already documented for "privileged consumers … against the stored ref", but the
  read mask meant no consumer could obtain that ref; this is why the webhook key
  can live in the encrypted channel at all. It refuses any field not declared
  `type: 'secret'`, so it cannot become a mask bypass over a `password` field
  (plaintext at rest by design — ADR-0100).

- c95ac80: chore(plugin-webhooks): drop the dead sys_webhook_delivery i18n blocks

  `sys_webhook_delivery` was removed from `@objectstack/plugin-webhooks` when
  outbound delivery moved to `@objectstack/service-messaging` (`sys_http_delivery`,
  ADR-0018 M3), but its translation blocks lingered in all four generated locale
  bundles (en / zh-CN / ja-JP / es-ES) — loaded at runtime yet referenced by
  nothing, since the object no longer exists in this plugin.

  - Removed the `sys_webhook_delivery` node from each `*.objects.generated.ts`
    bundle; `WebhooksTranslations` now carries only `sys_webhook`.
  - Corrected the stale ownership comment on `SysWebhook` that still named
    `sys_webhook_delivery` as a live sibling.

  (The dangling `SysWebhookDelivery` import in `scripts/i18n-extract.config.ts`
  was fixed independently on `main` by #3489, so it is not part of this change.)

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
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
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
- Updated dependencies [b746aa0]
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
- Updated dependencies [c519533]
- Updated dependencies [f9a5c59]
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
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
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
- Updated dependencies [a8dcc37]
- Updated dependencies [040ecd2]
- Updated dependencies [932d7e2]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [f1850d8]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [17d0954]
- Updated dependencies [f28ef3b]
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
- Updated dependencies [d0d5205]
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
- Updated dependencies [be7360c]
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
- Updated dependencies [857a6cf]
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
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [9c90ea0]
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
- Updated dependencies [ee264b2]
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
- Updated dependencies [7e4783f]
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
- Updated dependencies [06306f1]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/service-messaging@17.0.0

## 17.0.0-rc.6

### Patch Changes

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

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
- Updated dependencies [f9a5c59]
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
- Updated dependencies [f586f1a]
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
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [932d7e2]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [f1850d8]
- Updated dependencies [eb91eba]
- Updated dependencies [17d0954]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
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
  - @objectstack/service-messaging@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

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
  - @objectstack/service-messaging@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

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
- Updated dependencies [b746aa0]
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
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
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
- Updated dependencies [9c90ea0]
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
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/service-messaging@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- f2445c9: feat(spec,objectql,client,plugin-webhooks): predicate writes get an honest bulk event contract (#4639)

  A `multi: true` update/delete reaches `IDataDriver.updateMany` / `deleteMany`,
  which are contracted to resolve an affected row COUNT and nothing else. That
  satisfies neither `DataEvent.recordId` (required) nor `before` / `after` /
  `changes`, so before #4626 the engine fabricated a per-record event with
  `recordId: ''` and `after: <count>` — an event every schema-compliant consumer
  must reject, and one the webhook enqueuer's `?? 'unknown'` fallback turned into
  a real delivery naming an unidentifiable record. #4626 removed the fabrication
  and published nothing instead: honest, but it left webhooks, knowledge sync and
  `subscribeData` silent for every predicate write.

  Bulk writes now get their **own** contract rather than impersonating a
  per-record one or going dark:

  - **New `BulkDataEvent`** (`@objectstack/spec/api`): `data.records.updated` /
    `data.records.deleted` — note the plural — carrying `id`, `type`, `object`,
    `matched`, `userId?`, `timestamp`. Deliberately a separate schema from
    `DataEvent`, not a widened one: a consumer that receives
    `data.records.updated` knows from the type alone that no `recordId` is
    coming, instead of discovering an empty string at runtime.
  - **Engine** publishes it from the `multi: true` branches of `update()` /
    `delete()`, validated with `BulkDataEventSchema.parse` before publish. A
    predicate that matched **zero** rows publishes nothing (no data changed — this
    is what keeps an idle background sweep from becoming an hourly "0 records"
    delivery), and a driver that resolves a non-count publishes nothing and warns
    rather than asserting a number it cannot verify. Per-record writes are
    untouched, including a scalar `where.id` with `multi: true`, which is still a
    single-record target and still emits `data.record.deleted`.
  - **Webhooks**: two new opt-in triggers, `bulk_update` and `bulk_delete`
    (`WebhookTriggerType`, and the `sys_webhook.triggers` multi-select). They are
    **not** extra sources for `create` / `update` / `delete`: the delivered body
    has no `recordId` and no record, so routing it to existing per-record
    subscribers would hand them a payload missing every field they read — the
    same class of breakage as the old `recordId: ''`, from the other direction. A
    webhook that wants both subscribes to both. Bulk deliveries dedup on the
    producer's event uuid, since two sweeps in the same millisecond are genuinely
    different events that a timestamp-based key would collapse.
  - **Client SDK**: new `client.events.subscribeBulkData(object, cb)`, with the
    same loud boundary validation as `subscribeData`. Kept a separate method for
    the same reason — delivering a `BulkDataEvent` to a `(event: DataEvent) =>
void` callback would recreate exactly the "typed field, `undefined` at
    runtime" defect #4626 removed. `subscribeData`'s own guard was also tightened
    from `data.` to `data.record.`, so an aggregate event is ignored rather than
    rejected as off-contract.
  - **Knowledge sync** now says out loud that a predicate write leaves its index
    stale. A knowledge index is a per-record projection and `matched: 40` names no
    record, so no event shape could drive it — the durable fix is reconciliation,
    tracked in #4672.

  The event carries no `where` predicate. The only one available at publish time
  is the middleware-composed AST, whose filter embeds the security layer's
  injected row scoping (RLS, sharing) — publishing it would ship tenant scoping
  internals to whatever external URL a webhook points at.

  Also pays off a measurement debt from #4655, which claimed the write-path cost
  of event publishing had been measured but never published the numbers:
  `packages/objectql/src/engine-data-events.bench.ts` measures it. Against an
  in-memory driver, publishing costs ~7–9µs per event (insert 0.021ms vs 0.012ms,
  single-id update 0.013ms vs 0.007ms). A bulk write pays that **once** regardless
  of how many rows matched (0.040ms vs 0.034ms over a 100-row match set), so its
  relative cost shrinks as the match set grows.

### Patch Changes

- 257d97a: ADR-0078 Phase 4, decided rather than deferred: the silent skips stop being silent at runtime. The registry — the one choke point every metadata door goes through — now emits a functional-completeness diagnostic at registration, and the webhook enqueuer's zero-trigger skip warns instead of returning `null` wordlessly.

  **The Phase 4 ruling.** The phase had two halves, and they got opposite verdicts:

  - **Generative rule sweep: rejected — not deferred.** A generator can enumerate candidates ("which optional keys might be load-bearing?") but cannot verify runtime skip sites, and a rule without its skip-site citation is a false prescription — this campaign shipped four of those and every one was caught by the verification pass a generator would skip. The route is structurally wrong; no amount of waiting produces the evidence that would fix it.
  - **Registration-time diagnostics: built now.** The evidence was already in hand, not pending: #3896 (Setup authoring inserted `sys_sharing_rule` rows directly, bypassing the schema that "required" `criteria`) and cloud's `rowColor.mapping` (an `as never` cast bypassed tsc) prove that doors which skip Zod and lint are real. The author-time gate only protects metadata that passes through `os build` / `validate` / `lint`; `SchemaRegistry.registerObject` is where _every_ door converges — declared stacks, plugin objects, `extend` contributions, `saveMetaItem`, raw `registerObject` calls.

  **Same predicate, same rule ids, different posture.** The registry calls the same `checkFieldCompleteness` that `validate-functional-completeness` uses, so the boot log carries the _same rule ids_ the lint reports (`field/summary-without-operations`, …) — an operator or an AI reading the log greps the id straight into the same docs and suppression story. But the registry **warns and never throws**: ADR-0078 §1's error severity means _the instance is dead_, not _the system is dead_ — an inert field must not kill a boot that thousands of healthy objects share. Errors block at author time; the registry's job is to make sure the silence never survives to runtime unobserved.

  One line per object with every finding aggregated (not per request — the hot path stays free; not per finding — a three-dead-field object is one greppable line). Follows `warnStrippedLegacyApiMethods` (#3543) exactly: module-level once-per-object dedup, injectable `warn`, pure observation that never mutates the schema.

  **The webhook skip now names itself.** `auto-enqueuer.ts`'s `if (triggers.size === 0) return null` sat under a comment blessing the empty case as "a manual-only webhook" — a mode #3196 removed (no manual fire path exists). The skip now warns with the author-time rule id (`webhook/without-triggers`), and the comment tells the truth. Only _active_ rows reach the parse (`where: { active: true }` — verified, not assumed), so a deliberately disabled webhook stays warning-free.

  **Scope honesty:** field rules and the webhook rule get the runtime twin. `view/layout-without-binding` stays author-time-only — views don't register through this choke point and the renderer half of the evidence lives in objectui.

  Tracked in #4544. This closes the ADR-0078 loop end to end: author-time error, runtime warning, one shared predicate deciding both.

- 462b713: fix(objectql,client): `subscribeData` callbacks receive real `DataEvent`s — the producer now fulfils the declared contract (#4626)

  `@objectstack/spec/api`'s `DataEvent` declares top-level `id` (uuid,
  required), `type`, `object`, `recordId` (required), `changes?`, `before?`,
  `after?`, `userId?`, `timestamp`. But the producer (the ObjectQL engine)
  published a raw `RealtimeEventPayload` envelope with `{ recordId, after,
changes }` nested under `payload` and never generated `id`/`userId`, while the
  client SDK force-cast that envelope into the callback (`callback(event as any
as DataEvent)`). Subscribers who wrote `event.recordId` / `event.changes` —
  exactly what the types promised — compiled green and read `undefined` at
  runtime. The data-side twin of #4602.

  Producer now fulfils the contract:

  - `ObjectQL.insert()` / `update()` / `delete()` build a true `DataEvent`
    (generated uuid `id`, flattened top-level fields, `userId` from the
    execution context when the write names an actor) and validate it with
    `DataEventSchema.parse` before publishing. The transport envelope is
    unchanged (`RealtimeEventPayload`, with `payload` carrying the complete
    `DataEvent`), so subscribers keep receiving `{ type, object, payload,
timestamp }` on the wire.
  - A batch insert publishes one event **per record** (as before), each with its
    own event id.
  - **A multi-row write (`multi: true` → `updateMany` / `deleteMany`) now
    publishes nothing.** Those driver methods return only an affected count, so
    there is no record for a required `recordId` to name; the engine logs a
    warning naming the gap instead of publishing the previous fabrication
    (`recordId: ''`, `after: <affected count>`), which every schema-compliant
    consumer had to reject. **Consequence: webhooks and knowledge sync no longer
    fire for bulk writes** — they previously fired once with an unusable body. A
    real bulk event contract is tracked in #4639.

  Consumers validate or read the fulfilled shape instead of guessing:

  - `@objectstack/client`'s `subscribeData` (and therefore
    `@objectstack/client-react`'s `useDataSubscription` /
    `useDataSubscriptionCallback` / `useAutoRefresh`, which delegate to it)
    unwraps the envelope and runs `DataEventSchema.safeParse` at the boundary.
    An off-contract payload is rejected loudly (handler error, callback never
    invoked) — never coerced or passed through. The `as any as DataEvent`
    double-cast is gone, and the `recordId` option now filters on the fulfilled
    event.
  - `@objectstack/plugin-webhooks`' auto-enqueuer reads the required
    `recordId` directly; its `recordId ?? id ?? after?.id ?? before?.id ??
'unknown'` fallback chain is gone, and an off-contract event is dropped with
    a warning rather than delivered under the literal id `'unknown'`. Delivered
    webhook bodies now also carry the event's `id`/`type`/`userId`; the record
    itself stays nested under `after` and the envelope keys (`object`,
    `recordId`, `action`, `timestamp`) still win.
  - `@objectstack/service-knowledge`'s event sync reads the record from `after`
    (create/update) and the id from `recordId` (delete) for `data.record.*`.
    It previously indexed the envelope itself as if it were the row, and never
    resolved an id for deletes.

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
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [040ecd2]
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
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/service-messaging@17.0.0-rc.2

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

- a225ef5: fix(runtime,webhooks): the path object wins on /data/:object/query, and the webhook envelope owns its keys (#3946)

  Follow-up sweep for the shape behind #3897 and #3933 — a trusted, server-derived
  value written into an object literal with a caller-controlled bag spread OVER
  it. Both of those were in the same block of REST code, so the pattern was swept
  across all 1313 non-test TypeScript files in `packages/`. Nine candidate sites;
  one real, one worth hardening, seven verified clean (recorded in #3946 so the
  next sweep does not re-litigate them).

  **`POST /data/:object/query` (runtime dispatcher).** The `/data` domain built
  `{ object: objectName, ...body }`, so `{"object":"other", …}` in the body moved
  the read to a different object than the URL named.

  This is NOT an authorization bypass, and the tests pin why: `callData` gates
  API exposure on `params.object`, so the gate followed the body and agreed with
  the read — an object hidden by `apiEnabled: false` was refused either way. What
  broke is that the URL stopped describing the operation (audit trails, logs, and
  anything keyed on the request path saw object A while object B was read), and
  that one endpoint spoke a second dialect of the contract the REST side had just
  standardised on: the path object wins. The other handlers in that file never had
  the problem — they nest caller data (`data: body`, `query: normalized`) instead
  of splatting it, and the GET-by-id branch already allowlists its query params
  against exactly this pollution.

  **Webhook delivery envelope.** `auto-enqueuer` built
  `{ object, recordId, action, timestamp, ...payload }`, letting an event payload
  rewrite the envelope a subscriber receives. Behaviour-neutral for the engine's
  own publishers — `data.record.*` payloads are `{ recordId, after, changes }`
  with record fields nested under `after`, so none of those four keys collide
  today — but the shape was wrong, and the `payload.id` fallback right above it
  suggests publishers that flatten record fields do exist. Envelope keys are
  written last now.

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

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

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
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [a8dcc37]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
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
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/service-messaging@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 69f1dfd: fix(webhooks): materialize stack-declared webhooks into the dispatcher (#3461)

  A webhook authored declaratively — `defineStack({ webhooks })` / `defineWebhook()`,
  validated against the spec `WebhookSchema` — was a **silent no-op**. The runtime
  dispatcher (`AutoEnqueuer`) fans out off `sys_webhook` DATA rows (`object_name` /
  `active`), which until now were only ever written by hand through the object's
  CRUD UI. Nothing turned a declared webhook (`object` / `isActive`) into a
  dispatchable row, so authoring `webhooks:` on a stack produced `webhook` metadata
  that never fired (ADR-0078). The showcase app itself shipped a `webhooks:` entry
  that did nothing.

  `@objectstack/plugin-webhooks` now bridges the two on boot:

  - **`bootstrapDeclaredWebhooks`** reads declared `webhook` metadata from the
    ObjectQL registry (where the manifest decomposition already parks
    `stack.webhooks`), validates each through `WebhookSchema.parse()` — the spec
    schema finally has a real consumer — and materializes it into a `sys_webhook`
    row, mapping `object → object_name`, `isActive → active`, and stashing the full
    envelope (headers / secret / retry / timeout) in `definition_json`. The
    auto-enqueuer's first cache refresh then picks the row up and dispatches it.
  - **Seed-not-clobber provenance** (mirrors `sys_sharing_rule`, #2909): `sys_webhook`
    gains `managed_by` / `customized` columns. Declared webhooks re-seed every boot
    as `managed_by: 'package'`, but a row an admin created (`managed_by: 'admin'`) or
    edited in Setup (`customized: true`, stamped by a `beforeUpdate` hook) is never
    overwritten — a deactivated noisy webhook survives redeploys.

  Connector-declared `webhooks` remain not-yet-enforced (that is a separate seam,
  #3197). Registering `webhook` as a first-class metadata type + enrolling it in the
  liveness `GOVERNED` set is a tracked follow-up.

  Migration: none required. Existing hand-authored `sys_webhook` rows default to
  `managed_by: 'admin'` and are never touched by the seeder. Anyone who authored
  `webhooks:` on a stack expecting it to fire will find it now does — review those
  declarations (especially `url` / `isActive`) before upgrading.

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

- 52281b0: chore(i18n): purge the dead sys_webhook_delivery translation block and guard against recurrence

  `sys_webhook_delivery` was removed when webhook delivery moved to
  `@objectstack/service-messaging` (`sys_http_delivery`, ADR-0018 M3), but a full
  translation block for it lingered in the four generated plugin-webhooks i18n
  bundles (en/zh-CN/ja-JP/es-ES) — dead weight bound to an object that no longer
  exists, and destined to be dropped silently (with any curated strings) on the
  next `os i18n extract`.

  - Removed the stale `sys_webhook_delivery` block from all four locale bundles
    (surgical; the `sys_webhook` block is untouched).
  - Corrected three stale `sys_webhook_delivery` doc comments (platform-objects
    `integration/index.ts` + `setup.app.ts`, plugin-webhooks `sys-webhook.object.ts`)
    that still named it as a plugin-webhooks-owned object.
  - Rolled out the platform-objects `bundle-ownership` test guard (#2834 ⑤ /
    ADR-0029 D8) to the eight packages that own i18n bundles, so a stray object
    block in a generated bundle now fails the build instead of dying silently.
  - That guard immediately surfaced a live-object omission: `sys_capability` was
    present in plugin-security's bundles with curated translations but had been
    dropped from its extract config — re-added to the config so the strings are
    preserved, rather than deleted.

- c95ac80: chore(plugin-webhooks): drop the dead sys_webhook_delivery i18n blocks

  `sys_webhook_delivery` was removed from `@objectstack/plugin-webhooks` when
  outbound delivery moved to `@objectstack/service-messaging` (`sys_http_delivery`,
  ADR-0018 M3), but its translation blocks lingered in all four generated locale
  bundles (en / zh-CN / ja-JP / es-ES) — loaded at runtime yet referenced by
  nothing, since the object no longer exists in this plugin.

  - Removed the `sys_webhook_delivery` node from each `*.objects.generated.ts`
    bundle; `WebhooksTranslations` now carries only `sys_webhook`.
  - Corrected the stale ownership comment on `SysWebhook` that still named
    `sys_webhook_delivery` as a live sibling.

  (The dangling `SysWebhookDelivery` import in `scripts/i18n-extract.config.ts`
  was fixed independently on `main` by #3489, so it is not part of this change.)

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
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/service-messaging@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/service-messaging@16.1.0

## 16.0.0

### Patch Changes

- 4b6fde8: Trim the dead `undelete` and `api` webhook triggers (#3196). `WebhookTriggerType` declared five triggers but only three ever fired:

  - `undelete` had no event source — the engine has no soft-delete/restore capability (`delete` is a hard delete; no `deleted_at` convention, no restore operation, and `data.record.undeleted` is never emitted). The `undeleted` case in the auto-enqueuer's action mapper was dead code awaiting a producer that doesn't exist.
  - `api` ("manually triggered") had no fire path — the only webhook HTTP surface re-queues already-failed deliveries; nothing originates a manual fire.

  Both are removed from the enum (contract-first, matching #3184/#3195): authoring a webhook on a removed trigger now fails loudly at `os validate` / registration instead of registering a webhook that silently never fires. No shipped webhook metadata used either. The auto-enqueuer now also warns when a persisted `sys_webhook` row carries a trigger it can't map to an emitted record event (a drift-guard, so a dead trigger can't silently no-op again). Reintroduce `undelete` only alongside a real restore subsystem, and `api` only alongside a real manual-fire endpoint. Updated the `sys_webhook` trigger options, field help (all locales), docs, and reference; added rejection tests.

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
  - @objectstack/service-messaging@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/service-messaging@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 4b6fde8: Trim the dead `undelete` and `api` webhook triggers (#3196). `WebhookTriggerType` declared five triggers but only three ever fired:

  - `undelete` had no event source — the engine has no soft-delete/restore capability (`delete` is a hard delete; no `deleted_at` convention, no restore operation, and `data.record.undeleted` is never emitted). The `undeleted` case in the auto-enqueuer's action mapper was dead code awaiting a producer that doesn't exist.
  - `api` ("manually triggered") had no fire path — the only webhook HTTP surface re-queues already-failed deliveries; nothing originates a manual fire.

  Both are removed from the enum (contract-first, matching #3184/#3195): authoring a webhook on a removed trigger now fails loudly at `os validate` / registration instead of registering a webhook that silently never fires. No shipped webhook metadata used either. The auto-enqueuer now also warns when a persisted `sys_webhook` row carries a trigger it can't map to an emitted record event (a drift-guard, so a dead trigger can't silently no-op again). Reintroduce `undelete` only alongside a real restore subsystem, and `api` only alongside a real manual-fire endpoint. Updated the `sys_webhook` trigger options, field help (all locales), docs, and reference; added rejection tests.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
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
  - @objectstack/service-messaging@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/service-messaging@15.1.1

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
  - @objectstack/core@15.1.0
  - @objectstack/service-messaging@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/service-messaging@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/service-messaging@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Minor Changes

- f344ee1: Webhook form: pick, don't type. The `sys_webhook` create/edit form made admins
  hand-type machine data in three fields; they're now proper controls (extends the
  `sys_sharing_rule` pass):

  - `method` — free text → **select** (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`). Option
    values are lowercased by `Field.select`; the auto-enqueuer now upper-cases the
    resolved method before delivery, so legacy `'POST'` rows and the new lowercase
    values both normalise to a canonical HTTP method.
  - `triggers` — hand-typed comma-separated string → **multi-select**
    (`create`/`update`/`delete`/`undelete`/`api`). Stored as an array; the
    auto-enqueuer's `parseRow` now accepts array, JSON-encoded-array-string, and
    the legacy comma-separated forms, so existing subscriptions keep firing.
  - `object_name` — free text → the **`object-ref`** object picker (same widget as
    `sys_sharing_rule`; degrades to a text input where the widget isn't loaded).

  Backward compatible: no data migration required. Added tests covering the array
  and JSON-string trigger shapes.

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/service-messaging@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/service-messaging@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/service-messaging@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/service-messaging@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/service-messaging@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/service-messaging@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/service-messaging@14.1.0

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
  - @objectstack/core@14.0.0
  - @objectstack/service-messaging@14.0.0

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
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/service-messaging@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/service-messaging@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/service-messaging@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/service-messaging@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/service-messaging@12.3.0

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
  - @objectstack/service-messaging@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/service-messaging@12.1.0

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
  - @objectstack/core@12.0.0
  - @objectstack/service-messaging@12.0.0

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
  - @objectstack/service-messaging@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/service-messaging@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/service-messaging@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/service-messaging@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/service-messaging@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/service-messaging@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/service-messaging@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/service-messaging@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/service-messaging@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/service-messaging@11.1.0

## 11.0.0

### Patch Changes

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
  - @objectstack/service-messaging@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [6d3bf54]
  - @objectstack/service-messaging@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/service-messaging@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/service-messaging@10.1.0

## 10.0.0

### Patch Changes

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
  - @objectstack/service-messaging@10.0.0

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
  - @objectstack/service-messaging@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/service-messaging@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/service-messaging@9.9.1

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
  - @objectstack/service-messaging@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/service-messaging@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/service-messaging@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/service-messaging@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/service-messaging@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [f19caef]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/service-messaging@9.5.0
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
  - @objectstack/service-messaging@9.4.0

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
  - @objectstack/core@9.3.0
  - @objectstack/service-messaging@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/service-messaging@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/service-messaging@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/service-messaging@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/service-messaging@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/service-messaging@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [9f311f8]
- Updated dependencies [c70eec1]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/service-messaging@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/service-messaging@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/service-messaging@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/service-messaging@7.7.0

## 7.6.0

### Minor Changes

- 11905fa: ADR-0018 M3 (Phase 5): `plugin-webhooks` now delivers through the shared
  `service-messaging` HTTP outbox instead of its own.

  The webhook delivery substrate — durable outbox, cluster-coordinated dispatcher,
  retry/backoff/dead-letter, retention — is removed from `plugin-webhooks` and
  replaced by the generic `sys_http_delivery` outbox + `HttpDispatcher` in
  `@objectstack/service-messaging`. Webhooks keep only their domain concerns: the
  `sys_webhook` config object, the `AutoEnqueuer` (now enqueues `source: 'webhook'`
  rows via `messaging.enqueueHttp`), and the redeliver admin endpoint (now backed
  by `messaging.redeliverHttp`).

  **`@objectstack/service-messaging`:** `MessagingService` gains `redeliverHttp(id)`
  and `listHttp(filter)` over the HTTP outbox.

  **`@objectstack/plugin-webhooks` — BREAKING:**

  - Now **requires** `MessagingServicePlugin` (declared as a plugin dependency).
  - Removed exports: `WebhookDispatcher`, `MemoryWebhookOutbox`, `SqlWebhookOutbox`
    (and the `./sql` subpath), `DeliveryRetentionSweeper`, `hashPartition`,
    `sendOnce` / `classifyAttempt` / `nextRetryDelayMs`, and the `IWebhookOutbox` /
    `WebhookDelivery` / `EnqueueInput` / `AckResult` / `RedeliverError` types.
  - Removed the `sys_webhook_delivery` object — webhook deliveries are now rows in
    `sys_http_delivery` (`source = 'webhook'`). The Setup nav points there.
  - `AutoEnqueuer`'s constructor takes an `HttpEnqueueFn` instead of an
    `IWebhookOutbox`.
  - `WebhookOutboxPluginOptions` reduced to `{ autoEnqueue }` (dispatcher / outbox /
    retention / nodeId options removed — those now live on `MessagingServicePlugin`).

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [11905fa]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [60f9c45]
  - @objectstack/service-messaging@7.6.0
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/platform-objects@7.5.0
- @objectstack/service-cluster@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/platform-objects@7.4.1
- @objectstack/service-cluster@7.4.1

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

### Patch Changes

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
  - @objectstack/service-cluster@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/service-cluster@7.3.0
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
  - @objectstack/service-cluster@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0
- @objectstack/service-cluster@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/service-cluster@7.1.0

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
  - @objectstack/service-cluster@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0
- @objectstack/service-cluster@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1
- @objectstack/service-cluster@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/service-cluster@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1
- @objectstack/service-cluster@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/service-cluster@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0
  - @objectstack/service-cluster@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/platform-objects@6.5.1
- @objectstack/service-cluster@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0
- @objectstack/service-cluster@5.1.8

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0
  - @objectstack/service-cluster@5.1.7

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0
- @objectstack/service-cluster@5.1.6

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0
  - @objectstack/service-cluster@5.1.5

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1
- @objectstack/service-cluster@5.1.4

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0
  - @objectstack/service-cluster@5.1.3

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/service-cluster@5.1.2

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/service-cluster@5.1.1
