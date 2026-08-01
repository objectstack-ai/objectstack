# Unknown-key strictness ledger — the authorable / wire / open triage (#4001)

**Date**: 2026-07-30 · **Issue**: [#4001](https://github.com/objectstack-ai/objectstack/issues/4001) · **Builds on**: #3405 / #3746 (the `ActionParamSchema` template), #1535 (`ObjectSchema.create` unknown-key error), ADR-0089 D3a (view/page strict), ADR-0078 (no-silently-inert-metadata), ADR-0049 (enforce-or-remove), ADR-0054 (ratchet idiom)

Zod's default is `.strip`: a key the schema does not declare is **silently
discarded** and the instance goes on parsing. On an authorable surface that is
the worst failure mode — the author (human or AI) gets a success envelope and
ships metadata that quietly ignores their config. This ledger is #4001 step 1:
the persisted classification of *which* `z.object` sites that default is wrong
for, so the `.strict()` ratchet advances on evidence instead of a one-shot
sweep. **1885 sites was never the target number** — a large share of the spec
is wire/response shape where strictness would be a forward-compat bug.

## Classification rule

One question decides the class: **who writes this schema's input?**

| Class | Input written by | Unknown-key policy |
|---|---|---|
| **authorable** | A human or AI author, into `*.object.ts` / `defineStack` config / Studio / MCP | `.strict()` + fixable error (the ratchet target) |
| **wire** | Another machine: server responses, connector payloads, runtime envelopes, persisted runtime state | stay tolerant (`.strip` / `.passthrough`); strictness here turns an upstream *addition* into our parse crash |
| **open** | Deliberately schemaless user data (record bodies, per-node-type `config`, React props) | stay open; a *sibling* contract validates it (e.g. a node executor's `configSchema`, #4027/#4040) |

Mixed files carry both — classify per schema, not per file. A **response-side
extension of an authoring schema** (e.g. `EffectiveObjectPermissionSchema`)
must explicitly `.strip()` back, because `.extend()` inherits `.strict()`.

## Standard wiring

`strictUnknownKeyError` in `shared/suggestions.zod.ts` (generalized from the
#3746 hand-rolled map) is the one factory every strict authoring schema wires:

```ts
z.object({ ... }, { error: strictUnknownKeyError({ surface, knownKeys, aliases, guidance, history }) }).strict()
```

- `aliases` — semantic near-misses edit distance cannot reach (`visibleWhen` →
  `visible`, `from` → `source`, `read` → `allowRead`).
- `guidance` — exact-key prescriptions: **tombstones for retired keys** (the
  rejection carries the upgrade — AGENTS.md Post-Task Checklist #3) and
  wrong-layer pointers (`apiOperations` is response-side; `objectName` belongs
  on the start node).
- Key lists live beside the schema and are **drift-guarded by tests** (an
  "accepts every declared key" probe), because the schema body is lazy.

Every ratchet step ships only with the empirical zero-breakage pass: full
`@objectstack/spec` suite + `tsc`, downstream consumer suites, and
`objectstack validate` on all three example apps. Inference is not evidence —
the first application of this gate (below) caught a real spec gap.

## Ratchet state

### Already strict before #4001 (for reference)

| Surface | Since |
|---|---|
| `data/object.zod.ts` — `ObjectSchema.create()` unknown-key error + `UNKNOWN_KEY_GUIDANCE` tombstones; strict capabilities / tenancy / CRUD-override blocks | #1535, #2377, #2763 |
| `ui/view.zod.ts` / `ui/page.zod.ts` — form/page component schemas | ADR-0089 D3a |
| `ui/dashboard.zod.ts`, `data/field.zod.ts` (blocks), `ai/agent.zod.ts`, `ai/tool.zod.ts` (blocks) | various |
| `ui/action.zod.ts` — `ActionParamSchema` (the template) | #3405 / #3746 |

### This step (#4001 Tier-A slice)

| Schema | File | Evidence class |
|---|---|---|
| `PermissionSetSchema`, `ObjectPermissionSchema`, `FieldPermissionSchema`, `AdminScopeSchema` | `security/permission.zod.ts` | A silently dropped key on the capability container is the ADR-0049 asymmetry itself; retired `contextVariables` (ADR-0105 D11) / `isProfile` (ADR-0090 D2) get tombstones |
| `FlowSchema`, `FlowNodeSchema`, `FlowEdgeSchema`, `FlowVariableSchema` | `automation/flow.zod.ts` | Most AI-authored surface; cloud#688 / #2419 class. Node `config` stays **open** (executor `configSchema` owns it, #4027/#4040) |
| `ActionParamSchema` re-homed onto the shared factory | `ui/action.zod.ts` | #3746 template, byte-identical messages |

**Findings log** — three real defects the gate caught in its first two runs.
All three had been invisible: each key was written by real code, silently
dropped at parse, and nothing failed.

1. **`PermissionSetSchema` could not represent `description`** — yet the
   built-in default sets author it and `plugin-security`'s Setup projection
   reads it (`permission-set-projection.ts`). Fixed contract-first: it is now
   a declared key.
2. **`PermissionSetSchema` could not represent the ADR-0010 protection
   envelope** — `MetadataPlugin`'s artifact loader calls `applyProtection` on
   **every** metadata type, and `getMetaItemLayered` → `saveMetaItem`
   round-trips a body carrying the stamped `_packageId` / `_provenance`. Every
   sibling registered type (object / view / app / dashboard / report /
   dataset / flow / agent / tool / skill / email_template) spreads
   `MetadataProtectionFields`; permission was the outlier, so the envelope was
   stripped on every parse. Now declared, with the author-facing `protection`
   block alongside it (translated generically by `applyProtection`).
   Caught by the dogfood gate as a hard 422 on the ADR-0094 overlay path.
3. **A dogfood fixture flow carried `sharingModel`** — an object-level OWD key
   copy-pasted onto `flowTouch` in `flow-touch-fixture.ts`, complete with an
   ADR-0090 "grandfather stamp" comment describing a gate that does not exist
   for flows. Exactly the #4001 failure mode in the wild: authored in good
   faith, silently discarded, believed to be in effect. Removed (the identical
   stamp on the fixture's *object* is real and stays).

5. **`position.test.ts` asserted a fictional hierarchy** (step 2) — see the
   entry below.
6. **The platform's own Account app declared `defaultOpen` on three navigation
   groups** (app step, PR B). `expanded` is the schema key; `defaultOpen`
   never was — so all three groups shipped COLLAPSED while their author
   believed they opened by default. Fixed at the producer, and the spelling
   now aliases to `expanded`. Note where this one was found: not in a tenant
   project, but in first-party platform metadata that had been shipping for
   releases.
7. **This campaign's own fix signposted the way into the failure mode it
   exists to kill.** The strict rejection on a misplaced `host` prescribed:
   "Move it to `config: { host: … }`; the driver's own configSchema validates
   it there." False twice over — `DriverDefinitionSchema.configSchema` is a
   `z.record` that both bundled driver specs set to `{}`, and nothing in the
   repo reads it. So an author who made a *recoverable* mistake at a place that
   now catches it was directed, with the platform's authority, at a slot where
   the same mistake is silent again: `config: { hostname: … }` is stripped and
   the datasource connects on localhost — #4001's original bug verbatim, one
   level down. First corrected to name the per-driver shape instead of promising
   a gate; **#4410 then built the gate**, so the prescription makes a validation
   claim again and the claim is true. **A wrong instruction is worse than
   none**, and worst for an AI author, whose only signal is whether the parse
   complained.

   Two things #4410 had to fix before the sentence was safe to write, both
   instructive beyond this schema. The prescription has to name the key the
   contract *lands on*, not the one the author typed — pointing a misplaced
   `user` at `config: { user: … }` when postgres spells it `username` would
   swap a one-step correction for a two-step one. And a gate over `config`
   means every key inside it now claims to be honoured, which forced a per-key
   audit against the code that reads them: `indexes` / `maxRecordsPerObject`
   (memory) were removed as inert, while `datasource.pool`, `schemaMode`,
   postgres `schema` / `applicationName` / `statementTimeout` and mongo
   `password` / `authSource` / `options` were **wired**, having been declared
   and dropped on the floor. Enforcing a contract and honouring it are the same
   task from two directions.

This is the empirical argument for the ratchet: the inference "no metadata in
the repo carries unknown keys" was **false three times over**, and only the
strict gate could prove it. Note the asymmetry in the two schema gaps — both
were *inverse* drift (runtime writes a key the spec cannot express), which the
liveness ledger's per-property direction cannot see.

**Known sibling gap — CLOSED in step 2:** `identity/position.zod.ts` — the
other registered security type — also omitted `MetadataProtectionFields` while
`applyProtection` stamps it. Declared (with the author-facing `protection`
block) when `position` joined the ratchet.

4. **`position.test.ts` asserted a fictional hierarchy** (found in step 2 when
   `PositionSchema` went strict): the pre-ADR-0090 test "should accept position
   with parent" — plus four "real-world hierarchy" examples — authored a
   `parent` key on positions. It only ever "passed" because `.strip` ate the
   key; no position tree exists (ADR-0090 D3 finalized flatness; hierarchy is
   the business-unit tree). The tests were codifying the strip-era fiction as
   expected behavior. Rewritten: `parent` is now asserted to be *rejected* with
   the flatness guidance.

## File-level triage — the five authorable directories

Site counts are `z.object(` occurrences per file (2026-07-30, this branch).
Classification is per the rule above; **(p)** marks a provisional call made
from the file's exports/JSDoc rather than a full read — verify before
tightening (the #4001 "sharing-rule lesson": candidates, not verdicts).

### `ui/` — 197 sites

| File | Sites | Class | Note / next action |
|---|---|---|---|
| `action.zod.ts` | 9 | authorable | param schema strict (#3746); remaining blocks ride later steps |
| `view.zod.ts` | 50 | authorable | partially strict (ADR-0089); long tail of sub-blocks |
| `component.zod.ts` | 29 | authorable | **next candidate** — SDUI component defs; check React-prop open slots first (p) |
| `theme.zod.ts` | 14 | authorable (p) | authored themes |
| `app.zod.ts` | 18 | authorable | **strict as of #4001 PR B** — `AppSchema` + branding / area / context-selector / contribution, and the nav-item union converted to `z.discriminatedUnion('type', …)` (the union-error question, settled empirically: matched-branch-only errors, exact recursive paths, `toJSONSchema` clean). Per-target `params` stay open. PR A (#4142) tombstoned the seven audit-dead keys first |
| `dashboard.zod.ts` | 11 | authorable | partially strict |
| `widget.zod.ts` | 9 | authorable (p) | |
| `page.zod.ts` | 7 | authorable | partially strict (ADR-0089) |
| `chart.zod.ts` / `i18n.zod.ts` / `responsive.zod.ts` | 6+6+4 | authorable (p) | i18n label shapes are wide-open records by design — verify |
| `dataset.zod.ts` / `animation.zod.ts` / `dnd.zod.ts` / `keyboard.zod.ts` / `touch.zod.ts` | 4+4+4+4+7 | authorable (p) | interaction configs |
| `notification.zod.ts` / `offline.zod.ts` / `report.zod.ts` | 3 ea | authorable (p) | |
| `sharing.zod.ts` | 2 | authorable (p) | public-sharing config |

### `data/` — 160 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object.zod.ts` | 20 | authorable | top-level already guarded (#1535); inner blocks partially strict |
| `data-engine.zod.ts` | 14 | wire (p) | engine contract shapes |
| `external-lookup.zod.ts` | 12 | mixed (p) | authored config + wire results |
| `seed-loader.zod.ts` | 12 | mixed (p) | seed file shapes are authored; loader state is runtime |
| `field.zod.ts` | 11 | authorable | partially strict |
| `filter.zod.ts` / `query.zod.ts` | 11+5 | open | query dialect — user data flows through; validated semantically elsewhere. `query.zod.ts` dropped one site in #4196: `FieldNodeSchema`'s nested-select object form was declared-but-inert and narrowed to `z.string()`, so the union's second member is gone. Four more left in #4286 with the `joins`/`windowFunctions` removals: `JoinNodeBaseSchema`, `WindowFunctionNodeSchema`, and `WindowSpecSchema`'s two blocks (outer + `frame`) were deleted with their clusters. Class unchanged |
| `driver-nosql.zod.ts` / `driver.zod.ts` / `driver-sql.zod.ts` | 10+9+2 | wire | driver capability contracts |
| `datasource.zod.ts` | 9 | authorable | **strict as of #4001 data step** — all 9: `DatasourceSchema` (+ `pool` / `healthCheck` / `ssl` / `retryPolicy`), `ExternalDatasourceSettingsSchema` (+ `validation`), `DatasourceCapabilities`, `DriverDefinitionSchema`. `config` + `readReplicas` stay `z.record` **at this level** by construction (per-driver shapes), but are no longer unchecked: **#4410** made `DatasourceSchema`'s refinement parse both against the contract for the declared driver (`driver/config-registry.zod.ts`), so the openness here is a shape this level cannot express rather than the absence of one. This row used to add "the driver's own `configSchema` validates them", which was false until #4410 landed the parse site it names |
| `driver/memory.zod.ts` / `driver/mongo.zod.ts` / `driver/postgres.zod.ts` | 6+1+1 | authorable | The per-driver shapes for the `config` slot — what an author actually writes under `datasource.config` (`host`, `port`, `filename`). **Undeclared here until the coverage walk went recursive** (see below): a subdirectory was invisible to the gate, so these sites sat outside the map while the map reported full coverage. **Strict as of #4410**, which is also what unblocked them: this row previously read "strictness here would enforce nothing" because nothing parsed `datasource.config` against these schemas and both `*DriverSpec.configSchema` literals were `{}`. Now `DatasourceSchema` parses `config` (and each `readReplicas` entry) against them, and the same schemas project onto `configSchema` and onto the Studio connection form. `postgres.zod.ts` drops a site: its `ssl` was a `boolean | {ca, cert, key, …}` union, and the object arm is gone — certificates now live in the datasource-level `ssl` block (declared, strict, and until #4410 read by nobody), leaving `config.ssl` as the on/off shorthand. That narrowing is forced by the same projection: the Studio form renders anything that is not boolean/enum/number as a TEXT INPUT, so a union here would have produced a wizard whose every `ssl` value the new gate rejects. `memory.zod.ts` keeps 6 but loses two KEYS — `indexes` / `maxRecordsPerObject`, which `InMemoryDriverConfig` has no field for, removed under ADR-0049 rather than blessed by the new gate |
| `driver/mysql.zod.ts` / `driver/sqlite.zod.ts` | 1+2 | authorable | The rest of the `config` contract, added by #4410. `mysql.zod.ts` and `sqlite.zod.ts` (sqlite + sqlite-wasm) are shapes that **never existed** — both driver ids were offered by the connection form and buildable by the shared factory, with no config contract anywhere, so `driver: 'sqlite'` + a misspelled `filename` was an ephemeral `:memory:` database reported as configured. All three sites strict, same error factory as the rest of the campaign. (Their sibling `driver/common.zod.ts` holds shared enums and prescription strings and has no `z.object(` site, so the coverage gate skips it) |
| `analytics.zod.ts` | 8 | mixed (p) | |
| `document.zod.ts` | 8 | wire (p) | |
| `hook.zod.ts` / `hook-body.zod.ts` | 6+2 | mixed | **strict as of #4001 data step** for the AUTHORING shapes: `HookSchema` (+ `retryPolicy`) and both body branches (`ExpressionBodySchema` / `ScriptBodySchema`). `HookContextSchema` and its `session` / `provenance` / `user` blocks are the RUNTIME shape the engine hands a handler — they stay tolerant, and must: strictness there would make an engine-internal enrichment (as `provenance` was in #3712) a breaking change for anyone parsing a context they were given. The file's old blanket `authorable (p)` was too wide — verification split it |
| `mapping.zod.ts` | 3 | authorable (p) | |
| `external-catalog.zod.ts` | 4 | wire (p) | |
| `field-value.zod.ts` / `seed.zod.ts` / `validation.zod.ts` | 1 ea | mixed (p) | |

### `automation/` — 99 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `flow.zod.ts` | 11 | authorable | **strict as of #4001** (4 schemas; `FlowVersionHistorySchema` is runtime — stays tolerant) |
| `sync.zod.ts` / `etl.zod.ts` | 12+10 | authorable (p) | authored pipelines — **candidates** |
| `trigger-registry.zod.ts` | 11 | mixed | descriptors are code-registered (wire-ish); bindings authored |
| `execution.zod.ts` | 13 | wire | run-state envelopes — never strict. +5 at #4354 (the run-summary family: step metrics / skip reason / per-node / per-gate / the summary itself) — engine-emitted telemetry read by the Console and by operator queries, nobody authors them, so the `wire` verdict covers them unchanged |
| `state-machine.zod.ts` | 7 | authorable (p) | |
| `control-flow.zod.ts` | 6 | authorable (p) | validated structurally by `validateControlFlow` |
| `bpmn-interop.zod.ts` | 5 | wire (p) | interop import shapes |
| `approval.zod.ts` | 4 | authorable | **strict as of #4001 step 3** — all four authoring schemas (node config / approver / escalation / decision-output). The published JSON schema carries `additionalProperties: false` into the Studio form AND `registerFlow()` config validation (#4027/#4040), so an unknown key in an approval node's `config` is rejected at registration too — verified: `z.toJSONSchema` on the strict lazySchema does not throw (#3746 hazard checked) |
| `node-executor.zod.ts` | 4 | wire | executor contract |
| `io-node-config.zod.ts` | 2 | authorable | `NotifyConfigSchema` / `HttpConfigSchema` (#4045) — the sibling contracts that validate the **open** `config` slot on flow `notify` / `http` nodes. Authored per-node, so the open-slot exemption above does not extend to them; candidate once the executors' own drift is verified |
| `builtin-node-config.zod.ts` | 8 | authorable | Same family (#4045): the CRUD quartet, `screen`, `map`. Written from what the executors read rather than from the descriptors' `configSchema` literals, and reconciled bidirectionally by `builtin-node-form-zod-ledger.test.ts` — so unlike most rows here, this one already has a drift check of its own. Same candidacy note as `io-node-config` |
| `schemaless-node-config.zod.ts` | 4 | authorable | Same family, third panel (#4278): `script` / `subflow` / `decision` (+ the decision branch item) — the descriptor-schemaless nodes whose form lives in objectui's hand-written table. Written from the executors; the drift check is objectui's `flow-node-config.spec-reconciliation` test (cross-repo, via the published exports). Contract exports only — nothing parses node config with them yet, so strictness candidacy follows `io-node-config` |
| `webhook.zod.ts` | 1 | authorable (p) | spec-only (#3461) |
| `flow-function.zod.ts` | 1 | authorable | `FlowFunctionDeclarationSchema` (#4396) — the `{ handler, effect }` form of a `defineStack({ functions })` entry. Authored, but note what an undeclared key here would be: a sibling of a **live function**, not data. `defineStack`'s union already rejects a record whose `handler` is not callable, and the boot-path reader is the hand-written `normalizeFlowFunctionEntry` rather than a `.parse()` (re-validating a live handler every boot buys nothing), so strictness would bind at authoring only. Candidate on the same verify-first rule as its `*-node-config` neighbours |

### `security/` — 20 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `explain.zod.ts` | 11 | wire | permission-explain responses — never strict |
| `permission.zod.ts` | 4 | authorable | **strict as of #4001**; `EffectiveObjectPermissionSchema` explicitly `.strip()`s (wire) |
| `rls.zod.ts` | 3 | authorable | **`RowLevelSecurityPolicySchema` strict as of #4001 step 2** (a stripped RLS key is a silent policy hole); `RLSUserContextSchema` / `RLSEvaluationResultSchema` are runtime shapes — stay tolerant |
| `sharing.zod.ts` | 2 | authorable | **strict as of #4001 step 2** — rule + recipient shapes; strictness and the error map ride the base into the criteria extension |

### `studio/` — 27 sites

| File | Sites | Class | Note |
|---|---|---|---|
| `object-designer.zod.ts` | 12 | authorable (p) | Studio-written JSON — machine-authored but *our* machine; strict protects the builder itself |
| `plugin.zod.ts` | 8 | mixed (p) | |
| `flow-builder.zod.ts` | 7 | authorable (p) | independent of `FlowSchema` shapes |

## Other directories (coarse; classify per schema before touching)

| Dir | Sites | Dominant class | Rationale |
|---|---|---|---|
| `api/` | 426 | wire | REST/GraphQL request/response contracts — tolerant by design |
| `system/` | 383 | mixed | manifest/datasource blocks are authored; runtime envelopes are wire |
| `kernel/` | 351 | wire | plugin/kernel contracts, code-to-code |
| `cloud/` | 83 | wire | multi-tenant runtime |
| `ai/` | 75 | mixed | agent/tool/skill definitions authored (partially strict already); model/provider payloads wire |
| `integration/` | 64 | wire | connector payloads — upstream adds fields freely |
| `identity/` | 34 | mixed | position/user shapes authored (`PositionSchema` **strict as of #4001 step 2**, with the ADR-0010 envelope declared); auth payloads wire |
| `shared/` | 25 | n/a | utilities and building blocks; strictness decided at the consuming schema |
| `qa/` | 6 | n/a | test fixtures |

## Next steps (verify-then-enforce, one shape at a time)

1. Let the warning layer run in the wild for a release, then schedule the v18
   strict close-out on what it actually reports — which is the whole point of
   having built it. Nothing more to do here until there is field data.

   **This wait has a decision point, deliberately.** "Wait for field data" with
   no way to tell when it has arrived is how a ratchet stops without anyone
   choosing to stop it — and this file would go on describing an in-flight
   campaign either way. So the wait is discharged by an answerable question, not
   by a date: *has `lintUnknownAuthoringKeys` reported an unknown key on any
   surface outside this repo yet?* Three outcomes, each with a next action:
   - **Findings exist** → they are the close-out worklist. Tighten the shapes
     they name first; that is the evidence the whole layer was built to produce.
   - **Zero findings, and the layer is reaching real authors** → the tail is
     cheaper than feared and the remaining directories can be batched by class
     rather than one shape at a time.
   - **Zero findings because nothing is reporting back** → then the layer is not
     instrumented, and *that* is the next task, not more strictness. This is the
     outcome to actually check for: it is indistinguishable from success at a
     glance, which is this campaign's own subject matter.

   Whoever reads this next: answer the question and record the answer here, even
   if the answer is "still nothing". A wait that is never re-examined is
   indistinguishable from an abandoned one.

2. `studio/` is the largest untouched authorable block — 27 sites, **0 strict**,
   and all three files still carry a provisional `(p)` from the original triage.
   Not blocked on field data (Studio-written JSON is our own producer, so the
   downstream risk is the lowest on the board); it is simply unstarted. If the
   step-1 question comes back "nothing is reporting", start here instead.

Done in step 2: `security/rls.zod.ts` + `security/sharing.zod.ts` strict;
`PositionSchema` strict with the protection envelope declared (closing the
known sibling gap below).

Done in step 3: `automation/approval.zod.ts` — the four approval authoring
schemas, with the ADR-0019 re-home map as wrong-layer guidance
(`steps` / `entryCriteria` / `onApprove` / `onReject` / `rejectionBehavior`
each point at where the concept lives on the flow graph now).

Done in the app step, PR B: `AppSchema` + the navigation tree strict, via a
discriminated union — the union-error concern that deferred this step was
resolved by measurement, not design work.

Done in the app step, PR A: the seven audit-dead AppSchema keys tombstoned
(`retiredKey` + `app-dead-authoring-keys-removed` conversion + step-17
migration entry), clearing the enforce-or-remove precondition for the app
strict step (PR B).

Done in the data step: `data/hook.zod.ts` + `data/hook-body.zod.ts` +
`data/datasource.zod.ts` — the last two entries that carried a provisional
`(p)` classification. Verification changed the answer for one of them: the
blanket `authorable (p)` on `hook.zod.ts` was too wide, because
`HookContextSchema` in the same file is a runtime shape and stays tolerant.
Both types were confirmed authorable the same way — they sit in
`BUILTIN_METADATA_TYPE_SCHEMAS`, so one shape backs `defineStack()` parsing,
`/api/v1/meta/types/:type`, and the Studio form.

Measured while doing it, and worth recording because it contradicts the
assumption the earlier steps were written under: **strictness does not change
the published JSON Schema.** `build-schemas.ts` converts with the default
`io: 'output'`, and in output mode zod emits `additionalProperties: false` for
a `.strip()` object too — the post-parse shape genuinely has no extra keys.
Verified by regenerating both ways: `Datasource.json` is byte-identical before
and after. So the JSON Schema had been advertising `additionalProperties: false`
while the zod parse quietly accepted and dropped unknown keys. These flips align
the parse with the contract that was already published, rather than widening it.
(Note this cuts against the `approval.zod.ts` note above, which reads as though
the flip carried strictness INTO the JSON schema. It did not; approval's schema
would have said `false` regardless. The registration-time rejection it describes
is real, but it came from the published schema, not from the flip.)

## The warning layer (was "next step 1" — it already existed)

The `@objectstack/lint` unknown-key WARNING layer this list carried as a pending
next step **had already been built** by the time the data step landed: #3786's
`lintUnknownAuthoringKeys` plus #4167's `lintUnknownStackKeys`, exported from
`@objectstack/spec` and wired into `defineStack()`, `os validate` and
`os compile` as non-blocking warnings. Anyone reading this file for what to do
next was being sent to build something that shipped releases ago.

What was genuinely missing was **depth**, not existence. The walk covered each
metadata item's top level plus one hard-coded descent into `object.fields`,
which left 227 strip-mode objects nested below those roots reporting nothing —
concentrated exactly where authoring volume is: `object` 71, `view` 49,
`page` 24, `dashboard` 18, `agent` 16, `mapping` 14. Those sites were both
silently eating keys AND contributing nothing to the evidence base the v18
close-out is supposed to be scheduled on.

The walk now descends the authored value alongside its schema through nested
objects, arrays and records, applying the same posture rules (`strict` and
`passthrough` stay silent; only `strip` reports). Unions descend only when the
authored value picks a branch unambiguously — guessing would invent findings
against a shape nobody wrote. `object.fields` keeps reporting as `field` with
its curated guidance, now via an explicit override table rather than a special
case, so its own nested sites (`fields.*.options[]`, …) are covered too.

Audited after the change, since "our own assets are clean" has been wrong
before: 43 platform objects + 3 apps + 1 dashboard + 3 pages, and both example
apps (23 + 6 objects, 20 + 1 pages, 4 + 1 datasets, 3 + 1 dashboards) report
**zero** unknown keys. No finding this time — worth recording precisely because
the app step's `ACCOUNT_APP.defaultOpen` came from exactly this class of check.

## This file is now machine-checked

`pnpm --filter @objectstack/spec check:strictness-ledger` (wired into the Spec
Liveness Check workflow) holds the two claims here that are mechanically
checkable, so this map cannot go stale in silence again:

- **Site counts.** The method is stated above — `z.object(` occurrences per file
  — so every number in the triage tables is verifiable. A count that no longer
  matches means schemas were added or removed under a `Class` verdict nobody
  re-examined. Touching a file forces you back through this ledger.
- **Coverage.** Every `*.zod.ts` in a triaged directory that HAS sites must have
  a row. A new one is undeclared surface. The walk is **recursive**; nested files
  are declared by their path relative to the section directory
  (`driver/postgres.zod.ts`). Zero-site files (pure enum/token modules like
  `data/date-macros.zod.ts`) are skipped — there is nothing to classify — and
  become reportable the day they grow their first `z.object(`.
- **Section totals**, and that any row claiming "strict as of" names a file that
  really contains `.strict()`.

Deliberately NOT checked: the `Class` column. Authorable vs wire vs open is a
judgement about who writes the input, and this campaign's rule is
verify-before-tightening. The gate protects the arithmetic and the coverage so
that judgement is always made against current code.

**What it found on its first run — 11 drifts, in a file being actively edited
by the campaign that owns it.** Six counts had moved (`ui/app.zod.ts` 11 → 18,
`ui/touch.zod.ts` 4 → 7, `ui/action.zod.ts` 8 → 9, `ui/view.zod.ts` 51 → 50,
`ui/responsive.zod.ts` 6 → 4, `automation/flow.zod.ts` 12 → 11), two section
totals no longer summed, and six files had no row at all. The `app.zod.ts` gap
was **self-inflicted**: the app step (#4165) added seven schemas to that file
and updated the row's prose without touching its count. Five of the six
undeclared files turned out to have zero sites — which is what motivated the
skip rule above — leaving `automation/io-node-config.zod.ts` as the one genuine
omission, now classified.

That is the argument for the gate in one paragraph: the people most familiar
with this ledger, editing it in the same week, still left eleven drifts in it.

**And then it worked for real, before it had even merged.** While the gate sat
in review, `main` landed `automation/builtin-node-config.zod.ts` (#4045/#4228) —
eight new sites, sibling to `io-node-config.zod.ts`. Merging `main` turned the
gate red on a branch whose own diff had not touched a single schema, which is
precisely the intended behaviour: the file arrived, so someone had to classify
it. It is now a row. Every existing count survived that merge unchanged, so the
failure was exactly as narrow as it should have been.

**And then the gate turned out to have the ledger's own disease.** Its coverage
walk listed each triaged directory exactly one level deep, so `data/driver/` —
three per-driver connection-config files, nine sites — was invisible to the check
whose entire promise is "no undeclared surface". The gate printed *"no undeclared
schema files"* while nine authorable sites sat outside the map. Fixed by making
the walk recursive; the three files are now a row.

Read that next to this file's own opening argument — *a map that drifts is worse
than no map, because it is followed*. The same asymmetry applies one level up,
and harder: **a gate that under-reports is worse than no gate, because it
converts "I should classify this" into "it is already classified."** No gate
leaves a reader suspicious; a green gate retires their suspicion. That is the
identical shape to the silent strip this whole campaign is about — a success
signal covering an omission — reproduced in the instrument built to detect it.
So when a check claims coverage, prove it sees something it is supposed to see
before trusting the green: this one was verified by watching it go red on
`data/driver/` and green again only once the rows existed.

Long tail stays gated on a verification pass per shape — never a one-shot
"make all ~500 sites strict" (ADR-0054 ratchet; #4001's own recommendation).
