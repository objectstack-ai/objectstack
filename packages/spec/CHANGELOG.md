# @objectstack/spec

## 17.0.0-rc.0

### Major Changes

- e2616e0: feat(spec,lint)!: remove `agent.tools[]`, lint agent authoring, and resolve `action_<name>` only when it actually materialises (#3820, ADR-0109 accepted)

  **Breaking — `agent.tools[]` is removed.** ADR-0064's central invariant is
  "an agent's tool set is the union of its surface-compatible skills' tools;
  nothing falls through to the global registry", and this legacy inline slot
  was the one seam that broke it: the runtime resolved `agent.tools[].name`
  against the **full** tool registry with no surface check, so an `ask`-surface
  agent could name an authoring tool and get it. Removing the field makes the
  invariant structural — there is no second slot to disagree with the skills —
  rather than a rule every reader has to remember (ADR-0049 "design+enforce or
  remove"). `AIToolSchema` / the `AITool` type go with it.

  _Migration:_ attach capability through `skills`. An agent authoring `tools` is
  not a parse error — Zod strips the unknown key — so existing stacks keep
  parsing, but the slot no longer does anything.

  **`validate-ai-tool-references` now models AI exposure.** The rule previously
  resolved `action_<name>` against every declared action. The runtime is far
  stricter (ADR-0011): it materialises a tool only when the action opts in with
  `ai.exposed: true` + `ai.description` **and** has a headless path (type
  `script`/`api`/`flow` with a target or body — `url`/`modal`/`form` are
  UI-only). Resolving against all actions therefore blessed references the agent
  could never call — the exact failure the rule exists to catch. Unresolved
  `action_*` references now get their own message and fix, since "the action
  isn't exposed" and "the name is fictional" need different answers.

  **New rule `validate-ai-agent-authoring`** (`agent-authoring-withdrawn`,
  warning): flags a stack that declares `stack.agents`. Tenant/app-package
  agents were withdrawn in ADR-0063 §2 — the runtime filters them from the
  catalog and refuses to load them — but `defineStack` still accepted the array,
  so an app could ship agents that parse, validate, and never run. This is the
  authoring-time signal that was missing (ADR-0078: loud at the producer,
  tolerant at the consumer). Joins `REFERENCE_INTEGRITY_RULES`.

  ADR-0109 is now **Accepted — implemented (Phase 1)**, and the AI docs teach
  the zero-tool-record default path, including the three conditions that decide
  whether `action_<name>` exists and why a `modal` action staying human-driven
  is a design answer rather than a gap.

- 8b9d71e: feat(client,spec)!: the SDK's `ai` namespace now expresses the AI surface that exists (#3718)

  `client.ai` and the AI service were **disjoint sets**. The namespace held three
  methods — `nlq`, `suggest`, `insights` — whose URLs no repo has ever mounted
  (removed in v17), while `service-ai` mounted 12 routes the SDK could not reach
  at all. v17 closed the first half by deleting the dead methods. This closes the
  second: the SDK now reaches every route that is meant to be tenant API surface.

  | SDK                                                         | Route                                                                             |
  | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
  | `ai.chat(request)`                                          | `POST /api/v1/ai/chat` — forces `stream: false`, so the JSON mode is what you get |
  | `ai.chatStream(request)`                                    | `POST /api/v1/ai/chat` — `AsyncIterable` of UI Message Stream frames              |
  | `ai.complete(request)`                                      | `POST /api/v1/ai/complete`                                                        |
  | `ai.models()`                                               | `GET /api/v1/ai/models` — the ADR-0028 plan-filtered picker list                  |
  | `ai.conversations.create/list/get/update/delete/addMessage` | the six `/api/v1/ai/conversations` routes                                         |

  `ai.chatStream` returns a promise for an async iterable rather than being an
  async generator, so the request is issued — and an HTTP error thrown — when you
  call it, not when you first iterate.

  **Where the server is.** `service-ai` is a Cloud/EE package in the `cloud`
  repo; this repo only proxies `/api/v1/ai/**` and 404s `AI service is not
configured` without it. Check `discovery.services` before calling, exactly as
  for any other plugin-provided namespace. For a React chat UI, `useChat()`
  (`@ai-sdk/react`) is still the better client — it speaks the same protocol
  `ai.chatStream` parses and owns message state; these methods are for callers
  that are not components.

  **Breaking — the spec's dead AI declarations are retired.** All three had no
  implementation anywhere and no runtime consumer:

  - `Ai{Nlq,Suggest,Insights}{Request,Response}[Schema]` → replaced by the wire
    shapes of the real routes: `AiChat{Request,Response}`, `AiStreamChunk`,
    `AiCompleteRequest`, `AiModelsResponse`, `AiConversation`, `AiMessage`,
    `{Create,List,Update}AiConversation*`. The six retired JSON Schemas are
    dropped from `json-schema.manifest.json` (deliberate retirement, #2978).
  - `DEFAULT_AI_ROUTES` → deleted, and `getDefaultRouteRegistrations()` returns 8
    groups instead of 9. It declared the three phantom endpoints and had no
    runtime consumer; re-declaring the real ones here would recreate the same
    illusion, since they are mounted from another repo.
  - `AiProtocol` (`aiNlq?` / `aiSuggest?` / `aiInsights?`) → deleted. Nothing
    implemented it and nothing dispatched through it. The real server contract is
    `IAIService` + `IAIConversationService` in `@objectstack/spec/contracts`.

  **The guard.** `/api/v1/ai/` becomes a bounded prefix exemption in the capstone
  (#3642) alongside the control plane — bounded from both ends: only `ai.*` may
  use it, and the namespace must still be reaching it. That is not a
  wave-through. The reachability check lives where the routes are:
  `cloud`'s `packages/service-ai/src/ai-route-ledger.conformance.test.ts` reads
  the table `buildAIRoutes()` returns and drives this SDK against it, so an
  `ai.*` URL that stops resolving fails a test in the repo that mounts it. The
  wildcard-only bound stays **0** — these URLs never touch the `* /ai/**` row,
  which is what certified three dead methods for years.

  The four replaced client tests are worth naming: they mocked `fetch` and
  asserted the URL the client _built_, never that anything answered it, and
  passed for years against endpoints that did not exist. The new ones assert only
  what this repo can honestly know — verb, path, and the body decisions the SDK
  makes for you (`stream: false` on `chat`, the 204 on `delete`, SSE frame
  parsing) — and leave "does it resolve" to the ledger next to the routes.

- e47b342: feat!: require Node.js 22 — promise the runtime we actually test (#3825)

  Every published package declared `engines.node: ">=18.0.0"`. **Node 18 reached
  end-of-life on 2025-04-30 and Node 20 on 2026-04-30**, so the compatibility
  promise covered two runtimes nobody patches — and, after #3830 moved CI to Node
  22, two runtimes nothing in this repo verifies.

  That left the promise and the evidence with **no overlap at all**:

  |                                                                                                 | Node version |
  | ----------------------------------------------------------------------------------------------- | ------------ |
  | What CI validates every PR on                                                                   | **22**       |
  | What `release.yml` publishes from                                                               | **22**       |
  | What every shipped Docker image runs (`docker/Dockerfile`, `blank` template, self-hosting docs) | **22**       |
  | What `engines.node` promised users                                                              | **>=18**     |

  `engines.node` is now `>=22.0.0` across all 50 manifests. This is the honest
  floor: it is the only runtime the packages are built, tested and shipped on.

  ## Migration

  **If you are on Node 22 or newer, nothing changes.** Node 24 (Active LTS since
  2025-10-28) and Node 26 both satisfy the new range.

  If you are on Node 18 or 20, upgrade to Node 22+. Both are past end-of-life and
  receive no security patches:

  ```bash
  nvm install 22 && nvm use 22
  ```

  npm and pnpm surface an unsatisfied `engines` as an **`EBADENGINE` warning**, not
  a hard failure, so an existing install will not break the moment you upgrade —
  but the package is no longer tested on that runtime, and the failures are the
  kind that do not announce themselves. #3812 is the worked example: a native
  dependency whose `engines` required a newer Node loaded anyway on the older one
  and then killed the test worker at the process level, with no JS error and a
  summary that still said "passed".

  If your CI pins Node, pin it to 22 as well — running your gates on a runtime
  your dependencies no longer support is exactly the split this change closes.

  ## Also updated

  The "Node 18+" prerequisite was restated in ten user-facing places
  (`README.md`, `CONTRIBUTING.md`, the getting-started and deployment docs, the
  todo example, and the `objectstack-platform` skill's `compatibility` field).
  All now say 22. Changelogs and ADRs are historical records and were left alone.

- 4ed7ed4: feat(security)!: the export axis is now OPT-IN, explainable, and covers reports (#3544, #3710)

  **BREAKING — `allowExport` unset no longer means "inherit read".** Reading a
  record and taking a bulk machine-readable copy of the whole table are different
  privileges (Salesforce "Export Reports", Dynamics "Export to Excel", NetSuite
  "Export Lists", SAP `S_GUI` 61 all separate them). The axis now says so.

  ### Migration — FROM → TO

  |                      | before                              | after                      |
  | -------------------- | ----------------------------------- | -------------------------- |
  | `allowExport` unset  | export **allowed** (inherited read) | export **denied**          |
  | `allowExport: false` | export denied                       | export denied (unchanged)  |
  | `allowExport: true`  | export allowed                      | export allowed (unchanged) |

  **The one-line fix:** add `allowExport: true` to the object entry (or the `'*'`
  wildcard) of every permission set whose holders should keep exporting.

  ```ts
  objects: {
    deal: { allowRead: true, allowExport: true },   // ← add the grant
  }
  ```

  Nothing else changes: read, CRUD, RLS, FLS and sharing are untouched, and a set
  that never exported is unaffected.

  **Who is affected.** Package-shipped sets are re-seeded on upgrade, so the
  built-ins are handled for you — `admin_full_access` and `organization_admin` now
  carry `allowExport: true` explicitly. **Environment-authored sets are not**: any
  custom set whose users export must be edited. `member_default` deliberately does
  NOT carry the grant, so ordinary authenticated users lose export until an admin
  grants it — that is the point of the flip, not an oversight.

  **Merge semantics.** Most-permissive, exactly like the CRUD bits: any set
  granting `true` grants export. `false` and unset are the same outcome; `false`
  is authoring intent, not a veto, because permission sets are additive capability
  containers (ADR-0090).

  **Not implied by super-user bits.** `viewAllRecords` / `modifyAllRecords` no
  longer confer export. Separating "may see all data" from "may take a bulk copy"
  is the segregation-of-duties case the axis exists for.

  ### Also in this change

  - **spec** — a set carrying `allowExport` is now **high-privilege**
    (`describeHighPrivilegeBits`), so it cannot be bound to the `everyone` /
    `guest` audience anchors. Without this the opt-in was defeatable by binding an
    export-granting set to `everyone`. One predicate, so the runtime anchor gate,
    the `@objectstack/lint` security-posture rule and the install-time suggestion
    surface all pick it up together.
  - **spec / plugin-security** — `ExplainOperationSchema` gains `export`, so
    `explain` can answer _why_ a caller got `403 EXPORT_NOT_PERMITTED`. It
    explains as `read ∧ the export grant`: `object_crud` reports the conjunction
    and attributes the granting set, while every data-shaped layer
    (requiredPermissions, OWD/depth/sharing, RLS, record attribution) is computed
    as the `find` the export actually performs — asking the RLS compiler about an
    `export` operation would match no policy and wrongly report "no RLS applies".
    `readFilter` is surfaced for `export` as it is for `read`.
  - **plugin-reports** — closes the reports side door (#3710). A report rendered
    as `csv`/`json` is the same bulk copy of the same object, so it is gated by
    the same `ISecurityService.canExport`. Enforced in `executeReport`, which the
    interactive run, the ad-hoc run and the scheduled dispatch all funnel through;
    `scheduleReport` additionally refuses at create time so an author is not told
    at 3am. A schedule created while granted stops delivering once the grant is
    revoked. `html_table` stays a read — it is a rendered view, not a bulk copy.
    Deployments without `plugin-security` are unaffected (no permission sets
    exist, so the axis does not apply).

- acbf364: feat(spec)!: retire the last three deprecated authorable aliases (#3855)

  Protocol 17 removes the three keys that a schema transform used to fold into a
  canonical slot and drop from the parsed output. Every slot now has exactly one
  spelling.

  ## Migration

  | Removed                     | Use instead               | Value shape                            |
  | --------------------------- | ------------------------- | -------------------------------------- |
  | `action.execute`            | `action.target`           | unchanged — a handler / flow / URL ref |
  | `field.conditionalRequired` | `field.requiredWhen`      | unchanged — a CEL predicate            |
  | `agent.knowledge.topics`    | `agent.knowledge.sources` | unchanged — a list of source tags      |

  All three are **pure key renames**. Nothing about the value changes, and no
  runtime behaviour changes: each alias was already lowered into its canonical key
  at parse time and erased before any consumer saw it, so what shrinks is the
  authorable surface, not the semantics.

  **Run `os migrate meta --from <your current major>`.** It rewrites your source
  mechanically — these renames are registered as protocol-17 chain steps, so the
  tool applies all three (and every earlier step you skipped) in one pass. Manual
  alternative: rename the key. That is the entire fix.

  ```diff
  - actions: [{ name: 'convert', type: 'script', execute: 'convertHandler' }]
  + actions: [{ name: 'convert', type: 'script', target: 'convertHandler' }]

  - fields: { due_date: { type: 'date', conditionalRequired: 'record.stage == "closed"' } }
  + fields: { due_date: { type: 'date', requiredWhen: 'record.stage == "closed"' } }

  - knowledge: { topics: ['faq', 'policies'], indexes: ['docs'] }
  + knowledge: { sources: ['faq', 'policies'], indexes: ['docs'] }
  ```

  ## Why these reject instead of being ignored

  None of the three schemas is `.strict()`, so deleting a key outright makes Zod
  **silently strip** it: the metadata would parse clean and the setting would
  simply never take effect — a script action bound to nothing, a field that is
  never required, an agent recruiting no RAG context. `FieldSchema` already
  carries a comment about the last time that happened (`dataQuality` / `cached`,
  #3726 / #3733).

  So each removed key is **tombstoned**: it stays declared as `never`, which makes
  writing it a `tsc` error at the authoring site _and_ a parse error carrying the
  rename. You cannot lose the setting quietly.

  ## Where to find this if you missed it

  The removal is in the machine-readable change manifest (`spec-changes.json`,
  ADR-0087 D4) as three protocol-17 conversions. Per-major manifests **compose**,
  so jumping several majors at once still yields a single answer rather than N
  changelogs to reconcile — the generated upgrade guide and the `spec_changes` MCP
  tool are both projections of that record.

  ## Also removed

  `lintDeprecatedAliases` and its rule-id exports (`ACTION_TARGET_EXECUTE_CONFLICT`,
  `FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT`,
  `AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT`, `DeprecatedAliasFinding`,
  `formatDeprecatedAliasFinding`). That pass existed to warn when an author
  declared both an alias and its canonical key, because the parse resolved the
  conflict silently. With the aliases gone the parse **rejects** instead, which is
  strictly louder — the rule has no subject left. If you imported any of these,
  delete the import; there is no replacement because the condition it reported can
  no longer occur.

  The CLI's inline-handler lowering also stops binding a function on `execute`. It
  runs before the parse, so binding it there would have kept the removed alias
  quietly working for one authoring style while every other style rejected it.

- f24cb83: feat(spec)!: dissolve the ObjectStackProtocol composition alias — ADR-0076 D9 end-state (v17, #3606)

  The transitional union of the twelve per-domain contracts (and its parallel
  `ObjectStackProtocolSchema` Zod object + `ObjectStackProtocolZod` inferred
  type, 171 schema lines) is removed. Capability availability comes from the
  runtime discovery `services` registry — a static union was its degraded
  snapshot (ADR-0076 rev.7 verdict). Depend on the narrowest per-domain slice
  (`DataProtocol`, `MetadataProtocol`, …; composition precedent: REST's
  `DataProtocol & MetadataProtocol`, A1.5/#3028).
  `ObjectStackProtocolImplementation` now declares exactly the four domains it
  actually provides (Data/Metadata/Analytics/Package) — the D10 "facade never
  implemented the other domains" reality, now enforced by the type system.
  BREAKING for anything importing the alias or the Zod schema; no runtime
  behavior change.

- 5dbbb92: release!: promote the accumulated launch-window train to v17.0.0 (RC cycle)

  Anchor changeset for the v17 major. The lockstep group applies the highest
  bump across all pending changesets to every package, so this single `major`
  promotes the whole train — every other pending changeset keeps its own
  `minor`/`patch` declaration and its own narrative.

  **Why a major, when the launch-window policy ships breaking changes as
  `minor`:** this train's breaking density is the highest since the policy was
  adopted — the `ApiMethod` enum shrink (#3543, compile-time breaking for TS
  authors), the GraphQL surface removal, the ADR-0104 field value-shape write
  cutover, and the retirement of several dead spec clusters all ride together.
  Publishing that set as a bare minor would auto-upgrade every `^16.x` consumer
  into it on their next install. A major puts the version-number signal back:
  caret ranges hold at 16.x until a consumer opts in.

  **RC cycle:** this lands inside Changesets pre-mode (`rc` tag), so the train
  publishes as `17.0.0-rc.N` — nothing reaches `latest` until `changeset pre
exit`. Downstream validation during the RC window: cloud / objectui /
  examples upgrade against the RC, the dogfood gate and the third-party
  consumer gate (#2035) run against it, and legacy `apiMethods` strip warnings
  are watched for the deny-all cliff.

  Migration: each breaking change's own changeset carries its FROM → TO guide
  (grep the CHANGELOG for `!:` entries); the ApiMethod shrink additionally
  ships a reporter codemod (`scripts/codemod/apimethods-legacy-to-primitives.mjs`).

### Minor Changes

- 50616d9: feat(spec,cli): warn the author when a deprecated action alias is discarded (#3743)

  #3742 made `target` beat the deprecated `execute` alias everywhere and had the
  `ActionSchema` transform **drop** the alias from its output, so "two different
  scripts for one button" became unrepresentable. What it left behind: an author
  who declares both slots with different values still loses one of the two
  handlers they wrote, **silently**. Per Prime Directive #12 that belongs at
  authoring time, so it is now reported there.

  **New rule — `action-target-execute-conflict` (advisory).** An action declaring
  both `target` and `execute` with different values gets a warning naming both
  handlers, stating that `target` wins, and giving the one-line fix (delete
  `execute`). Identical values in both slots are harmless duplication and stay
  quiet. It never fails the build: the resulting stack is well-defined — the cost
  is a handler that never runs, not a broken artifact.

  The rule must run **pre-parse**, because the parse is what consumes the alias:
  once `ObjectStackDefinitionSchema` has run there is no `execute` key left to
  report. It therefore lives in `@objectstack/spec`
  (`lintDeprecatedAliases`, exported from the package root) and is wired into
  both layers that perform the discard:

  - **`defineStack`** — the dominant authoring path, and the one that consumes the
    alias earliest: it parses inside your own config module, so by the time
    `os build` loads that module the alias is already gone. It now warns on the
    console before parsing (once per distinct conflict per process).
  - **`os build` / `os validate`** — a new pre-parse pass covering stacks that
    skip strict `defineStack`: a plain object default-export,
    `defineStack(…, { strict: false })`, and inline function handlers (`target` is
    `z.string()`, so those cannot pass strict `defineStack` and are lowered by the
    CLI instead). Both commands lint the same input, so they agree by construction
    (#3782).

  Each layer reports only its own discards, so one authored conflict produces
  exactly one warning however the stack is compiled.

  **Behaviour fix in the same contract.** #3742 fixed compile-time precedence by
  probing for a _callable_ `target` first, which left one combination still
  resolving the alias's way: a **string** `target` beside a **function** `execute`
  bound the alias and then overwrote the canonical ref the author wrote. `target`
  now wins in every combination of string/function across the two slots, matching
  the `ActionSchema` transform — so the new warning states one precedence rule
  that is true everywhere. If you relied on an inline `execute` function winning
  over a string `target`, move it into `target`; the warning names the action.

  Authoring is otherwise unchanged: `execute` alone is still accepted, still
  lowered into `target`, and still documented.

- 08b5a3d: fix(action): one precedence for `target` vs the deprecated `execute` — lower the alias, then drop it (#3713)

  `execute` is the deprecated alias of `target`, and three readers resolved "the
  author declared both" in **two opposite directions**:

  | Reader                                | Preferred |
  | ------------------------------------- | --------- |
  | `ActionSchema` transform (spec)       | `target`  |
  | objectui `ActionRunner.executeScript` | `execute` |
  | CLI compile step (`lowerCallables`)   | `execute` |

  So `defineAction({ type: 'script', target: 'preferredHandler', execute: 'legacyHandler' })`
  ran `preferredHandler` server-side and `legacyHandler` client-side — two
  different scripts for one button, silently, with no error anywhere. Low
  frequency (it needs an author to set both, which happens mid-migration or by
  copy-paste), but the failure mode is "the wrong code ran".

  **`target` now wins everywhere, and the alias is removed from the parsed
  output** — the same "canonical wins, alias disappears" shape as
  `agent.knowledge.topics` → `sources`. The conflict is now _unrepresentable_
  rather than merely agreed-upon: no renderer can see a second slot to disagree
  about. Worth noting the server runtime never read `execute` at all
  (`isHeadlessInvokableAction` gates on `target || body`; dispatch probes
  `target`/`name`), so authoring `execute` worked _solely_ because it was lowered
  at parse time — dropping it costs the server nothing.

  The CLI's inline-handler lowering had the same bug in compile-time form: with a
  function in both slots it bundled the `execute` one and then overwrote
  `action.target` with that ref, silently discarding the function the author
  declared on `target`. It now probes `target` first and drops the alias.

  **Authoring is unchanged** — `execute` is still accepted on input (`ActionInput`),
  still lowered to `target`, and still listed in the reference docs. Nothing to
  migrate in your app metadata.

  **Consumers of the parsed metadata**, however, must read the canonical slot:

  - FROM: `parsedAction.execute` → TO: `parsedAction.target`
  - One-line fix: delete the alias fallback, e.g. `action.execute || action.target`
    becomes `action.target`.

  `z.infer<typeof ActionSchema>` no longer carries `execute`, so any such reader
  fails to compile rather than silently reading `undefined`. The objectui
  `ActionRunner` counterpart ships separately.

- 4727eb8: feat(spec): reject unknown keys on an action param instead of stripping them (#3405)

  `ActionParamSchema` was zod-default `.strip`: any key it does not declare was
  **discarded silently** and the param went on parsing. That is the mechanism
  behind the `reference` bug — an author wrote a correct, clearly intended
  `reference: 'sys_user'`, the key was eaten, and the param dialog rendered a text
  box asking a human to paste a UUID. Adding `reference` fixed that one key; the
  mechanism that swallowed it stayed, so the next mis-spelled key would fail the
  same way, with the same zero feedback (ADR-0078 no-silently-inert-metadata,
  ADR-0049 enforce-or-remove).

  An action param is now `.strict()`. An undeclared key is a parse error naming the
  offending key, and — when the key is a recognisable spelling of a declared one —
  the canonical key to use instead:

  ```
  Unrecognized key(s) on this action param: `reference_to`. Until #3405 these were
  dropped silently — the param still parsed, so a mis-spelled config shipped as a
  control that quietly ignored it. Did you mean `reference_to` → `reference`?
  ```

  **Migration.** A param that previously carried an extra key now fails to parse.
  The fix is to correct or remove that key; the error names it. Common mappings —
  case/underscore slips are matched automatically, these are the ones that need a
  different word:

  | Wrote                                           | Use            |
  | ----------------------------------------------- | -------------- |
  | `reference_to` / `referenceTo` / `targetObject` | `reference`    |
  | `visibleWhen` / `visibleOn` / `visibility`      | `visible`      |
  | `description` / `help`                          | `helpText`     |
  | `default`                                       | `defaultValue` |

  Declared keys are unchanged: `name`, `field`, `objectOverride`, `label`, `type`,
  `required`, `options`, `placeholder`, `helpText`, `defaultValue`, `multiple`,
  `accept`, `maxSize`, `reference`, `defaultFromRow`, `visible`, `requiresFeature`.

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- af5a224: feat: enforce declared action-param contract at dispatch — ADR-0104 phase 2 (D2)

  An action's declared `params[]` (`type` / `required` / `multiple` / `options` /
  `reference`) was a complete value contract that only ever informed the client
  dialog — the server passed `reqBody.params` straight to the handler unvalidated
  (REST `handleActions` and the MCP `invokeBusinessAction` path), and handlers
  read an untyped bag. D2 makes the declaration enforced and typed.

  - **`@objectstack/spec/ui`** now exports `validateActionParams` (+
    `ResolvedActionParam`, `ActionParamIssue`, `ACTION_PARAM_BUILTIN_KEYS`): a
    pure check that validates a params bag against resolved param declarations,
    reusing the D1 `valueSchemaFor` so option membership, `multiple` arrays and
    reference-id shape all ride the one value contract. Also exports the typed
    authoring surface `ActionHandler` / `ActionHandlerContext` /
    `ActionEngineFacade` — annotate a handler with `ActionHandler` instead of
    `(ctx: any)`.
  - **Dispatch (runtime)**: both the REST and MCP action paths resolve the
    action's declared params (field-backed params resolved through the referenced
    object field) and validate the request bag **before the handler runs** —
    required presence, per-type value shape, and unknown keys (the dispatcher's
    own `recordId` / `objectName` are allowlisted).

  **Warn-first rollout (ADR-0104 R3).** A violation is **logged and passes** by
  default — params that were silently wrong before keep working while the drift
  becomes visible. Set `OS_ACTION_PARAMS_STRICT_ENABLED=1` to reject with a
  `400 VALIDATION` (REST) / an error (MCP). Actions that declare no `params` are
  untouched (nothing to validate against). The flip to strict-by-default rides a
  later minor once telemetry is quiet.

  Not included: file/image params becoming `sys_file` references — that depends
  on file-as-reference (ADR-0104 D3). Per-name static typing of `ctx.params` from
  the literal `params` array is a deferred DX nicety; the runtime guarantee holds
  regardless.

- 71f76e1: feat(spec): declared media value shape — ADR-0104 D3 wave 1 (file/image/avatar/video/audio)

  `@objectstack/spec/data` now exports `FileValueSchema` — the declared inline
  form the platform stores today for the whole `FILE_REFERENCE_TYPES` class
  (`file` / `image` / `avatar` / `video` / `audio`): `{ url, name?, size?,
mimeType?, alt?, duration? }` with `url` required. It replaces D1's loose
  transitional union, so `valueSchemaFor(fileField, 'stored')` now catches a
  malformed media value (a number, an empty object, a url-less `{ name }`
  fragment) that was previously waved through as an opaque payload — while still
  admitting the opaque id/url string form for import compatibility.

  This is **wave 1** of ADR-0104 D3 (see the 2026-07-24 addendum): the value-shape
  contract only. It is single-repo, additive, and carries no migration — the
  enforcement rides D1's existing warn-first write-path posture, so deployed
  records with a legacy media value are not stranded. `accept` / `maxSize` field
  config, the `sys_file` reference storage model, GC, and governed download are
  **wave 2** (a protocol-major migration), deliberately not in this change.

- 99736a0: feat(storage): exclusive field-reference file ownership — ADR-0104 D3 wave 2 (PR-3)

  A `file`/`image`/`avatar`/`video`/`audio` field that holds a `sys_file` id now
  records its owner on the file: `sys_file.ref_object` / `ref_id` / `ref_field`
  name the single `(object, record, field)` slot that references it, maintained on
  the engine write path — claimed on insert, reconciled on update, released when
  the owning record is deleted.

  **Field references are exclusive, unlike attachments.** The attachments surface
  deliberately shares one file across many `sys_attachment` join rows; a field
  reference is owned by at most one slot, and writing an already-owned id into a
  second slot **copies the bytes into a fresh `sys_file`** rather than sharing the
  row. That keeps a file's read authorisation derived from exactly one parent
  record instead of the union of every referrer's — so copying a private record's
  file id into a world-readable one cannot silently widen access — and it removes
  reference counting from the lifecycle entirely: a file is released because its
  one owner let go, never because a count came back zero.

  **Deletes nothing.** This records and releases ownership; it never tombstones,
  and the `scope === 'attachments'` guardrail that keeps field-referenced files
  out of the reap is untouched. Collection is a separate, gated change that must
  also extend the reap guard's sweep-time re-verify in the same commit.

  Also exports `isFileIdToken` from `@objectstack/spec/data` as the single arbiter
  of "is this stored string an opaque file id, or a legacy/external URL?", now
  shared by the read resolver and the write claimer so the two cannot drift.

  Dormant until a field actually holds an id token: objects without file-class
  fields, inline-blob values and URL-shaped values all exit before any I/O.

- fe67e34: feat(spec)!: media fields declare accept/maxSize, and the stored form is a file reference — ADR-0104 D3 wave 2 (PR-5a)

  **`accept` and `maxSize` are now declared on `FieldSchema`, and enforced on the
  server.** Both were already read by the upload widgets — `field.accept`,
  `field.maxSize` — while the spec did not declare them, so an author who wrote
  them had the keys silently stripped at parse and the constraint simply never
  existed. That is exactly the ADR-0104 failure class (a declaration accepted in
  source, dropped from the contract, with no feedback).

  Now that the platform owns the file, `sys_file` carries the authoritative MIME
  type and byte size, so a record write is re-checked against the declaration
  where it actually binds rather than only in the browser — a client-side check is
  a convenience, not a control, since any caller talking to the API directly
  bypasses it. Violations raise `FileConstraintError` and fail the write. An entry
  is only judged against metadata the file actually reports: a file with no
  recorded MIME type cannot fail an `accept` test, and one with no recorded size
  cannot fail `maxSize` — "we don't know" must not become "not permitted".

  **The stored form of a media field narrows to an opaque `sys_file` id.**
  `valueSchemaFor(field, 'stored')` now yields an id for `file`/`image`/`avatar`/
  `video`/`audio`; the inline `{url, name, size, …}` blob becomes the `'expanded'`
  read form, which also still admits an unresolved id (storage service absent,
  file not committed) exactly as an unexpanded lookup id stays valid.

  Two legacy forms therefore stop conforming, both deliberately:

  - the **inline blob**, which is no longer stored but derived;
  - an **external URL**, which was never a managed file — ADR-0104 R7 retires it
    toward an explicit `url` field, and under AI authoring that is the point: it
    stops "managed file" and "external link" being the same declaration.

  **Not a breaking change today.** Value-shape checking is warn-first
  (ADR-0104 R1/R2): a not-yet-backfilled row still writes and the author gets a
  warning naming the field. Hard rejection arrives only when a deployment opts
  into `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` — which it should do after running the
  backfill and confirming reconciliation. The `!` marks the contract change for
  the v17 window, not a runtime break on upgrade.

- fdb4f50: feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

  The ADR-0104 file-as-reference migration ships as a command a deployment runs
  against its own database, and the deployment-level flag it records is what may
  later authorise irreversible behaviour — never the platform version.

  ```bash
  os migrate files-to-references           # dry run: reports, writes nothing
  os migrate files-to-references --apply   # converts, verifies, records the flag
  ```

  The run backfills legacy file-field values (inline metadata blobs, own-resolver
  URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
  ledger against what records actually hold, and — only on an `--apply` run whose
  reconciliation reports **zero blocking discrepancies** — records
  `sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

  **Why a flag rather than a release note.** ObjectStack is a development
  platform: third-party deployments upgrade on their own schedule and their data
  is not observable by anyone else, so no release-side soak can vouch for them.
  The evidence has to be produced where the data is. Consequences:

  - Installing a new version never starts deleting bytes. Running the migration
    and passing its self-check is the consent.
  - Not run, or not passed → files are retained forever. Wasted storage, zero
    data loss.
  - A later failing run **clears** `verified_at`: a deployment whose data has
    drifted closes its own gate.
  - A dry run writes nothing at all — not the conversions, and not the flag,
    even when the self-check would pass.
  - External URLs stay advisory. They are not `sys_file`s, so they can never
    enter collection; whether to remodel them as a `url` field is the app
    author's decision (ADR-0104 R7), not a gate.

  Ships alongside:

  - `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
    and the single `isDataMigrationFlagVerified` predicate both future consumers
    (collection #3459, strict value-shape #3438) read, so the two gates cannot
    disagree about the same fact.
  - `@objectstack/platform-objects` — the `sys_migration` object plus
    `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
    Reads fail toward "not verified": a gate that cannot read its evidence stays
    closed.
  - `@objectstack/objectql` — a read may now opt out of file-reference expansion
    via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
    bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
    their expanded form before the reconciliation sees them, which reports held
    references as absent — noisy `stale_owner` findings, and a missed
    `unowned_reference` would have been a false pass of the collection gate.

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

- 14252d3: feat(approvals): cross-organization approver targeting — a plant document can
  require a group-side sign-off (ADR-0105 D9)

  One organization id used to decide three different things at once in
  `openNodeRequest`: where the request row lives, where its inbox index rows
  live, and **where its approvers are looked up**. The first two are the
  request's own organization by definition. The third is not — a group CFO holds
  her `cfo` position in the GROUP organization while the purchase order she signs
  off lives in the PLANT organization. `expandPositionUsers('cfo', <plant>)`
  matched nobody, the slot fell back to the dead `position:cfo` literal, and a
  group escalation could not be expressed at all.

  An approver may now declare which organization's directory resolves it:

  ```yaml
  approvers:
    - { type: position, value: plant_manager, group: plant }
    - { type: position, value: cfo, organization: $root, group: finance }
  behavior: per_group
  ```

  - **`$root` / `$parent`** walk D6's `parent_organization_id` tree, so the two
    common intents need **no deployment knowledge** — flow metadata is portable
    across environments while organization ids are minted per deployment. A slug
    covers what the symbols cannot, notably a **sibling** organization (a
    shared-services centre approving payables for every plant).
  - Declared **per approver**, so one node can require a plant manager and a
    group CFO in parallel. A node-level form cannot express that without
    splitting into serial nodes, which changes the semantics.
  - **Bounded, not free:** the target must share a `parent_organization_id` root
    with the request's organization. The rule reads only the organization tree —
    never the submitter — so one flow routes identically for everyone.

  Everything else fails loudly rather than quietly:

  - a non-`group` posture **refuses** the declaration (a `group` → `isolated`
    migration must not silently reroute approvals);
  - an approver type with no org-scoped directory (`user` / `field` / `manager` /
    `team`) refuses it too, and a new `approval-approver-cross-org-unsupported`
    lint catches that at author time;
  - a targeted approver holding no membership in the request's organization is
    dropped with a warning naming them — D2's union wall would otherwise hide the
    request from someone already routed to, so the node's existing
    `onEmptyApprovers` policy takes over instead of leaving an unopenable task.

  Nothing changes for an approver without `organization`: same resolution, same
  queries, no extra reads.

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

- 6fdc5c6: feat(client,spec): `ai.agents.*` and `ai.pendingActions.*` — the AI routes the SDK could not reach (#3718)

  #3718 deleted three `client.ai.*` methods whose URLs no route had ever mounted,
  then expressed the surface that does exist. It expressed **one** builder's worth
  of it. `service-ai` mounts seven; the audit that widened its ledger
  (objectstack-ai/cloud#903) counted **ten** routes the SDK cannot reach, nine of
  which had simply never been counted.

  This closes the six with the strongest evidence: `objectui` already ships
  product on them, over URLs it builds by hand because there was nothing to call.

  **`ai.agents`** — `/ai/chat` talks to the environment's default agent; these
  talk to one you name.

  - `agents.list()` — the agents this CALLER may chat with. The route filters by
    the caller's permissions (ADR-0049), so an empty list is a legitimate answer
    for a seat-less user, not an error to retry.
  - `agents.chat(name, request)` / `agents.chatStream(name, request)` — one route,
    two methods, mirroring `ai.chat` / `ai.chatStream` rather than inventing a
    third shape for the same endpoint. `chat` forces `stream: false` for the same
    reason `ai.chat` does: the route streams by default, so leaving the flag to
    the caller means the JSON path is the one you have to remember.

  **`ai.pendingActions`** — the human-in-the-loop approval queue. When a tool call
  needs a human decision the turn parks an action instead of executing it, and an
  app embedding the chat has to render and resolve that queue.

  - `pendingActions.list(options?)` — `status`, `conversationId` and `limit` only.
    `AIService.listPendingActions` also accepts `objectName`, but the route never
    forwards it; typing it here would offer a filter that silently does nothing.
  - `pendingActions.get(id)`
  - `pendingActions.approve(id)` — approves **and executes**. Check the returned
    `status`: a tool that fails after approval comes back
    `{ status: 'failed', error }` with HTTP 200, because the approval succeeded
    even though the execution did not. Code that reads only `res.ok` reports a
    failed write as a success.
  - `pendingActions.reject(id, reason?)` — executes nothing.

  Reads and decisions are separately permissioned server-side (`ai:read` vs
  `ai:approve`), so a caller that can list the queue may still be refused on
  approve. Handle the 403; one does not imply the other.

  **Typed from what the routes return**, not from what a client might like them
  to — the failure #3718 exists to punish. The pending-action shape is the
  persisted row, `snake_case` on the wire because that is what it is. Agent rows
  require `capabilities`, because that object is what tells a UI which
  affordances to render.

  The capstone (#3642) exempts `/api/v1/ai/` by prefix and says the evidence lives
  on the other side of the repo boundary. It does: cloud's ledger drives every
  `ai.*` method against the tables its builders really return — and since #903
  that means all seven builders, which is what makes these six routes checkable
  at all. Their routes come from `buildAgentRoutes()` and
  `buildPendingActionRoutes()`, neither of which the ledger could see when the
  exemption was written.

- 259af21: feat(spec,lint): ADR-0109 Phase 1 — platform tool-name registry + advisory `skill.tools[]` reference lint (#3820 R7)

  ADR-0109 (revised) settles the AI tool authoring model: **the default
  third-party path needs no tool records at all.** A skill's `tools[]` names
  either a platform-registered tool or a tool the runtime materialises from the
  app's own declarative actions (`action_<name>`) — the executable, its authz,
  and its audit trail stay on the action/flow the app already ships. Tool
  records are demoted to an optional AI-presentation refinement layer (Phase 2,
  gated on acceptance).

  Phase 1, shipped here:

  - **`PLATFORM_PROVIDED_TOOL_NAMES`** (`@objectstack/spec/system`) — curated
    registry of every statically-named tool the cloud AI runtime registers,
    grouped by owning package, plus `PLATFORM_TOOL_FAMILY_PREFIXES` for the
    materialised `action_` family and `isPlatformProvidedToolName()`. The
    `PLATFORM_PROVIDED_OBJECT_NAMES` precedent, applied to tools; conformance
    tests live in the owning cloud packages.
  - **`validate-ai-tool-references`** (`@objectstack/lint`) — the #3820 R7
    `skill.tools` branch, wildcard-aware, resolving against declared
    `stack.tools` ∪ the registry ∪ the materialised action family. Severity
    **warning** (ADR-0078 advisory-first ratchet): the registry cannot see
    third-party runtime plugins. Joins `REFERENCE_INTEGRITY_RULES`, so
    `validate`, `lint`, and `compile` all pick it up. On the HotCRM corpus it
    reports exactly the 10 fictional tool references (0 false positives on the
    6 that resolve).
  - **`composeStacks` no longer drops `tools`** — the slot joins the
    concatenated array fields, so a declared record survives composition.
  - `stack.tools` / AI-slot docs updated to the ADR-0109 model.

- 587fc91: feat(analytics): the executeAggregate bridge carries ExecutionContext — ADR-0021 D-C second belt

  The analytics→engine bridge now forwards the request's `ExecutionContext` to
  `engine.aggregate`, so the engine's own middleware chain scopes analytics reads
  independently of the analytics layer's `getReadScope`.

  **Why.** `BaseEngineOptions.context` has always been `.optional()`, so nothing
  forced the bridge to pass it — and it did not. An authenticated aggregate
  reached the engine with no principal, plugin-security's principal-less fall-open
  skipped its RLS injection, and the only thing left scoping the query was the
  strategy remembering to call `getReadScope`. #3597 was a strategy that did not,
  and both belts were off at once.

  `getReadScope` stays: the two resolve scope through different paths (engine
  middleware vs `security.getReadFilter`), and a deployment without
  plugin-security has only the analytics layer. This is depth, not a replacement.

  - `StrategyContext` gains `context?: ExecutionContext`, bound per call by
    `AnalyticsService` from `query()` / `generateSql()` / `queryDataset()`.
  - `StrategyContext.executeAggregate` and the `AnalyticsServicePlugin` /
    `AnalyticsService` `executeAggregate` config options gain `context?:
ExecutionContext`. **Custom bridges should forward it** to their engine; the
    built-in auto-bridge does. Purely additive — an existing bridge that ignores
    it keeps working exactly as before.
  - `DimensionLabelDeps.fetchRecordLabels` and `resolveDimensionLabels` each gain
    an optional trailing `context`, beside the `scope` / `resolveScope` that
    #3639 added — the same two-belt split as the aggregate path.
  - `BootOptions.analytics` (`@objectstack/verify`) overrides the
    AnalyticsServicePlugin instance, so a gate can boot with the analytics belt
    off and assert the engine-side belt alone still scopes.

  **Also fixed on the same seam:**

  - `fetchRecordLabels` — the dimension display-label lookup — is row-granular
    (one row per record, real display names). #3639 gave it the analytics-layer
    belt (the referenced object's own read scope); it now also carries the
    context, so the engine scopes the same read independently.
  - `ObjectQLStrategy.generateSql` emitted no `WHERE` at all, so the
    `/analytics/sql` preview read as an unscoped table scan while the real
    aggregate was scoped. It now renders the caller's filters and the read scope.
    The preview never executed, so this was misleading output rather than a leak.

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- d44dbfa: feat(spec)!: shrink the `ApiMethod` enum to the six primitives — legacy values are stripped at parse, never honored (#3543, P2 of #3391)

  **BREAKING** (the `!` marker and this changeset are the breaking-change
  record; the train ships as the v17 major — see the `v17-rc-anchor` changeset):
  the authored `enable.apiMethods` enum is now exactly the six
  primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`). The eight
  legacy values (`upsert`, `aggregate`, `history`, `search`, `restore`, `purge`,
  `import`, `export`) are no longer authorable — they are DERIVED effective
  operations, resolved by the server's single derivation table.

  **Migration (FROM → TO).** Replace each legacy value with the primitives it
  derives from, then de-duplicate; if the result names all six primitives, delete
  the `apiMethods` key entirely (equivalent to default-open, and it tracks future
  primitives):

  | FROM (legacy) | TO (primitives)      | why                                            |
  | ------------- | -------------------- | ---------------------------------------------- |
  | `upsert`      | `create`, `update`   | upsert ⊆ create ∧ update                       |
  | `import`      | `create`, `update`   | import ⊆ create ∨ update (writeMode-precise)   |
  | `export`      | `list`               | export ⊆ list                                  |
  | `aggregate`   | `list`               | aggregate ⊆ list                               |
  | `search`      | `list`               | search ⊆ list ∧ `searchable`                   |
  | `history`     | `get`                | history ⊆ get ∧ `trackHistory`                 |
  | `restore`     | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |
  | `purge`       | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |

  Reporter codemod: `node scripts/codemod/apimethods-legacy-to-primitives.mjs`
  (scans, reports the exact replacement per site, and flags whitelists the
  mapping would WIDEN so the edit stays reviewable).

  **Stored metadata keeps parsing — permanent tolerance, narrowing only.** Real
  metadata does not upgrade in lockstep with the spec, so a stored legacy value
  is NOT a parse error: `stripLegacyApiMethods` (new export) strips it with a
  FROM→TO warning (canonicalize-and-warn). Stripping only ever NARROWS exposure —
  the derivation table still grants every legacy verb that derives from the
  primitives you declared. Two cliffs to know:

  1. A whitelist of ONLY legacy values (e.g. `['upsert']`) strips to `[]` =
     **deny-all** — the object's API closes instead of widening. The strip
     warning and the objectql registration diagnostic both call this out.
  2. A legacy value NOT derivable from your declared primitives (e.g.
     `['get', 'export']` — export needs `list`) was honored by the P1
     "explicit wins" path and is now denied. Declare the underlying primitive.

  **Type split — authored vs effective vocabulary.** `ApiMethod` (authored) is
  now six values; the NEW `ApiOperation` type / `ApiOperationSchema` /
  `API_OPERATION_ORDER` (fourteen values, byte-stable pre-shrink wire order)
  carry the EFFECTIVE vocabulary. The wire contract is unchanged: the 405
  `allowed` array and `/me/permissions` `apiOperations` still serialize derived
  verbs (`export`, `search`, …), and `EffectiveObjectPermissionSchema.apiOperations`
  now validates against `ApiOperationSchema`. `EffectiveApiMethods.explicitLegacy`
  is removed (nothing is honored verbatim anymore); `API_METHOD_ORDER` remains as
  a deprecated alias of `API_OPERATION_ORDER`.

  **Fail-closed tightening (#3545):** a PRESENT but non-array `apiMethods` (only
  producible by a raw/out-of-band metadata write) now resolves to `deny-all`
  instead of unrestricted — a policy that exists but cannot be read fails CLOSED.

  **Published JSON Schema diverges deliberately:** `data/ApiMethod.json` is the
  strict six-value enum (a `z.preprocess` is not representable in JSON Schema),
  so external JSON-Schema validators reject legacy values that the zod parse
  would strip-and-warn. Treat the JSON Schema as the authored contract; the zod
  tolerance exists for stored metadata.

  **objectql:** the P1 "explicit wins" transition is reclaimed —
  `warnDeprecatedExplicitApiMethods` is replaced by `warnStrippedLegacyApiMethods`
  (a permanent per-object diagnostic for schemas that reach the registry without
  passing through Zod; the parse-time strip warning carries no object name).

  **platform-objects:** whitelist audit — `sys_business_unit`,
  `sys_business_unit_member` (P1's explicit `import`/`export` reclaimed) and
  `sys_user_preference` dropped their `apiMethods` entirely (each named all six
  primitives = default-open). Read-only and deny-all whitelists are unchanged;
  the seven `[]` declarations are deliberately KEPT as defense-in-depth alongside
  `apiEnabled: false`.

- 474fe39: feat(approvals): declare approver value bindings; retire `queue` approver authoring (#3508)

  - `@objectstack/spec` exports `APPROVER_VALUE_BINDINGS` — the single declaration of how a
    designer must source each approver row's `value`: `user`/`team`/`department`/`position`
    are DATA-record lookups on the system directory objects (`sys_user` / `sys_team` /
    `sys_business_unit` / `sys_position`; `position` commits the machine **name**, the
    others the row id), `org_membership_level` is a closed enum (`ORG_MEMBERSHIP_LEVELS`),
    `manager` is auto-resolved, `field` names a trigger-object field, and `queue` is
    unsupported. Also exports `NON_AUTHORABLE_APPROVER_TYPES`.
  - `queue` approver type is deprecated-for-authoring: it still parses (stored flows keep
    loading and rendering) but is published in `xEnumDeprecated`, so designers stop
    offering it — the runtime has no queue resolution and the slot routes to nobody. The
    approver `value` xRef now also maps `manager`, so designers can render its
    auto-resolved state. No authored key is removed; nothing to migrate. If a flow carries
    `{ type: 'queue' }`, replace it with `team` / `department` / `position` (or a concrete
    `user`) until a real ownership-queue implementation lands.
  - `@objectstack/plugin-approvals` now warns at resolution time when a stored `queue`
    approver is skipped.
  - `@objectstack/lint` adds `approval-approver-type-unsupported` (warning) for approver
    types that are declared but not implemented by the runtime.

- a6c3f38: feat(approvals): expose the pending node's `lockRecord` policy on the request row (#3814, objectui#2902)

  An approval node declares `lockRecord` (default `true`), and the record-lock
  `beforeUpdate` hook enforces exactly that: `lockRecord: false` and the record
  stays writable for the whole time the node waits. The behavior was correct and
  has been since Phase B — but it was **invisible to every client**.

  `rowFromRequest` parses `node_config_json` and projects a whitelist out of it
  (`__flowLabel`, `__nodeLabel`, `__round`, `escalation.timeoutHours`,
  `decisionOutputs`). `lockRecord` was never in that list, and no other field on
  `ApprovalRequestRow` carried the lock either. So the strongest thing a console
  could learn from `GET /approvals/requests` was _"a pending request exists"_ —
  from which it can only assume the record is locked.

  That assumption is wrong on every opted-out node, and a flow that chains nodes
  with different policies makes it visibly wrong: the same UI state renders for
  "you may edit this" and "the server will reject your save with `RECORD_LOCKED`".
  The console has no third option — guessing the other way would offer an edit
  that dies on save.

  `ApprovalRequestRow` now carries **`lock_record: boolean`**, read from the same
  snapshot the hook reads, with the same `!== false` default. Present on every
  service read (`openNodeRequest` / `getRequest` / `listRequests`), so the flag a
  client renders and the rule the server applies cannot drift.

  Additive and backward compatible — nothing to migrate. A client that wants
  node-accurate lock state reads `request.lock_record`; treat `undefined` (an
  older backend) as locked, which is the pre-existing behavior.

  The showcase's `showcase_budget_approval` now declares `lockRecord: false` on
  its single-approver Manager Review and keeps `true` on the multi-approver
  Executive Review, so both policies are exercised in one flow.

- 0f8ad09: feat(spec)+fix(approvals): publish approver value data sources, order the type enum for authors, stop silent dead approver slots (#3508 / #3807 follow-ups)

  Four follow-ups from browser-verifying the #3508 approver work end to end.

  **`APPROVER_VALUE_SOURCES` — the designer stops guessing where candidates live.**
  `xRef.map` only ever named a picker KIND (`'team'`), never where that picker's
  rows come from, so the designer carried its own copy of the data contract — and
  the first copy was wrong: every directory kind was wired to `GET
/api/v1/meta/:type`, the metadata REGISTRY, which does not hold `sys_user` /
  `sys_team` / `sys_business_unit` / `sys_position` rows. Candidates came back
  empty and the control degraded to free text (#3508). The binding is now
  projected onto the published JSON schema as `xRef.sources` — `{ source: 'data',
object, valueField }` for the record-backed kinds, the closed enum inline for
  `org_membership_level` — derived from `APPROVER_VALUE_BINDINGS` so the two
  cannot drift, and inheriting its `satisfies` exhaustiveness (a new
  `ApproverType` member that declares no source is a compile error). Presentation
  — which field to show, whether to open a people-picker, what subtitle to use —
  stays a renderer decision.

  **`ApproverType` declaration order is now the authoring recommendation.**
  objectui#2834 argued for leading with indirect bindings and shipped that order
  in its own options array — which the Studio inspector never reads: it derives
  the picker from this enum via the published schema, so `user` still came first.
  The intent only takes effect if the enum carries it, so the enum now reads
  `manager, position, department, team, field, expression, org_membership_level,
user` (deprecated `role` / `queue` still parse and stay out of every picker via
  `xEnumDeprecated`). Binding one specific person is the least portable choice an
  author can make — it breaks when the flow moves to another environment (that id
  does not exist there) and again when that person leaves.

  **A graph approver that expands to nobody no longer does it in silence.**
  `queue` already warned (#3508); every OTHER graph type — `team`, `department`,
  `position`, `org_membership_level`, `manager` — fell back to the same
  unactionable `type:value` literal without a word. That silence is what let
  #3807 hide for as long as it did: the request opened with an empty slate and
  the first symptom was a permanently stuck approval (#3424). The fallback stays
  (15.x slots and substring fixtures depend on it); it now logs the type, value
  and organization that produced it. `user` / `field` stay quiet — they take the
  id they were given and never had an "expanded to nobody" state.

  **`plugin-sharing`'s identical org scope is pinned by tests.**
  `BusinessUnitGraphService.orgScope` has the same strict `organization_id`
  equality #3807 fixed in approvals. It is unreachable today — every materialized
  `sys_sharing_rule` carries `organization_id = null`, so the filter is skipped —
  and widening an authorization path on a defect that cannot currently fire is
  not a change to make blind. New tests lock both the reachable paths and the
  divergence itself, so if sharing ever adopts the null-org=env-wide reading it
  is a deliberate edit to a named test rather than a silent behaviour change.

- 57a3bb3: fix(automation,approvals): the run-resume route is gated by the node the run is parked on (#3801)

  `POST /api/v1/automation/:name/runs/:runId/resume` forwarded a caller-supplied
  `{ inputs, output, branchLabel }` straight into `AutomationEngine.resume`, and
  `resumeInternal` validated **machine state only** — the concurrent-resume latch,
  the run exists, the flow exists, the suspended node still exists. Nothing asked
  _who was calling_.

  Approval nodes suspend and resume through exactly that mechanism. So a resume
  carrying `branchLabel: 'approve'` walked the approve edge with **no approver
  check, no `sys_approval_action` row and no status mirror** — the
  `sys_approval_request` row and the run then disagreed permanently. The only
  thing standing between the route and the approvals rules was convention; the
  showcase spelled it out in a comment ("decide via the approvals API, never a raw
  engine `resume`"), and a comment in an example is not an access control.

  Removing the route was not the fix: it is load-bearing for **screen flows** —
  the UI flow-runner posts `{ inputs }` there to advance a paused `screen` node.
  The gate therefore keys on **what the run is parked on**:

  - `ActionDescriptor.resumeAuthority` (`'any'` | `'service'`, default `'any'`) —
    a pausing node declares who may continue it. `approval` declares `'service'`.
  - The engine refuses a `'service'` suspension unless the signal carries
    `RESUME_AUTHORITY_SERVICE` (`@objectstack/spec/contracts`), a **symbol** the
    owning service stamps in-process — a JSON body can never produce one, so the
    transport cannot forge it. `ApprovalService` stamps it on the tail of a
    decision it has already authorized and recorded.
  - The gate follows a **subflow** pause down to the child the signal would
    actually reach, so resuming the parent is not a way around it.
  - Refusal returns `{ success: false, code: 'forbidden' }` and the route answers
    **403**. Nothing is consumed — the request stays pending and the run stays
    parked, so the real decision still lands.

  `screen` and `wait` pauses are unchanged, as is every path that already went
  through the approvals API. What changes for consumers:

  - **FROM:** finishing an approval with
    `client.automation.resume(flow, runId, { branchLabel: 'approve' })`
    **TO:** `client.approvals.approve(requestId, …)` (or `.reject` / `.recall`).
    The old call now answers 403 and changes nothing.
  - Registering your own pausing node whose continuation belongs to a service
    rather than to whoever holds the run id? Declare `resumeAuthority: 'service'`
    on its descriptor and stamp `RESUME_AUTHORITY_SERVICE` on the signal from that
    service.

  A suspension now records the node type that produced it
  (`SuspendedRun.nodeType` / `sys_automation_run.node_type`), captured at suspend
  time so a flow republished mid-pause cannot re-type the node out from under the
  gate; rows written before this fall back to the flow definition.

- 5f9a987: fix(rest): report `droppedFields` from the cross-object batch, so a silent strip stops reading as a clean save (#3794)

  The engine strips writes to `readonly` (#2948) and `readonlyWhen`-locked (#3042)
  fields and completes the write without them. Every write path already reported
  which fields it dropped (#3431/#3455) — except the cross-object transactional
  batch, which never wired `onFieldsDropped` at all.

  That path is the Console record form's save for a master-detail record, so it is
  exactly where a _user_ edits a `readonlyWhen` field: they changed it, the form
  said "updated successfully", the value never moved, and nothing anywhere said
  so.

  `POST /batch` responses now carry a top-level `droppedFields` list, each event
  tagged with the `index` of the operation that produced it (`results` entries are
  bare record echoes, with no envelope to hang a per-row list on). Omitted
  entirely when nothing was dropped, so the shape stays backward-compatible; the
  batch still commits either way — a strip is legal semantics, not an error.

  The Console half ships in objectui: the write-warning toast now fires on batch
  saves too.

- db02d47: **BREAKING** `ChartInteraction` drops `zoom` and `clickAction`; `stepSize` / `description` / `height` are delivered (issue #3752)

  The tail of the declared-≠-delivered sweep from #3729. Five `ChartConfig` props
  reached the renderer and did nothing; each got the ADR-0078 call — honor it, or
  remove it. Three were honored (objectui#2885), two are removed here.

  **Removed — `ChartInteraction.zoom` and `ChartInteraction.clickAction`.** Both
  were redundant against something the platform already delivers, which is why
  neither had a consumer anywhere in the framework, the console, the showcase, or
  the skill corpus:

  - `zoom` had no renderer primitive behind it, and `brush` already narrows a
    range. **Migration:** `interaction: { brush: true }`.
  - `clickAction` competed with two click owners that _do_ work — `drillDown`
    (opens the filtered records, which is what a segment click is almost always
    for) and, in the react tier, the host's own `onSegmentClick`. A third, silent
    owner only invited authors to wire a click that never fired.
    **Migration:** `drillDown`, or handle the click in React.

  `ChartInteraction` is now `{ tooltips, brush }` — both honored. This follows the
  #1475 precedent: trim what cannot be cleanly delivered, implement the rest, and
  leave nothing declared-but-inert in between.

  **Delivered — `ChartAxis.stepSize`, `ChartConfig.description`, `ChartConfig.height`**
  (objectui#2885). `description` and `height` join `<ObjectChart>`'s published
  `dataProps` now that they do something; `stepSize` rides along inside
  `xAxis`/`yAxis`. Their schema descriptions say what they actually do rather than
  restating their names.

  Breaking, but shipped as `minor` per the launch-window convention (see
  `scripts/check-changeset-no-major.mjs`). Off-spec `zoom`/`clickAction` keys are
  stripped by Zod rather than rejected, so no stored metadata fails to parse — the
  break is at the TypeScript type level for anyone constructing a
  `ChartInteraction` in code.

- 0bfdf46: fix(spec,cli): conversion deprecation notices reach the author, not just `os validate` (#3855)

  The ADR-0087 D2 conversion layer rewrites an old-shape key to its canonical
  spelling at load and emits a structured `ConversionNotice` for each rewrite. The
  conversion being silent about _fixing_ the shape is the point — zero consumer
  action. Being silent about having **had** to is not: the notice is the one signal
  that says _this spelling retires in protocol N, and your metadata stops loading
  then_.

  Two of the three surfaces that run the conversion pass discarded every notice:

  | Surface                   | Before                                 | After                                                                                                    |
  | ------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
  | `os validate`             | passed a sink, printed them            | unchanged                                                                                                |
  | `os build` / `os compile` | **passed no sink — notices discarded** | prints them, and includes a `conversions` array in `--json` under the same key `os validate --json` uses |
  | `defineStack`             | **passed no sink — notices discarded** | warns on the console, once per distinct conversion site                                                  |

  This is the #3782 parity class one layer down: not "does this command run the
  gate" but "does it listen to what the gate says". Five conversions are live
  today (protocol 11 and 15), so an author on any of those shapes was told by one
  command and not the other two — and `defineStack` is where that author actually
  is, since it runs inside their own config module.

  `defineStack` surfaces notices in **both** strict and non-strict mode: the
  conversion happens on the shared `normalizeStackInput` call before the strict
  branch, and `strict: false` does not make the old shape any less retiring.

  A new assertion in `validate-build-gate-parity.test.ts` fails if either command
  calls `normalizeStackInput` without a sink, so the gap cannot silently reopen.

  No behaviour change for a stack already on canonical shapes: nothing converts,
  so nothing warns.

- 7c7e246: feat(authz): expose the caller's delegable scope — the read half of the
  delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

  `adminScope` decided writes but could not be READ: `assignablePermissionSets`
  lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
  person in a unit, with these positions" (the D8 scoped-invitation form) had no
  way to narrow its pickers. It would list the whole tree and let the user
  discover the boundary by being refused — which turns an authorization gate into
  a validator and makes the boundary invisible until it bites.

  `ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
  `GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

  - `placeableBusinessUnitIds` — union of the subtrees where the caller may place
    people (scopes granting `manageAssignments`);
  - `assignablePositions` — positions whose every distributed permission set the
    caller may hand out (containment check included);
  - `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
  - `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
    renders ONE uniform picker instead of special-casing.

  Computed by the same helpers the write gate enforces with, so an option this
  reports is one `assert()` accepts — a test asserts that agreement directly. It
  NARROWS; the gate still decides.

  Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
  the authority the caller already holds (unlike `explain`, which has one and
  gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
  no delegated authority gets empty lists, and a deployment without
  `@objectstack/plugin-security` gets 501.

- f35cdc5: feat(spec): the deprecated-alias warning now covers all three fold-and-drop aliases (#3743 follow-up)

  #3838 introduced `lintDeprecatedAliases` — the pre-parse pass that reports an
  alias the parse is about to consume — with one rule, for `action.execute`. The
  issue that asked for it predicted the pass would earn its keep beyond that rule,
  and it does: `execute` was never special. The spec has exactly **three**
  transforms that fold an alias into its canonical key and then drop it from the
  parsed output, and all three share the same failure mode — declare both slots
  with different values and one of them is discarded with no signal, invisible to
  every downstream check because the parse already erased it.

  Two more rules, same shape, same advisory severity, same two surfaces
  (`defineStack` at authoring time; `os build` / `os validate` for stacks that skip
  strict `defineStack`):

  - **`field-requiredwhen-conditionalrequired-conflict`** — `FieldSchema` folds
    `conditionalRequired` into `requiredWhen` (#3754). The discarded predicate
    never gates the field. Covers fields on objects _and_ on object extensions.
    Compares the predicate **text**, so a bare string and the
    `{ dialect, source }` envelope it lowers into are recognised as the same
    predicate and stay quiet.
  - **`agent-knowledge-sources-topics-conflict`** — `AIKnowledgeSchema` folds
    `knowledge.topics` into `knowledge.sources` (#1891). The discarded list names
    RAG sources the agent never recruits from. Compares by **set**, so the same
    sources in a different order stay quiet.

  Neither fails the build; both name the two values and give the one-line fix.

  Also corrects `content/docs/ai/agents.mdx`, which documented `knowledge` as
  `{ topics, indexes }` and used `topics` in all three examples — teaching the
  deprecated alias as if it were the canonical key, and disagreeing with
  `skills/objectstack-ai/SKILL.md`, which already had it right. The examples now
  use `sources`.

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

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- f5a2320: fix(field): fold the deprecated `conditionalRequired` alias into `requiredWhen` and drop it from the parsed output (#3754)

  Second instance of the alias-drift shape #3713/#3742 fixed for `action.execute`.
  `requiredWhen` is canonical and `conditionalRequired` is its documented deprecated
  alias, but `FieldSchema` had **no canonicalization at all** — both keys stayed live
  in the parsed output, so every consumer had to re-implement the precedence. That is
  exactly the condition that produced #3713, where the server kept `target` while
  objectui's renderer preferred the alias and one button ran two different scripts.

  Worse, the alias surviving parse was **test-pinned**, including a case literally
  named _"requiredWhen and its alias conditionalRequired can coexist"_ — the inverse
  of the contract #3742 had just established one field over.

  `FieldSchema` now lowers `conditionalRequired` into `requiredWhen` at parse time and
  removes the alias from its output; `requiredWhen` wins when both are declared. The
  pinning tests are inverted accordingly, and a new case asserts the alias is gone
  from a field parsed through `ObjectSchema` — the path a renderer actually receives,
  not just a bare `FieldSchema.parse()`.

  No live bug is being fixed here: every reader we can see already prefers the
  canonical key (`rule-validator.ts` reads `requiredWhen ?? conditionalRequired`). The
  point is that nothing in the contract _made_ that right. This is hardening — it
  removes the chance rather than a defect.

  `objectql`'s `requiredWhen ?? conditionalRequired` fallback is kept on purpose:
  `evaluateValidationRules` is also handed raw, unparsed field definitions, which still
  carry the alias.

  **Authoring is unchanged.** `conditionalRequired` is still accepted on input, still
  lowered, still listed in the reference docs and JSON Schema. Nothing to migrate in
  app metadata.

  **Consumers of the parsed metadata** must read the canonical slot:

  - FROM `parsedField.conditionalRequired` → TO `parsedField.requiredWhen`
  - One-line fix: `field.conditionalRequired || field.requiredWhen` becomes
    `field.requiredWhen`

  `z.infer<typeof FieldSchema>` no longer carries `conditionalRequired`, so a stale
  reader fails to compile rather than silently reading `undefined`. A new
  `FieldParseInput` (`z.input<typeof FieldSchema>`) names the author-facing shape that
  still accepts the alias — distinct from the pre-existing `FieldInput` factory-helper
  type, which is `Partial<Field>` and unrelated.

- deb538f: fix(storage): let an object delegate file-read authorization to its service

  Fixes a regression from the governed-download change (ADR-0104 D3 wave 2): a
  **legitimate approver could see a decision attachment's filename but got 403
  opening it**, found by driving app-showcase in a browser as a real non-admin
  approver.

  Cause: a field-owned file's download was authorized by testing whether the
  caller can READ the owning row. For an ordinary business object that is right —
  row readability _is_ the access rule. For `sys_approval_action` it is the wrong
  authority: the audit table is deliberately closed to ordinary approver
  positions (`operation 'find' … is not permitted for positions [auditor,
everyone]`), so the test denied the very approver the attachment was filed for.
  The approvals _service_ has always had the real rule, which is why the timeline
  listing the attachment returned 200 while the bytes returned 403.

  An object may now name a service to answer the question instead:

  - `ObjectSchema.fileAccessDelegate` — a kernel service that authorizes
    downloads of files owned by that object's media fields.
  - `IFileAccessDelegate.authorizeFileRead(recordId, context)` — the contract.
  - `sys_approval_action` declares `'approvals'`; `ApprovalService.authorizeFileRead`
    reuses the _same_ gate `listActions` applies (visibility of the parent
    request) rather than inventing a second, looser rule for the bytes.

  **Fails closed**: a declared delegate that is missing or does not implement the
  method denies, rather than silently reverting to the raw read it was declared to
  replace. Objects without the declaration are unchanged.

  Verified in the browser against app-showcase, both sides of the gate: the
  approver now downloads the real PDF (200), and an anonymous request is still
  refused (401) — the anonymous capability URL the original change closed stays
  closed. A decision attachment ends up exactly as readable as the decision it
  hangs off: never more, and no longer less.

- 0c8a22f: feat(spec): one canonical conformance table for the filter logical combinators

  `FilterCondition` is evaluated by four independent implementations, and nothing
  held them to a shared standard:

  | Backend                    | Where                                                       |
  | -------------------------- | ----------------------------------------------------------- |
  | SQL compiler               | `driver-sql` `applyFilterCondition`                         |
  | In-memory matcher          | `driver-memory` `memory-matcher`                            |
  | Record-at-a-time evaluator | `formula` `matchesFilterCondition` (RLS write-side `check`) |
  | Read-scope SQL lowering    | `service-analytics` `read-scope-sql`                        |

  In #3774 the SQL compiler OR-ed the contents _within_ a `$or` branch instead of
  AND-ing them, so every `$or` filter matched more rows than it should. The other
  three were correct — but that was luck, not enforcement, and the divergence was
  invisible until someone ran a real query. The fix for #3774 left three
  near-identical shape tables copied across packages and the fourth backend
  unlocked entirely, which is the same drift setup one step later.

  `@objectstack/spec/data` now exports the table itself:

  - `FILTER_LOGIC_ROWS` — a 2x2 truth table over two columns (so a wrongly-OR-ed
    pair always shows up as extra ids rather than by luck of the data), plus the
    record-scope columns real read scopes are written against.
  - `FILTER_LOGIC_CASES` — 17 cases, each a `FilterCondition` and the ids it must
    match: keys within a branch, multiple operators on one field, `$and`/`$or`/
    `$not` nesting in both key orders, and the scope shapes that occur in shipped
    metadata.

  Each backend now has a thin test that feeds the rows through its own evaluator
  and asserts the shared expectations. **Adding a case to the table adds it to all
  four at once** — that is the point.

  Two things this bought immediately:

  - `read-scope-sql` — the compiler that lowers RLS read scopes for the analytics
    path — is now verified by **executing** its SQL against a real engine and
    comparing rows. It was previously only checked by asserting the emitted SQL
    string, whose ceiling is the author's own reading of SQL. It passes unchanged.
  - The table is a public export, so a third-party driver author can check a new
    backend against the same standard.

  **Deliberate scope:** logical combinators only. The predicates are boring on
  purpose — string equality, `$in`, `$ne`, `$gte`/`$lt`. Nothing here exercises
  null handling, dates, numeric coercion, `LIKE` escaping or case sensitivity,
  because those legitimately differ between a SQL engine and a JS matcher; folding
  them in would make the table unpassable rather than more useful. A case belongs
  in it only if **every** backend must agree.

- 1d4756e: fix(i18n)!: `/i18n/labels/:object/:locale` emits the entry shape it declares —
  and stops discarding `help`/`options` (#3847)

  `GetFieldLabelsResponseSchema` has always declared each label as an object:

  ```ts
  labels: z.record(
    z.string(),
    z.object({
      label: z.string(),
      help: z.string().optional(),
      options: z.record(z.string(), z.string()).optional(),
    })
  );
  ```

  Both serving surfaces emitted `Record<string, string>` — a bare label per field.
  A client typed against `GetFieldLabelsResponse` read `labels[field].label` and
  got `undefined`, because the value was the string itself. The SDK's type was
  right the whole time; the servers were wrong.

  The cost is not only the type mismatch. `FieldTranslationSchema` carries `help`
  and `options`, bundles populate them, and the endpoint threw them away. objectui
  needs exactly those — its `spec-translations.ts` transform reads `label` **and**
  `options` (as `fieldOptions.<obj>.<fld>.<value>`) — and gets them by pulling the
  whole bundle from `/i18n/translations/:locale` and resolving client-side. The
  per-object endpoint could not have served it even if it wanted to: the data was
  being dropped at the emit site.

  Fixed at that emit site, `resolveObjectFieldLabels`, which both surfaces already
  share as of #3833 — so one change covers both. `help` and `options` are attached
  only when non-empty: an `options: {}` would claim a field has translated options
  and hand back none, and a `help: ''` would erase a caller's source help text.
  Fields with no non-empty `label` are still omitted entirely, which is what lets
  `ResolvedFieldLabel.label` be a required string.

  **The response schema is unchanged** — this moves the implementation onto the
  contract, not the contract onto the implementation. Generated docs are
  byte-identical for that reason.

  `placeholder` is deliberately left out. `FieldTranslationSchema` has it and the
  response schema does not, so emitting it would be widening the contract rather
  than satisfying it — and adding an optional response field later is additive and
  non-breaking, whereas guessing now is not.

  The regression guard is the part worth keeping: a test that builds the response
  body from the shared helper and parses it with `GetFieldLabelsResponseSchema`.
  Nothing had ever put the emitted value and the declared contract in one
  assertion, which is precisely why a bare string could sit under an object schema
  unnoticed. Third and last of the declared ≠ enforced gaps on this endpoint
  family, after #3676 (request filters no server read) and #3833 (a derivation
  scanning a retired dialect).

  BREAKING: `labels[field]` is now `{ label, help?, options? }` rather than a
  string. No consumer in this repo or objectui read it — objectui never calls this
  route, and in-repo use is the SDK method plus URL-shape tests — so the practical
  blast radius is nil, and this is the cheap moment to align it.

- 720c5ad: fix(runtime,i18n): the dispatcher's field-labels route reads the bundle shape
  producers actually write — one shared derivation (#3833)

  `GET /i18n/labels/:object/:locale` served through the dispatcher returned
  `{ labels: {} }` for every provider. Its derivation scanned for flat
  `o.<object>.fields.<field>` keys:

  ```ts
  const prefix = `o.${objectName}.fields.`;
  for (const [key, value] of Object.entries(translations)) { … }
  ```

  That dialect was retired by #3778 — no producer has ever written it, and a real
  bundle's top-level keys are the `TranslationData` groups (`objects`, `apps`,
  `messages`, …), so the prefix could not match anything. 4cca74c fixed the
  identical derivation in `service-i18n` and did not reach the dispatcher's copy.

  This is not a rare fallback. `getFieldLabels` is optional on `II18nService` and
  **nothing implements it** — not `memory-i18n`, not `file-i18n-adapter` — so the
  dedicated-method branch both surfaces check first is dead in production and this
  derivation is the only path there is. Any stack served by the dispatcher (the
  AppPlugin in-memory provider auto-registered for stacks declaring translation
  bundles) got an empty map, indistinguishable from "this object has no translated
  labels": nothing errored, nothing warned.

  Worse than the class it was found next to. #3676, which prompted the check,
  ignored a declared filter and returned the full bundle — a correct superset. This
  returned nothing and said it was fine.

  The derivation now lives once, as `resolveObjectFieldLabels` in
  `packages/spec/src/system/i18n-resolver.ts`, alongside the other resolvers that
  read `TranslationData`. Both surfaces call it. Keeping a copy each is precisely
  how one got fixed and the other did not; the next bundle-shape change now has one
  place to land. Fields carrying no non-empty `label` stay omitted rather than
  emitted blank — partial translation is the normal state, and callers merge this
  map over their source labels, where a `''` would erase them.

  ### The tests were fiction on both sides

  The dispatcher's fallback test fed flat `o.contact.fields.first_name` keys and
  asserted labels came back, so it passed on data that cannot occur while
  production returned `{}` — the same failure mode as the client test retired in
  #3676, which asserted a query string was built that no server read. It now feeds
  the nested shape, and was confirmed to fail against the pre-fix code (`expected
{} to deeply equal { first_name: 'First Name', … }`) rather than merely passing
  after it. The shared helper carries its own unit tests, including one pinning
  that the retired flat dialect resolves to `{}`.

  The same suite's mock also declared a `getFieldLabels` no shipped provider has,
  and returned flat-dialect data from `getTranslations`; both now reflect what a
  real provider does, with the divergence noted where it remains deliberate.

  Not addressed here, filed separately: `GetFieldLabelsResponseSchema` declares
  `labels` as `Record<string, { label, help?, options? }>`, but both surfaces emit
  `Record<string, string>` — a third declared ≠ enforced gap in the same endpoint,
  and a wire-shape change too breaking to fold into a correctness fix.

- 41642b0: fix(runtime,i18n)!: `/i18n/locales` answers in one shape — plus the
  success-envelope conformance gate that found it

  Follow-up to #3676 / #3833 / #3847. Those three were each a body that did not
  match the schema declaring it, and each survived a green suite because **every
  test asserted the emitted body against a hand-written literal**. Comparing
  output to a literal proves the code does what the test author believed; it
  cannot prove the code does what the contract declares. Nothing had ever put the
  emitted value and the declared schema in the same assertion.

  This adds that assertion as a suite — `i18n-success-envelope.conformance.test.ts`
  in `runtime`, the missing success-path twin of service-i18n's
  `error-envelope.conformance.test.ts` and the same pairing storage got in #3689.
  Every `/i18n` success body is parsed against `BaseResponseSchema` and against
  the schema `plugin-rest-api` names for that route (`responseSchema:
'GetLocalesResponseSchema'`, …), imported rather than restated.

  **It found a fourth gap on its first run.** `GET /i18n/locales` passed
  `getLocales()`'s raw `string[]` straight through the dispatcher, while
  `GetLocalesResponseSchema` declares `{ code, label, isDefault }[]` — and
  service-i18n, the _other_ provider of this identical route, already emitted
  descriptors. One endpoint, two shapes, decided by which plugin mounted it, with
  the dispatcher's form contradicting the SDK's own `GetLocalesResponse` type.

  That is the same split #3833 found in the field-labels derivation, one route
  over, and it happened for the same reason: two surfaces, one mapping, kept
  twice. So the mapping is now shared as `toLocaleDescriptors` in
  `packages/spec/src/system/i18n-resolver.ts`, next to `resolveObjectFieldLabels`,
  and both surfaces call it. `label` is the locale code — no display-name source
  exists in the tree and the schema requires the field; inventing an ICU
  display-name table here would be a product decision, not an implementation
  detail.

  The gate was verified the same way #3833's was: the fix was reverted and the
  suite confirmed to fail on it —

  ```
  locales body does not match its declared schema:
    [{"expected":"object","code":"invalid_type","path":["locales",0],
      "message":"Invalid input: expected object, received string"}, …]
  ```

  — rather than merely passing once written. Five existing tests pinned the bare
  `string[]`; they now assert on `.map(l => l.code)`, so the codes stay pinned
  while the shape is owned by the schema.

  BREAKING: `GET /i18n/locales` served by the dispatcher now returns
  `[{ code, label, isDefault }]` instead of `['en', …]`. Callers on the
  service-i18n mount already received this shape, and the SDK's published
  `GetLocalesResponse` type has always described it, so this ends a divergence
  rather than starting one.

  Worth generalizing beyond `/i18n`: `plugin-rest-api.zod.ts` already carries a
  `responseSchema` name on essentially every route (29 declarations across 28
  handlers), so the route → declaring-schema mapping needed to run this check
  repo-wide exists today and is unused.

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

- 88ef03e: fix(spec,client)!: `GetTranslationsRequest` is locale-only — drop the
  `namespace` / `keys` filters no server ever read (#3676)

  `GetTranslationsRequestSchema` declared two optional filters, and the endpoint
  description promised one of them ("...for the specified locale and optional
  namespace"). Neither serving surface read either: the dispatcher domain body
  (`runtime/src/domains/i18n.ts`) takes `parts[1]` / `query.locale`, and
  service-i18n (`i18n-service-plugin.ts`) takes `req.params.locale`. Both return
  the locale's whole bundle. The SDK meanwhile put both on the query string, so a
  caller who passed `keys` to shrink the response shrank nothing and got no
  indication the filter was inert — Prime Directive #10's declared ≠ enforced, the
  same shape #1475 trimmed out of the validation-rule types.

  Trimmed rather than implemented, on three counts:

  - **No consumer.** No call site in this repo or `objectui` passed either field.
    The docs (`content/docs/api/client-sdk.mdx`, `skills/objectstack-i18n/SKILL.md`)
    already documented `getTranslations(locale)` as a full-bundle snapshot, so the
    schema was the outlier, not the docs. The one thing that did exercise them was
    a client test asserting the query string got _built_ — it pinned the phantom
    rather than any behaviour, since no server read what it asserted was sent. It
    is replaced here by its inverse: a regression test that the request carries no
    filter query at all.
  - **`keys` could not deliver what it advertises.** `II18nService.getTranslations`
    (`contracts/i18n-service.ts`) takes only `locale`, so a filter could only be a
    post-filter over an already-materialized bundle. `keys` reads as a payload
    optimization; a post-filter saves wire bytes but none of the server work, and
    widening the contract would break every implementer (`memory-i18n`,
    `file-i18n-adapter`) for a capability with no caller.
  - **`keys` has no defined meaning against the current bundle shape.** Under the
    retired flat `o.`-dotted dialect, `keys: ['o.account.label']` was an obvious
    pick. #3778 settled the tree on one nested `TranslationData` shape, where a
    flat `string[]` is neither a path set nor a group set, and a filtered response
    would have to be rebuilt as a sparse nested tree to stay schema-valid. That is
    a design decision, and nothing is waiting on it.

  `namespace` is the one that got _easier_ — it now lands exactly on
  `TranslationData`'s top-level groups, which is what its own description already
  said ("e.g., objects, apps, messages"). It is still trimmed here: re-adding an
  optional request field is additive and non-breaking the day the Studio's
  per-module views actually need it, whereas shipping an unexercised filter path
  now means dead code with tests to match, and a declared-but-unread field is
  precisely the exemplar the next author copies.

  BREAKING: the two schema fields and the `getTranslations(locale, options?)`
  second parameter are removed with no deprecation cycle. Nothing worked through
  them — a passed filter was silently ignored — so there is no behavior to
  protect. Runtime impact is nil (the fields were optional and now strip); TS
  callers passing them fail to compile, which is the intended signal.

- 9e2caf3: feat(spec): codify the IHttpServer soft extensions and unmatched-request semantics (#3607, ADR-0076 OQ#10 follow-up)

  Three behaviors every adapter already implements — locked until now only by
  the `@objectstack/http-conformance` cross-adapter suite — become formal
  contract on the interface: `IHttpResponse.write`/`end` (SSE/chunked
  streaming: headers flush on first write, no buffering until end, `end`
  required wherever `write` exists), `IHttpServer.getPort()` (real bound port
  after `listen()`, incl. ephemeral `listen(0)`), and the unmatched-request
  semantics (path-miss → 404 with the shared not-found body; method-miss →
  405 with an `Allow` header). All members optional with feature-detect
  guidance — zero behavior change, both adapters already conform; the
  conformance assertions now cite the contract instead of merely observing
  parity.

- 394b7a1: feat(job): honor the authored `retryPolicy` / `timeout` in the job scheduler (#3494)

  `JobSchema.retryPolicy` and `JobSchema.timeout` used to be parsed-but-ignored
  (the 2026-06 liveness audit's aspirational-config cluster). They are now
  enforced end to end — built rather than pruned, since retry/backoff and
  per-run time limits are semantics job authors reasonably expect:

  - **spec**: `IJobService.schedule` gains an optional 4th `options` argument
    (`JobScheduleOptions` with `retryPolicy` / `timeout`, mirroring the
    authorable schema); new `JobRetryPolicy` type. Backward compatible —
    existing 3-arg implementations and callers are unaffected.
  - **service-job**: new `runWithPolicy` helper (exported, with
    `JobTimeoutError`) wraps every handler invocation in `CronJobAdapter` and
    `IntervalJobAdapter`; `DbJobAdapter` threads options through to its inner
    adapters. Failed attempts (including timeouts) retry with exponential
    backoff `backoffMs * backoffMultiplier^(retry-1)` up to `maxRetries`;
    an attempt exceeding `timeout` is recorded with execution status
    `'timeout'`. No `options` → exactly the legacy single-attempt behavior.
  - **runtime**: declarative-jobs registration in AppPlugin forwards the
    authored `retryPolicy` / `timeout` to the scheduler.

  Note: JavaScript cannot forcibly cancel an in-flight handler — a timed-out
  attempt is abandoned, not killed. The retry delay caps only via the
  multiplier arithmetic (no maxDelay knob yet).

  Refs #3494, #1878, #1893.

- 677b591: feat(spec): `ListColumn` gains `prefix` and the `{ type, field }` `summary` form (objectui#2231)

  Two list-column capabilities the ObjectUI grid renderer has shipped for a while
  were missing from the protocol, so they lived on as a local `.extend()` in
  `@object-ui/types` — the exact fork-shaped drift objectui#2231 is closing. Both
  are now spec-owned:

  - **`prefix`** (`ColumnPrefixSchema`) — Airtable-style compound cells: render a
    second field inline before the cell value (e.g. a status badge in front of the
    record name), so a list carries two signals in one column.
    `{ field, type?: 'badge' | 'text' }`, `type` defaulting to `'text'`.
  - **`summary` object form** (`ColumnSummaryConfigSchema`) — `{ type, field? }`,
    for a footer that aggregates a field OTHER than the column's own (an `amount`
    column summing `amount_in_base_currency`). The shorthand `summary: 'sum'` is
    unchanged and remains the common case. `type` reuses `ColumnSummarySchema`, so
    both forms share one aggregation vocabulary and cannot drift apart.

  Additive and backward compatible: every previously valid `ListColumn` still
  parses. New exports: `ColumnPrefixSchema` / `ColumnPrefix` and
  `ColumnSummaryConfigSchema` / `ColumnSummaryConfig`.

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

- 2a5f04a: `<ObjectChart>` aggregate result-column naming is now a contract, and its axis bindings are validated (issue #3701)

  Split out of #3583 Phase 2 (#3684), which extended ADR-0021 axis checking to
  report charts, list-view charts, and dataset-bound page chart components but had
  to leave the react `<ObjectChart>` block out: it is OBJECT-bound (`objectName` +
  an inline `aggregate`), `aggregate` existed in the contract only as the
  description string `'{ field, function, groupBy }'`, and nothing in the repo said
  what the aggregated result columns were called. Without that, `xAxis`/`yAxis` had
  nothing to resolve against, and guessing a convention would have manufactured
  false positives (ADR-0072 D1).

  **The convention, recorded rather than invented.** Every path that can serve an
  object-bound chart already agreed — the engine's structured-`groupBy` aggregate
  (whose alias objectui sets to `field || function`), the legacy analytics query
  (which remaps its measure key back to `field`), the client-side fallback, and the
  console's own chart-view wiring (`xAxisKey: groupBy`, `series[].dataKey: field`).
  `packages/spec/src/ui/chart-aggregate.ts` writes it down and exports it:

  - an object-bound aggregate returns rows keyed by the **raw field names** —
    `groupBy` for the category column, `field` for the value column, the literal
    `count` for a fieldless count, plus `<field>__comparison` under a comparison
    overlay;
  - `chartAggregateCategoryKey` / `chartAggregateValueKey` / `chartAggregateResultKeys`
    derive those columns so producers and checkers cannot re-derive them apart;
  - `ChartAggregateSchema` replaces the description string with a real Zod schema
    and rejects a non-`count` function with no `field` (which used to reach the
    renderer as `sum(undefined)` and render blank).

  This is the deliberate opposite of the dataset path, whose rows are keyed by the
  declared measure `name` (`sum_amount`) — the trap `chart-measure-unknown` catches.
  Only the dataset path has an author-chosen name to key by.

  **`<ObjectChart>`'s contract now names the props it actually reads.** The block
  consumes `xAxisKey` and `series[].dataKey`; `ChartConfig`'s `xAxis`/`yAxis`/`series`
  shapes reached it and were silently dropped, which ADR-0078 forbids. They are
  removed from the block's `dataProps`; `chartType`, `xAxisKey`, and `series` are
  declared in the React overlay where the other bindings live.

  **`validate-react-page-props` now reads attribute VALUES**, not just names, for
  `<ObjectChart>`:

  - `react-chart-field-unknown` (error) — `aggregate.field` / `aggregate.groupBy`
    naming a field the bound object does not declare;
  - `react-chart-aggregate-invalid` (error) — an unimplemented aggregation
    function, or a non-`count` function with nothing to aggregate;
  - `react-chart-axis-unknown` (error) — `xAxisKey` / `series[].dataKey` naming a
    column the aggregate does not return (including a dataset-style `sum_total`),
    or a category axis bound to the value column;
  - `react-chart-axis-inert` (warning) — the `xAxis` / `yAxis` shapes this block
    never reads.

  Value reading is opt-in per block and evaluates only static literals: a prop
  driven by React state or a variable, a usage carrying a `{...spread}`, a chart
  given inline `data`, and objects another package defines are all skipped
  silently — an unresolvable binding is not a wrong one.

- 4f740b0: `<ObjectChart>`'s author contract is the spec `ChartConfig` shape again (issue #3729)

  #3701 trimmed `xAxis`/`yAxis`/`series` out of the `<ObjectChart>` contract
  because the renderer read `xAxisKey`/`series[].dataKey` and silently dropped the
  ChartConfig shapes — an honest record of the runtime gap, not the target state.
  objectui#2880 closed the gap the other way round (the renderer now honors
  `ChartConfig` through one normalization boundary), so the contract follows the
  protocol again (ADR-0082 D1: the spec schema IS the protocol).

  **Contract.** `type`, `xAxis`, `yAxis`, `series`, `subtitle`, `showDataLabels`,
  `annotations` and `interaction` are published from `ChartConfigSchema`; the
  internal `chartType`/`xAxisKey`/`series[].dataKey` spellings leave the author
  contract. `annotations` and `interaction` gained the `.describe()` they never
  had, so the generated contract stops publishing bare `object[]` with no meaning.

  **The `type` exception.** `ChartConfig.type` is the chart family, but on any
  surface that flattens chart config into a props bag `type` is already the SDUI
  envelope's component discriminator — an author writing `type="bar"` used to
  replace `object-chart` and the block stopped resolving. The collision is created
  by the flattening and is resolved there (objectui's react-page wrapper), so the
  contract can publish `type` as the spec spells it. The contract generator's
  blanket `type` skip is now overridable by an explicit `dataProps` allow-list,
  since for this one block `type` is a real author prop.

  **Lint.** `validate-react-page-props` reads the axes in the spec spelling —
  `xAxis.field`, `yAxis[].field`, `series[].name` — and keeps accepting the
  internal spellings silently, because dashboards and the console's own chart-view
  wiring emit them. `react-chart-axis-inert` is retired: the props it warned about
  are honored now, so the warning would be false. The three binding-integrity
  rules from #3701 are unchanged.

  **Spec.** `chart-aggregate.ts` records the constraint the whole result-column
  convention rests on: an inline `aggregate` is SINGLE-MEASURE. Keying rows by the
  raw field name only works because there is exactly one measure to key; two
  measures over one field would collide, and resolving that needs an author-chosen
  name per measure — which is what a dataset is. Widening `ChartAggregateSchema`
  into a measures array would silently invalidate every axis binding these rules
  validate, so the boundary is now written down rather than left to be rediscovered.

  The chart taxonomy note is corrected too: grouped/stacked bar and stacked area
  are absent from `ChartTypeSchema` not because they render as their base chart,
  but because stacking is a property of the SERIES (`ChartSeries.stack`), not a
  chart family — one `bar` family plus a series stack group expresses all three.
  `ChartInteraction.zoom` is now marked declared-not-delivered in its own
  description rather than reading as shipped.

- 67452d1: feat(spec): resolve page metadata i18n — `page:header` title/subtitle (#3589)

  Custom system pages authored as metadata (Installed Apps, Cloud Connection,
  Connect an Agent) hard-code their `page:header` copy in
  `properties.title` / `properties.subtitle`. Every other metadata type is
  localized at the REST boundary, but `page` was not: the `pages` namespace
  existed only on `AppTranslationBundleSchema` — a schema no runtime reads —
  with no resolver behind it, so those headers stayed English in every locale
  while the matching nav labels translated correctly.

  - `TranslationDataSchema` (the shape the i18n service actually serves) gains a
    `pages` namespace: `pages.<name>.{label,description,title,subtitle}`.
  - New `translatePage` in `@objectstack/spec/system` translates a page's own
    `label` / `description` and overlays `title` / `subtitle` onto every
    `page:header` in the page's regions. Registered in
    `translateMetadataDocument`, so it rides the existing read path.
  - `page` added to the REST boundary's `TRANSLATABLE_META_TYPES`. Locale
    extraction, the locale-keyed ETag, and `Vary: Accept-Language` already
    covered every metadata type — no new plumbing.
  - `objectstack i18n extract` now emits page entries, including the
    `page:header` copy, so the new namespace is not invisible to the tooling.
  - zh-CN / ja-JP / es-ES translations shipped for the three Setup pages, plus
    the missing `nav_cloud_connection` / `nav_connect_agent` nav labels (these
    existed only in zh-CN).

  Header copy is keyed by **page name**, not by component id: `page:header`
  instances carry no stable id. `title` falls back to `pages.<name>.label`, since
  a page's header title and its nav label are normally the same string.

  Authoring is unchanged and English literals stay in metadata as the fallback —
  a page with no `pages` entry renders exactly as before. Consumers of
  `@object-ui` need no change: pages arrive already localized from the server.

- 605e190: feat(spec)!: prune the still-dead aspirational config from Theme / Translation / Webhook (#3494)

  Removes the authorable-but-never-consumed props confirmed dead by the 2026-06
  liveness audit (follow-up to #1878/#1893; same treatment as the #2377 and
  #3464 prunes). Authoring any of these was a silent no-op.

  ## Removed

  **Theme** (`ThemeSchema`) — the theme engine (objectui `generateThemeVars`)
  never emitted or consumed them:

  - Props: `spacing`, `breakpoints`, `logo`, `density`, `wcagContrast`, `rtl`,
    `touchTarget`, `keyboardNavigation`
  - Exports: `SpacingSchema`, `BreakpointsSchema`, `DensityModeSchema` (+
    deprecated `DensityMode` alias), `WcagContrastLevelSchema` (+ deprecated
    `WcagContrastLevel` alias), and the `Spacing` / `Breakpoints` /
    `DensityMode` / `WcagContrastLevel` types

  **Translation** (`TranslationConfigSchema`) — no runtime reader; there is no
  ICU engine and interpolation is always simple `{variable}` substitution:

  - Props: `fileOrganization`, `messageFormat`, `lazyLoad`, `cache`
  - Exports: `MessageFormatSchema`, `TranslationFileOrganizationSchema`, and the
    `MessageFormat` / `TranslationFileOrganization` types

  **Webhook** (`WebhookSchema`) — the delivery path always sends its own fixed
  envelope and only applies HMAC signing via `secret`; delivery retries are owned
  by the messaging outbox's fixed schedule:

  - Props: `body`, `payloadFields`, `includeSession`, `authentication`
    (bearer/basic/api-key were never attached; HMAC via `secret` stays),
    `retryPolicy`, `tags`
  - Exports: the entire inbound `WebhookReceiverSchema` + `WebhookReceiver` type
    (never consumed by any runtime)

  ## Migration

  Delete these keys from your configs — they never did anything, so removing
  them changes no behavior. Parsed output no longer contains the previously
  defaulted keys (`includeSession: false`, `fileOrganization: 'per_locale'`,
  `messageFormat: 'simple'`, `lazyLoad: false`, `cache: true`). Webhook HMAC
  signing (`secret`), `headers`, and `timeoutMs` are unaffected. File layout for
  translations remains a pure authoring convention — no config knob needed.

  ## Deliberately NOT removed

  - Translation `supportedLocales` — it has a live reader (pinyin-search
    capability toggle in `serve.ts`).
  - Job `retryPolicy` / `timeout` — being implemented (built, not pruned) in the
    #3494 follow-up PR.
  - The materialized webhook props (`name`, `object`, `triggers`, `url`,
    `method`, `headers`, `timeoutMs`, `secret`, `isActive`, `description`,
    `label`) — live via the #3489 bridge; ledger flip tracked in #3490.

  Refs #3494, #1878, #1893.

- c6c59f1: feat(spec)!: remove the dead `AuditConfig` cluster from `@objectstack/spec/system` (#1878 recheck loose-end)

  The entire `system/audit.zod.ts` module — `AuditConfigSchema`,
  `AuditStorageConfigSchema`, `AuditRetentionPolicySchema`,
  `AuditEventFilterSchema`, `SuspiciousActivityRuleSchema`,
  `DEFAULT_SUSPICIOUS_ACTIVITY_RULES`, and the `AuditEvent` /
  `AuditEventActor` / `AuditEventTarget` / `AuditEventChange` /
  `AuditEventType` / `AuditEventSeverity` shape schemas (plus all their
  type exports) — is removed. Verified zero consumers repo-wide: the live
  audit path (`plugin-audit`) imports none of it, defines its own
  `sys_audit_log` row shape, and captures **unconditionally** via engine
  hooks, so `AuditConfigSchema.enabled: false` advertised a semantic
  (turning the compliance ledger off) the platform deliberately rejects.
  Same ADR-0056 D8 family as the earlier `compliance.zod` / `masking.zod` /
  `RLSAuditConfig` / `PolicySchema` removals: security/compliance-shaped
  config must never merely look live.

  **Migration — every dead knob maps to a live surface (or is deliberately
  not configurable):**

  | Removed (never enforced)                                                          | Live replacement                                                                                                         |
  | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
  | `AuditConfigSchema.enabled`                                                       | none — audit capture is **always on** (compliance ledger; `object.zod` `trackHistory` contract)                          |
  | `eventTypes` / `excludeEventTypes` / `minimumSeverity` / `AuditEventFilterSchema` | none today — if event filtering ships it lands as an `audit` **settings** namespace (ADR-0069 pattern), not app metadata |
  | which fields/objects are summarized + History tab UI                              | object-level + field-level **`trackHistory`** (live, enforced by plugin-audit)                                           |
  | `AuditRetentionPolicySchema` / `storage`                                          | object **`lifecycle`** `audit` category (retain → archive → delete) + per-org settings overrides (ADR-0057)              |
  | `SuspiciousActivityRuleSchema` / `DEFAULT_SUSPICIOUS_ACTIVITY_RULES`              | none — no detection engine exists; security monitoring is org-operations tooling, not app-package metadata               |
  | `AuditEvent*` shape schemas                                                       | the `sys_audit_log` object definition in `plugin-audit` is the row-shape source of truth                                 |

  No first-party, example, or downstream-contract code imported any of
  these symbols; `defineStack` never accepted an `audit` key, so no stack
  config changes. Docs page `references/system/audit.mdx` is removed by
  regeneration; the security-context module doc now marks audit alongside
  the previously removed compliance/masking subsystems.

- b0e78a8: feat(spec)!: remove the dead static capabilities-descriptor cluster (`ObjectQL`/`ObjectUI`/`Kernel`/`ObjectStack`/`ObjectOS CapabilitiesSchema`) (#1878 family)

  The "RUNTIME CAPABILITIES PROTOCOL" tail of `stack.zod.ts` — `ObjectQLCapabilitiesSchema`,
  `ObjectUICapabilitiesSchema`, `KernelCapabilitiesSchema`, `ObjectStackCapabilitiesSchema`,
  the deprecated `ObjectOSCapabilitiesSchema` alias, and all five inferred types — is
  removed. Verified zero consumers repo-wide (framework, objectui apart from bare
  re-exports, cloud, downstream-contract): it was never authorable (`defineStack` has
  no such key), never registered, and never fed any endpoint.

  Worse than dead, it **lied**: the fixed-boolean self-portrait defaulted
  `fieldLevelSecurity` / `rowLevelSecurity` / `auditLogging` / `backgroundJobs` to
  `false` while every one of those is live and enforced on the platform, and
  advertised `odataApi` which has never existed. An AI reading the schema would
  build a systematically wrong model of the platform.

  **Migration — runtime capability discovery is dynamic, not a static schema:**

  | Removed                                                                       | Live replacement                                                                                                                                                                                         |
  | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `KernelCapabilitiesSchema` booleans (`restApi`/`websockets`/`auditLogging`/…) | `GET /api/v1/discovery` — dynamic `capabilities` record with **declared === enforced** discipline (#3298: a capability is advertised only when the route is actually mounted AND the engine supports it) |
  | `WellKnown`-style backend feature probes                                      | `WellKnownCapabilitiesSchema` (`@objectstack/spec/api` discovery contract: `comments`/`automation`/`cron`/`search`/…)                                                                                    |
  | `ObjectQLCapabilitiesSchema` driver/query booleans                            | driver-level `DriverCapabilities` / `DatasourceCapabilities` (`@objectstack/spec/data`) — per-connection, resolved at runtime                                                                            |
  | `ObjectStackCapabilitiesSchema` layer roll-up + `ObjectOS*` aliases           | none — no replacement import                                                                                                                                                                             |

  The objectui `@object-ui/types` re-exports of these symbols are dropped in the
  companion objectui change. `ClusterCapabilityConfigSchema` / `FeatureFlagSchema` /
  `ApiEndpointSchema` (referenced by the dead cluster) are untouched — they live in
  their own modules and `ApiEndpointSchema` remains consumed by the stack `apis` key.

- f31cc8d: refactor(spec)!: finish the 2026-06 field prune — drop both orphaned value schemas, `DataQualityRulesSchema` and `ComputedFieldCacheSchema` (#3726, #3733)

  **BREAKING** (the `!` marker and this changeset are the breaking-change record;
  the train ships as the v17 major — see the `v17-rc-anchor` changeset), though
  nothing in-tree or out could have depended on either meaningfully. Removed from
  the `@objectstack/spec` public surface:

  - `DataQualityRulesSchema` (const), `DataQualityRules` (type), `DataQualityRulesInput` (type) — #3726
  - `ComputedFieldCacheSchema` (const), `ComputedFieldCache` (type) — #3733

  and the published `data/DataQualityRules.json` / `data/ComputedFieldCache.json`
  JSON Schemas.

  **Why.** Five field keys were pruned in 2026-06 — `encryptionConfig`,
  `maskingRule`, `auditTrail`, `cached` and `dataQuality` — as "dead in both
  layers, aspirational governance with no runtime consumer" (see
  `docs/audits/2026-06-dead-surface-disposition-plan.md`, P0/P2 field prune).
  Three of the five took their value schemas with them. Two did not: `dataQuality`
  and `cached` each lost their key from `FieldSchema` while
  `DataQualityRulesSchema` / `ComputedFieldCacheSchema` stayed on the published API
  surface and in the generated reference docs, with zero consumers anywhere in the
  tree. The tombstone claimed "dead in both layers"; for these two it was true of
  only one.

  That middle state is the worst of the three available (key + schema + consumer /
  none of them / schema only), and it failed quietly rather than loudly.
  `FieldSchema` is **not** `.strict()`, so an author who found either type in the
  reference docs and wrote `dataQuality: { uniqueness: true }` or
  `cached: { enabled: true, ttl: 3600 }` got no error at all — the field parsed
  clean and the key was silently stripped, leaving a rule that was declared in
  source, absent from the contract, and enforced by nothing. That is the ADR-0104
  failure class, the same one the `accept` / `maxSize` declarations were added to
  close.

  Each had its own sharp edge. `DataQualityRules.uniqueness`, described as "Enforce
  unique values across all records", reads exactly like the platform-wide scope
  that `unique: 'global'` actually provides (#3696), making it the option an author
  was most likely to reach for by mistake. `ComputedFieldCache` was quieter and
  therefore harder to catch: an author writing `ttl: 3600` on a formula field would
  believe results were cached for an hour, get no error, and never see a signal
  that nothing had happened.

  **Migration.** There is no runtime behavior to migrate — neither schema was ever
  reachable from `FieldSchema`, and neither had a consumer in-tree. For per-field
  uniqueness use `unique` (`true` = unique within the tenant, `'global'` = unique
  platform-wide; see #3696). `completeness`, `accuracy`, and computed-field caching
  (`enabled` / `ttl` / `invalidateOn`) have no replacement; none was ever
  implemented.

  If field-level data-quality governance or computed-field caching is built for
  real later, re-add the field key and its schema **together, with a consumer** —
  the enforce side of enforce-or-remove (ADR-0049). A tombstone in `field.zod.ts`
  records this so neither schema is restored on its own again.

- f343dc4: feat(spec)!: remove the orphaned `FeatureFlagSchema` module (`@objectstack/spec/kernel` feature.zod)

  Follow-through of the capabilities-descriptor prune (#3605). `kernel/feature.zod.ts`
  (`FeatureStrategy`, `FeatureFlagSchema`, the `FeatureFlag` factory and its
  `FeatureFlag` / `FeatureFlagInput` types) had **zero runtime consumers**, and its
  only protocol home — the static `ObjectStackCapabilities.system.features`
  descriptor — was itself removed as dead in #3605 (no endpoint ever served it).
  The module was a compile-checkable shape with nowhere to go: not authorable
  (`defineStack` has no `features` key; strict parsing strips it), not registered,
  not read by any engine.

  **Migration — flags are runtime configuration, not authored metadata:**

  | Removed                                                                                                  | Live replacement                                                                                                                                                              |
  | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `FeatureFlagSchema` / `FeatureFlag.create()` rollout documents (strategies, percentage/group conditions) | the `feature_flags` **settings manifest** (`@objectstack/service-settings`, ADR-0007) — org-tunable `ai_enabled` / `beta_*` toggles, env-overridable via `OS_FEATURE_FLAGS_*` |
  | deployment-level capability gating                                                                       | `PUBLIC_AUTH_FEATURES` registry (`kernel/public-auth-features.ts`) + `requiresFeature` sugar on actions/params (unchanged, live)                                              |
  | runtime capability discovery                                                                             | `GET /api/v1/discovery` (dynamic, declared === enforced)                                                                                                                      |

  Docs regenerated (`references/kernel/feature.mdx` removed); the platform skill's
  Feature Flags section and the hand-written quick-reference row now point at the
  settings surface; `PROTOCOL_MAP.md` row dropped.

- 8269e32: feat(spec)!: remove the dead PortalSchema (portal metadata was never enforced)

  `PortalSchema` and its top-level `portals` collection on `StackSchema` were a
  forward-looking design that was **never wired to a runtime** — no metadata-type
  registration, no dispatcher route family, no auth scope, and no
  LayoutDispatcher / NavigationBuilder / ThemeProvider ever consumed it. Authoring
  a portal was already documented as a no-op and marked
  `[EXPERIMENTAL — not enforced]`. This removes the dead schema rather than
  building a portal runtime (issue #3464, disposition **A — prune**).

  **Removed exports** (`@objectstack/spec`, from `ui/portal.zod`):
  `PortalSchema`, `Portal`, `definePortal`, and the `PortalInput` /
  `PortalTheme` / `PortalNavItem` (+ `PortalViewNavItem`, `PortalActionNavItem`,
  `PortalDashboardNavItem`, `PortalUrlNavItem`) / `PortalAnonymousEntry` /
  `PortalAnonymousRoute` / `PortalRateLimit` / `PortalSeo` / `PortalAuthMode` /
  `PortalLayout` schemas and inferred types. The `portals` key is removed from
  `StackSchema` / `defineStack()`.

  **Migration**: none required for behavior — authoring a portal had no runtime
  effect. Any `portals: [...]` entry in a `defineStack()` config was already
  ignored at runtime and should be deleted (with the schema gone it is an
  excess-property type error). To project a scoped UI to external users today,
  compose the existing `apps` / `views` surfaces and gate admission with
  `positions` + permission sets (`externalSharingModel` on the objects you
  expose).

  Refs #3464, #1893, #1878.

- 74f7339: feat(spec)!: prune the dead `aria` / `performance` props from ReportSchema (report-liveness close-out)

  Follow-up to the #3463 report cleanup. The 2026-06 ReportSchema liveness audit
  flagged `aria` and `performance` as dead — declared on `ReportSchema` (and
  editable in the Studio report form) but read by **no renderer**. This removes
  them. Every other finding from that audit is now closed too: `chart` turned out
  to be **live** (`DatasetReportRenderer` plots `chart.xAxis`/`yAxis` via
  `DatasetReportChart`), and the obsolete sub-schemas / naming-drift / joined-preview
  items were resolved by #3463 and earlier work.

  - Removed `ReportSchema.aria` (`AriaPropsSchema`) and `ReportSchema.performance`
    (`PerformanceConfigSchema`), dropping the now-orphan imports. Both schemas
    remain exported and are still used by other metadata types (views, pages,
    charts) — only the report's use of them is removed. `ReportChart` keeps its
    own `aria` (inherited from `ChartConfigSchema`).
  - No manifest key or public export changes (`aria`/`performance` were properties,
    not schemas); `report.mdx` regenerated.

  **Migration**: nothing an author writes changes — no first-party or example
  report set `aria`/`performance`. Reports carry no ARIA/performance overrides;
  use the dataset/view surface for those concerns. Ships as `minor` per the
  launch-window breaking-as-minor policy.

- a6c35a2: feat(spec)!: prune the dead `ReportColumnSchema`/`ReportGroupingSchema` exports + the unread report chart `groupBy` (#3463, #1878/#1890)

  Deep-cleanup close-out of the report-chart disposition (follow-up to #3441).
  After the ADR-0021 single-form cutover a dataset-bound report expresses its
  columns/grouping as dataset **measure/dimension name arrays** — `values`,
  `rows` and `columns` are `z.array(z.string())`, not object literals — so
  `ReportColumnSchema` / `ReportGroupingSchema` were referenced by **no schema
  body**. They survived only as public type exports and were marked
  `@deprecated` in #3441; this removes them.

  - Deleted `ReportColumnSchema` / `ReportGroupingSchema` and their type
    exports `ReportColumn` / `ReportGrouping` / `ReportColumnInput` /
    `ReportGroupingInput` from `@objectstack/spec/ui`. The manifest ratchet
    keys `ui/ReportColumn` / `ui/ReportGrouping` are dropped in the same PR.
  - Deleted `ReportChart.groupBy` — the `[EXPERIMENTAL — not enforced]`
    series-split field flagged in #3441. The dataset-bound `DatasetReportRenderer`
    plots a single `xAxis`×`yAxis` series and never read it; only the retired
    legacy `ReportViewer` fallback ever consumed a top-level `groupBy`.
    `ReportChartSchema` is non-strict, so any residual `chart.groupBy` in stored
    metadata is silently stripped on parse — no tombstone needed.
  - Regenerated `content/docs/references/ui/report.mdx` and the spec API-surface
    snapshot.

  **Migration**: nothing an author writes changes.

  - No first-party or example report authored `ReportColumn` / `ReportGrouping`
    objects or `chart.groupBy` — a dataset-bound report already expresses
    columns as `values` (measure names) and grouping as `rows` / `columns`
    (dimension names).
  - TypeScript consumers importing `ReportColumn` / `ReportGrouping` /
    `ReportColumnInput` / `ReportGroupingInput` (or the `*Schema` values) from
    `@objectstack/spec/ui` have no replacement type — model report columns as
    the dataset's measure names and grouping as its dimension names. objectui's
    `SpecReportColumn*` / `SpecReportGrouping*` re-exports are removed in the
    companion objectui change.

- c2f1002: feat(spec)!: remove `SkillSchema.permissions` — it never gated anything (#3686)

  Owner decision on the enforce-or-prune call filed in #3686: **prune**.

  `skill.permissions` was declared, surfaced in the Studio authoring form under a
  section labelled _"Access — Required permissions to use this skill"_, and echoed
  by the objectui preview — but **no runtime ever read it**. The cloud
  `SkillRegistry` selects skills by `active` / `triggerConditions` / `tools` only.
  A security-shaped field that enforces nothing is worse than no field: it invites
  an author (or an AI) to believe a skill is gated when it is not. Same disposition
  as agent `visibility` (#1901) and the `PolicySchema` tree (#2387).

  Removed: the schema property, the form's whole `Access` section (it existed only
  for this field), its generated i18n keys, the liveness-ledger entry, and the
  `permissions` line from the objectstack-ai skill doc's `os:check` example. The
  objectui preview's "Required Permissions" panel is removed in the companion
  objectui change.

  **Migration** — gate access where it is actually enforced:

  - **Agent level** — `access` / `permissions` on `defineAgent` ARE enforced at the
    chat route (403 for a caller missing any of them, #1884). Bind the restricted
    skill only to a restricted agent.
  - **Action level** — gate the underlying actions the skill's tools invoke via
    permission sets (ADR-0066).

  `SkillSchema` is non-strict, so an existing `permissions:` key is silently
  stripped on parse rather than rejected — no boot break, but it stops appearing
  anywhere.

- f163028: Reference-integrity validation for object and action names (issue #3583)

  A HotCRM audit found ~20 shipped instances of one bug class — metadata naming
  something that does not exist — all passing `objectstack validate` / `lint`
  cleanly and failing silently at runtime. This closes the object-name and
  action-name half of that class.

  **New — `@objectstack/spec`:** `PLATFORM_PROVIDED_OBJECT_NAMES`, a curated
  registry of every object name contributed by a platform package, official
  plugin, or the cloud runtime, plus `isPlatformProvidedObjectName()` and
  `hasPlatformObjectPrefix()`. This replaces the `startsWith('sys_')` prefix guess
  that could not tell `sys_user` (real) from `sys_approval_process` (fictional —
  removed by ADR-0019, registered by nothing), which is why every fictional
  platform-prefixed reference shipped. A conformance test scans each package's
  `*.object.ts` declarations and fails if the registry drifts.

  **New lint rules** (wired into both `os validate` and `os lint`):

  - `validate-object-references` — action-param `reference` / `objectOverride`,
    dashboard `globalFilters[].optionsFrom.object`, and navigation
    `requiresObject` gates. Severity follows resolvability: an unresolved
    _unprefixed_ name is a typo (**error** — `object: 'user'` where the platform
    object is `sys_user`); an unresolved _platform-prefixed_ name is **advisory**,
    since a third-party package may still provide it.
  - `validate-action-name-refs` — the surfaces that bind an action BY NAME:
    list-view `bulkActions` / `rowActions`, page `record:quick_actions`
    `actionNames`, and nav action items. A name matching no defined action is an
    **error** (the button renders and does nothing), matching the existing
    dashboard-action-target rule.

  **Fixes:**

  - `defineStack` cross-reference validation now walks `app.areas[].navigation` —
    an areas-based app previously got no navigation checking at all — and recurses
    into `children` on `object` nav items, not only `group` ones.
  - `os lint` i18n coverage now reads field `options` in the canonical
    `{value,label}[]` array shape; it only handled the record map, so option-label
    coverage silently never fired for canonically-shaped select fields.
  - Hook `condition` expressions are now field-checked when `object` is an ARRAY
    of targets (previously only a single string target was checked, so a
    multi-target hook filtering on a nonexistent field passed clean). Per-target
    diagnostics are de-duplicated.
  - A dashboard widget binding no `dataset` at all is now reported instead of
    silently bypassing every binding and chart check on the raw-config
    (`lint`/`doctor`) paths. `dataset` is schema-required, so this matches what
    the parsed paths already enforce.

- 7ffc3d3: feat(client,spec)!: delete the 21 dead SDK methods and the four ghost route
  tables that underwrote them (#3612, #3587 finding)

  Five client surface families built URLs that exist on NO server surface —
  not the dispatcher, not `@objectstack/rest`, not the autonomous service
  mounts — so every call was a guaranteed 404:

  - `permissions` (check, getObjectPermissions, getEffectivePermissions)
  - `realtime` (connect, disconnect, subscribe, unsubscribe, setPresence,
    getPresence) — `service-realtime` registers zero HTTP routes and the
    dispatcher deliberately never advertises `/realtime`
  - `workflow` (getConfig, getState, transition)
  - `views` CRUD (list, get, create, update, delete) — no `/ui/views` route
    anywhere
  - `notifications` device/preference helpers (registerDevice,
    unregisterDevice, getPreferences, updatePreferences) — the ADR-0012
    server side was never built

  Each family was underwritten only by an unconsumed spec `DEFAULT_*_ROUTES`
  table — the same disease `DEFAULT_DISPATCHER_ROUTES` had (#3586) — so
  `DEFAULT_PERMISSION_ROUTES`, `DEFAULT_VIEW_ROUTES`, `DEFAULT_WORKFLOW_ROUTES`,
  and `DEFAULT_REALTIME_ROUTES` are deleted with them;
  `getDefaultRouteRegistrations()` now returns 9 registrations.
  `ApiRouteType` loses its client-only `'views' | 'permissions'` extras.

  Kept: `client.events` (explicitly local in-memory buffer, no HTTP),
  `notifications.list/markRead/markAllRead` (dispatcher-served),
  `approvals.*` (ADR-0019 — the real approval decision API), and
  `meta.getLegalNextStates` (the real FSM read).

  Breaking for anyone calling the removed methods — a repo-wide and
  objectui-wide sweep found one consumer (`useClientNotifications`'s dead
  device/preference delegates, trimmed in the objectui companion change);
  shipped as minor per the launch-window convention (cf. #3562/#3581/#3595).
  Re-adding any of these surfaces requires the server route to exist and a
  route-ledger row proving it (#3569/#3609 guards).

- 88346ba: feat(spec)!: remove the dead `object.enable.trash` / `enable.mru` capability flags (#2377, ADR-0049 enforce-or-remove — close-out)

  Both flags parsed and defaulted to `true` but had **no runtime consumer**:
  every delete has always been a hard delete (no recycle bin), and no MRU
  tracking was ever implemented. A default-true flag promising recoverability
  is the worst kind of false affordance — first-party objects were authoring
  `trash: false // Never soft-delete audit logs` in the belief that a
  soft-delete existed to opt out of.

  - `ObjectCapabilities` is now **`.strict()`** (pattern of the tenancy block,
    #2763): an unknown `enable` key — the retired `trash`/`mru` or a typo like
    `feedEnabled` — fails parse with upgrade guidance instead of stripping
    silently (#1535). The retired-key tombstones live in
    `CAPABILITIES_RETIRED_KEY_GUIDANCE`.
  - ~45 first-party object definitions (platform-objects, plugin-security,
    plugin-audit, plugin-approvals, plugin-sharing, metadata-core,
    service-realtime, examples) dropped their inert `trash:`/`mru:` lines.
  - Liveness ledger: both entries deleted (removal precedent: `tags`/
    `recordName`); object row in the README count table now shows **0 dead**.
  - Docs + skills no longer advertise a recycle bin / MRU tracking; the API
    skill's "DELETE is soft-delete when `trash: true`" claim is corrected to
    the real contract (hard delete; use per-field `trackHistory` or a
    `lifecycle` policy for recoverability).

  **Migration**: delete any `enable.trash` / `enable.mru` keys from object
  metadata — they never changed behavior. `ObjectSchema.create()` /
  `ObjectCapabilities.parse()` now reject them with this prescription. A real
  recycle bin or MRU feature, if built, returns as a live enforced flag
  (#1893 prune-or-build).

- 4631592: feat(spec)!: remove the never-implemented GraphQL surface from the product plan (#2462 follow-on)

  GraphQL was schema-only from day one: the spec shipped 20+ config schemas
  (`GraphQLTypeConfig`, federation, persisted queries, …), the dispatcher's
  `handleGraphQL` answered 501 unconditionally (`kernel.graphql` was never
  assigned in the monorepo), and THREE separate mounts advertised the dead
  endpoint. Per the product decision, the surface is deleted rather than
  maintained:

  - **spec**: `api/graphql.zod.ts` + `contracts/graphql-service.ts` deleted;
    `graphql` removed from `CoreServiceName`, `ApiProtocolType`, the
    query-adapter dialects, `graphql-playground` from testing-UI types; the
    `graphqlApi`/network capability booleans, discovery/router route fields
    dropped. Breaking for consumers referencing those exports/enum members (shipped as minor per the launch-window convention, cf. #3486/#2377).
  - **runtime**: `handleGraphQL`, the if-chain branch, the dispatcher-plugin
    and hono-adapter mounts, discovery advertisement, and the now-dead
    `resolveRequestExecutionContext` helper removed.
  - **plugin-dev**: the graphql stub family removed.
  - **qa**: authz-conformance matrix rows, ratchet high-risk id, discover
    patterns and identity pins for the GraphQL surface retired; expression
    ledger covers updated.
  - **NOT removed**: the `'graphql'` protocol option on external datasource
    lookups (third-party systems may speak GraphQL) and cloud's reserved
    slug — those are not our API surface.

  `/graphql` now 404s (was an unconditional 501); the anonymous-deny posture
  matrix shrinks by the two GraphQL rows.

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

- 93f267f: fix(automation): one chokepoint for the resume signal — `output` reopened the hole `inputs` had just closed (#3879)

  #3853 guarded `signal.variables` at the route. That closed one of **two**
  equivalent paths into the same variable map and left the other open:
  `signal.output` keys are merged under `${run.nodeId}.${key}`, and for a run
  parked on a `map` node `run.nodeId` **is** the map node — so

  ```jsonc
  {
    "output": { "$mapItemDone": true, "$mapItemOutput": { "result": "FORGED" } }
  }
  ```

  writes exactly the `<mapNodeId>.$mapItemDone` the `inputs` guard had refused,
  making the map record a result for an item nobody decided. Demonstrated with a
  repro, then fixed.

  Scope: the #3853 map gate still held, so a batch whose pending item sits on an
  `approval` was refused before any of this — the **approval bypass stayed
  closed**. The residual was forging the recorded result of an item on an
  _ungated_ pause.

  Two escapes with one shape is a design signal, not two bugs, so the fix is
  structural rather than a third patch:

  - **`applyResumeSignal` is the one place a resume signal reaches the variable
    map.** Both fields are collected into a single write list (already in final,
    prefixed form), checked, then applied — a new signal field is covered by
    construction rather than by remembering.
  - **All-or-nothing**, and checked _before_ the suspension is consumed: a
    rejected signal applies nothing (not even legitimate keys sent alongside) and
    the run stays parked, so the real continuation still lands.
  - **The engine owns the rule; the transport maps the verdict.** `resume` returns
    `{ success: false, code: 'invalid_signal' }`; the route answers **400**. The
    SDK and any future adapter inherit it — implemented in one transport it
    protected exactly one transport, and one field of it.
  - Engine-built signals (the subflow output mapping, the map item handoff) are
    exempt via a module-private symbol. Deliberately _not_
    `RESUME_AUTHORITY_SERVICE`: that marker means "the owning service authorized
    this decision", and a service still has no business writing engine internals.

  `AutomationResult.code` gains `'invalid_signal'` alongside `'forbidden'` — a
  `switch` over it needs a new arm; a plain read does not.

  Nothing changes for authoring: ordinary variables pass, `$` mid-name (`price$`)
  and dotted names (`collect.note`) included. Only names the engine reserves —
  `$…` or a `.$` segment — are refused.

- 0024abf: feat(spec)!: delete `DEFAULT_DISPATCHER_ROUTES` — the dead route table that
  underwrote a false compliance verdict (#3586, #3563 follow-up)

  The const was consumed by nothing in the runtime — only its own tests and
  `api-surface.json`. It listed dispatcher branches that never existed
  (`/workflow`, `/realtime`) while omitting eight real prefixes (`/keys`,
  `/mcp`, `/mcp/skill`, `/actions`, `/security`, `/share-links`, `/ready`,
  `/openapi.json`), and `CLIENT_SPEC_COMPLIANCE.md` anchored a "FULLY
  COMPLIANT" verdict on it while 27 real routes had no SDK expression.

  The audited, guard-enforced source of truth for the dispatcher's route
  surface is `packages/runtime/src/route-ledger.ts` (#3569): the conformance
  suite fails when the registry and the ledger drift, which the dead table
  never could.

  Also swept the last GraphQL fixture debris that #3562's surface removal
  left behind: registry test fixtures renamed to honest OData naming, the
  tautological `config.graphql` assertions dropped, and the stale
  `"type": "graphql"` JSDoc example in `registry.zod.ts` corrected.

  Breaking for anyone importing `DEFAULT_DISPATCHER_ROUTES` (a repo-wide and
  objectui-wide grep shows zero consumers); shipped as minor per the
  launch-window convention, cf. #3562/#3581.

- 7687f7b: fix(automation): a screen field's `visibleWhen` reaches the client (#3528)

  `visibleWhen` has been on the `screen` node's designer form since #3304 —
  declared as an expression (`xExpression`), documented as bare CEL, offered to
  authors in Studio. The executor never put it on the wire. `ScreenFieldSpec`
  carried `name` / `label` / `type` / `required` / `options` / `defaultValue` /
  `placeholder` and nothing else, so no client could honour a predicate it never
  received. Authors wrote conditional visibility; every field rendered
  unconditionally; nothing errored.

  That is worse than a cosmetic miss, because `required` **is** honoured. A field
  that is optional-by-design but required _when shown_ becomes permanently
  required once its predicate is dropped — and a runner that validates the full
  field list then blocks Submit on input the user was never asked for. No resume
  request is issued and the run sits paused forever. HotCRM's lead-conversion
  screen is exactly that shape:

  ```ts
  { name: 'createOpportunity', type: 'boolean', required: true },
  { name: 'opportunityName',   type: 'text', required: true,
    visibleWhen: 'createOpportunity == true' },
  ```

  Leave the checkbox unticked and `opportunityName` — which should not be on
  screen at all — blocks the whole conversion.

  - `ScreenFieldSpec.visibleWhen` is now part of the contract, documented as
    client-evaluated bare CEL over the screen's own field names, with the
    `required`-must-follow-visibility rule stated where implementors will read it.
  - The `screen` executor forwards it **raw**, deliberately uninterpolated: the
    predicate is re-evaluated per keystroke against values only the client has, so
    resolving it server-side against flow variables would freeze the field.
  - Covered by tests — the screen wire payload had none for this key.

  Clients must evaluate the predicate and skip hidden fields when enforcing
  `required`. Honouring one without the other reproduces the dead-end above.

- 1659072: feat(spec): publish `ISecurityService` — the `security` service surface becomes an enforced contract

  The `security` service registers seven cross-package methods (`getReadFilter`,
  `getReadableFields`, `resolvePermissionSetNames`, `explain`, and the three
  audience-binding suggestion calls) but had no contract in
  `@objectstack/spec/contracts`. Consumers duck-typed it, and each one invented its
  own fallback for a missing method or an "empty" answer — with more consumers
  arriving, that is a drift surface.

  `ISecurityService` now documents the surface, and both ends are typed against it
  so it is **enforced rather than declared**: `plugin-security` assigns its
  registration to `ISecurityService` (a renamed, dropped, or re-typed method fails
  that build), and the REST layer resolves the service as a `Partial<ISecurityService>`
  (so call sites must keep feature-detecting instead of assuming the full surface).

  The contract makes explicit the one thing consumers cannot guess — that the
  methods do **not** share a failure convention:

  - `getReadFilter` fails **CLOSED**: a resolution failure yields a deny filter
    matching zero rows, never `undefined`. `undefined` means "no row restriction",
    and nothing else.
  - `getReadableFields` fails **SOFT**: `undefined` means "no answer, use your own
    projection", while `[]` is authoritative and means "no field is readable" —
    opposite instructions that a consumer must not conflate.

  Typing the producer immediately caught one real discrepancy, fixed here:
  `getReadFilter` declared `Promise<Record<string, unknown> | null | undefined>`
  while every return path yields a filter or `undefined` (`filter ?? undefined`
  normalizes the null away). The dead `| null` is removed, so "no restriction" has
  exactly one representation. Type-level only — no runtime behaviour changes.

- f00d8d4: fix(sharing): remove the `full` access level — it promised delete/transfer/share and granted `edit` (#3865)

  `sys_sharing_rule.access_level` / `sys_record_share.access_level` offered three
  levels, the third documented as **Full Access (Transfer, Share, Delete)**. No
  code path granted transfer, re-share, or delete because of it: both enforcement
  sites matched `access_level in ('edit','full')`, so `full` was byte-equivalent
  to `edit`. An admin picking "Full Access" in Setup was told they had granted
  delete rights and had not — declared-but-unenforced metadata (ADR-0078,
  ADR-0049), the same defect that retired the `queue` recipient before it.

  Measured on showcase, a `full` recipient got `read: allowed`, `update: allowed`,
  `delete: DENIED` — and the denial came from `decidedBy=object_crud`, i.e. the
  object-level CRUD gate rejected the delete _before_ sharing was consulted at
  all. That is not an oversight to patch around; it is the model working. Record
  sharing widens **which rows** a principal reaches, never **which verbs** they
  may use — the same split Salesforce enforces (its sharing rules stop at
  Read-Only / Read-Write; Full Access is owner / hierarchy / Modify All only,
  never grantable by a rule) and Dataverse enforces by AND-ing every shared access
  right against the security role's own privilege. Delete and transfer belong to
  ownership, the ADR-0057 DEPTH scopes, and admin scope.

  **What changed**

  - `SharingLevel` (spec/security) and `ShareAccessLevel` (spec/contracts) are now
    `read | edit`. The `Field.select` on both objects offers the same two, so the
    Setup dropdown no longer shows the misleading option.
  - `SharingService.grant()` and `SharingRuleService.defineRule()` gained the
    access-level validation they never had: `full` normalises to `edit`, and an
    unrecognised level is a `VALIDATION_FAILED` (HTTP 400) instead of being
    persisted verbatim as a grant no gate would ever match.
  - Enforcement stays deliberately wider than authoring — the read/write gates
    still match `edit`/`full` — so a row written before this release keeps
    working. Narrowing them would silently _revoke_ access.
  - A boot backfill normalises stored `full` rows on both tables, and the
    `sharing-rule-access-level-full-to-edit` conversion rewrites declarative
    stacks at load, so nothing needs consumer action.

  **Migration.** None. `full` and `edit` were already behaviourally identical, so
  rewriting one to the other cannot change an access decision — unlike the OWD
  `sharingModel: 'full'` alias retired in ADR-0090 D4, which changed posture and
  had to be delegated to the author. A stack that still authors `accessLevel:
'full'` converts at load with a deprecation notice; stored rows normalise at
  next boot. Code that pinned the `ShareAccessLevel` type to `'full'` no longer
  compiles — use `'edit'`.

  Reviving a real per-record delete grant is a separate design (a capability mask
  AND-ed with object CRUD, plus the share-administration model that would have to
  authorise re-sharing), not a fourth enum member.

- 503be86: feat(security)!: reconcile the SharingRule authoring surface with the enforced runtime — rename `group` → `team`, add `business_unit`, prune `guest` + owner-type rules (#1878)

  The authoring `ShareRecipientType` enum had drifted behind the ADR-0090 D3
  rename and the enforced runtime: the runtime expands `team` (via
  `sys_team`/`sys_team_member`) and `business_unit`, but the authoring enum
  still offered the pre-rename `group` (silently skipped at seed time) and
  omitted the two live recipients. After this change **every authorable
  recipient and rule type is enforced** — nothing on the SharingRule surface
  validates and then silently does nothing (ADR-0078).

  - **`sharedWith.type: 'group'` → `'team'`** (wire-rename): the enum member is
    renamed to match the runtime vocabulary and now maps through the seed
    bootstrap to the live `TeamGraphService` expansion. Flat `sys_team`
    membership; enforced.
  - **`business_unit` added** to the authoring enum — exactly one business
    unit's members (no subtree; use `unit_and_subordinates` for the subtree).
    The runtime + bootstrap already enforced it; only the enum omitted it.
  - **`guest` removed** — it had no runtime recipient mapping. Anonymous access
    is served by the public-form grant and share links, not sharing rules.
  - **Owner-type rules removed** (`type: 'owner'`, `ownedBy`,
    `OwnerSharingRuleSchema` + its type export): they depend on live
    team/position membership, which the static materialiser cannot track, so
    they validated but never materialised a share. They return as an enforced
    form if membership-reactive re-materialisation is designed.
    `SharingRuleSchema` is now the criteria form; the `queue` recipient stays
    runtime-reserved (no `sys_queue` yet) and deliberately non-authorable.

  **Migration** (stale definitions now fail parse with the valid options listed):

  - `sharedWith: { type: 'group', … }` → `sharedWith: { type: 'team', … }`.
  - `sharedWith: { type: 'guest', … }` → delete the rule; expose the records
    via a public form or share link instead.
  - `type: 'owner'` rules → rewrite as a `type: 'criteria'` rule scoping the
    rows by field values (see the migrated examples:
    `share_open_tasks_with_manager` in app-showcase,
    `share_active_leads_with_manager` in app-crm), or use a scope-depth grant.

- 4d00b13: feat(spec)!: remove `tool.requiresConfirmation` — a safety flag nothing enforced (#3715, ADR-0033 §2)

  `ToolSchema.requiresConfirmation` accepted `true` and no execution path ever read
  it. Not the LLM tool set (a tool reaches the model as name/description/parameters
  only), not `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the
  MCP bridge — which derives `destructiveHint` from a hardcoded name list. Setting
  it on a destructive tool produced **no pause**.

  For an ordinary dead property that is untidy. For a **safety** property it is
  false compliance, which is the case ADR-0049 exists for: an author gates a
  destructive tool, sees the flag accepted, and ships believing a human is in the
  loop. It is made worse by the near-miss — `action.ai.requiresConfirmation` has
  the same name and **does** work, so the mistake reads as correct in review.
  ADR-0033 §2 already resolved to delete this one.

  ## Migration

  - **FROM:** `requiresConfirmation: true` on a tool definition
  - **TO:** put the operation behind an action and set `ai.requiresConfirmation:
true` there — that is the flag the HITL approval queue reads
    (`packages/runtime/src/action-execution.ts`) and the only path that actually
    stops execution.
  - For AI _metadata_ mutations there is nothing to migrate: the ADR-0033
    draft/publish workspace is the gate — nothing is live until a human publishes.

  **`ToolSchema` is now `.strict()`.** This is load-bearing, not tidying. Removing a
  key from a non-strict schema swaps one silent no-op for another: zod strips the
  key wordlessly, the author keeps writing it, and the safety flag goes on meaning
  nothing — the "silent strip" ADR-0032 / #1535 closed for objects. The retired key
  now **rejects**, and the error carries the FROM → TO above, because a parse error
  is the one channel every consumer bumping `@objectstack/spec` is guaranteed to
  hit.

  Strictness applies to _all_ unknown keys on a tool definition, so a typo
  (`buildIn`, `catagory`) is now a located parse error instead of a silently
  dropped field.

  Also removed: the Studio form row, its four generated locale bundles (the
  `en`/`zh-CN`/`ja-JP`/`es-ES` strings still promised _"Ask user to approve before
  executing (for destructive actions)"_ — a translated false promise), the
  liveness-ledger entry, and the generated reference-doc row.

  objectui's `ToolPreview.tsx` reads the field via `!!d.requiresConfirmation`, so it
  degrades to "not shown" with no error; removing that badge is a follow-up in that
  repo.

- 57bab76: Typed `decisionOutputs` declarations (#3447 follow-up). A `decisionOutputs` entry may now be `{ key, label?, type: 'text' | 'user' | 'department' | 'position' | 'team', multiple? }` alongside the bare-string form — a typed entry tells the decision UI to render the matching record picker (id values; `multiple` collects an id array) instead of free text, turning "paste user ids" into "pick people". The type shapes only the input widget: the runtime whitelist works by `key` either way, via the new `normalizeDecisionOutputs` helper exported from `@objectstack/spec/automation` — the single reader of the union shape shared by the service, the request read, and `os lint`. The request read now carries `decision_output_defs` (normalized declarations) alongside the version-skew-safe `decision_outputs` key list.
- b90086a: fix(driver-sql)!: `unique` materializes per tenant, ending its contradiction with the per-tenant autonumber sequence (#3696)

  `unique: true` became a **single-column global index that ignored `tenancy`
  entirely**, while the autonumber sequence table is keyed by
  `(object, tenant_id, field, scope)` and hands every tenant its own counter
  starting at 1. Two subsystems of the same platform contradicted each other:
  tenant B's `PROD-00001` was rejected by an index it could not see — **no user
  did anything wrong**, the platform's left hand refused what its right hand
  issued.

  The rejection also doubled as a **cross-tenant existence oracle**: a UNIQUE
  violation told tenant B that some _other_ tenant held the value, enumerable by
  probing emails / codes / names.

  **The contract now:**

  | Declaration                      | Materializes as                                                 |
  | -------------------------------- | --------------------------------------------------------------- |
  | `unique: true` + tenant column   | composite `(tenantField, field)` — unique **within** the tenant |
  | `unique: true`, no tenant column | single-column — single-tenant DDL is byte-identical to before   |
  | `unique: 'global'`               | single-column, always platform-wide                             |

  The tenant column comes first in the composite, so the index also serves the
  `WHERE tenant = ?` prefix scans every tenant-scoped read issues.

  **Declared `indexes[]` are deliberately unchanged.** They are materialized over
  exactly the columns listed — no tenant column is injected. The author already
  spells them out, per-tenant ones have always been written explicitly
  (`fields: ['organization_id', 'code']`), and many are legitimately platform-wide
  (a DNS hostname, a reserved slug, an external provider id). `'global'` is
  accepted there as a synonym of `true` so one vocabulary covers both spellings.

  **Migration is automatic and cannot fail.** Legacy indexes
  (`<table>_<col>_unique` from knex, `uniq_<table>_<col>` from the drift-rebuild
  path) are retired inline at schema-sync time. The old global constraint is
  strictly stronger than the new per-tenant one, so existing rows satisfy the
  replacement by construction — no dedup, no cleanup, no data touched. It
  converges at sync rather than waiting for a deliberate `os migrate` run because
  a deployment that never ran migrate would otherwise stay broken.

  **Upgrading — audit your `unique: true` fields.** On a tenant-scoped object the
  constraint is now per tenant. Anything that must stay platform-wide has to say
  so:

  ```ts
  hostname: Field.text({ unique: "global" }); // no two tenants may claim it
  ```

  Note the reach: `applySystemFields` injects `organization_id` into every
  registered object unless it opts out, and the driver falls back to that column
  when no `tenancy.tenantField` is declared — so most objects are tenant-scoped.
  Typical candidates for `'global'`: DNS hostnames, reserved slugs, external
  provider ids (Stripe customer/subscription), device identities.

  Postgres materializes `col.unique()` as a table CONSTRAINT rather than a bare
  index, so the retirement tries `DROP CONSTRAINT` before `DROP INDEX` —
  `DROP INDEX` alone would have made the migration a no-op on exactly the
  deployments that matter most.

  `@objectstack/driver-mongodb` accepts the new declaration but keeps single-field
  indexes: it implements no row-level tenancy at all (no tenant predicate on read,
  no tenant stamp on write), so a `(tenant, field)` index would advertise an
  isolation it does not deliver. Tracked separately.

- b95577a: feat(automation): surface silently-stripped write fields as step warnings (#3407)

  `update_record` used to report an unconditional `success` even when the data
  layer legally stripped the requested write fields — static `readonly` (#2948)
  or a TRUE `readonlyWhen` predicate (#3042). The only trace was a server-side
  logger warn, invisible in the flow run trace: an author saw a clean 3ms
  `success` while the DB truth never changed (how #3356's approval stage
  write-backs failed unnoticed).

  - **spec**: new `DroppedFieldsEventSchema` / `DroppedFieldsEvent`
    (`{ object, fields, reason: 'readonly' | 'readonly_when' }`) in
    `data/data-engine.zod.ts`, and a `WriteObservabilityOptions`
    (`onFieldsDropped` listener) mixin on `IDataEngine.insert/update` option
    params in `contracts/data-engine.ts`. The listener is a TS-contract-level,
    in-process-only channel — deliberately NOT part of the serializable Zod
    options schemas or the RPC boundary.
  - **objectql**: `engine.update()` reports each strip pass's dropped keys +
    reason through `options.onFieldsDropped` (all four strip sites: single-id +
    bulk × readonly + readonlyWhen). A throwing listener never breaks the write.
    System-context writes skip the readonly strip and therefore report nothing,
    as before. `insert()` accepts the option for symmetry but strips nothing
    today (INSERT is readonly-exempt; FLS write denial throws).
  - **service-automation**: `NodeExecutionResult` and `StepLogEntry` gain
    advisory `warnings?: string[]`; `update_record` / `create_record` attach one
    warning per strip event naming the dropped fields, plus a structured
    `droppedFields` output (`{<nodeId>.droppedFields}`) for downstream nodes.
    `success` semantics are unchanged — stripping stays legal, it just is no
    longer silent.

- d8c4957: feat: user-level export permission axis (#3544, #3391 follow-up)

  `export` is a user-gated operation, not just "anyone who can list". A permission
  set can now deny export on an object while keeping read — matching Salesforce
  "Export Reports" / Dynamics "Export to Excel" / NetSuite "Export Lists" / SAP
  S_GUI 61.

  - **spec** `ObjectPermissionSchema` gains an optional `allowExport` bit. It is
    deliberately OPTIONAL with **no default** so it is a backward-compatible
    opt-out: unset → inherits read (today's "can-list ⇒ can-export"), `false` →
    export denied while read is kept, `true` → granted.
  - **plugin-hono-server** `annotateEffectiveApiOperations` derives
    `userExportAllowed = allowExport !== false` from the resolved per-object
    permission and threads it into `resolveEffectiveApiMethods` — so `export`
    derives from `list ∧ userExportAllowed`. When the axis removes `export` from
    an otherwise-open object, the object is now annotated (the effective set minus
    `export`) so the client hides the Export button; an unrestricted object with
    export still allowed stays unannotated (client default-allow).

  Wires the `userExportAllowed` slot reserved in #3391 P1 — zero contract change
  to the derivation table or the frontend (it already consumes the effective
  `apiOperations`). Backward-compatible: existing permission sets (no
  `allowExport`) keep today's behavior everywhere.

### Patch Changes

- d99aeb3: feat(spec): let an inline `lookup` action param declare its reference target (#3405)

  `ActionParamSchema` had no way to name the object an inline record-picker param
  should search. Authors reasonably wrote the same key the field schema uses —
  `{ name: 'inspector', type: 'lookup', reference: 'sys_user' }` — and the schema
  stripped it as an unknown key, without an error. Downstream, the param dialog
  saw a picker with no target and degraded it to a "paste the record id (UUID)"
  text input. The authored intent was dropped silently and the user was handed a
  control that a human cannot reasonably operate.

  - Added `reference` to `ActionParamSchema`, spelled to match
    `FieldSchema.reference` so one spelling works in both places. It sits with the
    existing inline widget config (`multiple` / `accept` / `maxSize`), which had
    covered the file/image params but not the picker ones.
  - A `lookup` / `master_detail` param declared **inline** with no `reference` is
    now a parse-time error pointing at the missing key, instead of degrading at
    render time. Field-backed params are unaffected: they inherit the target from
    the referenced field's metadata, which is not visible at parse time.

- f63cd09: fix(spec): `action.undoable` is `live`, not `experimental` — stop warning on a property that works (#3714)

  The liveness ledger marked `action.undoable` `experimental` on a #1992-era note:
  _"no runtime reader yet — neither service-automation nor objectui consume the
  action's `undoable` flag (objectui has an UndoManager but does not key off this
  field)."_ That was true when written. objectui has since wired **two** readers,
  both gating real behaviour:

  | Reader                                      | What the flag gates                                                        |
  | ------------------------------------------- | -------------------------------------------------------------------------- |
  | app-shell `useConsoleActionRuntime.tsx:409` | builds the undo operation the success toast's Undo button invokes (`:147`) |
  | app-shell `RecordDetailView.tsx:545`        | restores the record's prior field values (`:404`)                          |

  `components` `action/action-button.tsx:113` forwards the flag for exactly this
  reason, per its own comment: _"without this the flag is dropped and the handler
  never builds the undo operation."_

  **Why it mattered.** The CLI liveness lint warns on `experimental` as well as
  `dead`, so authoring a _working_ property produced a
  `liveness-experimental-property` warning — "declared but NOT enforced at
  runtime". An author (or an AI) reading the ledger or that warning concludes
  `undoable` is aspirational and skips it, losing a shipped feature. Authoring
  `undoable: true` is now silent, and the protocol reference no longer claims
  setting it "currently has no effect".

  Nothing to migrate: the schema, the parsed shape, and the runtime are unchanged
  — only the classification of what they already do.

  This is the _understating_ failure direction, the mirror of the preview-renderer
  over-claims corrected in #3685/#3711/#3686. Both directions have the same root
  cause, now written into `packages/spec/liveness/README.md`: **a ledger entry is a
  claim with a timestamp, and code moves under it in both directions** — entries
  are worth re-verifying rather than trusting indefinitely.

- 37b1346: feat(storage): surface the sys_file id on upload-complete — ADR-0104 D3 wave 2 (PR-1)

  `POST /api/v1/storage/upload/complete` now returns the opaque `sys_file` id
  (`data.fileId`), and `client.storage.upload()` surfaces it on the returned
  `FileMetadata`. Previously the commit response omitted the id — the caller
  could not learn which id to persist after committing an upload, so a file
  field could never store a reference.

  Additive and non-breaking (new optional `fileId` on `FileMetadataSchema`; the
  client falls back to the presigned id when talking to an older server). This is
  the enabling foundation for file-as-reference; the storage model itself is
  unchanged in this PR.

- 201b31f: fix(spec): fold agent `knowledge.topics` into `sources` at parse; mark unenforced AI config experimental (#1891, #1893)

  Two liveness-audit closeouts (umbrella #1878):

  - **`AIKnowledgeSchema`** now folds the deprecated `topics` alias into the
    canonical `sources` at parse time (canonical wins; alias dropped from the
    output — mirrors the `visibleWhen` normalization, ADR-0089 D2). Authoring
    `topics` was a silent no-op: the renderer only reads `sources`. The schema's
    JSDoc example now shows `sources`.
  - **Author-facing experimental markers** added to config that is parsed but has
    no runtime consumer, matching the liveness ledger (ADR-0078): agent
    `memory` / `guardrails` / `structuredOutput` / `lifecycle`, and tool
    `outputSchema` (keys folded into the LLM-facing description only — no output
    validation).

  Reference docs regenerated. No parse-acceptance change; `Agent`'s inferred
  output type no longer carries `knowledge.topics` (input still accepts it).

- 33f5e23: feat(lint): `validate-ai-surface-affinity` — skill ↔ agent surface affinity is now linted (#3820)

  An agent binds a product surface (`'ask'` | `'build'`, ADR-0063 §1) and a skill
  declares which surface it belongs to (`'ask'` | `'build'` | `'both'`, §3). The
  runtime refuses an incompatible binding with a **load error at chat time** —
  after parse, validate, and deploy all passed cleanly. The new rule reports that
  contradiction statically, and joins `REFERENCE_INTEGRITY_RULES`, so
  `objectstack validate`, `lint`, and `compile` all pick it up with no CLI
  changes.

  Scope is deliberately narrow (zero false positives by construction): only
  bindings where **both** the agent and the skill are declared in the same stack
  are checked. `agent.skills[]` names that don't resolve in-stack (kernel skills
  are runtime-registered and statically invisible) are skipped — resolving those
  namespaces is #3820 D0/D2, decided by ADR-0109 (Proposed).

  The spec side is doc-truth only, no schema shape changes:

  - `stack.agents` is documented as **platform-internal** (ADR-0063 §2 — the
    kernel ships exactly two agents; third parties extend via skills), replacing
    prose that still described the withdrawn ADR-0040 per-app-copilot model.
  - `stack.tools` is documented as declaration-only pending the ADR-0109 tool
    authoring model.
  - `app.defaultAgent` is re-documented as a surface-binding knob (`'ask'`
    implicit / `'build'` for authoring surfaces), not a custom-agent slot.
  - `SkillSchema` now states that a per-skill `permissions` field deliberately
    does not exist (ADR-0049) — authoring one is silently stripped; access is
    gated by `agent.access` / `agent.permissions` and per-tool authz.

- 1986594: feat(analytics): honour widget `dateGranularity`, `sortBy`/`sortOrder`, and `limit` in the dataset query (#3588)

  Three presentation options were accepted by the metadata layer and then dropped
  by the analytics query builder. They reached no SQL, produced no error, and the
  only way to notice was to read the `sql` a dataset response echoes — so a
  dashboard could declare `dateGranularity: 'month'` and quietly render one bar
  per record.

  - **`dateGranularity` now buckets.** `DatasetSelection` gained an optional
    `dateGranularity`, applied to every selected `date` dimension. Precedence per
    dimension: an explicit `timeDimensions` granularity, then the selection's,
    then the dataset dimension's own default. A widget can bucket a trend by month
    without the dataset committing every other consumer to that granularity.
  - **`order` / `limit` / `offset` now apply on every path.** They are applied to
    the ASSEMBLED grid — after measure-scoped sub-queries merge, after `compareTo`
    columns attach, and after derived measures are computed — so a derived measure
    is a valid sort key and the ObjectQL aggregate path (which has no ordering
    grammar, and which native SQL hands every date-bucketed query to) orders
    identically to native SQL. A single-query selection still pushes the window
    down into the statement. An `order` key that names nothing the selection
    projects is now rejected (400) rather than silently ignored.
  - **`limit` is deterministic.** Without an `order`, a limit orders by the
    selected dimensions first, so it truncates a reproducible window instead of an
    arbitrary subset.
  - **Widget `options` is a contract again.** The four query-affecting keys
    (`dateGranularity`, `sortBy`, `sortOrder`, `limit`) plus `stageOrder` are
    declared on `DashboardWidgetOptionsSchema`, so a typo like `sortDirection` is
    an author-time error. The bag stays open — renderer extras (`icon`, `columns`,
    `striped`, …) pass through untouched.

  Two latent bugs surfaced while fixing the above and are fixed here too:

  - `order`/`limit` were forwarded to EVERY sub-query. A measure-scoped
    supplementary query selects one measure, so an inherited `ORDER BY` named a
    column it never selected, and an inherited `LIMIT` truncated it before the
    merge — dropping rows from the assembled grid. Nothing hit this only because
    nothing passed `order`.
  - The `compareTo` pass built its query by hand and skipped granularity
    resolution, so a month-bucketed primary grid was merged against raw-timestamp
    comparison rows. No dimension key matched and every `<measure>__compare`
    column came back empty.

  `ObjectQLStrategy` now also echoes a representative `sql` (with `date_trunc`,
  `WHERE`, `ORDER BY`, and `LIMIT`; filter values parameterized, never inlined).
  Previously the `sql` field simply vanished from the response whenever a query
  was date-bucketed, leaving an author unable to tell "not implemented" from "this
  strategy doesn't report".

- 0bc685a: fix(approvals): return decision attachments as file values, not "[object Object]" (#3504)

  `sys_approval_action.attachments` is a `Field.file`, so the column **stores an
  opaque `sys_file` id** (ADR-0104 D3 — the stored form of every media field). The
  ObjectQL read path resolves that id into its expanded
  `{ id, name, size, mimeType, url }` form on the way out. But `rowFromAction`
  mapped the column with `.map(String)`, collapsing each expanded value to the
  literal string `"[object Object]"`. Every `listActions` consumer (the approval
  inbox timeline) then received garbage: the attachment chip had no filename and
  its id was `"[object Object]"`, so opening it 404'd.

  - `ApprovalActionRow.attachments` is now `ApprovalActionAttachment[]` — the
    expanded file value plus its id, so a consumer can label and open an
    attachment without needing read access to the system `sys_file` object (which
    regular approvers do not have).
  - Three read forms are accepted: the expanded value (the normal case), a bare id
    (nothing to expand it into — storage service absent, file not committed), and
    a legacy inline blob written before file-as-reference (`file_id` /
    `mime_type`), until the backfill converts it. The id test reuses the
    platform's `isFileIdToken`, so this and the engine's read resolver cannot
    disagree about what counts as an id.
  - The decision _input_ (`ApprovalDecisionInput.attachments`) is unchanged — it
    still takes fileId strings, which is also exactly what the column stores. Only
    the read shape changed.

- b949059: fix(approvals): a dead approval run no longer leaves the record RECORD_LOCKED (#3456)

  The record lock is keyed on a **pending** `sys_approval_request`, and it could
  not tell _the run that owns that request_ from _an unrelated user editing the
  record_. So a flow that touched its own target record while its own approval was
  still pending — a manual `resume` with no decision, or a node that writes the
  record between opening the approval and the decision — died on its own
  `RECORD_LOCKED`, and the record stayed locked behind the dead run. Recovery
  existed (#3424 lets an admin `recall`/`reject` to release it) but nothing made it
  self-healing.

  Both halves are now closed.

  **Prevention — the owning run may write its own record.** The automation engine
  stamps `flowRunId` onto the run context at setup, alongside `runAs`, and it
  travels with every data node's ObjectQL context into `ctx.provenance`. The lock
  hook exempts a write whose `flowRunId` matches the pending request's `flow_run_id`.
  It is keyed on run identity rather than elevation on purpose: a `runAs:'user'`
  run stays fully RLS-scoped while it writes. `flowRunId` is pure provenance —
  server-constructed like `isSystem`, never client-supplied, evaluated by no
  security middleware, and the only write it permits is to the one record its own
  run already holds a pending request against.

  **Recovery — a sweep releases records held by runs that died anyway.** A pending
  request whose owning run has reached a terminal state (`completed`, `failed`,
  `cancelled`, `timed_out`) can never be decided, so it is finalised as `recalled`
  — releasing the lock — and audited under the reserved actor `system:dead-run`
  with the run and its status in the comment, so it is never mistaken for a
  submitter's withdrawal. It runs on the existing approvals sweep clock, which also
  covers the case no in-band handler can: a run killed by a process crash.

  The sweep is fail-safe by construction. It acts only on an explicit terminal
  status from a closed set; `paused` (the normal state of a live approval),
  `running`, an unrecognised status, an unknown run, a `getRun` that throws, and a
  deployment with no automation engine are all read as "still alive". The failure
  mode is "a dead run's lock survives until an admin recalls it" — today's
  behaviour — never "a live approval is destroyed".

  Also fixes `AutomationEngine.getRun`, which returned the **first** log entry for
  a run id rather than the latest. A run that pauses and later finishes records two
  entries under one id, so every suspend-then-finish run — every approval, screen
  and wait flow — reported itself as `paused` forever, both on the Runs
  observability surface and to this sweep.

  One shape was left out here and closed separately in #3712: a `runAs:'user'` run
  with no trigger user (a schedule) resolved no ObjectQL context at all, so it
  carried no `flowRunId` and stayed subject to the lock. It now passes a
  provenance-only context — the run id and nothing the security middleware keys on
  — so it is attributable without acquiring a principal, and its documented
  unscoped posture (#1888) is unchanged.

- be1c52c: fix(approvals): admin override for a request routed to an unstaffed approver (#3424)

  An `approval` node routed to a `position` (or `team`/`department`) with **no
  holders** resolved to only the unresolvable `position:<name>` literal in
  `pending_approvers` — no concrete user was in the slate. Every normal
  `decide` / `reassign` / `recall` then returned `FORBIDDEN` (not a pending
  approver) and, with `lockRecord`, the target record stayed `RECORD_LOCKED`
  forever: a data-availability dead-end with no in-product recovery (the only exit
  was editing the DB by hand). Very easy to hit in fresh/demo orgs (positions
  seeded, holders not) and whenever a role is vacated in production.

  A **platform or tenant admin** — the same posture the engine's superuser bypass
  already trusts — may now act on any _pending_ request to release it: **approve,
  reject, reassign** it to a real approver, or **recall** it. The override finalizes
  the request (which releases the record lock, keyed on a pending request); a
  tenant admin's authority is org-scoped, a platform admin's is not, and the
  decision is audited under the admin's own id. An admin approval is authoritative,
  finalizing the node even under `unanimous` / `quorum` / `per_group` rather than
  counting as one vote among the (empty) slate.

  - `sys_approval_request.viewer` gains `can_override` (server-computed): true for a
    privileged admin on a pending request. The `approve` / `reject` / `reassign`
    declared actions OR it into their `visible` gate, so the console surfaces the
    recovery path without a hand-wired button. Existing approver/submitter gating is
    unchanged.
  - `openNodeRequest` now logs a loud warning when a node resolves to **no concrete
    approver**, so the misconfiguration is visible instead of silently locking the
    record. The literal-fallback behavior (kept for 15.x slot back-compat) is
    otherwise unchanged.

- c5ff96d: fix(approvals): a schedule-triggered run can write its own locked record (#3712)

  #3456 let the run that opened a pending approval write its own target record,
  keyed on `flowRunId`. It worked for every run that resolves an identity and
  missed the one that doesn't: an effective `runAs:'user'` run with **no trigger
  user** — a schedule being the canonical case — passed no ObjectQL context at
  all, so nothing carried the run id and the run still died on its own
  `RECORD_LOCKED`.

  The blocker was never the lock. It was that "no identity" and "no context" were
  the same thing on the wire, so a run could not say _who it was_ without also
  claiming _what it was allowed to do_.

  **A run with no principal now passes provenance alone.**
  `resolveRunDataContext` returns `{ flowRunId }` — no `userId`, no `positions`,
  no `permissions`, not even `isSystem: false`. Every principal gate keys on one
  of those fields (the elevation short-circuit on `isSystem`, the ADR-0103
  engine-owned write guard and the ADR-0090 D12 delegated-admin gate on `userId`,
  the empty-principal fall-open on all three), so this context authorizes
  **identically to no context at all**. The run keeps the documented #1888
  unscoped posture, its loud `[runAs]` warning, and the
  `flow-schedule-runas-unscoped` build-time lint. Nothing about what it may touch
  changed — only that it can now be attributed.

  **Provenance moved out of the hook session, into `ctx.provenance`.** `session`
  answers _who is calling_ and is absent when no identity envelope was supplied —
  a distinction real gates depend on (the attachment access gate skips bare-kernel
  writes on exactly that test). Folding a run id into `session` would have forced
  an identity-less run to present an empty session, silently turning "no caller"
  into "an anonymous caller" and narrowing the #1888 fail-open for attachments
  alone. `HookContext.provenance.flowRunId` says what produced the write; the
  approvals lock reads it there.

  Also relaxes `BaseEngineOptionsSchema.context` to a partial envelope
  (`ExecutionContextInput`). `positions`/`permissions`/`isSystem` carry parse-time
  defaults, which made them _required_ on a caller-supplied option and asserted
  something untrue — that every data-engine context carries a principal. Callers
  have always passed slices (`{ isSystem: true }` for a system read); the type now
  says so.

  Migration: nothing to change unless you read the run id inside a hook. If you
  wrote `ctx.session.flowRunId`, read `ctx.provenance.flowRunId` instead — the
  field never shipped under the old name.

- 84e7be9: feat(plugin-approvals): expose per-group membership of pending approvers (objectui#2807)

  `per_group` (会签) requests now carry `pending_approver_groups` on the
  enriched row — a map from each still-pending approver id to the group key(s)
  it fills (e.g. `{ "u_devadmin": ["finance", "legal"] }`). A client can label
  each "waiting on" chip with the group it represents instead of showing
  duplicate, context-free names.

  - Resolved in `attachDecisionProgress` from the same open-time
    `__approverGroups` snapshot the `decision_progress` groups already use, so
    the two never disagree.
  - Only the **pending** slots are mapped (a resolved approver has left
    `pending_approvers`), and **synthetic** (unnamed, `#N`) group keys are
    dropped — a `· #0` sub-tag would be noise.
  - Absent for non-`per_group` behaviors. Display-only; the engine's
    finalization tally stays authoritative.
  - Added to the `ApprovalRequestRow` contract in `@objectstack/spec`.

- debc23a: feat(approvals): enrich inbox rows with `payload_labels` (snapshot field labels)

  The approvals inbox summary title-cased raw snapshot machine keys
  (`assessment_status` → "Assessment Status") because the API sent no field
  labels. `ApprovalService.enrichRows` now attaches `payload_labels` (snapshot
  field key → the target object's field label), symmetric with the existing
  `payload_display` (which resolves the values), and `ApprovalRequestRow` gains
  the field. For a single-locale project the schema label is already the
  localized string, so a client can render the human field name (e.g. "考核状态")
  instead of a prettified English key.

- 8f9689f: fix(spec): ratchet the authorable key surface — the one contract no witness watched (#3855)

  For a metadata-driven platform the third-party API is **what an author may
  write**: the keys inside each schema. Nothing guarded them.

  The two existing witnesses look at the TypeScript surface instead:

  - `api-surface.json` records exported `name (kind)`. A key inside a schema is
    not an export, so removing one never moves it.
  - `api-surface-signatures.json` hashes each `defineX` factory's type — but via
    `checker.typeToString()`, which prints a type _reference_
    (`z.input<typeof ActionSchema>`) and never expands it structurally. Member-level
    narrowing cannot reach the hash.

  `spec-changes.json` inherits the same blind spot: its `added`/`removed` arrays
  are a diff of `api-surface.json`.

  So #3883 removed three authorable keys with every witness green — and #3733 did
  the same **by accident**, when `dataQuality` / `cached` outlived their keys and
  were silently stripped. ADR-0059 §5 deferred a deeper gate "until a narrowing
  actually slips both". It has, twice.

  **New: `authorable-surface.json`**, a committed ratchet of all 8588 authorable
  keys, derived from the same walk that already emits the JSON Schemas — one level
  deeper, no new introspection. It distinguishes three states, because a tombstoned
  key (`retiredKey()`) is `z.never()`, which Zod renders as `{ "not": {} }`:

  | State       | Meaning                                                       |
  | ----------- | ------------------------------------------------------------- |
  | live        | a normal property — the author may write it                   |
  | `[RETIRED]` | present but unwritable, carrying its own upgrade prescription |
  | absent      | gone from the contract with nothing left to say               |

  Three failure modes now fail the build, each verified non-vacuous by simulation:

  1. **A key vanishes without a tombstone.** These schemas are not `.strict()`, so
     Zod silently strips an unknown key: the author gets a clean parse and a
     setting that never takes effect. The error spells out the retirement protocol.
  2. **A key is tombstoned with no registered migration.** The tombstone is audible
     to whoever hits it, but the change documentation — `spec-changes.json`, the
     generated upgrade guide, the `spec_changes` MCP tool, `os migrate meta` — is
     still empty. Requires a D2 conversion / D3 chain entry naming the surface.
  3. **An addition is left uncommitted** (`--check`). An unrecorded key is
     invisible to the ratchet forever after, since it can only detect the
     disappearance of something it once saw.

  It runs in `check:docs` (unconditional, required — cannot go dormant) and as an
  explicit `check:authorable-surface` step in `Check Generated Artifacts`, with the
  paths filter widened in lockstep per that filter's own rule.

  Also corrects the `build-api-surface.ts` docblock, which advertised the signature
  snapshot as answering "did the accepted authoring shape narrow?" — it does not,
  and believing it did is what let this gap sit. Value-level narrowing (an enum
  losing a member) remains ungated, per ADR-0059 §5's evidence gate.

- 376a061: Surface the approval node's author-declared `decisionOutputs` keys on the request read as `ApprovalRequestRow.decision_outputs` (#3447 P2 UI enablement). The set varies per request (each node declares its own), so it rides the row rather than the object's static action params — a decision UI renders one input per key and POSTs `outputs` with the decision.
- 9ea2bc5: fix(docs): `FieldSchema.extend()` does not exist — the FAQ was recommending a call that throws

  #3882 brought `content/docs` under the example type-check gate and left an open
  question: of the blocks still unmarked, is any of it **genuine rot** rather than a
  fragment? Swept them. One real one:

  `content/docs/deployment/troubleshooting.mdx` answered _"How do I extend a
  built-in schema?"_ with

  ```ts
  const CustomFieldSchema = FieldSchema.extend({ … });   // TypeError
  ```

  `FieldSchema` carries a `.transform()` that lowers author-facing sugar at parse
  time, which makes it a **`ZodPipe`, not a `ZodObject`** — `.extend` is `undefined`
  on it (verified against the built package). Anyone following the FAQ got a
  `not a function` throw. The example also used `z` without importing it.

  Rewritten to **compose** — parse with `FieldSchema`, validate your additions
  alongside it — verified to both type-check and run. `.in.extend()` is mentioned in
  prose as the merged-schema route, with the caveat that it skips the transform.

  **A divergence worth knowing about, found while fixing this.** The first fix used
  `FieldSchema.in.extend(…)` in the checked block. It passed locally and failed in
  CI with `Property 'in' does not exist on type 'ZodObject<…>'` — the two builds
  emit **different declarations for the same source**: locally
  `z.ZodPipe<z.ZodObject<…>>`, in CI a plain `z.ZodObject`. The runtime is
  unambiguous (`bound ZodPipe`, `.extend === undefined`, verified after a clean
  `rm -rf dist && pnpm build`), so **CI's declaration contradicts the value it
  describes** — `.extend()` type-checks there and throws at runtime. Probably
  inference instability in the DTS bundling of these very large zod types; worth its
  own investigation. The example now uses only `.parse()`, so it is correct under
  either declaration and the doc is not hostage to which one you get.

  **The sweep's method is recorded in the gate's docstring**, because two traps make
  a naive pass report a confident "nothing found":

  1. **`tsc` stops after syntactic diagnostics** — it never reaches the semantic
     pass. Marking all 780 blocks at once let ~200 broken fragments suppress
     type-checking for every other block; the run came back with only TS1xxx codes,
     which reads exactly like "no rot" and proves nothing. Verified by injecting a
     deliberate type error and watching it go unreported.
  2. **Unimported type names resolve against the DOM lib.** `Plugin`, `Event`,
     `Response`, `Storage` all exist there, so a block missing its import reports
     _"'version' does not exist in type 'Plugin'"_ against `lib.dom`'s `Plugin` —
     an artefact, not drift. Three of the strongest-looking candidates were this.

  After both corrections the remaining blocks are fragments, plus
  `protocol/kernel/config-resolution.mdx`, whose aspirational snippets are already
  labelled as design intent by a callout on the page.

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

- 5b89711: feat(spec,lint): freeze the `{current_user_id}` filter vocabulary and fail the build on unresolvable placeholders (#3574)

  A dashboard widget filtered on `{current_user}` rendered `0`. Not an error — a
  zero, indistinguishable from a metric that is legitimately empty, with nothing
  in the console or the server log. `service_dashboard.my_open_cases_by_priority`
  in the HotCRM template had shipped broken this way since the day it was
  written.

  The token had never been part of the contract. Date macros were frozen in
  `date-macros.zod.ts` with a spec vocabulary, a lint-usable predicate, and a
  single client resolver; `{current_user_id}` had only prose in an `app.zod.ts`
  JSDoc and three ad-hoc client implementations that each handled one surface's
  filter shape. Nothing could tell an author their token was wrong.

  - **`@objectstack/spec`** — new `data/context-tokens.zod.ts` freezing
    `CONTEXT_TOKENS` (`current_user_id`, `current_org_id`) as the sibling of
    `DATE_MACRO_TOKENS`, with `isContextToken` / `isKnownFilterToken` /
    `classifyFilterToken` and a `CONTEXT_TOKEN_SUGGESTIONS` near-miss table. The
    module documents what the tokens are _not_: presentation scope, never an
    access boundary — that is RLS, which uses the unrelated `current_user.id`
    expression root.
  - **`@objectstack/lint`** — new `validateFilterTokens` (rule
    `filter-token-unknown`, severity `error`). It walks `filter` / `filters` /
    `runtimeFilter` subtrees across dashboards, objects, views, reports,
    datasets, pages and apps, and reports any placeholder that resolves in
    neither vocabulary. It scans for filter _keys_ rather than enumerating known
    surfaces, so a new surface following the convention is covered the day it
    ships — enumerating surfaces is how the dashboard was missed in the first
    place. Navigation `recordId` / `params` are deliberately out of scope: they
    resolve `AppContextSelector` ids, which are meaningless in a filter.
  - **`@objectstack/cli`** — the gate runs in `os validate` and `os compile`.

  It is an error rather than a warning because of who authors this metadata. An
  AI reads a query returning `0` as a correct answer and builds on it; its
  correction loop is author → validate → fix, so a diagnostic only reaches it if
  it can fail the build. The three spellings the suggestion table covers —
  `{current_user}`, `{user_id}`, `{organization_id}` — are each correct
  _somewhere else_ in the platform, which is exactly why authors reach for them.

  Also fixes a `ViewSchema` JSDoc example that documented `{user_id}`, a token
  that resolves nowhere.

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

- de9af8a: fix(automation,objectql): a filter that loses a condition must not run (#3810)

  Three related holes, all of which end in "the query matched rows the author
  excluded".

  **1. A flow filter could silently widen to match everything.**

  The flow template interpolator expresses "this token did not resolve" as
  `undefined`. In a message that renders as empty text — harmless. In a FILTER it
  removes the condition, and a removed condition matches MORE rows. When it was
  the only condition, `{ owner: '{record.ownr}' }` became `{}`, and `{}` handed to
  `deleteMany` is every row in the table.

  So one mistyped field name in a `delete_record` node silently emptied the
  object. Reproduced with all four causes: a typo (`{record.ownr}`), an input the
  run never received, a lookup hop (`{record.account.name}` — the trigger record
  carries a scalar id), and a filter placeholder.

  `get_record` / `update_record` / `delete_record` now refuse to execute when
  interpolation erased any authored condition, naming the offending template. The
  guard keys on LOSS, not emptiness: an author who deliberately wrote no filter is
  unaffected, and losing one of two conditions still fails, because widening from
  "my open records" to "all open records" is the same class of bug.

  **2. Filter placeholders never reached the engine that resolves them.**

  `config.filter` is where two `{…}` dialects meet — the flow template dialect
  (`{record.owner}`) and the filter placeholder dialect (`{current_year_start}`,
  `{current_user_id}`, resolved by `resolveFilterTokens()`). Evaluation order
  picked the winner by accident: the flow interpolator ran first, found no flow
  variable by that name, and erased it.

  `interpolateFilter()` hands that position back to the dialect that owns it — a
  whole-string token that no flow variable resolves and that IS a recognised
  placeholder passes through verbatim for the engine to expand. Flow variables
  keep precedence, so a template that works today cannot change meaning.

  **3. The engine resolved placeholders on reads but not on writes.**

  `resolveFilterTokens()` reached `find`/`findOne`/`count`/`aggregate` only. So
  the SAME filter selected different rows depending on the verb: `find({ owner:
'{current_user_id}' })` matched the signed-in user's rows, while
  `update`/`delete` compared the literal token text and matched none — a flow that
  previewed with one and acted with the other operated on two different row sets.
  This is the #3106 shape one layer down: the evaluator existed, only some call
  sites reached it.

  `update` and `delete` now resolve too, BEFORE the by-id fast path claims a
  scalar `where.id` (otherwise an unresolved `{current_user_id}` would be bound as
  the primary key itself). Caller options are never mutated.

- c4df271: chore(spec): mark FormView `buttons`/`defaults` live now the ObjectUI renderer folds them (#1894)

  The structured `FormViewSchema.buttons` (per-button `submit`/`cancel`/`reset`
  visibility + label) and `defaults` (create-mode initial values) shipped under
  the ADR-0078 escape hatch — declared, but carrying an `[EXPERIMENTAL — NOT
ENFORCED]` marker because no consumer read them yet. The ObjectUI `ObjectForm`
  renderer now folds both onto the flat props it reads
  (`showSubmit`/`submitText`/`showCancel`/`cancelText`/`showReset`/
  `initialValues`), so the escape-hatch marker is dropped and the two spec
  liveness-ledger entries (`view.form.buttons`, `view.form.defaults`) flip
  `experimental → live`.

  No shape or parse-behavior change — both keys were already accepted. This
  closes the `view` half of the inverse-drift cleanup (renderers reading
  undeclared props), umbrella #1878.

- a41ba5c: chore(spec): enroll `report` and `dashboard` in the liveness GOVERNED set (#3462)

  Closes the systemic anti-drift gap for two more authorable UI types (umbrella
  #1878). Both were registered/round-trippable but ungoverned, so their property
  liveness wasn't CI-checked — the reason drifts like dashboard `title`↔`label`
  and stale report `chart` config survived until an audit caught them.

  - Added `packages/spec/liveness/report.json` (20 live / 2 dead) and
    `dashboard.json` (18 live / 2 dead), each property classified with an
    objectui consumer reference.
  - Re-verification corrected several stale 2026-06 audit findings against current
    code: report `chart` is **live** (DatasetReportChart plots `chart.xAxis`/
    `yAxis` via `useDatasetRows`, #1890/#3441); dashboard `globalFilters`/
    `dateRange` are **live** (framework#2501); `title`↔`label` fixed (objectui#2806);
    the ADR-0021 widget migration shipped (#3251). Only `aria`/`performance` remain
    dead on each (perf `authorWarn`'d).
  - Added both to `GOVERNED` in `check-liveness.mts`; the gate is green. Future
    drift on these types is now a CI failure, not an audit finding.

  `webhook` (the third type in #3462) is deferred — it isn't a registered
  metadata type; its enrollment rides with the disconnect decision in #3461.

  No spec shape/behavior change (ledger + gate config only).

- 189854c: chore(spec,cli): enroll `webhook` in the liveness GOVERNED set (#3462)

  Closes the final third of #3462 (umbrella #1878) — `report` and `dashboard`
  landed in #3474; `webhook` was deferred for two reasons, both handled here.

  - **Not a registered metadata type.** `webhook` is absent from the metadata-type
    registry, so the gate can't resolve it via `getMetadataTypeSchema`. Registering
    it would switch on Studio webhook CRUD, `saveMetaItem` overlay acceptance, and
    diagnostics sweeping — the wrong move while the authoring surface is still
    disconnected (below). Instead the gate resolves it through a small
    `SPEC_ONLY_SCHEMAS` override in `check-liveness.mts` (consulted before the
    registry): the gate only needs to **walk** the schema, not register it.
  - **The whole authoring surface is dead (#3461).** Nothing materializes an
    authored `webhooks:` entry (stack/connector) into a `sys_webhook` dispatcher
    row — the runtime reads only admin-authored `sys_webhook` rows. So
    `packages/spec/liveness/webhook.json` classifies all 16 authorable props
    **dead** and `authentication` **experimental** (HMAC-`secret`-only, its
    existing marker). Per-prop notes record which props a future materializer
    (#3461 option A) could remap (e.g. `object`→`object_name`, `isActive`→`active`)
    vs which have no sink anywhere — doubling as that mapping table.
  - **Author-warning wired (`@objectstack/cli`).** Added
    `{ type: 'webhook', key: 'webhooks' }` to `TYPE_COLLECTIONS` in
    `lint-liveness-properties.ts`, so `os compile` now advises authors that
    `webhooks:` is a silent no-op. The required `url` prop carries the single
    warning per webhook (one heads-up per artifact, not one per dead prop);
    `isActive` is left unmarked (default(true) boolean).

  This is enrollment only — it does **not** decide #3461's build-the-bridge vs
  retire-the-surface question. When that lands, the mapped props flip to live (cite
  the materializer) or the ledger is removed with the schema. No spec shape/behavior
  change (ledger + gate/lint config only).

- 0e3a226: fix(authz): widen the driver's native tenant scope to the membership union
  under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

  The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
  under `group`, but the ObjectQL engine also propagated the active-org
  `tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
  scoping ANDed `organization_id = tenantId` under the union — collapsing every
  group read back to active-org (isolated) reach. Found by the cloud-side
  `ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
  against a real driver.

  - `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
    native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
    keeping the NULL-tenant global-row carve-out; inserts still stamp from
    `tenantId` (the active organization is the write target, D5). Absent or
    empty ⇒ equality fallback — fail toward isolation, never toward exposure.
  - ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
    `tenantIds` when the tenancy posture is `group`, reported by a new
    `setTenancyPostureProvider` seam.
  - SecurityPlugin wires that provider at start — deliberately from the
    enforcement layer, so the driver wall only widens while the Layer 0 union
    wall enforces above it. Embeddings without plugin-security keep active-org
    equality.

- a8d1e24: feat(cli,spec): gate the whole declared surface for i18n, and translate inline object actions server-side (#3370)

  In a zh-CN workspace the platform chrome was localized while author-declared
  labels leaked English — the approval drawer rendered **Approve / Reject /
  Reassign** right beside the inbox's own 通过 / 拒绝. Two independent holes, both
  closed here.

  **The lint gate could not see them.** `os lint`'s i18n coverage kept its own
  walk of the metadata, separate from the one `os i18n extract` uses to scaffold
  bundles, and the two had drifted: coverage only ever walked the _top-level_
  `actions` array, while `sys_approval_request` declares its decision actions
  **inline on the object**. Those labels were extractable but ungated, so an
  untranslated one could ship and no lint run would notice. Coverage now derives
  its expected keys from `collectExpectedEntries()` — the extractor's walker — so
  the gated surface and the scaffolded surface cannot disagree again. Newly gated
  as a result: inline object actions, action `params` and `resultDialog` copy,
  object-nested `listViews` (label / description / `emptyState`), object
  `description`, field `help` / `placeholder`, and the `apps` / `dashboards` /
  `pages` surfaces. Extract output is byte-identical — verified against the
  committed plugin bundles.

  **It stays silent for projects that do not translate.** Which locales get
  checked is the project's declaration, never an assumption: `os lint`,
  `os i18n check` and `os i18n extract` now read the stack's own
  `i18n.defaultLocale` / `i18n.supportedLocales`, falling back to the locales a
  bundle already exists for, and finally to `en`. A project with neither is
  checked against its default locale alone — which its inline labels already
  satisfy — so it reports zero i18n issues. That also fixes a monolingual
  _non-English_ project being told it owed `en` translations it never claimed to
  speak. Locked by regression tests; the three bundled examples stay at 0 errors.

  **The server sent English regardless of locale.** `translateObject` walked an
  object's `label` / `pluralLabel` / `description` / `fields` but never its inline
  `actions`, so `GET /api/v1/meta/object/:name` returned the authored English
  literals even though `@objectstack/plugin-approvals` ships `_actions`
  translations for all eight decision actions in zh-CN / ja-JP / es-ES. The
  Console compensated by re-resolving labels client-side against a separately
  fetched bundle; every other consumer — mobile, plain HTTP, SDUI — rendered the
  source language. It now runs inline actions through `translateAction`, without
  stamping a synthetic `objectName` onto the response.

  Adds `os i18n extract --no-metadata-forms`. Whether the companion
  `<locale>.metadata-forms.generated.ts` file is written was previously implicit:
  every run emitted it, so `--check` demanded that file in packages that
  deliberately do not commit one. The Studio metadata-form baseline is
  registry-driven and identical for every stack, so exactly one package owns it
  (`platform-objects`); a plugin translating only its own objects now opts out,
  and its `--check` stops failing on a tree that is in sync. Defaults to emitting,
  so `pnpm check:i18n` keeps covering all 8 platform bundles.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- 85e1e4e: feat(rest): `treatAsHistorical` import option — skip the state machine for historical-data migration (#3479)

  Sibling of #3433 (seed exemption), one entry point over. #3165's `initialStates` enforced
  the FSM entry point on every INSERT, so importing established historical facts —
  a batch of already-`closed` tickets, `closed_won` deals, `completed` projects —
  was rejected row-by-row with `invalid_initial_state`, blocking the core
  data-migration path. Unlike the seed case it was visible (per-row errors), but it
  still functionally blocked a legitimate use.

  - **spec**: `ExecutionContext.skipStateMachine` — a general, server-set flag (the
    seed-specific `seedReplay`'s sibling) that skips the `state_machine` rule for a
    write; `ImportRequestSchema.treatAsHistorical` (default `false`) — the user-facing
    import option.
  - **objectql**: the engine now skips the state machine for `seedReplay` OR
    `skipStateMachine` (one helper), covering both seed replay and historical import.
  - **rest**: the import runner sets `skipStateMachine` on the write context iff the
    request opts into `treatAsHistorical`; default off, so a normal import still walks
    the FSM (the strict behavior is the default). Import **undo** now also carries
    `skipStateMachine`, since restoring a prior snapshot re-writes an earlier state
    that need not be a legal transition from where the row is now.
  - **platform-objects**: `sys_import_job.treat_as_historical` audit column (additive).

  Scope is identical to the seed exemption: ONLY the `state_machine` rule is skipped;
  field shape, `format`, `cross_field`, `script` all still run. The objectui import
  wizard checkbox is a separate follow-up.

- dac6a08: feat(driver-sql)!: make index drift visible to `os migrate plan` — no more silent DDL at boot (#3728)

  The #3696 unique-scope migration converged **in place**: `syncTableIndexes` ran a
  `DROP` + `CREATE UNIQUE INDEX` during `initObjects`, in every environment,
  leaving one log line behind. `os migrate plan` showed nothing, because
  `detectManagedDrift` was column-only — `ManagedDriftOp` had no index dimension at
  all. An operator who wanted to review the DDL before it reached their database
  had no way to, and a managed schema was being auto-altered in production, which
  the #2186 contract explicitly forbids.

  Index drift is now a first-class dimension, reconciled through the same path as
  column drift:

  - **`syncTableIndexes` is additive only.** It creates indexes; it never drops or
    rewrites one. `dropLegacyGlobalUniques` is gone.
  - **New `DriftOp` variants** — `replace_unique_index` (safe: retire the legacy
    platform-wide unique in favour of the tenant composite), `create_index` (safe),
    `recreate_index` (needs-confirm; destructive when it tightens to `UNIQUE`), and
    `drop_index` (destructive).
  - **`detectManagedDrift` reports them**, `os migrate plan` renders them (index
    ops display as `table [index_name]`), and `os migrate apply` executes them.
    Index DDL is portable, so it applies directly on every dialect — no SQLite
    table rebuild.
  - **`replace_unique_index` creates before it drops**, so uniqueness is never
    unenforced mid-migration and a failed create leaves the schema untouched.
  - **Declared `indexes[]` drift is covered too**: an index metadata declares but
    the database lacks, and one whose definition no longer matches the declaration
    (the additive sync skips those by name, so they could never self-heal).
  - **Orphan detection is limited to ObjectStack's own generated naming**
    (`uniq_…` / `idx_…`, plus the pre-#3696 `<table>_<column>_unique` knex
    spelling). A hand-rolled operational index is never reported as drift and
    `--allow-destructive` will not delete it.

  **Behaviour change.** Boot no longer rewrites the index unconditionally. Dev
  (`autoMigrate: 'safe'`, what `os dev` / `os serve` use) still self-heals on
  restart, so local workflows are unchanged. Production now **warns** with an
  actionable `os migrate` hint and leaves the schema alone — the deployment stays
  on the legacy global unique (multi-tenant inserts still collide) until someone
  runs `os migrate apply`. That is the deliberate trade: a visible, pre-inspectable
  migration instead of an invisible one.

  Also fixed: `managedObjectIndexes` was never cleared when an object dropped its
  `indexes[]`, so drift detection kept expecting an index nobody declared.

  `SchemaDiffEntryKind` gains `index_mismatch` and `unmapped_index`.

- d77d1b7: fix(spec): the liveness gate's stale-evidence check was ~100% false positives — and it was burying a real one

  The check was one line:

  ```ts
  const file = String(led.evidence).split(':')[0];
  if (/\//.test(file) && !existsSync(join(repoRoot, file))) → flag
  ```

  i.e. it assumed every `evidence` string is exactly `path/to/file.ts:123`. Almost
  none are — they carry prose (`packages/spec/src/stack.zod.ts (mergeActionsIntoObjects
stable-sorts each group)`), multiple pointers, or a cross-repo attribution
  (`objectui: packages/app-shell/…`). Taking everything before the first colon
  turns that prose into the "filename", which never exists.

  Result: **48 of 227 entries flagged, every one a parse artefact or a deliberate
  cross-repo pointer.** A permanently non-empty, ~100%-false warning is a warning
  nobody reads — which is exactly how the one genuine rot in that list went
  unnoticed:

  - **`object.enable.clone`** cited `packages/objectql/src/protocol.ts:2259`. That
    file no longer exists; `cloneData()`'s `enable.clone` gate moved to
    `packages/metadata-protocol/src/protocol.ts:2938`. The claim stayed true, the
    pointer rotted, and the check that exists to catch precisely this could not be
    heard over the noise. Pointer repaired and dated.

  **New `evidence.mts`** extracts repo-rooted paths properly and honours the
  cross-repo attribution entries already write in prose:

  - a realm marker (`objectui`, `cloud`, `ee`) attributes the paths after it, up to
    the next clause boundary, so one string can cite both repos; `framework`
    switches back explicitly;
  - `packages/services/service-ai/…` is always foreign — the closed cloud runtime,
    the one sibling missing from this repo's `packages/services/`;
  - non-repo-rooted tokens (`app-shell/MetadataProvider.tsx`,
    `action-button/-group`) read as prose, neither resolved nor reported.

  The gate now resolves **156 evidence paths** against the checkout, attributes 36
  to another repo, and reports **zero** stale — down from 48 warnings that said
  nothing. Each run prints the two counts, so the check degrading to "extracts
  nothing" is visible rather than silently green (a unit test asserts it too).

  Also updates the ledger README, whose advice to write objectui paths "as prose to
  avoid false stale-flags" was a workaround for this bug: write the full path with
  a realm prefix instead.

- 5b79a34: feat(spec): register the 13 orphan dogfood proofs — five advance the ADR-0054 ratchet, eight say why they can't

  The gate flagged 13 `@proof:` tags under `packages/qa/dogfood/test/**` that no
  class in `proof-registry.mts` claimed. Silencing that warning is trivial and
  worthless; the useful question is the one ADR-0054 §3 actually asks: **is there
  an authorable property whose `live` status this proof gates?** Each of the 13 was
  re-read against that.

  **Five had one, and are now BOUND** — a `live` classification on these entries
  requires its proof, so the ratchet advances from 10 bound paths to 17:

  | Proof                           | Now gates                                               | Why it qualifies                                                                                                                                                |
  | ------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `attachments-permission-matrix` | `object.enable.files`                                   | the #2727 opt-in gate proven in BOTH directions — the fixture carries a deliberate non-declaring object (`att_nofiles`) that must be refused 403 FILES_DISABLED |
  | `showcase-d3-d4-capabilities`   | `permission.rowLevelSecurity.check`                     | authors `check: 'owner == current_user.email'` and proves the write POST-image is validated (distinct from `using`, which filters the pre-image)                |
  | `showcase-scope-depth`          | `permission.objects.readScope`                          | authors `unit` / `unit_and_below` profiles and proves the owner-match widens, with cross-BU still isolated                                                      |
  | `owner-anchor-and-bulk-writes`  | `permission.objects.modifyAllRecords`                   | member denied the transfer, privileged caller allowed — both directions                                                                                         |
  | `semantic-roles-served`         | `object.highlightFields`, `.stageField`, `.fieldGroups` | asserts all three survive defineStack → artifact → registry → REST verbatim (incl. `stageField: false` as a strict false)                                       |

  **Eight do not, and record why** rather than faking a binding — the shape the
  registry already used for `permission-set-projection`:

  - `flow-runas-schedule` and `showcase-scope-depth-fallback` guard properties
    (`flow.runAs`, `permission.objects.readScope`) that are _already_ bound to a
    sibling proof. A ledger entry carries one `proof` ref, so a second gate on the
    same property is not representable — they run unconditionally instead.
  - `me-apps-and-everyone-baseline` enforces `app.requiredPermissions` /
    `app.tabPermissions`; `app` is not a governed type yet. Bind when it lands.
  - `showcase-agent-intersection` / `showcase-agent-scope-ceiling` guard runtime
    principal-resolution invariants (`onBehalfOf`, OAuth scope → ceiling set), not
    authorable metadata.
  - `showcase-bu-hierarchy-sharing` / `showcase-declarative-rbac-seeding` act on
    stack-level `roles`/`sharingRules`, not a per-type property surface.
  - `showcase-permission-zoo` is a breadth guard over the whole ADR-0090 surface;
    binding it to any one entry would misrepresent both.

  **One deliberate non-binding worth naming.** `owner-anchor-and-bulk-writes` binds
  `modifyAllRecords`, not the sibling `allowTransfer` — the proof only _mentions_
  `allowTransfer` in a comment and never authors it. Binding a property a proof
  does not exercise is the same false comfort as a preview renderer standing in for
  a runtime consumer, which is the error this ledger spent #3686 unwinding.

  Also verified the bound proofs actually run: the only `skipIf` among them covers
  `attachments-permission-matrix`'s enterprise cross-tenant block, not the
  FILES_DISABLED assertion the binding rests on.

  The gate now runs with **zero warnings** — the orphan list joins the
  stale-evidence list at empty, so both mean something again. The ledger README's
  ratchet table was itself stale (5 classes listed, 10 bound) and is now complete,
  with the unbound set and its reasons alongside.

- c757854: feat(spec): `verifiedAt` re-verification clock on liveness entries + two entries re-verified against objectui (#3714 follow-up)

  A ledger entry is a claim with a timestamp, and **twice** now one has been
  falsified by code moving under it — `flow.status` (#3711) and `action.undoable`
  (#3714), both _understated_, both found only because a sweep aimed at the
  opposite failure walked past them. Nothing in the gate asked how old a claim
  was, so a stale entry stayed invisible until someone tripped over it.

  **`verifiedAt`.** Ledger entries may now carry `"verifiedAt": "YYYY-MM-DD"` —
  the date a human last closed the call graph. The asymmetry is the design:

  - **Age never fails CI.** Re-verification is a worklist, not a merge gate. Every
    run prints one summary line; `pnpm check:liveness --stale-verification[=days]`
    prints the worklist (stale oldest-first, then undated). Default 180 days.
  - **A malformed or future-dated value DOES fail CI.** A date the parser can't
    read would silently exempt that entry from every staleness window — the same
    silent-no-op shape this ledger exists to catch. Also rejects calendar-invalid
    dates, since `new Date('2026-02-30')` rolls over to March 2 rather than
    throwing.

  Currently 2 of 401 entries are dated. The rest predate the field and report as
  undated; date them as you re-verify rather than back-filling guesses.

  **Two entries re-verified against objectui `732b1bf`:**

  - `action.undoable` — both readers stand, and the call graph now closes end to
    end in the evidence: the two `if (action.undoable …)` gates build
    `result.undo`; `ActionRunner.ts:640-643` pushes it onto `globalUndoManager`
    and passes `undo` to the toast handler; the toast's Undo button runs
    `undoCtl.undo()` → `useGlobalUndo` → `UndoManager` → `dataSource`. The cited
    `RecordDetailView` line numbers had already drifted (545→573, 404→432) in the
    day between the issue being filed and this pass — hence the pinned sha.
  - `action.type` — `api` → `executeAPI`, `form` → `executeForm`, both real.

  **Docs correction (`content/docs/ui/actions.mdx`).** That page told authors the
  schema's `api` and `form` types have "no runtime executor / renderer today —
  stick to the four above." Both have had executors in objectui's `ActionRunner`
  for some time, and the ledger's own `action.type` entry recorded `form` as live
  since #2377. Same understatement shape as #3714, one page over. Both types now
  have table rows; the callout keeps the parts that are true (`shortcut` and
  `bulkEnabled` really are unwired) and links the ledger. `undoable` also joins
  the UX property list, which is the author-facing payoff of #3714.

- 0fc6219: feat(spec): the example type-check gate now covers `content/docs`, not just `skills/`

  `check:skill-examples` compiles the TypeScript in prose against the built spec, so
  an example that stops compiling fails CI instead of quietly teaching code that no
  longer works. It does its job — it caught the broken `defineTool` example when
  `tool.requiresConfirmation` was removed (#3715).

  But it only ever walked `skills/`:

  | Tree                           | files with `ts` blocks | compiled |
  | ------------------------------ | ---------------------- | -------- |
  | `skills/`                      | 9                      | **9**    |
  | `content/docs/` (hand-written) | 124                    | **0**    |

  The identical break in a docs page would have shipped. Docs examples are copied
  verbatim by humans and AI exactly like skill examples, so a gate covering a
  fraction of the surface it appears to cover reads as coverage — the same shape as
  the stale-evidence and orphan-proof warnings fixed in #3857 / #3868.

  The walker is now a `SOURCE_ROOTS` list, and this lands the first batch: **164
  docs blocks across 63 pages, taking the gate from 32 to 196 checked examples**.
  `content/docs/references/` is excluded — `build-docs.ts` regenerates it from the
  schemas, so it cannot drift independently of its source.

  **The marker is now per-format.** MDX has no HTML comments: `<!-- os:check -->` in
  a `.mdx` fails the fumadocs build outright — _"Unexpected character `!`… to create
  a comment in MDX, use `{/_ text _/}`"_. Caught by building the docs site, after
  the first attempt broke 60+ pages. `skills/**/*.md` keeps `<!-- os:check -->`;
  `content/docs/**/*.mdx` uses `{/* os:check */}`. Both spellings are recognised for
  **orphan** detection, so a wrong-format marker fails loudly rather than silently
  checking nothing — the existing guard's philosophy, extended to the new failure
  mode this change introduces.

  The batch was measured rather than guessed: marking all 780 docs blocks and
  compiling showed which are self-contained. One subtlety worth recording — a block
  that "passes" inside a 780-file program can be leaning on globals declared by
  _other_ blocks (a file with no import/export is a global script), so the set was
  converged by recompiling and dropping newly-failing blocks until green. 164 stand
  on their own.

  The remaining blocks are mostly fragments (a `columns: [...]` subtree), which the
  gate's opt-in design already anticipates. Whether any are genuine rot is worth a
  follow-up now that the machinery reaches them.

- f07808c: feat(spec): reject a `body` on a non-script action — it would never run (#3530)

  `Action.body` is documented as "only meaningful when `type === 'script'`", but
  nothing enforced it. A `type: 'modal'` action authored with `params` and a
  `body` — expecting the modal to collect the input and the body to write the
  record on submit — passed validation, passed shape tests, and shipped a button
  that opened a modal and silently wrote nothing. Non-script types all dispatch on
  `target` (the page to open, the URL, the flow, the endpoint); there is no point
  at which a renderer would invoke the body.

  This is the same invisible-failure shape as the existing rule that rejects a
  `script` action with neither `body` nor `target` (#2169), so it is enforced the
  same way: a parse-time error that names the fix — `type: 'script'` collects the
  same `params` and does run the body, and a modal that only opens a page should
  drop the `body` and keep `target` naming the page.

- 32ff033: docs(spec): correct ReportChart `xAxis`/`yAxis` semantics; mark dead report surface (#1890)

  Closes the report residual of the ADR-0021 analytics migration (#1890). The
  dataset-bound report chart already renders — objectui's `DatasetReportRenderer`
  plots `chart.xAxis`/`yAxis` as the bound dataset's **dimension**/**measure** via
  `useDatasetRows`, and the Studio `ReportDefaultInspector` picks them from the
  dataset's dimension/measure catalogs — but the spec `.describe()` still called
  them raw "Grouping field" / "Summary field", misleading an author (or AI) into
  naming object fields instead of dataset dimension/measure names.

  - `ReportChart.xAxis`/`yAxis` describe now states they are dataset
    dimension/measure names (matching the live renderer + inspector).
  - `ReportChart.groupBy` marked `[EXPERIMENTAL — not enforced]` — the
    dataset-bound renderer plots a single `xAxis`×`yAxis` series and never reads
    it; only the legacy `ReportViewer` fallback did.
  - `ReportColumnSchema` / `ReportGroupingSchema` marked `@deprecated` — the
    single-form report shape expresses columns/grouping as dataset
    measure/dimension name arrays, so these objects are unreferenced; they remain
    only as public type exports (objectui re-exports them) pending a governed
    prune.

  Docs regenerated (`ui/report.mdx`). No shape or parse-behavior change; no
  export removed.

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

- 6633337: fix(service-storage): emit the declared success envelope on all eight routes (#3689)

  #3675 moved the **error** bodies of the autonomously-mounted `/api/v1/storage/*`
  routes into the declared `{ success: false, error: { code, message } }`
  envelope and deliberately stopped there: unlike the errors, the success bodies
  were not an additive fix. They were three shapes, none of them carrying the
  `success` flag `BaseResponseSchema` declares and
  `ObjectStackClient.unwrapResponse` keys on —

  | Route(s)                                                                                                                     | Was                 | Now                                |
  | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- |
  | the six upload routes (`/upload/presigned`, `/upload/complete`, `/upload/chunked`, `…/chunk/:i`, `…/complete`, `…/progress`) | `{ data: {…} }`     | `{ success: true, data: {…} }`     |
  | `GET /files/:fileId/url`                                                                                                     | `{ url }`           | `{ success: true, data: { url } }` |
  | `PUT /_local/raw/:token`                                                                                                     | `{ ok: true, key }` | `{ success: true, data: { key } }` |

  — while `storage.zod.ts` declared every one of them as
  `BaseResponseSchema.extend({ data })`, and `PresignedUrlResponse` and friends
  are `z.infer`red from those schemas and published as the SDK's return types.
  The declaration said `success: boolean`; the wire said nothing. It broke
  nothing only because the storage SDK methods returned `res.json()` raw —
  `any`, so TypeScript could not see the gap and nothing relied on the
  declaration. That is the posture i18n was in before #3636, right up until
  something did rely on it.

  **The payload moved on two routes, and that is the breaking part.** A direct
  HTTP caller reading `body.url` from `GET /files/:fileId/url` must now read
  `body.data.url`; one reading `body.ok`/`body.key` from the local adapter's
  `PUT /_local/raw/:token` loopback must read `body.success`/`body.data.key`.
  `ok` is dropped rather than kept beside `success` — it was a second, private
  word for the same thing. The six upload routes are additive: callers already
  destructure `.data`, and a new sibling key changes nothing.

  Every in-repo consumer was fixed first, so the two repos are not coupled by
  merge order:

  - `client.storage.getDownloadUrl()` now reads through `unwrapResponse`, the
    SDK's one standard envelope seam — which strips the envelope when present
    and returns the body untouched when not, so a client either side of this
    server change resolves the same URL. The other storage methods hand back the
    whole envelope by design and were already correct.
  - The console's two attachment openers (`RecordAttachmentsPanel`,
    `ApprovalsInboxPage`) already read `body?.url ?? body?.data?.url`; objectui
    gains tests pinning that tolerance as deliberate.

  Two schemas that were missing are now declared — `FileDownloadUrlResponse` and
  `RawUploadResponse` — and `getDownloadUrl` joins `StorageApiContracts`, which
  it had never been in. That absence is how its shape drifted outside the
  envelope unnoticed. The two `_local/raw/:token` routes stay out of the
  registry on purpose: they are the local adapter's own presign loopback,
  ledgered `server-only` and addressed as an opaque signed URL rather than as an
  API.

  `success-envelope.conformance.test.ts` holds the new shape in place the way
  `error-envelope.conformance.test.ts` holds the error one: every route is
  driven and its body parsed against the **declared schema** it answers to — not
  a restatement — the retired shapes are asserted dead, and the module source is
  scanned so a new route cannot bypass the `sendOk` helper. As with #3675, the
  route ledgers cannot catch this class of drift: they audit which routes exist
  and whether the SDK can address them, not what comes back.

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

- 0bc685a: fix(storage): downloads carry the real filename + content-type, not the URL token (#3504)

  A presigned download served the bytes as `application/octet-stream` with no
  `Content-Disposition`, so a browser saved the file under the opaque URL token
  (e.g. `eyJrIjoiYXR0YWNo…`) instead of its real name — an approval's
  `signed-contract.pdf` downloaded as a nameless blob.

  - `IStorageService.getSignedUrl` / `getPresignedDownload` take an optional
    `PresignedDownloadOptions` (`filename`, `contentType`, `disposition`).
  - The REST download routes (`GET /storage/files/:id/url` and `/:id`) pass the
    `sys_file` record's `name` + `mime_type`.
  - The local adapter carries them in the signed token; the `_local/raw` route
    emits `Content-Type` + an RFC 5987 `Content-Disposition` (ASCII fallback +
    `filename*=UTF-8''…` for non-ASCII names). The S3 adapter bakes the same into
    the signed URL via `ResponseContentType` / `ResponseContentDisposition`.
  - Default disposition is `inline`, so previewable types (PDF, images) still open
    in the browser — now with the correct name when saved.

- 11949fc: fix(spec): tombstone `agent.tools` instead of deleting it — main was red (#3894 follow-up)

  #3894 removed `agent.tools` (and `AIToolSchema`) outright. That broke
  `pnpm --filter @objectstack/spec build` on `main`: the authorable-surface
  ratchet (ADR-0104 / #3733) fails when an authorable key disappears from
  the contract, because none of these schemas is `.strict()` — Zod silently
  STRIPS an unknown key, so an author who keeps writing `tools:` would get a
  clean parse and an agent that reaches none of the tools they listed. That
  is the same silent-capability-loss shape #3820 exists to eliminate,
  restored one layer down. The gate was right and the removal was wrong.

  The removal itself stands — ADR-0064's "an agent reaches exactly its
  surface-compatible skills' tools, nothing falls through to the global
  registry" needs the second slot gone. What changes is HOW:

  - **`agent.tools` is now `retiredKey()`** — authoring it throws with the
    fix in the message (use `skills`; a platform tool by name, or
    `action_<name>` for your own AI-exposed Action; `os migrate meta
--from 16`). This supersedes #3894's changeset line saying the key
    "remains a silent no-op rather than a parse error": loud is correct,
    and it is what this repo's ratchet requires.
  - **A D2 conversion `agent-tools-to-skills`** plus its D3 chain step, so
    the removal reaches `spec-changes.json`, the upgrade guide, and the
    `spec_changes` MCP tool. Unlike the protocol-17 renames beside it this
    has no lossless target — each entry must become a reference inside a
    skill, a human decision — so the conversion drops the dead key (the
    runtime stopped reading it in cloud#910) and emits one notice per agent
    marking where capability has to be re-declared.
  - **The three `ai/AITool:*` baseline lines are deleted deliberately**, the
    one case the ratchet sanctions in-PR. Those keys were authorable only as
    the element shape of `agent.tools`; with the parent tombstoned there is
    no path that reaches them, so they cannot vanish silently — the parent
    speaks first, with a prescription.

  Agent tests updated to pin the rejection (and its message) rather than the
  strip semantics they asserted before.

- b098b0e: docs(ai): stop `tool.requiresConfirmation` promising a gate it does not provide (#3715)

  The flag is read by **no execution path** — not the LLM tool set, not
  `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, not the MCP bridge.
  Yet the authoring surface actively taught reliance on it: the Studio form
  section was titled _"Access & safety"_ with helpText _"Ask user to approve
  before executing (for destructive actions)"_, and the AI skill doc, MCP guide
  and spec README all recommended it for destructive operations.

  The prune-or-wire decision is deliberately **deferred** (#3715 — the field's
  shape is likely needed once side-effect tools exist, which `ToolCategory`
  already anticipates with `action` / `integration` / `flow`). What changes now
  is only the promise:

  - spec `.describe()` carries `[EXPERIMENTAL — not enforced]` + a pointer to the
    real gate;
  - the form section is renamed _"Declarative metadata (not enforced)"_ and both
    its fields (this and the already-dead `permissions`) say so, with the enforced
    alternative spelled out;
  - `skills/objectstack-ai/SKILL.md`, `MCP_GUIDE.md` and `README.md` now point at
    the action-level `ai.requiresConfirmation` + approval queue (and note that AI
    metadata edits are already gated by draft/publish, ADR-0033).

  No behaviour change: nothing read the flag before and nothing reads it now.

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

## 16.1.0

### Minor Changes

- 9e45b63: feat(cli): preflight that every `requires` capability has an installable provider
  in the current edition (#3366)

  A capability listed in `requires: [...]` was only checked at `serve`/`start` time,
  and a missing provider produced a generic "not installed — add it to your
  dependencies" error even when the provider has **no installable version in the
  current edition**. `os validate` (token-vocabulary only) and `os build` (never
  resolved providers) both passed, so a `validate && build && test` CI script never
  caught it — it surfaced only as an opaque boot crash. Seen upgrading an
  open-edition app from `14.7` to `16` after `@objectstack/service-ai` went
  cloud-only (ADR-0025).

  - `@objectstack/spec/kernel` now exports `PLATFORM_CAPABILITY_PROVIDERS`
    (token → provider package + edition) and a pure `classifyRequiredCapability()` —
    one machine-readable source of truth for the provider/edition knowledge the
    serve resolver previously encoded informally.
  - `os build` and `os validate` gained a provider preflight. A `requires` entry
    whose provider has **no installable version in the active edition** (e.g. `ai` →
    `@objectstack/service-ai`, cloud-only) now fails fast with an edition-aware
    message; an absent-but-installable provider is an advisory `pnpm add` hint, not
    a hard error; a satisfied `requires` list passes unchanged.
  - The `os serve` boot error now renders the same classification, so preflight and
    boot read identically.

## 16.0.0

### Major Changes

- 6c270a6: **BREAKING: remove the deprecated `ctx.session.tenantId` / `ctx.user.tenantId` alias from the hook & action authoring surface — converge on `organizationId` (#3290).**

  #3280 made `organizationId` the blessed developer-facing name for the caller's active org across the JS authoring surface and kept `tenantId` as a `@deprecated` alias carrying the identical value. That alias is now **removed** from the hook `ctx.session`, the action-body `ctx.session`, and the action-body `ctx.user`. Read the caller's active org under the single blessed name:

  ```diff
  - const org = ctx.session.tenantId;   // hook or action body
  + const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
  ```

  **FROM → TO migration** (in any `*.hook.ts` / `*.action.ts` body):

  - `ctx.session.tenantId` → `ctx.session.organizationId`
  - `ctx.user.tenantId` (action body) → `ctx.user.organizationId`

  The value is unchanged — `organizationId` is the same active-org id, matching the `organization_id` column and `current_user.organizationId` in RLS/sharing. `ctx.user` is `undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId` when a hook or action must work regardless of a resolved user.

  What changed internally:

  - **`@objectstack/spec`** — `HookContextSchema.session` drops the `tenantId` field (only `organizationId` remains). A stray `tenantId` on a constructed session is now stripped by the schema.
  - **`@objectstack/objectql`** — the engine's `buildSession()` no longer emits `session.tenantId`; the audit-stamp plugin sources the `tenant_id` column from `session.organizationId`.
  - **`@objectstack/runtime`** — `buildActionSession()` and the REST action `ctx.user` no longer emit `tenantId`.
  - **`@objectstack/trigger-record-change`** — reads `session.organizationId` (was `session.tenantId`) when forwarding the writer's org to a `runAs:'user'` flow; behavior is identical.

  **Explicit non-goal (unchanged):** the generic **driver-layer** tenancy abstraction is _not_ touched — `ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope` / `TenancyConfig.tenantField`, and `ExecutionLog.tenantId`. That isolation column is configurable and legitimately carries an _environment_ id in database-per-tenant kernels; it is a distinct axis from the developer-facing org. The build-time `check:org-identifier` guard now also covers `packages/**` to keep reference bodies off the removed name.

### Minor Changes

- f972574: feat(spec): `ActionParamSchema` gains optional widget config — `multiple`, `accept`, `maxSize`

  The console now renders action params through the same field-widget renderer
  the record form uses (objectui#2700, objectui ADR-0059), so inline params can
  declare the widget config the form widgets consume: `multiple` (array value
  shape, mirrors `FieldSchema.multiple`), and the upload constraints `accept`
  (MIME types / extensions) and `maxSize` (bytes) for `file`/`image` params.
  Field-backed params (`{ field }`) keep inheriting these from the referenced
  field at runtime; inline values override. Purely additive — no existing
  schema changes shape.

- 6289ec3: feat(i18n): translation slot for action `resultDialog` copy — the one-shot secret-reveal dialogs are now localizable

  The post-success `resultDialog` (temporary passwords, 2FA backup codes, OAuth
  client secrets) had no slot in the translation protocol, so its title /
  description / acknowledge button / field labels always rendered the hardcoded
  English metadata literals even on fully-translated locales.

  - **spec.** `_actions.<action>` (object + object-first node) and
    `globalActions.<action>` gain an optional `resultDialog` translation node
    (`ActionResultDialogTranslationSchema`): `title`, `description`,
    `acknowledge`, and `fields` keyed by the **literal** result-field path
    (e.g. `"user.email"` — keys may contain dots; resolvers index the record
    directly, never split on `.`). New `resolveActionResultDialog` overlay
    resolver, wired into `translateAction` for API-boundary translation.
  - **cli.** `os i18n extract` emits the new `resultDialog.*` keys (title /
    description / acknowledge / `fields.<path>` for labelled fields), so
    coverage and skeleton generation see them.
  - **platform-objects.** en / zh-CN / ja-JP / es-ES bundles ship the
    resultDialog copy for all six shipped dialogs: `sys_user.create_user`,
    `sys_user.set_user_password`, `sys_two_factor.enable_two_factor`,
    `sys_two_factor.regenerate_backup_codes`,
    `sys_oauth_application.create_oauth_application`, and
    `sys_oauth_application.rotate_client_secret`.

  Client-side rendering lands in objectui (`actionResultDialog` resolver in
  `@object-ui/i18n` + result-dialog handlers). Purely additive — untranslated
  locales keep falling back to the metadata literals.

- 8efa395: feat(approvals): server-computed `viewer` capability for precise decision-action gating

  `getRequest` / `listRequests` now attach a per-viewer block —
  `viewer: { can_act, is_submitter }` — computed from the caller's context
  (`ApprovalRequestRow.viewer`):

  - `can_act` — the caller is a _current pending approver_ (their user id is in the
    request's resolved `pending_approvers` while it is still `pending`). This is
    the same check the decision methods authorize with, so it already reflects
    position/team/manager resolution — strictly more accurate than a client-side
    identity guess.
  - `is_submitter` — the caller submitted the request.

  The declared decision actions on `sys_approval_request` now gate on it: approver
  actions (approve/reject/reassign/send-back/request-info) use
  `record.viewer.can_act`; submitter levers (remind/recall/resubmit) use
  `record.viewer.is_submitter`. Previously approver actions only trimmed the
  non-pending case, so a submitter viewing their own pending request saw buttons
  they couldn't use (the backend 403'd); a position-addressed approver could be
  wrongly hidden by the old client heuristic. Where `viewer` is absent (a row
  surfaced outside a service read with a user context), the predicate fails closed.

- 3a18b60: feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

  `ApproverType.role` was the last platform surface projecting the reserved word
  "role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
  exception protects better-auth's own `sys_member.role` **column**, which we do
  not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
  that the projection of that concept is spelled `org_membership_level` and
  labelled "organization membership", **never "role"**.

  The sentence licensing the leak was also false: ADR-0090 D3 claims
  `sys_member.role` is "already relabelled `org_membership_level` in the platform
  projection", but `org_membership_level` existed nowhere in the codebase and
  ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
  projection never landed, so the word reached authors.

  The name manufactured a real, silent failure — "hotcrm class": every other
  surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
  `ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
  legacy spelling of a position. It resolves against the membership tier, finds
  no member row, falls back to an inert `role:sales_manager` literal, and the
  request waits forever on an approver that cannot exist.

  - **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
    deprecated alias for one window (a published 15.x flow keeps loading) with
    `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
    for the mapping. Removed in the next major.
  - **plugin-approvals**: resolves on the canonical type and warns on the
    deprecated spelling. The `type:value` fallback literal keeps the **authored**
    spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
    from 15.x carry `role:<v>`, and rewriting it would orphan them.
  - **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
    (the rule id carried the reserved word too), plus a new
    `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
    _value_ wins, because prescribing `org_membership_level` for a position name
    would be wrong advice — the fix there is `position`.

  Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
  `org_membership_level`; if the value is an org position, the fix is `position`.

- 43a3efb: fix(rest): gate the cross-object transactional batch by the same per-object API rules as single-record writes (#1604)

  The `POST {basePath}/batch` route (issue #1604 / ADR-0034) wraps N cross-object
  create/update/delete ops in one engine transaction, but it skipped the
  per-object API-exposure gate every single-record route applies — an
  authenticated caller could write to an `apiEnabled: false` object, or run an
  operation outside an object's `apiMethods` whitelist, straight through the batch
  surface (ADR-0049 / #1889 — the same "declared ≠ enforced" hole closed for the
  generic write path in #3220 / #3213).

  The route now:

  - validates the body against a new `CrossObjectBatchRequestSchema`
    (`@objectstack/spec/api`, Zod-First) — a malformed op, an unknown action, or a
    missing `object` is a `400` instead of a `500`;
  - enforces `enable.apiEnabled` / `enable.apiMethods` for **every** op (metadata
    fetched once, each distinct `(object, action)` checked) BEFORE opening the
    transaction — `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - requires an `id` for `update` / `delete` (`400`);
  - rejects an unresolvable `{ $ref }` with `400 BATCH_UNRESOLVED_REF` instead of
    silently writing a `null` FK;
  - rejects an explicit `atomic: false` (`400 BATCH_NOT_ATOMIC`) rather than
    silently applying atomically — non-atomic per-object batches stay on
    `POST /data/:object/batch`.

  `enforceApiAccess` is refactored to share the pure `apiAccessDenialFromEnable`
  check + a `loadObjectItems` helper with the batch route (single-record behavior
  unchanged). Adds `rest-batch-endpoint.test.ts` — the REST-boundary coverage
  ADR-0034 flagged as missing (commit, `$ref`, rollback surfacing, API-access
  denial, request validation).

- 524696a: feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

  The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
  undeclared top-level key instead of silently stripping it, moving a whole class
  of author error (a hallucinated or legacy key that renders as a silent no-op)
  from fallible human review to deterministic CI. `options: z.unknown()` remains
  the escape hatch for renderer-specific extras.

  A custom error map names the offending key(s) and, when a key is a removed
  pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
  `aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
  (`component`, inline `data`), points the author at the dataset shape
  (`dataset` + `dimensions` + `values`).

  Recorded as protocol-16 migration `step16`
  (`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
  strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
  itself was already removed at protocol 9 (single-form cutover), so there is no
  mechanical rewrite — the residue is the strictness, delegated to the author.

  **Breaking:** shipped as `minor` per the launch-window policy (a breaking change
  does not burn a major while the stack is in lockstep), riding the already-pending
  16.0.0 train. The release train's Version-Packages PR must set
  `PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
  (`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

  `@objectstack/lint` — the `widget-legacy-analytics-shape` /
  `widget-legacy-analytics-unrenderable` rules are retained as the friendly,
  suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
  the schema-parsed compile/validate paths); doc comment updated to explain the
  interplay.

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- fefcd54: fix(spec): declare `ownership` as a first-class ObjectSchema field (#3175)

  The object-level record-ownership model — `ownership: 'user' | 'org' | 'none'`,
  which drives the registry's `owner_id` auto-provisioning (`applySystemFields`) —
  was read by the engine via `(schema as any).ownership` while `ObjectSchema.create()`
  **rejected** it as an unknown top-level key (ADR-0032 / #1535). So a tested engine
  opt-out (`ownership: 'org' | 'none'` on catalog / junction tables) could not be
  set through the sanctioned authoring path, and the same `ownership` word was read
  elsewhere as the unrelated package-contribution kind (`own` / `extend`).

  - **spec**: `ObjectSchema` now declares `ownership: z.enum(['user','org','none']).optional()`.
    Authoring the record-ownership opt-out validates cleanly; the registry reads it
    off the typed schema (no `as any`). A retired `ownership: 'own'` / `'extend'`
    value fails with guidance pointing at the record-ownership model and noting that
    `own`/`extend` is the contribution kind (`registerObject`), not an object-schema value.
  - **cli**: the `object` scaffold no longer emits the now-invalid `ownership: 'own'`
    (owner injection is the default), and `objectstack info` labels the record model
    with the correct `user` default.

  No runtime behavior change: `applySystemFields` and its `owner_id` injection logic
  are unchanged — this makes the property the engine already honors legally authorable
  and consistently typed.

- 369eb6e: refactor(spec): remove unenforced agent `visibility` field (ADR-0056 D8, #1901)

  The agent `visibility` (`global`/`organization`/`private`) field is **removed**
  from `AgentSchema`. It was never enforced: the chat-access evaluator excluded it
  and the agent list route did not filter by it, so setting `private` never hid an
  agent. Per ADR-0049 / ADR-0056 D8 ("design+enforce or remove"), a security-shaped
  field with no runtime consumer is a liability — authors who set `private` believe
  they've restricted an agent when they have not.

  Unlike `field-encryption` (kept `[EXPERIMENTAL]` — it has a stable schema shape on
  a real roadmap), correct `visibility` enforcement is undesigned: it needs
  owner/org anchors that do not exist today. `agent.tenantId` was already removed
  (#2377), agents carry no owner field, and the `EXTERNAL` posture rung is defined
  but never derived — so `organization` vs `global` is runtime-indistinguishable.
  The semantics, not just the plumbing, are unresolved, so the field is dropped
  rather than carried marked.

  - `AgentSchema` is not `.strict()`, so existing metadata that still sets
    `visibility` parses cleanly — the unknown key is stripped, not rejected.
  - Use `access` / `permissions` to restrict who can use an agent — both **enforced**
    at the chat route (#1884).
  - Re-introduce `visibility` when the agent listing surface gains real owner/org
    semantics; tracked in #1901.

  Also updated: authoring form (`agent.form.ts`), liveness ledger
  (`liveness/agent.json`), the ADR-0056 D10 authz-conformance matrix (moved from
  `experimental` to `removed`), and the generated schema reference docs.

- 06ff734: feat(spec)!: remove deprecated `aiStudio`/`aiSeat` capability aliases (#3308)

  **BREAKING** (shipped as minor per the launch-window convention). The one-cycle
  deprecation window from #3265 is over: the legacy camelCase `requires` spellings
  `aiStudio`/`aiSeat` are no longer canonicalized to `ai-studio`/`ai-seat` — they
  are now plain unknown tokens, rejected by `defineStack` like any other typo.

  - Removed exports `DEPRECATED_PLATFORM_CAPABILITY_ALIASES` and
    `canonicalizePlatformCapability` from `@objectstack/spec`; `isKnownPlatformCapability`
    no longer canonicalizes.
  - `defineStack` no longer rewrites aliases (the `canonicalizeStackRequires` pass
    is gone); the serve resolver no longer canonicalizes raw-artifact `requires`.

  Migration: use the canonical kebab-case tokens `ai-studio` / `ai-seat`. All
  first-party configs were migrated in #862/#863; only stacks still carrying the
  legacy spelling are affected. Cloud's `objectos-runtime` (pinned to an older
  framework) follows on its next `.objectstack-sha` bump.

- b659111: feat(spec)!: remove dead author-facing metadata properties (#2377, ADR-0049 enforce-or-remove)

  Breaking spec-surface removal, versioned as `minor` per the launch-window changeset
  policy (a `major` would promote the whole fixed-group monorepo; breaking cleanups ride
  the minor line, as with #2402 → 11.1.0).

  Removes a batch of spec properties that parsed but had **no runtime consumer** —
  authoring them was a false affordance (especially dangerous for AI-authored
  metadata). Verified dead against the liveness ledger (`packages/spec/liveness/*.json`)
  and a repo-wide grep of readers. This is the follow-up slice to #2402.

  ## Removed (each was `dead` + no reader anywhere)

  - **field** (`field.zod.ts`): `vectorConfig` (+ `VectorConfigSchema` + types),
    `fileAttachmentConfig` (+ `FileAttachmentConfigSchema` + types), `dependencies`.
    Vector fields keep the live flat `dimensions` prop; file/image fields keep the
    live flat `multiple`/`accept`/`maxSize` siblings.
  - **object** (`object.zod.ts`): `versioning` (+ `VersioningConfigSchema`),
    `softDelete` (+ `SoftDeleteConfigSchema`), `search` (+ `SearchConfigSchema`),
    `recordName`, `keyPrefix`. Each is now a **rejecting tombstone** in
    `UNKNOWN_KEY_GUIDANCE` carrying the upgrade prescription.
  - **action** (`action.zod.ts`): `timeout` (server uses `body.timeoutMs`; no
    action-level timeout is enforced).
  - **agent** (`agent.zod.ts`): `planning.strategy`, `planning.allowReplan`
    (only `planning.maxIterations` is read by the runtime).
  - **dataset** (`dataset.zod.ts`): `measures.certified` (declared-but-unenforced
    governance flag — never compiled into the Cube).

  Liveness ledgers, the ledger README table, and `api-surface.json` are updated;
  the removed sub-schema keys are dropped from `json-schema.manifest.json`.

  ## Migration

  - **field/agent/dataset/action props**: authoring them is now silently stripped
    (they never did anything). Remove them. Vector → set flat `dimensions`;
    file/image → set flat `multiple`/`accept`/`maxSize`.
  - **object props**: `ObjectSchema.create()` now throws a located error naming the
    replacement — `versioning`/`softDelete` → hard deletes + `Field.trackHistory` /
    `lifecycle`; `search` → `searchableFields`; `recordName` → an `autonumber`
    `Field` designated as `nameField`; `keyPrefix` → remove (never had an effect).

  ## Deliberately NOT removed (dead, but entangled — a scoped follow-up)

  `field.index`/`columnName`/`referenceFilters` and object
  `tags`/`active`/`isSystem`/`abstract`/`enable.searchable`/`enable.trash`/`enable.mru`
  and `agent.tenantId` are surfaced in the Studio metadata-authoring forms
  (`*.form.ts`) — removing them cascades into i18n bundle regeneration, so they are
  deferred. `action.type:'form'` has a dedicated build-time lint (`lint-view-refs.ts`)
  and a first-party showcase usage, so it needs a UX decision. `field.columnName`
  additionally has an ADR-0062 D7 lint. These stay `dead` + `authorWarn` in the
  ledgers.

- 5754a23: feat(spec)!: remove form-surfaced dead metadata props + correct 3 misclassified-live entries (#2377, ADR-0049)

  The next enforce-or-remove slice of #2377. Versioned `minor` per the launch-window
  policy (the fixed group makes a `major` promote the whole monorepo).

  ## Removed (dead, no runtime reader — verified in both framework and objectui)

  - **field**: `columnName`, `index`, `referenceFilters`. This empties the field
    dead-prop set. `columnName` also removed its now-moot **ADR-0062 D7** lint
    (`validate-expressions.ts`), the dead `StorageNameMapping.resolveColumnName` /
    `buildColumnMap` / `buildReverseColumnMap` helpers, and closes ADR-0062 R10 —
    external physical-column mapping is `external.columnMap` only.
  - **object**: `tags`, `active`, `abstract` — now rejecting tombstones in
    `UNKNOWN_KEY_GUIDANCE`.
  - **agent**: `tenantId`.

  The removed props are dropped from the authoring forms (`field/object/agent.form.ts`)
  and the regenerated metadata-forms i18n bundles.

  ## Corrected to `live` (the ledger was wrong — readers existed)

  - **object `isSystem`** — `plugin-sharing` `effectiveSharingModel` defaults a
    no-`sharingModel` `isSystem` object to public; also read by the security-posture
    lint. KEPT.
  - **object `enable.searchable`** — `metadata-protocol` global search (`searchAll`)
    uses `enable.searchable === false` as an opt-out. KEPT.
  - **action `type:'form'`** — objectui `ActionRunner.executeForm` routes it to the
    FormView at `/forms/:target`; a build-time lint validates the target. KEPT.

  ## Deliberately deferred

  `object.enable.trash` / `enable.mru` — dead, but inert `default(true)` flags set by
  ~35 `sys-*.object.ts` files; removing them is high-churn / low-value. Left `dead`
  (authorWarn-skipped).

  ## Migration

  - field/agent props: authoring them was already a no-op; they now strip silently.
    `columnName` → the physical column is always the field key (rename the field, or
    use `external.columnMap` for external objects); `index` → declare it in object
    `indexes[]`; `referenceFilters` → `lookupFilters`.
  - object `tags`/`active`/`abstract`: `ObjectSchema.create()` now throws a located
    error naming the removal. None gated anything at runtime — remove them.

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

- 04ecd4e: feat(validation): `state_machine.initialStates` enforces the FSM entry point on INSERT (#3165)

  A `state_machine` rule's `transitions` only governs UPDATE — on INSERT the rule
  was a no-op, and a `select` field permits ANY declared option as the initial
  value. So a record could be born mid-flow (created already `approved`), skipping
  the whole state machine. This was the gap #3043's mitigation idea assumed didn't
  exist (declared ≠ enforced, ADR-0049).

  `state_machine` rules gain an optional `initialStates: string[]` — the states a
  record may be CREATED in. When set, an insert whose (defaulted) state-field value
  is outside the list is rejected server-side with `code: 'invalid_initial_state'`.
  Omit it to keep the legacy behavior (no initial-state check on insert). A missing
  / empty value is left to required-validation; `transitions` (UPDATE) is
  unaffected. Enforced at the same `evaluateValidationRules(..., 'insert')` seam the
  engine already runs after field defaults.

- 4d5a892: feat(objectql): roll-up `summary` fields can filter which child rows they aggregate (#1868)

  `summaryOperations` gains an optional `filter` — a query `where` FilterCondition
  evaluated against each child row, so a summary aggregates only the matching
  children instead of the whole collection. This is what lets a single child object
  feed several distinct parent totals, which the cross-object rollup templates need:

  ```typescript
  // One `engagement` child → distinct filtered totals.
  total_signups: {
    type: 'summary',
    summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: 'signup' } },
  }
  // Sum only received receipt lines (3-way match).
  received_amount: {
    type: 'summary',
    summaryOperations: { object: 'procurement_receipt', field: 'amount', function: 'sum', filter: { status: 'received' } },
  }
  ```

  The engine ANDs the predicate with the parent-FK match when it recomputes, and
  because the whole filtered aggregate is re-run on every child write, a child that
  moves in or out of the predicate (e.g. a status change) keeps the parent current
  with no extra wiring. Operator and compound forms work too
  (`filter: { type: { $in: ['signup', 'trial'] }, amount: { $gte: 100 } }`).

  Purely additive: omitting `filter` aggregates every child exactly as before.

- 16cebeb: fix(spec): drop the dead `systemFields.owner` key (#3175 follow-up)

  `ObjectSchema.systemFields` exposed an `owner?: boolean` opt-out key that nothing
  read — the registry (`applySystemFields`) only consumes `systemFields.tenant` and
  `systemFields.audit`, and `owner_id` provisioning is governed by the object-level
  `ownership` property (`'user' | 'org' | 'none'`, made first-class in #3185). The
  key was declared but wired to nothing.

  Removed it so the schema only advertises the two opt-outs it actually honors
  (`tenant`, `audit`). Backward-compatible at runtime: the key was ignored before and
  is stripped now (both no-ops). A TypeScript author who set `systemFields.owner`
  will now see an excess-property error — the fix is to delete the key (it never did
  anything) or use `ownership: 'org' | 'none'` to skip `owner_id`. Also corrected the
  stale `objectql/security` doc that called `audit` "reserved" (it is active).

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

- a2795f6: feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

  Time-relative business rules ("alert 60 days before a contract's `end_date`")
  could only be expressed as a `record_change` flow gated on a date-equality
  condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
  when the record _happens to change_, so it fires only if a record is edited on
  exactly the threshold day — i.e. almost never, unattended. The robust
  alternative was a hand-written cron + range query that every author
  re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
  procurement `po_overdue`, …).

  A flow's start node can now declare a `timeRelative` descriptor instead:

  ```ts
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
      filter: { status: 'active' }, // optional, ANDed with the date window
    },
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
  }
  ```

  The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
  `TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
  flow **once per matching record**, with the record on the automation context —
  so the start-node `condition` gate and `{record.<field>}` interpolation work
  exactly as for a record-change flow. Because the window is evaluated every day,
  a threshold is never missed regardless of when the record last changed. The
  discovery query runs as a system operation (RLS-bypassing) and is capped
  (`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
  per-record failures are isolated so one bad row never aborts the sweep.

  The automation engine routes a start node carrying `config.timeRelative` to the
  `time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
  unchanged), and `os validate` gains readiness checks for the new descriptor
  (unknown swept object, ambiguous draft status). New authorable spec key:
  `TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- 3ad3dd5: Annotate the schema-only event/subscription/connector surfaces flagged by the #3197 audit with explicit "not yet enforced / not yet implemented" notes in their doc comments and `.describe()` texts, so authoring metadata against them is no longer silently swallowed. No runtime behavior or schema shape changes — documentation only.

  Surfaces annotated (each trace re-confirmed against the current tree before annotating):

  - `GraphQLSubscriptionConfigSchema` (`api/graphql.zod.ts`) — no subscription transport exists; the GraphQL HTTP entry serves query/mutation only.
  - `WebSocketMessageType` + module header (`api/websocket.zod.ts`) — no WebSocket server is mounted (#2462); the protocol is a future wire contract.
  - `RealtimeEventType` (`api/realtime.zod.ts`) — zero runtime importers; the engine emits `data.record.*` names (which don't match this enum's members) and nothing emits `field.changed`.
  - Connector `webhooks`/`WebhookConfigSchema`/`WebhookEventSchema` and `triggers`/`ConnectorTriggerSchema` (`integration/connector.zod.ts`) — `AutomationEngine.registerConnector` reads only `actions`; webhook events and trigger definitions parse but are never dispatched or polled.
  - Automation `ConnectorTriggerSchema`/`TriggerRegistrySchema` (`automation/trigger-registry.zod.ts`) — no runtime importer; the `stream` trigger mechanism exists only here.
  - `NotificationChannelSchema` (`system/notification.zod.ts`) + the mirrored `NotificationChannel` contract type — implemented delivery channels are `inbox`/`email`/`sms`; `push`/`slack`/`teams`/`webhook` dead-letter, and the enum's `in-app` does not match the registered `inbox` channel id.

  The audit's sixth row (`SubscriptionEventType`, formerly `data/subscription.zod.ts`) needed no annotation — it was already removed outright by the feed-contract retirement (#1959).

- a8aa34c: Enforce validation rules, `requiredWhen`, and per-option `visibleWhen` on multi-row updates (#3106). The bulk branch of `engine.update` (`options.multi` → `driver.updateMany`) previously never called `evaluateValidationRules`, so every object-level rule (`script`, `state_machine`, `format`, `cross_field`, `json_schema`, `conditional`), field-level `requiredWhen`, and per-option `visibleWhen` check was a silent no-op there. The engine now reads the row-scoped match set (the same AST the write binds, one query shared with the `readonlyWhen` bulk strip) and evaluates the payload against each matched row's prior state; any error-severity violation rejects the whole batch with `ValidationError` (annotated with the failing record id) before anything is written. Schemas needing no prior state (`format`/`json_schema`-only) are evaluated once against the payload with no fetch, and rule-free schemas are unaffected. Behavior change: bulk writes that previously slipped past declared rules now throw. Doc comments in `rule-validator.ts` and `validation.zod.ts` no longer overstate coverage and name the remaining `events: ['delete']` gap (tracked separately).
- a3823b2: Collapse the hook event taxonomy from 18 declared events to the 8 the engine actually dispatches (#3195). The removed 10 (`beforeFindOne`/`afterFindOne`, `beforeCount`/`afterCount`, `beforeAggregate`/`afterAggregate`, `beforeUpdateMany`/`afterUpdateMany`, `beforeDeleteMany`/`afterDeleteMany`) were declared in `HookEvent` but never fired — the enum mirrored the engine method table instead of domain events, so a hook subscribing to them registered fine and then silently no-op'd.

  - `findOne` now fires the same `beforeFind`/`afterFind` hooks as `find` — the read event attaches to record materialization, not the engine method, so one subscription covers every read shape (no separate `beforeFindOne`/`afterFindOne`).
  - Bulk (`multi: true`) updates/deletes already fire the singular `beforeUpdate`/`beforeDelete`/`afterUpdate`/`afterDelete` events with the row-scoping predicate in `ctx.input.ast`; this is now documented, and there is no `*Many` event.
  - Read authorization / row filtering is the RLS/permission-rule layer's job and field masking is field-level metadata — neither is a hook every author must re-attach.
  - `engine.registerHook` now warns when a hook subscribes to an event the engine never dispatches, so enum-vs-dispatch drift can't recur silently.

  No shipped hook or authored metadata used any of the removed events; authoring one now fails loudly at parse/validate time instead of registering a dead hook. Skills and docs updated to teach the 8 events and the declarative alternatives.

- 5e3301d: Document two validation-rule facts surfaced by the 2026-06 liveness audit (follow-up to #3106 / #3184), and clean up a stale form-schema mirror — no runtime behavior change:

  - `label` / `description` / `tags` on validation rules are governance / editor metadata (surfaced to the Studio rule editor and rule listings), not evaluated on the write path. Documented as such on `BaseValidationSchema` rather than removed — they are set by nearly every example rule and feed the `/meta/types` editor form, so they are declared on purpose, not silent no-ops.
  - `cross_field` evaluates identically to `script` (same CEL predicate path); only `fields[0]` is read, to target the violation at a field. Documented the overlap on the schema, its `fields` `.describe()`, and the validation docs so authors can choose between them; the variant is kept for the field-targeting affordance and backward compatibility.
  - Removed dead form-field entries (`scope`, `caseSensitive`, `url`, `handler`) and the stale `type=unique` hint from the hand-written `HAND_CRAFTED_SCHEMAS['validation']` fallback in `@objectstack/metadata-protocol` — leftovers from the removed `unique`/`async`/`custom` variants.
  - Added the missing `beforeDelete` lifecycle-hook pointer to the validation docs' "not a rule type" callout, so delete-time guards aren't stranded now that validation has no `delete` event (#3184).

- 46e876c: fix(spec): declare `summaryOperations` sub-fields in the Field metadata form (#3257)

  `fieldForm` (the registered metadata form for editing a Field) previously
  declared `summaryOperations` as a bare `composite` with no sub-fields, so a
  protocol-driven renderer had to fall back to a raw JSON editor. It now declares
  the inner shape explicitly — `object` (`ref:object`), `function` (select),
  `field`, `relationshipField`, and `filter` (bound to `widget: 'filter-condition'`)
  — mirroring the `summaryOperations` Zod schema and surfacing the roll-up `filter`
  added in #1868. Also gates the block to `data.type == 'summary'`.

  Small step toward #3257 (making the Studio field designer metadata-driven rather
  than hand-coded); the live objectui inspector already edits these fields.

- 158aa14: feat(automation): mark the loop `collection` config field as an interpolate() template so designer forms render it correctly (#3304)

  The flow designer generates a node's config form from its published
  `configSchema` (ADR-0018). A string property can now carry an `xExpression:
'expression' | 'template'` marker — riding the same Zod `.meta()` → JSON-Schema
  channel as `xRef` / `xEnumDeprecated` — that declares whether the string is bare
  CEL or an `interpolate()` single-brace `{var}` template.

  The `loop` node's `collection` (e.g. `{tasks}`) is a template, so it is now
  marked `xExpression: 'template'` on both the canonical `LoopConfigSchema` and the
  shipped descriptor's `configSchema` literal (service-automation loop-node).
  Without the marker the designer rendered `collection` as plain text online while
  the offline hardcoded form rendered it as a mono expression editor, and the CEL
  brace-trap false-flagged `{tasks}` as a malformed condition. The marker closes
  that divergence — objectui #2670 Phase 3 (#2699) already consumes it.

  Additive and backward-compatible: an unknown `xExpression` value is ignored by
  the designer, and runtime behavior is unchanged. Filling the same marker in on
  the remaining node types (map/decision/script and the node types that publish no
  `configSchema` yet) is tracked as follow-up in #3304.

- d2723e2: **`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

  Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

  Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

  Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

  Fixes #3112.

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

- e0859b1: fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

  The `js` **expression** dialect was declared in `ExpressionDialect` but never
  shipped — it existed only as a registry stub with no engine and no author helper
  (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
  `js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
  now `{cel, cron, template}`.

  Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
  the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
  bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
  dialect.

  Also fixes a latent bug in `hasDialect`: it detected stubs via
  `dialect.startsWith('stub:')`, but stubs were registered under their real name,
  so the check was dead code and `hasDialect('js')` returned a false-positive
  `true`. With the stub removed, `hasDialect` reports only registered real
  engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

  No runtime behavior changes for any valid persisted artifact — no producer ever
  emitted `dialect: 'js'`. See the ADR-0058 addendum.

- 8923843: Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
- f16b492: Remove the dead `'delete'` member from the validation-rule `events` enum (#3184). The rule evaluator only runs on the insert/update write path — `engine.delete` never invokes it — so a rule declaring `events: ['delete']` was a silent no-op (flagged in #3106 and `docs/audits/2026-06-validationschema-property-liveness.md`). The enum now admits only `insert`/`update`; guard deletions with a `beforeDelete` lifecycle hook instead. No shipped metadata declares `events: ['delete']`; any off-spec metadata that did now fails loudly at `os validate` / registration rather than parsing and doing nothing. Also narrows the two hand-written mirrors (`rule-validator.ts` `BaseRule`, `metadata-protocol` JSON-schema form helper — whose stale `type` enum listing removed `unique`/`async`/`custom` variants is corrected in the same pass), updates the doc comments, the published data skill, and the hand-written validation doc.
- 4b6fde8: Trim the dead `undelete` and `api` webhook triggers (#3196). `WebhookTriggerType` declared five triggers but only three ever fired:

  - `undelete` had no event source — the engine has no soft-delete/restore capability (`delete` is a hard delete; no `deleted_at` convention, no restore operation, and `data.record.undeleted` is never emitted). The `undeleted` case in the auto-enqueuer's action mapper was dead code awaiting a producer that doesn't exist.
  - `api` ("manually triggered") had no fire path — the only webhook HTTP surface re-queues already-failed deliveries; nothing originates a manual fire.

  Both are removed from the enum (contract-first, matching #3184/#3195): authoring a webhook on a removed trigger now fails loudly at `os validate` / registration instead of registering a webhook that silently never fires. No shipped webhook metadata used either. The auto-enqueuer now also warns when a persisted `sys_webhook` row carries a trigger it can't map to an emitted record event (a drift-guard, so a dead trigger can't silently no-op again). Reintroduce `undelete` only alongside a real restore subsystem, and `api` only alongside a real manual-fire endpoint. Updated the `sys_webhook` trigger options, field help (all locales), docs, and reference; added rejection tests.

- 2018df9: **Unify the developer-facing org identifier in JS hooks — `organizationId` is now the blessed name; `session.tenantId` becomes a deprecated alias (#3280).** The caller's active organization was surfaced to hook authors as `ctx.session.tenantId`, while everything else on the developer surface — the `organization_id` column, `current_user.organizationId` in RLS/sharing, and seed rows — already said `organization`. A hook author had to internalize the hidden equation `tenantId === organizationId` to move between surfaces. This is additive and non-breaking:

  - **`ctx.session.organizationId`** is added as the blessed name; **`ctx.session.tenantId`** still carries the identical value but is marked `@deprecated` in its TSDoc. Both come from the same resolved `ExecutionContext.tenantId` (which the kernel derives from `session.activeOrganizationId`).
  - **`ctx.user.organizationId`** is added to the ergonomic `user` shortcut, so a hook that needs "the current org to filter by" writes `ctx.user.organizationId` with zero relearning — matching `current_user.organizationId` (RLS) and the `organization_id` column. The engine now populates `ctx.user` (`{ id, email?, organizationId? }`) at every hook event that already carries a `session`; it stays `undefined` for system / unauthenticated writes.

  **No behavior change and no breaking rename.** The generic driver-layer tenancy abstraction (`ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope`, `TenancyConfig.tenantField`) is deliberately untouched — that layer's isolation column is configurable and legitimately carries an _environment_ id in per-environment (database-per-tenant) kernels. Hook-authoring docs now teach `organizationId` and distinguish the two isolation axes: **org row-scoping** (`organization_id`, shared DB) vs **environment / database-per-tenant** (`service-tenant`, `driver-turso`). Community edition never populates an org, so `organizationId` is `undefined` there.

- fc5a3a2: **The `view` metadata type-schema now validates all three runtime `view` shapes instead of stripping two of them to `{}`.** `metadata-type-schemas.ts` mapped `view` to the aggregate container `ViewSchema` (`{ list, form, listViews, formViews }`, every slot optional). Zod strips unknown keys, so the two non-container shapes a `view` body actually carries at runtime — a standalone **ViewItem record** (`{ name, object, viewKind, config }`) and a **console personalization overlay** (raw view config + identity inherited by `normalizeViewMetadata`, #2555) — both strip-parsed to `{}`. That made the `422` check in `saveMetaItem` and read-time `computeMetadataDiagnostics` a **no-op** for those shapes: a broken `config` (e.g. a kanban missing `groupByField`) saved with a false `200` and badged valid, and the view create-seed test validated against nothing.

  `view` now maps to a new `ViewMetadataSchema` — a union over the three shapes, each validated genuinely:

  1. **defineView container** — non-empty (`ViewSchema` refined to require at least one of `list`/`form`/`listViews`/`formViews`; an empty container is rejected, mirroring `defineView`).
  2. **ViewItem record** — `ViewItemSchema`; the nested `config` is validated against ListView/FormView.
  3. **Flattened personalization overlay** — inline ListView/FormView config plus optional identity fields. Structural guards pin `config`/`list`/`form`/`listViews`/`formViews` to `undefined` so a malformed record or container can never be rescued through this lenient branch with its real payload silently stripped.

  All members strip-parse (no `.strict()`), so auxiliary Studio round-trip keys (`isPinned`, `sortOrder`, …) still ride along without a false `422`, and `saveMetaItem` keeps persisting the body verbatim. `z.toJSONSchema()` emits the schema as an `anyOf` of the four members, which `/api/v1/meta/types/view` serves to Studio's SchemaForm.

  Fixes #3095.

- 8ff9210: fix(spec): enforce the `ViewFilterRule` operator enum with legacy-alias
  normalization (#3373)

  `ViewFilterRule.operator` was previously an open string, so views could persist
  operators the runtime cannot evaluate. The Zod schema now constrains it to the
  supported operator enum and normalizes the known legacy aliases to their
  canonical form on parse. This is a public spec/api-surface change
  (`packages/spec/api-surface.json`) that landed on `main` in #3373 without a
  changeset; this backfills it so the fix ships in the next release instead of
  being silently stranded.

## 16.0.0-rc.1

### Minor Changes

- 6289ec3: feat(i18n): translation slot for action `resultDialog` copy — the one-shot secret-reveal dialogs are now localizable

  The post-success `resultDialog` (temporary passwords, 2FA backup codes, OAuth
  client secrets) had no slot in the translation protocol, so its title /
  description / acknowledge button / field labels always rendered the hardcoded
  English metadata literals even on fully-translated locales.

  - **spec.** `_actions.<action>` (object + object-first node) and
    `globalActions.<action>` gain an optional `resultDialog` translation node
    (`ActionResultDialogTranslationSchema`): `title`, `description`,
    `acknowledge`, and `fields` keyed by the **literal** result-field path
    (e.g. `"user.email"` — keys may contain dots; resolvers index the record
    directly, never split on `.`). New `resolveActionResultDialog` overlay
    resolver, wired into `translateAction` for API-boundary translation.
  - **cli.** `os i18n extract` emits the new `resultDialog.*` keys (title /
    description / acknowledge / `fields.<path>` for labelled fields), so
    coverage and skeleton generation see them.
  - **platform-objects.** en / zh-CN / ja-JP / es-ES bundles ship the
    resultDialog copy for all six shipped dialogs: `sys_user.create_user`,
    `sys_user.set_user_password`, `sys_two_factor.enable_two_factor`,
    `sys_two_factor.regenerate_backup_codes`,
    `sys_oauth_application.create_oauth_application`, and
    `sys_oauth_application.rotate_client_secret`.

  Client-side rendering lands in objectui (`actionResultDialog` resolver in
  `@object-ui/i18n` + result-dialog handlers). Purely additive — untranslated
  locales keep falling back to the metadata literals.

- 8efa395: feat(approvals): server-computed `viewer` capability for precise decision-action gating

  `getRequest` / `listRequests` now attach a per-viewer block —
  `viewer: { can_act, is_submitter }` — computed from the caller's context
  (`ApprovalRequestRow.viewer`):

  - `can_act` — the caller is a _current pending approver_ (their user id is in the
    request's resolved `pending_approvers` while it is still `pending`). This is
    the same check the decision methods authorize with, so it already reflects
    position/team/manager resolution — strictly more accurate than a client-side
    identity guess.
  - `is_submitter` — the caller submitted the request.

  The declared decision actions on `sys_approval_request` now gate on it: approver
  actions (approve/reject/reassign/send-back/request-info) use
  `record.viewer.can_act`; submitter levers (remind/recall/resubmit) use
  `record.viewer.is_submitter`. Previously approver actions only trimmed the
  non-pending case, so a submitter viewing their own pending request saw buttons
  they couldn't use (the backend 403'd); a position-addressed approver could be
  wrongly hidden by the old client heuristic. Where `viewer` is absent (a row
  surfaced outside a service read with a user context), the predicate fails closed.

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- 06ff734: feat(spec)!: remove deprecated `aiStudio`/`aiSeat` capability aliases (#3308)

  **BREAKING** (shipped as minor per the launch-window convention). The one-cycle
  deprecation window from #3265 is over: the legacy camelCase `requires` spellings
  `aiStudio`/`aiSeat` are no longer canonicalized to `ai-studio`/`ai-seat` — they
  are now plain unknown tokens, rejected by `defineStack` like any other typo.

  - Removed exports `DEPRECATED_PLATFORM_CAPABILITY_ALIASES` and
    `canonicalizePlatformCapability` from `@objectstack/spec`; `isKnownPlatformCapability`
    no longer canonicalizes.
  - `defineStack` no longer rewrites aliases (the `canonicalizeStackRequires` pass
    is gone); the serve resolver no longer canonicalizes raw-artifact `requires`.

  Migration: use the canonical kebab-case tokens `ai-studio` / `ai-seat`. All
  first-party configs were migrated in #862/#863; only stacks still carrying the
  legacy spelling are affected. Cloud's `objectos-runtime` (pinned to an older
  framework) follows on its next `.objectstack-sha` bump.

## 16.0.0-rc.0

### Major Changes

- 6c270a6: **BREAKING: remove the deprecated `ctx.session.tenantId` / `ctx.user.tenantId` alias from the hook & action authoring surface — converge on `organizationId` (#3290).**

  #3280 made `organizationId` the blessed developer-facing name for the caller's active org across the JS authoring surface and kept `tenantId` as a `@deprecated` alias carrying the identical value. That alias is now **removed** from the hook `ctx.session`, the action-body `ctx.session`, and the action-body `ctx.user`. Read the caller's active org under the single blessed name:

  ```diff
  - const org = ctx.session.tenantId;   // hook or action body
  + const org = ctx.user?.organizationId ?? ctx.session?.organizationId;
  ```

  **FROM → TO migration** (in any `*.hook.ts` / `*.action.ts` body):

  - `ctx.session.tenantId` → `ctx.session.organizationId`
  - `ctx.user.tenantId` (action body) → `ctx.user.organizationId`

  The value is unchanged — `organizationId` is the same active-org id, matching the `organization_id` column and `current_user.organizationId` in RLS/sharing. `ctx.user` is `undefined` for system / unauthenticated writes, so read `ctx.session?.organizationId` when a hook or action must work regardless of a resolved user.

  What changed internally:

  - **`@objectstack/spec`** — `HookContextSchema.session` drops the `tenantId` field (only `organizationId` remains). A stray `tenantId` on a constructed session is now stripped by the schema.
  - **`@objectstack/objectql`** — the engine's `buildSession()` no longer emits `session.tenantId`; the audit-stamp plugin sources the `tenant_id` column from `session.organizationId`.
  - **`@objectstack/runtime`** — `buildActionSession()` and the REST action `ctx.user` no longer emit `tenantId`.
  - **`@objectstack/trigger-record-change`** — reads `session.organizationId` (was `session.tenantId`) when forwarding the writer's org to a `runAs:'user'` flow; behavior is identical.

  **Explicit non-goal (unchanged):** the generic **driver-layer** tenancy abstraction is _not_ touched — `ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope` / `TenancyConfig.tenantField`, and `ExecutionLog.tenantId`. That isolation column is configurable and legitimately carries an _environment_ id in database-per-tenant kernels; it is a distinct axis from the developer-facing org. The build-time `check:org-identifier` guard now also covers `packages/**` to keep reference bodies off the removed name.

### Minor Changes

- f972574: feat(spec): `ActionParamSchema` gains optional widget config — `multiple`, `accept`, `maxSize`

  The console now renders action params through the same field-widget renderer
  the record form uses (objectui#2700, objectui ADR-0059), so inline params can
  declare the widget config the form widgets consume: `multiple` (array value
  shape, mirrors `FieldSchema.multiple`), and the upload constraints `accept`
  (MIME types / extensions) and `maxSize` (bytes) for `file`/`image` params.
  Field-backed params (`{ field }`) keep inheriting these from the referenced
  field at runtime; inline values override. Purely additive — no existing
  schema changes shape.

- 3a18b60: feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

  `ApproverType.role` was the last platform surface projecting the reserved word
  "role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
  exception protects better-auth's own `sys_member.role` **column**, which we do
  not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
  that the projection of that concept is spelled `org_membership_level` and
  labelled "organization membership", **never "role"**.

  The sentence licensing the leak was also false: ADR-0090 D3 claims
  `sys_member.role` is "already relabelled `org_membership_level` in the platform
  projection", but `org_membership_level` existed nowhere in the codebase and
  ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
  projection never landed, so the word reached authors.

  The name manufactured a real, silent failure — "hotcrm class": every other
  surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
  `ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
  legacy spelling of a position. It resolves against the membership tier, finds
  no member row, falls back to an inert `role:sales_manager` literal, and the
  request waits forever on an approver that cannot exist.

  - **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
    deprecated alias for one window (a published 15.x flow keeps loading) with
    `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
    for the mapping. Removed in the next major.
  - **plugin-approvals**: resolves on the canonical type and warns on the
    deprecated spelling. The `type:value` fallback literal keeps the **authored**
    spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
    from 15.x carry `role:<v>`, and rewriting it would orphan them.
  - **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
    (the rule id carried the reserved word too), plus a new
    `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
    _value_ wins, because prescribing `org_membership_level` for a position name
    would be wrong advice — the fix there is `position`.

  Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
  `org_membership_level`; if the value is an org position, the fix is `position`.

- 43a3efb: fix(rest): gate the cross-object transactional batch by the same per-object API rules as single-record writes (#1604)

  The `POST {basePath}/batch` route (issue #1604 / ADR-0034) wraps N cross-object
  create/update/delete ops in one engine transaction, but it skipped the
  per-object API-exposure gate every single-record route applies — an
  authenticated caller could write to an `apiEnabled: false` object, or run an
  operation outside an object's `apiMethods` whitelist, straight through the batch
  surface (ADR-0049 / #1889 — the same "declared ≠ enforced" hole closed for the
  generic write path in #3220 / #3213).

  The route now:

  - validates the body against a new `CrossObjectBatchRequestSchema`
    (`@objectstack/spec/api`, Zod-First) — a malformed op, an unknown action, or a
    missing `object` is a `400` instead of a `500`;
  - enforces `enable.apiEnabled` / `enable.apiMethods` for **every** op (metadata
    fetched once, each distinct `(object, action)` checked) BEFORE opening the
    transaction — `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - requires an `id` for `update` / `delete` (`400`);
  - rejects an unresolvable `{ $ref }` with `400 BATCH_UNRESOLVED_REF` instead of
    silently writing a `null` FK;
  - rejects an explicit `atomic: false` (`400 BATCH_NOT_ATOMIC`) rather than
    silently applying atomically — non-atomic per-object batches stay on
    `POST /data/:object/batch`.

  `enforceApiAccess` is refactored to share the pure `apiAccessDenialFromEnable`
  check + a `loadObjectItems` helper with the batch route (single-record behavior
  unchanged). Adds `rest-batch-endpoint.test.ts` — the REST-boundary coverage
  ADR-0034 flagged as missing (commit, `$ref`, rollback surfacing, API-access
  denial, request validation).

- 524696a: feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

  The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
  undeclared top-level key instead of silently stripping it, moving a whole class
  of author error (a hallucinated or legacy key that renders as a silent no-op)
  from fallible human review to deterministic CI. `options: z.unknown()` remains
  the escape hatch for renderer-specific extras.

  A custom error map names the offending key(s) and, when a key is a removed
  pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
  `aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
  (`component`, inline `data`), points the author at the dataset shape
  (`dataset` + `dimensions` + `values`).

  Recorded as protocol-16 migration `step16`
  (`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
  strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
  itself was already removed at protocol 9 (single-form cutover), so there is no
  mechanical rewrite — the residue is the strictness, delegated to the author.

  **Breaking:** shipped as `minor` per the launch-window policy (a breaking change
  does not burn a major while the stack is in lockstep), riding the already-pending
  16.0.0 train. The release train's Version-Packages PR must set
  `PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
  (`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

  `@objectstack/lint` — the `widget-legacy-analytics-shape` /
  `widget-legacy-analytics-unrenderable` rules are retained as the friendly,
  suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
  the schema-parsed compile/validate paths); doc comment updated to explain the
  interplay.

- fefcd54: fix(spec): declare `ownership` as a first-class ObjectSchema field (#3175)

  The object-level record-ownership model — `ownership: 'user' | 'org' | 'none'`,
  which drives the registry's `owner_id` auto-provisioning (`applySystemFields`) —
  was read by the engine via `(schema as any).ownership` while `ObjectSchema.create()`
  **rejected** it as an unknown top-level key (ADR-0032 / #1535). So a tested engine
  opt-out (`ownership: 'org' | 'none'` on catalog / junction tables) could not be
  set through the sanctioned authoring path, and the same `ownership` word was read
  elsewhere as the unrelated package-contribution kind (`own` / `extend`).

  - **spec**: `ObjectSchema` now declares `ownership: z.enum(['user','org','none']).optional()`.
    Authoring the record-ownership opt-out validates cleanly; the registry reads it
    off the typed schema (no `as any`). A retired `ownership: 'own'` / `'extend'`
    value fails with guidance pointing at the record-ownership model and noting that
    `own`/`extend` is the contribution kind (`registerObject`), not an object-schema value.
  - **cli**: the `object` scaffold no longer emits the now-invalid `ownership: 'own'`
    (owner injection is the default), and `objectstack info` labels the record model
    with the correct `user` default.

  No runtime behavior change: `applySystemFields` and its `owner_id` injection logic
  are unchanged — this makes the property the engine already honors legally authorable
  and consistently typed.

- 369eb6e: refactor(spec): remove unenforced agent `visibility` field (ADR-0056 D8, #1901)

  The agent `visibility` (`global`/`organization`/`private`) field is **removed**
  from `AgentSchema`. It was never enforced: the chat-access evaluator excluded it
  and the agent list route did not filter by it, so setting `private` never hid an
  agent. Per ADR-0049 / ADR-0056 D8 ("design+enforce or remove"), a security-shaped
  field with no runtime consumer is a liability — authors who set `private` believe
  they've restricted an agent when they have not.

  Unlike `field-encryption` (kept `[EXPERIMENTAL]` — it has a stable schema shape on
  a real roadmap), correct `visibility` enforcement is undesigned: it needs
  owner/org anchors that do not exist today. `agent.tenantId` was already removed
  (#2377), agents carry no owner field, and the `EXTERNAL` posture rung is defined
  but never derived — so `organization` vs `global` is runtime-indistinguishable.
  The semantics, not just the plumbing, are unresolved, so the field is dropped
  rather than carried marked.

  - `AgentSchema` is not `.strict()`, so existing metadata that still sets
    `visibility` parses cleanly — the unknown key is stripped, not rejected.
  - Use `access` / `permissions` to restrict who can use an agent — both **enforced**
    at the chat route (#1884).
  - Re-introduce `visibility` when the agent listing surface gains real owner/org
    semantics; tracked in #1901.

  Also updated: authoring form (`agent.form.ts`), liveness ledger
  (`liveness/agent.json`), the ADR-0056 D10 authz-conformance matrix (moved from
  `experimental` to `removed`), and the generated schema reference docs.

- b659111: feat(spec)!: remove dead author-facing metadata properties (#2377, ADR-0049 enforce-or-remove)

  Breaking spec-surface removal, versioned as `minor` per the launch-window changeset
  policy (a `major` would promote the whole fixed-group monorepo; breaking cleanups ride
  the minor line, as with #2402 → 11.1.0).

  Removes a batch of spec properties that parsed but had **no runtime consumer** —
  authoring them was a false affordance (especially dangerous for AI-authored
  metadata). Verified dead against the liveness ledger (`packages/spec/liveness/*.json`)
  and a repo-wide grep of readers. This is the follow-up slice to #2402.

  ## Removed (each was `dead` + no reader anywhere)

  - **field** (`field.zod.ts`): `vectorConfig` (+ `VectorConfigSchema` + types),
    `fileAttachmentConfig` (+ `FileAttachmentConfigSchema` + types), `dependencies`.
    Vector fields keep the live flat `dimensions` prop; file/image fields keep the
    live flat `multiple`/`accept`/`maxSize` siblings.
  - **object** (`object.zod.ts`): `versioning` (+ `VersioningConfigSchema`),
    `softDelete` (+ `SoftDeleteConfigSchema`), `search` (+ `SearchConfigSchema`),
    `recordName`, `keyPrefix`. Each is now a **rejecting tombstone** in
    `UNKNOWN_KEY_GUIDANCE` carrying the upgrade prescription.
  - **action** (`action.zod.ts`): `timeout` (server uses `body.timeoutMs`; no
    action-level timeout is enforced).
  - **agent** (`agent.zod.ts`): `planning.strategy`, `planning.allowReplan`
    (only `planning.maxIterations` is read by the runtime).
  - **dataset** (`dataset.zod.ts`): `measures.certified` (declared-but-unenforced
    governance flag — never compiled into the Cube).

  Liveness ledgers, the ledger README table, and `api-surface.json` are updated;
  the removed sub-schema keys are dropped from `json-schema.manifest.json`.

  ## Migration

  - **field/agent/dataset/action props**: authoring them is now silently stripped
    (they never did anything). Remove them. Vector → set flat `dimensions`;
    file/image → set flat `multiple`/`accept`/`maxSize`.
  - **object props**: `ObjectSchema.create()` now throws a located error naming the
    replacement — `versioning`/`softDelete` → hard deletes + `Field.trackHistory` /
    `lifecycle`; `search` → `searchableFields`; `recordName` → an `autonumber`
    `Field` designated as `nameField`; `keyPrefix` → remove (never had an effect).

  ## Deliberately NOT removed (dead, but entangled — a scoped follow-up)

  `field.index`/`columnName`/`referenceFilters` and object
  `tags`/`active`/`isSystem`/`abstract`/`enable.searchable`/`enable.trash`/`enable.mru`
  and `agent.tenantId` are surfaced in the Studio metadata-authoring forms
  (`*.form.ts`) — removing them cascades into i18n bundle regeneration, so they are
  deferred. `action.type:'form'` has a dedicated build-time lint (`lint-view-refs.ts`)
  and a first-party showcase usage, so it needs a UX decision. `field.columnName`
  additionally has an ADR-0062 D7 lint. These stay `dead` + `authorWarn` in the
  ledgers.

- 5754a23: feat(spec)!: remove form-surfaced dead metadata props + correct 3 misclassified-live entries (#2377, ADR-0049)

  The next enforce-or-remove slice of #2377. Versioned `minor` per the launch-window
  policy (the fixed group makes a `major` promote the whole monorepo).

  ## Removed (dead, no runtime reader — verified in both framework and objectui)

  - **field**: `columnName`, `index`, `referenceFilters`. This empties the field
    dead-prop set. `columnName` also removed its now-moot **ADR-0062 D7** lint
    (`validate-expressions.ts`), the dead `StorageNameMapping.resolveColumnName` /
    `buildColumnMap` / `buildReverseColumnMap` helpers, and closes ADR-0062 R10 —
    external physical-column mapping is `external.columnMap` only.
  - **object**: `tags`, `active`, `abstract` — now rejecting tombstones in
    `UNKNOWN_KEY_GUIDANCE`.
  - **agent**: `tenantId`.

  The removed props are dropped from the authoring forms (`field/object/agent.form.ts`)
  and the regenerated metadata-forms i18n bundles.

  ## Corrected to `live` (the ledger was wrong — readers existed)

  - **object `isSystem`** — `plugin-sharing` `effectiveSharingModel` defaults a
    no-`sharingModel` `isSystem` object to public; also read by the security-posture
    lint. KEPT.
  - **object `enable.searchable`** — `metadata-protocol` global search (`searchAll`)
    uses `enable.searchable === false` as an opt-out. KEPT.
  - **action `type:'form'`** — objectui `ActionRunner.executeForm` routes it to the
    FormView at `/forms/:target`; a build-time lint validates the target. KEPT.

  ## Deliberately deferred

  `object.enable.trash` / `enable.mru` — dead, but inert `default(true)` flags set by
  ~35 `sys-*.object.ts` files; removing them is high-churn / low-value. Left `dead`
  (authorWarn-skipped).

  ## Migration

  - field/agent props: authoring them was already a no-op; they now strip silently.
    `columnName` → the physical column is always the field key (rename the field, or
    use `external.columnMap` for external objects); `index` → declare it in object
    `indexes[]`; `referenceFilters` → `lookupFilters`.
  - object `tags`/`active`/`abstract`: `ObjectSchema.create()` now throws a located
    error naming the removal. None gated anything at runtime — remove them.

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

- 04ecd4e: feat(validation): `state_machine.initialStates` enforces the FSM entry point on INSERT (#3165)

  A `state_machine` rule's `transitions` only governs UPDATE — on INSERT the rule
  was a no-op, and a `select` field permits ANY declared option as the initial
  value. So a record could be born mid-flow (created already `approved`), skipping
  the whole state machine. This was the gap #3043's mitigation idea assumed didn't
  exist (declared ≠ enforced, ADR-0049).

  `state_machine` rules gain an optional `initialStates: string[]` — the states a
  record may be CREATED in. When set, an insert whose (defaulted) state-field value
  is outside the list is rejected server-side with `code: 'invalid_initial_state'`.
  Omit it to keep the legacy behavior (no initial-state check on insert). A missing
  / empty value is left to required-validation; `transitions` (UPDATE) is
  unaffected. Enforced at the same `evaluateValidationRules(..., 'insert')` seam the
  engine already runs after field defaults.

- 4d5a892: feat(objectql): roll-up `summary` fields can filter which child rows they aggregate (#1868)

  `summaryOperations` gains an optional `filter` — a query `where` FilterCondition
  evaluated against each child row, so a summary aggregates only the matching
  children instead of the whole collection. This is what lets a single child object
  feed several distinct parent totals, which the cross-object rollup templates need:

  ```typescript
  // One `engagement` child → distinct filtered totals.
  total_signups: {
    type: 'summary',
    summaryOperations: { object: 'engagement', field: 'id', function: 'count', filter: { type: 'signup' } },
  }
  // Sum only received receipt lines (3-way match).
  received_amount: {
    type: 'summary',
    summaryOperations: { object: 'procurement_receipt', field: 'amount', function: 'sum', filter: { status: 'received' } },
  }
  ```

  The engine ANDs the predicate with the parent-FK match when it recomputes, and
  because the whole filtered aggregate is re-run on every child write, a child that
  moves in or out of the predicate (e.g. a status change) keeps the parent current
  with no extra wiring. Operator and compound forms work too
  (`filter: { type: { $in: ['signup', 'trial'] }, amount: { $gte: 100 } }`).

  Purely additive: omitting `filter` aggregates every child exactly as before.

- 16cebeb: fix(spec): drop the dead `systemFields.owner` key (#3175 follow-up)

  `ObjectSchema.systemFields` exposed an `owner?: boolean` opt-out key that nothing
  read — the registry (`applySystemFields`) only consumes `systemFields.tenant` and
  `systemFields.audit`, and `owner_id` provisioning is governed by the object-level
  `ownership` property (`'user' | 'org' | 'none'`, made first-class in #3185). The
  key was declared but wired to nothing.

  Removed it so the schema only advertises the two opt-outs it actually honors
  (`tenant`, `audit`). Backward-compatible at runtime: the key was ignored before and
  is stripped now (both no-ops). A TypeScript author who set `systemFields.owner`
  will now see an excess-property error — the fix is to delete the key (it never did
  anything) or use `ownership: 'org' | 'none'` to skip `owner_id`. Also corrected the
  stale `objectql/security` doc that called `audit` "reserved" (it is active).

- 86d30af: fix(tenancy): platform-global (`tenancy.enabled:false`) objects are never driver-org-scoped (#3249)

  An org-context read of a platform-global object (e.g. `sys_license`, ADR-0066)
  could return 0 rows for an authenticated caller while an anonymous read saw the
  data: the engine stamped `execCtx.tenantId` into driver options unconditionally,
  and the SQL driver's tenant-field cache could be re-corrupted to
  `organization_id` by a partial re-registration (lifecycle archive `syncSchema`,
  schema-drift re-sync) whose schema omitted the `tenancy` block.

  - New `isTenancyDisabled(schema)` export from `@objectstack/spec/data` — the
    single source of truth for the ADR-0066 platform-global posture, now shared by
    the registry (tenant-column injection), the ObjectQL engine, and the SQL
    driver.
  - `ObjectQL.buildDriverOptions` no longer stamps `tenantId` for objects whose
    registered schema declares `tenancy.enabled: false` (an explicitly-passed
    options `tenantId` still wins — deliberate caller intent).
  - `SqlDriver` (and `SqliteWasmDriver`) now keep a sticky record of an explicit
    `tenancy.enabled:false` declaration: a later registration without a `tenancy`
    block preserves the opt-out instead of re-scoping via the implicit
    `organization_id` heuristic; a registration that carries a `tenancy`
    declaration stays authoritative.

- a2795f6: feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

  Time-relative business rules ("alert 60 days before a contract's `end_date`")
  could only be expressed as a `record_change` flow gated on a date-equality
  condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
  when the record _happens to change_, so it fires only if a record is edited on
  exactly the threshold day — i.e. almost never, unattended. The robust
  alternative was a hand-written cron + range query that every author
  re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
  procurement `po_overdue`, …).

  A flow's start node can now declare a `timeRelative` descriptor instead:

  ```ts
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
      filter: { status: 'active' }, // optional, ANDed with the date window
    },
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
  }
  ```

  The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
  `TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
  flow **once per matching record**, with the record on the automation context —
  so the start-node `condition` gate and `{record.<field>}` interpolation work
  exactly as for a record-change flow. Because the window is evaluated every day,
  a threshold is never missed regardless of when the record last changed. The
  discovery query runs as a system operation (RLS-bypassing) and is capped
  (`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
  per-record failures are isolated so one bad row never aborts the sweep.

  The automation engine routes a start node carrying `config.timeRelative` to the
  `time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
  unchanged), and `os validate` gains readiness checks for the new descriptor
  (unknown swept object, ambiguous draft status). New authorable spec key:
  `TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- 3ad3dd5: Annotate the schema-only event/subscription/connector surfaces flagged by the #3197 audit with explicit "not yet enforced / not yet implemented" notes in their doc comments and `.describe()` texts, so authoring metadata against them is no longer silently swallowed. No runtime behavior or schema shape changes — documentation only.

  Surfaces annotated (each trace re-confirmed against the current tree before annotating):

  - `GraphQLSubscriptionConfigSchema` (`api/graphql.zod.ts`) — no subscription transport exists; the GraphQL HTTP entry serves query/mutation only.
  - `WebSocketMessageType` + module header (`api/websocket.zod.ts`) — no WebSocket server is mounted (#2462); the protocol is a future wire contract.
  - `RealtimeEventType` (`api/realtime.zod.ts`) — zero runtime importers; the engine emits `data.record.*` names (which don't match this enum's members) and nothing emits `field.changed`.
  - Connector `webhooks`/`WebhookConfigSchema`/`WebhookEventSchema` and `triggers`/`ConnectorTriggerSchema` (`integration/connector.zod.ts`) — `AutomationEngine.registerConnector` reads only `actions`; webhook events and trigger definitions parse but are never dispatched or polled.
  - Automation `ConnectorTriggerSchema`/`TriggerRegistrySchema` (`automation/trigger-registry.zod.ts`) — no runtime importer; the `stream` trigger mechanism exists only here.
  - `NotificationChannelSchema` (`system/notification.zod.ts`) + the mirrored `NotificationChannel` contract type — implemented delivery channels are `inbox`/`email`/`sms`; `push`/`slack`/`teams`/`webhook` dead-letter, and the enum's `in-app` does not match the registered `inbox` channel id.

  The audit's sixth row (`SubscriptionEventType`, formerly `data/subscription.zod.ts`) needed no annotation — it was already removed outright by the feed-contract retirement (#1959).

- a8aa34c: Enforce validation rules, `requiredWhen`, and per-option `visibleWhen` on multi-row updates (#3106). The bulk branch of `engine.update` (`options.multi` → `driver.updateMany`) previously never called `evaluateValidationRules`, so every object-level rule (`script`, `state_machine`, `format`, `cross_field`, `json_schema`, `conditional`), field-level `requiredWhen`, and per-option `visibleWhen` check was a silent no-op there. The engine now reads the row-scoped match set (the same AST the write binds, one query shared with the `readonlyWhen` bulk strip) and evaluates the payload against each matched row's prior state; any error-severity violation rejects the whole batch with `ValidationError` (annotated with the failing record id) before anything is written. Schemas needing no prior state (`format`/`json_schema`-only) are evaluated once against the payload with no fetch, and rule-free schemas are unaffected. Behavior change: bulk writes that previously slipped past declared rules now throw. Doc comments in `rule-validator.ts` and `validation.zod.ts` no longer overstate coverage and name the remaining `events: ['delete']` gap (tracked separately).
- a3823b2: Collapse the hook event taxonomy from 18 declared events to the 8 the engine actually dispatches (#3195). The removed 10 (`beforeFindOne`/`afterFindOne`, `beforeCount`/`afterCount`, `beforeAggregate`/`afterAggregate`, `beforeUpdateMany`/`afterUpdateMany`, `beforeDeleteMany`/`afterDeleteMany`) were declared in `HookEvent` but never fired — the enum mirrored the engine method table instead of domain events, so a hook subscribing to them registered fine and then silently no-op'd.

  - `findOne` now fires the same `beforeFind`/`afterFind` hooks as `find` — the read event attaches to record materialization, not the engine method, so one subscription covers every read shape (no separate `beforeFindOne`/`afterFindOne`).
  - Bulk (`multi: true`) updates/deletes already fire the singular `beforeUpdate`/`beforeDelete`/`afterUpdate`/`afterDelete` events with the row-scoping predicate in `ctx.input.ast`; this is now documented, and there is no `*Many` event.
  - Read authorization / row filtering is the RLS/permission-rule layer's job and field masking is field-level metadata — neither is a hook every author must re-attach.
  - `engine.registerHook` now warns when a hook subscribes to an event the engine never dispatches, so enum-vs-dispatch drift can't recur silently.

  No shipped hook or authored metadata used any of the removed events; authoring one now fails loudly at parse/validate time instead of registering a dead hook. Skills and docs updated to teach the 8 events and the declarative alternatives.

- 5e3301d: Document two validation-rule facts surfaced by the 2026-06 liveness audit (follow-up to #3106 / #3184), and clean up a stale form-schema mirror — no runtime behavior change:

  - `label` / `description` / `tags` on validation rules are governance / editor metadata (surfaced to the Studio rule editor and rule listings), not evaluated on the write path. Documented as such on `BaseValidationSchema` rather than removed — they are set by nearly every example rule and feed the `/meta/types` editor form, so they are declared on purpose, not silent no-ops.
  - `cross_field` evaluates identically to `script` (same CEL predicate path); only `fields[0]` is read, to target the violation at a field. Documented the overlap on the schema, its `fields` `.describe()`, and the validation docs so authors can choose between them; the variant is kept for the field-targeting affordance and backward compatibility.
  - Removed dead form-field entries (`scope`, `caseSensitive`, `url`, `handler`) and the stale `type=unique` hint from the hand-written `HAND_CRAFTED_SCHEMAS['validation']` fallback in `@objectstack/metadata-protocol` — leftovers from the removed `unique`/`async`/`custom` variants.
  - Added the missing `beforeDelete` lifecycle-hook pointer to the validation docs' "not a rule type" callout, so delete-time guards aren't stranded now that validation has no `delete` event (#3184).

- 46e876c: fix(spec): declare `summaryOperations` sub-fields in the Field metadata form (#3257)

  `fieldForm` (the registered metadata form for editing a Field) previously
  declared `summaryOperations` as a bare `composite` with no sub-fields, so a
  protocol-driven renderer had to fall back to a raw JSON editor. It now declares
  the inner shape explicitly — `object` (`ref:object`), `function` (select),
  `field`, `relationshipField`, and `filter` (bound to `widget: 'filter-condition'`)
  — mirroring the `summaryOperations` Zod schema and surfacing the roll-up `filter`
  added in #1868. Also gates the block to `data.type == 'summary'`.

  Small step toward #3257 (making the Studio field designer metadata-driven rather
  than hand-coded); the live objectui inspector already edits these fields.

- 158aa14: feat(automation): mark the loop `collection` config field as an interpolate() template so designer forms render it correctly (#3304)

  The flow designer generates a node's config form from its published
  `configSchema` (ADR-0018). A string property can now carry an `xExpression:
'expression' | 'template'` marker — riding the same Zod `.meta()` → JSON-Schema
  channel as `xRef` / `xEnumDeprecated` — that declares whether the string is bare
  CEL or an `interpolate()` single-brace `{var}` template.

  The `loop` node's `collection` (e.g. `{tasks}`) is a template, so it is now
  marked `xExpression: 'template'` on both the canonical `LoopConfigSchema` and the
  shipped descriptor's `configSchema` literal (service-automation loop-node).
  Without the marker the designer rendered `collection` as plain text online while
  the offline hardcoded form rendered it as a mono expression editor, and the CEL
  brace-trap false-flagged `{tasks}` as a malformed condition. The marker closes
  that divergence — objectui #2670 Phase 3 (#2699) already consumes it.

  Additive and backward-compatible: an unknown `xExpression` value is ignored by
  the designer, and runtime behavior is unchanged. Filling the same marker in on
  the remaining node types (map/decision/script and the node types that publish no
  `configSchema` yet) is tracked as follow-up in #3304.

- d2723e2: **`MetadataManager.register()` / `unregister()` now announce to `subscribe()` watchers.** Both updated the registry, persisted to writable loaders and published to realtime, but never fired the watch callbacks — so `subscribe()` looked like it covered every write while silently missing all of them. Only the `saveMetaItem` path (via the repository watch stream) and the filesystem watcher ever reached a subscriber. Runtime consumers that cache metadata — notably ObjectQL's SchemaRegistry bridge, the component that decides what is queryable — went stale on every other write until the process restarted.

  Announcing is now the **default**, so a new call site is correct without knowing this contract exists. This is a contract fix rather than a bug fix: the one live behavior change is that runtime datasource writes (`datasource-admin`) now reach the HMR SSE stream, which subscribes to every registered type. `unregisterPackage()` / `bulkUnregister()` also announce their deletes now — correct, but latent, since neither has a production caller today.

  Bulk ingest opts out explicitly with the new `MetadataWriteOptions` (`{ notify: false }`) — boot-time filesystem priming, artifact ingest, and ObjectQL's registry bridge, each of which either runs before consumers cache anything or announces the whole batch once (as the artifact reload path does via `metadata:reloaded`). The bridge in particular MUST stay silent: it copies objects out of the SchemaRegistry, and announcing would feed them back through a handler that re-registers under `_packageId ?? 'metadata-service'`, overwriting the true package provenance of every object whose body carries no `_packageId`.

  Additive only — `register(type, name, data)` and `unregister(type, name)` keep working unchanged.

  Fixes #3112.

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

- e0859b1: fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

  The `js` **expression** dialect was declared in `ExpressionDialect` but never
  shipped — it existed only as a registry stub with no engine and no author helper
  (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
  `js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
  now `{cel, cron, template}`.

  Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
  the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
  bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
  dialect.

  Also fixes a latent bug in `hasDialect`: it detected stubs via
  `dialect.startsWith('stub:')`, but stubs were registered under their real name,
  so the check was dead code and `hasDialect('js')` returned a false-positive
  `true`. With the stub removed, `hasDialect` reports only registered real
  engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

  No runtime behavior changes for any valid persisted artifact — no producer ever
  emitted `dialect: 'js'`. See the ADR-0058 addendum.

- 8923843: Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
- f16b492: Remove the dead `'delete'` member from the validation-rule `events` enum (#3184). The rule evaluator only runs on the insert/update write path — `engine.delete` never invokes it — so a rule declaring `events: ['delete']` was a silent no-op (flagged in #3106 and `docs/audits/2026-06-validationschema-property-liveness.md`). The enum now admits only `insert`/`update`; guard deletions with a `beforeDelete` lifecycle hook instead. No shipped metadata declares `events: ['delete']`; any off-spec metadata that did now fails loudly at `os validate` / registration rather than parsing and doing nothing. Also narrows the two hand-written mirrors (`rule-validator.ts` `BaseRule`, `metadata-protocol` JSON-schema form helper — whose stale `type` enum listing removed `unique`/`async`/`custom` variants is corrected in the same pass), updates the doc comments, the published data skill, and the hand-written validation doc.
- 4b6fde8: Trim the dead `undelete` and `api` webhook triggers (#3196). `WebhookTriggerType` declared five triggers but only three ever fired:

  - `undelete` had no event source — the engine has no soft-delete/restore capability (`delete` is a hard delete; no `deleted_at` convention, no restore operation, and `data.record.undeleted` is never emitted). The `undeleted` case in the auto-enqueuer's action mapper was dead code awaiting a producer that doesn't exist.
  - `api` ("manually triggered") had no fire path — the only webhook HTTP surface re-queues already-failed deliveries; nothing originates a manual fire.

  Both are removed from the enum (contract-first, matching #3184/#3195): authoring a webhook on a removed trigger now fails loudly at `os validate` / registration instead of registering a webhook that silently never fires. No shipped webhook metadata used either. The auto-enqueuer now also warns when a persisted `sys_webhook` row carries a trigger it can't map to an emitted record event (a drift-guard, so a dead trigger can't silently no-op again). Reintroduce `undelete` only alongside a real restore subsystem, and `api` only alongside a real manual-fire endpoint. Updated the `sys_webhook` trigger options, field help (all locales), docs, and reference; added rejection tests.

- 2018df9: **Unify the developer-facing org identifier in JS hooks — `organizationId` is now the blessed name; `session.tenantId` becomes a deprecated alias (#3280).** The caller's active organization was surfaced to hook authors as `ctx.session.tenantId`, while everything else on the developer surface — the `organization_id` column, `current_user.organizationId` in RLS/sharing, and seed rows — already said `organization`. A hook author had to internalize the hidden equation `tenantId === organizationId` to move between surfaces. This is additive and non-breaking:

  - **`ctx.session.organizationId`** is added as the blessed name; **`ctx.session.tenantId`** still carries the identical value but is marked `@deprecated` in its TSDoc. Both come from the same resolved `ExecutionContext.tenantId` (which the kernel derives from `session.activeOrganizationId`).
  - **`ctx.user.organizationId`** is added to the ergonomic `user` shortcut, so a hook that needs "the current org to filter by" writes `ctx.user.organizationId` with zero relearning — matching `current_user.organizationId` (RLS) and the `organization_id` column. The engine now populates `ctx.user` (`{ id, email?, organizationId? }`) at every hook event that already carries a `session`; it stays `undefined` for system / unauthenticated writes.

  **No behavior change and no breaking rename.** The generic driver-layer tenancy abstraction (`ExecutionContext.tenantId`, `DriverOptions.tenantId`, `SqlDriver.applyTenantScope`, `TenancyConfig.tenantField`) is deliberately untouched — that layer's isolation column is configurable and legitimately carries an _environment_ id in per-environment (database-per-tenant) kernels. Hook-authoring docs now teach `organizationId` and distinguish the two isolation axes: **org row-scoping** (`organization_id`, shared DB) vs **environment / database-per-tenant** (`service-tenant`, `driver-turso`). Community edition never populates an org, so `organizationId` is `undefined` there.

- fc5a3a2: **The `view` metadata type-schema now validates all three runtime `view` shapes instead of stripping two of them to `{}`.** `metadata-type-schemas.ts` mapped `view` to the aggregate container `ViewSchema` (`{ list, form, listViews, formViews }`, every slot optional). Zod strips unknown keys, so the two non-container shapes a `view` body actually carries at runtime — a standalone **ViewItem record** (`{ name, object, viewKind, config }`) and a **console personalization overlay** (raw view config + identity inherited by `normalizeViewMetadata`, #2555) — both strip-parsed to `{}`. That made the `422` check in `saveMetaItem` and read-time `computeMetadataDiagnostics` a **no-op** for those shapes: a broken `config` (e.g. a kanban missing `groupByField`) saved with a false `200` and badged valid, and the view create-seed test validated against nothing.

  `view` now maps to a new `ViewMetadataSchema` — a union over the three shapes, each validated genuinely:

  1. **defineView container** — non-empty (`ViewSchema` refined to require at least one of `list`/`form`/`listViews`/`formViews`; an empty container is rejected, mirroring `defineView`).
  2. **ViewItem record** — `ViewItemSchema`; the nested `config` is validated against ListView/FormView.
  3. **Flattened personalization overlay** — inline ListView/FormView config plus optional identity fields. Structural guards pin `config`/`list`/`form`/`listViews`/`formViews` to `undefined` so a malformed record or container can never be rescued through this lenient branch with its real payload silently stripped.

  All members strip-parse (no `.strict()`), so auxiliary Studio round-trip keys (`isPinned`, `sortOrder`, …) still ride along without a false `422`, and `saveMetaItem` keeps persisting the body verbatim. `z.toJSONSchema()` emits the schema as an `anyOf` of the four members, which `/api/v1/meta/types/view` serves to Studio's SchemaForm.

  Fixes #3095.

## 15.1.1

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

- f531a26: feat(protocol): complete ADR-0087 — load-seam handshake, chain backfill 12–15, release artifacts (#2643)

  Closes the remaining ADR-0087 gaps (see the ADR's as-built Addendum):

  - **P0 load seams (D1).** The protocol handshake now runs on the boot-time
    durable-package rehydration path (`@objectstack/service-package` refuses an
    incompatible `sys_packages` row with the structured `OS_PROTOCOL_INCOMPATIBLE`
    diagnostic and keeps booting) and on `AppPlugin` for code-defined stacks
    (fail-fast before the manifest is decomposed). `objectstack lint` gains
    `protocol/missing-engines-range` (warning + fix-it) and the
    `create-objectstack` blank template stamps `engines: { protocol: '^<major>' }`
    (re-stamped at version time by `scripts/sync-template-versions.mjs`) — the
    two ends of the grandfathering ratchet.
  - **Chain backfill (D2/D3).** `MetadataConversion.retiredFromLoadPath`
    implements the load-window's second half (retired entries replay only via
    `migrate meta` / fixture CI). Steps 12–15 land: the `api.requireAuth` flip
    (semantic), the ADR-0090 wave (3 retired conversions + 5 semantic TODOs), the
    `BookAudience` rename (retired conversion), and the ADR-0089 visibility
    unification (`visibleOn`/`visibility` → `visibleWhen` as LIVE load-window
    conversions) + the `.strict()` flip (semantic). The protocol-11
    `compactLayout` → `highlightFields` rename is backfilled as a retired step-11
    conversion. `migrate meta --from 10` now reaches protocol 15.
  - **Release artifacts (D4).** `spec-changes.json` is generated from the
    registries (`gen:spec-changes`, CI drift-checked), ships in the npm artifact
    together with `api-surface.json`, and is attached to each `@objectstack/spec`
    GitHub Release with `added[]`/`removed[]` filled from the api-surface diff
    against the previously published release. The upgrade guide
    (`docs/protocol-upgrade-guide.md`) is generated from the same registries and
    CI drift-checked — a projection that cannot drift.

- f531a26: feat(connectors): ADR-0096 — provider-bound declarative connector instances materialized at boot (#2977)

  Declarative `connectors:` stack entries used to be **descriptor-only** (#2612):
  registered as metadata but never dispatchable, the platform's one dead metadata
  surface. An entry may now name a **`provider`** — an installed generic executor
  (`openapi` / `mcp` / `rest`) — and the automation service **materializes** it
  into a live, dispatchable connector at boot. AI can now wire an integration as
  pure metadata and a flow `connector_action` calls it end-to-end.

  - **Schema (`@objectstack/spec`).** `ConnectorSchema` gains `provider`,
    `providerConfig`, and `auth` (a `credentialRef`-based instance-auth shape —
    `ConnectorInstanceAuthSchema` — that references credentials, never inlines
    them); `authentication` now defaults to `{ type: 'none' }` so a provider-bound
    instance need not author it (loosening — existing connectors are unaffected).
    `DeclarativeConnectorEntrySchema` (used by `stack.zod.ts`) rejects inline
    secrets, orphan `providerConfig`/`auth`, and authored `actions`/`triggers` on a
    provider-bound entry. A new `integration/connector-provider.ts` defines the
    provider-factory contract as pure types.

  - **Engine + boot (`@objectstack/service-automation`).** The engine adds a
    connector-provider registry (`registerConnectorProvider`/`getConnectorProvider`)
    and origin-tags registered connectors. At boot the service resolves each
    provider-bound entry — looking up the factory, resolving `auth.credentialRef`
    via a pluggable `CredentialResolver` (open-tier default: environment
    variables), and registering the materialized connector. Boot **fails loudly**
    for an unknown provider, invalid `providerConfig`, an unresolvable
    `credentialRef`, or a name conflict with a plugin-registered connector (no
    silent precedence).

  - **Providers (`connector-rest` / `connector-openapi` / `connector-mcp`).** Each
    plugin registers a provider factory in `init()` reusing its existing
    generator/adapter API. Plugin options are now **optional**: with none the
    plugin contributes only its provider factory; with instance options it also
    registers a hand-wired connector (back-compat). `connector-openapi` adds a
    `ConnectorOpenApiPlugin`.

  Open tier: static auth (`none`/`api-key`/`basic`/`bearer`) with `credentialRef`
  resolved from env vars. Managed vaulting, OAuth2 refresh, and per-tenant
  connection lifecycle remain the enterprise tier (ADR-0015) — an enterprise host
  injects a vault-backed `CredentialResolver` with no change to the materialization
  path.

- f531a26: feat(connector-openapi): resolve `providerConfig.spec` from a package-relative file path (#3016, ADR-0096 follow-up)

  ADR-0096's canonical example authors an OpenAPI-backed instance as
  `providerConfig: { spec: './billing-openapi.json' }`, but the landed `openapi`
  provider factory only accepted an inline document object or an http(s) URL.
  The spec union is now complete: **inline object | file path | remote URL**.

  - **`@objectstack/spec`.** `ConnectorProviderContext` gains an optional
    host-injected `loadPackageFile(relativePath)` capability (pure type): reads a
    UTF-8 file resolved against the declaring stack/package root, confined to
    that root. `undefined` on hosts without a filesystem.

  - **`@objectstack/service-automation`.** New `packageRoot` plugin option (the
    base for relative file refs; defaults to `process.cwd()`) and an exported
    `createPackageFileLoader(packageRoot)` that implements the confinement
    guard — absolute paths and `..`-escaping paths are rejected — with lazy
    `node:fs`/`node:path` imports so non-Node hosts only fail if a file ref is
    actually dereferenced. The materializer injects the capability into every
    provider factory's context. Failures follow the existing reconcile policy:
    **fatal at boot, entry skipped on reload**.

  - **`@objectstack/connector-openapi`.** A string `providerConfig.spec` that is
    not an http(s) URL is now read via `ctx.loadPackageFile` and parsed as an
    OpenAPI JSON document (clear errors for missing/unreadable files, unparseable
    JSON, and hosts without package file access).

  - **`@objectstack/cli`.** `serve`/`dev` pass the project folder (the
    `objectstack.config.ts` directory) as the automation service's `packageRoot`,
    mirroring how the standalone sqlite default is anchored.

- f531a26: feat(connectors): degrade + retry declarative instances whose upstream is unreachable (#3017)

  ADR-0097 kept every declarative-connector materialization failure fatal at
  boot. That is right for configuration faults (unknown provider, invalid
  `providerConfig`, unresolvable `credentialRef`, name conflict) but wrong for
  _operational_ ones: a `provider: 'mcp'` instance must contact its MCP server
  (`tools/list`) to materialize, and a transient network blip aborted the whole
  app boot.

  - **spec**: a provider factory can now throw
    `ConnectorUpstreamUnavailableError` (code `CONNECTOR_UPSTREAM_UNAVAILABLE`,
    structural guard `isConnectorUpstreamUnavailable`) to mark a failure as
    "upstream temporarily unreachable — degrade and retry" instead of fatal.
  - **service-automation**: the reconcile degrades such an instance in both boot
    and reload modes: it registers an action-less husk (`state: 'degraded'` +
    `degradedReason` on the `GET /connectors` descriptor) so the instance is
    visible instead of silently missing — or, on a changed-config
    re-materialization, keeps the old connector serving. A `connector_action`
    against a degraded instance fails with the reason and a "retries
    automatically" pointer. Degraded instances retry on an exponential backoff
    (5s → 5min, reset by config edits) and on every `metadata:reloaded`
    reconcile; recovery swaps the husk for the live connector atomically.
    Reconcile runs (boot / reload / retry timer) are now serialized.
  - **connector-mcp**: the `mcp` provider classifies connect / `tools/list`
    failures as upstream-unavailable; transport-shape validation stays a plain
    (fatal) throw.

  Configuration faults remain loud boot failures — the carve-out is only for the
  unavailable marker.

- 3fe9df1: Security (#2991): the AI `ToolExecutionContext` contract no longer documents system-level execution as the missing-actor default. A missing `toolExecutionContext` / `actor` now means an unauthenticated (RLS-on, sees-nothing) principal — executors MUST fail closed to anonymous, never fall open to system. System execution becomes an explicit, greppable opt-in via the new `ToolExecutionContext.isSystem?: boolean` field (same convention as `IDataEngine` / `IKnowledgeService`), reserved for trusted server-side invocations and ignored when an `actor` is present. Migration for internal callers that relied on the old omission default (cron, migrations, server jobs): pass `toolExecutionContext: { isSystem: true }` explicitly.
- f531a26: fix(authz): carry the derived posture rung on ExecutionContext (#2947)

  The ADR-0095 D2 posture ladder (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER >
EXTERNAL`) is derived once by the shared authz resolver from capability grants,
  but both HTTP/MCP entry points that build the `ExecutionContext` dropped it —
  so any enforcement-side reader of `context.posture` always saw `undefined`
  (the same drop that forced the explain layer to re-derive it, #2949).

  `ExecutionContextSchema` now carries an optional `posture` field, and both
  `rest-server` and the runtime `resolveExecutionContext` plumb the resolver's
  value through. Additive and **behavior-preserving**: no enforcement decision
  consumes `posture` yet — whether the hot path evaluates _by_ posture remains a
  larger ADR-level decision — this only stops the already-computed value from
  being discarded, so enforcement and explain read the same derived rung.

- f531a26: Dashboard-level filters spec pairing (framework#2501, objectui#2578) — land the
  two properties the objectui runtime already ships (objectui#2576) so the
  protocol and the renderer agree:

  - **`GlobalFilterSchema.name`** (optional string) — stable filter name used as
    the dashboard-variable key (readable in widget expressions as `page.<name>`)
    and as the key widgets reference in `filterBindings`. Defaults to `field`;
    `"dateRange"` is reserved for the built-in dashboard date range.
  - **`DashboardWidgetSchema.filterBindings`** (optional
    `Record<string, string | false>`) — per-widget binding from a dashboard
    filter name to one of THIS widget's fields: a string re-targets the filter to
    that field, `false` opts the widget out, absent falls back to the filter's
    own `field`.

  Purely additive — existing dashboards parse unchanged. The metadata-admin
  dashboard inspector (objectui `dashboard-schema.ts`) derives its form from this
  schema via `z.toJSONSchema`, so both properties surface there automatically
  once objectui picks up this spec version.

- f531a26: feat(spec): structured `buttons` + `defaults` config on `FormViewSchema` (#2998)

  `FormViewSchema` gains two optional top-level keys — the spec home for the flat
  renderer-invented form config ObjectUI's `ObjectForm` reads today
  (`showSubmit`/`submitText`/`showCancel`/`cancelText`/`showReset`/`initialValues`,
  objectui#2545), which the strip-mode container silently discards:

  - **`buttons`** — structured action-button config: per-button `{ show, label }`
    for `submit` / `cancel` / `reset` (new exported leaf `FormButtonConfigSchema`,
    `.strict()` per ADR-0089 D3a so typo'd keys error loudly).
  - **`defaults`** — initial field values for create-mode forms, keyed by field
    machine name (absorbs ObjectUI's `initialValues`).

  Both are marked `[EXPERIMENTAL — NOT ENFORCED]` per ADR-0078's escape hatch
  until the ObjectUI renderer reads them (tracked in objectui#2545); authoring
  them today is declared, not yet honored. Purely additive — no existing key
  changes shape, no tombstone needed.

- f531a26: feat(kernel): add `kernel:bootstrapped` lifecycle anchor — the phase that fires after every `kernel:ready` handler has settled but before `kernel:listening` (HTTP socket open). `kernel:ready` handlers run sequentially in plugin-registration order, so a handler that consumes data produced by a later-starting plugin (e.g. the security bootstrap seeds `sys_position`; the app plugin's seed loader inserts records) would race the very rows it needs. `kernel:bootstrapped` is the correct anchor for reconcile/backfill work: every producer's ready handler has finished by the time it fires. Both `ObjectKernel` and `LiteKernel` trigger it. The sharing-rule boot backfill moves from `kernel:listening` to `kernel:bootstrapped` (semantics-only; behaviour unchanged).
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

- f531a26: Conditional tabs (#2606): `page:tabs` items accept an optional `visibleWhen` CEL predicate. When it evaluates FALSE the whole tab — header **and** panel — is omitted from the tab strip, unlike a child component's own `visibleWhen`, which hides only the panel content and leaves an empty tab header behind. The predicate binds the same environment as page-component `visibleWhen` (`record` + `current_user`, plus page state as `page.<var>`) and is re-evaluated live when page variables change.

  Per ADR-0089 the key uses the canonical `*When` name from day one — the deprecated `visibility` / `visibleOn` aliases are **not** accepted on tab items (this surface is new; there is no legacy metadata to alias for).

  Additive and back-compatible: items without `visibleWhen` behave exactly as before.

- f531a26: feat(spec): page variable `source` renders as a component picker (objectui#2328)

  The page metadata form's `variables` repeater now declares explicit sub-fields
  and pins `{ field: 'source', widget: 'ref:component' }`. A page variable's
  `source` names the component (by `id`) that writes it, so Studio can offer it as
  a dropdown of the components actually placed on the page — mirroring how the
  sibling `object` field uses `ref:object` — instead of a free-text input the
  author has to type an id into by hand. The `ref:component` widget itself lives
  in objectui (app-shell metadata-admin); this change is the form-spec trigger.

- f531a26: feat(spec)!: remove `tenancy.strategy` + `tenancy.crossTenantAccess`; tenancy block is now strict (#2763)

  > ⚠️ RELEASE NOTE — breaking by strict semver, shipped as `minor` per the
  > launch-window policy (owner decision on PR #2962): the fields had zero
  > consumers, behavior is unchanged, and the parse error carries the
  > migration. Fold into the v15 release page's "What's new in 15.x" section
  > when versioning.

  BREAKING CHANGE: `TenancyConfigSchema` drops its two zero-consumer fields, and
  the `tenancy` block is now `.strict()` — an unknown key is a loud parse error
  with tombstone guidance instead of a silent zod strip (#1535; precedent
  ADR-0056 D8 "compliance-grade config must never merely look live", ADR-0049
  enforce-or-remove).

  The platform has exactly two tenancy modes, and neither needs object-level
  strategy config: database-per-tenant isolation is an environment/deployment
  choice (each environment carries its own database URL), and shared-database
  row isolation is `tenancy.enabled` + `tenancy.tenantField` (both stay, both
  live: sql-driver row scoping, security-plugin org scoping). Cross-tenant
  visibility is governed by sharing rules / OWD (ADR-0056),
  `externalSharingModel` (ADR-0090 D11), and the object access posture — never
  by a blanket boolean.

  Migration (delete the keys; nothing read them, so behavior is unchanged):

  - FROM `tenancy: { enabled: false, strategy: 'shared' }` → TO `tenancy: { enabled: false }`
  - FROM `tenancy: { enabled: true, strategy: '...', tenantField: 'x', crossTenantAccess: false }` → TO `tenancy: { enabled: true, tenantField: 'x' }`
  - Wanted per-tenant databases? Deploy per environment (EnvironmentKernelFactory) — not object metadata.
  - Wanted cross-tenant visibility? Use sharing rules / OWD or `externalSharingModel`.

  The compile-time authorWarn for these fields (#2750) and their liveness-ledger
  entries are retired with the removal; the schema itself now carries the
  prescription.

- f531a26: Retire the "ObjectOS" layer name from the spec's public surface — the control layer is the **Kernel**; ObjectOS now exclusively names the commercial runtime environment.

  Renames (deprecated aliases kept for one release, so existing imports keep compiling):

  - `ObjectOSCapabilitiesSchema` → `KernelCapabilitiesSchema`
  - `ObjectOSCapabilities` (type) → `KernelCapabilities`
  - `ObjectOSKernel` (interface) → `IKernel` (`PluginContext.os` is now typed as `IKernel`)

  Migration: replace the old names with the new ones — a find/replace of the three identifiers above is sufficient; runtime behavior, schema shapes, and JSON output are unchanged. TSDoc and generated reference docs now say "the ObjectStack runtime" / "Kernel" instead of "ObjectOS" (product mentions like ObjectOS Cloud in the Cloud protocol domain are unchanged).

- 627f225: feat(spec): userActions.edit/delete accept per-record CEL predicates (objectui#2614)

  `userActions.edit` / `userActions.delete` now accept, in addition to the
  plain boolean, an object form `{ enabled?, visibleWhen?, disabledWhen? }`
  (`RowCrudActionOverrideSchema`) so the built-in row Edit/Delete affordances
  can be hidden or disabled **per record** via CEL predicates — the same
  evaluation contract custom row actions already use. `visibleWhen` false →
  button not rendered (fail-closed); `disabledWhen` true → rendered disabled
  (fail-soft). Advisory UI gating only; server enforcement stays with
  permissions/hooks.

  `resolveCrudAffordances()` keeps returning the resolved booleans (`enabled`
  falls back to the `managedBy` bucket default) and now surfaces the
  predicates as `editPredicates` / `deletePredicates`. Boolean-only inputs
  produce byte-identical output — zero behavior change for existing schemas.

  `clampManagedObjectWrites` (ADR-0092 D2 hint clamp) treats the object form
  by its explicit `enabled` flag only: per-record predicates are not a write
  grant, so managed objects stay fail-closed unless `enabled === true`.

- f531a26: feat(spec,cli): enroll `view` in the liveness ledger (#2998 Track B)

  `view` joins the `GOVERNED` set of the spec property-liveness gate — the
  rollout gap that let the objectui#1763/#2545 class of renderer/spec key drift
  survive undetected. New `packages/spec/liveness/view.json` classifies all 83
  walkable properties (75 ledger entries + framework overlay fields): the `list`
  and `form` containers are drilled one level via `children`.

  Seeded from the 2026-06 viewschema audit and **re-verified against objectui
  HEAD** — four audit-era DEAD findings had since gone live and are classified
  from current reads (`form.submitBehavior`, `list.sharing.lockedBy`, list-path
  `ViewData` providers, and the post-ADR-0021 `list.chart` dataset shape — the
  audit's "chart renderers never migrated" headline is resolved). Final tally:
  68 live, 2 experimental (`form.buttons`/`form.defaults`, #2998 Track A
  awaiting objectui#2545), 5 dead (`list.responsive`, `list.performance`,
  `form.data`, `form.defaultSort`, `form.aria`). All misleading dead props
  carry `authorWarn` + `authorHint`.

  The CLI's compile-time liveness lint gains `view` coverage
  (`TYPE_COLLECTIONS` + view containers labelled by `object`), so authoring a
  dead prop — e.g. a spec-valid `chart` list view that renders empty — now warns
  at `os build` with a corrective hint.

### Patch Changes

- f531a26: docs(spec): retire the stale `renderViaSchema` forward-reference now that objectui#2546 landed (ADR-0085 PR4 follow-up, #2548)

  The `ObjectSchema` source comment forward-referenced `renderViaSchema`
  retiring "together with the legacy monolith render path" — a promise about
  work that had not yet shipped. That path, and the `detail.renderViaSchema`
  kill-switch that was its only steering wheel, were removed in objectui#2546
  (ADR-0085 PR4). The comment now records the completed state with a breadcrumb
  to that PR instead of a forward reference, closing the cleanup #2546 flagged.

  Comment-only change; no type, schema, or runtime behavior is affected.

- f531a26: feat(automation): descriptor-only contract + boot audit for declarative `connectors:` (#2612)

  Declarative `connectors:` stack entries never reach the automation engine's
  connector registry — only plugins populate it via
  `engine.registerConnector(def, handlers)` (ADR-0018 §Addendum) — so a declared
  connector with actions and no plugin behind it _looked_ dispatchable but was
  silently inert.

  The contract is now explicit and audited:

  - **Boot audit (service-automation).** At `kernel:ready` (and again on
    `metadata:reloaded`), declared connectors with `actions` but no same-name
    runtime registration log a loud warning naming each inert entry and
    pointing at the fix (install the matching connector plugin, or mark a
    deliberate catalog entry). Nothing is registered on your behalf — the
    warning surfaces the gap `connector_action` would otherwise hit at
    dispatch time.
  - **`enabled: false` = deliberate catalog descriptor (spec).** Setting it on
    a declarative entry documents "descriptor-only on purpose" and silences the
    audit. Schema docs on `stack.zod.ts` (`connectors:`) and
    `integration/connector.zod.ts` now state the descriptor-vs-registered
    contract explicitly (including for AI stack authoring via `.describe()`).

  Declarative provider-bound connector _instances_ — entries a generic executor
  (connector-openapi / connector-mcp) materializes into live connectors at boot,
  upgrading this warning to a hard error — are specified in ADR-0096 and tracked
  in #2977.

- f531a26: docs(security): document that `requireAuth` denies anonymous across ALL HTTP surfaces (#2567)

  The `api.requireAuth` schema description and JSDoc said the anonymous-deny
  posture applied to REST `/data/*` only. Post-#2567 the same value is threaded to
  every entry point that reaches object data — REST `/data`, the metadata
  endpoints (`/meta`), the dispatcher GraphQL endpoint (`/graphql`), and the
  raw-hono standard `/data` routes — sharing one decision (`shouldDenyAnonymous`).
  The description now reflects the uniform, by-surface posture and the single
  opt-out (`requireAuth: false`). Doc-only; no behavior change.

  (Accompanying hand-written docs — `permissions/authorization.mdx` and the
  regenerated `references/api/rest-server.mdx` — are updated to match.)

- f531a26: docs(spec): `readonly` is server-enforced on UPDATE, not a UI-only affordance (#3003)

  The `readonly` field property was described as "Read-only in UI", which #3003
  proved to be exactly how integrators read it — approval/status/amount columns
  protected only by `readonly: true` were forged with a direct REST `PATCH`,
  self-approving a multi-stage approval on the released 15.0.0. Since #2948 the
  engine strips caller-supplied writes to statically-readonly fields from every
  non-system UPDATE (single-id and multi-row, symmetric with `readonlyWhen`;
  INSERT may still seed the column). The schema description and the field
  liveness ledger now state the server-side contract, and a dogfood conformance
  proof (`showcase-static-readonly.dogfood.test.ts` + an authz-matrix row) pins
  it end-to-end so it cannot silently regress to renderer-only.

- f531a26: **Every feature-gated capability is now UI-gated, guardrailed by a flag registry and a declarative `requiresFeature` annotation (#2874, generalizing the create-user phone fix #2871).**

  `@objectstack/spec/kernel` gains `PUBLIC_AUTH_FEATURES` — a classification registry for all 13 boolean flags served at `/api/v1/auth/config`: consumption surface (crud/login/status), default semantics (opt-in `== true` vs default-on `!= false`), and the gated spec inputs or an exemption reason. A plugin-auth drift test pins the served key set to the registry, and a platform-objects completeness guard pins the registry to the actual gates in both directions.

  `ActionSchema`/`ActionParamSchema` gain `requiresFeature: '<flag>'` (enum-checked), lowered at parse time into the canonical `visible` CEL predicate per the flag's registered semantics, AND-composed with any explicit `visible`, and stripped from the output — renderers and lint see only `visible`, so objectui needs no changes. All 22 hand-written `features.*` gates migrated (behavior-locked by an exact-string matrix test), and the audit gated 17 previously naked capability-dependent actions: the six `sys_user` platform-admin actions, six 2FA actions, and five `sys_oauth_application` actions now hide when their plugin is off instead of rendering buttons that 404.

- f531a26: fix(security): pre-wiring identity admission for the GraphQL and realtime surfaces (#2992, ADR-0096 D4)

  Two latent execution surfaces — neither reachable by a client today — would
  have fallen open the instant a real transport was wired, because both drop or
  lack the caller's identity. Per ADR-0096, the identity story is fixed and
  pinned in CI _before_ wiring, not after an adversarial review:

  - **GraphQL (surface 1 — latent context-drop, now threaded).**
    `handleGraphQL` passed only `{ request }` to `kernel.graphql`, dropping the
    resolved `ExecutionContext` — the moment a real engine resolved objects
    through ObjectQL it would have run context-less (security middleware falls
    OPEN on a missing principal = full authority). The entry point now resolves
    the caller identity even on the direct dispatcher-plugin route and even when
    `requireAuth` is off, and threads it as `options.context`;
    `IGraphQLService.execute` documents that implementations MUST forward it to
    every data-engine call. Unit-proven; the authz conformance matrix pins the
    threading (`graphql-identity-thread` row) so removing it goes STALE and
    fails CI.

  - **realtime (surface 2 — no per-recipient authz seam, posture registered).**
    Delivery is a pure fan-out (subscriptions carry no principal,
    `matchesSubscription` filters only by object+eventTypes, the engine
    publishes the full `after` row), safe only while every subscriber is
    server-internal. The posture is now registered as an `experimental` matrix
    row (`realtime-delivery-authz`) stating the admission requirement
    (per-recipient RLS/FLS/tenant re-check on delivery, or id-only payload +
    client re-fetch), and transport TRIPWIRE probes turn any newly wired
    WebSocket/SSE/subscribe/client transport into an UNCLASSIFIED surface → red
    CI until the identity story ships with it. The `service-realtime` README —
    which advertised `authorizeChannel`/`broadcastToUser`/presence auth that do
    not exist — is rewritten to describe the real, trusted-internal-only
    surface, and the contract docs carry the admission requirement at the seam.

- f531a26: fix(spec): keep `lazySchema` proxies identity-compatible with `z.toJSONSchema` (objectui#2561)

  zod's `toJSONSchema` keys its `seen` map on the node object it traverses — the `lazySchema` Proxy wherever a schema is referenced lazily (`z.lazy(() => X)` recursion getters, direct conversion roots) — while its wrapper-type processors (pipe/lazy/optional/default/…) look themselves up via the REAL instance captured at construction (`inst._zod.processJSONSchema = (ctx, …) => pipeProcessor(inst, …)`). The identity mismatch crashed conversion with `Cannot set properties of undefined (setting 'ref')`.

  This stayed latent while lazy-referenced schemas were plain objects (the object processor never looks itself up); ADR-0089 D3a turned `PageComponentSchema` / `FormFieldSchema` into `.strict().transform(…)` **pipes**, which broke ObjectUI Studio's spec-derived Page/View inspector JSONSchema derivation under spec 15.

  Fix: the proxy now serves a memoised `_zod` facade that prototype-delegates to the real internals and wraps only `processJSONSchema` to alias the proxy's `seen` entry onto the real instance before delegating. Parse behavior is unchanged; `OS_EAGER_SCHEMAS=1` remains the bypass. Regression tests cover the D3a pipe shape, recursion through `z.lazy(() => proxy)`, mixed proxy+real traversal, and the full `PageSchema` / `ViewSchema` Studio derivation paths.

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

- f531a26: fix(security): public-form submissions can no longer forge server-managed anchors (#3022)

  The anonymous public-form surface (ADR-0056 Option A, `POST /forms/:slug/submit`)
  is authorized by the declaration-derived `publicFormGrant`, which short-circuits
  the security middleware BEFORE every write gate (CRUD, FLS, the owner anchor
  guard, the tenant CHECK). The only field-side defense was the route's
  declared-field allow-list — and a FormView with zero declared section fields
  fell back to merging the raw body wholesale, so an unauthenticated visitor
  could `POST owner_id=<victim>` (or `organization_id`, audit columns, `id`) and
  attach the record to another user or tenant — the #3004 insert-forge, with no
  credentials at all.

  Server-managed anchors are now enforced on this surface at BOTH layers, from a
  single shared definition (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`, new in
  `@objectstack/spec/security`):

  - **Data layer (authoritative)** — the `publicFormGrant` branch in
    `@objectstack/plugin-security` strips `id` / `owner_id` / `organization_id` /
    `tenant_id` / audit columns / soft-delete state / `__search` from every row
    of a granted insert (batch included) before admitting the write, so the
    boundary holds no matter what any route lets through. Ownership stays NULL
    for object hooks / the first-admin bootstrap to assign, as for other
    anonymous-seeded rows.
  - **Route layer** — the submit allow-list excludes the same set
    unconditionally: an explicitly declared `owner_id` section field no longer
    passes, and the zero-declared-sections fallback keeps its documented
    all-fields behavior for business columns while refusing the managed set.
    The resolve route (`GET /forms/:slug`) drops the managed fields from the
    rendered sections and the embedded object schema so a form never collects a
    value the submit refuses, and `GET /forms/:slug/lookup/:field` refuses a
    `publicPicker` declared on a managed anchor (which would have opened
    anonymous `sys_user` search through `owner_id`).

  Authenticated writes are unaffected — this is the anonymous-surface rule only;
  `owner_id` transfer semantics for signed-in callers stay governed by the
  transfer grant (#3004 / PR #3018).

- f531a26: Retire "ObjectOS" as the control-layer name in the published agent prompts (`prompts/`): the open control layer is now called the **Kernel**; **ObjectOS** exclusively names the commercial runtime environment. Layer vocabulary is now ObjectQL (data) / Kernel (control) / ObjectUI (view). Prompt text only — no schema changes.
- f531a26: feat(plugin-sharing): sys_sharing_rule provenance + seed-not-clobber (#2909 P0/T1). The object gains readonly `managed_by` (unified A4 tri-state platform/package/admin) and `customized` columns; declared rules seed with `managed_by: 'package'`. defineRule in seed mode adopts pristine/legacy rows (package upgrades stay deliverable) but never overwrites admin-authored or customized rows — an admin's `active: false` on an over-sharing rule now survives redeploys instead of being resurrected at boot. A beforeUpdate hook stamps `customized` on any non-system edit of a seeded rule. Deliberately NO write gate: sharing rules remain a first-class admin authoring surface (ADR-0094 addendum tradeoff).
- f531a26: docs(spec): rewrite the `isDefault` permission-set docs to describe the actual dual-track behavior (#2926 ②): app-level `isDefault` sets are resolved as the SecurityPlugin's fallback and idempotently auto-bound to the `everyone` anchor at boot (guarded by the high-privilege-bits check), while package-level sets are never auto-bound and instead materialize a `sys_audience_binding_suggestion` an admin confirms. The previous "never auto-bound" wording contradicted the shipped app-level track.

## 15.0.0

### Major Changes

- 28b7c28: ADR-0089 D3a: flip `.strict()` on the view form + page component schemas so a mis-layered or stale conditional-visibility key is a **loud parse error** instead of a silent strip.

  `FormFieldSchema`, `FormSectionSchema` (`view.zod.ts`) and `PageComponentSchema` (`page.zod.ts`) now reject unknown keys. Previously zod's default strip mode discarded any key these schemas did not declare — including a `visibleWhen` typo, a page-only `visibility` pasted onto a view field (or vice-versa), or a key surviving past its deprecation window — with no diagnostic, shipping inert metadata (ADR-0049 enforce-or-remove, ADR-0078 no-silently-inert).

  - **Breaking:** metadata carrying a key not declared by these three schemas now fails validation at parse. A monorepo + examples sweep found a single offender (a test fixture using `id`/`title` on a form section instead of the canonical `name`/`label`); all first-party apps and platform metadata parse clean.
  - The deprecated `visibleOn` (view form) / `visibility` (page component) aliases are **declared** keys, so they keep parsing and normalizing to `visibleWhen` — unchanged.
  - Rejection messages name the offending key(s) and, when a key looks like the visibility predicate, point the author at the canonical `visibleWhen` (new `strictVisibilityError` zod error map, exported from `shared/visibility`).

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

- e62c233: feat(spec,plugin-security): package-level capability declaration API (ADR-0066 D1)

  Packages can now DEFINE their own authorization capabilities explicitly via the
  new `defineCapability` factory and a stack's `capabilities` array, instead of
  relying on the implicit "derive an untitled capability from whatever a permission
  set references in `systemPermissions[]`" back-door.

  - `@objectstack/spec`: new `defineCapability` / `CapabilityDeclarationSchema`
    (`{ name, label?, description?, scope, packageId? }`) and a `capabilities`
    field on the stack definition.
  - `@objectstack/plugin-security`: new `bootstrapDeclaredCapabilities` seeds
    declared capabilities into `sys_capability` with `managed_by:'package'` +
    `package_id` provenance (new `package_id` field on the object). Idempotent,
    upgrade-aware; refuses to hijack curated platform capabilities or another
    package's rows, never clobbers admin-authored rows, and CLAIMS a pre-existing
    derived placeholder (upgrading it to package provenance). The implicit
    derive-from-`systemPermissions` path still runs for back-compat but now skips
    any explicitly-declared name so it can't clobber authored metadata.
  - `@objectstack/runtime`: stack-declared `capabilities` are registered into the
    metadata registry (type `capability`) so the boot seeder can read them.
  - `@objectstack/lint`: `validateCapabilityReferences` treats
    `stack.capabilities` names as a known capability source.

  A capability is not a contract: DEFINE it (`defineCapability`), GRANT it
  (`systemPermissions`), REQUIRE it (`requiredPermissions`) — no `inputs`.
  Aligns with ADR-0094 D5 (retire implicit `managed_by`-guessing back-doors).

- ed61c9b: feat(spec): C2-α — extend the `explain` contract to record granularity (#2920)

  The access-explanation contract (ADR-0090 D6) now carries the schema for
  record-level authorization explanations, so the β-phase engine
  (`plugin-security` + `plugin-sharing`) and the Studio/Setup "view as" UI can be
  built against a stable wire shape. Contract-only: no engine or UI changes ship
  here.

  Request side:

  - `ExplainRequest.recordId` (optional) — explain one concrete record at row
    granularity. Omitted = the pre-C2 object-level question, answered identically
    (backward compatible).

  Response side (row-level attribution, present only for record-grained requests):

  - New `ExplainMatchedRule` — a concrete share / sharing rule / ownership fact /
    team / territory / RLS policy / Layer 0 tenant filter that admitted or
    excluded the record at a layer, with its access level (`grants`), how it
    reached the principal (`via`), the row predicate (`predicate`), and its
    `effect` on the record.
  - New `ExplainRecordAttribution` — a layer's per-record determination
    (`outcome`, effective `rowFilter`, `matchesRecord`, matched `rules`), attached
    as the optional `ExplainLayer.record`.
  - New top-level `ExplainDecision.record` — the row-level bottom line
    (`recordId`, `visible`, `decidedBy`).

  Reserved for the ADR-0095 kernel chain (β fills these; optional, backward
  compatible):

  - New `tenant_isolation` layer id (Layer 0, the always-first tenant wall).
  - New `ExplainLayer.kernelTier` (`layer_0_tenant` | `layer_1_business`) so a
    consumer can tell the tenant wall from business RLS without hard-coding ids.
  - New `AuthzPosture` enum (`PLATFORM_ADMIN` > `TENANT_ADMIN` > `MEMBER` >
    `EXTERNAL`) exposed as the optional `ExplainDecision.principal.posture`.

  Backward compatibility: every new field is optional or additive; existing
  object-level requests and reports parse unchanged. The contract test locks the
  new field shapes alongside the existing ones.

### Patch Changes

- 31d04d4: Fix the data-import automation chain (#2922). Batch `engine.insert` now fires
  `beforeInsert`/`afterInsert` once **per row** with single-record hook contexts,
  so flat-input proxies, declarative hook conditions, audit writers, and
  record-change triggers see real records instead of arrays. A new
  `ExecutionContext.skipAutomations` flag (mirrored into `HookContext.session`)
  lets callers suppress metadata-bound automation hooks and flow dispatch while
  code-registered system hooks (audit, security, sharing) still run — making the
  import wizard's "run automations & triggers" checkbox and import undo actually
  effective. The REST import default flips to running automations unless the
  request explicitly opts out (`runAutomations: false`), matching historical
  behavior.

## 14.8.0

### Minor Changes

- 16b4bf6: ADR-0087 P1:元数据转换层(conversion layer,D2)——大多数破坏性变更对使用方零操作。

  `@objectstack/spec` 新增 `conversions/` 模块:一张按协议大版本组织、声明式、无损的转换表,在**加载时**(`normalizeStackInput` —— `defineStack` / `objectstack validate` / `lint` / `info` / `doctor` 共用的同一入口)把旧(N−1)形态的元数据改写为规范的 N 形态,并对每处改写发出结构化弃用通知(`OS_METADATA_CONVERTED`)。使用方仍按旧形态编写也能零操作加载,运行时只会看到规范形态。这是把 Kubernetes storage-version/conversion 模型套用到元数据上;它与 Prime Directive #12 禁止的“使用方侧方言兜底”在每个维度上都相反:一张集中、随 spec 版本化、声明化、显式(每次应用都发通知)、带测试(每条附 old→new fixture)、会过期(仅在一个大版本内加载期生效,之后退役并沉淀进 P2 迁移链)的表,而非散落的 `cfg.a ?? cfg.b`。

  首批以已发布的 protocol 11 重命名回填播种:

  - `flow-node-http-callout-rename`:流程回调节点 `http_request` / `http_call` / `webhook` → `http`。
  - `page-kind-jsx-to-html`:页面 `kind: 'jsx'` → `'html'`(ADR-0080 规范拼写)。
  - `flow-node-crud-filter-alias`:CRUD 流程节点 `config.filters` → `config.filter`。

  **运行时加载 seam(存量流程零回归的关键)。** 转换不仅接在构建/校验入口,也接到运行时 `AutomationEngine.registerFlow`(在 `FlowSchema.parse` 之前跑,新增 `applyConversionsToFlow`)。这样从数据库 rehydrate 的**存量流程**也会被规范化——否则删掉 `filters` 执行器兜底会让存量 `delete_record` / `update_record` 的过滤条件被静默清空(退化成作用于全表)。这才真正兑现 D2 “applied at load, the same seam”。

  **开放命名空间的冲突守卫(第三方零静默误伤)。** `flow.node.type` 是开放命名空间(ADR-0018 移除了 enum gate),退役的官方名可能被第三方复用为自定义节点。转换层新增“保留名冲突”感知:运行时 seam 传入本环境已注册的执行器类型,若某退役别名(`http_request`/`http_call`/`webhook`)正被活的自定义执行器占用,则**拒绝改写并发出响亮的结构化告警 `OS_METADATA_CONVERSION_CONFLICT`**(带节点位置、conversion id、“请改名”的处置建议),而不是静默把它改成 `http` 破坏第三方节点。构建/校验入口无注册表上下文,历史别名照常转换。

  并落实 PD #12 退役路径示范:`filters` → `filter` 别名从 `service-automation` 执行器的 `readAliasedConfig` 兜底中删除,提升为上面这条声明式转换条目;执行器改为直接读取规范键 `cfg.filter`。

  新增导出(纯增量,无破坏):`applyConversions`、`applyConversionsToFlow`、`collectConversionNotices`、`ALL_CONVERSIONS`、`CONVERSIONS_BY_MAJOR`、`CONVERSION_NOTICE_CODE`、`CONVERSION_CONFLICT_CODE`,以及类型 `MetadataConversion`、`ConversionNotice`、`ConversionApplication`、`ConversionFixture`、`ConversionContext`、`ConversionConflictNotice`、`ConversionConflictDetail`、`ApplyConversionsOptions`、`NormalizeStackInputOptions`。`normalizeStackInput` 现接受可选第二参 `{ onConversionNotice, convert }`(向后兼容)。

- 16b4bf6: ADR-0087 P2:可重放迁移链 + 机器可读变更清单(D3 / D4)。

  **D3 —— 迁移链(`@objectstack/spec` 新增 `migrations/`)。** 一条永久、有序、按协议大版本组织的迁移链。每个大版本的步骤由两个来源合成:**已毕业的转换**(P1 的 D2 转换条目从加载路径退役后,以其 id 引用复用,作为该大版本的“机械变换”,转换与 fixture 不重复)和**语义变更**(无损映射无法表达的破坏,以结构化 TODO —— surface / 原因 / 验收标准 —— 呈现,而非静默或有损自动改写)。

  - `applyMetaMigrations(stack, fromMajor, toMajor?)` 折叠 `fromMajor+1 … 当前` 的步骤,一次性把任意历史大版本的元数据迁到当前;跨大版本是设计主场景。每一跳(hop)都做检查点,便于逐跳验证与二分定位。**时效性从不承重** —— 迟到的使用方到达时重放链即可。
  - `composeMigrationChain`、`MigrationFloorError`,以及显式的发布策略旋钮 `MIGRATION_SUPPORT_FLOOR`(链能回溯到多久)。
  - 种子:protocol 11 步骤 —— 机械项为三条已毕业的 P1 转换;语义项为两个真实存量窗口:`titleFormat` 复合模板 → `nameField`(需公式字段,非无损)、SQL 式 RLS 谓词 → 规范 CEL。
  - CI 把整条链当作链来测:每条转换的 old-shape fixture 从支持下限重放到目标大版本,组合性破坏即发布阻断。

  **D4 —— `spec-changes.json` 变更清单。** Zod 定义的机器可读记录 `{ from, to, added, converted, migrated, removed }`,由 `composeSpecChanges(from, to, surfaceDiff?)` 跨大版本折叠转换表(D2)与迁移集(D3),并与发布期 api-surface 差异连接。按大版本的清单可组合成单一 `from→to` 视图;后续生成式升级指南与 P3 的 MCP `spec_changes` 工具都是它的投影。

  **CLI —— `objectstack migrate meta --from N`。** 重放迁移链:展示生成的、经 `ObjectStackDefinitionSchema` 校验的机械变更 diff(逐条 `path: 旧 → 新`)与需人工判断的语义 TODO;`--to`、`--step`(逐跳检查点)、`--out <file.json>`(把规范化后的栈写为可 diff 的 JSON 快照)、`--json`。命令不静默改写 TS 配置源(AST 改写不安全且有损)—— 输出供使用方 agent 审阅采纳,这正是握手错误(P0)所指向的命令。

  `normalizeStackInput` 新增可选 `convert: false`(仅做 map→array,不跑 D2 转换),供 `migrate meta` 对原始编写源重放链、把每处改写归因到对应链步。新增导出纯增量,无破坏性移除。

- 10e8983: ADR-0089: unify the conditional-visibility predicate under one canonical key, `visibleWhen`, across every layer (data field, view form section/field, page component). This aligns visibility with the existing `readonlyWhen` / `requiredWhen` family and the `conditionalRequired → requiredWhen` precedent.

  **Canonical key:** `visibleWhen` — a CEL predicate; the element is shown only when it is TRUE. The binding _root_ is still set by the layer: runtime record forms and pages bind `record` + `current_user` (pages also expose `page.<var>`); metadata-editing forms (`*.form.ts`) bind `data`.

  **Deprecated aliases (still accepted):** the view key `visibleOn` and the page key `visibility` are now `@deprecated`. Both are folded into `visibleWhen` **once, at the schema boundary** (a zod `.transform()`), so consumers only ever read `visibleWhen`. When both a canonical and an alias key are present, the canonical wins.

  Migration (L1 — no consumer action required; existing metadata keeps working):

  - View form section/field: `visibleOn: "<cel>"` → `visibleWhen: "<cel>"`
  - Page component: `visibility: "<cel>"` → `visibleWhen: "<cel>"`
  - Data field / field option: already `visibleWhen` — unchanged.

  Out of scope (unchanged): the boolean `visible` (Tab on/off), field `hidden`, gallery `visibleFields`, and unrelated `visibility` _enums_ (feed / package / environment / agent). Aliases remain for the standard deprecation window and are removed in a future major.

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

### Patch Changes

- 607aaf4: 导出文件名本地化 + 系统字段标签内置多语言回退。

  **`@objectstack/rest` — 导出下载文件名**:`GET /data/:object/export` 的 `Content-Disposition` 不再是裸的 `<对象名>.<扩展名>`,改为「对象显示名-时间戳」:ASCII 兜底用 API 名(`filename="contracts-20260714-153045.xlsx"`),本地化标签(如中文)按 RFC 5987/6266 编码进 `filename*=UTF-8''…`(浏览器直接下载得到 `合同-20260714-153045.xlsx`)。新增导出 `exportContentDisposition(objectName, label, ext, now?)`。

  **`@objectstack/spec` — 系统字段标签回退**:ObjectQL 注册表给每个对象注入的系统字段(`owner_id`/`created_at`/`created_by`/`updated_at`/`updated_by`)只带英文标签,自定义对象又没有对应的翻译条目,导致中文界面的列表表头、导出文件、导入模板里漏出 "Owner"/"Created At" 等英文。`translateObject` 现内置这五个字段的 en/zh-CN/ja-JP/es-ES 标签表(措辞与平台生成的翻译包一致),仅当字段仍是注入的英文默认值时套用——作者自定义的标签绝不覆盖;无翻译包时也生效(`translateObject` 不再因缺 bundle 而提前返回,REST 元数据翻译路径同步放宽,缓存 ETag 本就按 locale 分键,无缓存串味风险)。

  **`@objectstack/plugin-reports` — 附件文件名**:定时报表附件的文件名清洗从「非 ASCII 全部替换成 `_`」改为按 Unicode 字母/数字保留(`\p{L}\p{N}`),中文计划名不再变成一串下划线。

  **`@objectstack/rest` — 导入接受翻译后的选项标签(导出 ↔ 导入闭环)**:导出与导入模板写出的是*翻译后*的选项标签(如 `待规划`),但导入强制转换只认作者原始 schema 的标签/值,导致用户把自己刚导出的本地化文件原样导回时 select 字段全部报 `invalid_option`。`prepareImportRequest` 新增 `localizeSchema` 钩子(REST 导入路由传入 `translateMetaItem`),把当前 locale 的翻译标签合并进字段选项作为匹配同义词——作者标签与选项 code 照常匹配,非法值照常报错,翻译失败时降级为仅作者标签匹配。新增导出 `mergeLocalizedOptionSynonyms(metaMap, localizedMetaMap)`。

## 14.7.0

### Minor Changes

- d6a72eb: Field metadata gains a `widget` override (`FieldSchema.widget`) — names a
  registered form component (resolved as `field:<widget>`) to render a field with,
  overriding the default widget derived from `type` and degrading back to it when
  unregistered. The generic object form already honored this hint (objectui
  `ObjectForm`/`form.tsx` resolve `widget || type`); this promotes it to a
  first-class, liveness-classified authoring property so any config object can ask
  for a picker instead of a raw input.

  `sys_sharing_rule` uses it so the Setup **New Sharing Rule** form is
  pick-not-type instead of asking admins to hand-enter machine data:

  - `object_name` → `object-ref` (choose a registered object by name)
  - `criteria_json` → `filter-condition` (visual criteria builder scoped to the
    chosen object's fields; `dependsOn: object_name`)
  - `recipient_id` → `recipient-picker` (record picker whose target follows
    `recipient_type`; `dependsOn: recipient_type`)

  Also removes the `queue` recipient type: it is declared-but-unenforced (the
  evaluator expands no users for it), so offering it authored a silently-inert rule
  (ADR-0078). i18n bundles regenerated. Requires the matching objectui widgets; the
  fields degrade to their `type` renderer where those aren't loaded.

## 14.6.0

### Patch Changes

- 609cb13: **Action params gain a `visible` predicate; the create-user `phoneNumber` param is gated on `features.phoneNumber`.**

  `ActionParamSchema` gains an optional `visible` (CEL, `ExpressionInputSchema`) evaluated against the same scope as action `visible` (`current_user`/`app`/`data`/`features`); a UI that honors it omits the param when it's false. The `sys_user` `create_user` action's `phoneNumber` param now carries `visible: 'features.phoneNumber == true'`, so the form no longer offers a Phone Number field when the opt-in `phoneNumber` auth plugin is off — otherwise the endpoint rejects it with "Phone numbers require the phoneNumber auth plugin". Pairs with the objectui `ActionParamDialog` change that evaluates `param.visible`.

- ce6d151: fix(driver-sql): fail-loud on unknown filter operators; real IS NULL / IS NOT NULL; $not support (#2704)

  The SQL driver used to forward any filter operator it didn't recognise straight
  to Knex. On a null comparand that silently compiled to a whole-table match, so a
  permission/assignment-scoped list view could leak every row (e.g. an
  `is_null` / `is_empty` operator from the client). It also had no real
  null-check: `field = null` never renders `IS NULL` in SQL.

  This change makes the driver:

  - Render null predicates as real SQL — `is_null` / `isnull` / `is_empty`
    (and the not-null variants) → `IS NULL` / `IS NOT NULL`, unified with
    `equals` + null; `!= null` → `IS NOT NULL`.
  - Support the full spec operator set plus client alias spellings across both
    filter shapes (array `[field, op, value]` and object `{field: {$op: value}}`):
    `$between`, `$startsWith`, `$endsWith`, `$notContains`, `$null`, `$exists`,
    and the logical `$not` (a negated sub-condition, matching driver-mongodb /
    driver-memory — CEL `!expr` permission scopes compile to it).
  - LIKE-escape `contains` / `startsWith` / `endsWith` values with an explicit
    `ESCAPE '\'` so `%` / `_` in user input can't widen the match.
  - **Throw on a genuinely unknown operator** in both paths instead of silently
    passing it through — no more silent whole-table results.

  `@objectstack/spec` recognises the client alias operator spellings
  (`isnull` / `is_empty` / …) in `VALID_AST_OPERATORS` and maps them to `$null`
  so the array-AST → object-filter conversion is consistent with the driver.

## 14.5.0

### Minor Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

- d79ca07: ADR-0090 D10 — activate the agent principal (OAuth → `principalKind:'agent'` + scope-derived ceiling). This wires the _producer_ side of the D10 intersection that shipped in #2838, so it stops being dormant: an MCP request authenticated with an OAuth access token is now resolved as an AI **agent acting on behalf of** the human `sub`, and its effective permission is the intersection of a scope-derived capability ceiling AND the user's own grants.

  - **`resolve-execution-context` (producer)**: when a verified MCP OAuth token names an authorized client (`azp`), the request resolves to `principalKind:'agent'` with `onBehalfOf:{ userId }` (the human), and the agent's OWN grants are replaced by the scope-derived ceiling — `data:read` → read-only, `data:write` → full CRUD, neither → no data access. `userId` stays the human so owner-stamping and `current_user.*` RLS resolve to them; the user-derived `systemPermissions` are cleared so a cap-gated action can't ride the user's capabilities. A token without a client stays a `human` principal.
  - **`plugin-security`**: three built-in ceiling sets (`mcp_agent_data_read` / `mcp_agent_data_write` / `mcp_agent_restricted`) — pure CRUD bits, no row-level security (all row/owner/tenant narrowing comes from the delegating user on the other side of the intersection). An `agent` principal skips the additive human baseline (`member_default`) — its grants are exactly its ceiling — and its fallback is the restricted (no-object-access) set, so a mis-resolved agent fails CLOSED, never open.
  - **`spec`**: `MCP_AGENT_PERMISSION_SET_*` names + `scopesToAgentPermissionSets()`, single-sourced next to the OAuth scope constants.

  **Behaviour change (a security tightening).** Previously an MCP OAuth request executed with the FULL authority of the logged-in user, and scopes narrowed only the tool surface. Now the scope is also a real data-layer ceiling: a `data:read` token can never write ANY record, even via a crafted call, no matter what the user could do. This is strictly consistent with the existing contract that "a scope can never grant more than the user could do" — the intersection only ever narrows — and closes the gap where a compromised or confused agent could act with the user's full reach.

  Verified end-to-end: a `data:read` agent acting for a member who owns a record can read it but cannot edit or create; a `data:write` agent for the same user can. Producer mapping unit-tested in `@objectstack/runtime`; enforcement dogfooded against the served engine (`showcase-agent-scope-ceiling`).

- 33ebd34: ADR-0057 (#2834): `retention.onlyWhen` status predicate — mixed tables can scope the age reap.

  - **spec**: `lifecycle.retention.onlyWhen` — a row filter (per-field equality or `{ $in: [...] }`) the retention window applies to; rows outside it are retained regardless of age. Rejected when combined with rotation `storage` (shard DROPs ignore filters) or `archive` (the Archiver moves rows by age alone).
  - **objectql**: the LifecycleService Reaper merges `onlyWhen` into every retention delete, including tenant-override passes.
  - **service-automation**: the run-history age sweep is now declarative — `sys_automation_run` declares `retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } }` and the platform Reaper owns it; suspended (`paused`) runs never match. The plugin's own sweep loop is retired: `ObjectStoreSuspendedRunStore.pruneHistory`, the `DEFAULT_RUN_HISTORY_RETENTION_DAYS` export, and the `runHistoryRetentionDays` / `runHistorySweepMs` plugin options are removed (launch-window breaking-as-minor). The write-time per-flow overflow cap (`runHistoryMaxPerFlow`) stays.

- c044f08: **Security fix (Critical): the settings HTTP routes no longer trust spoofable identity headers, and writes are now capability-gated.**

  Previously `GET/PUT/POST /api/settings/*` derived the caller's identity from `x-user-id` / `x-tenant-id` / `x-permissions` request headers (the route default), and `setMany` performed **no permission check** — so on a standard `os serve --server` deployment (settings + HTTP server composed by default, routes registered on the raw app with no auth middleware) an **unauthenticated** remote client could write tenant- or platform-scoped settings (including the auth security-policy, localization, and company manifests) and enumerate every namespace.

  Fixes:

  - **Verified identity.** `SettingsServicePlugin` now derives the caller's identity and capabilities from the platform's verified resolution (`resolveAuthzContext` — session cookie / API key / OAuth), never from request headers. The route default is now SECURE: it trusts no identity header and yields an anonymous, denied context.
  - **Capability gates.** Manifest `readPermission` / `writePermission` are enforced for HTTP callers: reads of a protected namespace, writes, and actions require the declared capability (writes default to at least the read capability, never ungated). Enforced via a new `enforced` flag set only at the HTTP boundary — **in-process/boot callers (`kernel.getService('settings')`, seed) are unchanged** and keep full trusted access.
  - Unauthenticated HTTP callers can no longer enumerate protected manifests or write; a `403 SETTINGS_FORBIDDEN` is returned when the capability is missing.

  **`setup.write` capability now real.** Enforcing the manifests' declared `writePermission` surfaced a modeling gap: `setup.write` (the write counterpart to `setup.access`, used by the branding / company / localization / feature-flag manifests) was referenced but never declared or granted — so under enforcement _nobody_, not even an admin, could write those namespaces. It is now a declared platform capability (`PLATFORM_CAPABILITIES`) held by `admin_full_access` and `organization_admin`, alongside `setup.access`.

  **Behaviour change:** a deployment that relied on the old header-trusted default must present a real verified session/API-key/OAuth credential (which the console already does). A custom integration may still inject its own `contextFromRequest`.

  Found by an adversarial security review of the request→ExecutionContext trust boundary.

- 01274eb: **Security fix (#2851): the share-link HTTP routes no longer trust spoofable identity headers, and the service enforces ownership.**

  The raw-app share-link routes (`POST/GET/DELETE /api/v1/share-links`, registered by `SharingServicePlugin`) derived the caller from `x-user-id` / `x-tenant-id` request headers, and the service ignored the caller context on revoke. So a client could forge link attribution, enumerate another user's link tokens (`GET ?createdBy=<victim>` → tokens that resolve records under a system context, bypassing RLS), and revoke arbitrary users' links.

  Fixes:

  - **Verified identity.** `SharingServicePlugin` now derives the caller (and their positions/permissions) from the platform's verified resolution (`resolveAuthzContext` — session / API key / OAuth), never from headers. The route default is SECURE (anonymous). Create / list / revoke require a signed-in principal (401 otherwise); the public `/:token/resolve` route stays public (the token is the authorization) but keys its `audience: 'signed_in'` check off the verified session rather than a spoofable `x-user-id`.
  - **List scoping.** `GET /api/v1/share-links` is forced to the caller's own links — a client can no longer pass `?createdBy=<victim>` to enumerate others' tokens.
  - **Revoke ownership.** `revokeLink` now requires the caller to be the link's creator (system/internal callers bypass). Previously the caller context was ignored, so anyone could revoke any link (sharing DoS).
  - **Create access check.** `createLink` verifies the record is visible to the caller (read under the caller's own RLS) before minting a link — you can only share a record you can actually see. Internal (system) callers are unchanged.

  `ShareLinkExecutionContext` gains optional `positions` / `permissions` so the record-access check evaluates the real principal.

  Found by an adversarial security review of the request→ExecutionContext trust boundary (companion to the settings-routes fix, #2848).

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

- 82e745e: ADR-0091 L1 — grant validity windows: effective-dated assignments, resolution-time filtering, explain expired state, authoring lint.

  - **plugin-security (objects)**: `sys_user_position` and `sys_user_permission_set` gain the D1 lifecycle columns — `valid_from`, `valid_until` (half-open `[from, until)`, UTC; null = unbounded, existing rows unchanged), `reason`, `delegated_from`, `last_certified_at`, `certified_by`.
  - **core**: new shared predicate `isGrantActive` / `isGrantExpired` (`@objectstack/core`), and `resolveAuthzContext` now filters BOTH grant tables through it (D2, fail-closed — an expired unscoped `admin_full_access` grant no longer derives `platform_admin`). Present-but-unparseable bounds fail closed.
  - **plugin-security (explain)**: `buildContextForUser` applies the same filter and returns `expiredGrants`; the principal layer reports the dedicated "held until … — expired" contributor state so "why did access disappear" is self-answering. Spec `ExplainLayerSchema` contributors gain an optional `state: 'active' | 'expired'`.
  - **plugin-sharing**: `PositionGraphService.expandPositionUsers` filters expired holders — sharing-rule recipients stop including them at resolution time.
  - **lint (D7)**: two new error rules over seed data — `security-grant-expired-at-authoring` (a `valid_until` in the past, or unparseable, is a grant that can never resolve) and `security-delegation-missing-reason` (a `delegated_from` row without `reason` breaks the D3 dual audit). Also re-exported the missing `SECURITY_MASTER_DETAIL_UNGRANTED` constant.

  No background job is involved anywhere — per ADR-0049, an expired grant simply stops resolving, in every edition.

- f3035bd: ADR-0091 L2 — delegation of duty (职务代理): self-service, time-boxed position delegation without administration.

  - **spec**: `PositionSchema.delegatable` (default false) + the `sys_position.delegatable` field. A position opts in to being self-service delegated.
  - **plugin-security (D12 gate)**: a new self-service branch — a non-admin holder of a `delegatable` position may insert a `sys_user_position` row assigning it to a delegate, WITHOUT any `adminScope`, iff the row is a well-formed delegation: `delegated_from` = the writer (you delegate your OWN authority), a mandatory `valid_until` in the future and within the 30-day ceiling, a mandatory `reason`, and the writer holds the position **directly** (validity-filtered — a grant that itself arrived via delegation is not re-delegatable). Insert-only, so a delegation is not self-renewable. A `delegatable` position that distributes an `adminScope`-carrying set is rejected fail-closed — administration is never self-delegated (D12 containment). Dual audit: `granted_by` (writer) + `delegated_from` (authority source).
  - **plugin-security (explain)**: `buildContextForUser` surfaces delegation provenance; the principal layer attributes a delegated position "via delegation from X, until Y".
  - **liveness / proof (ADR-0054)**: `position.delegatable` is a bound high-risk class with an end-to-end dogfood proof (`delegation-of-duty`) — a gated delegation write over the real HTTP API, then the delegate's grant resolving in-window and dying at `valid_until` via the real resolver.

  Break-glass activation and recertification campaigns stay enterprise (D7); their community shapes are the L1 substrate.

### Patch Changes

- 82c0d94: Agent capability — open-edition honesty pass (docs + liveness annotation), no
  behavior change:

  - The `agent`/`skill`/`tool`/`action` liveness files cite
    `packages/services/service-ai/...` as evidence, but that tree is a stale,
    untracked build artifact — the real runtime is the closed cloud
    `@objectstack/service-ai`. Each file's `_note` now says so explicitly, so an
    auditor reading the ledger understands these props are `live` because a
    CLOUD/EE runtime consumes them and the OPEN framework edition does not.
  - Docs (`content/docs/ai`): removed the `aggregate_data` over-claim from
    Natural Language Queries — the open MCP surface registers 9 tools and
    `query_records` has no aggregation args; `aggregate_data` is a cloud data
    tool. And disambiguated the two things called "skill" (authoring `SKILL.md`
    modules vs. runtime `defineSkill` agent capability bundles) with cross-linked
    callouts on both pages.

- 7449476: Permission-zoo audit follow-ups:

  **FLS keys must be object-qualified (`security-fls-unqualified-key`, error).**
  The runtime evaluator matches field-permission keys by `<object>.<field>`
  prefix — a bare `budget` key matches NOTHING and the declared masking
  silently never enforces. The showcase itself shipped exactly that bug: its
  contributor FLS block (bare `budget`/`spent`/`budget_remaining`) was a
  runtime no-op, and the "FLS proof" in earlier verification was actually a
  validation-rule rejection. Fixed: keys qualified
  (`showcase_project.budget` …), a new D7 lint rule rejects bare keys at
  compile time with a fix-it, and the permission-zoo dogfood now proves the
  served pipeline denies a contributor's budget write while allowing ordinary
  field edits.

  **Release pipeline: PROTOCOL_VERSION auto-sync.** `changeset version` now
  runs `scripts/sync-protocol-version.mjs`, regenerating the handshake
  constant from the spec package major. Release PRs opened by
  changesets/action with the default GITHUB_TOKEN never trigger CI (GitHub's
  anti-recursion rule), so the lockstep guard could only fire AFTER a release
  merged — the drift class that broke main at 14.0.0 (#2769) is now fixed at
  version time, the one spot that cannot be skipped.

  **D11 `externalSharingModel` honestly marked.** The dial has no runtime
  consumer yet (authoring lint + Studio badges only); its liveness entry
  moves from a bespoke `authorable` status to the documented `planned` +
  `authorWarn`, and the sharing docs / design doc / showcase comments now say
  explicitly that evaluation of external principals lands with the
  principal-taxonomy phase (#2696).

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

## 14.2.0

### Minor Changes

- ac8f029: Two ADR-0090 D5 closures (#2752, #2753):

  **`GET /me/apps` sources the engine registry.** Stack apps are registered
  into the engine registry (runtime AppPlugin), not the metadata service —
  `metadata.list('app')` returned `[]` for every principal, leaving
  `tabPermissions` and `AppSchema.requiredPermissions` with no enforced
  consumer. The endpoint now reads `registry.getAllApps()` (same authority as
  the meta routes, nav contributions merged) with the metadata service as an
  additive fallback; the capability and tab filters are unchanged and now
  actually run.

  **The default baseline binds to the `everyone` anchor.** `member_default`
  carried `allowDelete` on its `'*'` grant — an anchor-forbidden bit — so
  bootstrap refused the `everyone` binding on every boot and the baseline
  flowed only through the separate fallback channel D5 explicitly rejected.
  Two aligned changes:

  - `describeHighPrivilegeBits` (spec) is calibrated to the exact ADR-0090 D5
    bit list (VAMA, delete/purge/transfer, systemPermissions). A plain `'*'`
    wildcard is no longer high-privilege by itself; the wildcard ban moves to
    the GUEST tier where D9 specifies it (`describeAnchorForbiddenBits`).
  - `member_default` drops `allowDelete` from the wildcard. **Behavior
    change:** deleting records is no longer a baseline right — members keep
    create/read/edit-own; domains that want member deletes grant them per
    object via an ordinary position-distributed set. The owner-scoped delete
    RLS stays as a narrowing defense for members who receive a delete bit
    elsewhere.

  With the baseline anchor-safe, bootstrap's existing binding path succeeds:
  "what new users get" is now literally "what is bound to `everyone`" — same
  table, same audit, same explain path (proven by the new
  `me-apps-and-everyone-baseline` dogfood).

- 4ab9958: Position assignment panels as pure SDUI (ADR-0090 follow-through).

  - `RecordRelatedListProps` gains `relationshipValueField` (default `'id'`): which parent-record field the junction's `relationshipField` stores — the generic affordance for name-keyed junctions (`sys_user_position.position` stores `sys_position.name`). Used for both the list filter and the Add-picker's parent-side value.
  - `sys_user` detail page gains a **Positions** tab (assign positions to a user; Add picker stores the position machine name via `valueField: 'name'`; the D12 delegated-admin gate's denials surface in the dialog).
  - New `sys_position` detail page (shipped by plugin-security): **Holders** (name-keyed via `relationshipValueField: 'name'`) and **Permission Sets** (bindings) tabs — zero bespoke UI; ADR-0091 validity columns slot in later as plain column additions.

  Renderer note: the generic `record:related_list` Add-picker and `relationshipValueField` support land in objectui alongside the ^14 alignment; with older renderers these tabs degrade to read-only lists.

## 14.1.0

### Patch Changes

- 5a8465f: SLA escalation `escalateTo` is position-first (ADR-0090 D3 follow-up to the `position` approver type).

  - **spec**: `ApprovalEscalationSchema.escalateTo` is documented as a position machine name or a
    specific user id (was "User id, role, or manager level" — the same pre-D3 'role' trap the
    `position` approver type fixed); the Studio xRef picker kind moves `role` → `position`.
  - **plugin-approvals**: on escalation, `escalateTo` now expands position holders via
    `sys_user_position` ∪ the `sys_member.role` transition source (ADR-0057 D4) for both the
    `reassign` approver hand-off and the `notify` audience. An empty expansion falls back to
    treating the value as a literal user id, so configs naming a specific user keep working
    unchanged. The audit trail keeps the authored target.
  - **lint**: new `approval-escalation-reassign-no-target` warning — `escalation.action: 'reassign'`
    with no `escalateTo` silently degrades to a notify at runtime; the fix-it prescribes a position
    or user id target (or `action: 'notify'`).

- 7f8620b: Sync `PROTOCOL_VERSION` to `14.0.0` — the 14.0.0 release bumped `package.json` but the handshake constant still said 13, so `protocol-version.test.ts` failed on main for every PR. (Process note: the changesets Version PR cannot bump source constants; the protocol bump must accompany each major.)
- 82ba3a6: docs(liveness): record the tenancy.strategy / crossTenantAccess removal decision (#2763)

  Owner decision 2026-07-10: the platform has exactly two multi-tenancy
  modes — per-tenant database (environment-level, zero object config) and
  shared-DB organization row isolation (`tenancy.enabled` + `tenantField`).
  Object-level isolation strategy has no requirement, so `strategy` and
  `crossTenantAccess` are slated for removal at the next spec major.
  Ledger notes + compile-time authorHints now state the decision and point
  authors at the two real mechanisms.

## 14.0.0

### Major Changes

- 80f12ca: `BookAudience` gated arm renamed: `{ profile: string }` → `{ permissionSet: string }`.

  ADR-0090 D2 removed the Profile concept, but `book.audience` (ADR-0046 §6.7)
  still modelled its gated arm as a profile reference. Books ship in packages,
  and packages own permission sets but never positions (ADR-0090 D9), so the
  gate is a capability reference — a permission-set name the reader must hold,
  e.g. `{ permissionSet: 'crm_admin' }`. Pre-launch one-step rename, no alias:
  the zod union now rejects `{ profile }` at parse time. `'org'` and `'public'`
  literals are unchanged (`'public'` ≡ the built-in `guest` position, D9).

### Minor Changes

- 0a8e685: ADR-0090 permission-model zoo + docs alignment.

  **Showcase (`@objectstack/example-showcase`)** now exercises the full Permission
  Model v2 authoring surface and is guarded by a new runtime dogfood test
  (`showcase-permission-zoo.dogfood.test.ts`): typed `definePosition`/
  `definePermissionSet`/`defineSharingRule` factories; six flat positions (the
  stale pre-D3 `parent` fields are gone); permission sets covering CRUD+FLS+RLS,
  org-depth read/write asymmetry (`readScope: 'org'` / `writeScope: 'own'`),
  View-All (auditor) and Modify-All (ops) bypasses, `systemPermissions`
  (`setup.access`), the `isDefault` everyone-suggestion (incl. personal-data
  grants on the `private`-OWD note object), a guest-safe set for the `guest`
  anchor (D9), and a delegated-administration `adminScope` bounded to a seeded
  `sys_business_unit` subtree (D12). Objects gain `externalSharingModel` dials
  (D11). A committed `access-matrix.json` opts the showcase into the D6 snapshot
  gate. Hierarchy depths (`own_and_reports`/`unit`/`unit_and_below`) are
  deliberately NOT authored — they are enterprise (`hierarchy-security`) and the
  open runtime fails closed; BU-shaped visibility is demonstrated via the
  enforced `unit_and_subordinates` sharing-rule recipient instead.

  **`@objectstack/spec`**: `defineStack` strict cross-reference validation no
  longer rejects permission grants or seed datasets that target platform-provided
  objects (`sys_`/`cloud_`/`ai_` prefixes) — a delegated-admin set carrying CRUD
  on the RBAC link tables (ADR-0090 D12) and an app seeding the business-unit
  tree are legitimate shapes; the typo net stays intact for the stack's own
  objects. Stale pre-ADR-0090 vocabulary in zod docstrings (rls/territory/
  sharing/tool/agent) is rewritten; the auto-generated references (including the
  previously missing `security/explain.mdx`) are regenerated.

  **Docs**: `protocol/objectql/security.mdx` rewritten to the v2 model (no
  profiles, positions, canonical OWD four + D1 private default +
  `externalSharingModel`, position-scoped RLS, enforced sharing recipients);
  `isProfile` scrubbed from every authoring example; the dead
  `/docs/references/identity/role` link fixed; implementation-status and
  plugin READMEs aligned. Remaining rename misses are tracked in #2722
  (RLSUserContext.role), #2723 (portal `profiles`), #2724 (sys_record_share
  `role` enum).

- afa8115: ADR-0090 vocabulary leftovers (#2722, #2723, #2724) — the last "role"/"profile"
  surfaces are renamed one-step, no aliases (launch-window discipline).

  **`PortalSchema.profiles` → `positions`** (#2723, D2 removal miss). FROM → TO:
  `profiles: ['client_portal_user']` → `positions: ['client_portal_user']` —
  portal admission is now position-scoped; use the built-in `guest` position
  for anonymous-only portals. The removed `profiles` key is a loud tombstone:
  authoring it fails with the prescription instead of silently stripping. The
  showcase Client Portal is migrated and now admits a real declared position
  (`client_portal_user`).

  **`RLSUserContextSchema.role` → `positions`** (#2722, D3 rename miss). FROM →
  TO: `role: string | string[]` → `positions: string[]` — matches the runtime
  shape the RLS compiler resolves as `current_user.positions`. No runtime
  consumer read the old field (the compiler has its own context type); public
  export names are unchanged.

  **`sys_record_share.recipient_type` `'role'` → `'position'`** (#2724, D3).
  The record-share enum and the `ShareRecipientType` contract type now match
  the already-migrated spec zod enum. No stored-data migration is required:
  no reader expands non-`user` record-share rows (rules materialize per-user
  grants), so legacy `'role'` rows were inert. The plugin-sharing translation
  bundles are regenerated — fixing the pre-stale `sys_sharing_rule` options
  block too — with zh-CN/ja-JP labels patched per the generated-file contract
  (业务单元及下级 / ビジネスユニットと下位階層).

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

- 216fa9a: Add a `position` approver type so approvals can route to org positions (ADR-0090 D3 fallout).

  Post ADR-0090 D3 the `role` approver type resolves against the better-auth org-membership
  tier (`sys_member.role`: `owner`/`admin`/`member`) — it was never a position. Downstream
  apps that authored `{ type: 'role', value: 'sales_manager' }` silently routed approvals to
  nobody. Now:

  - **spec**: `ApproverType` gains `'position'` — `value` is the position machine name; the
    approver expands to its holders via `sys_user_position`. Authoring guidance: keep
    `type: 'role'` ONLY for membership tiers; for org positions use
    `{ type: 'position', value: '<position_name>' }` (one-line fix for the mismatch above).
  - **plugin-approvals**: the engine resolves `position` approvers via `sys_user_position` ∪
    the `sys_member.role` transition source (same semantics as `PositionGraphService` in
    plugin-sharing). The `department` approver type is now honored by its spec spelling
    (previously only the off-spec `business_unit`/`bu` dialect matched).
  - **lint**: new `validateApprovalApprovers` rule — `approval-role-not-membership-tier`
    warns when a `role` approver's value is not a membership tier and prescribes the
    `position` rewrite; `approval-approver-type-unknown` flags off-spec approver types
    (with a `business_unit` → `department` fix-it). Wired into `os lint`.

### Patch Changes

- 29f017d: chore(liveness): authorWarn sweep across all governed types + lint coverage to match

  Every remaining _misleading_ dead property now warns at compile time (12 new
  markings): `flow.errorHandling.fallbackNodeId` (engine uses fault edges),
  `flow.nodes[].outputSchema` (never validated), `flow.template`,
  `action.timeout` (no runtime enforcement), `object.tenancy.strategy` /
  `crossTenantAccess` (only enabled+tenantField are read), `object.abstract`,
  `field.dependencies`, `agent.tenantId`, `tool.permissions` (invocation not
  permission-gated), `permission.contextVariables` (RLS reads current_user.\*
  only), `dataset.measures[].certified` (governance flag unenforced).

  The compile-time lint previously only checked objects+fields, so markings on
  other types were silent — it now covers every governed type (flat stack
  collections) and fans container checks out over arrays (one finding per
  item+path). Benign display metadata (label/description/tags) stays unmarked
  per the README's signal rules.

  Also re-anchors the README: the counts table had drifted badly (field listed
  as 34 live/39 dead vs the ledger's actual 54/6; `action.disabled` was still
  described as ignored though it went live via metadata-admin) — replaced with
  regenerable numbers plus the script to regenerate them, and added the
  cross-repo evidence rule (grep ../objectui before classifying dead — the
  enable.trackHistory lesson, #2707).

- 6c22b12: fix(spec): bump PROTOCOL_VERSION 12.0.0 → 13.0.0 to match the spec major

  The version-packages roll (#2720) took `@objectstack/spec` to major `13.0.0`
  but left `PROTOCOL_VERSION` at `12.0.0`, so `protocol-version.test.ts` (the
  lockstep guard that asserts the protocol major equals the package major) failed
  on `main` — reddening Test Core for every PR. Restore the lockstep so the
  loader/installer handshake advertises the major the package actually ships.

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

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

- a5a1e41: ADR-0090 P4 — explain engine (D6), access-matrix snapshot gate, recalibrated benchmark.

  **Explain contract (@objectstack/spec).** `ExplainRequestSchema` / `ExplainDecisionSchema` / `ExplainLayerSchema`: `explain(principal, object, operation)` reports the verdict of every evaluation-pipeline layer in order (principal → required_permissions → object_crud → fls → owd_baseline → depth → sharing → vama_bypass → rls), with per-layer contributor attribution (which permission set, reached via which position/baseline) and — for reads — the composed row filter as the machine artifact. Carries the D10 dual attribution (`principalKind`, `onBehalfOf`).

  **Explain engine (@objectstack/plugin-security).** `explainAccess` is "explained by construction": it calls the SAME permission-set resolution, evaluator, FLS mask, and RLS composition the enforcement middleware calls (injected from `SecurityPlugin`), so the report cannot drift from enforcement. Exposed on the `security` kernel service as `explain(request, callerContext)`; explaining another user requires `manage_users` (the target's context is reconstructed from `sys_user_position` / `sys_user_permission_set` with everyone-anchor semantics via `buildContextForUser`).

  **Access-matrix snapshot gate (@objectstack/lint + os compile).** `buildAccessMatrix(stack)` derives the (permission set × object) capability matrix purely from metadata; `diffAccessMatrix` renders semantic review lines ("'crm_admin' gains delete on 'crm_lead'", depth changes, OWD swings, entry add/remove). `os compile` gains an opt-in gate: with `access-matrix.json` committed next to the config, any drift fails the build with those lines until re-snapshotted via `--update-access-matrix` — every capability change becomes a reviewable diff. Seeded for `examples/app-crm`.

  **Benchmark (ADR-0090 Addendum).** `scripts/bench/permission-bench.mts` — single-org 10k users × 1M rows per the recalibrated topology; asserts the O()-shape property (per-request cost independent of user population; unit-depth IN-set cost tracks unit size). Passing at 0.1µs/eval and 59ms/1M-row IN-set scan.

- 466adf6: Author-time capability-reference lint (ADR-0066 ⑨) — `os validate` / `os lint`
  now warn when a `requiredPermissions` names a capability that is registered
  nowhere.

  `requiredPermissions` (on objects, fields, apps, actions) is a free string, so a
  typo like `mange_users` is schema-valid and fails closed at runtime (the caller
  is denied) — safe, but silent. The new `validateCapabilityReferences` rule
  (`@objectstack/lint`) resolves every reference against the author-time known set
  and warns on the unresolved ones:

  - built-in platform capabilities — now sourced from a single canonical list in
    `@objectstack/spec` (`security/capabilities.ts`: `PLATFORM_CAPABILITIES` /
    `PLATFORM_CAPABILITY_NAMES`), which `@objectstack/plugin-security`'s
    `bootstrapSystemCapabilities` also seeds from (one source of truth, no drift),
  - any capability a permission set in the stack grants via `systemPermissions`
    (granting is what declares it — mirrors the runtime derived-defaults rule), and
  - any `sys_capability` row shipped as seed data.

  It is a **warning**, not an error: a single package can't see capabilities
  declared by other installed packages, and the reference fails closed anyway.
  `systemPermissions` itself is never flagged — it is the declaration side, and a
  package legitimately introduces new capabilities there. The object case also
  understands the per-operation `requiredPermissions` map form (ADR-0066 ⑤) and
  points a finding at the exact operation slice.

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

- 466adf6: Per-operation object `requiredPermissions` (ADR-0066 ⑤) — an object can now be
  read-open / write-gated instead of gating all of CRUD on one capability set.

  `Object.requiredPermissions` accepts either the original `string[]` (capabilities
  required for **all** operations) **or** a `{ read?, create?, update?, delete? }`
  map that gates each operation class independently — mirroring how Salesforce and
  Dataverse separate capability by operation. plugin-security enforces the caps for
  the request's operation class as the same D3 AND-gate (checked before the CRUD
  grant, fail-closed). The mapping folds `transfer`/`restore` into `update` and
  `purge` into `delete`, derived from the existing CRUD permission bits so it stays
  in lockstep with them.

  Backward-compatible: the `string[]` form keeps its gate-every-operation semantics
  (normalized into an `all` bucket that unions with the per-operation bucket), so
  existing objects are unaffected. The per-operation map's keys are validated
  `.strict()`, so a mistyped key (e.g. `reads`) is rejected at author time rather
  than silently ignored.

- 2bee609: BREAKING (pre-launch): remove the three declared-but-never-enforced compliance
  subsystems per ADR-0056 D8 ("design + enforce, or remove"), and mark the AI
  agent `visibility` property EXPERIMENTAL (#1901).

  Removed — none of these were read by any runtime path, and compliance-grade
  configuration must never merely look live:

  - `ComplianceConfigSchema` / `GDPRConfigSchema` / `HIPAAConfigSchema` (and the
    rest of `system/compliance.zod.ts`) — there is no data-subject-rights engine,
    retention enforcer, or BAA gate. FROM `import { ComplianceConfigSchema } from
'@objectstack/spec/system'` TO: delete the reference — a real compliance
    subsystem will be designed top-down when scheduled.
  - `MaskingConfigSchema` / `MaskingRuleSchema` (`system/masking.zod.ts`) — no
    redaction layer applies them. FROM masking config TO: field-level security
    (permission-set field rules, enforced by plugin-security's field masker); a
    subtractive masking/deny layer arrives with ADR-0066 ⑦/⑧ if needed.
  - `RLSConfigSchema` / `RLSAuditEventSchema` / `RLSAuditConfigSchema`
    (`security/rls.zod.ts`) — the enforced RLS path never read the global config.
    FROM global `RLSConfig` TO: per-policy `RowLevelSecurityPolicySchema` (the
    live, enforced surface — unchanged).

  Kept, still `[EXPERIMENTAL]`: `EncryptionConfigSchema` (at-rest field
  encryption) — a real enterprise roadmap item with a stable shape; carrying it
  marked costs less than remove-and-re-add (ADR-0087).

  Marked `[EXPERIMENTAL — NOT ENFORCED]` (#1901): `AgentSchema.visibility` — the
  chat-access evaluator deliberately excludes it and the agent list route does
  not filter by it, so `private` does not hide an agent. The schema description
  and the authoring form now say so; use `access` / `permissions` (both enforced
  at the chat route since #1884) for real gating. The ADR-0056 D10 conformance
  matrix tracks all dispositions (`agent-visibility` experimental;
  `compliance-configs` / `data-masking` / `rls-config-global` removed).

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

## 12.6.0

### Minor Changes

- 6cebf22: `Action`: add an explicit `order` field so authors and plugins can decide which action holds the record-header primary-button slot, instead of depending on fragile cross-file `defineStack({ actions })` registration order (#2670).

  `order` is an optional number, **lower = higher / more prominent**, defaulting to `0`. `mergeActionsIntoObjects()` now stable-sorts every action group — each object's `actions` and the top-level `actions` — by `order` at both `defineStack()` and `composeStacks()` time. In `record_header` the first visible action becomes the primary button, so a negative `order` promotes an action into the primary slot and a positive `order` demotes it toward the `⋯` overflow menu. This is the declarative lever a plugin such as plugin-approvals uses to make an `Approve`/`Reject` decision stably outrank app actions, rather than hiding the other actions to "make room".

  Fully backward compatible: the sort is stable and treats unset `order` as `0`, so action groups where nobody sets `order` keep their exact registration order (and array reference). The record-header renderer (objectui) may additionally prefer a `variant: 'primary'` action when two actions tie on `order`.

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

## 12.4.0

### Minor Changes

- 60dc3ba: ADR-0087 P0 — enforce the protocol version handshake (make `engines.protocol` real).

  `PluginEnginesSchema.protocol` (ADR-0025 §3.2, protocol-first per §3.10 #3) was declared, documented, and checked by no loader or installer — an ADR-0078 "declarable-but-inert" violation. A package built against an incompatible protocol major failed deep in a schema `.parse()` or a renderer contract instead of at the boundary.

  - **`@objectstack/spec`**: exports `PROTOCOL_VERSION` / `PROTOCOL_MAJOR` (`kernel`) — the single source of truth the handshake checks against. A drift test keeps it in lockstep with the package major.
  - **`@objectstack/metadata-core`**: adds `checkProtocolCompat()` (pure, major-grained range check), `assertProtocolCompat()`, and the structured `ProtocolIncompatibleError` (`OS_PROTOCOL_INCOMPATIBLE`, carrying both versions and the `objectstack migrate meta --from N` command). It refuses only on a _positive_ mismatch determination; absent ranges are grandfathered (warn) and unrecognized ranges never cause a false rejection.
  - **`@objectstack/metadata-protocol`**: `installPackage` runs the handshake before writing to the registry — an incompatible package is refused with a machine-actionable diagnostic instead of crashing later.

  Additive and backward compatible: packages that declare no `engines.protocol` range keep loading (with a warning). Part of the ADR-0087 epic (#2643); resolves #2644.

## 12.3.0

### Minor Changes

- e7eceec: Add `SelectOption.visibleWhen` — a per-option CEL visibility predicate for
  `select`/`multiselect`/`radio` fields. The option is offered only when the
  predicate is TRUE, evaluated against the live record + `current_user` (same
  binding environment as a field-level `visibleWhen`). This expresses cascading /
  dependent options (`record.country == 'cn'`) and role/context gating
  (`'admin' in current_user.roles`) without a bespoke dependent-picklist matrix.

  `Field.dependsOn`'s description is generalized to be mechanism-neutral: it
  declares the sibling field(s) a field's available values depend on (gating +
  re-evaluation), for both lookups (candidate query scoping) and selects
  (per-option `visibleWhen` gating). The `{field,param}` form remains lookup-only.

  Serializable and shared by `Field.options` and view `FormField.options`.
  Client-side hiding is UX only — authorization-gated option values must also be
  rejected server-side by the rule-validator.

## 12.2.0

### Minor Changes

- fce8ff4: feat(rest,spec): named import mappings (#2611) — `POST /data/:object/import` accepts `mappingName`, resolving a registered `defineMapping` artifact (stack `mappings:`) and applying its fieldMapping pipeline (rename + constant/map/split/join; lookup delegates to the built-in reference resolution) as a strict projection before coercion. The artifact's `mode`/`upsertKey` serve as writeMode/matchFields defaults; explicit request values win. Errors are loud and specific: `MAPPING_NOT_FOUND`, `MAPPING_TARGET_MISMATCH`, `MAPPING_FORMAT_MISMATCH`, `CONFLICTING_MAPPING` (mutually exclusive with the inline rename), and `UNSUPPORTED_TRANSFORM` for `javascript` (no server-side sandbox — never silently skipped). `defineStack` cross-reference validation now rejects mappings targeting undefined objects and `javascript` transforms at build time.
- 3962023: feat(spec,security): make ambiguous nav landings unrepresentable + close the field-permission filter oracle (objectui#2251, objectui ADR-0055).

  **spec — `ObjectNavItem` target exclusivity.** `NavigationItemSchema` now rejects an object nav item that combines `filters` with `recordId` or `viewName` (custom issue on `filters` with the fix in the message). Runtime precedence would silently ignore the extras — a stale `recordId` hijacking a configured `filters` slice — so the ambiguous combination is now unwritable (ADR-0053 correct-by-construction). FROM `{ filters, viewName }` / `{ filters, recordId }` TO exactly one landing field; the legacy `recordId` + `viewName` combination stays tolerated (documented: `viewName` is ignored). `filters` shipped in the same unreleased minor, so no released metadata is affected.

  **plugin-security — field-level predicate guard.** `FieldMasker` strips non-readable fields from RESULTS, but predicates still leaked their values: filtering / sorting / grouping / aggregating by a hidden field changes row presence (a filter oracle — probe `salary >= X` even though the column is masked). The security middleware now rejects (403 `PermissionDeniedError`, `reason: 'field_predicate_denied'`) any caller query whose `where` / `orderBy` / `groupBy` / `having` / `aggregations` / `windowFunctions` reference a field the caller cannot read — evaluated against the caller's AST **before** RLS injection, so RLS policies may keep referencing hidden fields (e.g. `owner_id`). Rejection over silent predicate dropping: removing an `$and` branch widens results and re-opens the oracle. New exports: `assertReadableQueryFields`, `collectQueryFields`, `collectConditionFields`.

- 2bb193d: feat(spec): `ObjectNavItem.filters` — declarative URL filter conditions targeting the parameterized bare data surface (objectui ADR-0055, objectui#2251).

  An object nav item can now carry `filters: Record<string, string>` (equality semantics). The shell resolves such an entry to `/:objectName/data?filter[<field>]=<value>` — an unanchored data surface with removable filter chips — instead of a saved list view. Use it for one-off / parameterized slices (dashboard drill-throughs, "assigned to me" links); slices worth curating stay on `viewName`. Values support the same `{current_user_id}` / `{current_org_id}` template variables as `recordId`. Target precedence within `type: 'object'`: `recordId` → `filters` → `viewName`. Purely additive — items without `filters` are unaffected.

- 0426d27: feat(spec): `deriveRecordFlowSurface(def, flow, opts)` — flow-aware record-surface derivation (#2604, extends #2578's `deriveRecordSurface`, ADR-0085 §5 one-shared-derivation).

  Decides the default surface per record FLOW: `view` keeps the shipped behavior verbatim (field-heavy → `route`/page, light → drawer overlay); the task flows (`create` / `edit` / `child-create` / `child-edit`) are ALWAYS overlays — never routes — with the derived `'page'` mapped to a full-screen modal (`size: 'full'`) and light objects staying a drawer. `child-*` flows take the CHILD object's def (the overlay sizes to the record being edited; the return target is always the parent detail). Mobile task flows are full-screen modals.

  Rationale: viewing a record is shareable state (deep-link belongs there); making/changing one is a transient task whose URL is a false promise (refresh loses the draft) and whose invariant is lossless return to the origin. Renderers treat the result as the DEFAULT only — explicit `navigation.mode`/`size`, `FormView.type`/`modalSize`, or an assigned page still win. No new authorable key (ADR-0085 §2). Additive, no breaking changes.

- da807f7: feat(spec)!: retire the placeholder metadata kinds `trigger`, `router`, `function`, `service` (ADR-0088).

  The registry is the contract authors — human and AI — read to learn what can be authored, and these four kinds had no authoring surface, no loader, no schema, and no (or a dead) consumer. `MetadataTypeSchema` + `DEFAULT_METADATA_TYPE_REGISTRY` shrink 30 → 26; `OPS_FILE_SUFFIX_REGEX` drops the four suffixes; the dormant objectql load path that registered QL functions from `type: 'function'` metadata items is removed (`defineStack({ functions })` / plugin `contributes.functions` remain the delivered forms); the metadata-core lockstep enum follows. `external_catalog` stays and is now annotated RUNTIME-CREATED (ADR-0062): its lack of an authoring surface is correct design. The delivered replacements: `hook` / `record_change` flows (trigger), plugin `contributes.routes` + declarative `apis:` (router), `defineStack({ functions })` (function), the plugin/service registry (service). Persisted `sys_metadata` rows are unaffected — no production read path re-parses stored `type` values through the enum.

## 12.1.0

### Patch Changes

- 93e6d02: Docs: correct the `Field.relatedList` JSDoc + `.describe()` to match the shipped behavior (#2579 follow-up). Non-primary related lists stack under a single shared "Related" tab and only `'primary'` earns its own tab — there is no count-based auto-split (the "count-aware" wording was a stale draft). Comment/description only; no code or behavior change.

## 12.0.0

### Major Changes

- 7c09621: feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

  **BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
  (`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
  `RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
  the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
  deployment explicitly opts out. (Scope note: this gate covers the REST
  `/data/*` surface — the metadata read/write endpoints and the dispatcher
  GraphQL route have their own pre-existing anonymous posture, tracked
  separately; this flip does not change them.)

  **Migration (one line):** a deployment that intentionally serves data publicly
  (demo / playground / kiosk) sets the flag on the stack config — now a declared
  `ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
  parsing (previously an undeclared top-level `api` key was silently stripped):

  ```ts
  export default defineStack({
    // …
    api: { requireAuth: false },
  });
  ```

  The REST plugin logs a boot warning for the explicit opt-out so a fail-open
  posture is always visible. A misplaced `api.requireAuth` at the plugin level
  (one nesting short) is now also called out with a boot warning instead of
  being silently ignored.

  **What keeps working with no action:**

  - **Share links** — validate their token, then read under a system context.
  - **Public forms** — self-authorizing via the declaration-derived
    `publicFormGrant` (create + read-back on the declared target object only);
    no `guest_portal` profile needed.
  - **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
  - **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
    `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
    authenticate against them), with the boot warning.

### Minor Changes

- a8df396: feat(spec,lint): adaptive record surface + semantic field `span` for field-heavy objects (#2578)

  Field-heavy objects need two things the protocol did not express well: multi-column
  forms, and opening create/edit/detail as a full page rather than a cramped popup —
  for _some_ objects, automatically. Because all metadata is AI-authored, the design
  goal is to make AI unable to get it wrong, which reshaped both features away from
  new authored keys.

  **`deriveRecordSurface` (new spec derivation, ADR-0085 §5).** A record's default
  surface — full `page` vs `drawer`/`modal` overlay — is _derived_ from how heavy the
  record is (visible, non-system field count; mobile always pages), not authored. Per
  ADR-0085 §2's admission test a `recordSurface` object key would fail: field count is
  exactly the kind of fact a machine can infer, and modal-vs-page is pure
  re-arrangement, not a business fact. So there is **no new object key** and **no new
  ADR** — just a single shared derivation renderers consume as a default (an explicit
  form/navigation config still wins), plus a one-line clarification to ADR-0085 §2's
  rejected-keys list so `recordSurface` is not re-proposed. Explicit per-object control
  remains the sanctioned assigned-page path.

  **`FormField.span: 'auto' | 'full'` (new, replaces absolute `colSpan` as the
  primary primitive).** Under a per-surface derived column count (mobile 1 / modal 2 /
  page 3-4) an absolute `colSpan: 3` only lines up at the one width the author
  imagined — fragile by construction. The relative `span` is decoupled from the column
  count: `auto` (default; omit it) sizes by widget type × current columns, `full` takes
  the whole row at any count. `colSpan` is retained for back-compat and clamped by the
  renderer; `half` was considered and deferred (weakest AI-safety). The rationale lives
  here rather than in a new ADR, per the fewer-ADRs convention.

  **`validateFormLayout` (new lint, ADR-0078/0019).** Two advisory rules over authored
  form views: `form-field-unknown` (a section references a field not on the bound
  object — silently never renders) and `absolute-colspan-discouraged` (steers authors
  to `span: 'full'`). Both warnings, with fix hints, held to the same bar for AI and
  hand authors.

  **`NavigationConfig.size` (new) replaces pixel `width`.** A T-shirt bucket
  (`auto`/sm/md/lg/xl/full, default `auto`, aligned with `FormView.modalSize`) for a
  drawer/modal detail overlay. `width`/`drawerWidth` (pixel) are deprecated: a pixel
  width cannot be authored blind — the author (often an AI) does not know the client
  viewport. `auto` means the renderer derives the size from field count and clamps to
  the viewport, so AI writes nothing.

  All additive: no exports removed, no behavior change for existing metadata.

- e695fe0: feat(spec,lint): reject userFilters on object list views (ADR-0053 phase 4)

  ADR-0053 reserves `userFilters`/`quickFilters` for page lists ("filters" mode);
  on an object list view ("views" mode — where the `ViewTabBar` is the only nav
  control) they are silently dropped. This lands the phase-4 guardrail as a
  layered defence, so the wrong-context authoring mistake is caught without
  breaking existing metadata:

  - **Type-level (author time):** new `ObjectListViewSchema` = `ListViewSchema`
    minus `userFilters`. Object built-in `listViews` and `defineView`
    `list`/`listViews` now use it, so `userFilters` on an object list view is a
    `tsc` error. The full `ListViewSchema` (page "filters" mode) is untouched.
  - **Runtime (back-compat):** the field is STRIPPED at parse (default strip, no
    throw), so existing metadata keeps loading — `ObjectSchema.parse` never fails
    on a stray `userFilters`.
  - **Author/CI (actionable):** new `@objectstack/lint` rule
    `validateListViewMode`, wired into `os validate`, reports the wrong-context
    field PRE-parse (before the schema strips it) with a fix hint.

  Closes the schema half of objectui #2219; supersedes the interim runtime warn in
  objectui #2220.

- 7709db4: feat(security): permission-set package provenance + declared-permission seeding (ADR-0086 P1)

  Packages now ship working default access for their own objects, with a
  machine-checkable metadata↔config boundary:

  - **Spec (ADR-0086 D3)**: `PermissionSetSchema.packageId` (owning package for
    a package-shipped set; absent = env-authored) and per-record provenance
    `managedBy: 'package' | 'platform' | 'user'` on the existing
    metadata-persistence axis. Persisted on `sys_permission_set` as
    `package_id` / `managed_by` (new columns + `package_id` index).
  - **Seeding (ADR-0086 D5)**: new `bootstrapDeclaredPermissions` — the sibling
    of `bootstrapDeclaredRoles` — materializes `stack.permissions` into
    `sys_permission_set` at boot with `managed_by:'package'` + `package_id`.
    Idempotent and upgrade-aware: rows the seeder owns are re-seeded to the
    shipped declaration on every boot; rows owned by a different package are
    refused loudly; env-authored `platform`/`user`/legacy rows are never
    clobbered. Closes the ADR-0078 inert-metadata violation for
    `stack.permissions` (declared sets were runtime-enforced but never
    materialized — invisible to the admin surface, uninstall undefined).
  - Conformance matrix row `declarative-permission-seeding` (ADR-0056 D10) +
    dogfood proof pin the behavior so it cannot regress to inert.

- 2082109: Detail-page related lists: `relatedList: 'primary'` prominence + optional related-list columns (#2579).

  `Field.relatedList` on a child's `lookup`/`master_detail` FK becomes a tri-state
  `boolean | 'primary'`. `'primary'` marks a CORE relationship — a prominence hint
  (ADR-0085), not a layout switch — that the detail page promotes to its own tab,
  while non-primary children collapse into a single shared "Related" tab.
  `false`/`true` keep their meaning (suppress / show in the derived default), so
  the change is additive and opt-in per relationship (no primary anywhere → the
  detail page is byte-for-byte the legacy stacked default).

  `RecordRelatedListProps.columns` becomes optional: when omitted the related list
  derives its columns from the child object's `highlightFields` / default list
  columns — a related list is just another surface that lists that object.
  Required → optional is back-compat.

  Renderer + derivation changes ship in objectui: `relatedList: 'primary'` → own
  tab; one related list per eligible FK (a child that references the parent
  through several relationships now surfaces each, previously only the first);
  self-referential relationships (hierarchies) surface a "child" list; and the
  lookup-picker default columns are unified onto the same `highlightFields`
  source so a picker and a related list of the same object agree with zero
  per-surface config.

- 069c205: Add a build-time view-reference lint that fails `os compile` on a broken form-view reference, and surfaces the previously-silent `_2` rename collision as a warning (#2554).

  `expandViewContainer` gains a behaviour-preserving companion `expandViewContainerWithDiagnostics` that also reports every `<object>.<key>` name collision. List and form views share one namespace during expansion, and the default `list` implicitly claims `<object>.default`; a colliding key was previously renamed to `<object>.<key>_2` **silently**, so references (form action `target`s, navigation `viewName`s) resolved to the _other_ view.

  The new `lint-view-refs` build lint consumes those diagnostics with a broken/fragile severity split, tuned so an upgrade does NOT break existing apps that merely have a colliding key:

  - **view-ref-form-target-kind** — ERROR (fails the build): a `type:'form'` action whose `target` resolves to an existing LIST view — the concrete #2554 breakage (a blank form, a silently no-op submit). High-confidence, so it fails.
  - **view-key-collision** — WARNING: a key silently renamed on collision. Fragile, not broken — it breaks something only if the requested name is referenced — so it warns.
  - **view-ref-form-target-missing** — WARNING: a form target resolving to no view; probably a typo, but possibly a view the lint failed to collect, so it warns rather than risk a false-positive build failure.

  This shifts objectui's runtime `viewKind` guard left to compile time: the author — very often an AI generating templates — discovers the mistake on `os compile` instead of when an end user clicks. It mirrors the existing broken/fragile two-level authoring lints (flow-patterns, autonumber, liveness). `expandViewContainer`'s runtime behaviour is unchanged; the fix is diagnostics-only plus the build gate.

### Patch Changes

- 7c09621: feat(security): pre-map `transfer`/`restore`/`purge` to their RBAC bits (#1883)

  The permission evaluator now maps the destructive record-lifecycle operations
  to their spec permission bits (`transfer` → `allowTransfer`, `restore` →
  `allowRestore`, `purge` → `allowPurge`) and extends the `modifyAllRecords`
  super-user bypass to cover them. The ObjectQL operations themselves are still
  roadmap M2 — but the gate now exists ahead of them: the moment such an
  operation is dispatched through the security middleware it is denied unless a
  resolved permission set grants the matching bit. Unmapped destructive
  operations continue to fail closed (ADR-0049). Spec descriptions updated from
  `[EXPERIMENTAL — not enforced]` to `[RBAC-gated; operation pending M2]`.

- 9860de4: Surface view-key collisions during view container expansion instead of renaming silently.

  `expandViewContainer` keeps its backward-compatible rename behaviour (`<object>.<key>` →
  `<object>.<key>_2` on collision) but now stamps a machine-readable
  `_diagnostics.warnings` entry on the renamed `ExpandedViewItem`, explaining that
  references targeting the requested name (form action targets, navigation `viewName`s)
  will resolve to the _other_ view. Both flattening loaders — the ObjectQL engine and the
  MetadataPlugin — log these warnings at boot so the collision is visible instead of
  manifesting as a form action opening a list view (#2554).

## 11.10.0

### Minor Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- c0efe5d: Upgrade path for retired spec keys — the error IS the guide:

  - **Tombstone entries** in `UNKNOWN_KEY_GUIDANCE`: `create()` rejecting a retired key (`compactLayout`, the `detail` block, object-level `views`, `defaultDetailForm`) now names the replacement, the version/decision that removed it, and the one-line fix — instead of a bare unknown-key error. Tombstones age out ~two majors after the removal.
  - **`CHANGELOG.md` now ships inside the npm package** (`files` allowlist): every breaking entry's migration notes travel with the exact version installed, greppable offline from `node_modules/@objectstack/spec/CHANGELOG.md`.
  - **`llms.txt` gains an "Upgrading Across Spec Versions" section** teaching agents the two-step protocol: read the tombstone, then grep the shipped CHANGELOG — and never to re-add rejected keys or downgrade to silence errors.

## 11.9.0

### Patch Changes

- d3595d9: Clean up two stale code-side doc remnants found during the ADR-0085 docs sweep (#2529):

  - `RecordDetailsProps` (ui/component.zod.ts) `layout`/`fields` descriptions taught the
    deprecated `compactLayout` name — now teach the ADR-0085 canonical `highlightFields`
    (`compactLayout` remains a supported alias). Regenerated
    `skills/objectstack-ui/{contracts/react-blocks.contract.json,references/react-blocks.md}`.
  - Removed an orphaned JSDoc block in data/object.zod.ts describing `defaultDetailForm`,
    a prop that was never implemented and was removed from the spec in #2402.

  Doc-text only; no schema shape or behavior change.

## 11.8.0

## 11.7.0

### Minor Changes

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

## 11.6.0

## 11.5.0

### Minor Changes

- 6ee4f04: Complete the FormView protocol with the form-presentation options the ObjectForm
  component already accepts (conformance follow-up). FormViewSchema gains optional
  `layout`, `columns`, `title`, `description`, `defaultTab`, `tabPosition`,
  `allowSkip`, `showStepIndicator`, `splitDirection`, `splitSize`, `splitResizable`,
  `drawerSide`, `drawerWidth`, `modalSize` — the per-`type` (tabbed/wizard/split/
  drawer/modal) presentation config. The spec↔frontend conformance check went from
  14 frontend-only → 0 for object-form; the react-tier contract now sources these
  from the spec (with descriptions) instead of a hand-authored overlay.
- c1e3a65: Add the react-tier component contract index (`REACT_BLOCKS`, ADR-0081):
  `packages/spec/src/ui/react-blocks.ts` maps each curated public block injected
  into `kind:'react'` page source to the **spec zod schema** that defines its
  declarative config props (FormView, ListView, RecordDetails/Highlights/
  RelatedList/Path, Chart) plus a hand-authored React-interaction overlay
  (binding/controlled/callback — objectName, recordId, mode, onSuccess,
  onRowClick, …). `pnpm --filter @objectstack/spec gen:react-blocks` generates the
  AI-facing contract (skills/objectstack-ui/references/react-blocks.md + .json)
  from it — the `data` props come from the spec (single source, no re-authoring).

## 11.4.0

### Minor Changes

- 5821c51: ADR-0081: split the AI page-authoring surface into honest tiers.

  - `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
    parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
    `'react'` is the real-React tier (executed at render by
    `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
    capability that **defaults ON** (the platform trusts reviewed, draft-gated
    authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
    env toggle. The completeness gate now requires `source` for all three kinds.
  - `@objectstack/cli` console serving injects the disable global into the served
    HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
  - `validate-jsx-pages` lints `html`/`jsx` (constrained parse). A new
    `validate-react-pages` transpiles `react` source with Sucrase (transpile-only,
    never executed) so syntax errors fail at `os build` instead of at render.

### Patch Changes

- a0fce3f: feat(spec): add `userActions.editInline` toggle for inline record editing

  `UserActionsConfigSchema` — the shared toggle set behind both a view's toolbar
  and a page's `interfaceConfig.userActions` — gains `editInline: boolean`
  (default `false`, alongside `addRecordForm`). The runtime already honors it
  (objectui `InterfaceListPage` reads `userActions.editInline` → `inlineEdit`),
  and the metadata-admin "Interface (list pages)" panel — which auto-renders
  these booleans as checkboxes — now exposes an "Edit Inline" toggle. When on,
  cells edit with the field's type-aware widget (the same control the form uses).
  A list stays read-only unless the author opts in.

## 11.3.0

### Minor Changes

- b4a5df0: chore(ai): align framework with Vercel AI SDK v7 and stop bundling provider SDKs

  AI runtime capabilities now live in the cloud package (service-ai removed from the
  open edition, ADR-0025 S2). The framework therefore no longer ships any `@ai-sdk/*`
  provider SDK:

  - `@objectstack/cli` drops the dead `@ai-sdk/anthropic|gateway|google|openai`
    dependencies (zero usages in `cli/src` — they were only bundled so the old
    in-tree `service-ai` could `require()` them at runtime). Apps that boot the
    closed AI now declare the providers themselves (cloud side).
  - `examples/app-todo` drops the unused `ai` / `@ai-sdk/gateway` devDeps and the
    dead `test:ai*` / `test:agent` / `test:llm` scripts (their test files were
    migrated to cloud).
  - `@objectstack/spec` bumps its `ai` peer/dev dependency from `^6` to `^7`. The
    protocol still re-exports the canonical message/stream types (`ModelMessage`,
    `TextStreamPart`, `ToolSet`, `FinishReason`, …) — all verified present in
    `ai@7`; `ai` stays an OPTIONAL peer so installs are not forced.

  First step of the AI SDK v6→v7 / providers v3→v4 upgrade. Cloud (service-ai
  adapter migration + apps declaring v4 providers) and objectui (chatbot useChat
  v7) follow in their own PRs.

### Patch Changes

- 58e8e31: feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

  A record's human title is a structural invariant (ADR-0079): every object
  resolves a primary title from a real STORED field via `nameField` (the
  canonical pointer; `displayNameField` is the deprecated alias) or a
  deterministic derivation. This adds build-time diagnostics so `os build` /
  `os lint`, the MCP authoring surface, and hand-authoring all get the coverage
  cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

  - `title-format-retired` — flags an object that declares a `titleFormat`. That
    key is a render-only template the server can neither return nor query;
    ADR-0079 retires it in favour of `nameField`. The schema still parses it
    (existing metadata keeps loading), so this is advisory, not an error.
  - `title-unresolvable` — flags an object whose title cannot be resolved from any
    stored field (`objectTitleCompleteness` reports `status: 'none'`).

  `@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
  the `@objectstack/cli` `lint` command wires the new validator into its run.

## 11.2.0

### Minor Changes

- d0f4b13: Segment `ObjectStackProtocol` into per-domain protocol interfaces (ADR-0076 D9)

  `ObjectStackProtocol` was a single 70-method interface spanning 11 unrelated domains. It is now the **composition** of focused per-domain contracts — `DataProtocol`, `MetadataProtocol`, `AnalyticsProtocol`, `AutomationProtocol`, `PackageProtocol`, `ViewProtocol`, `PermissionProtocol`, `WorkflowProtocol`, `RealtimeProtocol`, `NotificationProtocol`, `AiProtocol`, `I18nProtocol`, `FeedProtocol` — all newly exported.

  `ObjectStackProtocol` now `extends` all of them and is **shape-identical** to the previous flat interface, so every existing implementation/consumer is unaffected (non-breaking). New code should depend on the narrowest slice it needs (e.g. `DataProtocol`). Per ADR-0076 D9 (rev.7) the composed union is transitional; capability availability is provided at runtime by the discovery `services` registry.

- 302bdab: ADR-0080: `PageSchema` gains `kind: 'jsx'` + `source` (the authoritative JSX text, compiled to the tree at save time) + `requires`, with a completeness `superRefine` — a jsx page with no source fails loudly (ADR-0078).

## 11.1.0

### Minor Changes

- ecf193f: Add `openIn` to `ActionSchema` — a declarative new-tab control for static `type:'url'` actions.

  Counterpart to objectui issue #2043, which added a first-class `openIn?: 'self' | 'new-tab'`
  field to its public `ActionSchema` and honors it in `ActionRunner.executeUrl` (read with
  priority over the legacy `params.newTab` / external-URL heuristic). Until now
  `@objectstack/spec`'s `ActionSchema` was a plain `z.object(...)` that **stripped** unknown
  keys, so `openIn` written via `defineAction({...})` was silently dropped at build and never
  reached objectui's runtime. Authors (e.g. plan-management) therefore couldn't use it.

  ```ts
  defineAction({
    name: "print_a3",
    label: "打印总表(A3)",
    type: "url",
    target: "/print/a3?id=${record.id}",
    openIn: "new-tab", // now preserved end-to-end
  });
  ```

  - `openIn: 'new-tab'` — open a **static** `target` URL in a new tab. No handler, no pre-open.
  - `openIn: 'self'` — navigate in place.
  - omitted — external/absolute URLs open in a new tab; relative URLs navigate in place.

  Kept distinct from the existing `opensInNewTab` / `newTabUrl` (those pre-open an
  `about:blank` tab synchronously for **async** SSO-redirect handlers — not merged). It is a
  static execution option and must stay OUT of `params` (which is user-input-collection only).

  Consuming projects must upgrade `@objectstack/spec` to this version for the declarative
  new-tab path to work end-to-end.

- 51bec81: Remove a first batch of dead (unenforced, unauthored) metadata properties (#2377, ADR-0049).

  Verified set 0× / read 0× across framework + objectui + cloud + hotcrm + templates, with no test footprint outside `@objectstack/spec`:

  - **field**: `caseSensitive`, `maxRating`
  - **object**: `partitioning` (+ `PartitioningConfigSchema`), `defaultDetailForm`

  Liveness ledgers (field/object) updated; api-surface regenerated (drops `PartitioningConfig`/`PartitioningConfigSchema` only). Folded into the 11 line (`minor`).

  The remaining #2377 candidates are deliberately not in this batch: overloaded names (`tags`/`active`/`versioning`/`dependencies`/`index`/…) need per-occurrence handling, and `softDelete` / `measures.certified` turned out to be set in non-spec test fixtures (analytics, mcp) — both deferred. See the issue for the full split.

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

- 63d5403: Remove the dead `PolicySchema` / `definePolicy` and the stack `policies` collection (#1882, ADR-0049).

  `PolicySchema` (password / network / session / audit "org security policy") was
  **100% unenforced** — no runtime consumer ever read it. Per ADR-0049
  (enforce-or-remove) it is removed rather than implemented:

  - `@objectstack/spec`: delete `security/policy.zod.ts` (`PolicySchema`,
    `Password/Network/Session/AuditPolicySchema`, `definePolicy`); drop the
    `policies` field from the stack schema and the `policies` collection wiring
    (`MAP_SUPPORTED_FIELDS`, `METADATA_ALIASES`).
  - `@objectstack/downstream-contract`: drop the `DcPolicy` fixture/case (the
    contract gate stays green — `SharingRule` / `PermissionSet` are unaffected).
  - Examples (`app-crm`, `app-showcase`): drop their unused policy definitions.

  No migration needed for consumers: `policies` was never enforced. `SharingRule`,
  `PermissionSet`, RLS, and all `*PolicySchema` siblings (retry/retention/RLS/etc.)
  are unrelated and unchanged. Verified: hotcrm + templates have zero Policy-API
  usage; downstream-contract gate green.

## 11.0.0

### Major Changes

- a658523: Open edition is MCP-only.

  The bundled AI authoring service (`@objectstack/service-ai`) is no longer part of
  the open distribution (ADR-0025 S2, #2325); AI now integrates through MCP
  (`@objectstack/mcp`) and the documented opt-in seam — an app that declares
  `@objectstack/service-ai` / `@objectstack/service-ai-studio` still loads the
  service. Removing a published package from the open edition is a breaking change,
  so this cuts the next release as a major.

- 82ff91c: Remove the deprecated `http_request` / `http_call` / `webhook` flow-node aliases — author `http` (ADR-0018 M3).

  ADR-0018 M3 collapsed the divergent outbound-callout verbs onto the canonical
  `http` node and kept the old names as deprecated aliases for back-compat. This
  removes those aliases (the 11.0 cleanup):

  - `http_request` is dropped from `FlowNodeAction` (and therefore
    `FLOW_BUILTIN_NODE_TYPES`); authoring it now fails fast at parse instead of
    resolving to `http`.
  - `AutomationEngine` no longer registers the `http_request` / `http_call` /
    `webhook` node aliases; only `http` is registered.
  - The flow-builder palette offers `http`.

  **Breaking.** Flows / workflow rules / approval actions that still use the old
  node type must switch to `type: 'http'` (behavior is identical — durable outbox
  when `config.durable`, inline fetch otherwise). The trigger `eventType: 'webhook'`
  and the `webhook` resume event are unaffected — only the HTTP _node_ aliases are
  removed. First-party examples (showcase, app-crm) are migrated.

- 638f472: Remove the deprecated `IUIService` contract (use `IMetadataService`) — 11.0.

  `IUIService` (spec `contracts/ui-service.ts`) was superseded by `IMetadataService`
  (views/dashboards are metadata: `metadata.get('view', …)` / `register(…)`). This
  removes the dead interface and its dev stub:

  - spec: delete `contracts/ui-service.ts` + its barrel export.
  - plugin-dev: drop the bespoke `ui` dev stub (`createUIStub`). `'ui'` remains a
    `CoreServiceName`, so dev mode still registers a generic stub for it via the
    fallback path; only the obsolete view/dashboard methods are gone.

  Use `IMetadataService` for view/dashboard CRUD.

### Minor Changes

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

- 4845c12: feat(cli): make the AI service opt-in via a declared dependency; honor `config.tiers`

  **AI edition boundary (cli).** The CLI auto-registered the headless `AIServicePlugin`
  whenever the `ai` tier was enabled (default) and `@objectstack/service-ai` was
  merely _resolvable_. In a workspace/monorepo the package is hoist-resolvable even
  when an app does not declare it, so every app got the AI service — discovery
  reported `services.ai: available` and the agent runtime served any
  metadata-defined agents — including Community-Edition apps that ship no AI.

  Now the _declared_ dependency is the boundary: AIService auto-registers only when
  the host app declares `@objectstack/service-ai` **or** `@objectstack/service-ai-studio`
  (Studio attaches its personas via the base service's `ai:ready` hook, so declaring
  Studio implies the base). A CE app that declares neither gets no AI service, no
  agents, and `services.ai: { enabled: false, status: 'unavailable' }` in discovery
  (so the console hides its AI surface). MCP and every other capability are
  unaffected. The `app-showcase`/`app-crm` examples now declare `@objectstack/service-ai`.

  **`config.tiers` now honored (spec).** `ObjectStackDefinitionSchema` gains a `tiers`
  field, so `defineStack` no longer strips it. `config.tiers` (e.g. a list WITHOUT
  `ai`) now actually overrides the `--preset` default — previously it was silently
  dropped by schema validation, making the `--preset` help text inaccurate. This is
  a second, in-place way to disable AI for a deployment without touching dependencies.

- 715d667: feat(spec): dataset authoring form + derived measures without a dummy aggregate

  `dataset` was the only UI-authorable metadata type without a `defineForm`
  layout, so Studio's create surface fell back to the auto-generated flat layout
  (free-text `object`, no grouping). Adds `dataset.form.ts` (registered in
  `METADATA_FORM_REGISTRY`): sectioned Basics / Source / Dimensions / Measures
  with an `object` picker (`ref:object`) and guidance — matching the sibling
  `report` editor.

  Also makes `DatasetMeasureSchema.aggregate` optional. A derived measure
  (`derived: { op, of }`) combines other measures by name and `aggregate` is
  ignored for it at compile time, but the schema still required it — so a derived
  measure failed validation unless you added a meaningless aggregate. `aggregate`
  is now required only for non-derived measures (enforced in the existing
  `superRefine`). Backward compatible: existing measures that carry an aggregate
  stay valid.

- 5eef4cf: feat(analytics): multi-hop relationship joins for datasets (ADR-0071)

  A dataset's `include` and dimension/measure `field` paths may now traverse up to
  3 to-one relationship hops (`account.owner.region`), not just one. The compiler
  expands each declared path into the ordered join chain (one `cube.join` per path
  prefix, aliased dot-free as `account__owner` so it stays a single valid SQL
  identifier), and the NativeSQLStrategy emits the chained `LEFT JOIN`s. Per-hop
  tenant/RLS read-scope is enforced for EVERY object in the chain — the
  alias-driven scope loop already generalizes, so no security path is rewritten.

  Restricted to **to-one** (lookup / master_detail) relationships, which never fan
  out — aggregates stay correct with no symmetric-aggregate machinery; to-many
  traversal is out of scope. Single-hop datasets are byte-for-byte unchanged (the
  dot-free alias is a no-op for a single segment). Undeclared paths are still
  rejected (ADR-0021 D-C); paths beyond 3 hops are rejected at both parse and
  compile time.

- 6c4fbd9: fix(security): enforce flow `runAs` execution identity (#1888)

  The `service-automation` engine now honors `flow.runAs` instead of ignoring it.
  Previously the CRUD nodes passed **no identity** to ObjectQL, so the security
  middleware was skipped entirely — every flow ran effectively elevated regardless
  of `runAs`. A `runAs:'user'` flow did **not** de-elevate (a privilege-boundary
  surprise), and `runAs:'system'` did not _explicitly_ elevate.

  The engine now establishes the run's data-layer identity at setup and restores
  the caller's context afterward:

  - **`runAs:'system'`** → an elevated, RLS-bypassing system principal
    (`{ isSystem: true }`): the run can read/write records the triggering user
    cannot.
  - **`runAs:'user'`** (default) → the **triggering user's** identity
    (`{ userId, roles, permissions, tenantId }`): CRUD nodes' ObjectQL reads/writes
    respect that user's row-level security, and the run can never exceed the
    triggering user's grants.

  To keep `runAs:'user'` faithful to a direct request by that user, the REST
  trigger route (`@objectstack/runtime`) and the record-change trigger
  (`@objectstack/trigger-record-change`) now forward the caller's resolved
  `roles`/`tenantId` into the `AutomationContext` (new optional fields), not just
  `userId`. The new `resolveRunDataContext` helper is the single place that maps a
  run's effective `runAs` to the ObjectQL context, shared by every data node.

  The `[EXPERIMENTAL — not enforced]` marker is removed from `FlowSchema.runAs`.

  **Behavior change / migration.** Flows that previously relied on the implicit
  elevation (the default `runAs:'user'` ran unscoped) now run as the triggering
  user and are subject to their RLS. **Declare `runAs:'system'` on any flow that
  must read or write beyond the triggering user's access** (e.g. system
  automations, cross-owner roll-ups). Schedule-triggered runs have no trigger user;
  under `user` they stay unscoped (there is no identity to scope to) — declare
  `system` to make elevation explicit.

  Proven both directions by the dogfood regression gate
  (`flow-runas.dogfood.test.ts` — a restricted member triggers system vs user
  flows against an owner-scoped record) and service-automation unit + regression
  tests (`crud-runas.test.ts`).

- ef3ed67: Formula field typing: `inferExpressionType()` + a declared `returnType`.

  - `@objectstack/formula`: new `inferExpressionType()` (and lower-level `inferCelType()`) surfaces the cel-js type-checker's result for a CEL value/formula expression, mapped to `number | text | boolean | date | unknown`. Conservative — two `dyn` operands stay `unknown`; typed literals/stdlib returns pin a concrete type.
  - `@objectstack/spec`: `FieldSchema` gains an optional `returnType` (`number|text|boolean|date`) so a formula field can carry its declared value type (the way Salesforce/Airtable do), letting consumers (dataset measures, formatting, validation) read a declared type instead of re-parsing the expression.

- cd51229: Expose authoritative create seeds via /meta/types (spec-derived create-shape contract, Phase 2)

  The minimal valid create seeds added in `@objectstack/spec/kernel` (`getMetadataCreateSeed`) now reach consumers through the real `/meta/types` registry response: each entry carries an optional `createSeed`. The Studio designer / CLI / API clients derive their create defaults from this single source of truth instead of re-inventing them — closing the drift that produced the dashboard-`layout` and action-`body` create→save 422s.

  - `@objectstack/spec`: barrel-export `getMetadataCreateSeed` / `listMetadataCreateSeedTypes` from `/kernel`; add optional `createSeed` to the `GetMetaTypesResponse` entry schema.
  - `@objectstack/objectql`: `getMetaTypes()` attaches each type's seed (registry + runtime entries). Canvas-create types whose shape is built interactively (report) are intentionally absent.

- 7697a0e: chore(spec): hard-remove the dead `blank`/`record_review` page config (enforce-or-remove)

  Completes the enforce-or-remove started in framework#2265. The `blank` and
  `record_review` page types were already removed from `PageTypeSchema` (no
  renderer), their fields marked `@deprecated`, and objectui dropped all
  references (objectui#1949). This deletes the now-unreachable surface:

  - `BlankPageLayoutSchema`, `BlankPageLayoutItemSchema`, `RecordReviewConfigSchema`
    (and their inferred types `BlankPageLayout`, `BlankPageLayoutItem`,
    `RecordReviewConfig`).
  - The `blankLayout` and `recordReview` fields on `PageSchema`.
  - `page-builder.zod.ts` (the `blank`-type drag-drop canvas config:
    `PageBuilderConfigSchema` / `CanvasSnapSettingsSchema` / `CanvasZoomSettingsSchema`
    / `ElementPaletteItemSchema` / `InterfaceBuilderConfigSchema` and their types)
    and its `@objectstack/spec/studio` re-exports — nothing consumed them.

  The `page` liveness ledger drops to 15 properties (the 2 `dead` entries are gone).
  No consumers in framework or objectui (objectui#1949 already merged).

  **Version note (kept `minor`, not `major`).** These exports shipped in the
  published `10.3.0`, so under ADR-0059 §4 (the freeze contract) a removal would
  normally demand a major bump. It is kept `minor` as a deliberate, documented
  exception: the removed symbols are config schemas for the renderless
  `blank`/`record_review` page types — authoring those already failed at runtime
  ("Unknown component type"), the frozen `@objectstack/downstream-contract`
  fixture never referenced them, and the pre-publish hotcrm live gate guards
  against any real consumer break. The `api-surface.json` snapshot is regenerated
  alongside this so the removal is acknowledged, not silent.

- cfd5ac4: fix(spec): remove unrendered roadmap page types from PageTypeSchema (enforce-or-remove)

  `PageTypeSchema` advertised six page types that never shipped a renderer —
  `dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`.
  Authoring one passed schema validation but broke at runtime ("Unknown component
  type"), a false affordance that's especially dangerous when templates are
  AI-authored. Per ADR-0049 (enforce-or-remove), the enum is now the _live_ set
  (`record`, `home`, `app`, `utility`, `list`) — authoring a removed type now
  fails fast at parse instead of silently at render. The removed types are tracked
  in the new `PAGE_TYPE_ROADMAP` export and re-enter the enum only when a renderer
  ships. A `page-type-liveness` gate test asserts the enum never re-grows a
  roadmap type.

  The `recordReview`/`blankLayout` config schemas and fields are retained but
  `@deprecated` (their page types are no longer authorizable) to avoid breaking
  downstream imports; they will be removed in a coordinated follow-up. The
  `variables` page field is documented `@experimental` — its state container is
  wired but no consumer reads/writes it end-to-end yet.

- 5c4a8c8: feat(spec): RecordRelatedListProps.add — add-existing-via-picker (generic m2m/junction assignment). A related list can now link existing records via a picker, not just create+navigate. Powers a generic "Assigned Users" / Manage Assignments UI on permission sets.
- 3afaeed: feat(ui): add `element:text_input` — free-text data-entry element for SDUI pages

  SDUI pages could display and navigate but not collect free-text input. This adds
  that half of the contract:

  - `ElementTextInputPropsSchema` (label, placeholder, `inputType` —
    text/email/number/tel/url/password — defaultValue, required, disabled,
    description) wired into `PageComponentType` and `ComponentPropsMap` as
    `element:text_input`.

  The objectui renderer binds the typed value into a page variable
  (`PageVariableSchema.source`); a submit `element:button` reads it back via
  `{{page.<var>}}` token interpolation in the console action runtime. Showcase:
  `showcase_contact_form` (text inputs → page variables → POST web-to-lead).

- 3d04e06: Add authoritative per-type create seeds (root-cause for the "designer shape ≠ spec" family)

  New `metadata-create-seeds.ts`: a single source of truth for the minimal valid create shape of each metadata type (`getMetadataCreateSeed(type)`), co-located with the schemas and asserted valid against each type's schema by `metadata-create-seeds.test.ts`. This anchors the create-form's default shape to the spec so it can't drift — the root cause of the recurring family where a freshly-created item (dashboard without `layout`, script action without `body`, report with stale `objectName`/`columns`) failed validation on save (422) yet passed every other gate. Seeds the 9 core Studio-designer types (dashboard, action, page, view, flow, validation, hook, dataset, object); the test surfaces remaining schema-backed types still needing a seed. (Follow-up: expose `createSeed` via `/meta/types` so the Studio designer consumes it instead of hardcoding `createDefaults`.)

- d980f0d: feat: add a first-class `user` field type (person picker)

  A new `user` field type — the equivalent of Airtable's Collaborator / Notion's
  Person / Salesforce's `Lookup(User)`. Authored as `Field.user({ ... })`; use
  `{ multiple: true }` for collaborators/watchers and `{ defaultValue: 'current_user' }`
  to auto-fill the acting user on create.

  **Why a distinct type rather than telling authors to `Field.lookup('sys_user')`:**
  selecting a person is table-stakes, but the value is in _modelling
  discoverability_ — a "User" entry in the Studio/AI field palette instead of
  requiring authors (and AI) to know to reference the internal `sys_user` system
  object — plus `current_user` defaults and a user-search picker. Storage and
  runtime are unchanged.

  **Deliberately NOT a new storage primitive.** `user` is a _semantic
  specialization of `lookup`_ with the target fixed to `sys_user`: it shares the
  exact lookup code path — same FK string column (`multiple` ⇒ JSON), same
  `$expand` resolution, same indexing — so referential integrity and fresh display
  names come for free, and nothing is re-implemented. An existing
  `Field.lookup('sys_user')` is therefore equivalent at the storage layer (zero
  data migration to adopt `Field.user`).

  Ownership semantics are **unchanged**: the existing `owner_id` convention +
  `plugin-security` auto-stamp/RLS still apply. A declarative `owner` flag is a
  possible future follow-up; intentionally not added here to avoid a second
  field type for what is a system role (rationale: keep the `FieldType` surface
  lean — see related ADR-0059 freeze discipline).

  Changes: `FieldType` gains `'user'` + `Field.user()` builder; the SQL/Mongo
  drivers treat `user` exactly like `lookup`; the engine resolves `$expand` for
  `user` fields and honours a new `defaultValue: 'current_user'` token (resolved
  app-side from the execution context, mirroring the `NOW()` convention); kanban
  group-by and symbolic seed references accept `user`; approvals enrich `user`
  references. The public API surface is unchanged (additive enum member).

### Patch Changes

- c1a754a: feat(spec): type ChartConfig `colors` as a palette OR a value→color map

  `ChartConfigSchema.colors` now accepts either a positional palette (`string[]`)
  or an explicit value→color map (`Record<value, color>`, kanban-style). A
  value→color map — and a select/lookup dimension's option colors — take
  precedence over the positional palette per category, so semantic charts
  (health, status) paint their own colors instead of the generic palette.

- 6fbe91f: fix(spec): make dashboard widget `layout` optional (auto-flowed when omitted)

  `DashboardWidgetSchema.layout` was required, but the entire runtime treats it as
  optional: the renderer (`DashboardGridLayout`) auto-flows any widget without a
  layout (`x: (i % 4) * 3, y: ⌊i/4⌋ * 4, w: 3, h: 4`), and the Studio dashboard
  designer adds widgets **without** a layout by design.

  The mismatch meant every dashboard authored in the Studio designer failed spec
  validation the moment a widget was added — the draft `PUT /meta/dashboard/...`
  returned **422** ("widgets: Invalid type: expected object, received undefined"),
  so the draft never saved and **Publish stayed disabled**, even though the widget
  rendered correctly in the canvas. Found by dogfooding the dashboard designer in
  the browser.

  `layout` is now optional; absence means "auto-place". Authors may still pin an
  explicit grid position. Backward-compatible — existing dashboards that specify
  `layout` are unaffected.

- 72759e1: feat(spec): add the `back` edge style to the flow-builder canvas protocol

  `FlowCanvasEdgeStyleSchema` gains a `back` value alongside `solid`/`dashed`/`dotted`/`bold`, marking an ADR-0044 declared back-edge (a `revise` loop's resubmit edge). Flow-builder-protocol consumers can now render it as a distinct curved/dashed return arc, set apart from forward flow — matching the objectui designer's hand-rolled canvas (objectstack-ai/objectui#1954). Part of #2274.

- e7e04f1: chore(liveness): bring `page` under the spec liveness gate

  Onboards the `page` metadata type to the ADR-0049/#1919 liveness ledger
  (`packages/spec/liveness/page.json`) and adds it to the governed-types list in
  `check-liveness.mts`. Every authorable PageSchema property now declares a
  status with evidence: 17 properties — 14 `live` (objectui renderer consumers
  cited as prose), 1 `experimental` (`variables` — provider/hook exist, no
  end-to-end consumer), 2 `dead` (`recordReview` / `blankLayout` — their page
  types were removed in framework#2265 and objectui dropped all references in
  objectui#1949; the fields stay @deprecated pending hard-removal). CI now fails
  if a new page property lands unclassified.

- 2be5c1f: Promote `PageSchema.variables` from @experimental to live (ADR-0049)

  Page-local state is now wired end-to-end (runtime in objectui#1957: page
  variables are injected into the visible/CEL expression context as `page.<var>`,
  and `element:record_picker` writes a variable via its `source` binding). The
  spec docs are updated to describe the now-live behaviour and the binding
  direction, and the liveness ledger entry is flipped `experimental → live`.

- ad143ce: fix(security): surface the schedule/user-less `runAs:'user'` fail-open (#1888 follow-up)

  With `flow.runAs` now enforced (#1888), a **schedule-triggered** flow with the
  default `runAs:'user'` has no trigger user. `resolveRunDataContext` returns
  `undefined` for that case, so the CRUD nodes pass no ObjectQL `options.context`
  and the security middleware — which _skips_ when there is no identity (it
  delegates auth to the auth layer) — runs the operation **UNSCOPED** (effectively
  elevated). An author who left `runAs` at the `'user'` default expecting a
  restricted run silently gets an unscoped one — a fail-open footgun (ADR-0049: a
  security property must not silently do the opposite of what it implies).

  This is the **product decision** to make that explicit, chosen to keep legitimate
  scheduled CRUD working (denying outright would break it, and silently elevating
  would hide the author's intent). Prevention happens where the platform can tell
  intent apart (author/build time); the runtime stays non-breaking but is no longer
  silent:

  - **Author-time lint** (`@objectstack/cli`, `lintFlowPatterns`): a new advisory
    rule `flow-schedule-runas-unscoped` flags a schedule-triggered flow whose
    effective `runAs` is `user` (explicit or unset) and which performs a data
    operation — pointing the author at `runAs:'system'`. Catches the footgun at
    compile time, before deploy (most flows are AI-authored).
  - **Runtime warning** (`@objectstack/service-automation`): the engine now emits a
    clear one-per-run warning when a user-mode run resolves no trigger identity and
    the flow touches data — the fail-open is _audible_ rather than silent. Behavior
    is otherwise unchanged (the run still executes), so scheduled CRUD that relied
    on this is not broken. New helpers `runIsUnscopedUserMode`, `flowTouchesData`,
    and `DATA_NODE_TYPES` are exported alongside `resolveRunDataContext`.
  - **Spec describe** (`@objectstack/spec`): `FlowSchema.runAs` now states that a
    scheduled run has no user, so under `user` it runs unscoped — declare `system`.

  The first-party example apps that tripped the new lint are fixed to declare
  `runAs:'system'` explicitly (`stale_opportunity_sweep`, the app-todo
  `task_reminder` / `overdue_escalation` sweeps) — they read/write across owners and
  were running unscoped by default.

  Longer term, attributing scheduled runs to a dedicated service principal (so they
  are scopable + audit-attributable rather than unscoped) is the right enforcement;
  tracked as M2 follow-up.

  Proven by a service-automation unit test (the engine warns once for a user-less
  user-mode data run; stays silent for `system`, for an identified user, and for a
  data-less flow), an end-to-end test wiring the **real `ScheduleTrigger` to the
  real engine** (`@objectstack/trigger-schedule`) that fires a job and asserts the
  user-less identity reaches the engine + trips the warning through the actual cron
  path, and a dogfood gate (`flow-runas-schedule.dogfood.test.ts`) that drives
  user-less runs through the real automation + security + data stack: a
  `runAs:'user'` run reads + writes an owner-scoped note a member cannot — audibly —
  while `runAs:'system'` is the explicit, warning-free equivalent.

  Refs #1888, ADR-0049.

- 8801c02: fix(spec): don't require `slots` on slotted pages

  `PageSchema`'s superRefine rejected any `kind: 'slotted'` page that didn't
  provide a `slots` map — but a slotted page with no overrides is valid: every
  slot falls through to the synthesized default layout, the natural starting
  point before you add overrides. Requiring `slots` up front made the Studio
  "New Page" form a dead-end the moment you picked "slotted" (the form can't
  author a slot map), the same trap as the old required `regions`.

- 4a84c98: fix(spec): make page `regions` and component `properties` optional

  `PageSchema.regions` and `PageComponentSchema.properties` were required, which
  made it impossible to create record/home/app pages in the Studio editor: the
  New Page form has no region editor, and the create-form seeds a record page's
  default layout from `buildDefaultPageSchema`, whose nodes carry props at the top
  level — so every seeded block tripped `regions.N.components.M.properties:
expected record`. Both are now `.optional().default(...)`; an empty full page
  falls back to the synthesized default layout, slotted pages compose via `slots`,
  list pages ignore regions, and prop-less components (record:activity,
  element:divider) no longer need `properties: {}`.

## 10.3.0

## 10.2.0

### Minor Changes

- b496498: feat(spec): add `responsiveStyles` to the UI page-component envelope (ADR-0065)

  `ResponsiveStylesSchema` / `StyleMapSchema` model the SDUI scoped-styling
  primitive — per-breakpoint CSS-property maps (`large`/`medium`/`small`/`xsmall`)
  compiled to id-scoped CSS at render. `PageComponentSchema` gains an optional
  `responsiveStyles` field: the preferred, build-independent, collision-free
  styling channel for metadata-authored pages (distinct from the layout-oriented
  `responsive` config). Prefer design-token values.

## 10.1.0

### Minor Changes

- 49da36e: feat(analytics): correct analytics over federated objects (ADR-0062 Phase 3, D6)

  Analytics over an external (federated) object now aggregates against the
  **correct** remote table instead of silently querying the wrong one. The
  `NativeSQLStrategy` hand-compiles `FROM "<object>"` and bare column references,
  which bypass the driver's physical-table resolution (`external.remoteName` /
  `remoteSchema` / `columnMap`). It now **declines** any query whose base or joined
  object is federated, routing it to the `ObjectQLStrategy` — whose
  `engine.aggregate()` goes through the driver's `getBuilder` and already honours
  `remoteName`/`remoteSchema` (#2138/#2149). This "reuses the driver's resolution"
  (D6) rather than re-implementing it.

  Adds an optional `StrategyContext.isExternalObject(objectName)` hook (reported by
  the analytics plugin from the object's `external` block). Purely additive — with
  no hook, behavior is unchanged for managed objects.

- ac79f16: feat(datasource): auto-connect declared external datasources (ADR-0062 Phase 1, D1/D2/D5)

  A declared external datasource is now connected to a live ObjectQL driver and its
  federated objects are queryable **with zero app code** — no `onEnable` driver
  wiring. Implements ADR-0062 Phase 1.

  - **D1 — one connect path.** New `DatasourceConnectionService` in
    `@objectstack/service-datasource` owns the single "definition → live driver"
    path: build via the injected driver factory → resolve `external.credentialsRef`
    via the `SecretBinder` → connect → `engine.registerDriver` under the datasource
    name → register the datasource def → sync each bound federated object's read
    metadata (DDL-free). Both origins converge on it: the runtime-admin
    `registerPool` now delegates here, and `AppPlugin` auto-connects code-defined
    datasources. Exposed as the `'datasource-connection'` kernel service.
  - **D2 — opt-in-safe gate.** A declared datasource auto-connects only when it is
    `external`, an object **explicitly** binds to it via `object.datasource`, or it
    sets the new `autoConnect: true` flag. A managed datasource that nothing
    explicitly binds (incl. ones referenced only by a `datasourceMapping` rule, e.g.
    `examples/app-crm`'s `:memory:` datasources) stays metadata-only — existing apps
    are byte-for-byte unchanged. See the ADR-0062 D2 implementation note.
  - **D5 — lifecycle, ordering & policy.** Connect happens in `AppPlugin.start()`
    (before the `kernel:ready` validation gate, relying on the kernel's
    init-all-then-start-all ordering). Fail-fast for a declared `external` datasource
    with `validation.onMismatch: 'fail'`; degrade-with-warning otherwise (and always
    for runtime-admin/rehydrate, so a UI action or replica blip never bricks the
    server). Adds a host-injectable `DatasourceConnectPolicy` (open-core default
    allows; a multi-tenant host binds a stricter fail-closed policy for egress
    isolation) consulted before every connect — one connect path, no cloud fork.

  Adds `datasource.autoConnect` to the spec. The legacy `onEnable` +
  `ctx.drivers.register` bridge remains supported as an escape hatch (idempotent vs.
  auto-connect). No behavior change for managed apps.

## 10.0.0

### Minor Changes

- d7ff626: spec(action): a `script` action must declare an executable binding — reject at
  author/compile time when it has neither an inline `body` nor a `target`.

  A `type: 'script'` action with no `body` and no `target` registers no runtime
  handler: `AppPlugin` skips it, and invoking it falls through to the wildcard
  lookup and fails with `Action '<name>' on object '*' not found` (the #2169
  "Mark Done" bug). The shape was schema-valid and passed coverage tests, so the
  break only surfaced when a user clicked the button.

  `ActionSchema` now enforces the invariant via `superRefine`: `script` requires
  `body || target` (mirroring the existing "non-script types require `target`"
  rule). `body`-bound actions are auto-registered by the runtime; `target`-bound
  actions name a function wired imperatively (e.g. via `onEnable`). This only
  rejects configurations that were already non-functional at runtime — verified
  against the full monorepo build (every shipped bundle still compiles).

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

- e411a82: feat(ai): split `ask`/`build` agents by surface + tool scoping (ADR-0063/0064).

  Two kernel agents bound by surface, not a per-turn classifier. `SkillSchema`
  gains `surface: 'ask'|'build'|'both'` and `AgentSchema` gains `surface:
'ask'|'build'` (ADR-0063 §3); an agent's tools are exactly the union of its
  surface-compatible skills' tools — incompatible binding is a load error in
  `resolveActiveSkills` (ADR-0064 §3). The `ask` agent is now data-only (the
  ADR-0040 unified "INTENT FIRST" classifier and the `buildRegisterActive`
  degradation shim are removed); a new `schema_reader` (`surface:'both'`) owns
  the shared reads `describe_object`/`list_objects`/`query_data` so the build
  agent reuses them without dual-listing. `*.agent.ts` is closed to third
  parties: the `agent` metadata-type is `allowRuntimeCreate:false,
allowOrgOverride:false` and the runtime catalog lists only platform agents
  (ADR-0063 §2). Renames `data-chat-agent.ts`→`ask-agent.ts`,
  `DEFAULT_DATA_AGENT_NAME`→`ASK_AGENT_NAME` (the `data_chat`/`metadata_assistant`
  aliases stay resolvable).

- a581385: Propagate a dataset measure's declared currency to the analytics result field.

  Adds an optional `DatasetMeasure.currency` (ISO 4217) on the semantic layer and
  carries it onto each measure result field alongside `label`/`format`, so a
  currency-aware client (Intl symbol) can render `¥1,234` / `$616,000` from a real
  currency code instead of a plain number or a `$` baked into `format`. Additive
  and optional — existing datasets are unaffected.

- 220ce5b: Resolve the tenant default currency onto ExecutionContext.

  Adds `ExecutionContext.currency` (ISO 4217) and resolves it from the
  `localization.currency` setting alongside `timezone`/`locale` — in both the
  runtime `resolveExecutionContext` and the REST mirror. This is the foundation
  for the documented "applied when a currency field omits its own" fallback: the
  tenant default is now carried on every request context, so analytics enrichment,
  formatters, and renderers can resolve a measure/field currency down to the org
  default instead of hard-coding it. Undefined when no tenant default is
  configured (consumers then render a plain number).

- 6ca20b3: ADR-0058 D1 follow-through — RLS predicates are now canonical CEL. Migrated every
  seeded RLS `using`/`check` (default permission sets, showcase, and the
  `RLS.ownerPolicy`/`tenantPolicy`/`allowAllPolicy` helper factories) from the
  legacy SQL-ish form (`=`, `IN (...)`) to pure CEL (`==`, `in`), so authors and AI
  learn ONE expression language. The `sqlPredicateToCel` bridge is retained as a
  DEPRECATED transitional shim: a stored SQL-style predicate still compiles (no
  silent deny on legacy data) but emits a deprecation warn; canonical CEL passes
  through as a no-op. No runtime behavior change — CEL and the old SQL form compile
  to the identical FilterCondition.
- 5f875fe: spec: add `defineX` factories for the remaining 16 writable domains and the 6
  missing `XInput` aliases — one consistent, type-safe authoring entry per domain
  (#2035).

  New factories: `defineDatasource`, `defineConnector`, `definePolicy`,
  `defineSharingRule`, `definePosition`, `definePermissionSet`,
  `defineEmailTemplateDefinition`, `defineReport`, `defineWebhook`,
  `defineObjectExtension`, `defineCube`, `defineMapping`, `defineTheme`,
  `defineTranslationBundle`, `definePage`, `defineAction`. Each mirrors the 19
  existing factories (`XSchema.parse(z.input<…>)`): input-shape ergonomics +
  authoring-time validation. Because a factory is a _value_ import, a broken
  import hard-errors instead of silently degrading to `any` (the #2023 failure
  mode), and errors surface at `.parse()` time with field-level messages.

  Also adds the previously-missing input aliases `PolicyInput`, `CubeInput`,
  `MappingInput`, `ThemeInput`, `TranslationBundleInput`, `PageInput`.

  Purely additive: no existing exports change.

- b469950: feat(spec): add a `tree` view type to the ListView schema

  `'tree'` is now a valid `ListView.type` (and `VisualizationType`), backed by a
  new `TreeConfigSchema` (`parentField` / `labelField` / `fields` /
  `defaultExpandedDepth`, passthrough). This lets a self-referencing object be
  served as a tree-grid; without it the runtime Zod-validates view metadata and
  silently drops `type:'tree'`. Renderer ships in objectui `@object-ui/plugin-tree`.

### Patch Changes

- 2a1b16b: fix(ADR-0015): honor `external.remoteName` / `external.remoteSchema` on the federation read path.

  The query path previously resolved an external object's physical table from the
  object name, ignoring its `external` binding — so a federated object bound to a
  differently-named remote table failed with `no such table`, and ADR-0015's own
  `wh_order` → `mart.fact_orders` example was unqueryable. The SQL driver now
  resolves the remote table (`remoteName`, plus `remoteSchema` via `.withSchema()`
  on pg/mysql) and registers external objects' read-coercion metadata without DDL
  (`SqlDriver.registerExternalObject`, routed from the engine/plugin schema-sync).
  The managed path is unchanged. See ADR-0015 §18.

- 3efe334: Honor a nested `where` filter inside `expand` on lookup/master_detail expansion.

  The expand post-processor batch-loads related records with an `id $in [...]` query but never merged the nested QueryAST `where`, so a documented `expand: { rel: { where: {...} } }` filter was silently ignored and every related record came back. The nested filter is now AND-merged into the batch query via an explicit `$and` group (`{ $and: [{ id: { $in } }, nestedAST.where] }`) — robust against a nested filter that itself keys `id` or uses a top-level `$or`/`$and`, where a shallow spread would clobber or reorder the constraint.

  `limit`/`offset`/`orderBy` remain intentionally not honored on the expand path: it batch-loads every parent's related records in one `$in` query and re-keys them per parent by foreign key, so a per-parent page size or ordering can't be expressed there. Docs and the schema `describe()` are updated to match, with a guard test asserting `limit`/`offset` are not pushed into the expand query.

- feead7e: fix(spec): make `GanttConfigSchema` forward-compatible via `.passthrough()`.

  The gantt renderer (objectui plugin-gantt) keeps adding view-config knobs
  (e.g. `lockField`, `defaultCollapsedDepth`) ahead of this schema. Without
  passthrough, the console — which validates the view config against a bundled
  copy of this schema before handing it to the renderer — strips any field not
  declared here, so every new renderer knob needs a spec release + console
  rebuild before it can take effect. Adding `.passthrough()` lets unknown fields
  flow through to the renderer, decoupling renderer releases from spec releases.
  Known fields keep their validation; the renderer still only reads what it
  understands.

## 9.11.0

### Minor Changes

- e7f6539: feat(spec,sharing): canonical OWD vocabulary on `object.sharingModel` (ADR-0056 D1)

  Reconciles the Org-Wide-Default naming so authors use ONE vocabulary. `object.sharingModel`
  now accepts the canonical OWD names — `private` | `public_read` | `public_read_write` |
  `controlled_by_parent` — alongside the legacy `read` / `read_write` / `full` aliases (kept,
  non-breaking). The sharing runtime maps them onto the three enforced behaviours
  (`public_read` ≡ legacy `read` = everyone reads / owner writes; `public_read_write` =
  unscoped). Unknown values remain rejected by the enum (authoring-time, fail-closed). The
  showcase announcement now declares the canonical `public_read`, exercised end-to-end by the
  public-read dogfood proof.

- 2365d07: feat(sharing): configurable role-hierarchy widening — `unit_and_subordinates` recipient (ADR-0056 D6)

  Role-hierarchy access widening ("a manager sees records shared with their team") is now
  **implemented and configurable per sharing rule**, not a hardcoded no-op. The
  `unit_and_subordinates` recipient (declarable on `sys_sharing_rule.recipient_type`) expands,
  at evaluation time, to the named role **plus every subordinate role** by walking the
  `sys_position.parent` hierarchy via a new `PositionGraphService` (mirroring the department/team
  graphs; cycle-safe). Previously `Role.parent` was declared but never consumed — a silent
  no-op flagged by the ADR-0056 audit. This is the Salesforce "grant access using hierarchies"
  model expressed declaratively: each rule chooses whether to roll up the hierarchy. Unit-proven
  (role-graph traversal, subordinate-user expansion, cycle safety); the recipient is added to
  the authoring select + the `SharingRuleRecipientType` contract.

- 6595b53: feat(security): app-declarable default profile (`isDefault`, ADR-0056 D7)

  An app can now declare its default access posture for authenticated users who have
  no explicit grants, via `isDefault: true` on a permission set — instead of always
  inheriting the built-in `member_default`. The SecurityPlugin resolves the fallback
  from the `isDefault` profile when no explicit `fallbackPermissionSet` is configured
  (falling back to `member_default` when none is declared — non-breaking). This is the
  foundation for SSO/JIT provisioning (mapping IdP claims → a declared default profile).
  Proven by the `showcase-default-profile` dogfood test: a sign-up governed by a custom
  default that grants only `showcase_announcement` can read it but is denied
  `showcase_private_note` (which the `member_default` wildcard would have allowed).

- 36138c7: feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

  `autonumberFormat` previously only understood a single `{0000}` sequence slot —
  everything else was a fixed literal prefix on one global counter. Real MES/eHR
  record numbers need three more token classes, so the format is now tokenized by a
  shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
  `renderAutonumber`) that the engine fallback and the SQL driver both call, so they
  emit byte-identical numbers (#1603 parity):

  - **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
    day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
    UTC fallback), threaded through the new `DriverOptions.timezone`.
  - **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
    field values into the prefix.
  - **Per-scope counter reset** — the counter's scope is the rendered prefix _before_
    the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
    numbers per group, and `{plan_no}{000}` numbers per parent — all from one
    mechanism, no separate reset config.

  Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
  global counter, so existing sequences are unchanged. The persistent
  `_objectstack_sequences` table is keyed by a `key_hash` (SHA-256 of
  `object, tenant_id, field, scope`) — a single 64-char primary key that keys every
  dialect uniformly, stays within MySQL's utf8mb4 index-length limit (four raw
  columns would not), and lets `scope` be a generous non-indexed column. Deployments
  with an older table (3-column, or an interim `scope` column) are migrated in place
  on first use, carrying existing counters to `scope=''`.

  Guardrails:

  - **Empty interpolated field is a hard error, not a silent mis-number.** A
    `{field}` token whose value is missing at create time would render to an empty
    prefix and collapse the record into the wrong counter scope. Both the SQL driver
    and the engine fallback now refuse to generate and throw a clear error naming the
    empty field (shared `missingFieldValues` helper).
  - **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
    checked against the object's fields: a `{field}` token naming a non-existent
    field (or the autonumber field itself) **fails the build**; a token naming an
    _optional_ field emits an advisory warning to mark it `required: true`.
  - **Migration fails safe.** If a legacy table cannot be migrated to the `key_hash`
    shape, fixed-prefix sequences keep working via the legacy key and a per-scope
    write raises an actionable error instead of corrupting counters.
  - **Long `{field}` scopes are supported** (e.g. a long `{plan_no}`): the non-indexed
    `scope` column and hashed key remove the old varchar/PK length ceiling.

  Notes on inherent semantics (documented, not bugs):

  - The counter scope IS the rendered prefix. When two records' tokens render to the
    same prefix string (e.g. `{a}{b}` for `('AB','C')` and `('A','BC')`) they also
    render the same visible number, so they share one counter to stay unique — the
    remedy for genuinely-distinct groups is an unambiguous format (a delimiter
    literal between variable tokens).
  - The sequence pad width is a MINIMUM; past it the number grows (`{000}` →
    `1000`), it never wraps — matching mainstream autonumber semantics.

- 4c213c2: Master-detail "controlled by parent" permissions (ADR-0055).

  A detail object can now declare `sharingModel: 'controlled_by_parent'`: its read/write access is derived from its master record, with no authored RLS.

  - `@objectstack/spec`: `controlled_by_parent` added to the authorable `object.sharingModel` enum.
  - `@objectstack/plugin-security`: reads inject `masterFK IN (accessible master ids)` (resolved from the master's own RLS, reusing the existing filter machinery — zero RLS-compiler changes); by-id writes (insert/update/delete) to a detail now require edit access to its master, closing the #1994-class by-id hole for derived access.
  - `@objectstack/verify`: related-record **topological synthesis** — `deriveCrudCases` no longer skips objects with required relations; it builds the object dependency graph, orders it topologically, and threads real target ids, so relationship-dense objects (and the master-detail RLS proof) are verifiable. Honest `blocked` verdicts remain for required-reference cycles and external/missing targets.

  v1 limits (per ADR-0055): the accessible-master id set is unbounded (large-tenant scale is a documented future limit), and master-detail chains are single-level (not transitively traversed).

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

### Patch Changes

- fa8964d: docs(spec): mark unenforced compliance/encryption/masking/RLS-config surface EXPERIMENTAL (ADR-0056 D8)

  Per ADR-0049's enforce-or-remove gate (and ADR-0056 D8), the security-adjacent
  schemas that are parsed but have **no runtime consumer** now carry an explicit
  `⚠️ EXPERIMENTAL — NOT ENFORCED` header so the no-op is visible to authors and the
  reference docs: GDPR/HIPAA/PCI compliance configs, field-level encryption, data
  masking, the unified security-context governance, and the global `RLSConfig` /
  `RLSAuditEvent` (distinct from the ENFORCED `RowLevelSecurityPolicySchema`, which is
  left untouched). No behaviour change — these were already inert; the marker makes
  the inertness honest rather than silent.

- a8e4f3b: Add the ADR-0054 "prove-it-runs" proof field + ratchet to the spec liveness gate. A `live` ledger entry may now carry a `proof` — a reference (`<file>#<proof-id>`) to a dogfood test that asserts the property's runtime behavior. A bound high-risk `live` property must carry a valid proof, validated statically by the liveness gate (the file exists and declares the matching `@proof:` tag). Four high-risk classes are bound this phase: field types (`field.type`), RLS (`permission.rowLevelSecurity.using`), flow nodes (`flow.nodes.type`), and analytics (`dataset.dimensions.dateGranularity`). The `dataset` metadata type is now governed (new `liveness/dataset.json`). The authoritative high-risk-class list lives in `scripts/liveness/proof-registry.mts`; see `liveness/README.md`.

## 9.10.0

### Minor Changes

- 1f88fd9: Converge the RLS contract with the reference compiler, and wire §7.3.1 dynamic membership.

  - **spec (docs)**: narrow `rls.zod.ts` to the four expression forms the compiler actually implements — `field = current_user.<prop>`, `field = 'literal'`, `field IN (current_user.<array>)`, and `1 = 1`. Removed the over-promised surface (subqueries, `AND`/`OR`/`NOT`, `LIKE`/`ILIKE`, regex, `ANY`/`ALL`, `NOT IN`, `IS NULL`, `NOW()`/`CURRENT_DATE`) from the operator list, context-variable list, and `@example` policies, and documented the fail-closed behaviour explicitly.
  - **spec (schema)**: `ExecutionContext` gains `rlsMembership?: Record<string, string[]>` — a bag of pre-resolved dynamic-membership id arrays (team members, territory accounts, shared records) that the runtime stages so RLS can scope via `field IN (current_user.<key>)` without subquery support. Generalizes the previously hard-coded `org_user_ids`.
  - **plugin-security**: `RLSCompiler.compileFilter` merges `rlsMembership` keys into the user context (arrays only, never clobbering the named `id`/`organization_id`/`roles`/`org_user_ids` fields), so §7.3.1 hierarchy- and sharing-based policies compile. `compileExpression` now recognizes `1 = 1` as always-true (empty filter), making `RLS.allowAllPolicy` grant access instead of silently failing closed. Missing/empty membership sets still fail closed.

- 1f88fd9: Add a transaction boundary to sandboxed hook/action bodies: `ctx.api.transaction(async () => { … })`. Every `ctx.api` read/write inside the callback runs in one driver transaction — committed when the callback returns, rolled back if it throws (or if the body leaves the transaction open at timeout). Guarded by the new `api.transaction` capability.

  - **spec**: new `api.transaction` capability token on `HookBodyCapability`.
  - **objectql**: `ScopedContext` gains discrete `beginTransaction()` / `commitTransaction(handle)` / `rollbackTransaction(handle)` primitives. The handle is threaded **explicitly** through a child context (`resolveTx` honors it ahead of the ambient `txStore`), because the sandbox drives the body across many host event-loop turns where AsyncLocalStorage context does not survive. Degrades to non-transactional execution when the driver has no transaction support.
  - **runtime**: the QuickJS runner wires `ctx.api.transaction` over three deferred-promise host leaves (begin/commit/rollback), routes in-transaction ops through the tx-scoped context, and rolls back a transaction the body left open before disposing the VM.

### Patch Changes

- db02bd5: Fix dashboard time-series charts / "last N months" KPIs that filter or group by a `Field.datetime` column silently returning "No rows".

  The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens (`{12_months_ago}`, `{today}`, …) to ISO date strings and binds them directly into raw SQL, bypassing the driver's own filter coercion. Under better-sqlite3 a `Field.datetime` column is stored as an INTEGER epoch (ms), so `assessed_at >= '2025-06-18'` became a TEXT-vs-INTEGER affinity compare that is always false — an empty result even though the rows exist. `Field.date` columns store ISO TEXT and were unaffected.

  The strategy now coerces a temporal comparand to the column's on-disk storage form via a new optional `StrategyContext.coerceTemporalFilterValue` hook, wired to the driver's public `SqlDriver.temporalFilterValue` (the single source of truth for the storage convention). Coercion is dialect-correct: SQLite `Field.datetime` → epoch ms; `Field.date` text and native-timestamp dialects (Postgres/MySQL) are left unchanged, so Postgres is never handed an epoch integer. Applied to `gte`/`lte`/`gt`/`lt`/`equals`, `in`/`notIn`, and the `dateRange`/timeDimension `BETWEEN` path.

- 641675d: Add `*Input` authoring-type aliases (`DatasourceInput`, `ConnectorInput`, `SharingRuleInput`, `JobInput`, `WebhookInput`, `EmailTemplateDefinitionInput`, `PositionInput`, `PermissionSetInput`, `ObjectExtensionInput`) alongside the existing `FieldInput`/`ActionInput`/`ReportInput`/`PortalInput` convention. These are `z.input<typeof XSchema>` aliases so authored literals keep `.default()` fields optional and accept CEL/Expression string shorthands — matching how `defineX()` helpers already accept input. No runtime change.
- 94e9040: fix(spec): declare the extended Gantt config fields the renderer actually reads

  `GanttConfigSchema` only declared the 5 core timeline fields as a plain
  `z.object` (no passthrough), so every other field the Gantt renderer consumes —
  `parentField`/`typeField` (two-level summary→step hierarchy), `colorField`,
  `groupByField`, `tooltipFields`, `baselineStartField`/`baselineEndField`,
  `resourceView`/`assigneeField`/`effortField`/`capacity`, `quickFilters`,
  `autoZoomToFilter` — was silently stripped by `.parse()` on both the compile-time
  protocol check and the runtime `GET /api/v1/meta/view/:object` re-validation. With
  the keys gone before render, the Gantt degraded to a flat list (no parent/child
  rows, no summary bars, no expand/collapse). These fields are now declared
  explicitly (with descriptions), so the renderer contract round-trips through the
  spec instead of requiring downstream patches.

## 9.9.1

## 9.9.0

### Minor Changes

- 84249a4: feat(action): `undoable` flag on the UI Action schema

  Single-record update actions can declare `undoable: true`. The runtime captures
  the record's prior field values and offers an "Undo" affordance on the success
  toast (backed by the client UndoManager). Pairs with the objectui runtime that
  honours it. Also documents that conditional `visible` / `disabled` CEL
  predicates are evaluated by the action renderers (used here to hide an action
  when it no longer applies, e.g. Convert Lead on an already-converted lead).

- 11af299: feat(runtime): resolve a reference timezone onto ExecutionContext (ADR-0053 Phase 2 foundation)

  Adds `ExecutionContext.timezone` (optional IANA zone) and resolves it once per request in `resolveExecutionContext`, with precedence **user preference → org default → `UTC`**:

  - User override: `sys_user_preference` row `(user_id, key='timezone')`.
  - Org default: the tenant-scoped `sys_setting` `(namespace='localization', key='timezone', scope='tenant')` — one org per physical tenant (ADR-0002), so no tenant_id filter is needed.
  - An invalid IANA zone is ignored and resolution falls through; every read is defensive and never blocks auth.

  This is **pure plumbing with no behavior change**: nothing reads `ctx.timezone` yet, and an absent value resolves to `UTC` (today's behavior). It is the foundation the rest of ADR-0053 Phase 2 consumes — tz-aware `today()`/`daysFromNow()` (#1980), datetime rendering (#1981), and analytics bucketing (#1982). A discoverable `localization` settings manifest for the org default is a follow-up; the resolver already reads the row if present.

  Part of #1978.

- d5774b5: fix(spec): `Field.rating` / `Field.vector` builders emit live props instead of dead ones

  The `Field.rating(n)` and `Field.vector(n)` builders emitted properties the
  spec-liveness ledger classifies as **dead** (silent runtime no-ops), so every
  field authored through them tripped the `liveness-dead-property` author lint:

  - `Field.rating(n)` emitted `maxRating`, but the rating renderer reads the flat
    `max` prop (`RatingField.tsx:13`). The builder now emits `max`.
  - `Field.vector(n)` emitted a nested `vectorConfig` block, but the renderer
    reads the flat `dimensions` sibling (`VectorField.tsx:11`) and nothing
    consumes `vectorConfig` (no vector-index DDL). The builder now emits the flat
    `dimensions`.

  `dimensions` is also promoted to a **declared, live** top-level `FieldSchema`
  property. It was previously only valid nested inside `vectorConfig`, so a flat
  `dimensions` authored by hand was silently **stripped** during compile (Zod
  drops unknown keys) — the renderer then saw no dimensionality. It now survives
  compilation and is governed by the liveness gate.

  `maxRating` and `vectorConfig` remain accepted by the schema (still classified
  `dead` + `authorWarn`) for back-compat, so hand-authored usages still surface
  the advisory warning rather than type-erroring.

- 134043a: feat(automation): declarative screen-flow completion/error messages + action `errorMessage`

  A screen flow can now declare `successMessage` / `errorMessage` (FlowSchema). The
  engine surfaces them on the terminal `AutomationResult` (`successMessage` on
  success, `errorMessage` on failure), so the UI flow-runner shows a meaningful
  toast instead of a generic "Done" / the raw error — no manual "success screen"
  node needed. The CRM convert-lead wizard sets a friendly completion message.

  Also exposes `errorMessage` on the UI Action schema. The runtime (ActionRunner)
  already honoured it; it just wasn't declarable in the spec — closing a
  spec↔runtime gap so authors can set a friendly failure toast.

- 9afeb2d: feat(settings): `localization` settings — platform default timezone, language & formats (ADR-0053 Phase 2)

  Adds a `localization` SettingsManifest, the missing keystone that makes the Phase 2 reference-timezone actually configurable end-to-end. One declaration gives the full settings stack for free: platform built-in default → `global` → `tenant` cascade, a permission-gated settings page, and i18n.

  **Keys** (organization-level; per-user overrides intentionally out of scope for v1): `timezone` (UTC), `locale` (en-US), `default_country`, `date_format`, `time_format`, `number_format`, `first_day_of_week`, `currency` (USD), `fiscal_year_start`. Benchmarked against Salesforce/Workday "Company Information + Locale".

  **Resolver 收编** — `resolveExecutionContext` now resolves `timezone` **and** `locale` from the `localization` settings via the `settings` service (canonical 4-tier cascade), falling back to a direct tenant-scoped `sys_setting` read, then `UTC` / `en-US`. This replaces the hand-rolled `sys_user_preference` + tenant-only `sys_setting` path from #1978 (which bypassed the settings abstraction and is dropped along with the per-user tier). New `ExecutionContext.locale`.

  **Consumer wiring** — analytics date bucketing now picks up the resolved org timezone: `DatasetExecutor` threads `ExecutionContext.timezone` into the query (precedence: explicit selection tz → request tz → UTC), so #1982's tz-aware buckets fire for a configured org without callers passing a zone. Formula `today()`/`datetime` were already wired (#1979/#1980).

  Email `datetime` rendering (`SendTemplateInput.timezone`, shipped in #1981) is intentionally **not** wired here: the only current `sendTemplate` callers are pre-session auth emails with no org context; business-notification callers can pass the zone when they appear.

- 6bec07e: feat(automation): object-form screen-flow steps

  A `screen` node that declares `config.objectName` now renders the named object's
  FULL create/edit form (including inline master-detail child grids) instead of a
  flat field list. The node emits an `object-form` `ScreenSpec`
  (`kind`/`objectName`/`mode`/`recordId`/`defaults`/`idVariable`); the client
  renders the real ObjectForm, persists the record (and its children, atomically),
  and resumes the run with the saved id bound to `idVariable` so a later step can
  reference it — e.g. a lead-conversion wizard: a full Customer step, then a full
  Opportunity-with-line-items step.

  - **spec**: `ScreenSpec` gains `kind`/`objectName`/`mode`/`recordId`/`defaults`/`idVariable`.
  - **service-automation**: the `screen` executor emits object-form specs and now
    interpolates `title`/`description`/field `defaultValue`/object-form `defaults`
    against live flow variables (the engine does not pre-interpolate node config).

- 601cc11: feat(analytics): timezone-aware date bucketing (ADR-0053 Phase 2)

  Analytics day/week/month/quarter/year buckets now resolve on a **reference timezone's** calendar days, so a row near a tz day-boundary lands in the bucket a user in that zone would expect — identically on SQLite and Postgres.

  Per ADR-0053 decision **D2**, bucketing is done **in-memory, uniformly** for non-UTC zones rather than emitting dialect-specific `date_trunc … AT TIME ZONE` (SQLite has no tz database and MySQL needs tz tables loaded, so splitting by dialect would shift bucket boundaries for the same data). `engine.aggregate({ timezone })` therefore forces the in-memory aggregation path when a non-UTC reference tz is set — the date-range `where` still goes to the driver, so only matching rows are fetched. **UTC / unset keeps the native driver fast path unchanged.**

  - New shared `calendarPartsInTz` / `calendarPartsInTzOrUtc` util in `@objectstack/core` (DST-safe via `Intl.DateTimeFormat`, never hand-rolled offset math; falls back to UTC for an unset/`'UTC'`/invalid zone).
  - `EngineAggregateOptions` and the analytics `executeAggregate` bridge / `ObjectQLStrategy` thread the reference timezone (sourced from the dataset selection / `ExecutionContext`) through to `applyInMemoryAggregation` → `bucketDateValue`, and the draft-preview evaluator's `bucketDate`.
  - `formatDateBucket` (dimension labels) stays UTC-only by design: it re-labels values that were _already_ bucketed upstream, so re-applying a timezone there would shift a correct bucket by a day.

- 575448d: feat(formula,email): render `datetime` in a reference timezone (ADR-0053 Phase 2)

  `datetime` template holes now render in a reference timezone's wall-clock when one is supplied, at the presentation boundary — storage stays UTC.

  - **Formula template engine** — the `datetime` formatter takes the reference timezone from `EvalContext.timezone` (threaded in #1980) and passes it to `Intl.DateTimeFormat`. `{{ ts | datetime }}` renders in that zone; `{{ ts | datetime:iso }}` stays UTC (machine-readable). Calendar-day `date` rendering is intentionally **unchanged** (tz-naive — a `Field.date` has no zone). New exported `formatValue(name, value, arg, { locale, timeZone })` makes the whitelisted formatters reusable outside the full CEL template engine.
  - **Email pipeline** — `plugin-email`'s renderer previously bypassed the formatter pipeline (`String()` only), so a datetime went out as raw ISO. Email holes now accept the shared formula formatters — `{{ order.total | currency }}`, `{{ ts | datetime }}` — reusing `formatValue` (single source of truth), while keeping the engine's HTML-escaping and `{{{ }}}` raw-output semantics. `SendTemplateInput.timezone` (mirroring the existing `locale`) flows into rendering so an email's datetime shows the recipient's wall-clock.

### Patch Changes

- 90108e0: feat(cli): liveness author-warning lint — close the spec-liveness loop on the author side.

  The liveness ledgers already classify every authorable property live/experimental/dead with evidence, and the CI gate enforces classification _completeness_ — but that knowledge never reached the person (very often an AI) writing the metadata. The new `compile` lint (`lint-liveness-properties.ts`) reads the ledgers and emits an advisory **warning** when an authored object/field sets a property that is misleading at runtime — e.g. `object.enable.feeds` (no feed runtime; comments live on sys_comment), `object.versioning` (no versioning engine), `field.columnName` (driver ignores it; column == field key), `field.maxRating`/`vectorConfig` (renderer reads a different key) — each with a corrective hint toward the supported alternative. Never fails the build (advisory only), consistent with the existing flow anti-pattern lint.

  Signal-over-noise by design: warnings are **opt-in per ledger entry** via a new `authorWarn`/`authorHint` annotation (plus `experimental` entries warn by default). Booleans warn only when set truthy, and only `default(false)` flags are marked, so schema defaults (`enable.trash`, `enable.searchable`) never trip it. Coverage grows by annotating more ledger entries, not by changing lint code; today it covers `object` (incl. `enable.*`) and `field`.

  - `@objectstack/spec`: ledger entries gain optional `authorWarn`/`authorHint`; `liveness/` is now shipped in the package `files` so the CLI can read it. Seeded annotations on the misleading object capability flags + aspirational blocks and the misleading dead field props. No schema/runtime change.

## 9.8.0

### Minor Changes

- 97c55b3: chore(spec): prune 15 dead field display-config properties (ADR-0049 / dead-surface plan). Removes `FieldSchema` enhanced-type _display_ knobs that had no runtime reader and no renderer consumer (dead in both layers per the field liveness audit): code `theme`/`lineNumbers`, rating `allowHalf`, location `displayMap`/`allowGeocoding`, address `addressFormat`, color `colorFormat`/`allowAlpha`/`presetColors`, slider `showValue`/`marks`, barcode/qr `barcodeFormat`/`qrErrorCorrection`/`displayValue`/`allowScanning`. The wired knobs (`language`, `maxRating`, `step`) and the functional nested configs (`currencyConfig`/`vectorConfig`/`fileAttachmentConfig`) are kept. Field _types_ are unchanged; only unused optional config props are removed. Narrows the false spec surface (narrow-and-true).
- 1b1f490: chore(spec): prune 7 dead field governance/compliance properties (dead-surface plan, P0/P2). Removes `FieldSchema` props that implied data-protection/governance behavior but had no runtime consumer — false promises (the real at-rest channel is `type: 'secret'`): `encryptionConfig`, `maskingRule`, `auditTrail`, `cached`, `dataQuality`, `writeRequiresMasterRead`, `trackFeedHistory`. Also drops the now-unused `EncryptionConfigSchema`/`MaskingRuleSchema` imports. Kept `caseSensitive` and `dependencies` (potentially functional — conservative). Field types unchanged.

## 9.7.0

## 9.6.0

### Minor Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

### Patch Changes

- d1e930a: feat(spec): model action-param translations in TranslationData (`_actions.params`) so action param label/helpText/placeholder/options can be localized via the keys+bundles path. Additive and optional — existing bundles unaffected.
- 5e3a301: fix(spec): surface hook `retryPolicy` and `timeout` in the Studio hook designer form (Execution section), completing schema coverage.
- 5db2742: chore(spec): mark every PolicySchema property `[EXPERIMENTAL — not enforced]` (ADR-0049, #1882). PolicySchema (password/network/session/audit + `forceMfa`, IP allow-list, retention) is parsed but has no runtime consumer — `better-auth` runs hardcoded defaults. The per-property markers make the no-op explicit in the generated reference docs (previously `forceMfa` read "Require 2FA for all users" with no caveat — a false-compliance signal) and to the spec-liveness gate, which now classifies them `experimental` rather than `dead`. Description-only; no behaviour change.

## 9.5.1

### Patch Changes

- ee72aae: fix(spec): render action `body` as a composite editor (language + source) instead of a flat code field

  An action's `body` is a discriminated union (`HookBodySchema`), the same shape hooks use, but `action.form.ts` mapped the whole field to `{ widget: 'code' }`, so the Studio inspector fed the union object to a single JS editor and rendered `[object Object]`. The layout now mirrors the working `hook.form.ts`: a composite with a `language` select, a `source` code editor, and the L2-only capability/timeout knobs.

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

- 707aeed: ui(page.form): sourceView is a view picker; hide template on list pages

  - `interfaceConfig.sourceView` now declares `widget: 'view-ref'` + `dependsOn: 'source'` so the page editor renders a dropdown of the source object's views instead of a free-text input (where an author could type a non-existent view name). The objectui `view-ref` widget reads the source object's views; until it ships, the field degrades to the existing text input.
  - The `template` field is now hidden for `type == 'list'` (`visibleOn: "data.type != 'list'"`). A list/interface page renders via InterfaceListPage and ignores the region template, so showing the field only added noise — same rationale as the already-hidden Data Context / Layout sections.

- 7a103d4: ui(page.form): icon field uses the searchable icon-picker widget

  The Basics → `icon` field now carries `widget: 'icon'`, so the metadata-admin
  form renders a searchable Lucide icon picker (preview + name) instead of a raw
  text input where authors had to type an exact icon name. Mirrors the existing
  `view-ref` / `filter-mode` widget hints; the picker ships in
  `@object-ui/app-shell` and is reusable for app/object icon fields.

- 4b01250: ui(page): page `type` is the page kind, not a visualization

  Removed `grid` / `kanban` / `calendar` / `gallery` / `timeline` from `PageTypeSchema`. They are visualizations of a `list` (interface) page — configured via `interfaceConfig.appearance.allowedVisualizations` and switched at runtime — never distinct page kinds. The runtime never branched on them as page types (it always read the visualization from `interfaceConfig`), so they only misled authors (e.g. selecting page type "kanban" did nothing). `VisualizationTypeSchema` is unchanged and remains the home for those values.

  The roadmap interface kinds (`dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`) stay valid in the schema but the page authoring form (`page.form.ts`) now offers only the kinds with a dedicated renderer — `list`, `record`, `home`, `app`, `utility` — with explicit labels, so the dropdown stops presenting dead options.

## 9.4.0

### Minor Changes

- 060467a: feat(ADR-0046): add optional `description` to package docs

  A doc can now carry a one-line `description` (frontmatter `description:`),
  giving the natural minimal model: title / summary / body. `DocSchema` gains an
  optional `description`; `os build` reads it from frontmatter. It travels in the
  `GET /meta/doc` list response (unlike `content`, which the list omits), so a
  docs portal can show summaries without fetching each body. Example docs
  (app-showcase, app-todo) updated.

  Also records the deferred-to-P3 design for doc **tags** in ADR-0046: tags are
  keys (i18n-resolved, never display strings), with a small protocol core
  vocabulary plus namespace-prefixed package tags — not a field to bolt on early.

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

- b678d8c: feat(spec): page form filter-mode widget + ADR-0047 §3.4a (omit-is-none)

  The Interface section's `interfaceConfig` composite now lists its sub-fields
  explicitly so `userFilters` can use the dedicated `filter-mode` selector widget
  (None / Tabs / Dropdown, objectui). An unknown widget name degrades gracefully
  to the prior composite rendering, so this is independently mergeable.

  ADR-0047 §3.4a records the design decision: "no filter bar" is the ABSENCE of
  `userFilters`, not a literal `element: 'none'` — presence and style are
  orthogonal axes, keeping declarative metadata and overlay diffs clean. The
  `userFilters` element `'toggle'` is deprecated (kept in the enum for back-compat;
  authoring offers None/Tabs/Dropdown only, Airtable parity).

- b678d8c: feat(spec): ADR-0047 — list pages hide region/data-context, interface section prominent

  Reorganizes the page form (`page.form.ts`) so interface/list pages get a lean,
  relevant panel instead of the generic page-form dump:

  - Data Context + Layout sections gain `visibleOn` `data.type != 'list'` (region
    designer / page object don't apply to a list surface).
  - Interface section becomes primary content (`collapsed: false`, named for i18n).
  - `interfaceConfig` sub-fields reordered (common first, rare last); `source`
    gets the `ref:object` picker; `sourceView`/`userActions`/etc. gain helpText.
  - `type` field helpText notes `'list'` = interface page.

### Patch Changes

- b678d8c: fix(service-ai): resolve the current object for AI chat across languages

  The console assistant reported "can't find the X object" when asked to analyse
  the object on the current page — most visibly for non-English prompts. Three
  compounding gaps fixed:

  - `SchemaRetriever.tokenise()` dropped all CJK text, so a Chinese request
    yielded zero terms; it now emits CJK single-char + bigram terms.
  - Nothing fed the current object's schema to the agent, so "this object" could
    not be resolved without a lucky keyword hit. `AgentRuntime.buildContextSchema
Messages()` now injects the current object's schema into the system prompt and
    both chat routes call it.
  - `ToolExecutionContext` (and the `ai-service` spec contract) gains
    `currentObjectName`/`currentViewName`; routes thread them through and
    `query_data` falls back to the current object when keyword retrieval is empty
    (so the open edition, which lacks `describe_object`/`list_objects`, still
    resolves the page's object).

## 9.3.0

### Minor Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- 50b7b47: Approvals server-side pagination + search pushdown (#1745). `listRequests` accepts `q` / `limit` / `offset` — free-text search pushes into the engine query as an `$or` of `$contains` terms (the `payload_json` snapshot carries record titles, so titles match without a join), and the page window pushes down whenever the filter is fully pushable; approver/status-array filters still post-filter their bounded scan and window in memory (the documented residual until the approver join-table follow-up). New `countRequests` returns the unwindowed total (engine `count` when pushable). REST: `GET /approvals/requests` gains `q`/`limit`/`offset` and returns `{data, total}` when paging.
- f15d6f6: ADR-0042 SLA auto-escalation + ADR-0041 mechanical landing. plugin-approvals now owns a jobs-backed escalation scanner (`runEscalations`, interval job `approvals-sla-escalation` + boot catch-up): overdue pending requests escalate **at most once** (the `escalate` audit row is the idempotency marker, written audit-first) executing the node's `escalation.action` — notify / reassign-to-`escalateTo` / auto_approve / auto_reject as the reserved actor `system:sla`. The trigger packages drop their `plugin-` prefix (`@objectstack/trigger-record-change`, `@objectstack/trigger-schedule`) per ADR-0041, and `ActionDescriptor` gains an optional `maturity: 'ga' | 'beta' | 'reserved'` field so designers can grey out contract-ahead-of-runtime surfaces.
- f8684ea: Approvals thread interactions — the collaboration layer between submit and decide. `reassign()` hands a pending-approver slot to someone else (audit-first ordering, new approver notified via the optional `messaging` service), `remind()` nudges every pending approver with a 4h per-request throttle (`THROTTLED` → HTTP 429), `requestInfo()` sends a request back to the submitter for more material while it stays pending, and `comment()` adds free-form thread replies. Rows expose `sla_due_at` (`created_at + escalation.timeoutHours`, display-only) and single reads attach `flow_steps` (the owning flow's approval trunk with done/current/upcoming states). REST grows the four matching POST routes; the `sys_approval_action.action` enum gains the new kinds.
- b4765be: Server-side totals for matrix reports (#1753). `queryDataset` selections accept `totals: { groupings: string[][] }` — each grouping a subset of `selection.dimensions` to additionally aggregate by (`[]` = grand total); the marginal rows come back on `AnalyticsResult.totals` in request order. Each subtotal/grand total re-runs the full executor pipeline (measure-scoped filters, derived measures, compareTo) grouped only by that subset, so totals use each measure's true aggregate over the underlying rows — an `avg` total is the average of all rows, never an average of bucket averages (the ADR-0021 line that forbids client-side re-aggregation). Dimension display labels resolve on totals rows the same as the primary grid. A matrix report renderer asks for `{ groupings: [rowDims, columnDims, []] }` and renders the supplied totals row/column.

### Patch Changes

- 3219191: ADR-0043 actionable approval links (#1743). `remind()` now fans out per approver: every concrete identity gets its own single-use approve/reject links in the notification payload. Tokens are 256-bit, stored as SHA-256 hashes only (`sys_approval_token`), scoped to one request + action + approver, 72h TTL, consumed-before-decide (replay burns), and re-validated at redemption against the live request (decided/recalled/reassigned ⇒ dead link). The plugin mounts a session-less bilingual confirm page at `GET /api/v1/approvals/act` (renders only — mail-gateway prefetch safe) and redeems exclusively on the `POST`, auditing the decision as the bound approver.

## 9.2.0

### Minor Changes

- 2f57b75: Approvals display contract v2 — no raw identifiers reach a business reviewer. The inbox enrichment pass now resolves the three remaining id leaks: `payload_display` resolves lookup/master_detail foreign keys in the snapshot to the referenced record's display title (batched one query per object), `pending_approver_names` resolves user-id approvers via `sys_user` (id or email; `role:<r>` literals stay as-is), `object_label` rides the target object's schema label on the row, and `listActions` rows carry `actor_name` so the audit timeline never shows an id.
- 2f57b75: ADR-0040: unify the platform assistant. The default `data_chat` agent becomes the single platform assistant carrying both the data and authoring registers — the end user never picks an agent. It gains the `metadata_authoring` and `solution_design` skills (registered by the cloud AI Studio plugin; data-only deployments degrade gracefully as the skill registry ignores unresolved names), an intent preamble that classifies build/change vs data intent first and applies that register's discipline without mixing registers or narrating failures, an 'Assistant' persona, temperature 0.2, a guardrail blocklist union minus `alter_schema`/`drop_table` (the build register is draft-gated schema work per ADR-0033), a 60s execution budget, and react ×10 planning with replan.

## 9.1.0

### Minor Changes

- b9062c9: ADR-0021 D2: `Report` gains `columns` (dimension names across — a `matrix` report pivots `rows` × `columns` with `values` in the cells; also on joined blocks) and `drilldown` (boolean, default `true` — click an aggregated row/cell to open the underlying records). `reportForm` surfaces both in the Dataset binding section (`columns` visible for matrix only).

## 9.0.1

### Patch Changes

- 1817845: reportForm now matches the 9.0 dataset-bound ReportSchema (ADR-0021): the authoring form declares `dataset` / `values` / `rows` / `runtimeFilter` instead of the removed query-form fields (`objectName` / `columns` / `groupingsDown` / `groupingsAcross` / `filter`), so editors no longer offer fields the schema strips at parse time.

## 9.0.0

### Major Changes

- 4c3f693: ADR-0021 single-form cutover (BREAKING): the inline analytics author surface is
  removed — every dashboard widget, report, and list-chart must now bind a
  semantic `dataset` and select dimensions/measures **by name**.

  Removed from the spec:

  - **DashboardWidget** — `object`, `categoryField`, `categoryGranularity`,
    `valueField`, `aggregate`, `measures` (and the `WidgetMeasure` schema/type).
    `dataset` + `values` are now required; `filter` is the presentation-scope
    runtimeFilter; `dimensions` / `compareTo` are retained.
  - **Report** — top-level (and joined-block) `objectName`, `columns`,
    `groupingsDown`, `groupingsAcross`, `filter`. A non-joined report now requires
    `dataset` + `values`; `rows` are the dimensions.
  - **ListChart** — `xAxisField`, `yAxisFields`, `aggregation`, `groupByField`.
    `dataset` + `values` are now required.

  Migration: replace the inline query with a `defineDataset(...)` and reference it
  by name. A flat record listing (the former `tabular` report / inline list) is an
  object-bound ListView (ADR-0017), not an analytics dataset. See
  `docs/adr/0021-analytics-dataset-semantic-layer.md` and the
  `content/docs/guides/analytics-datasets.mdx` guide.

- 1c83ee8: BREAKING: `ChartTypeSchema` drops 8 variant types that only rendered as their
  base chart, so the taxonomy now advertises only families the renderer draws
  distinctly.

  Removed: `grouped-bar`, `stacked-bar`, `bi-polar-bar` (→ bar — no multi-series
  grouping/stacking), `stacked-area` (→ area), `step-line`, `spline` (→ line),
  `pyramid` (→ funnel), `bubble` (→ scatter — no size encoding).

  Kept: bar / horizontal-bar / column, line / area, pie / donut / funnel, scatter,
  treemap / sankey, radar, table / pivot, and the single-value performance family
  (metric / kpi / gauge / solid-gauge / bullet — these render an honest value
  today and gain a dial when a gauge renderer lands).

  Migration: a widget/series using a removed type should switch to its base
  (`stacked-bar`→`bar`, `spline`→`line`, `pyramid`→`funnel`, `bubble`→`scatter`,
  etc.). These can return via an opt-in renderer once a real renderer + data model
  backs them.

### Minor Changes

- 0bf39f1: `queryDataset` now carries each measure's display `label` and `format` on the
  result `fields`, so presentations can show "Tasks" / "$616,000" instead of the
  raw measure name "task_count" / "616000".

  - `AnalyticsResult.fields[]` gains optional `label?` and `format?`.
  - The dataset executor enriches measure columns from the dataset's measure
    definitions (matching `<name>` and `<name>__compare`).

  The format can't be baked into the numeric row value (charts need the raw
  number), so the renderer applies it at display time.

### Patch Changes

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

## 8.0.1

## 8.0.0

### Minor Changes

- b990b89: fix(autonumber): one owner for autonumber generation — the persistent driver sequence (#1603)

  Autonumber values were generated in TWO places: the SQL driver's persistent,
  atomic `_objectstack_sequences` table AND a non-persistent in-memory counter in
  the ObjectQL engine. Because the engine pre-filled the field BEFORE calling the
  driver, the driver always saw a value already set and skipped — so the
  persistent sequence was effectively dead code, and a multi-instance / post-restart
  deployment could mint duplicate numbers from the in-memory counter.

  This makes generation single-owner:

  - **`@objectstack/spec`** — `DriverCapabilities` gains an optional `autonumber`
    flag: "driver natively generates persistent autonumber/sequence values".

  - **`@objectstack/driver-sql`** — advertises `supports.autonumber = true`.
    `bulkCreate()` now fills autonumber fields too (previously only `create()` /
    `upsert()` did), so bulk inserts also draw from the persistent sequence.
    Field parsing now honors either the spec-canonical `autonumberFormat` key OR
    the `format` shorthand (both appear in metadata).

  - **`@objectstack/objectql`** — when the driver advertises native autonumber
    support, the engine NO LONGER pre-fills (it defers entirely to the persistent
    driver sequence as the single source of truth). For drivers without native
    support (memory, mongodb) the in-memory fallback is unchanged. The fallback
    also now reads either `autonumberFormat` or `format`. Record-validation
    exempts `autonumber` fields from the `required` check — the value is
    runtime-owned and assigned after validation, so a required record number is
    never rejected as "missing".

  No metadata changes required. Existing data is respected: the driver bootstraps
  each sequence from the current max numeric tail on first use.

- 99111ec: Field-level conditional rules (CEL): `visibleWhen` / `readonlyWhen` / `requiredWhen`, enforced server-side.

  Add three CEL-predicate field props (over `record`) evaluated on both sides. **Spec**: `visibleWhen` / `readonlyWhen` / `requiredWhen` (`requiredWhen` canonical; `conditionalRequired` kept as a back-compat alias). **Server (objectql)**: the validator now enforces `requiredWhen`/`conditionalRequired` over the merged record (so the rule can't be bypassed by a direct API write), and the update path ignores writes to a field whose `readonlyWhen` is TRUE (keeps the persisted value). `needsPriorRecord` accounts for conditional fields so the prior record is fetched on update.

- d5a8161: feat(spec): resilientFetch — timeout + backoff for outbound HTTP (P1-1)

  Outbound calls in the connectors/embedder were naked `fetch` with no timeout or
  retry, so a slow or rate-limited external API could hang an agent turn with no
  recovery.

  New shared `resilientFetch` (`@objectstack/spec/shared`):

  - per-attempt timeout via `AbortController` (default 30s);
  - exponential backoff with jitter, up to 3 attempts, on network errors / 429 / 5xx;
  - honours a `Retry-After` header on 429;
  - never retries a caller-initiated abort (intentional cancellation).

  Wired into `connector-rest`, `connector-slack`, and `embedder-openai`.
  `connector-mcp` talks through the MCP SDK transport, so it gets a 30s per-request
  `timeout` on `callTool` / `listTools` instead.

  A stateful per-host **circuit breaker** is deliberately left as a follow-up:
  timeout + backoff already removes the hang/no-recovery risk.

- 5cf1f1b: feat(spec): `inlineEdit` on relationship fields for declarative master-detail

  A `master_detail`/`lookup` field can now declare `inlineEdit: true` (plus
  optional `inlineTitle` / `inlineColumns` / `inlineAmountField`) to mean "these
  child records are entered/edited inline within the parent's form". The intent
  lives in the data model: the parent's standard create/edit form then renders an
  atomic master-detail form (object fields + an editable child grid) with no form
  view config and no bespoke page. Use for line-item/composition children; leave
  off for associations (comments, attachments). Renderer support is in objectui.

- 9ef89d4: feat(spec): `FormViewSchema.subforms` for config-driven master-detail

  A form view can now declare inline child collections via `subforms`, so the
  standard create/edit form for an object can render as a master-detail form
  (object fields on top, an editable child grid below, persisted atomically)
  without a bespoke page. Each entry needs only `childObject`; the relationship
  FK and grid columns are derived from the child object's metadata (override via
  `relationshipField` / `columns`). Renderer support: ObjectForm already renders
  `subforms` (objectui), and the ObjectView form path passes them through.

- 9e2e229: feat(objectql): compute roll-up `summary` fields server-side

  The `summary` field type was declared in the spec but never computed — its value
  stayed empty. ObjectQL now recomputes roll-up summaries automatically: a parent
  field whose `summaryOperations` aggregates (`count`/`sum`/`min`/`max`/`avg`) a
  field across child records is recalculated whenever a child is inserted,
  updated, or deleted.

  - **`@objectstack/spec`** — `summaryOperations` gains an optional
    `relationshipField` (the child→parent FK). When omitted the engine
    auto-detects it from the child's `lookup`/`master_detail` field whose
    `reference` points back at the parent; set it explicitly only when the child
    has more than one such reference.

  - **`@objectstack/objectql`** — after `afterInsert` / `afterUpdate` /
    `afterDelete` on a child object, the engine finds the affected parent (from
    the child's FK, plus the prior FK on update/delete so a re-parented child
    updates both), re-aggregates the child collection, and writes the result onto
    the parent's summary field. It runs in the caller's execution context, so when
    a transaction is open (e.g. the cross-object `/api/v1/batch`) the rollup
    commits atomically with the child writes. A small index of child→summary
    descriptors is built lazily from the registry and invalidated on package
    registration.

  Empty collections roll up to `0` for `count`/`sum` and `null` for
  `min`/`max`/`avg`. This lets master-detail forms stop computing parent totals on
  the client — the server is now the single source of truth.

### Patch Changes

- a46c017: feat(ai): actions opt in to being AI tools via an `ai:` block (ADR-0011)

  Realigns ADR-0011 with its original opt-in design. An Action becomes an
  AI-callable tool only when its metadata sets `ai.exposed: true`, which requires
  an explicit, LLM-facing `ai.description` (≥40 chars, distinct from the UI
  `label`). There is no heuristic auto-exposure and no description derived from
  the label — a clean break from the first implementation's opt-out `aiExposed`
  flag, which is removed (no compatibility shim; the platform has not shipped).

  The `ai:` block also carries `category`, `paramHints` (per-parameter JSON-Schema
  refinement), `outputSchema` (summarised into the tool description for chaining),
  and `requiresConfirmation` (overrides the destructive-action HITL default).
  `AIToolDefinition` is extended to carry `category` / `outputSchema` / `objectName`
  / `requiresConfirmation`. The `@objectstack/service-ai` bridge
  (`action-tools.ts`) now gates on opt-in, merges `paramHints`, and emits a lint
  warning when an exposed destructive-looking action asserts itself safe via
  `ai.requiresConfirmation: false`.

- 3306d2f: feat(automation): surface structured-region body steps in run observability (#1505)

  `loop` / `parallel` / `try_catch` previously ran their body, branch, and handler
  regions against a region-local step log that was **discarded** — run logs
  (`listRuns` / `getRun`) showed the container as a single opaque step, hiding the
  per-iteration / per-branch steps that actually executed.

  `AutomationEngine.runRegion()` now **returns** its body steps, and the container
  node folds them into the parent run log via a new `NodeExecutionResult.childSteps`
  field. Each surfaced step is tagged with its **immediate** container via three new
  optional fields on `ExecutionStepLogSchema` (and the engine's `StepLogEntry`):

  - `parentNodeId` — the enclosing `loop` / `parallel` / `try_catch` node
  - `iteration` — zero-based loop iteration or parallel branch index
  - `regionKind` — `loop-body` | `parallel-branch` | `try` | `catch`

  Tagging fills only fields left undefined, so nested regions keep each step's
  innermost container. A failed try-region attempt's partial steps are still not
  surfaced (preserving `try_catch` retry semantics). Fully additive — existing run
  logs and consumers are unaffected.

- bc44195: chore(automation): retire the `workflow_rule` authoring paradigm (ADR-0018 M5 dropped)

  ADR-0019 already removed the Workflow-Rule → Flow compiler (Workflow Rules were
  removed in #1398 and `workflow` was reclaimed for state machines), but the
  `workflow_rule` paradigm tag survived in `ActionParadigmSchema` and on every
  built-in node descriptor. There is no declarative Workflow-Rule authoring view
  to feed, so the tag is now retired: `ActionParadigmSchema` keeps `['flow',
'approval']`, and the `http` / `notify` / `connector_action` descriptors (plus
  the deprecated-alias fallback) advertise `['flow', 'approval']`. Approval
  execution convergence is delivered by the ADR-0019 approval Flow node, not a
  compiler. ADR-0018's status and migration table are updated to mark M3 shipped,
  M4 framework-complete, and M5 dropped.

## 7.9.0

## 7.8.0

### Minor Changes

- 36719db: fix: AI-built apps are usable immediately — sync new object tables on publish + emit valid kanban config

  Two gaps found by end-to-end testing of an AI-built app:

  1. **A freshly-published object couldn't accept records until a server restart.** Publishing a drafted object registered it in the in-memory registry but never created its physical table (table sync only ran at boot), so inserts failed with `object_not_found` ("no such table"). Added `ObjectQL.syncObjectSchema(name)` (a targeted, idempotent single-object schema sync) and call it from the publish paths (`protocol.publishMetaItem` and `saveMetaItem` mode:'publish', via `ensureObjectStorage`). Best-effort + non-fatal. New objects are now CRUD-able the moment they're published.

  2. **AI-generated kanban views rendered as plain lists** (and sometimes failed validation). The blueprint `viewBody` emitted `list.type:'kanban'` with no `kanban` config; `KanbanConfigSchema` requires `groupByField` **and** `columns`. Added an optional `groupBy` to the blueprint view schema (lenient + strict) and have `apply_blueprint` set `list.kanban = { groupByField, columns }` — using the view's explicit `groupBy` when given, else inferring the object's first `select` field. AI-built kanban views now validate, publish, and carry a real group-by field.

### Patch Changes

- 06f2bbb: fix(ai): make ADR-0033 blueprint authoring work with OpenAI structured outputs

  Two bugs surfaced by a live end-to-end run (Studio chat → blueprint → draft → review → publish) against a real model (OpenAI via the Vercel AI Gateway) — both invisible to the existing unit tests:

  1. **`propose_blueprint` failed against OpenAI strict structured outputs.** `SolutionBlueprintSchema` uses optional fields and a free-form `seedData` record; OpenAI's strict mode requires every property listed in `required` and rejects open `additionalProperties`, so `generateObject` errored (`'required' … must include every key in properties`) and the agent silently fell back to free-text. Adds `SolutionBlueprintStrictSchema` — a strict-compatible mirror (optional → nullable, no `z.record`) used **only** as the `generateObject` output contract. The lenient `SolutionBlueprintSchema` (and every existing consumer/test) is unchanged; the blueprint tools strip the `null`s the strict contract emits so downstream stays clean.

  2. **Tool-only assistant turns failed to persist.** `ai_messages.content` is required, but an assistant turn that only calls a tool has no text, so the insert failed, the turn was dropped, and the next turn lost context (the agent re-proposed instead of applying the confirmed blueprint). `ObjectQLConversationService.addMessage` now synthesizes a readable placeholder from the tool names (`(called propose_blueprint)`) plus a defensive non-empty fallback.

  With both fixes the full plan-first loop runs end-to-end on OpenAI models: propose → confirm → batch-draft objects/views/dashboards/app → review/diff → publish.

- 424ab26: fix(seed): reject object-wrapped relationship references and constrain them at compile time

  Seed datasets resolve `lookup` / `master_detail` references by matching the value
  against the target record's externalId — so the value must be the plain natural-key
  string (e.g. `account: 'Acme Corp'`), never a wrapper object like
  `account: { externalId: 'Acme Corp' }`. The wrapper was silently skipped by the
  loader, fell through unresolved, and reached the SQL driver as a non-bindable value —
  masked on an always-empty `:memory:` DB but crashing on a persistent one with
  "SQLite3 can only bind numbers, strings, bigints, buffers, and null" once seeds re-ran
  as updates.

  - `defineDataset` now constrains reference fields to `string | null` at compile time
    (derived from each field's `type`), so the object form is a type error.
  - `SeedLoaderService` now fails loudly with an actionable message (and drops the value
    instead of handing it to the driver) when a reference is an object — consistent
    behavior across all drivers, no longer silently masked.

## 7.7.0

### Minor Changes

- b391955: feat(ai): blueprint app-building — propose/draft the navigation app, not just the data model

  The plan-first blueprint (ADR-0033 §4) now also designs the **app** (the navigation shell end users open in the App Launcher), so "build me a project-management application" yields an openable app — not just its objects, views, and dashboards.

  - `SolutionBlueprintSchema` (`@objectstack/spec/ai`) gains an optional `app: { name, label?, icon?, nav? }`, where each nav entry targets a created object or dashboard. `nav` may be omitted to auto-surface every object (then dashboard).
  - `apply_blueprint` expands the app into an `AppSchema` body (single-level `navigation` of object/dashboard items) and drafts it last — through the same draft-gated, per-type-validated `stageDraft` path as everything else. It never sets `isDefault`.
  - `propose_blueprint` now asks the agent to include the app and reports `counts.app`.

  Still draft-gated: nothing is live until the human publishes. Scope is basic app-building (one app, flat nav); areas/groups/mobile-nav remain author-it-later via `update_metadata`.

- f06b64e: feat(ai): ADR-0033 Phase C — plan-first blueprint authoring

  For high-level goals ("build me a project-management system") the metadata assistant now designs before it builds. Adds a `SolutionBlueprintSchema` (`@objectstack/spec/ai`) describing proposed objects, fields, relationships, views, dashboards, and seed data with stated assumptions, plus two tools:

  - `propose_blueprint(goal)` — emits a structured blueprint via structured output. **Nothing is persisted**; the agent presents it for conversational confirmation and asks at most 1–2 structure-deciding questions.
  - `apply_blueprint(blueprint)` — only after the human approves, batch-drafts every artifact through the Phase A draft path (`protocol.saveMetaItem({mode:'draft'})`), validated per-type and partial-tolerant (a bad item is reported, the rest still draft). Seed data is reported as proposed, not auto-applied (no runtime `dataset` type).

  A new `solution_design` skill carries the plan-first instructions and is bound to `metadata_assistant` alongside `metadata_authoring`. The shared draft-write primitive is exported from the metadata tools as `stageDraft` and reused, keeping one draft-write path.

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

## 7.6.0

### Minor Changes

- 955d4c8: ADR-0018 M3: unified `http` / `notify` executors backed by a generic HTTP outbox.

  Promotes a reliable outbound-HTTP delivery outbox into `service-messaging` (the
  raw-callout counterpart to the notification outbox) and routes the Flow `http`
  node through it — closing the "`http_request` is a bare `fetch()` with no retry"
  gap. The five divergent outbound verbs collapse onto canonical `http` / `notify`.

  **`@objectstack/service-messaging` (additive):**

  - `IHttpOutbox` / `HttpDelivery` generic raw-callout shape
    (`source` / `refId` / `dedupKey` / `label` / `signingSecret`), `SqlHttpOutbox`
    over a new `sys_http_delivery` object, `MemoryHttpOutbox`, `HttpDispatcher`
    (per-partition cluster lock, claim/ack/retry/dead-letter), and a shared
    `sendOnce` + 7-step jittered retry schedule.
  - `MessagingService` gains `setHttpOutbox()` / `isHttpDeliveryReady()` /
    `enqueueHttp()`; the plugin wires the outbox + dispatcher at `kernel:ready`.

  **`@objectstack/service-automation`:**

  - Canonical `http` executor — `durable: true` enqueues onto the messaging HTTP
    outbox (retry/dead-letter); otherwise an inline `fetch()` preserving
    `http_request`'s request/response semantics.
  - `engine.registerNodeAlias()` — registers a delegating executor + a
    `deprecated` / `aliasOf` descriptor. `http_request` / `http_call` / `webhook`
    are now deprecated aliases of `http`; existing flows keep running.
  - `notify` descriptor marked `needsOutbox` (its delivery is outbox-backed).

  **`@objectstack/spec`:** `flow.zod` adds `http` to the builtin node-type seed set.

  `plugin-webhooks` cut-over to the shared outbox is a deliberate follow-up.

- b046ec2: feat(automation): BPMN ⇄ structured-construct model mapping (ADR-0031, task 5)

  Add the semantic bridge between the structured control-flow constructs (the
  native model) and the BPMN gateway/boundary/multi-instance vocabulary (kept for
  interop only), at the **flow-model level** — independent of any wire format
  (`automation/bpmn-mapping.ts`):

  - `exportConstructsToBpmn(flow)` expands each construct into its BPMN
    interchange shape — `parallel` → `parallel_gateway` (AND-split) + branch
    regions + `join_gateway` (AND-join); `try_catch` → the protected activity +
    an error `boundary_event` + the handler region; `loop` → its body marked with
    multi-instance loop characteristics — so external BPM tools see a well-formed
    BPMN graph. Each expansion's anchor carries an `osConstruct` extension marker.
  - `importBpmnToConstructs(flow)` folds that BPMN shape back into the constructs:
    exact reconstruction from the `osConstruct` marker (so `construct → BPMN →
construct` is identity), and a best-effort structural fold of foreign
    `parallel_gateway`/`join_gateway` pairs, with diagnostics for shapes it can't
    safely fold.

  BPMN 2.0 **XML** (de)serialization layers on top of this mapping and remains a
  plugin concern (per `bpmn-interop.zod.ts`), out of scope here.

- 2170ad9: client SDK: add `approvals` namespace; remove dead workflow approve/reject surface (ADR-0019)

  ADR-0019 collapsed approval into Flow: approval is no longer a workflow step but
  a first-class **flow node** that opens a request and suspends the run, with a
  human decision resuming the flow down the matching `approve` / `reject` edge.
  The server already exposes this as a dedicated `/api/v1/approvals` surface
  (`registerApprovalsEndpoints`), but the client SDK still carried the old
  approval-on-`workflow` methods, which pointed at routes that never existed.

  - **`@objectstack/client`** gains a `client.approvals` namespace backed by the
    real REST surface:

    - `listRequests(filter?)` → `GET /approvals/requests` (the "my approvals"
      inbox; filter by `status` (single or array), `object`, `recordId`,
      `approverId`, `submitterId`).
    - `getRequest(id)` → `GET /approvals/requests/:id`.
    - `approve(id, { actorId?, comment? })` / `reject(id, …)` →
      `POST /approvals/requests/:id/{approve,reject}` (records a decision and
      resumes the owning flow run).
    - `listActions(id)` → `GET /approvals/requests/:id/actions` (audit trail).

    The approval runtime types (`ApprovalRequestRow`, `ApprovalActionRow`,
    `ApprovalStatus`, `ApprovalDecisionInput`, `ApprovalDecisionResult`) are
    re-exported so consumers can type the namespace without reaching into
    `@objectstack/spec`.

  - **Removed the dead workflow approve/reject surface.** `client.workflow.approve`
    / `client.workflow.reject` and the backing `WorkflowApprove*` / `WorkflowReject*`
    protocol schemas, types, `IProtocolService` methods, and the `/approve` /
    `/reject` entries in `DEFAULT_WORKFLOW_ROUTES` are gone — approval decisions
    are no longer recorded on a workflow record. `workflow` is reclaimed for state
    machines, so `getConfig` / `getState` / `transition` are unchanged.

  - Discovery advertises the new route key: `ApiRoutesSchema.approvals`.

- 7648242: Enforce every declared validation-rule type on the write path; trim the three that can't be (#1475).

  The `validations` union advertised nine rule types but only three (`state_machine`,
  `cross_field`, `script`) ran on insert/update — the other six were accepted by the
  schema yet silently did nothing. This closes that gap on both sides: implement the
  synchronous types, and trim the ones that don't belong in a write-path rule.

  **`@objectstack/objectql` (additive):** the rule evaluator now enforces three more
  types, all deterministic, synchronous, side-effect-free predicates over one record:

  - `format` — a field value against a `regex` and/or a named format
    (`email` / `url` / `phone` / `json`). Runs only when the write touches the field
    and the value is non-empty; a malformed regex fails open.
  - `json_schema` — a JSON field validated against a JSON Schema via `ajv` (compiled
    result memoised per schema). Accepts a parsed object or a JSON string; an
    unparseable string is itself a violation; an uncompilable schema fails open.
  - `conditional` — evaluates `when`, then recurses into `then` / `otherwise`. The
    nested rule supplies the message; the outer conditional's `severity` decides
    blocking. `needsPriorRecord` now recurses into conditional branches.

  Adds `ajv` as a dependency and three error codes (`invalid_format`, `invalid_json`,
  `json_schema_violation`).

  **`@objectstack/spec` (breaking for unused declarations):** removes the
  `unique`, `async`, and `custom` validation-rule variants (and the
  `UniquenessValidationSchema` / `AsyncValidationSchema` / `CustomValidatorSchema`
  exports). They were never enforced and each needs I/O or a handler model a
  write-path rule must not carry. Use the layer that already does each correctly:
  uniqueness → a unique index (`ObjectSchema.indexes`, `partial` for scope) or
  field-level `unique: true`; async/remote → the client form layer; custom code →
  a `beforeInsert` / `beforeUpdate` lifecycle hook. Field-level `unique: true` is
  unaffected.

  `examples/app-showcase` demonstrates and verifies each newly-enforced type. See the
  ADR-0020 addendum for the rationale.

- 60f9c45: feat(automation): structured control-flow constructs (ADR-0031) — loop container

  Adopt structured control-flow as the native, AI-authored flow model (ADR-0031),
  choosing representation **(B) nested sub-structure**: containers carry their body
  as a self-contained single-entry/single-exit region in `config`.

  - **spec**: new `automation/control-flow.zod.ts` defining the `loop` container
    (`config.body`), `parallel` block (`config.branches[]`, implicit join), and
    `try/catch/retry` (`config.try`/`config.catch`/`config.retry`) configs, plus
    region well-formedness analysis (`analyzeRegion`, `findRegionEntry`) and
    `validateControlFlow` (single-entry/single-exit, acyclic; bounded loop).
  - **engine**: `registerFlow()` now rejects malformed control-flow regions before
    a flow can run; new `AutomationEngine.runRegion()` executes a body region in
    the enclosing variable scope without touching the shared DAG traversal.
  - **loop executor**: replaces the no-op `loop` stub with a real iteration
    container — binds the iterator/index variables and runs the body once per item
    under a hard max-iteration guard. Legacy flat-graph loops (no `config.body`)
    keep working — the construct is additive.

  Parallel-block and try/catch _engine execution_ and BPMN interop mapping remain
  follow-ups (issue #1479, tasks 3–5).

### Patch Changes

- c4a4cbd: ADR-0032 (phase 1): validate-by-default expression layer — no silent failure.

  Kills the #1491 class where a malformed predicate (e.g. the `{record.x}`
  template-brace-in-CEL mistake) silently evaluated to `false` and made a flow
  "fire" with no effect:

  - **service-automation**: flow `evaluateCondition` no longer swallows CEL
    failures to `false` — it throws an attributed, corrective error; and
    `registerFlow` now parse-validates every predicate (start/decision/edge
    condition) at registration, failing loudly with the offending location +
    source + the fix.
  - **formula**: new shared validator — `validateExpression(role, src, schema?)`,
    `introspectScope`, `CEL_STDLIB_FUNCTIONS` — with schema-aware field-existence
    - did-you-mean. The `{{ }}` template engine gains a formatter whitelist
      (`currency`/`number`/`percent`/`date`/`datetime`/`truncate`/`upper`/`lower`/
      `default`/…) with defined value→string semantics; arbitrary logic in holes is
      rejected. Plain `{{ path }}` stays back-compatible.
  - **cli**: `objectstack compile` validates every flow / validation-rule /
    field-formula predicate against the resolved object schema and fails the
    build with located, corrective messages.
  - **service-ai**: new agent-callable `validate_expression` tool so authoring
    agents self-correct before committing.
  - **spec**: fix the `FlowSchema` JSDoc example that taught the bad
    `condition: "{amount} < 500"` single-brace form.

- 02d6359: docs(automation): document ADR-0031 control-flow constructs; fix dangling reference card

  - **guide**: `content/docs/guides/metadata/flow.mdx` now documents the structured
    control-flow constructs — the `loop` container, `parallel` block (implicit
    join), and `try_catch` (try/catch/retry) — with config examples and the
    region/DAG model. The Node Types table is updated accordingly.
  - **doc generator**: `build-docs.ts` now cards only reference pages that were
    actually generated. Control-flow's schemas embed CEL-expression transforms
    (like `Flow`/`FlowEdge`) and so have no JSON-Schema page; the index previously
    carded every `.zod.ts`, producing a dangling "Control Flow" 404 link. Cards
    now align with `meta.json` (generated pages only).

- 8fa1e7f: Fix the docs generator (`build-docs.ts`) leaking an unmatched `<` / `{` into generated MDX, which broke the `apps/docs` Turbopack build (e.g. a SemVer range `">=4.0 <5"` in a `.describe()` string was read as the start of a JSX tag). Unmatched openers are now emitted as HTML entities (`&lt;` / `&#123;`); union-variant descriptions also go through the escaper.
- 55866f5: Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

  The default `ICryptoProvider` backs every secret-at-rest in the platform —
  encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
  runtime datasource credentials. Its key resolution previously fell back,
  **silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
  new on-disk key on every boot) when no stable key was available. In an
  ephemeral-FS container or a multi-node cluster, each restart / each node then
  encrypts under a different key, and every previously-written `sys_secret` value
  becomes undecryptable. The failure was invisible at encrypt and boot time and
  only surfaced later as "all my saved passwords / API keys / DB credentials
  fail to decrypt".

  - **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
    implied an ephemeral key when the provider in fact persists one.
    `InMemoryCryptoProvider` stays as a deprecated alias for backward
    compatibility.
  - **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
    hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
    remains the dev convenience key.
  - **Fail-loud in production.** When `NODE_ENV=production` and no stable key
    source (env var or a pre-existing persisted file) is available, the provider
    now throws an actionable error at construction instead of generating a key —
    turning silent data-loss into a config error at boot. It never auto-mints a
    key in production. Development and test keep the ergonomic fallback
    (persisted dev key / ephemeral test key).
  - `serve` surfaces the production-key error verbatim and refuses to wire an
    unstable provider for `secret` fields.

  KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
  remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
  "your stored secret is still there after a reboot" stays open-source.

## 7.5.0

## 7.4.1

## 7.4.0

### Minor Changes

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

- f115182: ADR-0019 — App as the consumer-facing unit. The consumer Marketplace surfaces
  exactly one user-visible noun, the App.

  - Adds `CONSUMER_INSTALLABLE_TYPES` and `isConsumerInstallable(type)` (the single
    source of truth for "what a consumer can install").
  - Constrains `MarketplaceListingSchema.packageType` to `CONSUMER_INSTALLABLE_TYPES`
    (default `app`) so a non-App (driver/server/plugin/…) listing cannot be
    represented — the "consumers see only Apps" guarantee is enforced in the data
    contract, not a forgettable query filter.
  - `defineStack()` now enforces **at most one App per package**: a package with
    `manifest.type === 'app'` may not define more than one app — the banned "suite
    contains apps" shape throws with a clear fix (fold into one app with multiple
    tabs, or split into separate packages). Zero apps is allowed; non-`app`
    package types are unconstrained. Non-breaking for existing stacks.

  The package `type` enum is unchanged; the additions are non-breaking. No
  runtime/registry/execution changes.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 1.

  Adds the spec foundation and the DDL gate for federating mature external
  databases without ObjectStack ever mutating their schema:

  - `Datasource.schemaMode` (`managed` | `external` | `validate-only`) and
    `Datasource.external` settings, with a cross-field invariant.
  - `Object.external` binding (remote table/schema, writability, column map).
  - Shared error contract: `ExternalSchemaMismatchError`,
    `ExternalWriteForbiddenError`, `ExternalSchemaModeViolationError`
    (stable `code`s) + structured `SchemaDiffEntry` rendering.
  - `driver-sql` DDL gate: schema-mutating DDL (`initObjects`/`syncSchema`/
    `dropTable`) is rejected when `schemaMode !== 'managed'`.

  All changes are additive and backward-compatible (`schemaMode` defaults to
  `'managed'`).

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 2 (service core).

  Adds the federation service contract, the type-compatibility matrix, and a
  new service package that introspects, drafts, and validates federated
  objects:

  - `@objectstack/spec`:
    - `data/type-compat.ts` — dialect-aware SQL↔field-type matrix
      (`canonicalizeSqlType`, `suggestFieldType`, `isCompatible`) for
      postgres/mysql/sqlite/snowflake/bigquery/mongo.
    - `contracts/external-datasource-service.ts` — `IExternalDatasourceService`
      plus `RemoteTable`, `GenerateDraftOpts`, `ObjectDraft`,
      `SchemaValidationResult`/`Report`.
  - `@objectstack/service-external-datasource` (new): implements the service —
    `listRemoteTables`, `generateObjectDraft` (renders a reviewable
    `*.object.ts` with `// REVIEW:` markers), `validateObject`/`validateAll`
    (structured `SchemaDiffEntry` diffs), and `refreshCatalog`. Decoupled from
    the kernel via injected I/O; kernel plugin registers it as the
    `external-datasource` service.

  REST routes and the `os datasource` CLI commands follow in a subsequent
  slice.

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 3 spec: `external_catalog`
  metadata type.

  - Registers `external_catalog` in `MetadataTypeSchema` and
    `DEFAULT_METADATA_TYPE_REGISTRY` (system domain, `allowRuntimeCreate: true`,
    not org-overridable).
  - Adds `data/external-catalog.zod.ts` — `ExternalCatalogSchema` /
    `ExternalTableSchema` / `ExternalColumnSchema` for persisting a cached
    remote-schema snapshot of a federated datasource (consumed by
    `refreshCatalog`, the boot-validation gate, and Studio's schema browser).

- ff3d006: Screen-flow runtime — interactive `screen` nodes (suspend → render → resume).

  A `screen` node that declares input fields now suspends the run on entry
  (reusing the ADR-0019 durable pause), surfaces a `ScreenSpec` describing the
  form, and resumes with the collected values applied as **bare** flow variables
  so downstream nodes read them via `{var}`. (`waitForInput: false` forces the
  old server pass-through.)

  - **spec**: `AutomationResult.screen?: ScreenSpec`, `ResumeSignal.variables?`
    (bare vars), `IAutomationService.getSuspendedScreen?(runId)`.
  - **service-automation**: the `screen` executor builds the `ScreenSpec` and
    suspends when fields are present; the suspend/resume plumbing threads the
    screen through `FlowSuspendSignal` → `SuspendedRun` → the paused result;
    `resume()` sets `signal.variables` as bare flow variables; `getSuspendedScreen`.
  - **runtime**: `POST /api/v1/automation/:name/runs/:runId/resume` (body
    `{ inputs }`) and `GET …/runs/:runId/screen`, wired through both the
    dispatcher route table and `handleAutomation`.

  Verified end-to-end headlessly: the showcase Reassign Wizard launches → pauses
  at the "New Assignee" screen → resumes with the input → the task is reassigned.
  The objectui `FlowRunner` UI that renders these screens ships separately.

- 5e831de: Seed data: first-class identity binding + loud failures (fixes #1389)

  Records seeded via `defineDataset` / `defineStack({ data })` can now bind to a
  platform user with `cel\`os.user.id\``(and to the org with`cel\`os.org.id\``),
  which previously never resolved at boot.

  - **`os.user` / `os.org` now actually resolve.** The runtime provisions a
    deterministic, non-loginable system user (`usr_system`, role `system`)
    _before_ any seed runs and binds it to `os.user`, so identity-derived seed
    values resolve even on a fresh boot — before the first human sign-up. The
    human login admin remains a separate better-auth identity and need not own
    seed data. Exposed as the canonical `SystemUserId.SYSTEM` constant.
  - **New `SeedLoaderConfig.identity`** carries the `os.user` / `os.org` subject
    into CEL evaluation (`@objectstack/spec`).
  - **Failures are loud, not silent.** A record whose CEL value can't resolve
    (e.g. a required `cel\`os.user.id\`` with no identity) — or that fails to
    write — is now counted as an error, marks the load unsuccessful, and logs an
    actionable message, instead of being silently dropped.

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

- 13d8653: Record-change flow trigger — auto-launch flows on data mutations.

  Completes the automation engine's `FlowTrigger` extension point so flows whose
  `start` node declares a record-change trigger (`config: { objectName,
triggerType: 'record-after-update', condition }`) actually fire on the matching
  mutation. Previously the slot was dead — nothing called `trigger.start` — so
  such flows could only run via a manual `engine.execute()`.

  **Engine baseline (`@objectstack/service-automation`)**

  - Redefines `FlowTrigger` around a parsed `FlowTriggerBinding` (flowName,
    object, event, condition, schedule, raw config). The engine parses the start
    node and hands the trigger a normalized binding, keeping trigger plugins
    decoupled from flow-definition internals (mirrors `connector_action` ↔
    `connector-rest`).
  - Ordering-independent, bidirectional wiring: `registerFlow`/`toggleFlow`
    activate bindings; `registerTrigger` retro-binds already-registered flows (a
    trigger plugin wires up on `kernel:ready`, after flows are pulled in);
    `unregisterFlow`/`unregisterTrigger`/disable tear them down.
  - Centralized start-condition gate in `execute()`: the start node's `condition`
    (e.g. `status == 'done' && previous.status != 'done'`) is evaluated once for
    every trigger type and manual runs; false ⇒ `{ skipped: true }`.
  - Seeds `record`, flattened record fields, and `previous` into flow variables.
  - New `getActiveTriggerBindings()` getter + exports `FlowTriggerBinding`.

  **Spec (`@objectstack/spec`)**

  - Adds `previous?` to `AutomationContext` — the pre-update "old" row, so flows
    can gate on transitions.

  **New package (`@objectstack/plugin-trigger-record-change`)**

  - The concrete trigger: subscribes to ObjectQL lifecycle hooks
    (`record-after-update` → `afterUpdate`, etc.), builds an `AutomationContext`
    from the new/old record, and runs the flow. Error-isolated (a flow failure
    never breaks the CRUD write); graceful degrade when the automation service or
    ObjectQL engine is absent (mirrors `plugin-audit`).

  The `schedule` trigger (ticker/cron + `sys_job` lifecycle) is a follow-up.

## 7.3.0

### Minor Changes

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

## 7.2.1

## 7.2.0

## 7.1.0

### Minor Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

## 7.0.0

### Major Changes

- dc72172: **Breaking:** Removed `@objectstack/driver-turso` and `@objectstack/knowledge-turso` from the open-core framework.

  The Turso/libSQL driver and its native-vector knowledge adapter now ship exclusively with the **ObjectStack Cloud** distribution (`objectstack-ai/cloud`). Rationale: Turso is used only for cloud/edge multi-tenant deployments — local development uses better-sqlite3 (faster), and the Turso integration is part of ObjectStack's commercial offering.

  ### What moved out

  - `@objectstack/driver-turso` → `objectstack-ai/cloud/packages/driver-turso`
  - `@objectstack/knowledge-turso` → `objectstack-ai/cloud/packages/knowledge-turso`
  - `ITursoPlatformService` contract (spec/contracts/turso-platform.ts) — removed entirely
  - `TursoConfigSchema`, `TursoDriverSpec`, `TursoMultiTenantConfigSchema`, `TenantResolverStrategySchema`, etc. — moved into `@objectstack/driver-turso` (re-exported from cloud)

  ### Framework-side changes

  - `packages/runtime/src/standalone-stack.ts`: `databaseDriver` enum no longer accepts `'turso'`; `libsql://`/`https://` URL detection removed. Cloud builds register the Turso driver via their own stack composition.
  - `packages/runtime/src/cloud/artifact-environment-registry.ts`: dropped `case 'libsql'/'turso'`. Cloud has its own `ArtifactEnvironmentRegistry` that handles Turso.
  - `packages/cli/src/commands/serve.ts`: removed `driverType === 'turso' | 'libsql'` branch.
  - `packages/runtime/package.json`, `packages/cli/package.json`: removed optional peerDep on `@objectstack/driver-turso`.
  - `packages/runtime/tsup.config.ts`: removed `@objectstack/driver-turso` from `external`.
  - `packages/spec/src/contracts/index.ts`: stopped re-exporting `turso-platform.js`.
  - `packages/spec/src/data/index.ts`: stopped re-exporting `driver/turso-multi-tenant.zod`.

  ### Migration for open-source users

  If you used `libsql://` URLs or `@objectstack/driver-turso` directly, either:

  1. Switch to `file:` URLs (better-sqlite3 via `@objectstack/driver-sql`) for local/self-hosted deployments, **or**
  2. Use ObjectStack Cloud, which ships the Turso driver as part of the commercial distribution.

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

## 6.9.0

## 6.8.1

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

- 6e88f77: Auto-persist chat history when a `conversationId` is supplied.

  - `AIService.chatWithTools` and `streamChatWithTools` now write the inbound user turn, each intermediate assistant/tool round, and the final assistant turn to `ai_messages` whenever `toolExecutionContext.conversationId` is set. Persistence is best-effort: failures are warned and never break the chat response.
  - Add `IAIConversationService.update(conversationId, { title?, metadata? })` and a matching `PATCH /api/v1/ai/conversations/:id` route so clients can rename conversations and edit metadata.
  - `ObjectQLConversationService` and `InMemoryConversationService` both implement the new `update` method.

## 6.7.1

## 6.7.0

### Minor Changes

- 430067b: Introduce `IEmbedder` protocol and extract `@objectstack/embedder-openai` plugin.

  **What's new**

  - **`IEmbedder` contract** (`@objectstack/spec/contracts/embedder.ts`) — protocol-level interface for text → vector providers. One contract covers cloud APIs (OpenAI / 阿里通义 / 智谱 / 硅基流动 / 火山 Doubao / MiniMax), local Ollama daemons, and in-process embedders.
  - **`@objectstack/embedder-openai`** — new package. Drop-in for any OpenAI-shape endpoint via `baseUrl`. Ships preset constants for 8 mainstream providers (`createOpenAIEmbedder({ preset: 'siliconflow', ... })`) and pre-baked dimensions for 16+ popular models.

  **Breaking changes (`@objectstack/knowledge-turso`)**

  - `OpenAIEmbeddingProvider` is **removed** — install `@objectstack/embedder-openai` and use `OpenAIEmbedder` instead (identical option shape).
  - `EmbeddingProvider` type alias kept as a deprecated re-export of `IEmbedder` for smoother migration; will be removed in a future major.
  - `HashEmbeddingProvider` is now an alias for the renamed `HashEmbedder` class — no functional change.

  **Migration**

  ```diff
  - import { OpenAIEmbeddingProvider } from '@objectstack/knowledge-turso';
  + import { OpenAIEmbedder } from '@objectstack/embedder-openai';

  - const embedding = new OpenAIEmbeddingProvider({ apiKey });
  + const embedding = new OpenAIEmbedder({ apiKey });
  ```

  For 国内 providers, use presets:

  ```ts
  import { createOpenAIEmbedder } from "@objectstack/embedder-openai";
  const embedding = createOpenAIEmbedder({
    preset: "siliconflow", // or 'dashscope', 'zhipu', 'doubao', 'ollama', …
    apiKey: process.env.SILICONFLOW_API_KEY!,
    model: "BAAI/bge-m3",
  });
  ```

- 4f9e9d4: Settings → runtime bridge: `embedder_*` settings now build a real
  `IEmbedder` and register it as a kernel-level DI service.

  **`@objectstack/spec`**

  - Exports `EMBEDDER_SERVICE = 'embedder'` from `contracts/embedder.ts`
    as the canonical DI token for the kernel-registered embedder.

  **`@objectstack/service-ai`**

  - Adds `@objectstack/embedder-openai` as an **optional peer dependency**
    (matches the `@ai-sdk/*` provider plugins pattern).
  - `AIServicePlugin.bindSettings()` now also:
    - Reads `embedder_provider` / `embedder_api_key` / `embedder_model` /
      `embedder_base_url` / `embedder_dimensions` from the `ai` namespace.
    - Dynamically imports `@objectstack/embedder-openai` and constructs
      an `OpenAIEmbedder` via `createOpenAIEmbedder({ preset, … })`.
    - Registers / replaces the instance under `EMBEDDER_SERVICE`. When
      the operator sets `embedder_provider = none`, the service is left
      unset so adapters can fail fast with a clear message.
    - Subscribes to `settings:changed` for the `ai` namespace so embedder
      swaps go live without restart (mirrors the chat-adapter pattern).
    - Overrides the manifest's fallback `ai/test_embedder` action with a
      live one-shot `embed(['ping'])` round-trip against the form's
      (possibly unsaved) values. Reports vector dims + latency.

  **`@objectstack/knowledge-turso`**

  - `KnowledgeTursoPlugin`'s `embedding` constructor option is now
    **optional**. When omitted, the plugin resolves `EMBEDDER_SERVICE`
    from the kernel at `start()` time — typically the embedder built by
    `@objectstack/service-ai` from the `ai` settings namespace.
  - Explicit `embedding` still wins when both are present (useful for
    tests and multi-embedder setups).
  - Logs `(embedder=<id>, dims=<n>)` on adapter registration so operators
    can confirm wiring at a glance.
  - When neither path resolves, the plugin warns with a one-line hint
    pointing to `Settings → AI & Embedder` and no-ops gracefully (the
    host kernel still boots).

  **Tests**

  - `service-ai`: +5 cases (now 85) covering `ai/test_embedder` action
    registration, `provider=none` warning, missing-api-key error,
    custom-provider-without-base-URL error, and the full happy path
    (mocked fetch → embedder registered under `EMBEDDER_SERVICE` →
    test_embedder action returns vector dims).
  - `knowledge-turso`: new `plugin.test.ts` (+5 cases) covering deferred
    construction, EMBEDDER_SERVICE fallback, explicit-wins precedence,
    missing-both warn-and-noop, and missing-knowledge-service warn.

  End-to-end now possible: operator opens **Settings → AI & Embedder**,
  picks 硅基流动 + paste API key + chooses `BAAI/bge-m3`, hits **Save**.
  Within the same process, `EMBEDDER_SERVICE` is registered/replaced,
  `KnowledgeTursoPlugin` (if started without an explicit embedder)
  picks it up, and subsequent `knowledge.search()` calls embed via the
  new provider — no restart, no env vars.

## 6.6.0

### Minor Changes

- a49cfc2: Add `compareTo` field to `DashboardWidgetSchema` and `variant` / `dashArray` /
  `opacity` to `ChartSeriesSchema` so renderers can express period-over-period
  overlays on metric / gauge / chart widgets.

  `compareTo` accepts `'previousPeriod'`, `'previousYear'`, or
  `{ offset: '7d' | '4w' | '1M' | '1y' }`. The renderer issues a second query
  against the shifted filter and either (a) derives a trend delta for KPI
  widgets or (b) overlays a muted comparison series on cartesian charts.

## 6.5.1

## 6.5.0

### Patch Changes

- Fix: update `package.json` `exports` to use nested `import`/`require` conditions with per-condition `types` fields (e.g. `import.types → index.d.mts`, `require.types → index.d.ts`). This ensures TypeScript with `moduleResolution: "bundler"` resolves to the ESM declaration file (`.d.mts`) which uses explicit `.mjs` chunk imports — eliminating the intermittent TS2306 "is not a module" error that occurred when tsup's DTS worker processed the CJS declaration chain.

## 6.4.0

### Minor Changes

- f8651cc: Knowledge Protocol MVP — protocol-first RAG via adapter plugins.

  **What's new:**

  - `@objectstack/spec` — new `KnowledgeSource` / `KnowledgeDocument` / `KnowledgeChunk` / `KnowledgeHit` schemas (under `@objectstack/spec/ai`) and `IKnowledgeService` / `IKnowledgeAdapter` contracts (under `@objectstack/spec/contracts`).
  - `@objectstack/service-knowledge` — `KnowledgeService` orchestrator + `KnowledgeServicePlugin`. Routes search/index calls to the appropriate adapter, runs **permission-aware retrieval** by re-checking every hit's `sourceRecordId` against the caller's `ExecutionContext` via `IDataEngine` (same RLS that gates plain ObjectQL), and subscribes to `IRealtimeService` for inline record→adapter sync.
  - `@objectstack/knowledge-memory` — deterministic, dependency-free in-memory adapter for dev/tests/reference. Hash-token embedder + brute-force cosine + paragraph chunking.
  - `@objectstack/knowledge-ragflow` — production-grade adapter against the Apache-2.0 [RAGFlow](https://github.com/infiniflow/ragflow) REST API. Plug in your dataset id; ObjectStack handles permission filtering after retrieval.
  - `@objectstack/service-ai` — new `search_knowledge` tool wired through the registry. Threads the LLM caller's actor into `KnowledgeService.search` so retrieval honours RLS automatically.

  **Why this design:** ObjectStack does NOT own chunking / embedding / vector storage / rerank — those are commodity capabilities best handled by mature OSS (RAGFlow, LlamaIndex, Dify, …). What ObjectStack uniquely owns is the protocol + permission-aware orchestration on top.

  See `content/docs/protocol/knowledge.mdx` for the full design.

- f8651cc: AI tools now execute with the end-user's `ExecutionContext`, so the
  existing ObjectQL row-level-security rules automatically scope what an
  agent can read and mutate.

  **What changed**

  - New `ToolExecutionContext` (on `@objectstack/spec/contracts`'s
    `ChatWithToolsOptions`) carries the authenticated actor, conversation
    id, and environment id through to tool handlers.
  - The built-in data tools (`query_records`, `get_record`,
    `aggregate_data`, legacy `query_data`) and the auto-generated
    `action_*` tools now pass `options.context` to `IDataEngine` calls,
    mapping the actor to `{ userId, roles, permissions, isSystem: false }`.
  - Assistant + agent REST routes forward `req.user` into the new
    context automatically — no caller changes required.
  - When no actor is provided (cron jobs, internal callers, existing tests)
    the helpers fall back to `{ isSystem: true }`, preserving today's
    behaviour. **Fully backward compatible.**

  **Why this matters**

  Before this change, an AI tool call ran with system privileges and saw
  every row in the tenant. Now the agent sees exactly what the human
  operator would see — same RLS, same field-level masking, same audit
  trail. This is the foundation for trustworthy autonomous agents.

  **For custom call sites**

  If you invoke `aiService.chatWithTools(...)` from your own route, pass
  `toolExecutionContext: { actor: { id, roles, permissions } }` to inherit
  the user's permissions. Omit it to keep the legacy system-level
  behaviour.

- 0bf6f9a: Add `Portal` metadata kind for external-user UI projections.

  A `Portal` declares a public-facing "site" derived from an existing `App` (or a curated subset of objects/views), with its own theme, authentication mode (anonymous / passwordless / sso), custom routes, and per-route guards. This is the protocol surface for the "customer portal" use case — partner sites, public booking, support knowledge bases — without forking the back-office `App`.

  **New exports under `@objectstack/spec/ui`:**

  - `PortalSchema`, `Portal` — Zod schema + inferred type.
  - `PortalRouteSchema`, `PortalRoute` — per-route configuration (view ref, layout, auth requirement, sharing scope).
  - `PortalAuthModeSchema` — enum of auth strategies (`anonymous`, `passwordless`, `oauth`, `sso`).
  - `definePortal()` — DX builder mirroring `defineApp()`.

  **Stack composition:** `composeStacks()` now accepts and merges `portals` alongside `apps`, `objects`, `views`, etc.

  No runtime / app behaviour change — this ships the protocol contract first so plugins, Studio, and the runtime can land Portal support in subsequent releases.

## 6.3.0

## 6.2.0

### Patch Changes

- b4c74a9: **Actions-as-tools Phase 3 — Human-In-The-Loop approval queue.**

  Dangerous declarative actions (`confirmText`, `mode:'delete'`, `variant:'danger'`) can now be exposed to the LLM safely. Instead of being skipped outright, they are registered as tools whose handler enqueues a pending request and returns `{ status: 'pending_approval', pendingActionId }` to the model. A human approves (or rejects) from Studio's pending-actions inbox; the service then re-runs the exact same dispatcher.

  ### New surface

  - New system object `ai_pending_actions` (id, conversation_id?, message_id?, object_name, action_name, tool_name, tool_input, status [`pending`|`approved`|`executed`|`failed`|`rejected`], result?, error?, rejection_reason?, proposed_by, decided_by?, proposed_at, decided_at?).
  - New built-in Studio view `AiPendingActionView` with `pending` / `executed` / `rejected` / `failed` sub-views and per-row **Approve** / **Reject** API actions.
  - New methods on `IAIService` (all optional, gated on a wired `IDataEngine`):
    - `proposePendingAction(input) → { id }`
    - `approvePendingAction(id, actorId) → { status, result?, error? }`
    - `rejectPendingAction(id, actorId, reason?)`
    - `listPendingActions(filter?) → PendingActionRow[]`
  - New exported types: `PendingActionStatus`, `ProposePendingActionInput`, `PendingActionRow`.
  - New REST routes (auth required):
    - `GET    /api/v1/ai/pending-actions` (`ai:read`)
    - `GET    /api/v1/ai/pending-actions/:id` (`ai:read`)
    - `POST   /api/v1/ai/pending-actions/:id/approve` (`ai:approve`)
    - `POST   /api/v1/ai/pending-actions/:id/reject` (`ai:approve`)
  - New exported predicate `actionRequiresApproval(action)` for Studio's exposure surface.

  ### Wiring

  `AIServicePluginOptions` gains `enableActionApproval?: boolean` (default `false`). When `true` and an `IDataEngine` is available, dangerous actions are registered and routed through the queue.

  ```ts
  kernel.use(
    new AIServicePlugin({
      enableActionApproval: true, // opt in
      apiActionBaseUrl: "http://localhost:3000",
    })
  );
  ```

  ### Internals

  - `actionSkipReason()` accepts `enableActionApproval` + `aiService` in its ctx and stops returning `"requires confirmation"` / `"mode='delete'"` / `"variant='danger'"` when HITL is wired.
  - `registerActionsAsTools()` pre-registers a _bypass-approval_ dispatcher per dangerous tool via `aiService.registerPendingActionDispatcher(toolName, fn)`; approval calls back into the same code path with `enableActionApproval` flipped off, so a single handler implementation serves both proposal and execution.
  - `createActionToolHandler()` short-circuits to `proposePendingAction()` when `enableActionApproval && actionRequiresApproval(action) && ctx.aiService?.proposePendingAction`.

  ### Out of scope (deferred)

  Slack/email notifications, approver routing (any signed-in user can approve in v1), auto-expiry of pending requests, resuming the same LLM turn after approval (operators get a fresh assistant message instead).

## 6.1.1

## 6.1.0

### Minor Changes

- 93c0589: **AI v1: Actions-as-Tools** — every declarative UI `Action` of `type: 'script'`
  is now auto-exposed as an AI-callable tool named `action_<name>`. Agents can
  perform business operations ("complete the groceries task") via natural
  language, routed through the same `dataEngine.executeAction()` dispatcher
  Studio uses. This is the write-side counterpart to `query_data`.

  **Highlights**

  - `registerActionsAsTools(toolRegistry, { metadata, dataEngine })` walks every
    object's `actions[]` and registers script-type ones, auto-injecting a
    `recordId` argument for row-context actions and inheriting JSON-Schema
    parameter types from the owning object's fields.
  - Safety filters skip destructive actions by default: `confirmText`,
    `mode: 'delete'`, `variant: 'danger'`, or explicit `aiExposed: false`.
  - New `aiExposed?: boolean` flag on `ActionSchema` for fine-grained opt-out.
  - New `actions_executor` skill bundle subscribes to `action_*` (wildcard
    tool names now supported in `SkillSchema.tools`).
  - The built-in `data_chat` agent now references both `data_explorer` and
    `actions_executor` skills, so users get read + write capabilities out of
    the box.
  - `MemoryLLMAdapter` learned a small two-step heuristic — when it sees an
    action verb ("complete", "start", "clone", ...) it routes to the matching
    `action_*` tool, resolving `recordId` from any prior `query_data` result.
  - New `examples/app-todo/test/ai-action.test.ts` demo proves the loop:
    user says "please complete the groceries task" → agent finds the task →
    agent calls `action_complete_task` → task status flips → `ai_traces`
    records the run.

  **Breaking changes**

  None. `aiExposed` is additive; existing actions remain exposed unless
  they fail an existing safety filter.

  **Phase-1 limitations** (Phase-2 roadmap items)

  - Only `type: 'script'` actions; `api`/`flow`/`url`/`modal`/`form` skipped.
  - No human-in-the-loop approval flow for destructive actions yet.
  - No CEL evaluation of `visible`/`disabled` predicates against agent context.
  - No bulk action support (single-record only).

## 6.0.0

### Major Changes

- 629a716: # v1 AI Protocol focusing — remove application-template schemas

  The `@objectstack/spec/ai` protocol is reduced to **only the primitives
  the runtime directly consumes**. Eight schemas that described
  application templates or product features (not platform contracts) are
  removed; three more are slimmed to their primitive cores.

  ## Removed (8 files, ~4,700 lines)

  | File                           | Reason for removal                                                                |
  | ------------------------------ | --------------------------------------------------------------------------------- |
  | `ai/devops-agent.zod.ts`       | A specific Agent template, not a primitive. Compose with `Agent + Skill + Tool`.  |
  | `ai/plugin-development.zod.ts` | Specific workflow; same reasoning.                                                |
  | `ai/runtime-ops.zod.ts`        | AIOps is a vertical product, not a backend platform concern.                      |
  | `ai/predictive.zod.ts`         | ML pipeline product (DataRobot/H2O space), orthogonal to metadata-driven backend. |
  | `ai/agent-action.zod.ts`       | 100% conceptual overlap with `tool` + `flow`.                                     |
  | `ai/orchestration.zod.ts`      | Multi-agent plans can be expressed as agents-as-tools. Premature.                 |
  | `ai/nlq.zod.ts`                | NLQ is LLM-native capability + a `query_data` tool over ObjectQL, not a protocol. |
  | `ai/feedback-loop.zod.ts`      | RLHF / training-side concern; not platform-owned.                                 |

  ## Slimmed (3 files)

  - **`ai/rag-pipeline.zod.ts` → `ai/embedding.zod.ts`** (318 → 80 lines).
    Keeps `EmbeddingModelSchema` + `VectorStoreSchema` primitives.
    Removed: chunking strategies, retrieval pipelines, rerankers,
    document loaders, end-to-end RAG pipeline DSL. The `ragPipelines`
    field on `defineStack()` is removed.
  - **`ai/cost.zod.ts` → `ai/usage.zod.ts`** (431 → ~70 lines).
    Keeps `TokenUsageSchema` + `AIUsageRecordSchema`. Model pricing is
    the canonical `ModelPricingSchema` already exported from
    `ai/model-registry.zod.ts`. Removed: budget definitions,
    enforcement, alerts, allocation reports, optimization
    recommendations.
  - **`ai/mcp.zod.ts`** (629 → ~100 lines). Defines only how to
    _reference_ an external MCP server and _bind_ its tools to an
    agent. The MCP protocol itself is owned by Anthropic's published
    spec and the `@modelcontextprotocol/sdk`; we no longer re-declare
    transport/capability/resource/prompt/streaming/sampling shapes.

  ## Migration

  No production code in this repository depended on the removed
  schemas. Downstream consumers that imported any of the removed types
  from `@objectstack/spec/ai` must:

  1. **Remove the import.** The platform no longer provides these types.
  2. **Define your own application-level shape** in your project / plugin
     if you still need the concept. The primitives (`Agent`, `Skill`,
     `Tool`, `Conversation`, `Embedding`, `Usage`, `MCP{ServerRef,ToolBinding}`)
     are sufficient to express every removed schema.
  3. For RAG: replace `RAGPipelineConfig` with your own pipeline
     description built on `EmbeddingModelSchema` + `VectorStoreSchema`.
  4. For cost: replace budget enforcement with your own service built
     on `AIUsageRecordSchema` records.

  ## Why

  The platform's job is to define **primitives that any AI feature can
  be built on top of**, leveraging the metadata-driven nature of
  ObjectStack. The removed schemas described specific product features
  (DevOps agent, AIOps, RAG pipeline DSL, budget enforcement) that
  should live in plugins or applications — not in the canonical
  protocol. Shipping a 6,245-line AI protocol where 80% of it has no
  runtime implementation creates false promises to integrators.

  After this change the AI protocol is:

  ```
  ai/
  ├── agent.zod.ts          ← who
  ├── skill.zod.ts          ← when
  ├── tool.zod.ts           ← what
  ├── conversation.zod.ts   ← what to remember
  ├── model-registry.zod.ts ← which LLMs
  ├── embedding.zod.ts      ← embedding + vector store primitives
  ├── usage.zod.ts          ← token + cost accounting
  └── mcp.zod.ts            ← external ecosystem bridge
  ```

  8 files, ~1,200 lines. Every schema has a runtime implementation in
  `@objectstack/service-ai` or `@objectstack/plugin-mcp-server`.

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

### Minor Changes

- dbc4f7d: feat(ai): v1 AI capabilities — ModelRegistry, structured output, tracing, schema retrieval, and `query_data` tool

  This release lights up the first concrete capabilities on the slimmed AI protocol. All additions are
  non-breaking — new contract methods are optional and existing callers keep working unchanged.

  ### What's new

  - **ModelRegistry** (`@objectstack/service-ai`): in-memory runtime registry for `AI.ModelConfig`.
    Wire models via `AIServicePluginOptions.models` / `defaultModelId`. Exposes `get`, `getOrThrow`,
    `getDefault`, `list`, and `estimateCost(modelId, usage)` for ex-post token cost computation.

  - **ai_traces object + auto-tracing**: every LLM call from `AIService` (`chat`, `complete`,
    `stream_chat`, `chat_with_tools`, `generate_object`, `embed`) is now instrumented with latency,
    token usage, status, and (when pricing is registered) cost. The default `ObjectQLTraceRecorder`
    is auto-wired when the runtime exposes an `IDataEngine`, persisting rows to the new `ai_traces`
    object. Drop in a custom `TraceRecorder` via `AIServicePluginOptions.traceRecorder`, or pass
    `null` to opt out.

  - **Structured output (`IAIService.generateObject`)**: new optional method on `IAIService` and
    `LLMAdapter` that returns a parsed, schema-validated object instead of free-form text.
    Implemented end-to-end in `VercelLLMAdapter` (uses the AI SDK's `generateObject` — provider
    strict-mode is automatic when supported). `MemoryLLMAdapter` ships a deterministic heuristic
    implementation so tests and demos work without an API key.

  - **SchemaRetriever**: lightweight keyword-based retriever over `IMetadataService.listObjects()`.
    Scores by object name (×3), label/plural (×2), description (×1), field name (×2), and field
    label (×1) with English stop-word filtering. Tokenisation splits snake_case so `todo_task` in
    a query matches `name: 'todo_task'`. `SchemaRetriever.renderSnippet()` produces a Markdown
    block ready to inject into a system prompt — no embeddings, no extra infra.

  - **`query_data` tool**: auto-registered when AI + Metadata + Data engine are all present. Takes
    a natural-language `request`, retrieves relevant schemas, asks the model for a structured
    `QueryPlan` via `generateObject`, validates the plan targets a real object, and executes it
    through `IDataEngine.find`. Returns `{ plan, count, records }`. The composed primitive that
    closes the loop from "ask in English" → "validated SQL-shaped result".

  - **Working demo in `examples/app-todo`**: `pnpm --filter @example/app-todo test:ai` boots the
    full Todo stack, invokes `query_data` against the seeded tasks, and verifies the call lands
    in `ai_traces`. Zero API keys, ~3 seconds end-to-end. Serves as the canonical reference for
    wiring AI into a real app.

  ### Hardening

  - Strict tool schemas: nested `orderBy` and `aggregations` items in `data-tools` now declare
    `additionalProperties: false` + `required`, matching the top-level contract and making them
    safe for provider strict mode.

  ### Breaking-ish

  - `TraceOperation` values are now snake_case (`stream_chat`, `chat_with_tools`, `generate_object`)
    to match the project's data-value convention and so the `ai_traces.operation` select validates.
    Custom `TraceRecorder` implementations that hard-code the old camelCase names need to be
    updated. The values are an internal observability artefact — no public protocol surface
    exposes them.

  ### Notes

  - `zod` is now a direct dependency of `@objectstack/service-ai` (previously transitive via `ai`)
    because contract signatures and the new tool definition use `z.ZodType` types directly.
  - All new methods on `IAIService` / `LLMAdapter` are optional — existing custom adapters and
    callers continue to work without changes.
  - 12 new unit tests cover `ModelRegistry` (cost math, defaults, throwing lookups) and
    `SchemaRetriever` (scoring, snake_case tokenisation, limits, snippet rendering).
    Full suite: 323/323 ✓.

## 5.2.0

### Minor Changes

- fa011d8: feat(studio): metadata history timeline viewer

  Adds a new `history` view mode that surfaces the audit timeline produced by `sys_metadata_history` (ADR-0008 §5) inside Studio. Available for every metadata type as a wildcard built-in plugin.

  - `@objectstack/spec`: extend `ViewModeSchema` with `'history'`.
  - `@objectstack/studio`: new `historyViewerPlugin` rendering an event timeline (create/update/delete/rename) with op icons, short hash, actor, source, expandable detail panel. ADR-0009 `executionPinned` types (`flow`, `workflow`, `approval`) show a "Pinned" badge explaining that historical versions are retained for in-flight executions.

  Reads from the existing `GET /meta/:type/:name/history` REST endpoint via `client.meta.getHistory()`; no new server surface.

### Patch Changes

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

## 5.0.0

### Minor Changes

- 2f9073a: Add `_sections` to `ObjectTranslationData` so per-section labels on detail
  pages can be authored alongside `_views` and `_actions`. Convention:
  `objects.<object>._sections.<section_name>.label`. Consumed by
  `@object-ui/plugin-detail` when sections declare a stable `name`.

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

## 4.1.1

## 4.1.0

### Minor Changes

- 23db640: `record:highlights` now accepts richer field items.

  Each entry in `fields` may be either a bare field name (backward compatible) or an object `{ name, label?, icon?, type? }` that lets the schema override the displayed label, attach a Lucide icon, or force a specific cell renderer without editing the underlying object metadata. Useful when the same field appears in multiple highlight strips with different framing (e.g. "Annual Revenue" vs "ARR") or when you want a tiny icon for status-like fields.

### Patch Changes

- 2108c30: `ActionParamSchema.required` now defaults to `false` (was effectively `undefined`). Functionally equivalent for existing consumers (which check truthiness), but makes the parsed object shape complete and unblocks downstream type narrowing. Fixes pre-existing failing test `action.test.ts > should accept minimal action parameter`.

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

### Patch Changes

- 326b66b: fix: studio CI test failures and metadata protocol mock handler improvements

## 4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai

## 4.0.0

### Minor Changes

- f08ffc3: Fix discovery API endpoint routing and protocol consistency.

  **Discovery route standardization:**

  - All adapters (Express, Fastify, Hono, NestJS, Next.js, Nuxt, SvelteKit) now mount the discovery endpoint at `{prefix}/discovery` instead of `{prefix}` root.
  - `.well-known/objectstack` redirects now point to `{prefix}/discovery`.
  - Client `connect()` fallback URL changed from `/api/v1` to `/api/v1/discovery`.
  - Runtime dispatcher handles both `/discovery` (standard) and `/` (legacy) for backward compatibility.

  **Schema & route alignment:**

  - Added `storage` (service: `file-storage`) and `feed` (service: `data`) routes to `DEFAULT_DISPATCHER_ROUTES`.
  - Added `feed` and `discovery` fields to `ApiRoutesSchema`.
  - Unified `GetDiscoveryResponseSchema` with `DiscoverySchema` as single source of truth.
  - Client `getRoute('feed')` fallback updated from `/api/v1/data` to `/api/v1/feed`.

  **Type safety:**

  - Extracted `ApiRouteType` from `ApiRoutes` keys for type-safe client route resolution.
  - Removed `as any` type casting in client route access.

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

## 3.3.1

### Minor Changes

- AI Agent/Skill/Tool metadata protocol refactoring (aligned with Salesforce Agentforce, Microsoft Copilot Studio, ServiceNow Now Assist)
  - **Tool as first-class metadata** (`src/ai/tool.zod.ts`): `ToolSchema`, `ToolCategorySchema`, `defineTool()` factory. Fields: name, label, description, category, parameters (JSON Schema), outputSchema, objectName, requiresConfirmation, permissions, active, builtIn.
  - **Skill as ability group** (`src/ai/skill.zod.ts`): `SkillSchema`, `SkillTriggerConditionSchema`, `defineSkill()` factory. Fields: name, label, description, instructions, tools (tool name references), triggerPhrases, triggerConditions, permissions, active.
  - **Agent protocol updated**: Added `skills: string[]` for Agent→Skill→Tool architecture; existing `tools` retained as backward-compatible fallback. Added `permissions: string[]` for access control.
  - **Metadata registry**: `tool` and `skill` registered as first-class metadata types in `MetadataTypeSchema` and `DEFAULT_METADATA_TYPE_REGISTRY` (domain: `ai`, filePatterns: `**/*.tool.ts`, `**/*.skill.ts`, etc.)
  - **Exports**: `defineTool`, `defineSkill`, `Tool`, `Skill` exported from `@objectstack/spec` root and `@objectstack/spec/ai` subpath.

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

### Patch Changes

- 46defbb: Fix filter operators (contains, notContains, startsWith, endsWith, between, null) broken across spec and memory driver

  - Add `$notContains` to `StringOperatorSchema`, `FieldOperatorsSchema`, `FILTER_OPERATORS`, and `Filter` type
  - Add `notcontains` / `not_contains` to `VALID_AST_OPERATORS` and `AST_OPERATOR_MAP`
  - Fix memory driver `convertToMongoQuery()` passthrough to normalize non-standard operators to Mingo-compatible format
  - Add `$notContains` and `$null` operators to memory matcher
  - Fix undefined value guard in memory matcher to exclude `$exists`, `$ne`, and `$null`

## 3.2.1

### Patch Changes

- 850b546: Maintenance patch release

## 3.2.0

### Minor Changes

- 5901c29: feat: auto-merge actions into object metadata via objectName

  - Added optional `objectName` field to `ActionSchema` for associating actions with specific objects
  - Added optional `actions` field to `ObjectSchema` to hold object-scoped actions
  - `defineStack()` and `composeStacks()` now auto-merge top-level actions with `objectName` into their target object's `actions` array
  - Added cross-reference validation for `action.objectName` referencing undefined objects
  - Top-level `actions` array is preserved for global access (platform overview, search)
  - Updated example apps (CRM, Todo) to use `objectName` on their action definitions

## 3.1.1

### Patch Changes

- 953d667: Add modal cross-reference validation, action handler examples, and action.mdx doc sync

## 3.1.0

### Minor Changes

- 0088830: Minor version release

## 3.0.11

### Patch Changes

- 92d9d99: Add auto-detect persistence strategy for memory driver: automatically selects localStorage (browser) or file system (Node.js) based on runtime environment

## 3.0.10

### Patch Changes

- d1e5d31: Fix UI protocol design issues

## 3.0.9

### Patch Changes

- 15e0df6: chore: unify all package versions to 3.0.8

## 3.0.8

### Patch Changes

- 5a968a2: Unify all package version numbers across the monorepo. All packages now share the same version and are released together via the changeset fixed group.

## 3.0.7

### Patch Changes

- 0119bd7: Implement DatabaseLoader for production metadata persistence
- 5426bdf: Migrate CLI architecture to oclif framework
  Improve chart

## 3.0.6

### Patch Changes

- 5df254c: Patch version release

## 3.0.5

### Patch Changes

- 23a4a68: Patch release for ObjectStack spec

## 3.0.4

### Patch Changes

- d738987: chore: patch release

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.

## 3.0.2

### Patch Changes

- 28985f5: **Breaking Change: Strict Validation Enabled by Default**

  `defineStack()` now validates configurations by default to enforce naming conventions and catch errors early.

  **What Changed:**

  - `defineStack()` now defaults to `strict: true` (was `strict: false`)
  - Field names are now validated to ensure snake_case format
  - Object names, field types, and all schema definitions are validated

  **Migration Guide:**

  If you have existing code that violates naming conventions:

  ```typescript
  // Before (would silently accept invalid names):
  defineStack({
    manifest: {...},
    objects: [{
      name: 'my_object',
      fields: {
        firstName: { type: 'text' }  // ❌ Invalid: camelCase
      }
    }]
  });

  // After (will throw validation error):
  // Error: Field names must be lowercase snake_case

  // Fix: Use snake_case
  defineStack({
    manifest: {...},
    objects: [{
      name: 'my_object',
      fields: {
        first_name: { type: 'text' }  // ✅ Valid: snake_case
      }
    }]
  });
  ```

  **Temporary Workaround:**

  If you need to temporarily disable validation while fixing your code:

  ```typescript
  defineStack(config, { strict: false }); // Bypass validation
  ```

  **Why This Change:**

  1. **Catches Errors Early**: Invalid field names caught during development, not runtime
  2. **Enforces Conventions**: Ensures consistent snake_case naming across all projects
  3. **Prevents AI Hallucinations**: AI-generated objects must follow proper conventions
  4. **Database Compatibility**: snake_case prevents case-sensitivity issues in queries

  **Impact:**

  - Projects with properly named fields (snake_case): ✅ No changes needed
  - Projects with camelCase/PascalCase fields: ⚠️ Must update field names or use `strict: false`

## 3.0.1

### Patch Changes

- 389725a: Fix build and test stability improvements

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

## 2.0.7

### Patch Changes

- Modularized kernel/events.zod.ts into 6 focused sub-modules for better tree-shaking and maintainability:

  - events/core.zod.ts: Priority, metadata, type definition, base event
  - events/handlers.zod.ts: Event handlers, routes, persistence
  - events/queue.zod.ts: Queue config, replay, sourcing
  - events/dlq.zod.ts: Dead letter queue, event log entries
  - events/integrations.zod.ts: Webhooks, message queues, notifications
  - events/bus.zod.ts: Complete event bus config and helpers

  kernel/events.zod.ts now re-exports from sub-modules (backward compatible).
  Created v3.0 migration guide.

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.5

### Patch Changes

- Unify all package versions with a patch release

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.2

### Patch Changes

- 1db8559: chore: exclude generated json-schema from git tracking

  - Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
  - JSON schema files are still generated during `pnpm build` and included in npm publish via `files` field
  - Fix studio module resolution logic for better compatibility

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 2.0.0

### Minor Changes

- 38e5dd5: feat: Studio DX, REST extraction, Dispatcher plugin
- 38e5dd5: test minor bump

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration

## 1.0.11

## 1.0.10

## 1.0.9

## 1.0.8

## 1.0.7

## 1.0.6

### Patch Changes

- a7f7b9d: fix(data): add missing expand, top, having, distinct fields to QuerySchema for OData/ObjectQL compatibility

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance

## 1.0.4

## 1.0.3

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

## 1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

## 0.9.2

### Patch Changes

- Refactor documentation architecture and terminology (Data/System/UI Protocols).

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.

## 0.8.2

### Patch Changes

- 555e6a7: Refactor: Deprecated View Storage protocol in favor of Metadata Views.

  - **BREAKING**: Removed `view-storage.zod.ts` and `ViewStorage` related types from `@objectstack/spec`.
  - **BREAKING**: Removed `createView`, `updateView`, `deleteView`, `listViews` from `ObjectStackProtocol` interface.
  - **BREAKING**: Removed in-memory View Storage implementation from `@objectstack/objectql`.
  - **UPDATE**: `@objectstack/plugin-msw` now dynamically loads `@objectstack/objectql` to avoid hard dependencies.

## 0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements

## 0.3.1

## 0.3.0

### Minor Changes

- Documentation and project structure improvements

  - Comprehensive documentation structure with CONTRIBUTING.md
  - Documentation hub at docs/README.md
  - Standards documentation (naming-conventions, api-design, error-handling)
  - Architecture deep dives (data-layer, ui-layer, system-layer)
  - Code of Conduct
  - Enhanced documentation organization following industry best practices

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

## 0.1.2

### Patch Changes

- Remove debug logs from registry and protocol modules

## 0.1.1

### Patch Changes

- b58a0ef: Initial release of ObjectStack Protocol & Specification.
