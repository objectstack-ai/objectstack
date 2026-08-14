# @objectstack/service-automation

## 17.0.0

### Major Changes

- a648e96: fix(spec,service-automation)!: `errorHandling.maxRetries` has one default, and `strategy: 'retry'` states its count (#4247)

  `flow.errorHandling.maxRetries` was declared twice, with different values:

  - **spec** — `FlowSchema` (`automation/flow.zod.ts`): `.default(0)`
  - **engine** — `retryExecution` (`service-automation/src/engine.ts`):
    `errorHandling.maxRetries ?? 3`

  `??` fires only on `undefined`, so the winner was decided by the ROUTE a flow
  took into the engine, not by what its author wrote:

  | Path                                            | `errorHandling.maxRetries` | Retries |
  | :---------------------------------------------- | :------------------------- | ------: |
  | parsed by `FlowSchema` (`.default(0)` fills it) | `0`                        |   **0** |
  | object built by hand and fed to the engine      | `undefined`                |   **3** |

  One authored intent — "I didn't write a count" — two behaviors. The neighbouring
  `retryDelayMs ?? 1000` / `backoffMultiplier ?? 1` agreed with their `.default()`s;
  only `maxRetries` disagreed, which reads as a schema default changed from 3 to 0
  without the engine following, not as a deliberate two-track design.

  **The engine keeps no defaults of its own.** `retryExecution` now takes the
  parsed `NonNullable<FlowParsed['errorHandling']>` and destructures all five
  knobs — no `??`. This is safe because `AutomationEngine.flows` only ever holds
  `FlowSchema.parse` output (`registerFlow` parses; the version-history rollback
  re-seats an already-parsed snapshot), and it is what keeps a second set of
  defaults from growing back: a knob the spec stops defaulting becomes a compile
  error rather than a silent engine-side guess. Per Prime Directive #12 the spec
  is the one contract; a consumer-side fallback is a second de-facto one.

  **BREAKING — `strategy: 'retry'` now requires `maxRetries` >= 1.** With the
  engine's copy gone, an unstated count is unambiguously `0`, and `'retry'` with 0
  attempts runs the flow once and stops — i.e. `strategy: 'fail'` wearing another
  label, a declared capability the runtime does not deliver (Prime Directive #10
  corollary). Rather than pick 0 or 3 on the author's behalf, `FlowSchema` refuses
  the combination in both spellings (omitted → defaulted 0, and an explicit 0),
  with the prescription in the message. A retry re-runs the **whole flow from the
  start** — records created again, callouts fired again — which is not a number to
  guess for someone.

  FROM → TO:

  - `errorHandling: { strategy: 'retry' }` → `errorHandling: { strategy: 'retry', maxRetries: 3 }`
    (or `strategy: 'fail'` if no retry was intended — that is what it did).
  - `errorHandling: { strategy: 'retry', maxRetries: 0 }` → same choice, spelled out.

  Unaffected: `maxRetries: 0` under `strategy: 'fail'` / `'continue'` (neither
  reads it, and a fully spelled-out block stays legal), flows with no
  `errorHandling` at all, and every flow that already states a count — including
  the `try_catch` node's own `config.retry`, which is a separate per-region policy
  (`control-flow.zod.ts`) and is unchanged.

- 0e043d8: feat(automation)!: 未声明 `resumeAuthority` 的暂停节点改为 fail-closed —— 通用 resume 路由从「默认开门」变成「显式 `'any'` 才开门」(#5561 第二步)

  <!-- adr-0087: registered action-descriptor-resume-authority-default-flip -->

  **BREAKING**(仅影响注册了暂停型节点、且描述符未声明 `resumeAuthority` 的执行器 ——
  本仓内为零)。`AutomationEngine.resolveResumeAuthority` 对缺省值的解析由 `'any'` 翻成
  `'service'`:一个从未声明「谁可以续跑它产生的暂停」的节点类型,其暂停在通用路由
  `POST /automation/:name/runs/:runId/resume` 上被拒绝(`PERMISSION_DENIED` / 403),
  直到它的描述符把话说出来。通用 resume 门从此是描述符**主动 opt-in** 的一扇门,不是每个
  暂停节点**继承**来的默认。

  这是 ADR-0044 2026-07-28 修正案里「记录但刻意不在此建造」的第一项,分两步落地。
  第一步(#5561 / PR #5725,非 breaking)把 `ActionDescriptorSchema.resumeAuthority`
  的 Zod `.default('any')` 摘成 `.optional()`。那个默认值的问题不只是取值不对,而是它
  **抹掉了事实**:`defineActionDescriptor` 在任何消费者看到对象之前就把 key 填上了,于是
  「作者选了 `'any'`」和「作者从没考虑过」parse 出逐字节相同的描述符,遗漏根本无法被观测。
  默认值摘掉之后「缺省」才重新可见,注册告警与 `check:resume-authority-declared` CI 门也
  才写得出来。第二步就是本次改动:让缺省真正意味着 fail-closed。

  ### 为什么往「拒绝」这个方向猜

  两种猜错的代价不对称,这就是全部理由。猜 `'any'`,会让一次 resume 走过一个**没有任何
  记录的决策**,而且悄无声息 —— #3823 就是这么发生的:ADR-0044 把审批的 `revise` 边指向
  了通用 `wait`,`wait` 本身声明 `'any'` 完全正确,而站在「服务持有」位置上的那个暂停
  继承了一个没人选过的 fail-open 值;实测代价是一次未经审计的重新提交,外加一个被销毁的
  远程 run。猜 `'service'`,则是返回一次拒绝,并把修好它的那一行原样交回作者手里。
  两种错误里只有一种能被犯错的人自己发现。

  ### 迁移:`resumeAuthority` 未声明 → 显式声明(一行)

  只有**注册暂停型节点的插件作者**需要动手,处方是在描述符上加一行:

  ```ts
  // FROM —— 依赖旧默认值,暂停可被通用路由续跑
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
  });

  // TO —— 通用路由确实是这个暂停的正门时(screen 式收集输入、signal wait 式外部生产者)
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
    resumeAuthority: "any",
  });

  // TO —— 续跑是「某个服务必须先授权并记录的决策」的尾巴时
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
    resumeAuthority: "service",
  });
  ```

  两个值都被接受,**只有沉默改变了含义**。三条运行时通道会指着同一件事说话:注册时按类型
  去重的一次告警、resume 被拒时那条点名缺省字段并给出处方的错误消息,以及本仓自有执行器的
  `check:resume-authority-declared` CI 门。

  ⚠️ `supportsPause` 本身是一个没有任何执行路径强制的声明(#5703)—— run 会暂停是因为
  `execute()` 返回了 `suspend: true`。所以一个「会暂停但把 `supportsPause` 留成 false」
  的执行器,注册告警与 CI 门**都看不见它**,只有 resume 时的拒绝消息会带上同一份处方。
  请按同一条规则手工核一遍这类执行器。

  ### 仓内零行为变化

  在册的六个暂停类型全部已显式声明:`screen` / `wait` / `subflow` / `map` 声明 `'any'`
  (第一步补齐),`approval` / `approval_revise` 声明 `'service'`。解析器测试与端到端测试
  都把这份清单和它们的解析结果一起断言 —— 一个只靠「什么都没注册」而变绿的零点名,和真的
  零点名是两回事。

  `@objectstack/runtime` 只是注释与路由账本(`route-ledger`)的记述同步,无行为改动。

- 4845f85: **The retry policy's last two dialects converge** (#4964 `flow.errorHandling`, #4962
  `ETLPipeline.retry`).

  #4661 converged the retry policy onto one declaration. It converged the two shapes that
  published the **same exported name** (`RetryPolicy` from `./automation` and `./system` —
  the #4411 trap), because that is the question the dual-source instrument asks. Two more
  encodings of the identical concept were outside its vision _by construction_: both are
  anonymous inline `z.object`s nested in a bigger schema, with no exported name to collide.

  The cost of the gap fell on the author who did the right thing. `shared/retry-policy.zod.ts`
  tombstoned `retryDelayMs` and told them to write `backoffMs` — and `flow.errorHandling`
  then **rejected** `backoffMs` and demanded `retryDelayMs`. Reading the newer file was
  punished, and which file an AI author reads first is arbitrary.

  All four surfaces — `job.retryPolicy`, a `try_catch` node's `retry`, `flow.errorHandling`
  and an ETL pipeline's `retry` — now build from one shared shape.

  ## FROM → TO

  ### `flow.errorHandling` (#4964)

  |                                                                   | FROM                                | TO                                                                       |
  | ----------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
  | base delay                                                        | `retryDelayMs`, min 0, default 1000 | **`backoffMs`**, min 0, default 1000                                     |
  | `maxRetries` / `backoffMultiplier` / `maxRetryDelayMs` / `jitter` | _(already identical)_               | unchanged                                                                |
  | `strategy`                                                        | `'fail' \| 'retry' \| 'continue'`   | unchanged — it selects _whether_ the policy runs, so it stays outside it |

  One key, one word, no default changes. Every other key, bound and default already
  matched the converged policy, which is exactly why the divergence survived a release:
  it looked reviewed.

  ### `ETLPipeline.retry` (#4962)

  |                     | FROM                                           | TO                                        |
  | ------------------- | ---------------------------------------------- | ----------------------------------------- |
  | count               | `maxAttempts`, min 0, **default 3**, unbounded | **`maxRetries`**, 0–**10**, **default 0** |
  | base delay          | `backoffMs`, default **60000**                 | `backoffMs`, default **1000**             |
  | `backoffMultiplier` | _(absent)_                                     | ≥1, default 1                             |
  | `maxRetryDelayMs`   | _(absent)_                                     | default 30000                             |
  | `jitter`            | _(absent)_                                     | default false                             |

  ## What you must change

  **1. Rename `retryDelayMs` → `backoffMs`** in any `flow.errorHandling` block. The value
  (milliseconds before the first retry) is unchanged. The old spelling is **tombstoned**,
  not deleted, so it rejects with the rename rather than being silently stripped, and
  `os migrate meta --from 16` (the `retry-policy-converged` conversion, now with a
  flow-level branch) rewrites it for you.

  **2. Rename `maxAttempts` → `maxRetries`** in any `ETLPipeline.retry` block. **The number
  does not change** — both counted the retries _after_ the initial attempt. Do **not**
  subtract one: that adjustment belongs to `integration/connector.zod.ts`'s
  identically-spelled `RetryConfig.maxAttempts`, which _includes_ the first attempt and is
  deliberately **not** part of this convergence.

  **3. If an ETL pipeline relied on the implicit retry count, write it out.** `retry: {}`
  used to mean three re-runs 60s apart; it now means **none**. State `maxRetries: 3` (and
  `backoffMs: 60000` for the old delay) to keep the old behaviour.

  ## Why the ETL default flips to 0

  Not merely to follow #4661. An ETL destination is a foreign system _by definition_ — a
  warehouse, an API, someone else's database. A silent retry against a non-idempotent
  destination is a **duplicate write**: a second invoice, a second export, a second
  webhook. Default 0 makes retrying something an author states, and thereby claims
  idempotency for. An unstated key is precisely where LLM-authored metadata hides this.

  ## Migration surface

  **`flow.errorHandling`** is live: `service-automation`'s `retryExecution` reads the key
  (it now destructures `backoffMs`), and the D2 conversion covers stored and authored
  flows, so no deployed stack changes behaviour.

  **`ETLPipeline.retry` has an empty migration surface today, and that is why now was the
  moment.** `etl.zod.ts` has no parse site in objectstack / objectui / cloud (批 12's
  measurement) and an ETL pipeline is not a `defineStack` collection, so there is no stored
  document a conversion could walk — it deliberately gets a tombstone and **no** D2 step,
  rather than a walker advertising coverage that does not exist. Once an ETL engine lands,
  flipping this default stops being a schema edit and becomes a behaviour change to every
  deployed pipeline.

  ## Also

  The two automation retry surfaces now carry the **same** curated unknown-key table, so an
  author learns one lesson instead of two, and `retry-policy.test.ts` gains a
  concept-level guard: all four surfaces are asserted to expose the same key set and the
  same defaults, by parse rather than by inspecting how each obtains them. Adding a fifth
  retry surface without wiring it to the shared shape now fails a test — which is the check
  that would have caught both of these issues, and the one the name-based scan could never be.

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

- 2826d1e: fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

  A flow paused at an `approval` node, a deploy, then an approver clicking
  Approve: the request row flipped to `approved`, the UI toasted success — and
  the flow never moved. No next-stage request, no error, the record's mirrored
  status frozen mid-workflow. Approval flows pause for days by design, so a
  restart mid-flight is the normal case: every release could quietly zombify
  every in-flight approval, with the approvers none the wiser.

  Durable suspended runs (#1518) had shipped and were not the missing piece. Two
  other things were.

  **The wiring could enable a store over a table nobody had created.** Object
  registration and store activation resolve different services in different
  phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
  declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
  warned, and continued; `start()` then attached the DB-backed store anyway. Every
  suspend failed with `no such table: sys_automation_run` into a log line nobody
  read, pauses silently stayed in memory, and the next restart lost them all.
  Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
  engine-less kernel must still boot); a registration missed at `init()` is
  retried at `start()`, which still lands before ObjectQL's schema sync; the
  store is never attached when registration did not happen, and says so at
  **error** level instead of warning; the table is probed once at boot so a
  broken setup surfaces there rather than one failed write at a time; and a
  failed durable write of a paused run is logged at error — it is data loss in
  waiting, not a warning.

  **A reported resume failure read as success.** `AutomationEngine.resume()`
  answers a lost run by _returning_ `{ success: false }`, never by throwing.
  `ApprovalService` discarded that return value, and `decide()` counted only a
  thrown error as failure — so a decision against a dead run came back
  `resumed: true`, HTTP 200. Resume failures are now classified
  (`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
  `PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
  distinguishable from a store that is merely unreachable, and the raw resume
  route maps them to 404 / 503 / 409.

  Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
  reads the suspension store, unlike `getRun()`, and throws rather than answering
  `false` when the store is unreadable — pre-flights every flow-advancing
  operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
  zombie half-state is never created rather than merely reported: the decision
  fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
  resume that fails after the decision is durable can no longer be undone, but it
  now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
  reporting success. A concurrent duplicate resume stays benign — the engine's
  idempotency guard is doing its job — and reports through the new optional
  `resumeError` field. Recall and revise-window cancellation stay non-fatal by
  design (they abandon the request), but log at error with the reason instead of
  swallowing it. Compositions with no automation engine attached are unaffected.

  Existing zombie requests from affected deployments (already `approved`, run
  stranded) are not repaired by this change — `releaseDeadRunRequests` only
  sweeps requests that are still `pending`.

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

- 62a789b: Reconcile the remaining flat builtins' declared config against what their
  executors read (#4045 — the CRUD / screen / map step, after notify / http /
  connector in #4210).

  **Six executor-derived Zod contracts.** `GetRecordConfigSchema`,
  `CreateRecordConfigSchema`, `UpdateRecordConfigSchema`,
  `DeleteRecordConfigSchema`, `ScreenConfigSchema` (+ `ScreenFieldConfigSchema`)
  and `MapConfigSchema` in `automation/builtin-node-config.zod.ts`, each written
  by reading the executor rather than transcribing the descriptor literal, so the
  new bidirectional ledger test is evidence rather than a tautology. Contract
  exports only — nothing parses with them yet (#4045 step 3b, gated on the #4059
  warning data).

  **Seven capabilities the executors honour are now authorable.** Each was read
  by the executor and offered by no form — online or offline — so it was reachable
  only by hand-written metadata:

  - `get_record.fields` — the query projection, passed straight into
    `find`/`findOne`;
  - `screen.recordId` — the record `mode: 'edit'` opens; the form declared the
    edit mode while offering no way to name its target;
  - `screen.fields[].options` / `defaultValue` / `placeholder` — all three
    forwarded into the ScreenSpec the client renders, so a select field's choices
    could not be authored in Studio at all. Same nested repeater position as the
    `visibleWhen` gap #3528 was filed for;
  - `map.indexVariable` and `map.input` — the index binding and the per-item
    subflow params.

  **`map`'s undeclared `flow` alias graduates to the conversion layer.** The
  executor carried `cfg.flowName ?? cfg.flow` for a spelling no schema ever
  described — the `notify.source` shape (Prime Directive #12). The bare fallback
  is deleted and `flow-node-map-flow-alias` (protocol 17, retires at 18) renames
  it at load, including the `AutomationEngine.registerFlow` rehydration seam.

  **`assignment` is pinned as deliberately un-reconcilable**, with the reason on
  record: with no `assignments` wrapper its top-level config keys ARE the author's
  variable names, so no fixed key set can describe it and a catchall Zod would
  reconcile vacuously. What the ledger pins instead is that the form offers
  exactly the canonical `assignments` map and that the map stays open.

  With this, every builtin that publishes a `configSchema` is reconciled against
  its executor, and the ones that publish none each have a recorded reason.

- e8f8f6c: feat(integration): 连接器动作可以声明它在上游做了什么，`connector_action` 因此能被计数 (#4395)

  #4354 给每次流程运行加上了 `selected` / `acted` 汇总，断扫告警是
  `selected > 0 AND acted = 0 AND unmeasured = 0`。`connector_action` 当时只能给出三个
  答案里最诚实的那个：`ConnectorActionSchema` 只描述动作的**形状**（`key` / `label` /
  `inputSchema` / `outputSchema`），对它究竟读还是写只字未提，所以 `crm.push_opportunity`
  和 `crm.lookup_account` 在运行时完全无法区分。`acted: 0` 会低报一次 Salesforce 创建，
  让每一条健康的连接器扫描都触发告警，操作员很快学会忽略它；`acted: 1` 会高报一次查询，
  让告警永不触发——那正是 #4354 要修的原始 bug 换个楼层重演。于是执行器报
  `metrics: { unmeasuredEffect: true }`，运行汇总记一笔 `unmeasured`。

  诚实，但也是盲区：**任何走连接器的自动化流程都贡献不出任何信号**——既无法证明自己
  干过活，也无法在停止干活时被标记出来。

  **现在动作可以自己声明。** `ConnectorActionSchema` 新增可选的 `effect`：

  ```ts
  actions: [
    { key: "push_opportunity", label: "Push Opportunity", effect: "write" },
    { key: "lookup_account", label: "Lookup Account", effect: "read" },
    { key: "legacy_action", label: "Legacy" }, // 不声明 —— 行为完全不变
  ];
  ```

  `connector_action` 执行器据此计数：声明 `write` 且派发成功 → `acted: 1`；声明 `read`
  → `acted: 0`（这是一个**真实测得的零**，不是耸肩，所以只做查询的流程重新落入断扫告警
  的射程）；不声明 → 维持原样 `unmeasuredEffect`。派发失败时，声明 `write` 的动作回落为
  不可计数而非零——处理器抛错时上游可能已经写成了，这与 `http` 节点对被拒绝的写请求做的
  判断一致；声明 `read` 的动作则仍报 `acted: 0`，它无论如何都不可能改动任何东西。

  声明是可选的，这是有意为之：**已有的连接器一个字都不用改，报告的内容与之前逐字相同**，
  声明它是纯增益而不是一次迁移。`unmeasuredEffect` 的含义和消费者一个都没变，它现在是
  兜底而不是唯一答案。

  同一个声明也随 `ConnectorActionDescriptor` 一路送到设计器：`GET /api/v1/automation/connectors`
  现在会带上 `effect`，作者在流程设计器里挑动作时，"这个会写" 是关于这次选择的事实。

  `effect` 落在**可作者化的** `ConnectorActionSchema` 上，而不只是描述符接口上，因为那是
  唯一可能的产地：`AutomationEngine.registerConnector` 存的是 `ConnectorSchema.parse(def)`
  的结果，描述符是从这份 def 投影出来的。插件注册路径和 ADR-0097 声明式 materialization
  路径都经过这一次 parse，所以两条路都能声明；只加在描述符上则永远无法被任何东西填充
  （`ConnectorSchema` 是非 strict 的 `z.object`，改动前作者写下的 `effect` 会被静默丢弃）。

  bulk 场景的**计数型**效果（一次动作报告它在上游碰了多少条记录）暂不做，等真实需求。
  读/写这一刀才是解开告警的那一刀。

- 5293114: fix(automation): a decision's three declared ways to route a branch are now one working model (#4414)

  A `decision` node advertised three mechanisms for splitting a path and only one
  of them did anything. The other two were the ADR-0049 `declared ≠ enforced`
  shape, and the pair of them shipped a guard that does not guard in
  `examples/app-crm`.

  | mechanism                                            | before                                                                                                 | now                                                   |
  | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
  | `edge.condition`                                     | ✅ the only one that worked                                                                            | unchanged                                             |
  | `edge.isDefault`                                     | **zero readers** anywhere but the schema declaration                                                   | BPMN default flow, enforced in `traverseNext`         |
  | `decision.config.conditions[].label` → `branchLabel` | matched **0** out-edge labels across every example app, then fell back to the full edge set in silence | routes; an unclaimable label is logged, not swallowed |

  ## What was broken, end to end

  `crm_convert_lead_wizard` means "already converted → abort screen; otherwise →
  the wizard". It ran **both**: an already-converted lead got
  "This lead has already been converted" and then walked straight into the
  conversion wizard behind it. Four independent silences stacked up:

  1. the decision's first condition was authored `{lead_record.status} ==
'converted'` — braces in a slot declared bare CEL, so it was string-compared
     and never true;
  2. the second (`'true'`) therefore won, yielding `branchLabel: 'No — proceed'`;
  3. no out-edge carried that label (they were `'Yes'` / `'No'`), so traversal
     discarded the branch and considered every out-edge;
  4. `e3b` was unconditional, so it ran regardless — and the natural fix, marking
     it `isDefault: true`, was a dead key.

  ## The model

  `branchLabel` narrows the edge set → `condition` gates each edge → `isDefault`
  catches whatever is left. Concretely:

  - **`isDefault` is enforced.** A default edge is traversed only when no
    conditional sibling of the same source node matched, and it is no longer part
    of the unconditional parallel fan-out — that distinction is the whole point of
    the marker. Passed over because a real branch won, its target records the same
    `skipped` step a closed gate does (#4354).
  - **An unclaimable branch label warns.** Traversal still falls back to the full
    edge set (a run mid-flight must not die on a metadata error) but says so,
    naming the computed branch and the out-edge labels that exist.
  - **A decision that declares no `conditions` reports no branch.** It used to
    report `'default'` unconditionally — a label no out-edge in the repo ever
    carried — which is why every decision node fell back to the full edge set.
    The `'default'` sentinel survives for the case it actually describes (declared
    conditions, none matched) and is now claimed by the `isDefault` edge as well
    as by an edge literally labelled `'default'`.
  - **`conditions[].expression` is evaluated as the bare CEL it is declared to
    be.** The raw string went to the legacy `{var}` template path, where
    `lead.status == 'converted'` cannot resolve and the branch is decided by
    string comparison. Unlike `edge.condition` this slot carries no
    `ExpressionInput` envelope — the decision descriptor is deliberately
    schemaless — so the executor supplies the dialect. A brace-in-CEL predicate
    now fails loudly (ADR-0032 §1c) instead of deciding `false`.

  ## Caught at authoring time too

  Four new `os build` / `os validate` warnings, because a wrong route is silent at
  run time by nature (Prime Directive #12):

  `flow-branch-label-unmatched` (the shipped shape),
  `flow-decision-unconditional-branch` (a guarded decision with an unconditional
  sibling — the actual hole), `flow-default-edge-with-condition` and
  `flow-multiple-default-edges`.

  Both of the first two fire on the pre-fix `convert-lead.flow.ts` and are silent
  after it.

  ## Effect on flows that already exist

  Enforcing `isDefault` changes how a **stored** flow behaves, and the flows it
  changes are mostly Studio's own. `objectui`'s flow edge inspector has always
  written `isDefault: true` when you bind an out-edge to a decision's default/else
  branch — into a key with zero readers, so that edge ran unconditionally, in
  parallel with whichever branch actually matched. Those flows now take exactly
  one branch. That is the fix, but it is a behaviour change on existing data
  rather than only on newly authored metadata, so it is worth knowing before
  upgrading: a flow that quietly ran two paths will now run one.

  Nothing changes for an edge that never carried the marker — `isDefault` defaults
  to `false`, and an ordinary unconditional out-edge still fans out in parallel
  exactly as before.

  ## The example app

  `crm_convert_lead_wizard`'s guard is now a plain exclusive gateway: the
  redundant `config.conditions` is gone and `e3b` carries `isDefault: true`. One
  mechanism per decision, and exactly one branch runs.

  Verified: 11 new engine/executor tests (including the reported repro in both
  directions), 12 new linter tests; `@objectstack/service-automation` 577 tests
  and `@objectstack/cli` 652 tests green, all three example apps build with no new
  findings.

- ac471a0: **BREAKING**: `IAutomationService.getSuspendedScreen(runId)` is now **async** — it returns `Promise<ScreenSpec | null>` instead of `ScreenSpec | null` (#4515).

  FROM → TO for anyone calling or implementing it:

  ```ts
  // caller
  - const screen = automationService.getSuspendedScreen(runId);
  + const screen = await automationService.getSuspendedScreen(runId);

  // implementer
  - getSuspendedScreen(runId: string): ScreenSpec | null
  + async getSuspendedScreen(runId: string): Promise<ScreenSpec | null>
  ```

  One-line fix: `await` the call (the enclosing function is almost certainly already `async`), and make any test double resolve rather than return (`mockResolvedValue`, not `mockReturnValue`).

  Why it had to change: the method could only ever read the engine's in-memory hot cache, because a synchronous signature cannot consult the durable suspended-run store. `SuspendedRun.screen` _is_ persisted (`sys_automation_run.screen_json`) and `resume()` cold-reads it back, so after a process restart a still-suspended screen run could be resumed (`POST …/runs/:runId/resume` → 200) while `GET …/runs/:runId/screen` returned 404 “No pending screen for run” — the refresh-safe re-fetch failing in exactly the situation it exists for (page refresh, another device), and the rendering half of ADR-0019's durable-suspend promise missing while the resuming half shipped.

  `AutomationEngine.getSuspendedScreen` now takes the hot cache as its fast path and falls through to the store via the same loader `resume()` rehydrates from. A run that does not exist, is no longer suspended, or paused at a non-screen node still resolves to `null`, so `GET …/runs/:runId/screen` keeps returning 404 for genuinely absent runs. No sync variant of the method remains on the contract.

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- 2f47489: fix(automation): a `fault` edge must not switch off a guardrail (#3863)

  A `fault` edge routes a failed node to a handler instead of aborting the run.
  That is the right primitive for the world not cooperating — an `http` node that
  404s, a connector that rate-limited, a rejected write.

  It was also, until now, routing the **refuse-to-execute** family. Those guards
  report that the METADATA is wrong, not that an operation failed: #3810
  (interpolation erased a filter condition), ADR-0049/#1888 (the run would execute
  unscoped), a data node naming no object. Because they surfaced as ordinary node
  failures, one declared edge silently disabled them.

  **The live consequence, reproduced in a test before the fix:** attach a `fault`
  edge to a `delete_record` whose filter has a typo (`{record.ownr}`), and #3810's
  protection against emptying the object was gone — the guard fired, the handler
  swallowed it, and the run reported `success: true`. That is the exact fail-open
  direction #3810 was opened to close, reachable from a single edge, and it is the
  kind of suppression an AI authoring loop reaches for first when trying to make a
  diagnostic go away.

  **Failures now carry a class.** `NodeExecutionResult.errorClass` is `'runtime'`
  (default — every existing executor keeps its current routing) or `'guard'`.
  Guard-class failures are never routed: they stay fatal with or without a `fault`
  edge, and the run fails with the guard's own message. Thrown guards are covered
  too — `UnscopedRunDataAccessError` is branded via a shared `guard-refusal`
  module, so the engine's catch path cannot become the bypass the return path no
  longer is.

  Marked as guard-class: the three `resolveNodeFilter` refusals (#3810), the four
  `objectName required` refusals, and `UnscopedRunDataAccessError` (ADR-0049).
  Genuine engine failures (`get_record(x) failed: …`) stay runtime-class and keep
  routing.

  **Also in this change**

  - `{<nodeId>.error}` now carries a failed node's message alongside the run-wide
    `{$error}`. `$error` names only the most recent failure, so a handler shared by
    two fault edges could not tell which node it was handling; `{charge_card.error}`
    is addressable from any downstream template. Additive — `$error` is unchanged.
  - Fault edges are **documented** for the first time (`content/docs/automation/flows.mdx`
    and the automation skill), including the routable/not-routable split. The skill
    entry says plainly not to add a fault edge to silence a guard error, since that
    is the misuse the class split now makes impossible.

  A run that takes a fault branch still reports success, and the failed step still
  carries `status: 'failure'` and its message in the trace — recovery does not
  erase the record of what failed (#3356/#3407).

- 68c02c2: fix(automation): `evaluateCondition` decides the dialect from the source, not from the caller (#4336)

  `AutomationEngine.evaluateCondition` picked its engine by asking whether an
  `{ dialect, source }` **envelope** was present. A condition handed to it as a
  plain string therefore never reached the CEL engine: it fell through to the
  legacy `{var}` template path, which substitutes brace holes and then compares
  whatever text is left — **as text**. Nothing errored, and the run was recorded
  as `success`, with the failure direction depending on the predicate:

  | Handed in              | Actually evaluated                     | Result                               |
  | :--------------------- | :------------------------------------- | :----------------------------------- |
  | `existingTask == null` | `'existingTask' === 'null'`            | always **false** — gate never opens  |
  | `record.rating >= 4`   | `'record.rating' >= '4'` → `'r' > '4'` | always **true** — branch pinned open |

  #4414 fixed the one built-in that was reaching this — the `decision` executor
  now wraps `conditions[].expression` in a CEL envelope before calling. This
  fixes the **evaluator**, so the next caller does not have to remember: the
  dialect is now read from the source, and a condition is CEL unless it actually
  contains a `{var}` hole. `evaluateCondition` is public API, so a
  plugin-registered node executor evaluating its own predicate was getting the
  table above with nothing to warn it.

  **The legacy `{var}` dialect keeps working** where it always did —
  `{amount} > 100`, `{status} == active`, `{a.b} == 7` — and gains the two things
  it was missing:

  - **A quoted literal compares as its contents.** `{status} == 'active'` used to
    compare `active` against `'active'` — quotes included — and was false for
    every value of `status`. It is the spelling the flow docs showed, and quoting
    a string literal is what every other predicate surface requires.
  - **It no longer answers `false` when it could not resolve something.** A `{…}`
    hole matching no flow variable (`{lead_record.status}` — `get_record` stores
    the whole row under one name, so that key never exists) and a substituted
    value that is neither a boolean, a number, nor part of a comparison are
    refused with the source and the offending reference attached. Both used to be
    a silent `false`, which ADR-0032 §1c forbids: a predicate that cannot be
    evaluated is a fault, never a quiet branch decision.

  Braces inside an explicit `dialect: 'cel'` envelope remain the #1491 brace-trap
  and still throw — stating the dialect is the author saying "this is CEL". The
  sniff reads the source outside string literals, so `record.label == '{pending}'`
  stays CEL and compares the field.

  **Tightening to know about:** a bare string that is not valid CEL now raises
  where it previously string-compared to some answer. That includes the
  host-language payloads the safety tests use (`process.exit(1)`,
  `require("fs")…`) — nothing executed before and nothing executes now, since CEL
  has no `process`, no `require` and no arrow functions, but the failure is a
  reported fault instead of a silent `false`.

- 168f60f: feat(spec,automation): `update_record` / `delete_record` can declare bulk intent with `multi` (#5393)

  A flow could not express "write every row this filter matches" — at all, from
  any app. `UpdateRecordConfigSchema` / `DeleteRecordConfigSchema` are
  `strictObject`s and neither declared any spelling of bulk intent (`multi`,
  `bulk`, `all` and `options.multi` were each rejected as an unrecognized key),
  and the CRUD executors never passed `options.multi` to the data engine. The
  engine accepts a write only when `where.id` is a **scalar** or `options.multi`
  is truthy, and throws otherwise — so a predicate `update_record` /
  `delete_record` was unreachable, while the node descriptors advertised
  `Delete Records` / "Delete records matching a filter." Declared ≠ enforced
  (Prime Directive #10); the symptom was #5225's showcase sweep flow, which had
  never deleted a record.

  **New authorable key — `multi` (boolean, default `false`), on `update_record`
  and `delete_record`.** One name for one concept (PD #12): `multi` is what the
  data engine has always called it (`EngineUpdateOptions.multi` /
  `EngineDeleteOptions.multi`), so the word is the same from node config to
  driver call and greps end to end.

  ```ts
  // before — refused by the engine at run time, with no authoring-time signal
  { type: 'delete_record', config: { objectName: 'lead', filter: { stage: 'stale' } } }

  // after — the declaration makes the intent explicit and the write reachable
  { type: 'delete_record', config: { objectName: 'lead', filter: { stage: 'stale' }, multi: true } }
  ```

  - **Absent or `false`** — unchanged behaviour. The executor forwards
    `multi: false`, so the write must name one row by scalar `id`; anything else
    (a predicate, or `id: { $in: [...] }`) is refused by the engine with
    `Delete requires an ID or options.multi=true`. **That refusal is the
    contract**, not a defect to route around: it is what keeps an undeclared
    unbounded write from happening by accident.
  - **`true`** — the executor forwards `options.multi: true`, the write lands on
    `driver.updateMany` / `deleteMany`, and the step's `acted` metric reports the
    affected row count.

  Additive and backward compatible: no existing flow changes behaviour, and every
  by-id write keeps working untouched.

  Two guards are unchanged and worth stating explicitly. The #3810
  erased-condition guard still refuses a node whose authored filter condition
  interpolated to nothing, `multi` or not — bulk intent says "many rows are
  fine", never "a condition may vanish". And `multi: true` with **no** `filter`
  is the whole object, by declaration: write the constraint you mean.

  Wrong spellings are answered by name rather than by edit distance (which
  reaches `multi` from none of them): `bulk` / `all` / `multiple` get the
  prescription, and `options: { multi: true }` is called out as the engine's
  options bag written at the node's altitude.

- b07d829: feat(automation,spec): flow executors `parse()` their config, and undeclared config keys reject at registration (#4277)

  The #4045 reconciliation left every flat builtin with a Zod config contract that
  nothing enforced, and #4059 left `registerFlow` warning about undeclared keys it
  could not yet safely reject. #4277 installs both halves of the enforcement:

  **1. Executors parse their config (execute time).** The 12 contract-carrying
  builtins — `get_record` / `create_record` / `update_record` / `delete_record`,
  `screen`, `map`, `notify`, `http`, `loop` / `parallel` / `try_catch` — now run
  `node.config` through their Zod contract before executing
  (`service-automation/builtin/parse-config.ts`). A type or missing-`required`
  violation refuses the node as a **guard** (`errorClass: 'guard'`, not routable
  via `fault` edges — config is metadata; re-running changes nothing), naming
  every violated path. `{token}` templates stay legal: string-typed slots parse
  the raw template, and `http` — whose executor reads the interpolated config —
  parses POST-interpolation, where a whole-token template has already resolved to
  its value's real type. Exemption: a legacy flat-graph `loop` (no `config.body`)
  predates the ADR-0031 construct and is not parsed.

  **2. Undeclared config keys are rejected at `registerFlow` (registration
  time).** The #4059 warning is now an error: a config key the node type's
  descriptor `configSchema` does not declare fails registration, with the exact
  path, the declared key set, a did-you-mean, and — for keys with documented
  history (`screen.visibleIf`, `create_record`/`update_record.fieldValues`) — a
  per-key tombstone (the `UNKNOWN_KEY_GUIDANCE` pattern). Unchanged exemptions:
  `assignment` is exempt wholesale (its top-level keys ARE the author's variable
  names), schemaless types (`decision`/`script`/`wait`/`subflow`/
  `connector_action`) declare nothing so nothing can be undeclared, and keyValue
  maps stop the walk (their keys are author data). Every `registerFlow` call site
  already try/catches per flow, so a bad stored flow is skipped loudly at boot,
  never a crashed kernel.

  **Contract fix folded in:** `LoopConfigSchema.collection` is now
  `z.union([z.string().min(1), z.array(z.unknown())])` — the executor has always
  accepted an inline array (shared resolve logic with `map.collection`, which
  already declared the union), so the string-only declaration under-declared what
  it reads.

  **Migration.** If a flow stops registering: the error names the undeclared key
  and its path — rename it to the declared key it meant (`visibleIf` →
  `visibleWhen`, `fieldValues` → `fields`), or delete it (an undeclared key was
  never read, so removing it changes no behavior). If an executor of yours
  genuinely reads the key, declare it on the node type's descriptor
  `configSchema`. If a node starts refusing at run time: the refusal names each
  violated path against the contract — fix the value's type or supply the missing
  required key (e.g. `get_record` `limit` must be a number; `screen`
  `fields[].options` entries are `{ value, label }` objects; `notify` requires
  `recipients` + `title`). Retry-policy defaults now come from the contract: a
  `try_catch` `retry` block that omits `retryDelayMs` gets the documented 1000ms
  base delay where the executor historically used 0.

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

- eb4204b: feat(automation): a `script` node's purity contract is declared, and a function that writes can say so (#4396)

  The `script` executor's contract — _the named function returns a value; data I/O
  stays on the flow graph_ — existed only as a comment inside the executor, while
  #4354's run summary depended on it. That summary reports no record metrics for a
  `script` step precisely because a pure function's writes are downstream
  `create_record` / `update_record` nodes counting themselves. A function that
  wrote anyway made its run report `selected: 30, acted: 0` — indistinguishable
  from the broken sweep the counters exist to detect, recorded permanently on
  `sys_automation_run`.

  **The rule is now visible.** `ActionDescriptor` carries
  `handlerContract: 'none' | 'pure'`, and the `script` descriptor publishes
  `'pure'`, so the action catalog, the designer palette and the reference docs
  state the rule an author has to follow instead of an executor holding it
  privately.

  **And a legitimate writer can opt out honestly.** A `defineStack({ functions })`
  entry may declare what it does, in either shape:

  ```ts
  defineStack({
    functions: {
      scoreLead: (ctx) => ({ score: 42 }), // pure — the default
      syncBilling: { handler: syncBilling, effect: "writes" }, // declared writer
    },
  });
  ```

  A step calling a declared writer reports `unmeasuredEffect`, so the run's
  `unmeasured` tally keeps the broken-sweep query
  (`selected > 0 AND acted = 0 AND unmeasured = 0`) off that flow — and only that
  flow. Marking _every_ `script` step unmeasured was rejected: it would blind the
  detector on every flow that calls any function in order to cover the few that
  break the rule.

  Nothing here is retired or renamed: a bare `functions: { fn }` entry is
  unchanged and means `effect: 'pure'`. The declaration is carried end to end —
  `ObjectQL.registerFunction` accepts `{ packageId, effect }` alongside the
  existing `packageId` string and exposes `resolveFunctionEntry(name)`,
  `objectstack build` lowers a declared entry without dropping it, and the
  artifact loader re-attaches the module's callable to the declaration the JSON
  carried.

  **Also fixed:** `bindHooksToEngine` returned before registering a bundle's
  functions when the stack declared no hooks, so a flow-only app's
  `defineStack({ functions })` reached the engine as nothing and every `script`
  node calling one failed with "no function named 'x' is registered".

- 5524f84: feat(automation): opt-in single-hop lookup expansion for record-change flow templates (#3475)

  A record-change flow can now declare `expand: ['<lookup_field>', …]` on its start
  node config so node templates resolve `{record.<lookup>.<field>}` (e.g.
  `{record.account.name}` in a notify title, closing the #3426 gap for lookups).

  The engine re-reads the declared relations AFTER identity resolution, as the
  run's OWN principal — `resolveRunDataContext` honors `runAs`, so a `runAs:'user'`
  run reads the referenced object as the **triggering user** (its RLS/FLS enforced)
  rather than system-elevated. This is what made expansion unsafe to do in the
  trigger's re-read (which has no resolved grants) and is why it lives in the
  engine (new `AutomationEngine.setRecordExpander`, bridged by the plugin to the
  same data engine the CRUD nodes use).

  Only the declared relation keys are grafted onto the run record, so bare lookup
  ids and `multiple` lookup arrays (#1872) on other relations — and the formula
  fields the trigger already hydrated — are untouched. Opt-in ⇒ zero cost when
  unused; best-effort ⇒ a re-read failure leaves the record unexpanded and never
  breaks the flow.

  The `os validate` lint rule `flow-template-lookup-traversal` (#3426/#3472) is now
  suppressed for a relation once the flow declares it in `config.expand`.

- a47ac06: feat(spec,automation): graduate the seven flow-node config key aliases into the conversion layer — the `readAliasedConfig` shim retires with them (#3796)

  `FlowNodeSchema.config` is an unconstrained record, so the executors were the
  only statement of which config key is canonical — and seven deprecated aliases
  lived there as tolerance the spec never declared: one behind the
  `readAliasedConfig` deprecation shim (warned, ledgered), six as open-coded
  `??` fallbacks (no warning, no ledger, no retirement path). All seven now
  graduate into the ADR-0087 D2 conversion layer as protocol-17 **live-window**
  entries: a stored flow authored with an alias is rewritten to the canonical
  key at load — `defineStack` / `validate` / `lint` and the
  `AutomationEngine.registerFlow` rehydration seam alike — with a structured
  `ConversionNotice` per rewrite, and the executors read the canonical keys
  only. The shim (`service-automation/src/builtin/config-aliases.ts`) is empty
  and deleted.

  FROM → TO (per node type; conversion entry in parentheses):

  - `get_record`/`create_record`/`update_record`/`delete_record`:
    `config.object` → `config.objectName` (`flow-node-crud-object-alias`)
  - `notify`: `config.to` → `config.recipients`, `config.subject` →
    `config.title`, `config.body` → `config.message`, `config.url` →
    `config.actionUrl` (`flow-node-notify-config-aliases`)
  - `script`: `config.functionName` → `config.function`, `config.input` →
    `config.inputs` (`flow-node-script-config-aliases`)

  One-line fix: rename the key in your flow source — values are unchanged; `os
migrate meta --from 16` rewrites all seven mechanically. Until then nothing
  breaks: the protocol-17 loader accepts and converts the old shape (window
  retires in 18).

  `actionUrl` (not `url`) is the deliberate canonical of its pair, resolving a
  contradiction where the notify descriptor documented `url` as canonical while
  the executor, tests, and examples preferred `actionUrl`: the whole downstream
  chain already uses that name (`sys_notification.action_url`, the
  channel-dispatch contract, the REST notification read model), and `url`
  elsewhere in the platform means "HTTP endpoint to call" (`http` node,
  webhooks) — a different concept from this in-app click-through target. The
  executor precedence already put `actionUrl` first, so the choice is
  behaviour-preserving; the `notify` descriptor's `configSchema` now documents
  `actionUrl`.

  Callers that hand a node config **directly** to an executor (bypassing
  `registerFlow`) no longer get alias resolution — build the config with the
  canonical keys.

- e4c61a7: Validate the expression slots a flow node's `configSchema` declares (#4027).

  A node type's designer `configSchema` and the keys its validators traverse were
  two unreconciled lists. Both the engine's `registerFlow` pass and the author-time
  `objectstack validate` pass hardcoded `config.condition` / `edge.condition` and
  assumed every other node string was a `{var}` template — so a declared expression
  property outside that hardcoded set was validated by nobody.

  That is how #3528 shipped. `screen.fields[].visibleWhen` has been on the `screen`
  descriptor since #3304, typed `xExpression: 'expression'` (bare CEL) and offered
  to authors in Studio, but no validator traversed it. An app authored the
  predicate in the _other_ dialect — `'{createOpportunity} == true'` — and it passed
  `tsc`, `objectstack validate` and registration in silence. Because `required` _is_
  enforced, a field the author had made conditional rendered unconditionally and
  blocked Submit on an input the user was never shown: the run paused forever and no
  resume was ever issued.

  Now:

  - **`FLOW_NODE_EXPRESSION_PATHS`** (`@objectstack/spec`) is the declared ledger of
    expression-bearing node config paths, each recording the dialect it takes.
  - **Both validators read it.** A malformed `visibleWhen` is a located, quoted
    error at `registerFlow` _and_ at `objectstack validate` — `node 'screen_1'
(screen) screen field visibleWhen at config.fields[1].visibleWhen`.
  - **A reconciliation ratchet** derives the expression properties from the live
    descriptors and fails CI in both directions: a new `xExpression` property with
    no ledger entry, or a stale entry no descriptor declares. It walks every
    registered builtin, not just `screen`.

  Dialects are recorded rather than assumed because there are three, and two of them
  disagree about braces: bare CEL (`{…}` is the #1491 brace-trap), single-brace
  `{var}` flow interpolation (`{…}` is correct), and the ADR-0032 §3 double-brace
  text template. Only bare-CEL slots are checked — `loop.collection` and
  `map.collection` are recorded as `flow-template` and deliberately left alone,
  since no validator implements their dialect and checking them under either of the
  other two would reject every currently-valid flow.

  `ActionDescriptor.configSchema`'s TSDoc no longer claims `registerFlow()`
  validates `config` against it. It never did: `FlowNodeSchema.config` is
  `z.record(z.unknown())`, so types, `required`, `enum` and unknown keys are still
  unenforced. The doc now states exactly what is checked and what is designer-facing
  only, so nothing relies on a guard that does not exist.

- 25784cf: fix(automation,approvals): 节点类型校验推迟到插件贡献完成之后 —— approval flow 不再被误报"运行时会失败" (#4771)

  showcase 每次冷启都打印 8 条断言:这些 flow "will fail at execution time"。8 条全是假的。
  `AutomationServicePlugin.start()` 从 ObjectQL registry 拉起 flow 并**当场**校验节点类型,而
  `ApprovalsServicePlugin.start()` 在 0.8 秒后才注册 `approval` 执行器 —— 校验器在词汇表还没
  成型的时候就下了结论。

  真正的代价不是噪音,是信号丢失:**真的没装 approvals 插件**的部署会得到一模一样的 8 条告警,
  所以这条 warn 无法区分"健康"和"坏掉",信噪比为 0。

  ADR-0018 明确把节点词汇表定义为**开放、可运行时扩展**的(插件通过
  `registerNodeExecutor(type)` 贡献类型)。因此校验只在词汇表**封闭**的那一刻才成立:

  - `AutomationEngine.sealNodeTypeVocabulary()` —— 宣告词汇表封闭,对**所有**已注册 flow 跑一次
    权威校验,每个有问题的 flow warn 一条。`AutomationServicePlugin` 在 `kernel:bootstrapped`
    调用它(严格晚于每个插件的 `start()` 和每个 `kernel:ready` handler —— 本插件自己的
    `kernel:ready` 还会再注册一批 flow,别的插件也可能在它的 `kernel:ready` 里贡献执行器)。
  - `AutomationEngine.getUnknownNodeTypeAudit(): UnknownNodeTypeAuditEntry[]` —— 同一发现的
    **状态**形态,供 host(CLI 启动摘要、健康检查)直接读,而不是去 grep 日志。与
    `getTriggerBindingAudit()` 同一套路。
  - 封闭之后 `registerFlow` **恢复即时告警**:Studio 发布 / dev reload 进正在运行的服务器时,
    词汇表确实是完整的,那句断言此时为真。所以这是时序修复,不是把告警静音。

  告警文案也随之改成它现在能承诺的事:"Every plugin has started, so nothing will register them
  now — these nodes fail at execution time with NO_EXECUTOR",并给出补救动作。

  一并修掉同一缺陷类的另一半:`ApprovalsServicePlugin` 在**拿不到 automation 引擎**时,把
  "`approval` 节点没注册"记成 `info` —— 而 dev 的默认日志级别是 `warn`,于是**真降级发生时反而
  看不见**(#4632:静默降级必须响亮)。现在是 `warn`,写明后果(该部署里每个 ADR-0019 approval
  flow 都会以 NO_EXECUTOR 失败)和补救(装 `@objectstack/service-automation`)。`catch` 同时收窄
  到"服务查找"这一步,`registerApprovalNode` 内部真出错时会以自己的身份抛出,而不再被贴上
  "no automation engine" 的错误标签;`automation` 服务存在但不接受节点执行器的分支从前**一条日志
  都不打**,现在同样 warn。

  **嵌入式 host 注意**:直接 `new AutomationEngine()` 而不经过 `AutomationServicePlugin` 的宿主,
  需要在自己的插件都装好之后调用一次 `sealNodeTypeVocabulary()`,才能拿到这条告警(以及之后的
  即时校验)。

- 081aa6f: feat(spec,service-automation): every flow run reports what it actually did — selected / acted / skipped (#4354)

  `success: true` never meant "it did its job". A scheduled sweep that selects
  thirty records and writes none is, from outside, **identical** to one with
  nothing to do: same green status, same empty output, same silence, same schedule
  tomorrow. There was no signal anywhere that separated "nothing to do" from
  "broken".

  That is not theoretical. #4347 left three hotcrm production flows completely
  inert — the stalled-deal sweep found every stalled deal and nudged nobody, the
  renewal sweep booked nothing, the campaign action enrolled no leads. They ran
  daily, on time, green, for as long as they had existed, and were caught only by
  adding tests that assert on records written. Automation is exactly the category
  where nobody is watching: a UI bug files a ticket within the hour, a dead sweep
  files nothing, and the longer it runs the more normal the silence looks.

  **Every terminal run now carries a `FlowRunSummary`** — on the
  `AutomationResult`, on the run in `listRuns` / `getRun`, in the log, and in the
  database:

  ```
  [automation] run flow=stalled_deal_sweep run=run_a1b2 status=completed durationMs=142 selected=30 acted=0 skipped=30 gate=check_stalled->send_nudge:30
  ```

  - `selected` — records read by the run's data nodes
  - `acted` — records created / updated / deleted, plus effects dispatched
    (notifications delivered)
  - `skipped` — node executions a closed gate prevented, one per loop iteration
    whose conditional edge evaluated false
  - `nodes[]` — per-node terminal status with `runs` / `failures` / `skipped`
  - `gates[]` — which gates closed and how often, most-skipped first

  **The counts are declared, not sniffed.** Executors report
  `NodeExecutionResult.metrics`, because only the node knows what its result
  _means_: `update_record`'s is a row count on a bulk write and a record on a by-id
  one, `delete_record`'s can be a boolean, `notify`'s is a delivery count. An
  engine inferring from output shapes would be guessing, and a machine-readable
  count that guesses is worse than none. A node that touches no records
  (`decision`, `assignment`) reports nothing — absent is not `0`.

  **The gate is named.** A conditional out-edge that evaluates false now records a
  `skipped` step tagged with the gate that closed. That event previously left no
  trace at all, which is why #4347 was invisible: the flow selected every row and
  the loop-body edge never opened. A skipped step is explicitly _not_ a run — the
  ADR-0044 re-entry guard, per-node `runs`, and node status all exclude it, so a
  new observability signal cannot change execution semantics.

  **Queryable, so it can be alerted on rather than noticed.**
  `sys_automation_run` gains `selected_count` / `acted_count` / `skipped_count`
  columns plus a `summary_json` breakdown:

  ```typescript
  const suspect = await engine.find("sys_automation_run", {
    where: { status: "completed", selected_count: { $gt: 0 }, acted_count: 0 },
    orderBy: [{ field: "started_at", order: "desc" }],
  });
  ```

  `selected > 0 && acted == 0` over consecutive runs is a near-perfect
  broken-sweep detector. Columns, not JSON: an operator can only alert on what is
  filterable. Rows written before this carry `null`, never `0` — "not measured"
  must not read as "measured zero", or every legacy row is a false alarm the first
  time someone writes that query.

  Two details that decide whether the numbers can be trusted. The summary is
  folded from the **full** step log before history compaction, so a
  5000-iteration sweep does not silently report the ~200 steps that fit in
  `steps_json`; and rehydration reads the persisted `summary_json` rather than
  re-folding those compacted steps. A `subflow` rolls its child's totals into its
  parent, so a sweep that delegates its writes is not read as inert — the child
  keeps its own run row, and the parent's summary answers "what did this run
  cause".

  Additive throughout: `summary` is optional everywhere it appears, existing runs
  and stores keep working, and no execution behaviour changes. The one-line log
  defaults to `info` — a line nobody sees at their production level is the same
  non-signal this closes — with `AutomationServicePlugin`'s
  `runSummaryLog: 'debug' | 'off'` to turn the volume down on a very
  high-frequency flow without turning the measurement off.

  New spec exports: `FlowRunSummarySchema`, `FlowRunNodeSummarySchema`,
  `FlowRunGateSummarySchema`, `ExecutionStepMetricsSchema`,
  `ExecutionStepSkipReasonSchema` (+ inferred types); `ExecutionLog.summary` and
  `ExecutionStepLog.metrics` / `.skippedBy`. `service-automation` exports
  `summarizeRun` / `formatRunSummaryLine` so a host building its own surface
  reuses the platform's definition instead of re-deriving one.

  Does not fix #4347 itself — this is the instrument that would have caught it.

  Verified: `@objectstack/service-automation` **522 tests / 46 files** (23 new),
  `@objectstack/spec` **7165 / 279** (5 new), `@objectstack/runtime` **974 / 68**,
  `@objectstack/plugin-approvals` **330 / 13**; all eight `@objectstack/spec`
  `check:generated` gates plus `check:liveness` and `check:exported-any`; and
  `tsc --noEmit` on service-automation at its ledgered 2 pre-existing errors.

- 050cd82: feat(spec,service-automation): a flow variable can declare a `defaultValue`, so "declared" means "bound" (#4697)

  Declaring a flow variable used to guarantee nothing at run time. The engine bound
  an `isInput` variable **only** when the caller actually supplied it
  (`params[name] !== undefined`), so every path that omitted the parameter left the
  name unbound — and a flow condition is strict CEL, where an unbound name does not
  read as `false`, it **aborts the predicate and stops the run**. The declaration was
  documentation, not a guarantee, and there was no metadata form that said "this
  variable always has a value".

  `FlowVariableSchema` now takes an optional `defaultValue`, and the engine binds it
  whenever no parameter supplies one:

  ```typescript
  variables: [
    {
      name: "createOpportunity",
      type: "boolean",
      isInput: true,
      defaultValue: false,
    },
  ];
  ```

  The rules:

  - **A supplied parameter always wins**, including a falsy one — the boundary is
    `!== undefined`, so `false`, `null`, `0` and `''` are answers rather than
    absences, and only a genuinely missing parameter falls through to the default.
  - **A non-input declaration takes its default too.** `isInput: false` means no
    parameter can reach the name, so the default is the only thing that can bind it.
  - **A declared variable shadows a trigger-record field of the same name**, whether
    it was bound from a parameter or from its default — the rule a parameter already
    followed. A name cannot resolve out of a different source depending on whether
    the caller passed it.

  Both run entry points seed from one shared site, so the retry path behaves
  identically to the first attempt.

  **Additive and opt-in.** A declaration without `defaultValue` behaves exactly as
  before, so existing flows parse and run unchanged. The value is not cross-checked
  against the declared `type` — `type` is an open string with no vocabulary to check
  against, the same posture as every other `defaultValue` on the authoring surface.

  The case this closes came from a screen flow (hotcrm#643): a screen collects an
  optional checkbox, the client returns only the fields the user actually touched,
  so on the untouched path the variable was never bound, the outgoing edge aborted,
  and a lead conversion persisted nothing. The workaround was an `assignment` node
  before every screen mirroring the screen field's own `defaultValue`; a declared
  default replaces that ceremony.

  The docs half of the same gap is now written down too
  (`content/docs/automation/flows.mdx`): under strict CEL the guard an author
  reaches for first — `has(X.f)` — **aborts** on an unbound `X`, the very case it is
  written for. Only the `vars.`-scoped `has(vars.X)` tests bindedness. That truth
  table is measured against the live evaluator in
  `service-automation/src/flow-variable-default.test.ts` rather than asserted, so a
  prescription nothing executes cannot quietly stop being true. Prefer
  `defaultValue` over either guard: a guard encodes "unanswered means no" into the
  predicate and leaves the graph defect in place.

- 42da73d: fix(spec): `notify.severity` closes its declared `info | warning | critical` vocabulary at the gate, not only in its describe (#7086)

  <!-- adr-0087: not-required (no-migration-prescription) A stored flow is unaffected at LOAD: `FlowNodeSchema.config` is `z.record(z.string(), z.unknown()).optional()`, so `NotifyConfigSchema` runs only at EXECUTE time via `parseNodeConfig` — nothing fails to load or rehydrate, which is the population a D2 conversion exists to protect. And no automatic rewrite is correct here: mapping a stored `'urgent'` to `'info'` would silently pick a severity on the author's behalf, which is precisely the blind-cast defect this change removes. The refusal names the three legal values, so the author reconciles it once and keeps their intent. Re-measured across the monorepo: zero out-of-vocabulary spellings in any flow, example, fixture or seed. -->

  `NotifyConfigSchema.severity` was a bare `z.string()` whose `.describe()` read
  `'info | warning | critical'` — no "e.g.", no qualifier. In this codebase that
  spelling is how a genuine closed vocabulary is documented, so the enumeration
  existed only in the sentence. Measured on `origin/main` before the change:

  ```
  severity "info"  -> ACCEPTED    severity "urgent" -> ACCEPTED
  severity "warning"  -> ACCEPTED    severity "INFO"   -> ACCEPTED
  severity "critical" -> ACCEPTED    severity ""       -> ACCEPTED
  ```

  **Every other surface already declared the set closed**, which is what made the
  open gate a defect rather than a design choice: the `notify` executor forwards
  the value raw, the messaging dispatcher blind-casts it into the closed union
  (`severity: (p.severity as Notification['severity']) ?? 'info'`), and
  `sys_inbox_message.severity` is a select field offering exactly these three. So
  `severity: 'urgent'` parsed green, published green, and landed in inbox rows
  under a TypeScript type that says the value cannot exist — falling through every
  downstream `switch` on the three names. An author (very often an AI) who wrote
  `Critical` or `urgent` got no diagnostic anywhere on the path.

  The gate is now `z.enum(['info', 'warning', 'critical']).optional()`, and the
  describe is a sentence about the field, because the vocabulary is carried by the
  type — the generated reference renders it as an enum column instead of a bare
  `string`. The refusal is self-prescribing:

  ```
  Invalid option: expected one of "info"|"warning"|"critical"
  ```

  **Why closing this gate takes no working authoring shape with it.** The executor
  reads `severity` **raw** — it is one of the three keys (`channels`, `topic`,
  `severity`) that never pass through `interpolate()` — so a `{record.x}` template
  there was forwarded verbatim and never resolved. The schema's module JSDoc
  claimed "every string-ish value except `channels`" is interpolated; that was
  stale for `topic` and `severity`, and it is corrected here, since it is the
  statement the safety of this tightening rests on.

  **Blast radius is an execute-time refusal, not a load failure.** `FlowNodeSchema.config`
  is an untyped record, so a stored flow carrying `severity: 'urgent'` still loads
  and rehydrates exactly as before; the `notify` step refuses when it runs, naming
  the three legal values. `''` previously degraded to `info` two layers down and is
  now refused at the gate.

  The `notify` descriptor's Studio form is closed in the same change
  (`enum: ['info', 'warning', 'critical']`). Closing only the Zod would have left
  the mirror-image drift the IO-node ledger test exists to prevent — a form
  inviting a value the gate refuses at execute time — and the `screen` node's
  `mode` is the in-repo precedent for enum-on-both-sides. That ledger test compared
  key SETS only, which is the gap this field sat in; it now also reconciles closed
  value vocabularies, so the two descriptions cannot drift apart again.

- d25a0ec: feat(spec,service-automation): a run says when its `acted` count is incomplete, instead of guessing (#4354)

  #4354 shipped `selected` / `acted` counts on every flow run, sourced from the
  executors that know what they did. Four node types were left out — and the gap
  was not cosmetic: `connector_action`, `http` and `script` are how a flow acts on
  anything _outside_ the platform, so a sweep whose whole job runs through them
  reported `acted: 0` and looked exactly like the dead sweep the counter exists to
  find. A detector that fires on healthy runs is worse than no detector: operators
  tune it out, and then it is not watching the flows that really did stop.

  Closing it needed a third answer, because for two of those nodes the platform
  genuinely cannot know:

  **`connector_action` — unknowable, and now it says so.**
  `ConnectorActionDescriptor` declares `key` / `label` / `description` /
  `inputSchema` / `outputSchema` and _nothing_ about whether the action reads or
  writes, so `crm.push_opportunity` and `crm.lookup_account` are the same shape to
  the runtime. `acted: 0` understates the create; `acted: 1` overstates the
  lookup and makes the alert never fire — #4354's original bug, one layer out.
  The executor reports `metrics: { unmeasuredEffect: true }` instead, and the run
  carries an `unmeasured` tally. Filed #4395 to let a connector declare its effect
  kind, which would turn this into a real count.

  **`http` — knowable, and now counted.** The method says it:
  `GET`/`HEAD`/`OPTIONS` report a real `acted: 0` (a read cannot write); a mutating
  call the upstream accepted reports `acted: 1`; `durable: true` reports `acted: 1`
  because the outbox row is a durable effect this run caused. A mutating call that
  was _rejected or timed out_ reports `unmeasured` — a 500 can arrive after the
  write landed, and claiming zero there would let a run swear it changed nothing
  when it had.

  **`script` — deliberately unchanged.** A registered function is contractually
  pure ("Data I/O stays on the flow graph — the function itself does no writes"),
  so every write it causes is a downstream node counting itself and "reports no
  record metrics" is accurate rather than a guess. Nothing _enforces_ that purity,
  so a function that writes behind the platform's back under-reports its run —
  filed as #4396 rather than papered over here, because a blanket
  `unmeasuredEffect` on `script` would suppress the signal on every flow that
  calls any function in order to accommodate one contract violation.

  **The alert gains a clause.** `selected > 0 AND acted = 0` becomes
  `selected > 0 AND acted = 0 AND unmeasured = 0`, and `sys_automation_run` gains
  an `unmeasured_count` column to serve it. Without that third clause the alert
  fires on every healthy connector-driven flow. The log line gains
  `unmeasured=N` — only when non-zero, since its _presence_ is what a reader must
  not miss: `acted=0` on a line that also says `unmeasured=3` means "cannot tell",
  not "did nothing".

  `unmeasured` propagates through `subflow` and `map` roll-ups (and through
  `creditChildRun` for a child that paused), so a parent whose child dispatched an
  uncountable effect knows its own `acted` is incomplete. N uncountable effects in
  a child collapse to one flag on the parent's step — the child keeps the real
  count in its own run row, and the question this feeds is boolean.

  `FlowRunSummary.unmeasured` is optional and `undefined` is **not** `0`: a run
  recorded before this existed did not track uncountable effects at all, and
  defaulting it to zero would tell an operator "fully measured" about a run nobody
  measured. Same rule the `null` count columns already follow.

  Additive: new optional fields only, no new exports, no execution behaviour
  changes.

  Verified: `@objectstack/service-automation` **546 tests / 47 files** (21 new),
  `@objectstack/spec` **7193 / 281** (2 new); all 8 `check:generated` gates plus
  the seven pure audits (liveness, empty-state, variant-docs, strictness-ledger,
  react-conformance, skill-examples, exported-any); `check:nul-bytes` and eslint
  clean.

- 57292a8: **Automation runs now record what triggered them — and keep it across a restart (#7533).**

  Two gaps in run attribution, both measured by QA run #7516 (`trigger-type-matrix`):

  - **`trigger.recordId` is populated on `record_change` runs.** The field was declared in
    `ExecutionLogSchema` and written by nothing, so the platform's most common trigger kind
    produced runs that could not be correlated to the record that caused them — neither
    "which record provoked this run?" nor "which runs did this record provoke?" was
    answerable from the run log. The trigger block is now built at a single chokepoint
    (`buildRunTrigger`) instead of being re-spelled at each of the ten places a run is
    logged, which is how `recordId` came to be omitted from all ten.
  - **The durable `sys_automation_run` row carries the trigger block.** The in-memory run
    recorded its runtime kind; the persistence mapping dropped it, so after a process
    restart a scheduled run, a webhook intake and a record change were indistinguishable
    rows — the durable copy of the history was strictly less informative than the volatile
    one. `sys_automation_run` gains `trigger_type`, `trigger_object` and `trigger_record_id`
    as **columns** (not a JSON blob: both questions above are queries, not readings of a
    single row), indexed on `(trigger_object, trigger_record_id)`. Written on terminal
    history rows and on live paused rows alike.

  Rows written before this change carry no trigger columns; they keep rehydrating exactly as
  they did, with an empty trigger type. Absent means "not recorded", never "no trigger".

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

- fd3013a: feat(spec,automation)!: converge `script` to a function call — retire the `actionType` branches — and parse `script` / `subflow` config at execute time (#4343)

  A `script` node had four ways to name what it ran and only one of them ran anything.
  Protocol 17 keeps that one and retires the rest.

  - **`config.actionType: 'email' | 'slack'`** were **logger-backed stubs**. They wrote a
    line, reported success, and delivered nothing — under any configuration, installed
    messaging service or not. Every bundled example used one; none of them ever sent
    anything.
  - **`config.template` / `.recipients` / `.variables`** fed those stubs, so they addressed
    a message no channel sent. (The examples did not even reach them: they passed the
    payload in `inputs`, which the built-in branch never read.)
  - **inline `config.script`** was recognized and **never executed** — the built-in runtime
    has no server-side JS sandbox, so the node warned and completed as a no-op.
  - **any other `actionType`** was shorthand for a registered-function name — a second
    spelling of `config.function` — and `'invoke_function'` was a marker that named nothing
    on its own.

  What remains is what worked: `config.function` (now **required**) names a registered
  function, `config.inputs` feeds it, `config.outputVariable` binds its return value.

  **The replacements are three different mechanisms, not one rename.**

  | Retired                                                           | Use instead                                                                                                                                        |
  | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `actionType: 'email'` (+ `template` / `recipients` / `variables`) | a `notify` node — it delivers through the messaging service: the in-app inbox by default, real email once `@objectstack/plugin-email` is installed |
  | `actionType: 'slack'`                                             | a `connector_action` node with the Slack connector, or an `http` node posting to an incoming webhook — `notify` has no Slack channel               |
  | `actionType: 'my_fn'` (shorthand)                                 | `function: 'my_fn'` — the conversion moves it for you                                                                                              |
  | `script: '…'` (inline JS)                                         | move the logic into a registered function and call it via `config.function`                                                                        |

  **Execute-time parse.** `script` and `subflow` now run their config through the contract
  before executing, the seam #4277 gave the flat builtins — a violation refuses the node as
  a **guard** (wrong metadata; no `fault` edge may route it, #3863). `script` could not join
  that seam while its legal key set depended on `actionType`: a flat parse would either
  reject valid shapes or wave everything through. Converging the node is what made the
  contract fit. `subflow`'s hand-written `flowName` check became the same parse, so its
  message is now `subflow 'n1': config does not satisfy the subflow contract —
config.flowName: …`. `decision` deliberately stays export-only: its one key is optional,
  so a parse would check nothing.

  **Migration.** `os migrate meta --from 16` rewrites stored sources; authoring one of these
  keys in TypeScript is a compile error carrying the same prescription. A shorthand
  `actionType` **converts into `function`** — that is what it named — unless `function` is
  already set, in which case it was dead metadata the executor never reached. The other four
  keys are dropped outright: nothing read them, so there is no value to preserve, and
  rebuilding the intent is an authoring decision (the table above) rather than something a
  mechanical rewrite can guess.

  The keys leave the **load path** (`retiredFromLoadPath`) with the rest of the keys retired
  for _misdescribing themselves_ rather than for being renamed: absorbing
  `actionType: 'email'` silently would let an author keep believing the flow sends mail. The
  one seam that still replays it is `registerFlow`, which rehydrates data at rest (#3903) —
  a row in `sys_metadata` has no author for a tombstone to teach. So a stored email-stub node
  arrives stripped of the keys nothing read and then **refuses for naming no callable**,
  where it used to log a line and report success. That flip is the behavior change to expect.

  **A build gap this surfaced, fixed here.** `FlowFunctionEntrySchema` now also accepts a
  **lowered handler ref** (a non-empty string), the form `objectstack build` produces: the
  CLI lowers every inline callable to a serialisable ref _before_ the stack is parsed (it
  must — `z.function()` wraps callables and would break the ref mapping), so a built
  manifest holds `{ myFn: 'myFn' }`, which neither previous member accepted. The result was
  that `defineStack({ functions })` — a documented, first-class mechanism — could not
  survive a build at all. Nothing had noticed because no bundled example used it; #4343
  turns that from latent into blocking, since `config.function` becomes the only thing a
  `script` node can run. `Hook.handler` already declared exactly this pair (`z.union([
z.string(), <function> ])`, "string, post-build / inline function, pre-build"), so this
  brings `functions` onto the platform's established shape rather than inventing one. A
  string carries no callable and `normalizeFlowFunctionEntry` still drops it by design — the
  real functions ride in the sibling ESM module the build emits, merged by name — so
  hand-authoring one registers nothing and fails loudly at execute ("no function named '…'
  is registered"), never silently.

  Also in this change: the retired constants `SCRIPT_BUILTIN_ACTION_TYPES`,
  `SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` and the `ScriptBuiltinActionType` type are removed
  (they described the dispatch set that no longer exists); `os validate` names a retired key
  and its replacement instead of reporting a generic missing callable; and the `#3796`
  alias fixture, which carried `actionType: 'invoke_function'` through both sides, no longer
  describes an end state protocol 17 can reach — the rename itself is untouched. No liveness
  ledger row moves: the gate walks `FlowSchema`, whose `nodes[].config` is
  `z.record(z.unknown())`, so these keys were never governed by one.

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

- 8657957: feat(service-automation): a caught `try_catch` failure now records what failed, how many attempts ran, and which node threw (#7546)

  A caught failure used to leave **no forensic trace**. The whole run log was:

  ```
  [ start, guarded_push (try_catch, success), record_failure (catch) ]
  ```

  Nothing carried `regionKind: 'try'`. Nothing carried `status: 'failure'`. The
  container's own step read `success`. From the log alone a caught failure was
  indistinguishable from a clean run that happened to also touch the catch path —
  the only evidence a failure had occurred was the catch region's side effects,
  which is nothing at all when the catch is a bare notification, and worse than
  nothing when the catch's own write is the thing you are trying to explain. An
  operator (or an agent) reading such a log was not merely under-informed: the
  most natural reading was that the try region had never run, which points at
  "fix" work on a region that was behaving exactly as designed.

  The steps were never missing for a structural reason. A failing node pushes its
  own `failure` step into the region's step array _before_ it throws, and the
  `childSteps` splice that folds region steps into the parent log has existed
  since #1479 and works for every region kind that succeeds. The failed attempt's
  array was simply dropped on the floor as the region unwound.

  **What changes.** `runRegion()` now hands a failed region's partial steps to the
  caller through an opt-in sink before the throw propagates, tagged exactly as a
  successful region's are, and `try_catch` accumulates every failed attempt across
  the retry ladder and folds them into `childSteps` **ahead of** the steps of
  whichever region finally succeeded. So a caught failure's log now contains, in
  execution order, each failed try attempt (the throwing node's `failure` step
  with its error, plus whatever the attempt got through before it) followed by the
  catch handler's steps. The same applies to a ladder that recovers on a retry:
  the attempts it burned are recorded rather than erased.

  Where a retry policy is declared, those steps also carry `retryAttempt` — the
  zero-based attempt index — so the number of attempts is a **count** in the log
  rather than something inferred from elapsed wall time. `retryAttempt` is not new
  vocabulary: it has been declared on the spec's `ExecutionStepLogSchema` since
  that schema was written, with exactly this meaning, and had no producer anywhere
  in the engine until now.

  **What does not change.** The retry and throw semantics of `try_catch` are
  untouched: the same number of attempts, the same fall-through to the catch
  region, the same node-level outcome. A container that recovers still reports
  `success` — giving it a distinct status such as `recovered` was considered as
  part of this decision and deliberately not adopted, because the container's
  contract is "the error was handled" and the forensic detail belongs in the step
  log underneath it, which is what this change delivers.

  **Log volume.** A try region that retries N times now emits up to N times its
  body's steps, and a retry ladder nested in a loop multiplies. Durable run
  history is unaffected in shape: `compactStepLogForHistory` already caps
  persisted steps and already prioritises failures and their container chains, so
  the extra records land inside the existing budget rather than growing it.

  Run summaries need no special case and get more accurate. A try node that failed
  twice before succeeding folds to `runs: 3, failures: 2` — all three numbers
  true, and the same "worst outcome wins, `runs`/`failures` carry the nuance" rule
  a loop body has always folded under. Records written by an attempt that then
  threw now reach the run's `selected`/`acted` totals instead of vanishing, which
  is what those counters are for.

- 4965bfa: Warn on flow-node `config` keys the node type does not declare (#4045).

  `FlowNodeSchema.config` is `z.record(z.unknown())`, so a misspelled or invented
  config key was accepted in total silence: `visibleIf` instead of `visibleWhen`
  registered cleanly, was never read, and the only symptom was a feature that quietly
  did not happen. That diagnostic vacuum is what made #3528 take three passes and two
  wrong diagnoses to resolve.

  `registerFlow` now compares each node's `config` against its descriptor's
  `configSchema` and warns on anything undeclared, located and with the declared set
  listed:

  ```
  [flow 'lead_conversion'] node 'screen_1' (screen): unknown config key `visibleIf`
    at config.fields[0].visibleIf — It is not declared by this node type's
    configSchema, so nothing reads it. Declared here: name, label, type, required,
    visibleWhen.
  ```

  The walk descends where the schema declares structure and **stops at free-form
  keyValue maps**, whose keys are author data (`filter: { status: 'stale' }`).
  Descending matters: the #3528 typo class lives _inside_ the `screen` field
  repeater, so a top-level-only comparison would miss the exact mistake this exists
  to catch.

  **Warn, never reject.** An undeclared key is an author typo, a key the executor
  genuinely reads that its hand-written `configSchema` never declared (`notify.source`
  was exactly this), or dead config. Only 4 of the 13 schema-carrying builtins have
  been audited for the second population, so hard-failing would gamble on the other
  nine. Tightening to an error is a later, per-key decision once this warning has
  measured the real distribution. Nothing about the published `configSchema` changes,
  so no consumer sees a different shape.

  `@objectstack/formula` now exports `nearestName`, the edit-distance helper already
  used for unknown-field and unknown-role suggestions, so "did you mean?"
  diagnostics share one threshold. It is deliberately a bonus rather than the
  mechanism — `visibleIf` → `visibleWhen` is distance 4 against a threshold of 3, so
  the declared set is always listed instead of only as a fallback.

  Also fixes the first real finding from the new check: `showcase_inquiry_purge`'s
  `get_record` node carried `mode: 'records'`, which no executor reads, with a comment
  crediting it for behaviour that `limit > 1` actually produces.

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

- f0d98e1: fix(automation): a `wait` timer's wake-up job is dropped when the run leaves the node, not only when the timer fires (#5512)

  A timer `wait` arms a one-shot job on entry (`flow-wait:<runId>:<nodeId>`,
  `{ type: 'once', at }`) and, until now, only that job's own callback ever tore it
  down. Every other way out of the pause left it armed:

  - resumed early through the REST resume endpoint (`POST
/api/v1/automation/:name/runs/:runId/resume` — a door the #3801 resume gate
    deliberately leaves open for `screen`/`wait` pauses) or the SDK equivalent;
  - cancelled while parked (`cancelRun`, ADR-0044);
  - terminally failed under a subflow ancestor.

  Reported from 17.0-rc2 acceptance: a `wait P1D` pause resumed early ran to
  completion while its one-shot stayed `active: true` in `sys_job` with tomorrow's
  deadline. For the next 24h anyone reading `sys_job` saw "a run is still waiting
  to be woken" — the row contradicted the run — and when the deadline arrived the
  job fired a resume at a run that had completed the day before (harmless: the
  engine reports a machine-state error and the callback discards it, then the job
  self-cancels). A long-running org accumulated one stale row per early wake-up.

  **What changed.** The engine now tells the node its pause is over. `NodeExecutor`
  gains an optional `onSuspensionReleased(release)` — the mirror of `suspend: true`
  — called from the single choke point every consumption of a suspension already
  passes through, with the `runId`, the node, the `correlation` the node minted at
  suspend time, and why the pause ended (`resumed` / `cancelled` / `failed`). The
  `wait` node implements it by cancelling the one-shot whose name it recognises as
  its own, so the `sys_job` row goes inactive the moment the run leaves the node,
  whichever route it left by. `SuspensionRelease` / `SuspensionReleaseReason` are
  exported for plugin nodes that arm something on entry (a lease, a reminder, a
  timeout) and need the same teardown.

  Teardown is best-effort and runs after the suspension is consumed: a job service
  that is down or throwing can neither delay nor fail the continuation — the engine
  logs one warning naming the correlation an operator would cancel by hand. Node
  types that arm nothing are unaffected (the hook is optional), and a pause that
  armed no job — a signal wait, or a timer with no parseable duration — cancels
  nothing, since its correlation is not a job name. Deprecated ADR-0018 node
  aliases delegate the hook to their canonical executor, so authoring the old type
  name cannot silently lose the teardown.

  The timer callback keeps its own `finally` cancel: the two answer different
  questions — "the run left the node" versus "this one-shot has had its single
  shot", including shots that did not consume a pause. `cancel` is idempotent.

### Patch Changes

- e5bd768: refactor(spec)!: retire `ActionDescriptor.isAsync` — a second spelling of `supportsPause` that nothing ever read (#6748, ADR-0049)

  <!-- adr-0087: registered action-descriptor-is-async-retired -->

  **FROM → TO:** `isAsync: true` → delete the key; declare `supportsPause: true` (plus the
  `resumeAuthority` its pauses need) and return `suspend: true` from `execute()`.
  `isAsync: false` → delete the key; there was never anything to preserve.

  `ActionDescriptor.isAsync` declared "suspends the flow awaiting an external reply" and no
  execution path read it. Measured fresh before removal across all three repos — objectstack,
  objectui and cloud — with zero property reads: every hit was the declaration itself, a
  generated baseline, one of five shipped descriptors WRITING it, a fixture pinning the
  shape, or prose. Declaring it never made a node suspend; omitting it never stopped one.

  This is the remove leg of the ADR-0049 disposition its sibling took the other way. The two
  keys said the same thing — "this node type can suspend the run" — and #6667 split them by
  evidence: `supportsPause` became an enforced fact (`AutomationEngine` now refuses a
  suspension whose type does not declare it, at the one seam every suspension passes
  through), while `isAsync` had no consumer to grow into. Keeping both would leave the
  platform publishing two names for one capability with only one of them honoured — and
  `screen` declared BOTH, so a plugin author copying it had no way to tell which.

  The retirement kit:

  - **Tombstone, not deletion** (`retiredKey()`): `ActionDescriptorSchema` is not `.strict()`,
    so a plain delete would let existing descriptors parse clean and lose the key in silence
    (the ADR-0104 shape). Authoring `isAsync` now fails `tsc` at the descriptor literal and
    fails the parse inside `defineActionDescriptor()` — with the prescription in the message.
  - **ADR-0087 D3 `SemanticMigration`** (`action-descriptor-is-async-retired`) plus the exact
    `RETIRED_KEYS_BY_MAJOR` entry. No D2 conversion, deliberately: a descriptor is published
    from an executor's TypeScript and never stored in stack metadata, so there is no source
    for `os migrate meta` to rewrite — the `EnhancedApiError.fieldErrors` disposition.
  - The five shipped writers stop writing it (`screen`, `map`, `wait`, `approval`,
    `approval_revise`); the descriptors they publish lose the key, which is why the two
    runtime packages appear here.
  - Generated baselines (`authorable-surface/automation.json` gains `[RETIRED]`,
    `authorable-defaults/automation.json` loses the default line), `spec-changes.json`, the
    upgrade guide and the reference docs regenerated.

  No runtime behaviour changes — that impossibility is the reason for the removal. The same
  commit also corrects `supportsPause`'s TSDoc, which still described itself as a declaration
  no execution path reads; #6667 made that false (#6749).

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

- fb90784: fix(approvals): the status mirror names the human who caused the transition (#3783)

  When an approval moves, the service writes the new status onto the business
  record (`approvalStatusField`). That write is what fires the record-change flows
  bound to that object — so it is the seam "when the invoice is approved, do X"
  runs through. It presented a bare `{ isSystem: true }` context with **no
  `userId`**, at six call sites that each know exactly who acted: a submitter
  submitting, an approver approving, rejecting, sending back, recalling.

  Combined with #3760 — which stopped letting a `runAs:'user'` run with no trigger
  user touch data — that identity gap made the most natural approvals automation
  there is unwritable in its obvious form. The cascade inherited no user, so its
  data nodes were refused, and the author's only way forward was to declare
  `runAs: 'system'` and take blanket elevation for a case where a perfectly good
  scoped identity existed at the call site all along.

  The mirror now carries the acting user. It stays `isSystem` — the record is
  normally locked while its approval is live, so only a platform write can land the
  status — because elevation and anonymity are separate choices, and this write
  only ever needed the first. Cascades now run as the deciding user with RLS
  enforced.

  - **The identity is the authenticated principal, never the request body's
    `actorId`.** `actorId` arrives from the caller (`body.actorId ?? context.userId`)
    and is only checked against the pending approver slate, never against the
    caller. That is tolerable on an audit row; promoting it to the identity of an
    RLS-scoped write would have turned a mislabelled audit trail into identity
    spoofing.
  - **Approval-by-email-link is attributed too.** ADR-0043 action links carry no
    session, so they used to decide as pure system. The single-use hashed token
    binds exactly one approver and is re-checked against the live slate at
    redemption — that is an authentication — so the redeemed decision now presents
    that approver, and an emailed approval cascades identically to one made in the
    UI.
  - **The two machine-driven transitions stay user-less on purpose**: the SLA
    escalation's auto-decision and the dead-run sweep. `system:sla` and
    `system:dead-run` are reserved audit actors, not users, and presenting one as a
    user would put a non-user in `updated_by` and in every downstream flow's
    identity. A flow that wants to react to those declares `runAs:'system'` — the
    honest answer, and now a deliberate one rather than an artefact.
  - **Attribution only — the write is not newly org-scoped.** On an
    ExecutionContext `tenantId` is a driver-scoping knob, not attribution
    (ObjectQL turns it into a tenant predicate), so passing the request's org would
    have silently no-op'd the mirror on a record whose org differs. The automation
    engine already back-fills a run's `tenantId` from the resolved user's grants.

  **Visible change:** the mirrored record's `updated_by` now names the acting user
  instead of retaining its previous value — ObjectQL's audit stamping is gated on
  the write context's `userId` alone, and `isSystem` buys no exemption. That is the
  attribution this fix is for: the approver who set the record to `approved` is now
  its last modifier.

- 9dcc0ae: fix(automation): array-form flow `triggerType` fails loudly instead of silently never firing (#3481)

  An array `triggerType` on a flow start node — the shape an author (or an AI
  authoring pass) naturally reaches for to fire on more than one event, e.g.

  ```ts
  config: { objectName: 'app_task', triggerType: ['record-after-create', 'record-after-delete'] }
  ```

  was accepted everywhere and armed nowhere. Multi-event unions are deliberately
  unsupported (only the single tokens plus the `record-after-write` create-OR-update
  union exist — see #3457), but nothing said so: `defineFlow` passed the array
  (start-node `config` is an open record), the engine's `typeof === 'string'` check
  folded it to no trigger and misclassified the flow as **manual**, so it never
  entered the trigger-binding audit, and the flow-trigger-readiness lint used the
  same `typeof` narrowing and produced no finding. The flow bound to nothing and
  never fired, with zero output at any layer — the same silent-never-fire class as
  #3427 / #3472, and the last authoring shape still slipping past every guard.

  This is a **defensive** fix — arrays remain unsupported; they now fail loudly:

  - **lint** (`validate-flow-trigger-readiness`): an array `triggerType` containing
    any `record-*` element now yields a `flow-trigger-unknown-event` warning at
    `os validate` time, steering to `record-after-write` (for created-or-updated) or
    one flow per event.
  - **engine** (`resolveTriggerBinding`): such an array is routed to the
    `record_change` trigger — exactly as an unmappable single token is — instead of
    being folded to a manual flow, so it reaches the trigger's bind-time rejection.
  - **trigger** (`record-change`): the bind-time rejection detects the array shape
    and emits a targeted warning (naming the flow, pointing at `record-after-write`
    and #3457) rather than the generic unknown-token line.

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

- 02a8256: fix(service-automation): connector 降级路径的两条日志改用结构化 `meta`,message 保持单行 (#5636)

  ## 接缝

  `degradeConnectorInstance`(#3017 的降级/重试路径)有两条记录报告的是**外来**失败,却把
  它插进了日志 message —— 与 #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的
  `fail()`)同一类,是那两单范围之外的第三个接缝:

  - **husk 注册失败**(`warn`):`err` 来自 `engine.registerDegradedConnector` →
    `ConnectorSchema.parse`,catch 自己的注释就写着「the entry's def no longer parses」,
    也就是说这里预期接到的正是 `ZodError` —— 它的 `.message` 是 issue 数组的多行 JSON
    dump,第一行只有一个 `[`。
  - **降级公告**(`error`):文本是 `ConnectorUpstreamUnavailableError.message`,由第三方
    provider factory 构造(ADR-0097 明确鼓励第三方去写)。spec 只定义错误类、不约束文本,
    所以上游 SDK 的多行失败会原样落在这里。

  ## 危害:这条 `warn` 的下游与 #5575 的 `error` 不同(实测)

  `ObjectLogger` 把 `warn` 送 stdout、`error`/`fatal` 送 stderr,而 `serve` 的启动静默窗口
  只包了 `process.stdout.write`。#5575 的接缝全是 `error`,所以那一单的结论是「启动缓冲根本
  看不到」;这一条不同,而且差别是**测出来**的,不是推的:

  - 它是 `warn` → stdout,缓冲**确实**看得到;
  - 它在**冷启动**就会跑 —— `materializeDeclaredConnectors(ctx, { fatal: true })` 遇到上游
    不可达是降级、不是抛错 —— 而窗口此时正开着(`serve` 在 config 加载前接管 stdout,直到
    banner 打印才恢复);
  - `BootLogCapture.offer()` 只在 `classifyBootLogLine` 能在该物理行上找到 `<ts> <LEVEL>`
    头时才保留它,所以插值 dump 的每一条续行是被**直接丢弃**,不只是难解析。

  对一份 13 行的插值 ZodError 实测:写出 13 行物理行,缓冲保留 **1** 行(那条止于 Zod `[`
  的头行)、丢弃 **12** 行 —— 唯一被留下的那行不含任何事实。这正是 cloud#971 的原始形态。
  `error` 那一条走 stderr,不经缓冲,危害是 #5575 那一串按行消费者(文件 sink、
  `docker logs`/journald 送采集、`grep ERROR`):一条诊断散成 N 个无法归属的碎片。

  ## 改法

  两条都复用同包 `thrown-cause-diagnostics.ts` 的 `describeThrownForLog`(#5572/#5575 落地):
  message 是不含换行的自足句子,cause 走 logger 的结构化 meta。位置按 `Logger` 契约区分,
  并且是核对源码后确认的而非照抄:`warn(message, meta?)` 没有 `Error` 位,cause 就在**第二**
  参;`error(message, error?, meta?)` 的 cause 在**第三**参(第二参塞原始 error 会让每次重试
  的记录都附带完整堆栈)。

  ## 刻意没有改的一件事

  `degradedReason` —— `GET /connectors` 展示的、以及 `connector_action` 被拒时引用的那段文本
  —— 仍然逐字保留 provider 自己的 message,包含换行。它是人透过 JSON 读的字段,不经按行切分
  的消费者;重塑它属于另一次契约变更。因此调用点同时传 `reason`(那段文本)与 `cause`(抛出值
  本身):前者喂 husk 与重试簿记,后者只喂日志记录。测试双向钉住了这个分离。

- 41dcda3: fix(spec,runtime,service-automation): `IAutomationService` declares the connector registry it already serves (#4127)

  The fourth and last of the dispatcher call sites #4127 found calling a method its
  contract never declared. The first three shipped in #4143; this one was held back
  because the fix is a **type move**, not a type addition — `ConnectorDescriptor`
  was declared in `@objectstack/service-automation`'s engine, which is one
  _implementation_ of `IAutomationService`. A contract cannot name a type that
  lives inside its own implementation, so `getConnectorDescriptors` could not be
  declared at all until the type had a home in the spec.

  **`IAutomationService` += `getConnectorDescriptors?()`.** It is the sibling of
  `getActionDescriptors`, which the contract has declared since ADR-0018: the two
  fill the flow designer's `connector_action` node together — node vocabulary from
  one, the connector → action → input pickers from the other. Only one of them was
  written down. `GET /api/v1/automation/connectors` has served the other since
  ADR-0022 by probing for the method and then re-typing its own result as `any` to
  filter on `?type=`, which is a filter on a field the type system did not know
  existed — one typo from silently matching nothing and answering an empty
  registry, which is also what this route legitimately returns when the method is
  absent, so the failure had no distinguishable symptom.

  Optional for the same reason `getActionDescriptors` is: a connector registry is a
  capability of the flow-engine implementation, not a property of every automation
  slot. A script-runner filling the slot has no connectors to describe, and the
  route answers an empty registry rather than a 404 — the `handlerReady` posture
  does not apply, since the slot is serveable and only this capability is absent.

  **`ConnectorDescriptor` / `ConnectorActionDescriptor` / `ConnectorOrigin` /
  `ConnectorState` move to `@objectstack/spec/integration`**, beside the ADR-0097
  provider contract, for the reason that file already states about itself: they are
  pure types, so a connector plugin — or a designer client, or the dispatcher —
  speaks about registered connectors depending only on the spec, with no runtime
  coupling to the engine. `ConnectorOrigin` is ADR-0097 §4 vocabulary and
  `ConnectorState` is #3017 vocabulary; neither was ever engine-private in meaning,
  only in location.

  Nothing is renamed and no shape changes. `@objectstack/service-automation`
  imports the four back and re-exports them from its index — the same names, from
  the same entry point — so every existing importer compiles unchanged.
  `ConnectorState` joins that re-export, which it should have been in all along: it
  is a required field of the descriptor the index has always exported.

  **The test fixture had already drifted, which is the concrete cost.** The
  dispatcher's connector mock declared `{ name, label, type, actions }` and omitted
  `origin` and `state` — both **required** on `ConnectorDescriptor`, and both the
  fields a designer reads to tell a live declarative instance from a plugin one
  (ADR-0097 §4), or a dispatchable connector from a degraded one that is listed
  honestly rather than hidden (#3017). Nothing caught it, because an undeclared
  return type cannot be checked against. The fixture is typed now, so it cannot
  drift again, and a new test pins that `origin` / `state` / `degradedReason`
  survive the hop through the route rather than only `name` and `type`.

  Verified: `@objectstack/spec` **7089 tests / 272 files** (2 new contract tests),
  `@objectstack/service-automation` **457 / 41**, `@objectstack/runtime`
  **218 http-dispatcher tests** (1 new), `tsc --noEmit`, `pnpm lint`, the liveness
  and empty-state gates, and the three generated-artifact gates — all clean.

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

- 55635fc: fix(service-automation): a metadata reload now reconciles declarative connectors instead of no-op'ing against a stale registry (#7742)

  Editing a declarative provider-bound `connectors:` entry and reloading metadata
  changed nothing: no teardown, no re-materialize, the pre-edit connector kept
  serving until the process restarted. `os dev` masked it — it restarts the serve
  child on recompile — but a **Studio package publish** into a running server
  walked straight into it.

  The reconcile's INPUT was the problem, not the reconcile. It read
  `ql.registry.listItems('connector')`, which is a BOOT snapshot: the artifact
  reload re-ingests OBJECT definitions into that registry (ObjectQL's own
  `metadata:reloaded` handler) and nothing re-ingests connector items, so the
  reconcile compared the boot world against itself and found nothing to do. Every
  existing test drove the reload through a hand-mutated fake registry, which is
  why it looked covered.

  The reconcile (and the descriptor audit beside it) now reads the declaration
  from the sources a reload actually refreshes, folded over that registry read:

  - the **artifact carried on the `metadata:reloaded` payload** — the dev/HMR
    reload trigger, and the only place an edited or deleted connector definition
    exists. The fold is scoped to the packages the artifact speaks for, so a
    connector contributed by an unrelated plugin package survives a reload, while
    one deleted from the reloaded stack is torn down;
  - **`protocol.getMetaItems({ type: 'connector' })`** — the flattened `/meta`
    view the flow re-sync already reads, which layers the `sys_metadata` rows a
    Studio publish promotes to active over the registry. Consulted on post-boot
    reconciles only; boot keeps its registry read, whose snapshot is current by
    construction.

  Both reads fail safe: an absent, failing, or empty answer is treated as "no
  answer" and never tears down a live connector, and an announcement carrying no
  connector collection at all (a publish's bare `{ changed }`) leaves every
  instance alone. An unchanged entry still hashes to the same signature and is
  left untouched, so reloads do not churn live connections.

- f205c32: fix(service-automation): 降级注册那条 warn 不再插值 provider 的 reason,cause 走结构化 meta (#5660)

  ## 接缝

  `AutomationEngine.registerDegradedConnector` 自己那条记录:

  ```ts
  this.logger.warn(
    `Connector registered DEGRADED: ${parsed.name} (origin: ${origin}) — ${reason}`
  );
  ```

  `reason` 不是我们的文本 —— 唯一调用点(`plugin.ts` 的 `degradeConnectorInstance`)传进来的是
  `ConnectorUpstreamUnavailableError.message`,由**第三方 provider factory** 构造(ADR-0097 明确
  邀请第三方去写;spec 只约束 `code`,不约束文本),所以上游 SDK 的多行失败会原样落进 message。
  `ObjectLogger.write()` 每次调用只打一个 `<ts> <LEVEL>` 头,带换行的 message 就变成若干物理行,
  只有第一行是记录。

  这是 #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的 `fail()`)、#5636
  (`degradeConnectorInstance` 的两条)之后同族的**第四条**,在另一个文件、另一个方法、另一份
  契约里,所以是单独一单。它值得单独修的理由是**顺序**,不是严重度:

  - 它**先**发生 —— `degradeConnectorInstance` 先调 `engine.registerDegradedConnector(…)`,
    之后才打自己那两条;
  - 它在**默认分支**上 —— #5636 那条 `warn` 在 `catch` 里(husk 自己 parse 失败才走到),
    这条在同一个 `try` **成功**时打,也就是每个实例首次降级都打。

  即:#5636 落地之后,常见的冷启动降级路径上仍然留着一条会溢出的 warn。

  ## 危害(与 #5636 同一条下游,机制已实测)

  `ObjectLogger` 把 `warn` 送 stdout;`serve` 的启动静默窗口只包了 `process.stdout.write`;
  冷启动会走到这个接缝 —— `materializeDeclaredConnectors(ctx, { fatal: true })` 遇到上游不可达是
  **降级**、不是抛错 —— 而窗口此时正开着。`BootLogCapture.offer()` 只在 `classifyBootLogLine`
  能在物理行上找到级别头时才保留该行,所以插值 message 的每条续行是被**直接丢弃**的。

  本单新测试按 `pretty`(CLI 实际用的格式)实测了旧形状的代价,并且刻意报告了一个**比 #5636 更窄**
  的结论:#5636 的载荷是 `ZodError.message`(首行只有一个 `[`),唯一被留下的那行不含任何事实;
  这里的载荷是 provider 的散文,**首行会活下来**,丢掉的是它后面的 `cause:` / `hint:` 两行 ——
  也就是「连哪个地址被拒」和「该去查什么」。3 行进,1 行留,2 行丢。

  ## 改法(#5660 分诊 A 路)

  `registerDegradedConnector` 签名末尾加可选 `cause?: unknown`(在有默认值的 `origin` 之后,
  所以既有调用形状全部照旧编译 —— 新测试里就有一个两参调用在钉这件事)。message 变成单行自足
  (name / origin / 这个状态的后果与后续动作),事实走 `warn(message, meta?)` 的第二参:

  - `degradedReason` —— **恒定存在**,是这次注册**存进** husk 的那段文本。字段名照 #5573 挑过:
    `ObjectLogger` 按 `password`/`token`/`secret`/`key` 子串递归脱敏,这个名字一个都不含;
  - 抛出值自身的渲染(`error` 或 `issues`,经同包 `describeThrownForLog`)—— 仅当调用点传了
    `cause` 时出现。它描述的是**失败**,`degradedReason` 描述的是**注册**;今天唯一的调用点从
    前者派生后者所以两者重合,但记录形状不依赖这个巧合,将来传摘要的调用点也不会静默丢信息。

  唯一调用点顺手把 `info.cause` 传了进来(该字段 #5636 已经存在)。

  ## 刻意没做的两件事

  - **`reason` / `degradedReason` 一字不动**。`GET /connectors` 展示的、`connector_action` 被拒时
    引用的那段文本仍逐字保留 provider 自己的 message,换行包含在内 —— 它是人透过 JSON 读的,不经
    按行切分的消费者(#5636 在上一层做了同样的判断)。测试从两个方向钉住了这个分离。
  - **没有扩 `describeThrownForLog`**。`ConnectorUpstreamUnavailableError` 自带一个 `cause`
    (底层 connect 错误),把**抛出值本身**一路带过来才使渲染它成为可能;但该 helper 目前只读
    `.message` / `.issues`,所以嵌套 cause 今天还不会出现在记录里。这一点被一条测试如实钉住,
    而不是含混带过 —— 扩宽它是改四个接缝共用的 helper,不是这个接缝该顺手做的决定。

- 6517448: fix(service-automation): 降级版挂起态读取器的「存储读不到」告警不再把驱动错误拼进 message,改走 meta (#6230)

  `engine.ts` 的 `loadSuspendedRun` —— `loadSuspendedRunStrict` 的**降级版**读取器 ——
  在 catch 里把**我们不控制文本**的数据源驱动失败原因直接插进了 `logger.warn` 的 message。
  `ObjectLogger.write()` 一次调用只加一个「时间戳 + 级别」记录头,message 里的换行会把
  **一条**记录变成多个物理行,后面几行既无级别也无时间戳。

  这条比 #5912(PR #6228)刚治完的那条**多一层危害**:`ObjectLogger` 把 `warn` 路由到
  **stdout**,而 `serve` 的 boot-quiet 窗口只包了 `process.stdout.write`,其
  `BootLogCapture.offer()` 仅在该物理行带级别头时才保留 —— 所以无头续行是被**直接丢弃**,
  不只是被误读。而它在 boot 期真实可达:`plugin.ts` 的 `start()` → `rearmSuspendedWaitTimers`
  → 对 overdue 运行 `engine.resume()` → `resume()` 的授权 gate 走的正是这个降级版读取器。

  实测:一个三行的 better-sqlite3 驱动错误把这条告警切成 **3 个物理行**,过 boot 缓冲的
  过滤后**只剩 1 行**留下 —— 而留下的那一行恰恰不含任何驱动事实。

  改法与 #5048 / #5575 / #5636 / #5661 / #5737 / #5912 完全同一套,零新词汇:**message
  单行自足**,外来 cause 交给 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)
  `warn(message, meta?)` 的**第二**参 —— 注意与 `error(message, error?, meta?)` 的第三参
  不同,`warn` 没有 `Error` 槽。

  对运维可见的变化(日志形状,非行为):

  - 这条记录恒为**一个**物理行,不论日志格式,boot-quiet 窗口内不再丢字节;
  - 原因文本从 `msg` 末尾的 `: <驱动文本>` 移到记录的 `error` 字段(`meta`),多行驱动
    错误由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
  - message 补上了这条降级的**后果**:读失败被翻译成 `null`,调用方(resume gate、screen
    取数)看到的与「本来就没有这个挂起运行」完全一样,而运行本身未被触碰、仍停在原处;
    原文本只说了「读失败」,没说读失败被翻译成了什么。

  刻意**不变**的一处,已钉上回归测试:**级别仍是 `warn`**。这是一个刻意的**功能性**降级
  读取器(注释写明它服务于只需要 best-effort 答案的顺带读取方),真正需要区分「存储挂了」
  与「运行没了」的 `resumeInternal` 用的是严格版 —— 按 #4632 的判据这不是耐久性降级,
  上调到 `error` 才是该规则的镜像误用(整个故障期间每次 gate 查询都报警)。

  按记录末尾驱动文本字面量 grep 这条记录的日志查询,需要改成读记录的 `error` 字段。

- 0fd8556: feat(spec,objectql): `DroppedFieldsEvent.reason` names the dispatch-ruled id strip (#6437)

  The write path's strip-observability seam declared a narrower vocabulary than
  the strips it reports on. `DroppedFieldsEvent.reason` was a closed enum over the
  two READ-ONLY strips (`readonly` #2948 / `readonly_when` #3042), so the
  primary-key strip added by #6262 / PR #6433 (multi branch) and #6435 (by-id
  branch) — a `data.id` the update dispatch has ALREADY RULED is not a primary
  key, removed from the SET payload before it can overwrite the targeted rows'
  identity — was invisible to `onFieldsDropped` and to `strictReadonlyWrites`.
  Both PRs were right to refuse the alternative: force-fitting `readonly` would
  make `reason` lie, which is worse than silence. This adds the value instead.

  **New reason: `primary_key`.** It names the FIELD's role, not the offending
  value's shape, so it stays true if the strip ever widens to the same-value
  truthy-scalar no-op the engine deliberately leaves alone today —
  `not_a_primary_key` would describe the value and become false that day. The
  house rule it follows is #5503's, applied in the other direction: a new arm is
  warranted exactly when no existing arm is truthful. #5503 reported the
  implicitly-readonly runtime-owned strip as plain `readonly` because that _was_
  true of it; `readonly` is not true of an `id` (a truthy scalar `id` writes
  fine), so this one gets its own value.

  **⚠️ Behaviour change, deliberate and measured: `strictReadonlyWrites` gains a
  new refusal.** The option's contract says it covers "every drop
  `onFieldsDropped` reports" — coverage DERIVED from the reported set, never an
  enumeration frozen at #5126, and confirmed by reading `reportDroppedFields` on
  `main`, whose `strictDrops.push` applies no reason-class filter. So reporting a
  new reason necessarily refuses it. A caller that passes
  `strictReadonlyWrites: true` **and** puts a ruled-non-key value in `data.id` now
  gets `ERR_READONLY_FIELD_REJECTED` where it previously got a success whose `id`
  had been silently dropped. That is the option's whole promise ("don't
  half-apply my payload") reaching one more strip class, and it is the outcome the
  flag's own doc now states. Nothing else moves: default-mode callers still get a
  successful write plus an event, the strip itself is unchanged, and
  `strictReadonlyWrites` is in-process only (`WriteObservabilityOptions`), so no
  REST/wire caller can reach either behaviour.

  **The refusal error no longer describes every rejection as read-only.**
  `ReadonlyFieldRejectedError` composed one sentence ("… are read-only and would
  have been stripped", remedied by `{ context: { isSystem: true } }`) that is
  false for a `primary_key` drop — `isSystem` does not exempt that strip. The
  message is now built from the `drops` breakdown the error already carried, so it
  names each reason against its own fields and offers the right remedy. The
  **read-only-only message is byte-identical** to #5126's / #5503's text (pinned
  directly), the error `code` is unchanged, and adding a reason deliberately does
  not add an error code: callers catch one code and read `drops`.

  Consumers that branch on `reason` were swept. `service-automation`'s flow-step
  warning map is a `Record<DroppedFieldsEvent['reason'], string>`, so tsc demanded
  the new wording — the loud shape, kept that way on purpose. The protocol
  responses that carry `droppedFields` (`api/batch.zod.ts`, `api/protocol.zod.ts`
  ×3, plus the cross-object batch extension) all derive from
  `DroppedFieldsEventSchema` and widen transitively; REST's
  `X-ObjectStack-Dropped-Fields` header is generic over the reason and needed no
  change. One consumer does NOT widen safely and is filed rather than fixed here:
  objectui's `writeWarningToast` picks its wording with a binary ternary whose
  `else` arm would announce a stripped `id` as "Read-only" (objectui#3935).

- 4c45be1: fix(convention): a best-effort degradation that costs DURABILITY logs `error`, not `warn` — and a gate that enforces it (#4632)

  #4420: the durable suspended-run store attached to a table that was never
  created. Every write failed into a `warn` nobody read, every restart dropped all
  in-flight approvals, and the process reported perfect health the entire time —
  the symptom surfaced a release after the cause. #4460 raised that **one** site to
  `error`. This makes it the rule, because the _class_ is what recurs.

  **The rule** (AGENTS.md → "Degradation log levels") is a question, not an
  adjective, so an agent can apply it while writing the `catch`:

  > After the degradation, does the system still look "normal" from the outside,
  > while something it claims is persisted has not actually landed?
  > Yes → `error`. No → `warn`/`info` is right.

  An `error` here owes two things in its first line: the **consequence** (what is
  not durable, and that the system will keep looking healthy anyway) and the
  **fix** (the composition change that restores durability, or the explicit opt-out
  that makes the degradation deliberate). Say it once, not once per failed write.

  **Sites raised to `error`** — each was reviewed individually; escalating a
  functional degradation is the mirror-image failure and was deliberately avoided:

  | Where                                            | What was silently lost                                                                                                                   |
  | :----------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
  | `objectql` schema sync, per object               | DDL never ran — the object stays registered, routed and rendered while its table/columns do not exist                                    |
  | `objectql` schema sync, summary                  | `info: Schema sync complete` printed over a pass with failures; now an `error` naming the count                                          |
  | `objectql` reload-time schema sync               | a Studio edit adds a field, the UI shows it, the API accepts it, the column was never created                                            |
  | `ObjectQL.syncSchemas()`                         | an **empty** `catch` — marketplace install and template seeding wrote into tables this failure means do not exist, then reported success |
  | `service-automation` wait-timer re-arm (4 paths) | runs stay persisted but nothing re-arms them: every approval paused before the restart hangs forever                                     |

  **Deliberately left at `warn`** — the rule cuts both ways, and over-applying it
  trains everyone to skim `error`: the batch→sequential schema-sync fallback (it
  _recovers_), and "no job service is registered" on the re-arm path (a declared
  absence in a host that never composed auto-resume — nothing was promised and
  then broken).

  **It has teeth.** A convention that lives only in AGENTS.md is the same
  "declared ≠ enforced" shape this repo keeps paying to fix, so
  `pnpm check:durability-log-level` walks the AST for `catch` blocks guarding a
  declared vocabulary of durability-critical operations and fails when one
  degrades below `error` without rethrowing. It follows same-file helpers (so
  extracting a reporter cannot quietly defeat it) and ships its own `--self-test`.
  Deliberately narrow: it cannot _discover_ a new durability seam, only stop known
  ones from regressing — extend `DURABILITY_CRITICAL_CALLEES` in the same PR that
  fixes a new one.

  No API, schema or behaviour changes — only the level, and the text, of what
  already-failing paths report.

- cc5b048: 自动化引擎:嵌入式 host 从未调用 `sealNodeTypeVocabulary()` 时,首次执行 flow 会告警一次(#4792)

  #4771 把 ADR-0018 的节点类型校验从 `registerFlow` 挪到了 `sealNodeTypeVocabulary()`。`AutomationServicePlugin` 在 `kernel:bootstrapped` 自动 seal,插件路径不受影响;但自己 `new AutomationEngine()` 且从不 seal 的嵌入式 host 就彻底拿不到这项校验,而且完全静默 —— 只有读过 changeset 的人才知道要补一行调用。现在这类 host 在第一次真正执行 flow 时会得到一条 `warn`,说明丢了什么、以及要调用哪个方法。

  - 首次执行是最早既安全又必然到达的时点:正在跑 flow 的 host 显然已经装配完毕(否则这次执行本身就会 `NO_EXECUTOR` 失败)。
  - **每个引擎实例一次**,不是每进程一次 —— 一个 host 建了多个引擎(按租户/环境各一个是常见形态)就是在每个上都漏了这次调用。
  - 告警只报「缺了这次调用」这个关于 host 的事实,**不报**未知节点类型的审计结果:未 seal 的引擎其词汇表按契约仍可增长,在那里断言「某类型没有执行器」正是 #4771 删掉的那种会被本次启动反驳的判断。需要审计结果又不想封闭词汇表的 host 用只读的 `getUnknownNodeTypeAudit()`。
  - 也**不会**顺带自动 seal:「谁决定词汇表封闭」只能有一个答案(host)。而且 seal 之后 `registerFlow` 会转为即时校验,自动 seal 会让「先执行、后注册插件执行器」(ADR-0018 允许)的嵌入式 host 开始收到 #4771 那种误报。

  走 `AutomationServicePlugin` 的部署与已显式调用过 `sealNodeTypeVocabulary()` 的 host 都不会多打任何日志(两条哨兵测试守着)。

- c308064: Enforce `ActionDescriptor.supportsPause` at the engine boundary: an executor whose
  `execute()` returns `suspend: true` while its descriptor declares `supportsPause: false`
  is now refused instead of pausing the run (#6667, from #5703).

  `supportsPause` used to be read only at authoring time — the designer palette, the
  registration warning, and the `check:resume-authority-declared` CI gate, all of which key
  on `supportsPause: true` and so were silent on exactly this mismatch. The pause it let
  through was already broken, just later and elsewhere: a type that declares no pause
  declares no `resumeAuthority` either, and since #5561 an unclaimed pause is fail-closed,
  so the run parked on a durable continuation that the generic resume route then refused
  with `PERMISSION_DENIED` — a message naming `resumeAuthority`, not the `supportsPause`
  that actually caused it. The refusal fails the run where the mistake was made, writes no
  continuation, and names the one-line fix.

  Behaviour change for third-party executors in that state (no built-in is: all six pausing
  built-ins declare `supportsPause: true`). The refusal is guard-class, so a `fault` edge
  does not route it — a wrong declaration is not a condition a re-run can fix. Two shapes
  are deliberately untouched: declaring `supportsPause: true` and never suspending is legal
  (a capability, not an obligation), and an executor that publishes no descriptor at all
  declares nothing to enforce — its pauses stay governed by the #5561 resume gate.

- 24122a9: fix(service-automation): the 13 residual `engine.ts` seams stop splicing uncontrolled thrown text into log messages, plus the one self-authored multi-line message; run-history persist failure is re-graded `error` (#6499)

  #6299 / PR #6498 fixed three `engine.ts` seams and closed with "this file is now
  clean"; #6499 is the corrective record: 13 more logger calls in the same file
  still interpolated a thrown value's `.message` — a datasource driver's, a
  plugin's (trigger / node-executor), or, second-hand via the
  `AutomationResult.error` envelope, a failing node's — into the log MESSAGE.
  `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so a cause
  carrying newlines turned ONE record into several physical lines of which only
  the first is greppable, and `serve`'s boot-quiet window drops the headless
  continuations outright on the stdout (warn) path. All 13 now log a single-line
  message stating the site's own consequence and hand the cause to the logger's
  structured slot (`describeThrownForLog`).

  A 14th site with the opposite cause is fixed alongside, argued on its own
  terms: `validateFlowExpressions`' advisory schema pass authored a literal
  `\n      source: …` continuation into a message we control, with the flow
  author's (newline-tolerant CEL) expression as the second line. The message now
  stays one line; the expression source rides the structured slot (`source`).

  The level was judged per seam (#4632), not batch-copied:

  - **`recordLog`'s fire-and-forget `store.recordTerminal` → RAISED to `error`.**
    The write half of the run-history claim: a TERMINAL run's history row failed
    to land while the run completed and every caller reads healthy — nothing
    retries it, nothing upstream is told. After the next restart the run is
    invisible to the Runs surfaces, `inspectStrandedRequests` (#3456) reads
    "no suspension + no terminal row" as a STRANDED approval, and
    `releasePendingForTerminalRuns` (#4469) reads "no terminal row" as
    still-alive, so a finished run's leftover pending approvals are never
    auto-released.
  - **`persistSuspendedRun` stays `error`** (#4460's raise; #4420 is this exact
    seam's accident) — no re-grade, message and slot fixed only.
  - **Everything else stays `warn`** (functional): `listRuns` / `getRun`
    (observability reads degrading to ring buffer / null — each record now says
    the caller cannot tell the degraded answer from a real one), the four
    plugin-supplied seams (`releaseSuspension`, `unregisterTrigger`,
    `activateFlowTrigger`, `deactivateFlowTrigger`), the grants resolver, lookup
    expansion, the screen `visibleWhen` probe, and both `bubbleToParent`
    branches. Nothing these degrade claims to be persisted.

  Operator-visible: one record moves from stdout/`WARN` to stderr/`ERROR`
  (run-history persist failure), and the reworded messages keep their original
  lead phrases (`run-history read failed`, `durable run lookup failed`,
  `Failed to bind flow`, `could not resolve grants`, …) so existing greps still
  match; alert rules keyed on the trailing `: <error text>` splice need the
  structured `error` / `source` / `visibleWhen` fields instead.

- b0d54bf: fix(service-automation): the last three `engine.ts` seams stop splicing a driver's failure into the log message, and two of them are re-graded `error` (#6299)

  All three catches sit around the `SuspendedRunStore` driver and rendered their
  failure by interpolating the thrown value's `.message` into the log MESSAGE.
  `ObjectLogger.write()` adds exactly one `<ts> <LEVEL>` head per call, so a
  driver error carrying newlines turned ONE record into several physical lines of
  which only the first was greppable — and on the `warn` path, inside `serve`'s
  boot-quiet window, `BootLogCapture.offer()` keeps only lines with a level head,
  so the continuation lines were dropped outright. Measured on the restored
  concatenation: a three-line driver error became 3 physical lines and the boot
  filter retained 1, and that one carried no driver fact. The cause now goes to
  the logger's structured slot (`describeThrownForLog`), so the record stays on
  one physical line in every format. This closes the family of #5048 / #5575 /
  #5636 / #5661 / #5737 / #5912 / #6230 for this file.

  The level was judged per seam (#4632), not batch-copied from #6230:

  - **`forgetSuspendedRun` → raised to `error`.** The hot cache is dropped before
    the store delete and this is the single choke point every consumption of a
    suspension passes through, so a failed `delete` leaves the suspension gone
    in-process and the durable row alive. Callers still report success, and the
    surviving row is re-listed and re-resumed after the next restart, running a
    continuation that already ran.
  - **`cancelRun` → raised to `error`.** An unreadable store makes the failed read
    read as "no such suspended run", so the method returns `false` — which its
    contract calls idempotent success — and the cancellation is silently skipped
    while the call reads clean. The run stays parked and durably resumable.
  - **`listSuspendedRunsDurable` → stays `warn`.** Nothing claimed-persisted
    failed to land: the rows are intact and still resumable by id. The listing
    degrades to the in-memory cache alone, so the message now says out loud that
    the result is short and that the caller cannot tell.

  Operator-visible: two records move from stdout to stderr and from `WARN` to
  `ERROR`, and all three messages are reworded to state their consequence. Log
  filters or alert rules keyed on the old `warn`-level text for a failed
  suspended-run delete or cancel need updating.

- 7ef20d0: feat(cli,automation): catch `label: 'error'` written where `type: 'fault'` was meant (#3863)

  Two of the three items left open on #3863. Both are about making the fault-edge
  contract legible; neither changes routing behaviour.

  **New lint — `flow-error-label-not-fault`.** `type: 'fault'` is what routes a
  failure; `label` is cosmetic on an ordinary edge. So this, which reads exactly
  like error handling:

  ```ts
  { source: 'charge_card', target: 'flag_for_review', label: 'error' }
  ```

  is an ordinary out-edge — and `traverseNext` runs every unconditional out-edge
  in parallel. The handler fires on every **successful** run of `charge_card`,
  concurrently with the real success path, and never on a failure. The run still
  aborts when the node fails.

  Silent in both directions: the author believes failures are handled, and never
  notices the handler running when nothing went wrong. The reading is especially
  natural for an AI author, since the label is precisely what the intent sounds
  like — which is why this is worth a build-time diagnostic rather than leaving it
  to a puzzled look at a run trace.

  Deliberately narrow, because a label IS load-bearing on a branching node: a
  `decision` / `approval` executor returns a `branchLabel` and traversal then
  prefers the edge carrying it. Edges out of those node types are excluded, as are
  conditional edges (a guarded path is not the unconditional footgun) and edges
  already typed `fault`. Matches the obvious synonyms (`error`, `failure`,
  `catch`, `on_error`, …) case-insensitively. Verified against the shipped
  showcase: no findings.

  An alias — accepting `label: 'error'` as if it were `type: 'fault'` — was
  considered and rejected: two spellings for one concept is harder to read than
  one spelling plus a diagnostic that names the fix.

  **Pinned: a handled failure does not consume a flow-level retry.** The two
  recovery mechanisms have different scopes and must not compound — a `fault` edge
  handles one node, while `errorHandling.retry` replays the flow **from the
  start**, re-running every node that already succeeded (a second notification, a
  second created record). A failure a fault edge handled is not a flow failure, so
  it does not consume a retry. That already held by construction (a routed failure
  never propagates out of `executeNode`); it is now a test, so a refactor of the
  catch path cannot quietly change it.

  Docs and the automation skill gain both points, plus a note on the edge-property
  table that `label` does not select a path except on a branching node.

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

- 8108787: fix(service-automation): flow 绑定失败的告警改用结构化 `meta`,不再把 Zod issue 数组塞进单行日志 (#5048)

  `AutomationServicePlugin` 的五个 flow 绑定/读取失败点都把 `err.message` 插进一条
  单行 `logger.warn`。而 `registerFlow` 用 `FlowSchema` 解析,#4001 关闭 metadata
  schema 之后未知键是**抛出**而不是被丢弃 —— ZodError 的 `.message` 是 issue 数组的
  多行 JSON dump,第一行就是一个 `[`。

  两级管线随后把余下内容销毁:`ObjectLogger.write()` 每次调用只写一条
  `<ts> <LEVEL> <msg>` 记录,带换行的 message 会溢出到没有等级前缀的后续行;而
  `serve` 的启动诊断缓冲(`BootLogCapture.offer()`)只保留 `classifyBootLogLine`
  能认出等级前缀的行。于是一次启动里 24 个绑不上的 flow,给出的是 24 条点了名字、
  然后说一个 `[` 的告警 —— cloud#971 能横跨整条 rc.1 发布线没人发现,就是因为这个。

  现在这些位置改为:message 是不含换行的静态字符串,事实交给 logger 的 `meta`
  第二参(仓库里每个 `Logger` 实现都用 `JSON.stringify` 序列化它,值里的换行变成
  `\n` 转义,整条记录稳定占一行,正是启动缓冲会保留的形态)。新增内部模块
  `flow-bind-diagnostics.ts` 把 Zod issue 摊平成 `{ code, path, message,
unrecognized }`:`path` 渲染成 `nodes[0].config.x`,被拒的键名放在
  `unrecognized` 而不是 Zod 原本的 `keys` —— 因为 `ObjectLogger` 的默认脱敏表
  (`['password','token','secret','key']`)按**子串**递归匹配,`keys` 含 `key`,
  原样转发 `err.issues` 会渲染成 `"keys":"***REDACTED***"`,恰好丢掉读者唯一需要
  的那个事实。issue 列表有上限,超出时用 `issueCount` **显式声明**总数,而不是静默
  截断。非 ZodError 的失败退回 `error` 字符串分支。

  无公开 API 变化;日志文本的可 grep 前缀(`cold-boot flow bind: failed to
register`、`flow re-sync: failed to register`、`flow pull from ObjectQL
registry failed`、`flow read from protocol failed`)全部保留。与 #4632 同源:
  被截断的诊断比没有诊断更贵。

- c88eeda: fix(automation): flow string templates serialize object tokens readably, never `[object Object]` (#3450)

  A flow string field that embeds an object-valued token — most notably the
  engine's `$error` (`{nodeId, message, ...}`, set on a failed step) in a fault
  handler's notify body — rendered as the useless `[object Object]`. The
  multi-token branch of `interpolateString` coerced every value with `String()`,
  and `notify-node` did the same for a sole `{$error}` token.

  - New shared `stringifyForTemplate` helper (`builtin/template.ts`): objects and
    arrays are JSON-serialized (so the text stays legible and still carries the
    message), primitives pass through, `null`/`undefined` render as ''.
  - `interpolateString`'s embedded-substitution branch and `notify-node`'s
    title/body coercion use it. The sole-token branch still returns the raw value
    (typed config fields keep their type), and `{$error.message}` still resolves
    to just the message string — the documented, cleanest author form.

  Split from #3425 (the readonly-strip half shipped in #3465).

- 91f4c78: fix(automation,objectql,spec): attribute `runAs:'system'` flow writes to the flow in the audit log (#4366)

  A `runAs:'system'` flow's data writes carried no attribution at all: the run
  context resolved to `{ isSystem: true }` with no `userId` and no service
  principal, so the audit writer recorded `user_id=null, actor=null` and the
  record-history UI rendered every such row as "Unknown user" — business users
  read the flow's own status mirror as data corruption.

  The `svc:*` attribution channel (ADR-0014 D2, `ExecutionContext.actor`) already
  existed for exactly this class of writer; it was simply never wired end-to-end:

  - **service-automation** — `resolveRunContext` now stamps `flowName` alongside
    `runAs`/`flowRunId`, and `resolveRunDataContext` labels a `runAs:'system'`
    run's data context `actor: 'svc:flow:<flowName>'` (fallback
    `svc:flow:automation`). Attribution only — no security middleware keys on it.
  - **objectql** — `buildSession` propagates `ExecutionContext.actor` onto the
    hook session, closing the gap that left the audit writer's
    `userId ?? session.actor` fallback unreachable from the engine path.
  - **spec** — `AutomationContext.flowName` (engine-stamped, provenance) and the
    hook session's optional `actor` field document the contract.

  No behavior change for user-attributed writes: `userId` still wins wherever it
  is present.

- 4d552af: feat(spec)!: `FlowNodeSchema` parses its own ADR-0031 regions — the post-parse pass retires (#4415)

  `FlowSchema.parse` normalized a flow's own `nodes[]` / `edges[]` but could not reach a
  **region**, because a region lives inside `FlowNodeSchema.config` — a deliberately open
  `z.record` (ADR-0018). #4381 closed the resulting gap with a **post-parse pass**,
  `normalizeControlFlowRegions`, that every caller had to remember to run:

  ```ts
  const flowShell = FlowSchema.parse(converted);
  validateControlFlow(flowShell);
  const parsed = normalizeControlFlowRegions(flowShell); // ← had to remember
  ```

  That is an unwritten rule on top of a parse, and it is exactly the condition the #4347
  family of defects grows in: a new consumer — a Studio publish path, an MCP tool, a bulk
  validation script — takes a `FlowParsed` and uses it, holding a **half-parsed flow that
  looks finished**. Nested edge predicates were still bare strings, nested nodes had not been
  through `.strict()`, and nothing said so.

  Now the schema does it. `FlowNodeSchema` carries a `.transform()` that parses each declared
  region slot — `loop.config.body`, `parallel.config.branches[]`, `try_catch.config.try` /
  `.catch` — through the schema that slot's value _is_. Nesting needs no manual recursion: a
  region's `nodes` are `z.array(FlowNodeSchema)`, so Zod re-enters the transform on the way
  down. **"Parsed" now means parsed at every depth** (Prime Directive #1), from any entry
  point — including `FlowNodeSchema.parse(node)` on a single node, which the old whole-flow
  pass could not serve at all.

  ## Migration

  **`normalizeControlFlowRegions` is removed from `@objectstack/spec/automation`.** Delete the
  call; the parse above it already did the work:

  ```diff
    const parsed = FlowSchema.parse(converted);
    validateControlFlow(parsed);
  - const normalized = normalizeControlFlowRegions(parsed);
  ```

  Its replacement, `parseFlowNodeRegions(node)`, is exported for the same purpose one node at
  a time, but you should not normally need it — it is the transform's own body.

  **`FlowNodeSchema` is now a `ZodPipe`, not a `ZodObject`,** so it no longer has `.shape` /
  `.extend()` / `.pick()`. `z.infer` / `z.input` / `.parse` / `.safeParse` and
  `z.toJSONSchema` are unaffected, and the authorable key set is byte-identical (verified by
  `check:authorable-surface`). If you were reaching for the object half, read it from the
  pipe's input side — `FlowNodeSchema.def.in` — which is also what the repo's own generators
  do (`pipeAuthorableSide` in `scripts/lib/zod-graph.ts`).

  One visible consequence in the generated reference: `content/docs/references/automation/flow.mdx`
  now renders FlowNode's **input** shape, so keys carrying a `.default()` (`boundaryConfig.interrupting`,
  `inputSchema[].required`) show as optional. That is what an author actually writes, which is
  what an authoring reference should say.

- 5602211: fix(automation): close the default-routable footgun on refuse-to-execute guards (#3863)

  #3881 stopped a `fault` edge from swallowing a guard refusal, keyed on
  `NodeExecutionResult.errorClass`. That field defaults to `'runtime'`, which was
  right for compatibility — every executor written before the split keeps its
  routing — but it leaves the footgun pointing the other way: **a new guard is
  routable unless its author remembers to classify it**, and forgetting is silent.
  Nothing in the type system catches it.

  Three changes close that for the guards that exist and make the next one hard to
  get wrong.

  **`refuseNode(reason)`** — one call that returns a guard-class failure, so
  "write a guard" and "mark it un-routable" become the same act. Its doc states
  the test for using it: re-running unchanged can never succeed AND the fix is to
  edit metadata. It also states the inverse, because over-marking is not the safe
  direction — classifying a handleable condition as `guard` turns a recoverable
  integration into a dead run.

  **Five guards that were never marked** are now un-routable. All are missing
  required config or a defective graph, none can succeed on a retry:

  - `http` with no `url`
  - `subflow` with no `config.flowName`, and `subflow` exceeding max nesting depth
    (a recursive graph nests exactly as deep next run)
  - `map` with no `config.flowName`
  - `connector_action` with no `connectorId` / `actionId`

  The seven `crud-nodes` guards from #3881 move to the helper — same behaviour,
  one spelling.

  **A behavioural inventory test** drives every known guard through the engine
  with a fault edge attached and asserts it is still fatal, matching on the
  refusal text so a guard failing for a different reason cannot pass vacuously.
  Verified to have teeth: un-marking one guard fails its row immediately. The
  negative half is pinned too — a plain node failure and a thrown error must still
  route, since that is what fault edges are for.

  Deliberately **not** marked, and why: a degraded connector (#3017 says recovery
  is automatic), a collection that did not resolve to an array, a collection over
  the iteration cap, and a subflow that failed on its own. Those are conditions
  the world caused, and an author must be able to handle them.

  Considered and rejected: making `errorClass` required on the result type. It
  would enforce classification at compile time, but it breaks every node executor
  returning a failure — 281 call sites across the repo plus third-party
  executors — for a type-only gain over the helper.

- 078c448: fix(service-automation): a durable `http` callout is `unmeasured`, not `acted` (#7882)

  The `http` node's durable path (`config.durable: true`) enqueues onto the
  messaging HTTP outbox and returned `metrics: { acted: 1 }` for the enqueue. But
  `enqueueHttp()` hands back the id of a **`pending`** `sys_http_delivery` row —
  the `HttpDispatcher` decides the real outcome afterwards, and that outcome
  includes dead-lettering the callout on a non-retriable response or an exhausted
  retry budget. So an operator reading the run summary could see `acted: 1` for a
  callout the durable record shows as `dead`: the summary asserted an effect that
  never happened.

  The durable path now reports `unmeasuredEffect` instead. That is the platform's
  existing word for "an effect happened but its outcome is not yet knowable" — the
  same qualifier `connector_action` uses — and pointedly **not** a bare `acted: 0`,
  which `connector.zod.ts` forbids because it would claim the run did nothing and
  would trip the documented broken-sweep alert
  (`selected > 0 AND acted = 0 AND unmeasured = 0`) on every healthy durable
  callout. A pending delivery now suppresses that alert without asserting success,
  and `unmeasured` is already surfaced by `formatRunSummaryLine` and by the
  `unmeasured_count` column on `sys_automation_run`.

  Same overstatement class as #7747 at the sibling `notify` node, but a smaller
  fix. That one needed `EmitResult` split into `delivered` vs `enqueued` inside
  `service-messaging`, because `MessagingService.emit()` hides two outcomes behind
  one call — inline (P0) fan-out, which really does know the result, and the P1
  outbox, which does not. `enqueueHttp()` has no such ambiguity: it returns a row
  id and the row is unconditionally `pending`, and the two-path structure already
  sits in the node itself. Nothing in `service-messaging` changed.

  **Unchanged:** the step still succeeds — the flow did everything it can do
  synchronously, and not blocking on the callout is the entire point of durable
  mode — and its output is still `{ deliveryId, enqueued: true }`. The inline
  request/response path keeps its measured counts: a mutating call the upstream
  accepted is still `acted: 1`, a `GET` is still a real `acted: 0`, and a rejected
  or timed-out mutating call was already `unmeasured`. This narrows what `acted`
  may claim; it does not blanket every HTTP callout as unmeasurable.

- 011b386: Reconcile the flat IO nodes' declared config against what their executors read
  (#4045 — the notify / http / connector step of the declared-vs-read worklist).

  **`notify` / `http` gain executor-derived Zod contracts.**
  `NotifyConfigSchema` and `HttpConfigSchema` (`automation/io-node-config.zod.ts`)
  were written by reading the executors — not by transcribing the descriptors'
  hand-written `configSchema` literals — and a new ledger test
  (`io-node-form-zod-ledger.test.ts`) compares the two key sets bidirectionally.
  Because the sides are independently written, agreement is evidence rather than
  tautology: a key survives only if the form offers it AND the executor reads it.
  Both nodes reconcile clean, with no deliberately-shallow ledger — their configs
  are flat and fully closed. Like the control-flow config Zods, these are contract
  exports: no engine path parses with them yet (that is #4045 step 3b, gated on
  the #4059 warning data).

  **`connector_action`'s mis-rooted `configSchema` is retired — it broke
  schema-driven authoring.** The executor reads only the declared
  `FlowNodeSchema.connectorConfig` sibling block, but the descriptor published a
  `configSchema` declaring `connectorId`/`actionId`/`input` as `config` keys. A
  published `configSchema` describes `node.config` by contract, and the Studio
  inspector derives its property form from it — rooting every field at
  `config.<key>` and replacing the client's hand-written `connectorConfig` form
  (with its connector/action pickers). So authoring a connector node against a
  live backend wrote the trio where nothing reads it, and the node refused to
  dispatch. The descriptor now publishes no `configSchema` (joining `wait`'s
  deliberately-schemaless class), which drops the online designer back onto the
  correct sibling-block form with no client change.

  **Stored flows that carry the mis-taught shape are healed at load.** A new
  ADR-0087 D2 conversion, `flow-node-connector-config-lift` (protocol 17, retires
  at 18), lifts `config.{connectorId,actionId,input}` onto the declared
  `connectorConfig` block — including the `AutomationEngine.registerFlow`
  rehydration seam. Declared keys win (the loose counterpart stays shadowed), and
  a lift that cannot complete the required `connectorId`+`actionId` pair leaves
  the node untouched, so a step-time refusal never becomes a load failure.

  **`connectorConfig.input` is now optional**, matching what was always true: the
  executor dispatches with `input ?? {}` and the designer's keyValue editor omits
  an empty map entirely — so the required `input` declared in the spec turned a
  no-input connector action into a `registerFlow` parse failure nothing
  downstream asked for.

- 05ac83d: Job runs that finish without doing their work are now audited as `degraded`, not `success` (#5548)

  `DbJobAdapter` decided a run's outcome solely by whether the handler threw, so a
  handler that failed internally and deliberately did not throw was recorded as
  `sys_job_run.status: 'success'` — the audit surface Studio's jobs view reads
  reported the one thing that had definitely not happened.

  The adapters now consume the `JobRunOutcome` channel `JobHandler` gained in
  #6617, using the `degraded` status vocabulary added in #7072:

  - a handler resolving `{ outcome: 'degraded', reason? }` lands
    `sys_job_run.status: 'degraded'` with the reason in `error`, and mirrors onto
    `sys_job.last_status` / `last_error`;
  - `degraded` is not a failure: `failure_count` stays flat and nothing retries
    (retry keys on a rejected promise only, unchanged);
  - `IntervalJobAdapter` / `CronJobAdapter` report the same verdict through
    `getExecutions()`, so the in-memory history and the persisted row agree.

  Strictly additive: a handler that resolves `undefined` — every handler written
  before #6617 — is still recorded as `success`, byte for byte as before.

  The first adopter is the `wait` node's timer wake-up: a shot that fires into an
  unreachable suspended-run store now reports `degraded` / `STORE_UNAVAILABLE`
  while still keeping its one-shot armed and its `sys_job` row active (#5529).

- cf7c694: fix(spec,runtime,service-automation): `GET /automation/:name/runs?status=` filters the runs instead of being dropped (#7359)

  `ListRunsRequestSchema` has always declared a `status` filter on
  `GET /api/automation/:name/runs` — `z.enum([...the eight ExecutionStatus
members]).optional()`, described as "Filter by execution status". Nothing read
  it. It had no slot on `IAutomationService.listRuns`, whose options were
  `{ limit?, cursor? }`, and the runtime handler never built it into the object it
  forwarded, so the parameter was dropped at the HTTP boundary and the caller was
  answered **200 with every run of the flow**, capped by `limit`.

  That is worse than an error, because the answer looks like the one that was
  asked for: a monitoring caller paging `?status=failed` reads the first 20 runs
  of any status and concludes those are the failures. Exposure was raw HTTP,
  generated clients, and anything authored against the OpenAPI surface — the typed
  SDK could not send the parameter at all, which is why nothing had tripped over
  it. #7300 fixed this route's two _coerced_ parameters and deliberately preserved
  the ignore-the-key behaviour rather than decide between honouring and retiring
  the third; this change takes the enforce route (ADR-0049), so the declared
  surface is now true.

  **The filter is honoured across both stores.** `AutomationEngine.listRuns`
  serves the Runs view by merging an in-memory ring buffer with the durable run
  history it reads back from the store. The narrowing is applied to the merged
  result, so both halves are covered: filtering only the buffer would answer "no
  failures" for a flow whose failures are all in durable history — i.e. after any
  restart, which is exactly when someone asks — and filtering only the durable
  rows would hide the live ones. Applying it after the merge also means each run
  is matched on its **resolved** status: the buffer holds more than one entry per
  run id (a run that pauses appends `paused`, then its terminal entry), and
  narrowing before the collapse would have let a stale `paused` entry outlive the
  terminal one, so every approval/screen/wait run that had since completed would
  report itself as still paused.

  The durable arm's window is unchanged: `listHistory(flowName, limit)` has no
  status slot, so the filter is applied to the rows that come back rather than
  pushed down, and a status filter can therefore return fewer than `limit` matches
  while older ones exist. That is this merge's pre-existing shape — durable rows
  were already capped at `limit` before the sort-and-slice — and closing it is a
  store-contract change. What it never does is return a run of another status.

  **An undeclared status is now refused, not silently widened.** Once the filter
  is honoured, a value outside the set has no safe reading: `?status=faild` cannot
  mean "no filter", and serving the empty list is no better, because "no runs are
  `faild`" and "no runs failed" read identically to a caller who cannot see their
  own typo. The check goes through the shared `query-param` module this route
  already consumes with `/notifications`, as a new `parseEnumParam` gate, and
  refuses in the house shape — `400` `VALIDATION_FAILED` (ADR-0112) with a
  `details.fields[]` entry carrying ADR-0114's existing `invalid_option`
  ("not a member of the field's declared options"); a value that was never a
  single string at all — a repeated `?status=a&status=b`, a structured
  `?status[$ne]=x` — gets `invalid_type`, the same mapping the module's string
  gate already makes. No new error vocabulary. The accepted members are read from
  the spec's own `ExecutionStatus` enum, the one `ListRunsRequestSchema` is built
  from, so the wire's declared set and the boundary's accepted set cannot drift.

  **The typed client can now send it.** `client.automation.listRuns(flow, {
status })` — both the `automation.listRuns` alias and `automation.runs.list` —
  takes the filter as an optional `ExecutionStatus`, additively. It could not send
  the parameter at all before, which is the reason nothing had tripped over the
  server-side gap; leaving it out would have made the enforced filter reachable
  only from raw HTTP, and the Runs view that wants it goes through this client.

  **Nothing that had a defensible answer changes.** An absent `status` still
  returns every run, exactly as before. So does the empty spelling `?status=` —
  unlike `?read=` on the notifications inbox, which used to serve the wrong _half_
  of the result, `?status=` already served precisely what "no filter" means, and
  it is what an "All statuses" `<select>` submits. `limit` and `cursor` are
  untouched, including out-of-range values, which remain the service's business.

- cfeb9a0: fix(service-automation): the five NAME-shaped log splices stop interpolating foreign identifiers into log messages (#6654)

  The tail #6499 reported but did not fix and #6587 deliberately excluded: five
  `service-automation` log records still spliced **names/identifiers** that
  originate outside the engine's control and are not schema-constrained to reject
  newlines. `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so a
  newline in any of them turns ONE record into several physical lines of which
  only the first is greppable, and `serve`'s boot-quiet window drops the headless
  continuations outright on the stdout (warn) path — the same downstream damage as
  the closed thrown-text class, reached through a different door.

  All five now log a single-line message carrying only controlled facts, with the
  foreign identifier(s) in the logger's structured slot:

  - the **re-entrancy guard** — the caller's record id → `recordId`;
  - the **refused resume** — the caller's resume-signal keys → `rejected`;
  - the **screen-input refusal** — the user-submitted keys, which reach the
    message via `validateScreenInputs`' `Unknown screen field "…"` findings →
    `issues` (the message now states the issue COUNT);
  - **`warnUnknownNodeTypes`** — the flow's unknown node type names and the
    registered vocabulary → `unknownTypes` / `knownTypes`;
  - the **unclaimed branch label** (#4414) — the computed, potentially
    record-derived branch label and the out-edge labels → `branchLabel` /
    `outEdges`.

  **No level changes**: every one of the five is #4632-FUNCTIONAL and stays
  `warn`. Behaviour is unchanged at all five sites, and the caller-facing refusal
  ENVELOPES (`INVALID_SIGNAL`, `INVALID_SCREEN_INPUT`) are untouched — they still
  name the offending variables and fields, because an envelope is not a log
  record.

  Operator-visible: each message keeps its lead phrase so existing greps still
  match — `re-entered for the same record`, `signal writes engine-internal`,
  `violates its declared field contract`, `no registered executor or descriptor`
  (load-bearing: tests and log filters count per-flow findings by it), and
  `no out-edge carries that label`. Anything keyed on the spliced identifier
  inside those messages must read the structured field instead.

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

- f28ef3b: fix(services): a notify flow-run summary no longer reports a delivery the delivery record dead-lettered (#7747)

  Boot a stack without the `push` channel registered, fire a flow whose `notify`
  node targets `['push']`, and the two records an operator can read **contradicted
  each other**: `sys_notification_delivery` held `status: 'dead'`,
  `error: "channel 'push' not registered"`, while the flow-run summary said
  `status: 'success', acted: 1`. Nothing was delivered, and the surface built to
  answer "did this sweep actually do anything" (#4354) said it had.

  The seam is `EmitResult.delivered`. With the durable outbox in play (ADR-0030
  P1), `emit()` returns as soon as the `(recipient × channel)` rows are enqueued —
  the dispatcher sends and decides the outcome afterwards — but `delivered`
  counted those _enqueued_ rows anyway, under a name that says they arrived. The
  `notify` node then fed that number straight into `acted`, so a count minted
  before any send attempt survived unrevised through the dead-letter. It was never
  a "stale by a moment" number either: nothing ever revisits it.

  - `EmitResult` now separates the two. `delivered` means a channel **accepted**
    the delivery — a terminal, observed outcome, which only the inline (P0)
    fan-out can report. New `enqueued` carries the outbox path's accepted rows:
    durable, unsent, outcome pending on `sys_notification_delivery`.
  - The `notify` node counts only what was delivered toward `acted`. When
    deliveries are merely enqueued it reports `unmeasuredEffect` instead — the
    qualifier a `connector_action` already uses for an effect the platform cannot
    count, and deliberately **not** a bare `acted: 0`, which would claim the run
    did nothing. The broken-sweep alert is
    `selected > 0 AND acted = 0 AND unmeasured = 0`, so a pending delivery
    suppresses the alert without asserting success. The node's output gains
    `enqueued` alongside `delivered` and `notificationId`.

  The run still reports `success`: the flow did everything it can do
  synchronously, and failing it would let a channel registered a moment later
  retroactively break the flow. Notify does not block a flow on a downstream
  channel, so "delivered" is not a claim it is ever in a position to make — what
  changes is that it no longer makes it. Inline (P0) fan-out is untouched: it has
  the channel's answer by the time `emit()` returns, so `acted` stays a real
  measurement there, including the measured zero for an unregistered channel.

- ce15dc3: Align the `notify` node's Studio form-descriptor strings with the schema's actual acceptance behaviour (docs-only; no acceptance or `configSchema` key/type/required change):

  - `sourceObject` / `sourceId` no longer say "Requires sourceId." / "Requires sourceObject.". Both are optional and the executor drops a half-specified click-through target at execute time (so the inbox never renders a dead link) — the descriptions now state that tolerance instead of a phantom requirement, mirroring the `NotifyConfigSchema.sourceObject`/`sourceId` `.describe()` wording fixed in #7085 (PR #7111). (#7112)

- 01e124d: Graduate `notify`'s nested `source: { object, id }` into the conversion layer (#4045).

  The `notify` executor tolerated a second spelling of its click-through target with
  a bare consumer-side fallback:

  ```ts
  const object = toStr(interpolate(cfg.sourceObject ?? src?.object, …));
  ```

  Its own doc comment named `sourceObject`/`sourceId` **canonical** (they mirror the
  `sys_notification.source_object`/`source_id` columns), so the nested form was an
  alias tolerated by exactly the mechanism Prime Directive #12 calls debt — and the
  one alias on this executor that #3796 missed when it moved `to`/`subject`/`body`/
  `url` into `flow-node-notify-config-aliases`.

  It now graduates the same way `filters` → `filter` and `object` → `objectName`
  did: the conversion lifts it onto the canonical pair at load — including the
  `AutomationEngine.registerFlow` rehydration seam — and the executor's fallback is
  deleted, so no consumer-side dialect tolerance survives and the alias is declared,
  tested and retirable on schedule (it rides the existing entry's window, retiring
  at 18).

  Unlike the four renames this is a **1→2 destructuring**, which the pair mechanism
  cannot express, so it is a small custom transform. It mirrors the `??` precedence
  exactly: a canonical key already present wins and its nested counterpart is left
  shadowed, matching how a shadowed alias is treated elsewhere. `source` is dropped
  once at least one part is lifted; a `source` that is not an object, or carries
  neither key, is left untouched rather than silently deleted.

  No behaviour change for authors — both spellings keep working, and a
  half-specified target is still dropped rather than emitting a dead deep-link.

- d91fad5: fix(services): a paused run's variable snapshot is readable on run-detail (#7639)

  While an automation run was **paused**, `GET /api/v1/automation/{flow}/runs/{runId}`
  carried no `variables` key at all — so a run stopped at an approval, a screen or a
  wait, which is precisely the state an operator most often needs to inspect,
  answered with no variable state. "What did the previous node actually produce, and
  why did the next one route the way it did?" was not answerable from the product;
  it could only be inferred backwards from whatever the next node happened to
  resolve.

  This was structural, not a data gap. `ExecutionLogSchema` has declared
  `variables` ("Final state of flow variables") since the schema was written, and
  the engine's own log entry declared it too — with no producer anywhere, so the
  key the run-detail read publishes was never populated. The engine already held
  the answer: both `status: 'paused'` `recordLog` call sites sit a few lines below
  the suspend bookkeeping that computes `Object.fromEntries(variables)` for the
  continuation. The snapshot simply never reached the surface a caller can read.

  Both paused sites now write it — the initial-execution suspend **and** the
  resume-path re-suspend, so a multi-stage approval is readable at every stage
  rather than only the first. Each site takes ONE snapshot expression and hands the
  same object to the continuation and to the log entry, so what an operator reads
  can never disagree with the state the run will resume from.

  The snapshot is **point-in-time at the suspend**, not a live read: the variable
  map is dead by then (the run has unwound; resume rebuilds a fresh map from the
  continuation), so there is nothing later to diverge from.

  Nothing about the exposure envelope changes: the run-detail read serves the log
  entry verbatim — no projection, redaction or masking on any field — and
  `variables` receives exactly that same treatment, under the same anonymous
  baseline that already gates the whole `/automation` domain. Terminal runs keep
  exactly the fields they had; only `paused` gains the key.

- a649d69: fix(service-automation): a durable PAUSED run is visible to `listRuns` and run-detail after a cold restart (#8050)

  After a process restart, a run parked at an `approval` / `screen` / `wait` node
  disappeared from the automation API while remaining fully durable:

  | read                                       | before                       | after                   |
  | :----------------------------------------- | :--------------------------- | :---------------------- |
  | `GET /automation/:name/runs`               | 200, **zero rows**           | the parked run          |
  | `GET /automation/:name/runs?status=paused` | 200, **zero rows**           | the parked run          |
  | `GET /automation/:name/runs/:runId`        | **404** `RESOURCE_NOT_FOUND` | 200, `status: 'paused'` |

  `sys_automation_run` holds two disjoint row families — terminal history rows
  (`run_`-prefixed, written on completion) and live suspension rows (keyed by the
  raw run id, status `paused`). `AutomationEngine.listRuns` merged the in-memory
  ring buffer with the first family only, and `getRun` fell back to the first
  family only. Before a restart the gap is invisible because a paused run is still
  in the ring; after one, the ring is empty and the suspension rows had no reader.

  The sharp edge was `?status=paused`. #7359 had just made that a real filter, and
  with no post-restart producer of a `paused` entry it could never match a row —
  so the one query an operator reaches for when asking "what is in flight?" was
  structurally guaranteed to answer "nothing pending".

  This is a read-path change only. Nothing about persistence moves: suspension
  rows keep their own id space, lifecycle and retention exemption, and are **not**
  reshaped into history rows. Durability was never the defect — a parked run
  already served `…/runs/:runId/screen` and resumed cleanly across a restart, and
  still does.

  Merge precedence is now stated explicitly: durable paused → durable history →
  in-memory ring, weakest first. A paused row is the only source that can be stale
  (the delete on completion is best-effort), so a terminal row or ring entry for
  the same run id is later evidence and wins — a finished run is never reported as
  still waiting. The paused read is best-effort like the history read beside it: a
  store outage degrades the listing and logs the shortfall rather than throwing.

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

- dadf542: fix(service-automation): 启动路径三条日志改用结构化 `meta`,message 保持单行 (#5661)

  ## 接缝

  `AutomationServicePlugin` 里还有三处把**外来**错误的文本插进日志 message —— 与
  #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的 `fail()`)、#5636
  (`degradeConnectorInstance`)同一类,是那三单范围之外的第四组:

  - **`registerRunObject`**(`warn`):`err` 来自内核服务注册表(`ctx.getService('manifest')`
    或 `manifest.register()` 的解析拒绝),文本不是我们的。
  - **启动 probe**(`error`):`err` 来自 `candidate.probe()`,即**数据源驱动**抛出的错误。
  - **重启后 wait-timer 重新挂载**(`error`):`err` 是从 `rearmSuspendedWaitTimers` 逃出来
    的任何东西。

  ## 为什么后两条尤其值得改

  它们的**存在理由**就是可读性。代码自己写明后果 —— 「suspended runs will NOT survive a
  restart」「every wait/approval paused before this restart will hang indefinitely」—— 并被
  #4632 特意定为 `error` 级,好让运维能找到。而 `ObjectLogger.write()` 一次调用只加一个
  「时间戳 + 级别」记录头,所以带换行的 message 会变成多个物理行、只有第一行有头:文件 sink
  把其余行当成独立记录存,采集端读成无法归属的碎片,`grep ERROR` 只捞到那条不含任何事实的
  头行。这个 plugin 里最响的耐久性告警,恰好是最可能以读不懂的形态抵达的那一条。

  第一条的危害是另一种,并且是测出来的:`warn` 走 **stdout**,正是 `serve` 启动静默窗口包住
  的那条流,而 `BootLogCapture.offer()` 只在该物理行上找得到级别头时才保留它 —— 所以续行是
  被**直接丢弃**,不只是难解析。`registerRunObject` 在 `init()` 里跑,正处于窗口开着的时候。

  ## 改法(零新词汇)

  三处都复用同包 `thrown-cause-diagnostics.ts` 的 `describeThrownForLog`:message 是不含换行
  的自足句子,cause 走 logger 的结构化 meta。参数位按 `Logger` 契约区分 ——
  `warn(message, meta?)` 没有 `Error` 位,cause 在**第二**参;`error(message, error?, meta?)`
  的 cause 在**第三**参(第二参塞原始 error 会让记录额外附带堆栈)。#4632 要求的「后果 + 修
  法」仍然完整留在 message 的第一行里,只是末尾的 `: ${err.message}` / `Cause: ${err.message}`
  换成了指向 meta 的一句话。

  `pnpm check:durability-log-level` 仍绿:24 个耐久性接缝,三处 `error` 未降级、未改成 rethrow。

  ## 测试

  新增 `plugin-startup-log-cause.test.ts`:13 个用例全部让真 `ObjectLogger` 写真字节再读回来
  (照 #5662 的先例 —— spy 只能证明接缝**调用**了什么,证明不了按行消费者会**看到**什么,而
  后者才是 cloud#971 付掉一整条 rc 线的那一半)。三条接缝各自钉住「多行 cause 不进 message、
  进结构化 meta」、参数位、以及无 cause 时输出零字节;末尾两个用例把插值形态与结构化形态并排
  渲染、量出差别(`warn` 侧:一次调用多个物理行、启动缓冲只留下止于 Zod `[` 的那一行;`error`
  侧:一条记录散成三个碎片,后两行无记录头)。

  `plugin-suspended-run-wiring.test.ts` 里那条 #4420 的 probe 用例做了重新裁决而不是重新拼写:
  它原来断言驱动文本出现在 message 里,现在双向断言 —— message 里**没有**、meta 里**有**。
  单向的断言在 cause 被整个丢掉时也会通过。

- 9bf4588: fix(service-automation): bind `previous` (as null) on the create leg so start conditions can discriminate create vs update (#3427)

  The engine bound `previous` into the flow condition scope only when it was
  truthy, so on a record insert (`record-after-create`, and the create leg of
  `record-after-write`) `previous` was an **unknown** CEL variable. Any reference to
  it — including the documented `previous == null` create-discrimination — threw
  `condition failed to evaluate as CEL: Unknown variable: previous`, failing the
  whole start condition and dropping the run.

  `previous` is now always bound, to `null` when there is no prior row. So
  `previous == null` is the create leg and `previous != null` / `previous.<field>`
  the update leg — the pattern the `record-after-write` docs and the Studio flow
  designer advertise. Update-triggered flows are unaffected (`previous` was, and
  stays, the prior row there).

- 31e0be9: Flow metadata is canonicalized inside structured regions, not just at the top level (#4347).

  `registerFlow` canonicalizes a stored flow through three passes — the ADR-0087 conversion
  table, `FlowSchema.parse`, and the ADR-0032 predicate validation — and every one of them
  walked `flow.nodes` / `flow.edges` only. An ADR-0031 container keeps a whole sub-graph in
  its open `config` (`loop.config.body`, `parallel.config.branches[]`,
  `try_catch.config.try`/`.catch`), so all three stopped at the container and metadata came
  out **position-dependent**: the same node converted at the top level and did not one level
  in, and the same predicate was stored as a `{ dialect: 'cel', source }` envelope on a
  top-level edge and left a bare string on a loop-body edge.

  The reporting app shipped three sweeps whose gates never opened. Each run reported
  `success: true`, queried correctly, selected exactly the right records, and then did
  nothing — which is indistinguishable from "this sweep had no work to do" unless you assert
  on records written.

  - **`mapFlowNodes` recurses into regions**, to any depth. Every conversion in the table now
    reaches a nested node, which matters most for the two that change behaviour rather than
    spelling: a `webhook` / `http_request` callout inside a loop body kept a type no executor
    owns (the run failed), and a `delete_record` kept `config.filters`, leaving the canonical
    `filter` the executor reads absent — the erased-condition hazard
    `flow-node-crud-filter-alias` exists to prevent. Notice paths carry the region
    (`flows[0].nodes[3].config.body.nodes[1].config.filter`), so the warning points at the
    node to edit.
  - **New `normalizeControlFlowRegions`**, called at the load seam after
    `validateControlFlow`: each region is parsed through its own schema (recursively — regions
    nest), so nested edges and nodes carry the same canonical shapes as top-level ones. A
    region that does not parse is left untouched; rejecting one stays `validateControlFlow`'s
    job, so which flows register is unchanged.
  - **New `collectFlowGraphs`** yields a flow's own graph plus every nested region, each with
    a scope label. Both predicate validators iterate it instead of `flow.nodes` — the engine's
    `validateFlowExpressions` and `@objectstack/lint`'s author-time
    `validateStackExpressions` — so the `{record.x}` brace-trap they exist to catch is now
    caught inside a loop body too, naming the region (`loop 'sweep' body · edge 'b1' …`). It
    used to pass `objectstack validate`, pass registration, and fail at run time with the
    diagnostic suppressed.

  The container executors already parse their own config at run time (`parseNodeConfig`,
  #4277), so a nested predicate did evaluate correctly on current `main` — what was still
  wrong is everything that reads a region _without_ re-parsing it (the Studio designer,
  `getFlow`, the version history), and every conversion, none of which the executors replay.

  Also hardened, per the issue's secondary finding: `evaluateCondition`'s legacy `{var}`
  template path **refuses an unresolved dotted reference** instead of comparing it as a
  string. `'oppRecord.amount > 500000'` was compared `'oppRecord.amount' > '500000'` — `'o'`
  against `'5'` — so it was constantly true regardless of the amount: silently wrong in the
  _true_ direction, a gate that reports success while never gating. It now throws with the
  source and the fix (a CEL envelope, or brace the reference if the `{var}` dialect was
  meant), the same "never swallow a broken predicate" rule ADR-0032 §1c set for the CEL path.
  The `try { … } catch { return false }` around that block went with it: nothing in it throws,
  so it guarded nothing and would have swallowed the new refusal straight back into the silent
  wrong answer. Bare-word comparisons (`'{status} == active'`) and `{var}` templates are
  unchanged — only dotted references, which substitution can never leave behind, are refused.

- ffd2ce2: `registerFlow`'s remaining validators cover structured regions (#4389).

  #4347 closed the conversion and predicate halves of "metadata behaves differently
  depending on how deep it sits". Three validators were left walking `flow.nodes` only, so
  the same class stayed open one layer over: an ADR-0031 container keeps a whole sub-graph
  in its open `config`, and each of these checked _part_ of the flow while reporting on all
  of it.

  - **`validateControlFlow` recurses.** A container nested inside another container's region
    was never validated at registration — it reached run time, where `runRegion` →
    `findRegionEntry` throws mid-iteration, after the enclosing loop has begun and its side
    effects have landed. This cannot break a working flow: everything newly rejected was
    already guaranteed to throw on execution. It also closes cycle detection over nested
    regions, since region bodies are cycle-checked by `analyzeRegion` here rather than by
    `detectCycles`.
  - **`validateNodeTypes` covers region nodes.** Soft-fail. A node in a `loop` body is as
    executable as one beside it, so the warning that exists to predict `NO_EXECUTOR` went
    quiet on exactly the nodes whose run-time failure is hardest to place.
  - **`validateNodeConfigKeys` covers region nodes.** Hard-fail. `visibleIf` is the typo
    #4277 exists to catch, and moving the node into a region restored the silence #4277
    closed. Violations carry the region (`loop 'sweep' body · node 'w' …`). No
    double-reporting from the container side: all three container descriptors declare their
    region slot as a bare `nodes: { type: 'array' }` with no `items`, so the schema-lockstep
    walk stops there instead of descending twice.

  **Measured before extending the two hard-fail checks**, since widening a rejecting
  validator is a behaviour change rather than a bugfix: registering every flow in
  `app-showcase`, `app-crm` and `app-todo` through the real `registerFlow` and re-running
  each validator's own code over all 9 region graphs produced **0 new findings**. Nothing
  that registers today stops registering, so the checks land at their existing severity
  rather than staged through a warning window.

  `validateNodeInputSchemas` is deliberately **not** extended. It declares 0 uses across all
  159 example flow nodes, and its check compares a config value's runtime type against the
  declared one — so extending it would newly fail a region node carrying a `{var}` template
  string in a `number`-typed slot, which is a live authoring shape. Widening a check with a
  known false-positive mode and no demonstrated reader is not worth it; the traversal gap is
  noted on #4389 instead.

- 70a1ce1: fix(automation): the resume gate follows `map:` too, and the route stops accepting engine-internal variables (#3853)

  Two holes in the #3801 resume gate, both demonstrated with a repro.

  **1. The chain walk missed `map:`.** `resumeInternal` handles the two linked-run
  correlations oppositely — a `subflow:` pause _delegates_ the signal to the child,
  a `map:` pause _re-runs_ the map node — and the gate followed only the first. So
  a run parked on a `map` node was judged on `map` itself (`resumeAuthority: 'any'`)
  and let through even while the item it was waiting on sat on an `approval`.

  `map` is the batch-approval shape, and the map parent's run id is the one a
  launcher holds. Since `$mapState.started` is advanced past the in-flight item
  before the suspend, an empty-body resume of the parent **skipped that item's
  approval outright**, orphaning its still-pending request; a later real decision
  then bubbled into a parent already waiting on the next item, cascading the
  misalignment.

  The walk now follows both prefixes: a linked-run pause is waiting on a CHILD, so
  the child's node carries the authority — the gate reads _the item, not the loop_.

  **2. Resume `inputs` could write the engine's `$` namespace.** They are applied
  as bare flow variables, so a caller could set the exact handoff keys the engine's
  map bubble uses (`<nodeId>.$mapItemDone` / `$mapItemOutput`) and have the map
  record a per-item result for a decision nobody made — the node id is readable
  from `GET /automation/:name`. The same reached `$runId`, which `approval` /
  `wait` nodes use to correlate external state back to a run.

  `POST /automation/:name/runs/:runId/resume` now answers **400** when `inputs`
  names anything in the engine namespace (`$…`, or a `.$` segment). Enforced at the
  transport, not in the engine, so the in-process bubble keeps working — the same
  trust split the gate itself uses.

  Nothing changes for author-declared variables: `{ new_assignee: 'ada' }` and
  dotted names like `collect.note` are unaffected. If you were driving a batch-
  approval `map` by resuming the map's own run id, resume the **item's** run
  through its owning service instead (e.g. `client.approvals.approve`) — the map
  advances itself when the item completes.

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

- 72847c5: fix(service-automation): resume 时「存储不可达」的日志不再把驱动错误拼进 message,改走 meta (#5912)

  `engine.ts` 的 `resumeInternal` 在读挂起态存储失败的那一支,把**我们不控制文本**的
  数据源驱动失败原因直接插进了 `logger.error` 的 message。`ObjectLogger.write()` 一次
  调用只加一个「时间戳 + 级别」记录头,所以 message 里的换行会把**一条**记录变成多个
  物理行,后面几行既无级别也无时间戳。在 `pretty` / `text` 格式(`os dev` / `os serve`
  的默认)下,文件 sink 会把它们当成独立记录存,而 `grep ERROR` 只捞得到不含任何事实
  的那一行 —— 恰恰是运维正在找的那条。实测:一个三行的 better-sqlite3 驱动错误把这条
  告警切成 **3 个物理行**,只有第 1 行带 `ERROR` 头。

  改法与 #5048 / #5575 / #5636 / #5661 / #5737 完全同一套,零新词汇:**message 单行
  自足**,外来 cause 交给 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)
  `error(message, error?, meta?)` 的**第三**参(第二参留空,否则每条记录都会带上整个栈)。

  这是这条 resume 路径上最后一处。#5737(PR #5911)修完 `wait` 节点五处之后,同一次
  「resume 时存储不可达」会产生两条记录:wait 节点那条已是干净单行,engine 这条仍被
  切碎;本次之后两条都干净。

  对运维可见的变化(日志形状,非行为):

  - 这条记录恒为**一个**物理行,不论日志格式;
  - 原因文本从 `msg` 末尾的 `: <驱动文本>` 移到记录的 `error` 字段(`meta`),多行驱动
    错误由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
  - message 补齐了 #4632 要求的后果与修法(挂起态**未被消费**、运行仍停在原处、存储
    恢复后可原样重试),并指明 cause 在本记录的 meta 里。

  刻意**不变**的两处,已各自钉上回归测试:

  - **返回值信封** `AutomationResult.error`(`STORE_UNAVAILABLE`)仍逐字拼接驱动文本。
    它是给调用方读的结构化返回值,经 REST 出去是 JSON 字符串字段、不按行切分;#5636
    对 `degradedReason` 是同源取舍,且 PR #5911 已让 wait 节点侧把它整体放进 meta 保留。
  - **级别仍是 `error`**。运行在盘上而 resume 没落地,正是 #4632 定义的耐久性降级,
    `pnpm check:durability-log-level` 照旧覆盖。

  按记录末尾驱动文本字面量 grep 这条记录的日志查询,需要改成读记录的 `error` 字段。

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

- bdc8e70: fix(service-automation): runAs:'system' 的 create_record 按 ADR-0118 染全三列——组织、属主、创建者禁 NULL (#5494)

  修的是缺陷,不是新语义——契约是 ADR-0118(#4608)既有的:显式 `isSystem`、fail-closed、
  禁 NULL 歧义;`runAs` 声明的是授权姿态而非身份(ADR-0073 D2),提权不等于匿名。

  根因:`resolveRunDataContext` 的 system 分支把触发上下文的 `userId` / `tenantId` 整个丢弃,
  而三列的平台盖章恰好全部键在被丢弃的信息上——`created_by` 键在写上下文的 `userId`
  (ObjectQL 审计钩子)、`owner_id` 键在安全中间件的 acting user(而整条中间件含盖章步骤在
  `isSystem` 上短路)、`organization_id` 键在上下文 `tenantId`(驱动层租户机制)。于是用户
  触发的 system 清扫流程建出的每一行三列全 NULL:落在组织分区之外(唯一索引跨 NULL 不生效、
  org 作用域查询看不见),也落在所有 owner/creator 作用域授权之外——issue 里"admin 都
  403"的由来。

  修复(writer 侧,`packages/services/service-automation`):

  - system 分支把触发身份原样带过去(`userId` + `tenantId`),与 action-body 缝的
    `{ ...caller, isSystem: true }` 信封(hotcrm#548 同族修复)同形:`isSystem` 独自决定
    授权(中间件在读到 `userId` 之前就短路),身份只驱动归因盖章(`created_by`/`updated_by`、
    审计 actor)、驱动层的 `organization_id` 填充,以及下游 record-change 级联的触发身份;
  - `create_record` 对 system 运行补 `owner_id` 填充(fill-only、schema 存在才染):所有权锚
    的平台盖章在 `isSystem` 上被短路,payload 是唯一通道;染的是 acting user——与同一触发在
    `runAs:'user'` 下会得到的默认一致,不是把系统身份塞进 owner(ADR-0118 D6 / ADR-0073 D3);
  - 流程 `fields` 显式给值一律优先;真正无用户的运行(schedule)保持三列不染——没有 acting
    user 时按 ADR-0118 D1,哨兵串与伪用户都是被禁的替代品,`svc:flow:*` actor 标签 +
    `flowRunId` 继续承担溯源。

  行为变化:`runAs:'system'` 且触发上下文带 org 的运行,其数据操作在驱动层按
  `(org = 触发 org OR org IS NULL)` 作用域——与 action-body 缝一致的姿态;schedule 触发的
  运行不带 org,行为不变。

- 667b83e: feat(spec,automation): publish executor-derived config contracts for the schemaless flow nodes (#4278)

  The five descriptor-schemaless builtins (`decision` / `script` / `subflow` /
  `wait` / `connector_action`) deliberately publish no `configSchema`, so their
  Studio form lives only in objectui's hand-written `FLOW_NODE_CONFIG` table —
  and nothing reconciled that table against the executors. `script` had drifted:
  the form offered an `outputVariables` key nothing reads, two `actionType`
  options (`sms` / `notification`) that fail every run, a no-op default (`code`),
  and could not author the `function` / `inputs` / `outputVariable` path that
  works.

  New in `@objectstack/spec/automation` — contract exports only. Unlike their
  `builtin-node-config.zod.ts` siblings, which #4277 wired into execute-time
  parsing, no engine path `parse()`s node config with these: `script`'s legal key
  set depends on `actionType` and `decision` may branch purely on edge
  predicates, so a flat parse would either reject valid shapes or check nothing.
  Their enforcement is the objectui reconciliation test.

  - `ScriptConfigSchema` / `SubflowConfigSchema` / `DecisionConfigSchema` (+
    `DecisionConditionSchema`) — written from the executors in
    `service-automation`, the machine-readable half of the cross-repo
    reconciliation objectui's `flow-node-config` test now performs. `wait` and
    `connector_action` need no new schema — their contracts are the existing
    `FlowNodeSchema` sibling blocks (`waitEventConfig` / `connectorConfig`).
  - `SCRIPT_BUILTIN_ACTION_TYPES` (`['email', 'slack']`) and
    `SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` (`'invoke_function'`) — the `script`
    executor now builds its dispatch set from the published constant, so the
    designer's options, the dispatch set, and the "not a built-in action"
    failure message can no longer disagree.

  Undeclared-alias graduation in the same change (Prime Directive #12, the
  `map.flow` path): the `subflow` executor's bare `cfg.flowName ?? cfg.flow`
  fallback is deleted, replaced by the ADR-0087 D2 conversion
  `flow-node-subflow-flow-alias` — a stored `subflow` node authored with
  `config.flow` is rewritten to the canonical `config.flowName` at load
  (including the `AutomationEngine.registerFlow` rehydration seam). FROM
  `config.flow` TO `config.flowName`; one-line fix for hand-maintained sources:
  rename the key.

- f3141d8: fix(spec): a node that publishes no descriptor configSchema can now own an expression-ledger entry (#4439)

  `FLOW_NODE_EXPRESSION_PATHS` is the #4027 ledger that tells `registerFlow` and
  `objectstack validate` which config keys hold expressions, and in which dialect.
  Its ratchet (`config-expression-ledger.test.ts`) derives what it expects from
  descriptor `configSchema` `xExpression` markers, and fails in **both**
  directions — an undeclared marker, or a ledger entry nothing declares.

  `decision` / `script` / `subflow` publish **no** descriptor `configSchema` on
  purpose: a published partial schema would drop the editors their hand-written
  Studio forms need (the #4210 incident), so their contract lives in
  `schemaless-node-config.zod.ts`. Those two rules compose into a hole — an
  expression slot on a schemaless node is structurally unreachable by the ratchet,
  and because the reverse direction rejects unclaimed entries, it cannot be
  entered by hand either.

  `decision.conditions[].expression` sat in that hole. Its own schema says
  _"Bare CEL predicate deciding this branch"_ and its own comment names `{…}` as
  the #1491 trap, and no validator walked it — so `{lead_record.status} ==
'converted'` passed `tsc`, passed `objectstack validate`, passed registration.
  #4414 made that fail loudly at run time; this makes it fail at build time,
  which is the delay #4027 exists to remove.

  ## The fix

  The ratchet now reads **both** declaration channels:

  - **descriptor `configSchema`** — unchanged, enumerated from the live registry;
  - **`schemaless-node-config.zod.ts`** — the marker rides
    `.meta({ xExpression })` through `z.toJSONSchema`, the same channel
    `loop.collection` has used since objectui#2670.

  Spec hands the second channel over as JSON Schema
  (`getSchemalessNodeConfigJsonSchemas()`, memoized, `input` mode — the shape a
  descriptor's `configSchema` already is), so the ratchet walks both with the
  _same_ function. No second notion of "a declared expression property", which is
  the duplication a ledger exists to remove, and no `zod` dependency added to
  `service-automation`. Each channel is separately asserted non-empty, so a broken
  derivation on one side cannot hide behind the other's results.

  `SCHEMALESS_NODE_CONFIG_SCHEMAS` is also exported for anything else that needs
  to reason about all node config contracts. Additive — objectui's
  `flow-node-config` reconciliation imports each schema by name and is unaffected.

  ## The sweep

  The other schemaless slots were checked and deliberately carry no marker:
  `script.template` is a template **id**, not a body; `script.inputs` /
  `script.variables` / `subflow.input` are values that interpolate `{token}` —
  text-with-holes, the shape essentially every node config string has, already
  covered generically by `validate-flow-template-paths` and the CLI flow linter.
  A `flow-template` ledger entry means something narrower: a _reference that must
  resolve to a value_, like `loop.collection`. So `decision.conditions[]
.expression` is the only genuinely declared expression slot on the class — now
  recorded in the ledger's header so it is not re-derived.

  ## Docs corrected

  The flows guide taught the **wrong dialect** for decision predicates in three
  places (`'{order_amount} > 10000'`), plus a "braces missing in a decision
  expression" warning that inverted after #4414 — and `FlowNodeSchema`'s own
  `@example` did the same. All corrected to bare CEL, with the history stated so
  an author with a braced predicate knows what changed and why their build now
  fails. The dialect table drops from three dialects to two: predicates never take
  braces, values always do.

  Verified: 13 new/updated tests across the ratchet, the engine's registration
  pass and `@objectstack/lint` (including the exact app-crm predicate rejected at
  both `registerFlow` and `objectstack validate`); `pnpm build`, `pnpm typecheck`
  (122 tasks), `pnpm lint` and `check:docs` clean.

- 5a84d41: fix(automation): `resume` enforces the suspended screen's declared field contract (#4477)

  A `screen` node's `config.fields` is a complete input contract — the author
  declares the keys, their `required`-ness, and (via `visibleWhen`) when a field
  is even asked for. The RENDER half honoured all of it: the paused result and
  `GET …/runs/:runId/screen` carry `required` and `visibleWhen` intact. There was
  no VALIDATION half — `POST …/runs/:runId/resume` folded whatever bag it was
  handed straight into the flow variables, so a caller that skipped the dialog and
  posted here directly was unconstrained by every `required` the author wrote.
  Missing required fields, and keys the screen never declared, all completed the
  run with `success: true`.

  Screen flows are the one place where the declared field contract is the ONLY
  contract — no object schema sits behind a screen node to catch a bad bag
  downstream. The platform already enforces the analogous contract everywhere else
  this seam appears: action params (ADR-0104 D2), record writes (ADR-0113),
  approval `decisionOutputs` (#3447). This is that rule for screen resume, built in
  the same shape.

  `resume` now refuses a non-conforming submission with the new
  `AutomationResult.code` `'INVALID_SCREEN_INPUT'` (a transport maps it to **400**,
  as the automation domain route now does) and an `Invalid screen input: …` message
  that names each violation and lists the declared field names. The refusal happens
  BEFORE the suspension is consumed, so the pause stays live and the legitimate
  submission still lands.

  `visibleWhen` is evaluated against the SUBMITTED values first (layered over the
  run's variable snapshot), so a hidden field's `required` never fires — enforcing
  it would dead-end the run at a field the user was never shown, which is #3528
  reproduced server-side. A predicate that cannot be evaluated is logged and
  treated as hidden rather than visible: the client decides what the user saw, and
  a broken predicate is not evidence a field was on screen.

  Scope, deliberately narrow — three shapes keep the historical pass-through:

  - an **object-form** screen (`kind: 'object-form'`), whose `fields` is empty by
    construction because the client renders the object's own form and the write
    path enforces that object's `required` fields itself;
  - a **message-only** screen (`waitForInput: true`, no fields), which declares no
    keys and so constrains none — the same pass-through `enforceActionParams`
    gives a param-less action;
  - `signal.output`, the node-OUTPUT namespace, which belongs to the approval-style
    resume envelope rather than to the screen's collected-values channel.

- e218483: A failed trigger-fired flow run's `error` record now stays on one physical line: the `AutomationResult.error` envelope — which carries a failing node's / driver's text verbatim — moved from the log MESSAGE into the structured meta slot (`error` field), the same #6499/#6568 family shape, applied to the one same-class site that sweep left on the fired-run path. The message keeps its `Trigger-fired run of flow '…' failed` lead phrase and now also names the trigger type and the consequence; anything keyed on the old trailing `: [error text]` splice must read the structured `error` field instead.
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

- 9b702dc: The `wait` executor reads its declared contract only; the loose `config` back door graduates into the conversion layer (#4045).

  `wait` keeps its contract in `waitEventConfig` — a declared, `.describe()`-annotated
  block on `FlowNodeSchema` that is in the authorable-field list, reaches the generated
  reference, and is what the showcase actually authors. Its descriptor publishes no
  `configSchema`, which is by design rather than the gap it first looks like.

  The executor nevertheless also read six loose `config` keys behind `wec.X ?? loose.X`,
  two of them (`duration`, `signal`) spellings the spec never declared anywhere. That is
  the `notify.source` shape #4050 retired: a second de-facto contract announced only by a
  code comment, so an author who wrote it got a flow that worked forever and was never
  steered to the declared spelling (PD #12). Not hypothetical: the showcase's own
  `wait_revision` node authored it (`config: { eventType: 'signal', signalName: … }`) and
  moves to the declared block here.

  - New ADR-0087 D2 conversion `flow-node-wait-event-config-lift` lifts
    `config.{eventType,timerDuration,duration,timeoutMs,signalName,signal}` onto the
    declared `waitEventConfig` block, in the executor's own `??` precedence — a declared
    value wins and its loose counterpart is left shadowed, exactly as `renameConfigKey`
    treats a shadowed alias.
  - `eventType` is stamped `'timer'` whenever the lift would otherwise leave the block
    without one. This is load-bearing: the loader parses the **converted** flow
    (`applyConversionsToFlow` → `FlowSchema.parse`) and `waitEventConfig.eventType` is
    required once the block exists — so a stored flow carrying only
    `config: { duration: 'PT1M' }` would have gone from working to failing to load.
    `'timer'` is the exact default the executor applied to that shape.
  - The executor's six `?? loose.*` fallbacks are deleted. The surviving `?? 'timer'` is
    not one: `waitEventConfig` is itself optional, and a wait node without one is a valid
    timer wait.

  Verified at the real seam: the new executor tests author the legacy shape and go through
  `registerFlow`, which is what applies the conversion, so they prove the graduation
  end-to-end on a legacy source rather than only that the executor stopped looking. A
  negative control pins the `eventType` default — deleting it from the converted output
  makes `FlowSchema.parse` throw.

  Two things this deliberately does **not** change, filed as #4158 rather than fixed in
  passing: `waitEventConfig.timeoutMs` is declared as a timeout guard but read as a timer
  duration, and `waitEventConfig.onTimeout` has zero readers anywhere — so `wait` has no
  timeout implementation at all, while the showcase authors `onTimeout: 'continue'`.
  Implementing or retracting that is a behaviour change, not a contract cleanup.

- c42a19a: fix(service-automation): `wait` 节点的五条日志不再把外来 cause 拼进 message,改走 meta (#5737)

  `builtin/wait-node.ts` 里有五处记录把**我们不控制文本**的失败原因(数据源驱动、
  job 服务、`engine.resume()` 的错误信封)直接插进日志 message。`ObjectLogger.write()`
  一次调用只加一个「时间戳 + 级别」记录头,所以 message 里的换行会把**一条**记录变成
  多个物理行,后面几行既无级别也无时间戳。在 `pretty` / `text` 格式(`os dev` / `os serve`
  的默认)下,文件 sink 会把它们当成独立记录存,日志采集器读成无主碎片,而
  `grep ERROR` 只捞得到不含任何事实的那一行 —— 恰恰是运维正在找的那条。

  五处现在都改成:**message 单行自足**,外来 cause 交给 logger 的结构化参数位 ——
  按 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)选位置,`warn(message, meta?)`
  用第二参,`error(message, error?, meta?)` 用**第三**参(第二参留空,否则每条记录都
  会带上整个栈)。与 #5048 / #5575 / #5636 / #5661 完全同一套修法,零新词汇。

  对运维可见的变化(日志形状,非行为):

  - 这五条记录各自恒为**一个**物理行,不论日志格式;
  - 原因文本从 `msg` 末尾的 `Cause: …` 移到记录的 `error` 字段(`meta`),多行驱动错误
    由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
  - 消息里原本指向拼接文本的「the cause below」措辞改为指向记录的 meta;
  - 级别一律不变。其中三处是 #4632 明确定为 `error` 的耐久性诊断
    (`rearmSuspendedWaitTimers` 的 store 不可列、overdue 运行叫不醒、唤醒 job 没排上),
    仍是 `error`,`pnpm check:durability-log-level` 照旧覆盖;「无 job 服务」那条声明式
    缺失仍是 `warn`。

  按 `Cause:` 字面量 grep 这五条记录的日志查询需要改成读记录的 `error` 字段。

- ab16331: feat(spec)!: retire `waitEventConfig.timeoutMs` / `.onTimeout` — `wait` never had a timeout (#4158)

  Both keys described a timeout and neither delivered one, so protocol 17 removes the pair
  rather than leaving a promise the runtime does not keep (PD #10).

  - **`onTimeout`** had **zero** readers. No path ever inspected it, so neither `'fail'` nor
    `'continue'` ever happened — and its `.default('fail')` stamped a decision nothing made
    onto every wait node. The showcase set `onTimeout: 'continue'`, which did nothing.
  - **`timeoutMs`** said _"maximum wait time before timeout"_ while its only reader used it
    as the timer **duration** when `timerDuration` was absent. It did something, just not
    what it claimed.

  Together they declared a timeout `wait` does not have: a run resumes when its timer
  elapses or its signal arrives, never on a deadline. Real timeout semantics are left
  unimplemented deliberately — they should be built to a requirement, not retrofitted to
  fit two keys that happened to be declared.

  `timeoutMs` **converts to `timerDuration`** rather than being dropped, because that is
  what it did. It is stringified on the way: the target is `z.string()` while `timeoutMs`
  was `z.number()`, and `parseIsoDuration` reads a bare numeric string as milliseconds — so
  `timeoutMs: 60000` and `timerDuration: '60000'` are the same wait. Moving the number
  unstringified would have produced a block that no longer parses, which a test pins. With
  `timerDuration` already set it is dropped instead: the executor's `??` never looked past
  the duration, so it was already dead metadata.

  Both leave the **load path** (`retiredFromLoadPath`), which is the registry's existing
  split: a key retired for being _renamed_ keeps a load window, because punishing an author
  for a spelling nobody warned them about is pointless; a key that **misdescribed itself**
  does not, because silently absorbing it lets the author keep believing they configured a
  timeout. That is why `api.requireAuth`, the tool/app/flow inert keys and RLS `priority`
  all left it too. The migration chain converts stored sources mechanically; the schema
  tombstones name the replacement.

  One fixture interaction worth recording: the #4045 lift fixture used
  `waitEventConfig.timeoutMs` to demonstrate its fourth ledger entry, and the fixture
  harness replays the whole table — so its `after` described an end state protocol 17 makes
  unreachable. It now lifts `eventType` instead. The harness caught this itself.

- 229d29e: fix(automation): a wait node's timer wake-up no longer disarms itself when the store outage means it never woke the run (#5529)

  A timer `wait` arms one job to wake its run. That job used to disarm itself in an
  unconditional `finally` — and `AutomationEngine.resume()` reports failure by
  **returning** a code rather than throwing, so "this shot consumed the pause" and
  "this shot missed" were indistinguishable to that `finally`. Both were cancelled.

  On `STORE_UNAVAILABLE` that was a durability hole. The durable suspended-run
  store being unreadable does **not** mean the run is gone (#4420 draws exactly
  that line): the pause was never consumed, the run is still parked at its wait
  node, and its row is still there — but the one job that was ever going to wake it
  had just retired itself. Nothing then woke that run until the next process start,
  where `rearmSuspendedWaitTimers` picks it up as overdue. A store that wobbled for
  the one moment the deadline landed, plus no restart, meant a run parked forever.

  The one-shot now settles on the resume's return code:

  - **`STORE_UNAVAILABLE`** — the job stays armed, and the degradation is reported
    at `error` (this path was previously silent — the result was discarded without
    even a `warn`). The line names the job, the run, and both remedies.
  - **everything else** — cancelled exactly as before: success consumed the pause,
    `RESUME_IN_PROGRESS` means a concurrent resume is consuming it, a machine-state
    failure means there is no pause left to serve, and a thrown error is not a
    store outage.

  Keeping the job armed is **not** self-healing, and the log line says so rather
  than implying a retry: a `once` schedule is a single `setTimeout`, so it never
  re-fires on its own. What survival buys is the two things `cancel` destroys — the
  `sys_job` row stays `active` with its deadline (true, here: the run really is
  still waiting) instead of flipping to `active: false` and reading as "this
  wake-up is done", and the registration stays in the job service, so
  `trigger('flow-wait:<runId>:<nodeId>')` re-fires that wake-up once the store is
  back **without a restart**. After a cancel, `trigger` reports the job as not
  found and a restart is the only path left.

  Both sites that arm this job — the wait node's own arming path and the cold-boot
  re-arm — now share one handler, so they cannot drift, the same reason the job's
  name is a single declaration. This is separate from the `onSuspensionReleased`
  teardown added in #5512 and does not replace it: that one fires when the **run**
  leaves the node, this one when the **job** has had its single shot.

  No authoring surface changes; no flow needs editing.

- b508244: automation: a pausing node type that never declares `resumeAuthority` is now named
  at registration, and the four pausing built-ins declare theirs (#5561)

  `registerNodeExecutor` warns once per node type (per engine instance) when a
  descriptor declares `supportsPause: true` and omits `resumeAuthority` — the state in
  which the #3801 resume gate silently treats every pause that type creates as
  raw-resumable through the generic resume route. The line names the two legal values
  and says that declaring `'any'` explicitly silences it and changes no behaviour, so
  a node whose pause really is open to the route is not pushed toward `'service'` to
  quieten a log.

  `screen`, `wait`, `subflow` and `map` now declare `resumeAuthority: 'any'`
  explicitly. Each was already correct on its own terms — it was inheriting the value
  rather than stating it — so the warning names nothing on a stock boot today and only
  catches future omissions. Authority resolution is unchanged: `resolveResumeAuthority`
  still resolves an absent value to `'any'`.

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
- Updated dependencies [0f17114]
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
- Updated dependencies [d5e9f6e]
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
- Updated dependencies [cafec0a]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
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
- Updated dependencies [6965160]
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
- Updated dependencies [bf1edef]
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
- Updated dependencies [078e28b]
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
- Updated dependencies [4965bfa]
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
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Major Changes

- 0e043d8: feat(automation)!: 未声明 `resumeAuthority` 的暂停节点改为 fail-closed —— 通用 resume 路由从「默认开门」变成「显式 `'any'` 才开门」(#5561 第二步)

  <!-- adr-0087: registered action-descriptor-resume-authority-default-flip -->

  **BREAKING**(仅影响注册了暂停型节点、且描述符未声明 `resumeAuthority` 的执行器 ——
  本仓内为零)。`AutomationEngine.resolveResumeAuthority` 对缺省值的解析由 `'any'` 翻成
  `'service'`:一个从未声明「谁可以续跑它产生的暂停」的节点类型,其暂停在通用路由
  `POST /automation/:name/runs/:runId/resume` 上被拒绝(`PERMISSION_DENIED` / 403),
  直到它的描述符把话说出来。通用 resume 门从此是描述符**主动 opt-in** 的一扇门,不是每个
  暂停节点**继承**来的默认。

  这是 ADR-0044 2026-07-28 修正案里「记录但刻意不在此建造」的第一项,分两步落地。
  第一步(#5561 / PR #5725,非 breaking)把 `ActionDescriptorSchema.resumeAuthority`
  的 Zod `.default('any')` 摘成 `.optional()`。那个默认值的问题不只是取值不对,而是它
  **抹掉了事实**:`defineActionDescriptor` 在任何消费者看到对象之前就把 key 填上了,于是
  「作者选了 `'any'`」和「作者从没考虑过」parse 出逐字节相同的描述符,遗漏根本无法被观测。
  默认值摘掉之后「缺省」才重新可见,注册告警与 `check:resume-authority-declared` CI 门也
  才写得出来。第二步就是本次改动:让缺省真正意味着 fail-closed。

  ### 为什么往「拒绝」这个方向猜

  两种猜错的代价不对称,这就是全部理由。猜 `'any'`,会让一次 resume 走过一个**没有任何
  记录的决策**,而且悄无声息 —— #3823 就是这么发生的:ADR-0044 把审批的 `revise` 边指向
  了通用 `wait`,`wait` 本身声明 `'any'` 完全正确,而站在「服务持有」位置上的那个暂停
  继承了一个没人选过的 fail-open 值;实测代价是一次未经审计的重新提交,外加一个被销毁的
  远程 run。猜 `'service'`,则是返回一次拒绝,并把修好它的那一行原样交回作者手里。
  两种错误里只有一种能被犯错的人自己发现。

  ### 迁移:`resumeAuthority` 未声明 → 显式声明(一行)

  只有**注册暂停型节点的插件作者**需要动手,处方是在描述符上加一行:

  ```ts
  // FROM —— 依赖旧默认值,暂停可被通用路由续跑
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
  });

  // TO —— 通用路由确实是这个暂停的正门时(screen 式收集输入、signal wait 式外部生产者)
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
    resumeAuthority: "any",
  });

  // TO —— 续跑是「某个服务必须先授权并记录的决策」的尾巴时
  defineActionDescriptor({
    type: "my_pause",
    version: "1.0.0",
    name: "My Pause",
    supportsPause: true,
    resumeAuthority: "service",
  });
  ```

  两个值都被接受,**只有沉默改变了含义**。三条运行时通道会指着同一件事说话:注册时按类型
  去重的一次告警、resume 被拒时那条点名缺省字段并给出处方的错误消息,以及本仓自有执行器的
  `check:resume-authority-declared` CI 门。

  ⚠️ `supportsPause` 本身是一个没有任何执行路径强制的声明(#5703)—— run 会暂停是因为
  `execute()` 返回了 `suspend: true`。所以一个「会暂停但把 `supportsPause` 留成 false」
  的执行器,注册告警与 CI 门**都看不见它**,只有 resume 时的拒绝消息会带上同一份处方。
  请按同一条规则手工核一遍这类执行器。

  ### 仓内零行为变化

  在册的六个暂停类型全部已显式声明:`screen` / `wait` / `subflow` / `map` 声明 `'any'`
  (第一步补齐),`approval` / `approval_revise` 声明 `'service'`。解析器测试与端到端测试
  都把这份清单和它们的解析结果一起断言 —— 一个只靠「什么都没注册」而变绿的零点名,和真的
  零点名是两回事。

  `@objectstack/runtime` 只是注释与路由账本(`route-ledger`)的记述同步,无行为改动。

### Minor Changes

- 050cd82: feat(spec,service-automation): a flow variable can declare a `defaultValue`, so "declared" means "bound" (#4697)

  Declaring a flow variable used to guarantee nothing at run time. The engine bound
  an `isInput` variable **only** when the caller actually supplied it
  (`params[name] !== undefined`), so every path that omitted the parameter left the
  name unbound — and a flow condition is strict CEL, where an unbound name does not
  read as `false`, it **aborts the predicate and stops the run**. The declaration was
  documentation, not a guarantee, and there was no metadata form that said "this
  variable always has a value".

  `FlowVariableSchema` now takes an optional `defaultValue`, and the engine binds it
  whenever no parameter supplies one:

  ```typescript
  variables: [
    {
      name: "createOpportunity",
      type: "boolean",
      isInput: true,
      defaultValue: false,
    },
  ];
  ```

  The rules:

  - **A supplied parameter always wins**, including a falsy one — the boundary is
    `!== undefined`, so `false`, `null`, `0` and `''` are answers rather than
    absences, and only a genuinely missing parameter falls through to the default.
  - **A non-input declaration takes its default too.** `isInput: false` means no
    parameter can reach the name, so the default is the only thing that can bind it.
  - **A declared variable shadows a trigger-record field of the same name**, whether
    it was bound from a parameter or from its default — the rule a parameter already
    followed. A name cannot resolve out of a different source depending on whether
    the caller passed it.

  Both run entry points seed from one shared site, so the retry path behaves
  identically to the first attempt.

  **Additive and opt-in.** A declaration without `defaultValue` behaves exactly as
  before, so existing flows parse and run unchanged. The value is not cross-checked
  against the declared `type` — `type` is an open string with no vocabulary to check
  against, the same posture as every other `defaultValue` on the authoring surface.

  The case this closes came from a screen flow (hotcrm#643): a screen collects an
  optional checkbox, the client returns only the fields the user actually touched,
  so on the untouched path the variable was never bound, the outgoing edge aborted,
  and a lead conversion persisted nothing. The workaround was an `assignment` node
  before every screen mirroring the screen field's own `defaultValue`; a declared
  default replaces that ceremony.

  The docs half of the same gap is now written down too
  (`content/docs/automation/flows.mdx`): under strict CEL the guard an author
  reaches for first — `has(X.f)` — **aborts** on an unbound `X`, the very case it is
  written for. Only the `vars.`-scoped `has(vars.X)` tests bindedness. That truth
  table is measured against the live evaluator in
  `service-automation/src/flow-variable-default.test.ts` rather than asserted, so a
  prescription nothing executes cannot quietly stop being true. Prefer
  `defaultValue` over either guard: a guard encodes "unanswered means no" into the
  predicate and leaves the graph defect in place.

- 42da73d: fix(spec): `notify.severity` closes its declared `info | warning | critical` vocabulary at the gate, not only in its describe (#7086)

  <!-- adr-0087: not-required (no-migration-prescription) A stored flow is unaffected at LOAD: `FlowNodeSchema.config` is `z.record(z.string(), z.unknown()).optional()`, so `NotifyConfigSchema` runs only at EXECUTE time via `parseNodeConfig` — nothing fails to load or rehydrate, which is the population a D2 conversion exists to protect. And no automatic rewrite is correct here: mapping a stored `'urgent'` to `'info'` would silently pick a severity on the author's behalf, which is precisely the blind-cast defect this change removes. The refusal names the three legal values, so the author reconciles it once and keeps their intent. Re-measured across the monorepo: zero out-of-vocabulary spellings in any flow, example, fixture or seed. -->

  `NotifyConfigSchema.severity` was a bare `z.string()` whose `.describe()` read
  `'info | warning | critical'` — no "e.g.", no qualifier. In this codebase that
  spelling is how a genuine closed vocabulary is documented, so the enumeration
  existed only in the sentence. Measured on `origin/main` before the change:

  ```
  severity "info"  -> ACCEPTED    severity "urgent" -> ACCEPTED
  severity "warning"  -> ACCEPTED    severity "INFO"   -> ACCEPTED
  severity "critical" -> ACCEPTED    severity ""       -> ACCEPTED
  ```

  **Every other surface already declared the set closed**, which is what made the
  open gate a defect rather than a design choice: the `notify` executor forwards
  the value raw, the messaging dispatcher blind-casts it into the closed union
  (`severity: (p.severity as Notification['severity']) ?? 'info'`), and
  `sys_inbox_message.severity` is a select field offering exactly these three. So
  `severity: 'urgent'` parsed green, published green, and landed in inbox rows
  under a TypeScript type that says the value cannot exist — falling through every
  downstream `switch` on the three names. An author (very often an AI) who wrote
  `Critical` or `urgent` got no diagnostic anywhere on the path.

  The gate is now `z.enum(['info', 'warning', 'critical']).optional()`, and the
  describe is a sentence about the field, because the vocabulary is carried by the
  type — the generated reference renders it as an enum column instead of a bare
  `string`. The refusal is self-prescribing:

  ```
  Invalid option: expected one of "info"|"warning"|"critical"
  ```

  **Why closing this gate takes no working authoring shape with it.** The executor
  reads `severity` **raw** — it is one of the three keys (`channels`, `topic`,
  `severity`) that never pass through `interpolate()` — so a `{record.x}` template
  there was forwarded verbatim and never resolved. The schema's module JSDoc
  claimed "every string-ish value except `channels`" is interpolated; that was
  stale for `topic` and `severity`, and it is corrected here, since it is the
  statement the safety of this tightening rests on.

  **Blast radius is an execute-time refusal, not a load failure.** `FlowNodeSchema.config`
  is an untyped record, so a stored flow carrying `severity: 'urgent'` still loads
  and rehydrates exactly as before; the `notify` step refuses when it runs, naming
  the three legal values. `''` previously degraded to `info` two layers down and is
  now refused at the gate.

  The `notify` descriptor's Studio form is closed in the same change
  (`enum: ['info', 'warning', 'critical']`). Closing only the Zod would have left
  the mirror-image drift the IO-node ledger test exists to prevent — a form
  inviting a value the gate refuses at execute time — and the `screen` node's
  `mode` is the in-repo precedent for enum-on-both-sides. That ledger test compared
  key SETS only, which is the gap this field sat in; it now also reconciles closed
  value vocabularies, so the two descriptions cannot drift apart again.

### Patch Changes

- e5bd768: refactor(spec)!: retire `ActionDescriptor.isAsync` — a second spelling of `supportsPause` that nothing ever read (#6748, ADR-0049)

  <!-- adr-0087: registered action-descriptor-is-async-retired -->

  **FROM → TO:** `isAsync: true` → delete the key; declare `supportsPause: true` (plus the
  `resumeAuthority` its pauses need) and return `suspend: true` from `execute()`.
  `isAsync: false` → delete the key; there was never anything to preserve.

  `ActionDescriptor.isAsync` declared "suspends the flow awaiting an external reply" and no
  execution path read it. Measured fresh before removal across all three repos — objectstack,
  objectui and cloud — with zero property reads: every hit was the declaration itself, a
  generated baseline, one of five shipped descriptors WRITING it, a fixture pinning the
  shape, or prose. Declaring it never made a node suspend; omitting it never stopped one.

  This is the remove leg of the ADR-0049 disposition its sibling took the other way. The two
  keys said the same thing — "this node type can suspend the run" — and #6667 split them by
  evidence: `supportsPause` became an enforced fact (`AutomationEngine` now refuses a
  suspension whose type does not declare it, at the one seam every suspension passes
  through), while `isAsync` had no consumer to grow into. Keeping both would leave the
  platform publishing two names for one capability with only one of them honoured — and
  `screen` declared BOTH, so a plugin author copying it had no way to tell which.

  The retirement kit:

  - **Tombstone, not deletion** (`retiredKey()`): `ActionDescriptorSchema` is not `.strict()`,
    so a plain delete would let existing descriptors parse clean and lose the key in silence
    (the ADR-0104 shape). Authoring `isAsync` now fails `tsc` at the descriptor literal and
    fails the parse inside `defineActionDescriptor()` — with the prescription in the message.
  - **ADR-0087 D3 `SemanticMigration`** (`action-descriptor-is-async-retired`) plus the exact
    `RETIRED_KEYS_BY_MAJOR` entry. No D2 conversion, deliberately: a descriptor is published
    from an executor's TypeScript and never stored in stack metadata, so there is no source
    for `os migrate meta` to rewrite — the `EnhancedApiError.fieldErrors` disposition.
  - The five shipped writers stop writing it (`screen`, `map`, `wait`, `approval`,
    `approval_revise`); the descriptors they publish lose the key, which is why the two
    runtime packages appear here.
  - Generated baselines (`authorable-surface/automation.json` gains `[RETIRED]`,
    `authorable-defaults/automation.json` loses the default line), `spec-changes.json`, the
    upgrade guide and the reference docs regenerated.

  No runtime behaviour changes — that impossibility is the reason for the removal. The same
  commit also corrects `supportsPause`'s TSDoc, which still described itself as a declaration
  no execution path reads; #6667 made that false (#6749).

- 6517448: fix(service-automation): 降级版挂起态读取器的「存储读不到」告警不再把驱动错误拼进 message,改走 meta (#6230)

  `engine.ts` 的 `loadSuspendedRun` —— `loadSuspendedRunStrict` 的**降级版**读取器 ——
  在 catch 里把**我们不控制文本**的数据源驱动失败原因直接插进了 `logger.warn` 的 message。
  `ObjectLogger.write()` 一次调用只加一个「时间戳 + 级别」记录头,message 里的换行会把
  **一条**记录变成多个物理行,后面几行既无级别也无时间戳。

  这条比 #5912(PR #6228)刚治完的那条**多一层危害**:`ObjectLogger` 把 `warn` 路由到
  **stdout**,而 `serve` 的 boot-quiet 窗口只包了 `process.stdout.write`,其
  `BootLogCapture.offer()` 仅在该物理行带级别头时才保留 —— 所以无头续行是被**直接丢弃**,
  不只是被误读。而它在 boot 期真实可达:`plugin.ts` 的 `start()` → `rearmSuspendedWaitTimers`
  → 对 overdue 运行 `engine.resume()` → `resume()` 的授权 gate 走的正是这个降级版读取器。

  实测:一个三行的 better-sqlite3 驱动错误把这条告警切成 **3 个物理行**,过 boot 缓冲的
  过滤后**只剩 1 行**留下 —— 而留下的那一行恰恰不含任何驱动事实。

  改法与 #5048 / #5575 / #5636 / #5661 / #5737 / #5912 完全同一套,零新词汇:**message
  单行自足**,外来 cause 交给 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)
  `warn(message, meta?)` 的**第二**参 —— 注意与 `error(message, error?, meta?)` 的第三参
  不同,`warn` 没有 `Error` 槽。

  对运维可见的变化(日志形状,非行为):

  - 这条记录恒为**一个**物理行,不论日志格式,boot-quiet 窗口内不再丢字节;
  - 原因文本从 `msg` 末尾的 `: <驱动文本>` 移到记录的 `error` 字段(`meta`),多行驱动
    错误由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
  - message 补上了这条降级的**后果**:读失败被翻译成 `null`,调用方(resume gate、screen
    取数)看到的与「本来就没有这个挂起运行」完全一样,而运行本身未被触碰、仍停在原处;
    原文本只说了「读失败」,没说读失败被翻译成了什么。

  刻意**不变**的一处,已钉上回归测试:**级别仍是 `warn`**。这是一个刻意的**功能性**降级
  读取器(注释写明它服务于只需要 best-effort 答案的顺带读取方),真正需要区分「存储挂了」
  与「运行没了」的 `resumeInternal` 用的是严格版 —— 按 #4632 的判据这不是耐久性降级,
  上调到 `error` 才是该规则的镜像误用(整个故障期间每次 gate 查询都报警)。

  按记录末尾驱动文本字面量 grep 这条记录的日志查询,需要改成读记录的 `error` 字段。

- 0fd8556: feat(spec,objectql): `DroppedFieldsEvent.reason` names the dispatch-ruled id strip (#6437)

  The write path's strip-observability seam declared a narrower vocabulary than
  the strips it reports on. `DroppedFieldsEvent.reason` was a closed enum over the
  two READ-ONLY strips (`readonly` #2948 / `readonly_when` #3042), so the
  primary-key strip added by #6262 / PR #6433 (multi branch) and #6435 (by-id
  branch) — a `data.id` the update dispatch has ALREADY RULED is not a primary
  key, removed from the SET payload before it can overwrite the targeted rows'
  identity — was invisible to `onFieldsDropped` and to `strictReadonlyWrites`.
  Both PRs were right to refuse the alternative: force-fitting `readonly` would
  make `reason` lie, which is worse than silence. This adds the value instead.

  **New reason: `primary_key`.** It names the FIELD's role, not the offending
  value's shape, so it stays true if the strip ever widens to the same-value
  truthy-scalar no-op the engine deliberately leaves alone today —
  `not_a_primary_key` would describe the value and become false that day. The
  house rule it follows is #5503's, applied in the other direction: a new arm is
  warranted exactly when no existing arm is truthful. #5503 reported the
  implicitly-readonly runtime-owned strip as plain `readonly` because that _was_
  true of it; `readonly` is not true of an `id` (a truthy scalar `id` writes
  fine), so this one gets its own value.

  **⚠️ Behaviour change, deliberate and measured: `strictReadonlyWrites` gains a
  new refusal.** The option's contract says it covers "every drop
  `onFieldsDropped` reports" — coverage DERIVED from the reported set, never an
  enumeration frozen at #5126, and confirmed by reading `reportDroppedFields` on
  `main`, whose `strictDrops.push` applies no reason-class filter. So reporting a
  new reason necessarily refuses it. A caller that passes
  `strictReadonlyWrites: true` **and** puts a ruled-non-key value in `data.id` now
  gets `ERR_READONLY_FIELD_REJECTED` where it previously got a success whose `id`
  had been silently dropped. That is the option's whole promise ("don't
  half-apply my payload") reaching one more strip class, and it is the outcome the
  flag's own doc now states. Nothing else moves: default-mode callers still get a
  successful write plus an event, the strip itself is unchanged, and
  `strictReadonlyWrites` is in-process only (`WriteObservabilityOptions`), so no
  REST/wire caller can reach either behaviour.

  **The refusal error no longer describes every rejection as read-only.**
  `ReadonlyFieldRejectedError` composed one sentence ("… are read-only and would
  have been stripped", remedied by `{ context: { isSystem: true } }`) that is
  false for a `primary_key` drop — `isSystem` does not exempt that strip. The
  message is now built from the `drops` breakdown the error already carried, so it
  names each reason against its own fields and offers the right remedy. The
  **read-only-only message is byte-identical** to #5126's / #5503's text (pinned
  directly), the error `code` is unchanged, and adding a reason deliberately does
  not add an error code: callers catch one code and read `drops`.

  Consumers that branch on `reason` were swept. `service-automation`'s flow-step
  warning map is a `Record<DroppedFieldsEvent['reason'], string>`, so tsc demanded
  the new wording — the loud shape, kept that way on purpose. The protocol
  responses that carry `droppedFields` (`api/batch.zod.ts`, `api/protocol.zod.ts`
  ×3, plus the cross-object batch extension) all derive from
  `DroppedFieldsEventSchema` and widen transitively; REST's
  `X-ObjectStack-Dropped-Fields` header is generic over the reason and needed no
  change. One consumer does NOT widen safely and is filed rather than fixed here:
  objectui's `writeWarningToast` picks its wording with a binary ternary whose
  `else` arm would announce a stripped `id` as "Read-only" (objectui#3935).

- c308064: Enforce `ActionDescriptor.supportsPause` at the engine boundary: an executor whose
  `execute()` returns `suspend: true` while its descriptor declares `supportsPause: false`
  is now refused instead of pausing the run (#6667, from #5703).

  `supportsPause` used to be read only at authoring time — the designer palette, the
  registration warning, and the `check:resume-authority-declared` CI gate, all of which key
  on `supportsPause: true` and so were silent on exactly this mismatch. The pause it let
  through was already broken, just later and elsewhere: a type that declares no pause
  declares no `resumeAuthority` either, and since #5561 an unclaimed pause is fail-closed,
  so the run parked on a durable continuation that the generic resume route then refused
  with `PERMISSION_DENIED` — a message naming `resumeAuthority`, not the `supportsPause`
  that actually caused it. The refusal fails the run where the mistake was made, writes no
  continuation, and names the one-line fix.

  Behaviour change for third-party executors in that state (no built-in is: all six pausing
  built-ins declare `supportsPause: true`). The refusal is guard-class, so a `fault` edge
  does not route it — a wrong declaration is not a condition a re-run can fix. Two shapes
  are deliberately untouched: declaring `supportsPause: true` and never suspending is legal
  (a capability, not an obligation), and an executor that publishes no descriptor at all
  declares nothing to enforce — its pauses stay governed by the #5561 resume gate.

- 24122a9: fix(service-automation): the 13 residual `engine.ts` seams stop splicing uncontrolled thrown text into log messages, plus the one self-authored multi-line message; run-history persist failure is re-graded `error` (#6499)

  #6299 / PR #6498 fixed three `engine.ts` seams and closed with "this file is now
  clean"; #6499 is the corrective record: 13 more logger calls in the same file
  still interpolated a thrown value's `.message` — a datasource driver's, a
  plugin's (trigger / node-executor), or, second-hand via the
  `AutomationResult.error` envelope, a failing node's — into the log MESSAGE.
  `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so a cause
  carrying newlines turned ONE record into several physical lines of which only
  the first is greppable, and `serve`'s boot-quiet window drops the headless
  continuations outright on the stdout (warn) path. All 13 now log a single-line
  message stating the site's own consequence and hand the cause to the logger's
  structured slot (`describeThrownForLog`).

  A 14th site with the opposite cause is fixed alongside, argued on its own
  terms: `validateFlowExpressions`' advisory schema pass authored a literal
  `\n      source: …` continuation into a message we control, with the flow
  author's (newline-tolerant CEL) expression as the second line. The message now
  stays one line; the expression source rides the structured slot (`source`).

  The level was judged per seam (#4632), not batch-copied:

  - **`recordLog`'s fire-and-forget `store.recordTerminal` → RAISED to `error`.**
    The write half of the run-history claim: a TERMINAL run's history row failed
    to land while the run completed and every caller reads healthy — nothing
    retries it, nothing upstream is told. After the next restart the run is
    invisible to the Runs surfaces, `inspectStrandedRequests` (#3456) reads
    "no suspension + no terminal row" as a STRANDED approval, and
    `releasePendingForTerminalRuns` (#4469) reads "no terminal row" as
    still-alive, so a finished run's leftover pending approvals are never
    auto-released.
  - **`persistSuspendedRun` stays `error`** (#4460's raise; #4420 is this exact
    seam's accident) — no re-grade, message and slot fixed only.
  - **Everything else stays `warn`** (functional): `listRuns` / `getRun`
    (observability reads degrading to ring buffer / null — each record now says
    the caller cannot tell the degraded answer from a real one), the four
    plugin-supplied seams (`releaseSuspension`, `unregisterTrigger`,
    `activateFlowTrigger`, `deactivateFlowTrigger`), the grants resolver, lookup
    expansion, the screen `visibleWhen` probe, and both `bubbleToParent`
    branches. Nothing these degrade claims to be persisted.

  Operator-visible: one record moves from stdout/`WARN` to stderr/`ERROR`
  (run-history persist failure), and the reworded messages keep their original
  lead phrases (`run-history read failed`, `durable run lookup failed`,
  `Failed to bind flow`, `could not resolve grants`, …) so existing greps still
  match; alert rules keyed on the trailing `: <error text>` splice need the
  structured `error` / `source` / `visibleWhen` fields instead.

- b0d54bf: fix(service-automation): the last three `engine.ts` seams stop splicing a driver's failure into the log message, and two of them are re-graded `error` (#6299)

  All three catches sit around the `SuspendedRunStore` driver and rendered their
  failure by interpolating the thrown value's `.message` into the log MESSAGE.
  `ObjectLogger.write()` adds exactly one `<ts> <LEVEL>` head per call, so a
  driver error carrying newlines turned ONE record into several physical lines of
  which only the first was greppable — and on the `warn` path, inside `serve`'s
  boot-quiet window, `BootLogCapture.offer()` keeps only lines with a level head,
  so the continuation lines were dropped outright. Measured on the restored
  concatenation: a three-line driver error became 3 physical lines and the boot
  filter retained 1, and that one carried no driver fact. The cause now goes to
  the logger's structured slot (`describeThrownForLog`), so the record stays on
  one physical line in every format. This closes the family of #5048 / #5575 /
  #5636 / #5661 / #5737 / #5912 / #6230 for this file.

  The level was judged per seam (#4632), not batch-copied from #6230:

  - **`forgetSuspendedRun` → raised to `error`.** The hot cache is dropped before
    the store delete and this is the single choke point every consumption of a
    suspension passes through, so a failed `delete` leaves the suspension gone
    in-process and the durable row alive. Callers still report success, and the
    surviving row is re-listed and re-resumed after the next restart, running a
    continuation that already ran.
  - **`cancelRun` → raised to `error`.** An unreadable store makes the failed read
    read as "no such suspended run", so the method returns `false` — which its
    contract calls idempotent success — and the cancellation is silently skipped
    while the call reads clean. The run stays parked and durably resumable.
  - **`listSuspendedRunsDurable` → stays `warn`.** Nothing claimed-persisted
    failed to land: the rows are intact and still resumable by id. The listing
    degrades to the in-memory cache alone, so the message now says out loud that
    the result is short and that the caller cannot tell.

  Operator-visible: two records move from stdout to stderr and from `WARN` to
  `ERROR`, and all three messages are reworded to state their consequence. Log
  filters or alert rules keyed on the old `warn`-level text for a failed
  suspended-run delete or cancel need updating.

- 4d552af: feat(spec)!: `FlowNodeSchema` parses its own ADR-0031 regions — the post-parse pass retires (#4415)

  `FlowSchema.parse` normalized a flow's own `nodes[]` / `edges[]` but could not reach a
  **region**, because a region lives inside `FlowNodeSchema.config` — a deliberately open
  `z.record` (ADR-0018). #4381 closed the resulting gap with a **post-parse pass**,
  `normalizeControlFlowRegions`, that every caller had to remember to run:

  ```ts
  const flowShell = FlowSchema.parse(converted);
  validateControlFlow(flowShell);
  const parsed = normalizeControlFlowRegions(flowShell); // ← had to remember
  ```

  That is an unwritten rule on top of a parse, and it is exactly the condition the #4347
  family of defects grows in: a new consumer — a Studio publish path, an MCP tool, a bulk
  validation script — takes a `FlowParsed` and uses it, holding a **half-parsed flow that
  looks finished**. Nested edge predicates were still bare strings, nested nodes had not been
  through `.strict()`, and nothing said so.

  Now the schema does it. `FlowNodeSchema` carries a `.transform()` that parses each declared
  region slot — `loop.config.body`, `parallel.config.branches[]`, `try_catch.config.try` /
  `.catch` — through the schema that slot's value _is_. Nesting needs no manual recursion: a
  region's `nodes` are `z.array(FlowNodeSchema)`, so Zod re-enters the transform on the way
  down. **"Parsed" now means parsed at every depth** (Prime Directive #1), from any entry
  point — including `FlowNodeSchema.parse(node)` on a single node, which the old whole-flow
  pass could not serve at all.

  ## Migration

  **`normalizeControlFlowRegions` is removed from `@objectstack/spec/automation`.** Delete the
  call; the parse above it already did the work:

  ```diff
    const parsed = FlowSchema.parse(converted);
    validateControlFlow(parsed);
  - const normalized = normalizeControlFlowRegions(parsed);
  ```

  Its replacement, `parseFlowNodeRegions(node)`, is exported for the same purpose one node at
  a time, but you should not normally need it — it is the transform's own body.

  **`FlowNodeSchema` is now a `ZodPipe`, not a `ZodObject`,** so it no longer has `.shape` /
  `.extend()` / `.pick()`. `z.infer` / `z.input` / `.parse` / `.safeParse` and
  `z.toJSONSchema` are unaffected, and the authorable key set is byte-identical (verified by
  `check:authorable-surface`). If you were reaching for the object half, read it from the
  pipe's input side — `FlowNodeSchema.def.in` — which is also what the repo's own generators
  do (`pipeAuthorableSide` in `scripts/lib/zod-graph.ts`).

  One visible consequence in the generated reference: `content/docs/references/automation/flow.mdx`
  now renders FlowNode's **input** shape, so keys carrying a `.default()` (`boundaryConfig.interrupting`,
  `inputSchema[].required`) show as optional. That is what an author actually writes, which is
  what an authoring reference should say.

- cfeb9a0: fix(service-automation): the five NAME-shaped log splices stop interpolating foreign identifiers into log messages (#6654)

  The tail #6499 reported but did not fix and #6587 deliberately excluded: five
  `service-automation` log records still spliced **names/identifiers** that
  originate outside the engine's control and are not schema-constrained to reject
  newlines. `ObjectLogger.write()` adds one `<ts> <LEVEL>` head per call, so a
  newline in any of them turns ONE record into several physical lines of which
  only the first is greppable, and `serve`'s boot-quiet window drops the headless
  continuations outright on the stdout (warn) path — the same downstream damage as
  the closed thrown-text class, reached through a different door.

  All five now log a single-line message carrying only controlled facts, with the
  foreign identifier(s) in the logger's structured slot:

  - the **re-entrancy guard** — the caller's record id → `recordId`;
  - the **refused resume** — the caller's resume-signal keys → `rejected`;
  - the **screen-input refusal** — the user-submitted keys, which reach the
    message via `validateScreenInputs`' `Unknown screen field "…"` findings →
    `issues` (the message now states the issue COUNT);
  - **`warnUnknownNodeTypes`** — the flow's unknown node type names and the
    registered vocabulary → `unknownTypes` / `knownTypes`;
  - the **unclaimed branch label** (#4414) — the computed, potentially
    record-derived branch label and the out-edge labels → `branchLabel` /
    `outEdges`.

  **No level changes**: every one of the five is #4632-FUNCTIONAL and stays
  `warn`. Behaviour is unchanged at all five sites, and the caller-facing refusal
  ENVELOPES (`INVALID_SIGNAL`, `INVALID_SCREEN_INPUT`) are untouched — they still
  name the offending variables and fields, because an envelope is not a log
  record.

  Operator-visible: each message keeps its lead phrase so existing greps still
  match — `re-entered for the same record`, `signal writes engine-internal`,
  `violates its declared field contract`, `no registered executor or descriptor`
  (load-bearing: tests and log filters count per-flow findings by it), and
  `no out-edge carries that label`. Anything keyed on the spliced identifier
  inside those messages must read the structured field instead.

- ce15dc3: Align the `notify` node's Studio form-descriptor strings with the schema's actual acceptance behaviour (docs-only; no acceptance or `configSchema` key/type/required change):

  - `sourceObject` / `sourceId` no longer say "Requires sourceId." / "Requires sourceObject.". Both are optional and the executor drops a half-specified click-through target at execute time (so the inbox never renders a dead link) — the descriptions now state that tolerance instead of a phantom requirement, mirroring the `NotifyConfigSchema.sourceObject`/`sourceId` `.describe()` wording fixed in #7085 (PR #7111). (#7112)

- 72847c5: fix(service-automation): resume 时「存储不可达」的日志不再把驱动错误拼进 message,改走 meta (#5912)

  `engine.ts` 的 `resumeInternal` 在读挂起态存储失败的那一支,把**我们不控制文本**的
  数据源驱动失败原因直接插进了 `logger.error` 的 message。`ObjectLogger.write()` 一次
  调用只加一个「时间戳 + 级别」记录头,所以 message 里的换行会把**一条**记录变成多个
  物理行,后面几行既无级别也无时间戳。在 `pretty` / `text` 格式(`os dev` / `os serve`
  的默认)下,文件 sink 会把它们当成独立记录存,而 `grep ERROR` 只捞得到不含任何事实
  的那一行 —— 恰恰是运维正在找的那条。实测:一个三行的 better-sqlite3 驱动错误把这条
  告警切成 **3 个物理行**,只有第 1 行带 `ERROR` 头。

  改法与 #5048 / #5575 / #5636 / #5661 / #5737 完全同一套,零新词汇:**message 单行
  自足**,外来 cause 交给 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)
  `error(message, error?, meta?)` 的**第三**参(第二参留空,否则每条记录都会带上整个栈)。

  这是这条 resume 路径上最后一处。#5737(PR #5911)修完 `wait` 节点五处之后,同一次
  「resume 时存储不可达」会产生两条记录:wait 节点那条已是干净单行,engine 这条仍被
  切碎;本次之后两条都干净。

  对运维可见的变化(日志形状,非行为):

  - 这条记录恒为**一个**物理行,不论日志格式;
  - 原因文本从 `msg` 末尾的 `: <驱动文本>` 移到记录的 `error` 字段(`meta`),多行驱动
    错误由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
  - message 补齐了 #4632 要求的后果与修法(挂起态**未被消费**、运行仍停在原处、存储
    恢复后可原样重试),并指明 cause 在本记录的 meta 里。

  刻意**不变**的两处,已各自钉上回归测试:

  - **返回值信封** `AutomationResult.error`(`STORE_UNAVAILABLE`)仍逐字拼接驱动文本。
    它是给调用方读的结构化返回值,经 REST 出去是 JSON 字符串字段、不按行切分;#5636
    对 `degradedReason` 是同源取舍,且 PR #5911 已让 wait 节点侧把它整体放进 meta 保留。
  - **级别仍是 `error`**。运行在盘上而 resume 没落地,正是 #4632 定义的耐久性降级,
    `pnpm check:durability-log-level` 照旧覆盖。

  按记录末尾驱动文本字面量 grep 这条记录的日志查询,需要改成读记录的 `error` 字段。

- e218483: A failed trigger-fired flow run's `error` record now stays on one physical line: the `AutomationResult.error` envelope — which carries a failing node's / driver's text verbatim — moved from the log MESSAGE into the structured meta slot (`error` field), the same #6499/#6568 family shape, applied to the one same-class site that sweep left on the fired-run path. The message keeps its `Trigger-fired run of flow '…' failed` lead phrase and now also names the trigger type and the consequence; anything keyed on the old trailing `: [error text]` splice must read the structured `error` field instead.
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
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [d5e9f6e]
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
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
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
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

## 17.0.0-rc.5

### Minor Changes

- e8f8f6c: feat(integration): 连接器动作可以声明它在上游做了什么，`connector_action` 因此能被计数 (#4395)

  #4354 给每次流程运行加上了 `selected` / `acted` 汇总，断扫告警是
  `selected > 0 AND acted = 0 AND unmeasured = 0`。`connector_action` 当时只能给出三个
  答案里最诚实的那个：`ConnectorActionSchema` 只描述动作的**形状**（`key` / `label` /
  `inputSchema` / `outputSchema`），对它究竟读还是写只字未提，所以 `crm.push_opportunity`
  和 `crm.lookup_account` 在运行时完全无法区分。`acted: 0` 会低报一次 Salesforce 创建，
  让每一条健康的连接器扫描都触发告警，操作员很快学会忽略它；`acted: 1` 会高报一次查询，
  让告警永不触发——那正是 #4354 要修的原始 bug 换个楼层重演。于是执行器报
  `metrics: { unmeasuredEffect: true }`，运行汇总记一笔 `unmeasured`。

  诚实，但也是盲区：**任何走连接器的自动化流程都贡献不出任何信号**——既无法证明自己
  干过活，也无法在停止干活时被标记出来。

  **现在动作可以自己声明。** `ConnectorActionSchema` 新增可选的 `effect`：

  ```ts
  actions: [
    { key: "push_opportunity", label: "Push Opportunity", effect: "write" },
    { key: "lookup_account", label: "Lookup Account", effect: "read" },
    { key: "legacy_action", label: "Legacy" }, // 不声明 —— 行为完全不变
  ];
  ```

  `connector_action` 执行器据此计数：声明 `write` 且派发成功 → `acted: 1`；声明 `read`
  → `acted: 0`（这是一个**真实测得的零**，不是耸肩，所以只做查询的流程重新落入断扫告警
  的射程）；不声明 → 维持原样 `unmeasuredEffect`。派发失败时，声明 `write` 的动作回落为
  不可计数而非零——处理器抛错时上游可能已经写成了，这与 `http` 节点对被拒绝的写请求做的
  判断一致；声明 `read` 的动作则仍报 `acted: 0`，它无论如何都不可能改动任何东西。

  声明是可选的，这是有意为之：**已有的连接器一个字都不用改，报告的内容与之前逐字相同**，
  声明它是纯增益而不是一次迁移。`unmeasuredEffect` 的含义和消费者一个都没变，它现在是
  兜底而不是唯一答案。

  同一个声明也随 `ConnectorActionDescriptor` 一路送到设计器：`GET /api/v1/automation/connectors`
  现在会带上 `effect`，作者在流程设计器里挑动作时，"这个会写" 是关于这次选择的事实。

  `effect` 落在**可作者化的** `ConnectorActionSchema` 上，而不只是描述符接口上，因为那是
  唯一可能的产地：`AutomationEngine.registerConnector` 存的是 `ConnectorSchema.parse(def)`
  的结果，描述符是从这份 def 投影出来的。插件注册路径和 ADR-0097 声明式 materialization
  路径都经过这一次 parse，所以两条路都能声明；只加在描述符上则永远无法被任何东西填充
  （`ConnectorSchema` 是非 strict 的 `z.object`，改动前作者写下的 `effect` 会被静默丢弃）。

  bulk 场景的**计数型**效果（一次动作报告它在上游碰了多少条记录）暂不做，等真实需求。
  读/写这一刀才是解开告警的那一刀。

### Patch Changes

- bdc8e70: fix(service-automation): runAs:'system' 的 create_record 按 ADR-0118 染全三列——组织、属主、创建者禁 NULL (#5494)

  修的是缺陷,不是新语义——契约是 ADR-0118(#4608)既有的:显式 `isSystem`、fail-closed、
  禁 NULL 歧义;`runAs` 声明的是授权姿态而非身份(ADR-0073 D2),提权不等于匿名。

  根因:`resolveRunDataContext` 的 system 分支把触发上下文的 `userId` / `tenantId` 整个丢弃,
  而三列的平台盖章恰好全部键在被丢弃的信息上——`created_by` 键在写上下文的 `userId`
  (ObjectQL 审计钩子)、`owner_id` 键在安全中间件的 acting user(而整条中间件含盖章步骤在
  `isSystem` 上短路)、`organization_id` 键在上下文 `tenantId`(驱动层租户机制)。于是用户
  触发的 system 清扫流程建出的每一行三列全 NULL:落在组织分区之外(唯一索引跨 NULL 不生效、
  org 作用域查询看不见),也落在所有 owner/creator 作用域授权之外——issue 里"admin 都
  403"的由来。

  修复(writer 侧,`packages/services/service-automation`):

  - system 分支把触发身份原样带过去(`userId` + `tenantId`),与 action-body 缝的
    `{ ...caller, isSystem: true }` 信封(hotcrm#548 同族修复)同形:`isSystem` 独自决定
    授权(中间件在读到 `userId` 之前就短路),身份只驱动归因盖章(`created_by`/`updated_by`、
    审计 actor)、驱动层的 `organization_id` 填充,以及下游 record-change 级联的触发身份;
  - `create_record` 对 system 运行补 `owner_id` 填充(fill-only、schema 存在才染):所有权锚
    的平台盖章在 `isSystem` 上被短路,payload 是唯一通道;染的是 acting user——与同一触发在
    `runAs:'user'` 下会得到的默认一致,不是把系统身份塞进 owner(ADR-0118 D6 / ADR-0073 D3);
  - 流程 `fields` 显式给值一律优先;真正无用户的运行(schedule)保持三列不染——没有 acting
    user 时按 ADR-0118 D1,哨兵串与伪用户都是被禁的替代品,`svc:flow:*` actor 标签 +
    `flowRunId` 继续承担溯源。

  行为变化:`runAs:'system'` 且触发上下文带 org 的运行,其数据操作在驱动层按
  `(org = 触发 org OR org IS NULL)` 作用域——与 action-body 缝一致的姿态;schedule 触发的
  运行不带 org,行为不变。

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- 4845f85: **The retry policy's last two dialects converge** (#4964 `flow.errorHandling`, #4962
  `ETLPipeline.retry`).

  #4661 converged the retry policy onto one declaration. It converged the two shapes that
  published the **same exported name** (`RetryPolicy` from `./automation` and `./system` —
  the #4411 trap), because that is the question the dual-source instrument asks. Two more
  encodings of the identical concept were outside its vision _by construction_: both are
  anonymous inline `z.object`s nested in a bigger schema, with no exported name to collide.

  The cost of the gap fell on the author who did the right thing. `shared/retry-policy.zod.ts`
  tombstoned `retryDelayMs` and told them to write `backoffMs` — and `flow.errorHandling`
  then **rejected** `backoffMs` and demanded `retryDelayMs`. Reading the newer file was
  punished, and which file an AI author reads first is arbitrary.

  All four surfaces — `job.retryPolicy`, a `try_catch` node's `retry`, `flow.errorHandling`
  and an ETL pipeline's `retry` — now build from one shared shape.

  ## FROM → TO

  ### `flow.errorHandling` (#4964)

  |                                                                   | FROM                                | TO                                                                       |
  | ----------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
  | base delay                                                        | `retryDelayMs`, min 0, default 1000 | **`backoffMs`**, min 0, default 1000                                     |
  | `maxRetries` / `backoffMultiplier` / `maxRetryDelayMs` / `jitter` | _(already identical)_               | unchanged                                                                |
  | `strategy`                                                        | `'fail' \| 'retry' \| 'continue'`   | unchanged — it selects _whether_ the policy runs, so it stays outside it |

  One key, one word, no default changes. Every other key, bound and default already
  matched the converged policy, which is exactly why the divergence survived a release:
  it looked reviewed.

  ### `ETLPipeline.retry` (#4962)

  |                     | FROM                                           | TO                                        |
  | ------------------- | ---------------------------------------------- | ----------------------------------------- |
  | count               | `maxAttempts`, min 0, **default 3**, unbounded | **`maxRetries`**, 0–**10**, **default 0** |
  | base delay          | `backoffMs`, default **60000**                 | `backoffMs`, default **1000**             |
  | `backoffMultiplier` | _(absent)_                                     | ≥1, default 1                             |
  | `maxRetryDelayMs`   | _(absent)_                                     | default 30000                             |
  | `jitter`            | _(absent)_                                     | default false                             |

  ## What you must change

  **1. Rename `retryDelayMs` → `backoffMs`** in any `flow.errorHandling` block. The value
  (milliseconds before the first retry) is unchanged. The old spelling is **tombstoned**,
  not deleted, so it rejects with the rename rather than being silently stripped, and
  `os migrate meta --from 16` (the `retry-policy-converged` conversion, now with a
  flow-level branch) rewrites it for you.

  **2. Rename `maxAttempts` → `maxRetries`** in any `ETLPipeline.retry` block. **The number
  does not change** — both counted the retries _after_ the initial attempt. Do **not**
  subtract one: that adjustment belongs to `integration/connector.zod.ts`'s
  identically-spelled `RetryConfig.maxAttempts`, which _includes_ the first attempt and is
  deliberately **not** part of this convergence.

  **3. If an ETL pipeline relied on the implicit retry count, write it out.** `retry: {}`
  used to mean three re-runs 60s apart; it now means **none**. State `maxRetries: 3` (and
  `backoffMs: 60000` for the old delay) to keep the old behaviour.

  ## Why the ETL default flips to 0

  Not merely to follow #4661. An ETL destination is a foreign system _by definition_ — a
  warehouse, an API, someone else's database. A silent retry against a non-idempotent
  destination is a **duplicate write**: a second invoice, a second export, a second
  webhook. Default 0 makes retrying something an author states, and thereby claims
  idempotency for. An unstated key is precisely where LLM-authored metadata hides this.

  ## Migration surface

  **`flow.errorHandling`** is live: `service-automation`'s `retryExecution` reads the key
  (it now destructures `backoffMs`), and the D2 conversion covers stored and authored
  flows, so no deployed stack changes behaviour.

  **`ETLPipeline.retry` has an empty migration surface today, and that is why now was the
  moment.** `etl.zod.ts` has no parse site in objectstack / objectui / cloud (批 12's
  measurement) and an ETL pipeline is not a `defineStack` collection, so there is no stored
  document a conversion could walk — it deliberately gets a tombstone and **no** D2 step,
  rather than a walker advertising coverage that does not exist. Once an ETL engine lands,
  flipping this default stops being a schema edit and becomes a behaviour change to every
  deployed pipeline.

  ## Also

  The two automation retry surfaces now carry the **same** curated unknown-key table, so an
  author learns one lesson instead of two, and `retry-policy.test.ts` gains a
  concept-level guard: all four surfaces are asserted to expose the same key set and the
  same defaults, by parse rather than by inspecting how each obtains them. Adding a fifth
  retry surface without wiring it to the shared shape now fails a test — which is the check
  that would have caught both of these issues, and the one the name-based scan could never be.

### Minor Changes

- 168f60f: feat(spec,automation): `update_record` / `delete_record` can declare bulk intent with `multi` (#5393)

  A flow could not express "write every row this filter matches" — at all, from
  any app. `UpdateRecordConfigSchema` / `DeleteRecordConfigSchema` are
  `strictObject`s and neither declared any spelling of bulk intent (`multi`,
  `bulk`, `all` and `options.multi` were each rejected as an unrecognized key),
  and the CRUD executors never passed `options.multi` to the data engine. The
  engine accepts a write only when `where.id` is a **scalar** or `options.multi`
  is truthy, and throws otherwise — so a predicate `update_record` /
  `delete_record` was unreachable, while the node descriptors advertised
  `Delete Records` / "Delete records matching a filter." Declared ≠ enforced
  (Prime Directive #10); the symptom was #5225's showcase sweep flow, which had
  never deleted a record.

  **New authorable key — `multi` (boolean, default `false`), on `update_record`
  and `delete_record`.** One name for one concept (PD #12): `multi` is what the
  data engine has always called it (`EngineUpdateOptions.multi` /
  `EngineDeleteOptions.multi`), so the word is the same from node config to
  driver call and greps end to end.

  ```ts
  // before — refused by the engine at run time, with no authoring-time signal
  { type: 'delete_record', config: { objectName: 'lead', filter: { stage: 'stale' } } }

  // after — the declaration makes the intent explicit and the write reachable
  { type: 'delete_record', config: { objectName: 'lead', filter: { stage: 'stale' }, multi: true } }
  ```

  - **Absent or `false`** — unchanged behaviour. The executor forwards
    `multi: false`, so the write must name one row by scalar `id`; anything else
    (a predicate, or `id: { $in: [...] }`) is refused by the engine with
    `Delete requires an ID or options.multi=true`. **That refusal is the
    contract**, not a defect to route around: it is what keeps an undeclared
    unbounded write from happening by accident.
  - **`true`** — the executor forwards `options.multi: true`, the write lands on
    `driver.updateMany` / `deleteMany`, and the step's `acted` metric reports the
    affected row count.

  Additive and backward compatible: no existing flow changes behaviour, and every
  by-id write keeps working untouched.

  Two guards are unchanged and worth stating explicitly. The #3810
  erased-condition guard still refuses a node whose authored filter condition
  interpolated to nothing, `multi` or not — bulk intent says "many rows are
  fine", never "a condition may vanish". And `multi: true` with **no** `filter`
  is the whole object, by declaration: write the constraint you mean.

  Wrong spellings are answered by name rather than by edit distance (which
  reaches `multi` from none of them): `bulk` / `all` / `multiple` get the
  prescription, and `options: { multi: true }` is called out as the engine's
  options bag written at the node's altitude.

- f0d98e1: fix(automation): a `wait` timer's wake-up job is dropped when the run leaves the node, not only when the timer fires (#5512)

  A timer `wait` arms a one-shot job on entry (`flow-wait:<runId>:<nodeId>`,
  `{ type: 'once', at }`) and, until now, only that job's own callback ever tore it
  down. Every other way out of the pause left it armed:

  - resumed early through the REST resume endpoint (`POST
/api/v1/automation/:name/runs/:runId/resume` — a door the #3801 resume gate
    deliberately leaves open for `screen`/`wait` pauses) or the SDK equivalent;
  - cancelled while parked (`cancelRun`, ADR-0044);
  - terminally failed under a subflow ancestor.

  Reported from 17.0-rc2 acceptance: a `wait P1D` pause resumed early ran to
  completion while its one-shot stayed `active: true` in `sys_job` with tomorrow's
  deadline. For the next 24h anyone reading `sys_job` saw "a run is still waiting
  to be woken" — the row contradicted the run — and when the deadline arrived the
  job fired a resume at a run that had completed the day before (harmless: the
  engine reports a machine-state error and the callback discards it, then the job
  self-cancels). A long-running org accumulated one stale row per early wake-up.

  **What changed.** The engine now tells the node its pause is over. `NodeExecutor`
  gains an optional `onSuspensionReleased(release)` — the mirror of `suspend: true`
  — called from the single choke point every consumption of a suspension already
  passes through, with the `runId`, the node, the `correlation` the node minted at
  suspend time, and why the pause ended (`resumed` / `cancelled` / `failed`). The
  `wait` node implements it by cancelling the one-shot whose name it recognises as
  its own, so the `sys_job` row goes inactive the moment the run leaves the node,
  whichever route it left by. `SuspensionRelease` / `SuspensionReleaseReason` are
  exported for plugin nodes that arm something on entry (a lease, a reminder, a
  timeout) and need the same teardown.

  Teardown is best-effort and runs after the suspension is consumed: a job service
  that is down or throwing can neither delay nor fail the continuation — the engine
  logs one warning naming the correlation an operator would cancel by hand. Node
  types that arm nothing are unaffected (the hook is optional), and a pause that
  armed no job — a signal wait, or a timer with no parseable duration — cancels
  nothing, since its correlation is not a job name. Deprecated ADR-0018 node
  aliases delegate the hook to their canonical executor, so authoring the old type
  name cannot silently lose the teardown.

  The timer callback keeps its own `finally` cancel: the two answer different
  questions — "the run left the node" versus "this one-shot has had its single
  shot", including shots that did not consume a pause. `cancel` is idempotent.

### Patch Changes

- 02a8256: fix(service-automation): connector 降级路径的两条日志改用结构化 `meta`,message 保持单行 (#5636)

  ## 接缝

  `degradeConnectorInstance`(#3017 的降级/重试路径)有两条记录报告的是**外来**失败,却把
  它插进了日志 message —— 与 #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的
  `fail()`)同一类,是那两单范围之外的第三个接缝:

  - **husk 注册失败**(`warn`):`err` 来自 `engine.registerDegradedConnector` →
    `ConnectorSchema.parse`,catch 自己的注释就写着「the entry's def no longer parses」,
    也就是说这里预期接到的正是 `ZodError` —— 它的 `.message` 是 issue 数组的多行 JSON
    dump,第一行只有一个 `[`。
  - **降级公告**(`error`):文本是 `ConnectorUpstreamUnavailableError.message`,由第三方
    provider factory 构造(ADR-0097 明确鼓励第三方去写)。spec 只定义错误类、不约束文本,
    所以上游 SDK 的多行失败会原样落在这里。

  ## 危害:这条 `warn` 的下游与 #5575 的 `error` 不同(实测)

  `ObjectLogger` 把 `warn` 送 stdout、`error`/`fatal` 送 stderr,而 `serve` 的启动静默窗口
  只包了 `process.stdout.write`。#5575 的接缝全是 `error`,所以那一单的结论是「启动缓冲根本
  看不到」;这一条不同,而且差别是**测出来**的,不是推的:

  - 它是 `warn` → stdout,缓冲**确实**看得到;
  - 它在**冷启动**就会跑 —— `materializeDeclaredConnectors(ctx, { fatal: true })` 遇到上游
    不可达是降级、不是抛错 —— 而窗口此时正开着(`serve` 在 config 加载前接管 stdout,直到
    banner 打印才恢复);
  - `BootLogCapture.offer()` 只在 `classifyBootLogLine` 能在该物理行上找到 `<ts> <LEVEL>`
    头时才保留它,所以插值 dump 的每一条续行是被**直接丢弃**,不只是难解析。

  对一份 13 行的插值 ZodError 实测:写出 13 行物理行,缓冲保留 **1** 行(那条止于 Zod `[`
  的头行)、丢弃 **12** 行 —— 唯一被留下的那行不含任何事实。这正是 cloud#971 的原始形态。
  `error` 那一条走 stderr,不经缓冲,危害是 #5575 那一串按行消费者(文件 sink、
  `docker logs`/journald 送采集、`grep ERROR`):一条诊断散成 N 个无法归属的碎片。

  ## 改法

  两条都复用同包 `thrown-cause-diagnostics.ts` 的 `describeThrownForLog`(#5572/#5575 落地):
  message 是不含换行的自足句子,cause 走 logger 的结构化 meta。位置按 `Logger` 契约区分,
  并且是核对源码后确认的而非照抄:`warn(message, meta?)` 没有 `Error` 位,cause 就在**第二**
  参;`error(message, error?, meta?)` 的 cause 在**第三**参(第二参塞原始 error 会让每次重试
  的记录都附带完整堆栈)。

  ## 刻意没有改的一件事

  `degradedReason` —— `GET /connectors` 展示的、以及 `connector_action` 被拒时引用的那段文本
  —— 仍然逐字保留 provider 自己的 message,包含换行。它是人透过 JSON 读的字段,不经按行切分
  的消费者;重塑它属于另一次契约变更。因此调用点同时传 `reason`(那段文本)与 `cause`(抛出值
  本身):前者喂 husk 与重试簿记,后者只喂日志记录。测试双向钉住了这个分离。

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

- f205c32: fix(service-automation): 降级注册那条 warn 不再插值 provider 的 reason,cause 走结构化 meta (#5660)

  ## 接缝

  `AutomationEngine.registerDegradedConnector` 自己那条记录:

  ```ts
  this.logger.warn(
    `Connector registered DEGRADED: ${parsed.name} (origin: ${origin}) — ${reason}`
  );
  ```

  `reason` 不是我们的文本 —— 唯一调用点(`plugin.ts` 的 `degradeConnectorInstance`)传进来的是
  `ConnectorUpstreamUnavailableError.message`,由**第三方 provider factory** 构造(ADR-0097 明确
  邀请第三方去写;spec 只约束 `code`,不约束文本),所以上游 SDK 的多行失败会原样落进 message。
  `ObjectLogger.write()` 每次调用只打一个 `<ts> <LEVEL>` 头,带换行的 message 就变成若干物理行,
  只有第一行是记录。

  这是 #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的 `fail()`)、#5636
  (`degradeConnectorInstance` 的两条)之后同族的**第四条**,在另一个文件、另一个方法、另一份
  契约里,所以是单独一单。它值得单独修的理由是**顺序**,不是严重度:

  - 它**先**发生 —— `degradeConnectorInstance` 先调 `engine.registerDegradedConnector(…)`,
    之后才打自己那两条;
  - 它在**默认分支**上 —— #5636 那条 `warn` 在 `catch` 里(husk 自己 parse 失败才走到),
    这条在同一个 `try` **成功**时打,也就是每个实例首次降级都打。

  即:#5636 落地之后,常见的冷启动降级路径上仍然留着一条会溢出的 warn。

  ## 危害(与 #5636 同一条下游,机制已实测)

  `ObjectLogger` 把 `warn` 送 stdout;`serve` 的启动静默窗口只包了 `process.stdout.write`;
  冷启动会走到这个接缝 —— `materializeDeclaredConnectors(ctx, { fatal: true })` 遇到上游不可达是
  **降级**、不是抛错 —— 而窗口此时正开着。`BootLogCapture.offer()` 只在 `classifyBootLogLine`
  能在物理行上找到级别头时才保留该行,所以插值 message 的每条续行是被**直接丢弃**的。

  本单新测试按 `pretty`(CLI 实际用的格式)实测了旧形状的代价,并且刻意报告了一个**比 #5636 更窄**
  的结论:#5636 的载荷是 `ZodError.message`(首行只有一个 `[`),唯一被留下的那行不含任何事实;
  这里的载荷是 provider 的散文,**首行会活下来**,丢掉的是它后面的 `cause:` / `hint:` 两行 ——
  也就是「连哪个地址被拒」和「该去查什么」。3 行进,1 行留,2 行丢。

  ## 改法(#5660 分诊 A 路)

  `registerDegradedConnector` 签名末尾加可选 `cause?: unknown`(在有默认值的 `origin` 之后,
  所以既有调用形状全部照旧编译 —— 新测试里就有一个两参调用在钉这件事)。message 变成单行自足
  (name / origin / 这个状态的后果与后续动作),事实走 `warn(message, meta?)` 的第二参:

  - `degradedReason` —— **恒定存在**,是这次注册**存进** husk 的那段文本。字段名照 #5573 挑过:
    `ObjectLogger` 按 `password`/`token`/`secret`/`key` 子串递归脱敏,这个名字一个都不含;
  - 抛出值自身的渲染(`error` 或 `issues`,经同包 `describeThrownForLog`)—— 仅当调用点传了
    `cause` 时出现。它描述的是**失败**,`degradedReason` 描述的是**注册**;今天唯一的调用点从
    前者派生后者所以两者重合,但记录形状不依赖这个巧合,将来传摘要的调用点也不会静默丢信息。

  唯一调用点顺手把 `info.cause` 传了进来(该字段 #5636 已经存在)。

  ## 刻意没做的两件事

  - **`reason` / `degradedReason` 一字不动**。`GET /connectors` 展示的、`connector_action` 被拒时
    引用的那段文本仍逐字保留 provider 自己的 message,换行包含在内 —— 它是人透过 JSON 读的,不经
    按行切分的消费者(#5636 在上一层做了同样的判断)。测试从两个方向钉住了这个分离。
  - **没有扩 `describeThrownForLog`**。`ConnectorUpstreamUnavailableError` 自带一个 `cause`
    (底层 connect 错误),把**抛出值本身**一路带过来才使渲染它成为可能;但该 helper 目前只读
    `.message` / `.issues`,所以嵌套 cause 今天还不会出现在记录里。这一点被一条测试如实钉住,
    而不是含混带过 —— 扩宽它是改四个接缝共用的 helper,不是这个接缝该顺手做的决定。

- cc5b048: 自动化引擎:嵌入式 host 从未调用 `sealNodeTypeVocabulary()` 时,首次执行 flow 会告警一次(#4792)

  #4771 把 ADR-0018 的节点类型校验从 `registerFlow` 挪到了 `sealNodeTypeVocabulary()`。`AutomationServicePlugin` 在 `kernel:bootstrapped` 自动 seal,插件路径不受影响;但自己 `new AutomationEngine()` 且从不 seal 的嵌入式 host 就彻底拿不到这项校验,而且完全静默 —— 只有读过 changeset 的人才知道要补一行调用。现在这类 host 在第一次真正执行 flow 时会得到一条 `warn`,说明丢了什么、以及要调用哪个方法。

  - 首次执行是最早既安全又必然到达的时点:正在跑 flow 的 host 显然已经装配完毕(否则这次执行本身就会 `NO_EXECUTOR` 失败)。
  - **每个引擎实例一次**,不是每进程一次 —— 一个 host 建了多个引擎(按租户/环境各一个是常见形态)就是在每个上都漏了这次调用。
  - 告警只报「缺了这次调用」这个关于 host 的事实,**不报**未知节点类型的审计结果:未 seal 的引擎其词汇表按契约仍可增长,在那里断言「某类型没有执行器」正是 #4771 删掉的那种会被本次启动反驳的判断。需要审计结果又不想封闭词汇表的 host 用只读的 `getUnknownNodeTypeAudit()`。
  - 也**不会**顺带自动 seal:「谁决定词汇表封闭」只能有一个答案(host)。而且 seal 之后 `registerFlow` 会转为即时校验,自动 seal 会让「先执行、后注册插件执行器」(ADR-0018 允许)的嵌入式 host 开始收到 #4771 那种误报。

  走 `AutomationServicePlugin` 的部署与已显式调用过 `sealNodeTypeVocabulary()` 的 host 都不会多打任何日志(两条哨兵测试守着)。

- 8108787: fix(service-automation): flow 绑定失败的告警改用结构化 `meta`,不再把 Zod issue 数组塞进单行日志 (#5048)

  `AutomationServicePlugin` 的五个 flow 绑定/读取失败点都把 `err.message` 插进一条
  单行 `logger.warn`。而 `registerFlow` 用 `FlowSchema` 解析,#4001 关闭 metadata
  schema 之后未知键是**抛出**而不是被丢弃 —— ZodError 的 `.message` 是 issue 数组的
  多行 JSON dump,第一行就是一个 `[`。

  两级管线随后把余下内容销毁:`ObjectLogger.write()` 每次调用只写一条
  `<ts> <LEVEL> <msg>` 记录,带换行的 message 会溢出到没有等级前缀的后续行;而
  `serve` 的启动诊断缓冲(`BootLogCapture.offer()`)只保留 `classifyBootLogLine`
  能认出等级前缀的行。于是一次启动里 24 个绑不上的 flow,给出的是 24 条点了名字、
  然后说一个 `[` 的告警 —— cloud#971 能横跨整条 rc.1 发布线没人发现,就是因为这个。

  现在这些位置改为:message 是不含换行的静态字符串,事实交给 logger 的 `meta`
  第二参(仓库里每个 `Logger` 实现都用 `JSON.stringify` 序列化它,值里的换行变成
  `\n` 转义,整条记录稳定占一行,正是启动缓冲会保留的形态)。新增内部模块
  `flow-bind-diagnostics.ts` 把 Zod issue 摊平成 `{ code, path, message,
unrecognized }`:`path` 渲染成 `nodes[0].config.x`,被拒的键名放在
  `unrecognized` 而不是 Zod 原本的 `keys` —— 因为 `ObjectLogger` 的默认脱敏表
  (`['password','token','secret','key']`)按**子串**递归匹配,`keys` 含 `key`,
  原样转发 `err.issues` 会渲染成 `"keys":"***REDACTED***"`,恰好丢掉读者唯一需要
  的那个事实。issue 列表有上限,超出时用 `issueCount` **显式声明**总数,而不是静默
  截断。非 ZodError 的失败退回 `error` 字符串分支。

  无公开 API 变化;日志文本的可 grep 前缀(`cold-boot flow bind: failed to
register`、`flow re-sync: failed to register`、`flow pull from ObjectQL
registry failed`、`flow read from protocol failed`)全部保留。与 #4632 同源:
  被截断的诊断比没有诊断更贵。

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

- dadf542: fix(service-automation): 启动路径三条日志改用结构化 `meta`,message 保持单行 (#5661)

  ## 接缝

  `AutomationServicePlugin` 里还有三处把**外来**错误的文本插进日志 message —— 与
  #5048(flow 绑定)、#5575(`reconcileDeclaredConnectors` 的 `fail()`)、#5636
  (`degradeConnectorInstance`)同一类,是那三单范围之外的第四组:

  - **`registerRunObject`**(`warn`):`err` 来自内核服务注册表(`ctx.getService('manifest')`
    或 `manifest.register()` 的解析拒绝),文本不是我们的。
  - **启动 probe**(`error`):`err` 来自 `candidate.probe()`,即**数据源驱动**抛出的错误。
  - **重启后 wait-timer 重新挂载**(`error`):`err` 是从 `rearmSuspendedWaitTimers` 逃出来
    的任何东西。

  ## 为什么后两条尤其值得改

  它们的**存在理由**就是可读性。代码自己写明后果 —— 「suspended runs will NOT survive a
  restart」「every wait/approval paused before this restart will hang indefinitely」—— 并被
  #4632 特意定为 `error` 级,好让运维能找到。而 `ObjectLogger.write()` 一次调用只加一个
  「时间戳 + 级别」记录头,所以带换行的 message 会变成多个物理行、只有第一行有头:文件 sink
  把其余行当成独立记录存,采集端读成无法归属的碎片,`grep ERROR` 只捞到那条不含任何事实的
  头行。这个 plugin 里最响的耐久性告警,恰好是最可能以读不懂的形态抵达的那一条。

  第一条的危害是另一种,并且是测出来的:`warn` 走 **stdout**,正是 `serve` 启动静默窗口包住
  的那条流,而 `BootLogCapture.offer()` 只在该物理行上找得到级别头时才保留它 —— 所以续行是
  被**直接丢弃**,不只是难解析。`registerRunObject` 在 `init()` 里跑,正处于窗口开着的时候。

  ## 改法(零新词汇)

  三处都复用同包 `thrown-cause-diagnostics.ts` 的 `describeThrownForLog`:message 是不含换行
  的自足句子,cause 走 logger 的结构化 meta。参数位按 `Logger` 契约区分 ——
  `warn(message, meta?)` 没有 `Error` 位,cause 在**第二**参;`error(message, error?, meta?)`
  的 cause 在**第三**参(第二参塞原始 error 会让记录额外附带堆栈)。#4632 要求的「后果 + 修
  法」仍然完整留在 message 的第一行里,只是末尾的 `: ${err.message}` / `Cause: ${err.message}`
  换成了指向 meta 的一句话。

  `pnpm check:durability-log-level` 仍绿:24 个耐久性接缝,三处 `error` 未降级、未改成 rethrow。

  ## 测试

  新增 `plugin-startup-log-cause.test.ts`:13 个用例全部让真 `ObjectLogger` 写真字节再读回来
  (照 #5662 的先例 —— spy 只能证明接缝**调用**了什么,证明不了按行消费者会**看到**什么,而
  后者才是 cloud#971 付掉一整条 rc 线的那一半)。三条接缝各自钉住「多行 cause 不进 message、
  进结构化 meta」、参数位、以及无 cause 时输出零字节;末尾两个用例把插值形态与结构化形态并排
  渲染、量出差别(`warn` 侧:一次调用多个物理行、启动缓冲只留下止于 Zod `[` 的那一行;`error`
  侧:一条记录散成三个碎片,后两行无记录头)。

  `plugin-suspended-run-wiring.test.ts` 里那条 #4420 的 probe 用例做了重新裁决而不是重新拼写:
  它原来断言驱动文本出现在 message 里,现在双向断言 —— message 里**没有**、meta 里**有**。
  单向的断言在 cause 被整个丢掉时也会通过。

- c42a19a: fix(service-automation): `wait` 节点的五条日志不再把外来 cause 拼进 message,改走 meta (#5737)

  `builtin/wait-node.ts` 里有五处记录把**我们不控制文本**的失败原因(数据源驱动、
  job 服务、`engine.resume()` 的错误信封)直接插进日志 message。`ObjectLogger.write()`
  一次调用只加一个「时间戳 + 级别」记录头,所以 message 里的换行会把**一条**记录变成
  多个物理行,后面几行既无级别也无时间戳。在 `pretty` / `text` 格式(`os dev` / `os serve`
  的默认)下,文件 sink 会把它们当成独立记录存,日志采集器读成无主碎片,而
  `grep ERROR` 只捞得到不含任何事实的那一行 —— 恰恰是运维正在找的那条。

  五处现在都改成:**message 单行自足**,外来 cause 交给 logger 的结构化参数位 ——
  按 `Logger` 契约(`packages/spec/src/contracts/logger.ts`)选位置,`warn(message, meta?)`
  用第二参,`error(message, error?, meta?)` 用**第三**参(第二参留空,否则每条记录都
  会带上整个栈)。与 #5048 / #5575 / #5636 / #5661 完全同一套修法,零新词汇。

  对运维可见的变化(日志形状,非行为):

  - 这五条记录各自恒为**一个**物理行,不论日志格式;
  - 原因文本从 `msg` 末尾的 `Cause: …` 移到记录的 `error` 字段(`meta`),多行驱动错误
    由 `JSON.stringify` 转义换行后完整保留 —— 一个字节都不丢;
  - 消息里原本指向拼接文本的「the cause below」措辞改为指向记录的 meta;
  - 级别一律不变。其中三处是 #4632 明确定为 `error` 的耐久性诊断
    (`rearmSuspendedWaitTimers` 的 store 不可列、overdue 运行叫不醒、唤醒 job 没排上),
    仍是 `error`,`pnpm check:durability-log-level` 照旧覆盖;「无 job 服务」那条声明式
    缺失仍是 `warn`。

  按 `Cause:` 字面量 grep 这五条记录的日志查询需要改成读记录的 `error` 字段。

- 229d29e: fix(automation): a wait node's timer wake-up no longer disarms itself when the store outage means it never woke the run (#5529)

  A timer `wait` arms one job to wake its run. That job used to disarm itself in an
  unconditional `finally` — and `AutomationEngine.resume()` reports failure by
  **returning** a code rather than throwing, so "this shot consumed the pause" and
  "this shot missed" were indistinguishable to that `finally`. Both were cancelled.

  On `STORE_UNAVAILABLE` that was a durability hole. The durable suspended-run
  store being unreadable does **not** mean the run is gone (#4420 draws exactly
  that line): the pause was never consumed, the run is still parked at its wait
  node, and its row is still there — but the one job that was ever going to wake it
  had just retired itself. Nothing then woke that run until the next process start,
  where `rearmSuspendedWaitTimers` picks it up as overdue. A store that wobbled for
  the one moment the deadline landed, plus no restart, meant a run parked forever.

  The one-shot now settles on the resume's return code:

  - **`STORE_UNAVAILABLE`** — the job stays armed, and the degradation is reported
    at `error` (this path was previously silent — the result was discarded without
    even a `warn`). The line names the job, the run, and both remedies.
  - **everything else** — cancelled exactly as before: success consumed the pause,
    `RESUME_IN_PROGRESS` means a concurrent resume is consuming it, a machine-state
    failure means there is no pause left to serve, and a thrown error is not a
    store outage.

  Keeping the job armed is **not** self-healing, and the log line says so rather
  than implying a retry: a `once` schedule is a single `setTimeout`, so it never
  re-fires on its own. What survival buys is the two things `cancel` destroys — the
  `sys_job` row stays `active` with its deadline (true, here: the run really is
  still waiting) instead of flipping to `active: false` and reading as "this
  wake-up is done", and the registration stays in the job service, so
  `trigger('flow-wait:<runId>:<nodeId>')` re-fires that wake-up once the store is
  back **without a restart**. After a cancel, `trigger` reports the job as not
  found and a restart is the only path left.

  Both sites that arm this job — the wait node's own arming path and the cold-boot
  re-arm — now share one handler, so they cannot drift, the same reason the job's
  name is a single declaration. This is separate from the `onSuspensionReleased`
  teardown added in #5512 and does not replace it: that one fires when the **run**
  leaves the node, this one when the **job** has had its single shot.

  No authoring surface changes; no flow needs editing.

- b508244: automation: a pausing node type that never declares `resumeAuthority` is now named
  at registration, and the four pausing built-ins declare theirs (#5561)

  `registerNodeExecutor` warns once per node type (per engine instance) when a
  descriptor declares `supportsPause: true` and omits `resumeAuthority` — the state in
  which the #3801 resume gate silently treats every pause that type creates as
  raw-resumable through the generic resume route. The line names the two legal values
  and says that declaring `'any'` explicitly silences it and changes no behaviour, so
  a node whose pause really is open to the route is not pushed toward `'service'` to
  quieten a log.

  `screen`, `wait`, `subflow` and `map` now declare `resumeAuthority: 'any'`
  explicitly. Each was already correct on its own terms — it was inheriting the value
  rather than stating it — so the warning names nothing on a stock boot today and only
  catches future omissions. Authority resolution is unchanged: `resolveResumeAuthority`
  still resolves an absent value to `'any'`.

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
- Updated dependencies [0f17114]
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
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
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
- Updated dependencies [bf1edef]
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
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- 2826d1e: fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

  A flow paused at an `approval` node, a deploy, then an approver clicking
  Approve: the request row flipped to `approved`, the UI toasted success — and
  the flow never moved. No next-stage request, no error, the record's mirrored
  status frozen mid-workflow. Approval flows pause for days by design, so a
  restart mid-flight is the normal case: every release could quietly zombify
  every in-flight approval, with the approvers none the wiser.

  Durable suspended runs (#1518) had shipped and were not the missing piece. Two
  other things were.

  **The wiring could enable a store over a table nobody had created.** Object
  registration and store activation resolve different services in different
  phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
  declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
  warned, and continued; `start()` then attached the DB-backed store anyway. Every
  suspend failed with `no such table: sys_automation_run` into a log line nobody
  read, pauses silently stayed in memory, and the next restart lost them all.
  Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
  engine-less kernel must still boot); a registration missed at `init()` is
  retried at `start()`, which still lands before ObjectQL's schema sync; the
  store is never attached when registration did not happen, and says so at
  **error** level instead of warning; the table is probed once at boot so a
  broken setup surfaces there rather than one failed write at a time; and a
  failed durable write of a paused run is logged at error — it is data loss in
  waiting, not a warning.

  **A reported resume failure read as success.** `AutomationEngine.resume()`
  answers a lost run by _returning_ `{ success: false }`, never by throwing.
  `ApprovalService` discarded that return value, and `decide()` counted only a
  thrown error as failure — so a decision against a dead run came back
  `resumed: true`, HTTP 200. Resume failures are now classified
  (`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
  `PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
  distinguishable from a store that is merely unreachable, and the raw resume
  route maps them to 404 / 503 / 409.

  Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
  reads the suspension store, unlike `getRun()`, and throws rather than answering
  `false` when the store is unreadable — pre-flights every flow-advancing
  operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
  zombie half-state is never created rather than merely reported: the decision
  fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
  resume that fails after the decision is durable can no longer be undone, but it
  now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
  reporting success. A concurrent duplicate resume stays benign — the engine's
  idempotency guard is doing its job — and reports through the new optional
  `resumeError` field. Recall and revise-window cancellation stay non-fatal by
  design (they abandon the request), but log at error with the reason instead of
  swallowing it. Compositions with no automation engine attached are unaffected.

  Existing zombie requests from affected deployments (already `approved`, run
  stranded) are not repaired by this change — `releaseDeadRunRequests` only
  sweeps requests that are still `pending`.

- 5293114: fix(automation): a decision's three declared ways to route a branch are now one working model (#4414)

  A `decision` node advertised three mechanisms for splitting a path and only one
  of them did anything. The other two were the ADR-0049 `declared ≠ enforced`
  shape, and the pair of them shipped a guard that does not guard in
  `examples/app-crm`.

  | mechanism                                            | before                                                                                                 | now                                                   |
  | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------- |
  | `edge.condition`                                     | ✅ the only one that worked                                                                            | unchanged                                             |
  | `edge.isDefault`                                     | **zero readers** anywhere but the schema declaration                                                   | BPMN default flow, enforced in `traverseNext`         |
  | `decision.config.conditions[].label` → `branchLabel` | matched **0** out-edge labels across every example app, then fell back to the full edge set in silence | routes; an unclaimable label is logged, not swallowed |

  ## What was broken, end to end

  `crm_convert_lead_wizard` means "already converted → abort screen; otherwise →
  the wizard". It ran **both**: an already-converted lead got
  "This lead has already been converted" and then walked straight into the
  conversion wizard behind it. Four independent silences stacked up:

  1. the decision's first condition was authored `{lead_record.status} ==
'converted'` — braces in a slot declared bare CEL, so it was string-compared
     and never true;
  2. the second (`'true'`) therefore won, yielding `branchLabel: 'No — proceed'`;
  3. no out-edge carried that label (they were `'Yes'` / `'No'`), so traversal
     discarded the branch and considered every out-edge;
  4. `e3b` was unconditional, so it ran regardless — and the natural fix, marking
     it `isDefault: true`, was a dead key.

  ## The model

  `branchLabel` narrows the edge set → `condition` gates each edge → `isDefault`
  catches whatever is left. Concretely:

  - **`isDefault` is enforced.** A default edge is traversed only when no
    conditional sibling of the same source node matched, and it is no longer part
    of the unconditional parallel fan-out — that distinction is the whole point of
    the marker. Passed over because a real branch won, its target records the same
    `skipped` step a closed gate does (#4354).
  - **An unclaimable branch label warns.** Traversal still falls back to the full
    edge set (a run mid-flight must not die on a metadata error) but says so,
    naming the computed branch and the out-edge labels that exist.
  - **A decision that declares no `conditions` reports no branch.** It used to
    report `'default'` unconditionally — a label no out-edge in the repo ever
    carried — which is why every decision node fell back to the full edge set.
    The `'default'` sentinel survives for the case it actually describes (declared
    conditions, none matched) and is now claimed by the `isDefault` edge as well
    as by an edge literally labelled `'default'`.
  - **`conditions[].expression` is evaluated as the bare CEL it is declared to
    be.** The raw string went to the legacy `{var}` template path, where
    `lead.status == 'converted'` cannot resolve and the branch is decided by
    string comparison. Unlike `edge.condition` this slot carries no
    `ExpressionInput` envelope — the decision descriptor is deliberately
    schemaless — so the executor supplies the dialect. A brace-in-CEL predicate
    now fails loudly (ADR-0032 §1c) instead of deciding `false`.

  ## Caught at authoring time too

  Four new `os build` / `os validate` warnings, because a wrong route is silent at
  run time by nature (Prime Directive #12):

  `flow-branch-label-unmatched` (the shipped shape),
  `flow-decision-unconditional-branch` (a guarded decision with an unconditional
  sibling — the actual hole), `flow-default-edge-with-condition` and
  `flow-multiple-default-edges`.

  Both of the first two fire on the pre-fix `convert-lead.flow.ts` and are silent
  after it.

  ## Effect on flows that already exist

  Enforcing `isDefault` changes how a **stored** flow behaves, and the flows it
  changes are mostly Studio's own. `objectui`'s flow edge inspector has always
  written `isDefault: true` when you bind an out-edge to a decision's default/else
  branch — into a key with zero readers, so that edge ran unconditionally, in
  parallel with whichever branch actually matched. Those flows now take exactly
  one branch. That is the fix, but it is a behaviour change on existing data
  rather than only on newly authored metadata, so it is worth knowing before
  upgrading: a flow that quietly ran two paths will now run one.

  Nothing changes for an edge that never carried the marker — `isDefault` defaults
  to `false`, and an ordinary unconditional out-edge still fans out in parallel
  exactly as before.

  ## The example app

  `crm_convert_lead_wizard`'s guard is now a plain exclusive gateway: the
  redundant `config.conditions` is gone and `e3b` carries `isDefault: true`. One
  mechanism per decision, and exactly one branch runs.

  Verified: 11 new engine/executor tests (including the reported repro in both
  directions), 12 new linter tests; `@objectstack/service-automation` 577 tests
  and `@objectstack/cli` 652 tests green, all three example apps build with no new
  findings.

- ac471a0: **BREAKING**: `IAutomationService.getSuspendedScreen(runId)` is now **async** — it returns `Promise<ScreenSpec | null>` instead of `ScreenSpec | null` (#4515).

  FROM → TO for anyone calling or implementing it:

  ```ts
  // caller
  - const screen = automationService.getSuspendedScreen(runId);
  + const screen = await automationService.getSuspendedScreen(runId);

  // implementer
  - getSuspendedScreen(runId: string): ScreenSpec | null
  + async getSuspendedScreen(runId: string): Promise<ScreenSpec | null>
  ```

  One-line fix: `await` the call (the enclosing function is almost certainly already `async`), and make any test double resolve rather than return (`mockResolvedValue`, not `mockReturnValue`).

  Why it had to change: the method could only ever read the engine's in-memory hot cache, because a synchronous signature cannot consult the durable suspended-run store. `SuspendedRun.screen` _is_ persisted (`sys_automation_run.screen_json`) and `resume()` cold-reads it back, so after a process restart a still-suspended screen run could be resumed (`POST …/runs/:runId/resume` → 200) while `GET …/runs/:runId/screen` returned 404 “No pending screen for run” — the refresh-safe re-fetch failing in exactly the situation it exists for (page refresh, another device), and the rendering half of ADR-0019's durable-suspend promise missing while the resuming half shipped.

  `AutomationEngine.getSuspendedScreen` now takes the hot cache as its fast path and falls through to the store via the same loader `resume()` rehydrates from. A run that does not exist, is no longer suspended, or paused at a non-screen node still resolves to `null`, so `GET …/runs/:runId/screen` keeps returning 404 for genuinely absent runs. No sync variant of the method remains on the contract.

- 68c02c2: fix(automation): `evaluateCondition` decides the dialect from the source, not from the caller (#4336)

  `AutomationEngine.evaluateCondition` picked its engine by asking whether an
  `{ dialect, source }` **envelope** was present. A condition handed to it as a
  plain string therefore never reached the CEL engine: it fell through to the
  legacy `{var}` template path, which substitutes brace holes and then compares
  whatever text is left — **as text**. Nothing errored, and the run was recorded
  as `success`, with the failure direction depending on the predicate:

  | Handed in              | Actually evaluated                     | Result                               |
  | :--------------------- | :------------------------------------- | :----------------------------------- |
  | `existingTask == null` | `'existingTask' === 'null'`            | always **false** — gate never opens  |
  | `record.rating >= 4`   | `'record.rating' >= '4'` → `'r' > '4'` | always **true** — branch pinned open |

  #4414 fixed the one built-in that was reaching this — the `decision` executor
  now wraps `conditions[].expression` in a CEL envelope before calling. This
  fixes the **evaluator**, so the next caller does not have to remember: the
  dialect is now read from the source, and a condition is CEL unless it actually
  contains a `{var}` hole. `evaluateCondition` is public API, so a
  plugin-registered node executor evaluating its own predicate was getting the
  table above with nothing to warn it.

  **The legacy `{var}` dialect keeps working** where it always did —
  `{amount} > 100`, `{status} == active`, `{a.b} == 7` — and gains the two things
  it was missing:

  - **A quoted literal compares as its contents.** `{status} == 'active'` used to
    compare `active` against `'active'` — quotes included — and was false for
    every value of `status`. It is the spelling the flow docs showed, and quoting
    a string literal is what every other predicate surface requires.
  - **It no longer answers `false` when it could not resolve something.** A `{…}`
    hole matching no flow variable (`{lead_record.status}` — `get_record` stores
    the whole row under one name, so that key never exists) and a substituted
    value that is neither a boolean, a number, nor part of a comparison are
    refused with the source and the offending reference attached. Both used to be
    a silent `false`, which ADR-0032 §1c forbids: a predicate that cannot be
    evaluated is a fault, never a quiet branch decision.

  Braces inside an explicit `dialect: 'cel'` envelope remain the #1491 brace-trap
  and still throw — stating the dialect is the author saying "this is CEL". The
  sniff reads the source outside string literals, so `record.label == '{pending}'`
  stays CEL and compares the field.

  **Tightening to know about:** a bare string that is not valid CEL now raises
  where it previously string-compared to some answer. That includes the
  host-language payloads the safety tests use (`process.exit(1)`,
  `require("fs")…`) — nothing executed before and nothing executes now, since CEL
  has no `process`, no `require` and no arrow functions, but the failure is a
  reported fault instead of a silent `false`.

- eb4204b: feat(automation): a `script` node's purity contract is declared, and a function that writes can say so (#4396)

  The `script` executor's contract — _the named function returns a value; data I/O
  stays on the flow graph_ — existed only as a comment inside the executor, while
  #4354's run summary depended on it. That summary reports no record metrics for a
  `script` step precisely because a pure function's writes are downstream
  `create_record` / `update_record` nodes counting themselves. A function that
  wrote anyway made its run report `selected: 30, acted: 0` — indistinguishable
  from the broken sweep the counters exist to detect, recorded permanently on
  `sys_automation_run`.

  **The rule is now visible.** `ActionDescriptor` carries
  `handlerContract: 'none' | 'pure'`, and the `script` descriptor publishes
  `'pure'`, so the action catalog, the designer palette and the reference docs
  state the rule an author has to follow instead of an executor holding it
  privately.

  **And a legitimate writer can opt out honestly.** A `defineStack({ functions })`
  entry may declare what it does, in either shape:

  ```ts
  defineStack({
    functions: {
      scoreLead: (ctx) => ({ score: 42 }), // pure — the default
      syncBilling: { handler: syncBilling, effect: "writes" }, // declared writer
    },
  });
  ```

  A step calling a declared writer reports `unmeasuredEffect`, so the run's
  `unmeasured` tally keeps the broken-sweep query
  (`selected > 0 AND acted = 0 AND unmeasured = 0`) off that flow — and only that
  flow. Marking _every_ `script` step unmeasured was rejected: it would blind the
  detector on every flow that calls any function in order to cover the few that
  break the rule.

  Nothing here is retired or renamed: a bare `functions: { fn }` entry is
  unchanged and means `effect: 'pure'`. The declaration is carried end to end —
  `ObjectQL.registerFunction` accepts `{ packageId, effect }` alongside the
  existing `packageId` string and exposes `resolveFunctionEntry(name)`,
  `objectstack build` lowers a declared entry without dropping it, and the
  artifact loader re-attaches the module's callable to the declaration the JSON
  carried.

  **Also fixed:** `bindHooksToEngine` returned before registering a bundle's
  functions when the stack declared no hooks, so a flow-only app's
  `defineStack({ functions })` reached the engine as nothing and every `script`
  node calling one failed with "no function named 'x' is registered".

- 25784cf: fix(automation,approvals): 节点类型校验推迟到插件贡献完成之后 —— approval flow 不再被误报"运行时会失败" (#4771)

  showcase 每次冷启都打印 8 条断言:这些 flow "will fail at execution time"。8 条全是假的。
  `AutomationServicePlugin.start()` 从 ObjectQL registry 拉起 flow 并**当场**校验节点类型,而
  `ApprovalsServicePlugin.start()` 在 0.8 秒后才注册 `approval` 执行器 —— 校验器在词汇表还没
  成型的时候就下了结论。

  真正的代价不是噪音,是信号丢失:**真的没装 approvals 插件**的部署会得到一模一样的 8 条告警,
  所以这条 warn 无法区分"健康"和"坏掉",信噪比为 0。

  ADR-0018 明确把节点词汇表定义为**开放、可运行时扩展**的(插件通过
  `registerNodeExecutor(type)` 贡献类型)。因此校验只在词汇表**封闭**的那一刻才成立:

  - `AutomationEngine.sealNodeTypeVocabulary()` —— 宣告词汇表封闭,对**所有**已注册 flow 跑一次
    权威校验,每个有问题的 flow warn 一条。`AutomationServicePlugin` 在 `kernel:bootstrapped`
    调用它(严格晚于每个插件的 `start()` 和每个 `kernel:ready` handler —— 本插件自己的
    `kernel:ready` 还会再注册一批 flow,别的插件也可能在它的 `kernel:ready` 里贡献执行器)。
  - `AutomationEngine.getUnknownNodeTypeAudit(): UnknownNodeTypeAuditEntry[]` —— 同一发现的
    **状态**形态,供 host(CLI 启动摘要、健康检查)直接读,而不是去 grep 日志。与
    `getTriggerBindingAudit()` 同一套路。
  - 封闭之后 `registerFlow` **恢复即时告警**:Studio 发布 / dev reload 进正在运行的服务器时,
    词汇表确实是完整的,那句断言此时为真。所以这是时序修复,不是把告警静音。

  告警文案也随之改成它现在能承诺的事:"Every plugin has started, so nothing will register them
  now — these nodes fail at execution time with NO_EXECUTOR",并给出补救动作。

  一并修掉同一缺陷类的另一半:`ApprovalsServicePlugin` 在**拿不到 automation 引擎**时,把
  "`approval` 节点没注册"记成 `info` —— 而 dev 的默认日志级别是 `warn`,于是**真降级发生时反而
  看不见**(#4632:静默降级必须响亮)。现在是 `warn`,写明后果(该部署里每个 ADR-0019 approval
  flow 都会以 NO_EXECUTOR 失败)和补救(装 `@objectstack/service-automation`)。`catch` 同时收窄
  到"服务查找"这一步,`registerApprovalNode` 内部真出错时会以自己的身份抛出,而不再被贴上
  "no automation engine" 的错误标签;`automation` 服务存在但不接受节点执行器的分支从前**一条日志
  都不打**,现在同样 warn。

  **嵌入式 host 注意**:直接 `new AutomationEngine()` 而不经过 `AutomationServicePlugin` 的宿主,
  需要在自己的插件都装好之后调用一次 `sealNodeTypeVocabulary()`,才能拿到这条告警(以及之后的
  即时校验)。

- fd3013a: feat(spec,automation)!: converge `script` to a function call — retire the `actionType` branches — and parse `script` / `subflow` config at execute time (#4343)

  A `script` node had four ways to name what it ran and only one of them ran anything.
  Protocol 17 keeps that one and retires the rest.

  - **`config.actionType: 'email' | 'slack'`** were **logger-backed stubs**. They wrote a
    line, reported success, and delivered nothing — under any configuration, installed
    messaging service or not. Every bundled example used one; none of them ever sent
    anything.
  - **`config.template` / `.recipients` / `.variables`** fed those stubs, so they addressed
    a message no channel sent. (The examples did not even reach them: they passed the
    payload in `inputs`, which the built-in branch never read.)
  - **inline `config.script`** was recognized and **never executed** — the built-in runtime
    has no server-side JS sandbox, so the node warned and completed as a no-op.
  - **any other `actionType`** was shorthand for a registered-function name — a second
    spelling of `config.function` — and `'invoke_function'` was a marker that named nothing
    on its own.

  What remains is what worked: `config.function` (now **required**) names a registered
  function, `config.inputs` feeds it, `config.outputVariable` binds its return value.

  **The replacements are three different mechanisms, not one rename.**

  | Retired                                                           | Use instead                                                                                                                                        |
  | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `actionType: 'email'` (+ `template` / `recipients` / `variables`) | a `notify` node — it delivers through the messaging service: the in-app inbox by default, real email once `@objectstack/plugin-email` is installed |
  | `actionType: 'slack'`                                             | a `connector_action` node with the Slack connector, or an `http` node posting to an incoming webhook — `notify` has no Slack channel               |
  | `actionType: 'my_fn'` (shorthand)                                 | `function: 'my_fn'` — the conversion moves it for you                                                                                              |
  | `script: '…'` (inline JS)                                         | move the logic into a registered function and call it via `config.function`                                                                        |

  **Execute-time parse.** `script` and `subflow` now run their config through the contract
  before executing, the seam #4277 gave the flat builtins — a violation refuses the node as
  a **guard** (wrong metadata; no `fault` edge may route it, #3863). `script` could not join
  that seam while its legal key set depended on `actionType`: a flat parse would either
  reject valid shapes or wave everything through. Converging the node is what made the
  contract fit. `subflow`'s hand-written `flowName` check became the same parse, so its
  message is now `subflow 'n1': config does not satisfy the subflow contract —
config.flowName: …`. `decision` deliberately stays export-only: its one key is optional,
  so a parse would check nothing.

  **Migration.** `os migrate meta --from 16` rewrites stored sources; authoring one of these
  keys in TypeScript is a compile error carrying the same prescription. A shorthand
  `actionType` **converts into `function`** — that is what it named — unless `function` is
  already set, in which case it was dead metadata the executor never reached. The other four
  keys are dropped outright: nothing read them, so there is no value to preserve, and
  rebuilding the intent is an authoring decision (the table above) rather than something a
  mechanical rewrite can guess.

  The keys leave the **load path** (`retiredFromLoadPath`) with the rest of the keys retired
  for _misdescribing themselves_ rather than for being renamed: absorbing
  `actionType: 'email'` silently would let an author keep believing the flow sends mail. The
  one seam that still replays it is `registerFlow`, which rehydrates data at rest (#3903) —
  a row in `sys_metadata` has no author for a tombstone to teach. So a stored email-stub node
  arrives stripped of the keys nothing read and then **refuses for naming no callable**,
  where it used to log a line and report success. That flip is the behavior change to expect.

  **A build gap this surfaced, fixed here.** `FlowFunctionEntrySchema` now also accepts a
  **lowered handler ref** (a non-empty string), the form `objectstack build` produces: the
  CLI lowers every inline callable to a serialisable ref _before_ the stack is parsed (it
  must — `z.function()` wraps callables and would break the ref mapping), so a built
  manifest holds `{ myFn: 'myFn' }`, which neither previous member accepted. The result was
  that `defineStack({ functions })` — a documented, first-class mechanism — could not
  survive a build at all. Nothing had noticed because no bundled example used it; #4343
  turns that from latent into blocking, since `config.function` becomes the only thing a
  `script` node can run. `Hook.handler` already declared exactly this pair (`z.union([
z.string(), <function> ])`, "string, post-build / inline function, pre-build"), so this
  brings `functions` onto the platform's established shape rather than inventing one. A
  string carries no callable and `normalizeFlowFunctionEntry` still drops it by design — the
  real functions ride in the sibling ESM module the build emits, merged by name — so
  hand-authoring one registers nothing and fails loudly at execute ("no function named '…'
  is registered"), never silently.

  Also in this change: the retired constants `SCRIPT_BUILTIN_ACTION_TYPES`,
  `SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` and the `ScriptBuiltinActionType` type are removed
  (they described the dispatch set that no longer exists); `os validate` names a retired key
  and its replacement instead of reporting a generic missing callable; and the `#3796`
  alias fixture, which carried `actionType: 'invoke_function'` through both sides, no longer
  describes an end state protocol 17 can reach — the rename itself is untouched. No liveness
  ledger row moves: the gate walks `FlowSchema`, whose `nodes[].config` is
  `z.record(z.unknown())`, so these keys were never governed by one.

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

### Patch Changes

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

- 4c45be1: fix(convention): a best-effort degradation that costs DURABILITY logs `error`, not `warn` — and a gate that enforces it (#4632)

  #4420: the durable suspended-run store attached to a table that was never
  created. Every write failed into a `warn` nobody read, every restart dropped all
  in-flight approvals, and the process reported perfect health the entire time —
  the symptom surfaced a release after the cause. #4460 raised that **one** site to
  `error`. This makes it the rule, because the _class_ is what recurs.

  **The rule** (AGENTS.md → "Degradation log levels") is a question, not an
  adjective, so an agent can apply it while writing the `catch`:

  > After the degradation, does the system still look "normal" from the outside,
  > while something it claims is persisted has not actually landed?
  > Yes → `error`. No → `warn`/`info` is right.

  An `error` here owes two things in its first line: the **consequence** (what is
  not durable, and that the system will keep looking healthy anyway) and the
  **fix** (the composition change that restores durability, or the explicit opt-out
  that makes the degradation deliberate). Say it once, not once per failed write.

  **Sites raised to `error`** — each was reviewed individually; escalating a
  functional degradation is the mirror-image failure and was deliberately avoided:

  | Where                                            | What was silently lost                                                                                                                   |
  | :----------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
  | `objectql` schema sync, per object               | DDL never ran — the object stays registered, routed and rendered while its table/columns do not exist                                    |
  | `objectql` schema sync, summary                  | `info: Schema sync complete` printed over a pass with failures; now an `error` naming the count                                          |
  | `objectql` reload-time schema sync               | a Studio edit adds a field, the UI shows it, the API accepts it, the column was never created                                            |
  | `ObjectQL.syncSchemas()`                         | an **empty** `catch` — marketplace install and template seeding wrote into tables this failure means do not exist, then reported success |
  | `service-automation` wait-timer re-arm (4 paths) | runs stay persisted but nothing re-arms them: every approval paused before the restart hangs forever                                     |

  **Deliberately left at `warn`** — the rule cuts both ways, and over-applying it
  trains everyone to skim `error`: the batch→sequential schema-sync fallback (it
  _recovers_), and "no job service is registered" on the re-arm path (a declared
  absence in a host that never composed auto-resume — nothing was promised and
  then broken).

  **It has teeth.** A convention that lives only in AGENTS.md is the same
  "declared ≠ enforced" shape this repo keeps paying to fix, so
  `pnpm check:durability-log-level` walks the AST for `catch` blocks guarding a
  declared vocabulary of durability-critical operations and fails when one
  degrades below `error` without rethrowing. It follows same-file helpers (so
  extracting a reporter cannot quietly defeat it) and ships its own `--self-test`.
  Deliberately narrow: it cannot _discover_ a new durability seam, only stop known
  ones from regressing — extend `DURABILITY_CRITICAL_CALLEES` in the same PR that
  fixes a new one.

  No API, schema or behaviour changes — only the level, and the text, of what
  already-failing paths report.

- f3141d8: fix(spec): a node that publishes no descriptor configSchema can now own an expression-ledger entry (#4439)

  `FLOW_NODE_EXPRESSION_PATHS` is the #4027 ledger that tells `registerFlow` and
  `objectstack validate` which config keys hold expressions, and in which dialect.
  Its ratchet (`config-expression-ledger.test.ts`) derives what it expects from
  descriptor `configSchema` `xExpression` markers, and fails in **both**
  directions — an undeclared marker, or a ledger entry nothing declares.

  `decision` / `script` / `subflow` publish **no** descriptor `configSchema` on
  purpose: a published partial schema would drop the editors their hand-written
  Studio forms need (the #4210 incident), so their contract lives in
  `schemaless-node-config.zod.ts`. Those two rules compose into a hole — an
  expression slot on a schemaless node is structurally unreachable by the ratchet,
  and because the reverse direction rejects unclaimed entries, it cannot be
  entered by hand either.

  `decision.conditions[].expression` sat in that hole. Its own schema says
  _"Bare CEL predicate deciding this branch"_ and its own comment names `{…}` as
  the #1491 trap, and no validator walked it — so `{lead_record.status} ==
'converted'` passed `tsc`, passed `objectstack validate`, passed registration.
  #4414 made that fail loudly at run time; this makes it fail at build time,
  which is the delay #4027 exists to remove.

  ## The fix

  The ratchet now reads **both** declaration channels:

  - **descriptor `configSchema`** — unchanged, enumerated from the live registry;
  - **`schemaless-node-config.zod.ts`** — the marker rides
    `.meta({ xExpression })` through `z.toJSONSchema`, the same channel
    `loop.collection` has used since objectui#2670.

  Spec hands the second channel over as JSON Schema
  (`getSchemalessNodeConfigJsonSchemas()`, memoized, `input` mode — the shape a
  descriptor's `configSchema` already is), so the ratchet walks both with the
  _same_ function. No second notion of "a declared expression property", which is
  the duplication a ledger exists to remove, and no `zod` dependency added to
  `service-automation`. Each channel is separately asserted non-empty, so a broken
  derivation on one side cannot hide behind the other's results.

  `SCHEMALESS_NODE_CONFIG_SCHEMAS` is also exported for anything else that needs
  to reason about all node config contracts. Additive — objectui's
  `flow-node-config` reconciliation imports each schema by name and is unaffected.

  ## The sweep

  The other schemaless slots were checked and deliberately carry no marker:
  `script.template` is a template **id**, not a body; `script.inputs` /
  `script.variables` / `subflow.input` are values that interpolate `{token}` —
  text-with-holes, the shape essentially every node config string has, already
  covered generically by `validate-flow-template-paths` and the CLI flow linter.
  A `flow-template` ledger entry means something narrower: a _reference that must
  resolve to a value_, like `loop.collection`. So `decision.conditions[]
.expression` is the only genuinely declared expression slot on the class — now
  recorded in the ledger's header so it is not re-derived.

  ## Docs corrected

  The flows guide taught the **wrong dialect** for decision predicates in three
  places (`'{order_amount} > 10000'`), plus a "braces missing in a decision
  expression" warning that inverted after #4414 — and `FlowNodeSchema`'s own
  `@example` did the same. All corrected to bare CEL, with the history stated so
  an author with a braced predicate knows what changed and why their build now
  fails. The dialect table drops from three dialects to two: predicates never take
  braces, values always do.

  Verified: 13 new/updated tests across the ratchet, the engine's registration
  pass and `@objectstack/lint` (including the exact app-crm predicate rejected at
  both `registerFlow` and `objectstack validate`); `pnpm build`, `pnpm typecheck`
  (122 tasks), `pnpm lint` and `check:docs` clean.

- 5a84d41: fix(automation): `resume` enforces the suspended screen's declared field contract (#4477)

  A `screen` node's `config.fields` is a complete input contract — the author
  declares the keys, their `required`-ness, and (via `visibleWhen`) when a field
  is even asked for. The RENDER half honoured all of it: the paused result and
  `GET …/runs/:runId/screen` carry `required` and `visibleWhen` intact. There was
  no VALIDATION half — `POST …/runs/:runId/resume` folded whatever bag it was
  handed straight into the flow variables, so a caller that skipped the dialog and
  posted here directly was unconstrained by every `required` the author wrote.
  Missing required fields, and keys the screen never declared, all completed the
  run with `success: true`.

  Screen flows are the one place where the declared field contract is the ONLY
  contract — no object schema sits behind a screen node to catch a bad bag
  downstream. The platform already enforces the analogous contract everywhere else
  this seam appears: action params (ADR-0104 D2), record writes (ADR-0113),
  approval `decisionOutputs` (#3447). This is that rule for screen resume, built in
  the same shape.

  `resume` now refuses a non-conforming submission with the new
  `AutomationResult.code` `'INVALID_SCREEN_INPUT'` (a transport maps it to **400**,
  as the automation domain route now does) and an `Invalid screen input: …` message
  that names each violation and lists the declared field names. The refusal happens
  BEFORE the suspension is consumed, so the pause stays live and the legitimate
  submission still lands.

  `visibleWhen` is evaluated against the SUBMITTED values first (layered over the
  run's variable snapshot), so a hidden field's `required` never fires — enforcing
  it would dead-end the run at a field the user was never shown, which is #3528
  reproduced server-side. A predicate that cannot be evaluated is logged and
  treated as hidden rather than visible: the client decides what the user saw, and
  a broken predicate is not evidence a field was on screen.

  Scope, deliberately narrow — three shapes keep the historical pass-through:

  - an **object-form** screen (`kind: 'object-form'`), whose `fields` is empty by
    construction because the client renders the object's own form and the write
    path enforces that object's `required` fields itself;
  - a **message-only** screen (`waitForInput: true`, no fields), which declares no
    keys and so constrains none — the same pass-through `enforceActionParams`
    gives a param-less action;
  - `signal.output`, the node-OUTPUT namespace, which belongs to the approval-style
    resume envelope rather than to the screen's collected-values channel.

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
  - @objectstack/formula@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- a648e96: fix(spec,service-automation)!: `errorHandling.maxRetries` has one default, and `strategy: 'retry'` states its count (#4247)

  `flow.errorHandling.maxRetries` was declared twice, with different values:

  - **spec** — `FlowSchema` (`automation/flow.zod.ts`): `.default(0)`
  - **engine** — `retryExecution` (`service-automation/src/engine.ts`):
    `errorHandling.maxRetries ?? 3`

  `??` fires only on `undefined`, so the winner was decided by the ROUTE a flow
  took into the engine, not by what its author wrote:

  | Path                                            | `errorHandling.maxRetries` | Retries |
  | :---------------------------------------------- | :------------------------- | ------: |
  | parsed by `FlowSchema` (`.default(0)` fills it) | `0`                        |   **0** |
  | object built by hand and fed to the engine      | `undefined`                |   **3** |

  One authored intent — "I didn't write a count" — two behaviors. The neighbouring
  `retryDelayMs ?? 1000` / `backoffMultiplier ?? 1` agreed with their `.default()`s;
  only `maxRetries` disagreed, which reads as a schema default changed from 3 to 0
  without the engine following, not as a deliberate two-track design.

  **The engine keeps no defaults of its own.** `retryExecution` now takes the
  parsed `NonNullable<FlowParsed['errorHandling']>` and destructures all five
  knobs — no `??`. This is safe because `AutomationEngine.flows` only ever holds
  `FlowSchema.parse` output (`registerFlow` parses; the version-history rollback
  re-seats an already-parsed snapshot), and it is what keeps a second set of
  defaults from growing back: a knob the spec stops defaulting becomes a compile
  error rather than a silent engine-side guess. Per Prime Directive #12 the spec
  is the one contract; a consumer-side fallback is a second de-facto one.

  **BREAKING — `strategy: 'retry'` now requires `maxRetries` >= 1.** With the
  engine's copy gone, an unstated count is unambiguously `0`, and `'retry'` with 0
  attempts runs the flow once and stops — i.e. `strategy: 'fail'` wearing another
  label, a declared capability the runtime does not deliver (Prime Directive #10
  corollary). Rather than pick 0 or 3 on the author's behalf, `FlowSchema` refuses
  the combination in both spellings (omitted → defaulted 0, and an explicit 0),
  with the prescription in the message. A retry re-runs the **whole flow from the
  start** — records created again, callouts fired again — which is not a number to
  guess for someone.

  FROM → TO:

  - `errorHandling: { strategy: 'retry' }` → `errorHandling: { strategy: 'retry', maxRetries: 3 }`
    (or `strategy: 'fail'` if no retry was intended — that is what it did).
  - `errorHandling: { strategy: 'retry', maxRetries: 0 }` → same choice, spelled out.

  Unaffected: `maxRetries: 0` under `strategy: 'fail'` / `'continue'` (neither
  reads it, and a fully spelled-out block stays legal), flows with no
  `errorHandling` at all, and every flow that already states a count — including
  the `try_catch` node's own `config.retry`, which is a separate per-region policy
  (`control-flow.zod.ts`) and is unchanged.

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

- 62a789b: Reconcile the remaining flat builtins' declared config against what their
  executors read (#4045 — the CRUD / screen / map step, after notify / http /
  connector in #4210).

  **Six executor-derived Zod contracts.** `GetRecordConfigSchema`,
  `CreateRecordConfigSchema`, `UpdateRecordConfigSchema`,
  `DeleteRecordConfigSchema`, `ScreenConfigSchema` (+ `ScreenFieldConfigSchema`)
  and `MapConfigSchema` in `automation/builtin-node-config.zod.ts`, each written
  by reading the executor rather than transcribing the descriptor literal, so the
  new bidirectional ledger test is evidence rather than a tautology. Contract
  exports only — nothing parses with them yet (#4045 step 3b, gated on the #4059
  warning data).

  **Seven capabilities the executors honour are now authorable.** Each was read
  by the executor and offered by no form — online or offline — so it was reachable
  only by hand-written metadata:

  - `get_record.fields` — the query projection, passed straight into
    `find`/`findOne`;
  - `screen.recordId` — the record `mode: 'edit'` opens; the form declared the
    edit mode while offering no way to name its target;
  - `screen.fields[].options` / `defaultValue` / `placeholder` — all three
    forwarded into the ScreenSpec the client renders, so a select field's choices
    could not be authored in Studio at all. Same nested repeater position as the
    `visibleWhen` gap #3528 was filed for;
  - `map.indexVariable` and `map.input` — the index binding and the per-item
    subflow params.

  **`map`'s undeclared `flow` alias graduates to the conversion layer.** The
  executor carried `cfg.flowName ?? cfg.flow` for a spelling no schema ever
  described — the `notify.source` shape (Prime Directive #12). The bare fallback
  is deleted and `flow-node-map-flow-alias` (protocol 17, retires at 18) renames
  it at load, including the `AutomationEngine.registerFlow` rehydration seam.

  **`assignment` is pinned as deliberately un-reconcilable**, with the reason on
  record: with no `assignments` wrapper its top-level config keys ARE the author's
  variable names, so no fixed key set can describe it and a catchall Zod would
  reconcile vacuously. What the ledger pins instead is that the form offers
  exactly the canonical `assignments` map and that the map stays open.

  With this, every builtin that publishes a `configSchema` is reconciled against
  its executor, and the ones that publish none each have a recorded reason.

- b07d829: feat(automation,spec): flow executors `parse()` their config, and undeclared config keys reject at registration (#4277)

  The #4045 reconciliation left every flat builtin with a Zod config contract that
  nothing enforced, and #4059 left `registerFlow` warning about undeclared keys it
  could not yet safely reject. #4277 installs both halves of the enforcement:

  **1. Executors parse their config (execute time).** The 12 contract-carrying
  builtins — `get_record` / `create_record` / `update_record` / `delete_record`,
  `screen`, `map`, `notify`, `http`, `loop` / `parallel` / `try_catch` — now run
  `node.config` through their Zod contract before executing
  (`service-automation/builtin/parse-config.ts`). A type or missing-`required`
  violation refuses the node as a **guard** (`errorClass: 'guard'`, not routable
  via `fault` edges — config is metadata; re-running changes nothing), naming
  every violated path. `{token}` templates stay legal: string-typed slots parse
  the raw template, and `http` — whose executor reads the interpolated config —
  parses POST-interpolation, where a whole-token template has already resolved to
  its value's real type. Exemption: a legacy flat-graph `loop` (no `config.body`)
  predates the ADR-0031 construct and is not parsed.

  **2. Undeclared config keys are rejected at `registerFlow` (registration
  time).** The #4059 warning is now an error: a config key the node type's
  descriptor `configSchema` does not declare fails registration, with the exact
  path, the declared key set, a did-you-mean, and — for keys with documented
  history (`screen.visibleIf`, `create_record`/`update_record.fieldValues`) — a
  per-key tombstone (the `UNKNOWN_KEY_GUIDANCE` pattern). Unchanged exemptions:
  `assignment` is exempt wholesale (its top-level keys ARE the author's variable
  names), schemaless types (`decision`/`script`/`wait`/`subflow`/
  `connector_action`) declare nothing so nothing can be undeclared, and keyValue
  maps stop the walk (their keys are author data). Every `registerFlow` call site
  already try/catches per flow, so a bad stored flow is skipped loudly at boot,
  never a crashed kernel.

  **Contract fix folded in:** `LoopConfigSchema.collection` is now
  `z.union([z.string().min(1), z.array(z.unknown())])` — the executor has always
  accepted an inline array (shared resolve logic with `map.collection`, which
  already declared the union), so the string-only declaration under-declared what
  it reads.

  **Migration.** If a flow stops registering: the error names the undeclared key
  and its path — rename it to the declared key it meant (`visibleIf` →
  `visibleWhen`, `fieldValues` → `fields`), or delete it (an undeclared key was
  never read, so removing it changes no behavior). If an executor of yours
  genuinely reads the key, declare it on the node type's descriptor
  `configSchema`. If a node starts refusing at run time: the refusal names each
  violated path against the contract — fix the value's type or supply the missing
  required key (e.g. `get_record` `limit` must be a number; `screen`
  `fields[].options` entries are `{ value, label }` objects; `notify` requires
  `recipients` + `title`). Retry-policy defaults now come from the contract: a
  `try_catch` `retry` block that omits `retryDelayMs` gets the documented 1000ms
  base delay where the executor historically used 0.

- a47ac06: feat(spec,automation): graduate the seven flow-node config key aliases into the conversion layer — the `readAliasedConfig` shim retires with them (#3796)

  `FlowNodeSchema.config` is an unconstrained record, so the executors were the
  only statement of which config key is canonical — and seven deprecated aliases
  lived there as tolerance the spec never declared: one behind the
  `readAliasedConfig` deprecation shim (warned, ledgered), six as open-coded
  `??` fallbacks (no warning, no ledger, no retirement path). All seven now
  graduate into the ADR-0087 D2 conversion layer as protocol-17 **live-window**
  entries: a stored flow authored with an alias is rewritten to the canonical
  key at load — `defineStack` / `validate` / `lint` and the
  `AutomationEngine.registerFlow` rehydration seam alike — with a structured
  `ConversionNotice` per rewrite, and the executors read the canonical keys
  only. The shim (`service-automation/src/builtin/config-aliases.ts`) is empty
  and deleted.

  FROM → TO (per node type; conversion entry in parentheses):

  - `get_record`/`create_record`/`update_record`/`delete_record`:
    `config.object` → `config.objectName` (`flow-node-crud-object-alias`)
  - `notify`: `config.to` → `config.recipients`, `config.subject` →
    `config.title`, `config.body` → `config.message`, `config.url` →
    `config.actionUrl` (`flow-node-notify-config-aliases`)
  - `script`: `config.functionName` → `config.function`, `config.input` →
    `config.inputs` (`flow-node-script-config-aliases`)

  One-line fix: rename the key in your flow source — values are unchanged; `os
migrate meta --from 16` rewrites all seven mechanically. Until then nothing
  breaks: the protocol-17 loader accepts and converts the old shape (window
  retires in 18).

  `actionUrl` (not `url`) is the deliberate canonical of its pair, resolving a
  contradiction where the notify descriptor documented `url` as canonical while
  the executor, tests, and examples preferred `actionUrl`: the whole downstream
  chain already uses that name (`sys_notification.action_url`, the
  channel-dispatch contract, the REST notification read model), and `url`
  elsewhere in the platform means "HTTP endpoint to call" (`http` node,
  webhooks) — a different concept from this in-app click-through target. The
  executor precedence already put `actionUrl` first, so the choice is
  behaviour-preserving; the `notify` descriptor's `configSchema` now documents
  `actionUrl`.

  Callers that hand a node config **directly** to an executor (bypassing
  `registerFlow`) no longer get alias resolution — build the config with the
  canonical keys.

- e4c61a7: Validate the expression slots a flow node's `configSchema` declares (#4027).

  A node type's designer `configSchema` and the keys its validators traverse were
  two unreconciled lists. Both the engine's `registerFlow` pass and the author-time
  `objectstack validate` pass hardcoded `config.condition` / `edge.condition` and
  assumed every other node string was a `{var}` template — so a declared expression
  property outside that hardcoded set was validated by nobody.

  That is how #3528 shipped. `screen.fields[].visibleWhen` has been on the `screen`
  descriptor since #3304, typed `xExpression: 'expression'` (bare CEL) and offered
  to authors in Studio, but no validator traversed it. An app authored the
  predicate in the _other_ dialect — `'{createOpportunity} == true'` — and it passed
  `tsc`, `objectstack validate` and registration in silence. Because `required` _is_
  enforced, a field the author had made conditional rendered unconditionally and
  blocked Submit on an input the user was never shown: the run paused forever and no
  resume was ever issued.

  Now:

  - **`FLOW_NODE_EXPRESSION_PATHS`** (`@objectstack/spec`) is the declared ledger of
    expression-bearing node config paths, each recording the dialect it takes.
  - **Both validators read it.** A malformed `visibleWhen` is a located, quoted
    error at `registerFlow` _and_ at `objectstack validate` — `node 'screen_1'
(screen) screen field visibleWhen at config.fields[1].visibleWhen`.
  - **A reconciliation ratchet** derives the expression properties from the live
    descriptors and fails CI in both directions: a new `xExpression` property with
    no ledger entry, or a stale entry no descriptor declares. It walks every
    registered builtin, not just `screen`.

  Dialects are recorded rather than assumed because there are three, and two of them
  disagree about braces: bare CEL (`{…}` is the #1491 brace-trap), single-brace
  `{var}` flow interpolation (`{…}` is correct), and the ADR-0032 §3 double-brace
  text template. Only bare-CEL slots are checked — `loop.collection` and
  `map.collection` are recorded as `flow-template` and deliberately left alone,
  since no validator implements their dialect and checking them under either of the
  other two would reject every currently-valid flow.

  `ActionDescriptor.configSchema`'s TSDoc no longer claims `registerFlow()`
  validates `config` against it. It never did: `FlowNodeSchema.config` is
  `z.record(z.unknown())`, so types, `required`, `enum` and unknown keys are still
  unenforced. The doc now states exactly what is checked and what is designer-facing
  only, so nothing relies on a guard that does not exist.

- 081aa6f: feat(spec,service-automation): every flow run reports what it actually did — selected / acted / skipped (#4354)

  `success: true` never meant "it did its job". A scheduled sweep that selects
  thirty records and writes none is, from outside, **identical** to one with
  nothing to do: same green status, same empty output, same silence, same schedule
  tomorrow. There was no signal anywhere that separated "nothing to do" from
  "broken".

  That is not theoretical. #4347 left three hotcrm production flows completely
  inert — the stalled-deal sweep found every stalled deal and nudged nobody, the
  renewal sweep booked nothing, the campaign action enrolled no leads. They ran
  daily, on time, green, for as long as they had existed, and were caught only by
  adding tests that assert on records written. Automation is exactly the category
  where nobody is watching: a UI bug files a ticket within the hour, a dead sweep
  files nothing, and the longer it runs the more normal the silence looks.

  **Every terminal run now carries a `FlowRunSummary`** — on the
  `AutomationResult`, on the run in `listRuns` / `getRun`, in the log, and in the
  database:

  ```
  [automation] run flow=stalled_deal_sweep run=run_a1b2 status=completed durationMs=142 selected=30 acted=0 skipped=30 gate=check_stalled->send_nudge:30
  ```

  - `selected` — records read by the run's data nodes
  - `acted` — records created / updated / deleted, plus effects dispatched
    (notifications delivered)
  - `skipped` — node executions a closed gate prevented, one per loop iteration
    whose conditional edge evaluated false
  - `nodes[]` — per-node terminal status with `runs` / `failures` / `skipped`
  - `gates[]` — which gates closed and how often, most-skipped first

  **The counts are declared, not sniffed.** Executors report
  `NodeExecutionResult.metrics`, because only the node knows what its result
  _means_: `update_record`'s is a row count on a bulk write and a record on a by-id
  one, `delete_record`'s can be a boolean, `notify`'s is a delivery count. An
  engine inferring from output shapes would be guessing, and a machine-readable
  count that guesses is worse than none. A node that touches no records
  (`decision`, `assignment`) reports nothing — absent is not `0`.

  **The gate is named.** A conditional out-edge that evaluates false now records a
  `skipped` step tagged with the gate that closed. That event previously left no
  trace at all, which is why #4347 was invisible: the flow selected every row and
  the loop-body edge never opened. A skipped step is explicitly _not_ a run — the
  ADR-0044 re-entry guard, per-node `runs`, and node status all exclude it, so a
  new observability signal cannot change execution semantics.

  **Queryable, so it can be alerted on rather than noticed.**
  `sys_automation_run` gains `selected_count` / `acted_count` / `skipped_count`
  columns plus a `summary_json` breakdown:

  ```typescript
  const suspect = await engine.find("sys_automation_run", {
    where: { status: "completed", selected_count: { $gt: 0 }, acted_count: 0 },
    orderBy: [{ field: "started_at", order: "desc" }],
  });
  ```

  `selected > 0 && acted == 0` over consecutive runs is a near-perfect
  broken-sweep detector. Columns, not JSON: an operator can only alert on what is
  filterable. Rows written before this carry `null`, never `0` — "not measured"
  must not read as "measured zero", or every legacy row is a false alarm the first
  time someone writes that query.

  Two details that decide whether the numbers can be trusted. The summary is
  folded from the **full** step log before history compaction, so a
  5000-iteration sweep does not silently report the ~200 steps that fit in
  `steps_json`; and rehydration reads the persisted `summary_json` rather than
  re-folding those compacted steps. A `subflow` rolls its child's totals into its
  parent, so a sweep that delegates its writes is not read as inert — the child
  keeps its own run row, and the parent's summary answers "what did this run
  cause".

  Additive throughout: `summary` is optional everywhere it appears, existing runs
  and stores keep working, and no execution behaviour changes. The one-line log
  defaults to `info` — a line nobody sees at their production level is the same
  non-signal this closes — with `AutomationServicePlugin`'s
  `runSummaryLog: 'debug' | 'off'` to turn the volume down on a very
  high-frequency flow without turning the measurement off.

  New spec exports: `FlowRunSummarySchema`, `FlowRunNodeSummarySchema`,
  `FlowRunGateSummarySchema`, `ExecutionStepMetricsSchema`,
  `ExecutionStepSkipReasonSchema` (+ inferred types); `ExecutionLog.summary` and
  `ExecutionStepLog.metrics` / `.skippedBy`. `service-automation` exports
  `summarizeRun` / `formatRunSummaryLine` so a host building its own surface
  reuses the platform's definition instead of re-deriving one.

  Does not fix #4347 itself — this is the instrument that would have caught it.

  Verified: `@objectstack/service-automation` **522 tests / 46 files** (23 new),
  `@objectstack/spec` **7165 / 279** (5 new), `@objectstack/runtime` **974 / 68**,
  `@objectstack/plugin-approvals` **330 / 13**; all eight `@objectstack/spec`
  `check:generated` gates plus `check:liveness` and `check:exported-any`; and
  `tsc --noEmit` on service-automation at its ledgered 2 pre-existing errors.

- d25a0ec: feat(spec,service-automation): a run says when its `acted` count is incomplete, instead of guessing (#4354)

  #4354 shipped `selected` / `acted` counts on every flow run, sourced from the
  executors that know what they did. Four node types were left out — and the gap
  was not cosmetic: `connector_action`, `http` and `script` are how a flow acts on
  anything _outside_ the platform, so a sweep whose whole job runs through them
  reported `acted: 0` and looked exactly like the dead sweep the counter exists to
  find. A detector that fires on healthy runs is worse than no detector: operators
  tune it out, and then it is not watching the flows that really did stop.

  Closing it needed a third answer, because for two of those nodes the platform
  genuinely cannot know:

  **`connector_action` — unknowable, and now it says so.**
  `ConnectorActionDescriptor` declares `key` / `label` / `description` /
  `inputSchema` / `outputSchema` and _nothing_ about whether the action reads or
  writes, so `crm.push_opportunity` and `crm.lookup_account` are the same shape to
  the runtime. `acted: 0` understates the create; `acted: 1` overstates the
  lookup and makes the alert never fire — #4354's original bug, one layer out.
  The executor reports `metrics: { unmeasuredEffect: true }` instead, and the run
  carries an `unmeasured` tally. Filed #4395 to let a connector declare its effect
  kind, which would turn this into a real count.

  **`http` — knowable, and now counted.** The method says it:
  `GET`/`HEAD`/`OPTIONS` report a real `acted: 0` (a read cannot write); a mutating
  call the upstream accepted reports `acted: 1`; `durable: true` reports `acted: 1`
  because the outbox row is a durable effect this run caused. A mutating call that
  was _rejected or timed out_ reports `unmeasured` — a 500 can arrive after the
  write landed, and claiming zero there would let a run swear it changed nothing
  when it had.

  **`script` — deliberately unchanged.** A registered function is contractually
  pure ("Data I/O stays on the flow graph — the function itself does no writes"),
  so every write it causes is a downstream node counting itself and "reports no
  record metrics" is accurate rather than a guess. Nothing _enforces_ that purity,
  so a function that writes behind the platform's back under-reports its run —
  filed as #4396 rather than papered over here, because a blanket
  `unmeasuredEffect` on `script` would suppress the signal on every flow that
  calls any function in order to accommodate one contract violation.

  **The alert gains a clause.** `selected > 0 AND acted = 0` becomes
  `selected > 0 AND acted = 0 AND unmeasured = 0`, and `sys_automation_run` gains
  an `unmeasured_count` column to serve it. Without that third clause the alert
  fires on every healthy connector-driven flow. The log line gains
  `unmeasured=N` — only when non-zero, since its _presence_ is what a reader must
  not miss: `acted=0` on a line that also says `unmeasured=3` means "cannot tell",
  not "did nothing".

  `unmeasured` propagates through `subflow` and `map` roll-ups (and through
  `creditChildRun` for a child that paused), so a parent whose child dispatched an
  uncountable effect knows its own `acted` is incomplete. N uncountable effects in
  a child collapse to one flag on the parent's step — the child keeps the real
  count in its own run row, and the question this feeds is boolean.

  `FlowRunSummary.unmeasured` is optional and `undefined` is **not** `0`: a run
  recorded before this existed did not track uncountable effects at all, and
  defaulting it to zero would tell an operator "fully measured" about a run nobody
  measured. Same rule the `null` count columns already follow.

  Additive: new optional fields only, no new exports, no execution behaviour
  changes.

  Verified: `@objectstack/service-automation` **546 tests / 47 files** (21 new),
  `@objectstack/spec` **7193 / 281** (2 new); all 8 `check:generated` gates plus
  the seven pure audits (liveness, empty-state, variant-docs, strictness-ledger,
  react-conformance, skill-examples, exported-any); `check:nul-bytes` and eslint
  clean.

- 4965bfa: Warn on flow-node `config` keys the node type does not declare (#4045).

  `FlowNodeSchema.config` is `z.record(z.unknown())`, so a misspelled or invented
  config key was accepted in total silence: `visibleIf` instead of `visibleWhen`
  registered cleanly, was never read, and the only symptom was a feature that quietly
  did not happen. That diagnostic vacuum is what made #3528 take three passes and two
  wrong diagnoses to resolve.

  `registerFlow` now compares each node's `config` against its descriptor's
  `configSchema` and warns on anything undeclared, located and with the declared set
  listed:

  ```
  [flow 'lead_conversion'] node 'screen_1' (screen): unknown config key `visibleIf`
    at config.fields[0].visibleIf — It is not declared by this node type's
    configSchema, so nothing reads it. Declared here: name, label, type, required,
    visibleWhen.
  ```

  The walk descends where the schema declares structure and **stops at free-form
  keyValue maps**, whose keys are author data (`filter: { status: 'stale' }`).
  Descending matters: the #3528 typo class lives _inside_ the `screen` field
  repeater, so a top-level-only comparison would miss the exact mistake this exists
  to catch.

  **Warn, never reject.** An undeclared key is an author typo, a key the executor
  genuinely reads that its hand-written `configSchema` never declared (`notify.source`
  was exactly this), or dead config. Only 4 of the 13 schema-carrying builtins have
  been audited for the second population, so hard-failing would gamble on the other
  nine. Tightening to an error is a later, per-key decision once this warning has
  measured the real distribution. Nothing about the published `configSchema` changes,
  so no consumer sees a different shape.

  `@objectstack/formula` now exports `nearestName`, the edit-distance helper already
  used for unknown-field and unknown-role suggestions, so "did you mean?"
  diagnostics share one threshold. It is deliberately a bonus rather than the
  mechanism — `visibleIf` → `visibleWhen` is distance 4 against a threshold of 3, so
  the declared set is always listed instead of only as a fallback.

  Also fixes the first real finding from the new check: `showcase_inquiry_purge`'s
  `get_record` node carried `mode: 'records'`, which no executor reads, with a comment
  crediting it for behaviour that `limit > 1` actually produces.

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

- 41dcda3: fix(spec,runtime,service-automation): `IAutomationService` declares the connector registry it already serves (#4127)

  The fourth and last of the dispatcher call sites #4127 found calling a method its
  contract never declared. The first three shipped in #4143; this one was held back
  because the fix is a **type move**, not a type addition — `ConnectorDescriptor`
  was declared in `@objectstack/service-automation`'s engine, which is one
  _implementation_ of `IAutomationService`. A contract cannot name a type that
  lives inside its own implementation, so `getConnectorDescriptors` could not be
  declared at all until the type had a home in the spec.

  **`IAutomationService` += `getConnectorDescriptors?()`.** It is the sibling of
  `getActionDescriptors`, which the contract has declared since ADR-0018: the two
  fill the flow designer's `connector_action` node together — node vocabulary from
  one, the connector → action → input pickers from the other. Only one of them was
  written down. `GET /api/v1/automation/connectors` has served the other since
  ADR-0022 by probing for the method and then re-typing its own result as `any` to
  filter on `?type=`, which is a filter on a field the type system did not know
  existed — one typo from silently matching nothing and answering an empty
  registry, which is also what this route legitimately returns when the method is
  absent, so the failure had no distinguishable symptom.

  Optional for the same reason `getActionDescriptors` is: a connector registry is a
  capability of the flow-engine implementation, not a property of every automation
  slot. A script-runner filling the slot has no connectors to describe, and the
  route answers an empty registry rather than a 404 — the `handlerReady` posture
  does not apply, since the slot is serveable and only this capability is absent.

  **`ConnectorDescriptor` / `ConnectorActionDescriptor` / `ConnectorOrigin` /
  `ConnectorState` move to `@objectstack/spec/integration`**, beside the ADR-0097
  provider contract, for the reason that file already states about itself: they are
  pure types, so a connector plugin — or a designer client, or the dispatcher —
  speaks about registered connectors depending only on the spec, with no runtime
  coupling to the engine. `ConnectorOrigin` is ADR-0097 §4 vocabulary and
  `ConnectorState` is #3017 vocabulary; neither was ever engine-private in meaning,
  only in location.

  Nothing is renamed and no shape changes. `@objectstack/service-automation`
  imports the four back and re-exports them from its index — the same names, from
  the same entry point — so every existing importer compiles unchanged.
  `ConnectorState` joins that re-export, which it should have been in all along: it
  is a required field of the descriptor the index has always exported.

  **The test fixture had already drifted, which is the concrete cost.** The
  dispatcher's connector mock declared `{ name, label, type, actions }` and omitted
  `origin` and `state` — both **required** on `ConnectorDescriptor`, and both the
  fields a designer reads to tell a live declarative instance from a plugin one
  (ADR-0097 §4), or a dispatchable connector from a degraded one that is listed
  honestly rather than hidden (#3017). Nothing caught it, because an undeclared
  return type cannot be checked against. The fixture is typed now, so it cannot
  drift again, and a new test pins that `origin` / `state` / `degradedReason`
  survive the hop through the route rather than only `name` and `type`.

  Verified: `@objectstack/spec` **7089 tests / 272 files** (2 new contract tests),
  `@objectstack/service-automation` **457 / 41**, `@objectstack/runtime`
  **218 http-dispatcher tests** (1 new), `tsc --noEmit`, `pnpm lint`, the liveness
  and empty-state gates, and the three generated-artifact gates — all clean.

- 91f4c78: fix(automation,objectql,spec): attribute `runAs:'system'` flow writes to the flow in the audit log (#4366)

  A `runAs:'system'` flow's data writes carried no attribution at all: the run
  context resolved to `{ isSystem: true }` with no `userId` and no service
  principal, so the audit writer recorded `user_id=null, actor=null` and the
  record-history UI rendered every such row as "Unknown user" — business users
  read the flow's own status mirror as data corruption.

  The `svc:*` attribution channel (ADR-0014 D2, `ExecutionContext.actor`) already
  existed for exactly this class of writer; it was simply never wired end-to-end:

  - **service-automation** — `resolveRunContext` now stamps `flowName` alongside
    `runAs`/`flowRunId`, and `resolveRunDataContext` labels a `runAs:'system'`
    run's data context `actor: 'svc:flow:<flowName>'` (fallback
    `svc:flow:automation`). Attribution only — no security middleware keys on it.
  - **objectql** — `buildSession` propagates `ExecutionContext.actor` onto the
    hook session, closing the gap that left the audit writer's
    `userId ?? session.actor` fallback unreachable from the engine path.
  - **spec** — `AutomationContext.flowName` (engine-stamped, provenance) and the
    hook session's optional `actor` field document the contract.

  No behavior change for user-attributed writes: `userId` still wins wherever it
  is present.

- 011b386: Reconcile the flat IO nodes' declared config against what their executors read
  (#4045 — the notify / http / connector step of the declared-vs-read worklist).

  **`notify` / `http` gain executor-derived Zod contracts.**
  `NotifyConfigSchema` and `HttpConfigSchema` (`automation/io-node-config.zod.ts`)
  were written by reading the executors — not by transcribing the descriptors'
  hand-written `configSchema` literals — and a new ledger test
  (`io-node-form-zod-ledger.test.ts`) compares the two key sets bidirectionally.
  Because the sides are independently written, agreement is evidence rather than
  tautology: a key survives only if the form offers it AND the executor reads it.
  Both nodes reconcile clean, with no deliberately-shallow ledger — their configs
  are flat and fully closed. Like the control-flow config Zods, these are contract
  exports: no engine path parses with them yet (that is #4045 step 3b, gated on
  the #4059 warning data).

  **`connector_action`'s mis-rooted `configSchema` is retired — it broke
  schema-driven authoring.** The executor reads only the declared
  `FlowNodeSchema.connectorConfig` sibling block, but the descriptor published a
  `configSchema` declaring `connectorId`/`actionId`/`input` as `config` keys. A
  published `configSchema` describes `node.config` by contract, and the Studio
  inspector derives its property form from it — rooting every field at
  `config.<key>` and replacing the client's hand-written `connectorConfig` form
  (with its connector/action pickers). So authoring a connector node against a
  live backend wrote the trio where nothing reads it, and the node refused to
  dispatch. The descriptor now publishes no `configSchema` (joining `wait`'s
  deliberately-schemaless class), which drops the online designer back onto the
  correct sibling-block form with no client change.

  **Stored flows that carry the mis-taught shape are healed at load.** A new
  ADR-0087 D2 conversion, `flow-node-connector-config-lift` (protocol 17, retires
  at 18), lifts `config.{connectorId,actionId,input}` onto the declared
  `connectorConfig` block — including the `AutomationEngine.registerFlow`
  rehydration seam. Declared keys win (the loose counterpart stays shadowed), and
  a lift that cannot complete the required `connectorId`+`actionId` pair leaves
  the node untouched, so a step-time refusal never becomes a load failure.

  **`connectorConfig.input` is now optional**, matching what was always true: the
  executor dispatches with `input ?? {}` and the designer's keyValue editor omits
  an empty map entirely — so the required `input` declared in the spec turned a
  no-input connector action into a `registerFlow` parse failure nothing
  downstream asked for.

- 01e124d: Graduate `notify`'s nested `source: { object, id }` into the conversion layer (#4045).

  The `notify` executor tolerated a second spelling of its click-through target with
  a bare consumer-side fallback:

  ```ts
  const object = toStr(interpolate(cfg.sourceObject ?? src?.object, …));
  ```

  Its own doc comment named `sourceObject`/`sourceId` **canonical** (they mirror the
  `sys_notification.source_object`/`source_id` columns), so the nested form was an
  alias tolerated by exactly the mechanism Prime Directive #12 calls debt — and the
  one alias on this executor that #3796 missed when it moved `to`/`subject`/`body`/
  `url` into `flow-node-notify-config-aliases`.

  It now graduates the same way `filters` → `filter` and `object` → `objectName`
  did: the conversion lifts it onto the canonical pair at load — including the
  `AutomationEngine.registerFlow` rehydration seam — and the executor's fallback is
  deleted, so no consumer-side dialect tolerance survives and the alias is declared,
  tested and retirable on schedule (it rides the existing entry's window, retiring
  at 18).

  Unlike the four renames this is a **1→2 destructuring**, which the pair mechanism
  cannot express, so it is a small custom transform. It mirrors the `??` precedence
  exactly: a canonical key already present wins and its nested counterpart is left
  shadowed, matching how a shadowed alias is treated elsewhere. `source` is dropped
  once at least one part is lifted; a `source` that is not an object, or carries
  neither key, is left untouched rather than silently deleted.

  No behaviour change for authors — both spellings keep working, and a
  half-specified target is still dropped rather than emitting a dead deep-link.

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

- 31e0be9: Flow metadata is canonicalized inside structured regions, not just at the top level (#4347).

  `registerFlow` canonicalizes a stored flow through three passes — the ADR-0087 conversion
  table, `FlowSchema.parse`, and the ADR-0032 predicate validation — and every one of them
  walked `flow.nodes` / `flow.edges` only. An ADR-0031 container keeps a whole sub-graph in
  its open `config` (`loop.config.body`, `parallel.config.branches[]`,
  `try_catch.config.try`/`.catch`), so all three stopped at the container and metadata came
  out **position-dependent**: the same node converted at the top level and did not one level
  in, and the same predicate was stored as a `{ dialect: 'cel', source }` envelope on a
  top-level edge and left a bare string on a loop-body edge.

  The reporting app shipped three sweeps whose gates never opened. Each run reported
  `success: true`, queried correctly, selected exactly the right records, and then did
  nothing — which is indistinguishable from "this sweep had no work to do" unless you assert
  on records written.

  - **`mapFlowNodes` recurses into regions**, to any depth. Every conversion in the table now
    reaches a nested node, which matters most for the two that change behaviour rather than
    spelling: a `webhook` / `http_request` callout inside a loop body kept a type no executor
    owns (the run failed), and a `delete_record` kept `config.filters`, leaving the canonical
    `filter` the executor reads absent — the erased-condition hazard
    `flow-node-crud-filter-alias` exists to prevent. Notice paths carry the region
    (`flows[0].nodes[3].config.body.nodes[1].config.filter`), so the warning points at the
    node to edit.
  - **New `normalizeControlFlowRegions`**, called at the load seam after
    `validateControlFlow`: each region is parsed through its own schema (recursively — regions
    nest), so nested edges and nodes carry the same canonical shapes as top-level ones. A
    region that does not parse is left untouched; rejecting one stays `validateControlFlow`'s
    job, so which flows register is unchanged.
  - **New `collectFlowGraphs`** yields a flow's own graph plus every nested region, each with
    a scope label. Both predicate validators iterate it instead of `flow.nodes` — the engine's
    `validateFlowExpressions` and `@objectstack/lint`'s author-time
    `validateStackExpressions` — so the `{record.x}` brace-trap they exist to catch is now
    caught inside a loop body too, naming the region (`loop 'sweep' body · edge 'b1' …`). It
    used to pass `objectstack validate`, pass registration, and fail at run time with the
    diagnostic suppressed.

  The container executors already parse their own config at run time (`parseNodeConfig`,
  #4277), so a nested predicate did evaluate correctly on current `main` — what was still
  wrong is everything that reads a region _without_ re-parsing it (the Studio designer,
  `getFlow`, the version history), and every conversion, none of which the executors replay.

  Also hardened, per the issue's secondary finding: `evaluateCondition`'s legacy `{var}`
  template path **refuses an unresolved dotted reference** instead of comparing it as a
  string. `'oppRecord.amount > 500000'` was compared `'oppRecord.amount' > '500000'` — `'o'`
  against `'5'` — so it was constantly true regardless of the amount: silently wrong in the
  _true_ direction, a gate that reports success while never gating. It now throws with the
  source and the fix (a CEL envelope, or brace the reference if the `{var}` dialect was
  meant), the same "never swallow a broken predicate" rule ADR-0032 §1c set for the CEL path.
  The `try { … } catch { return false }` around that block went with it: nothing in it throws,
  so it guarded nothing and would have swallowed the new refusal straight back into the silent
  wrong answer. Bare-word comparisons (`'{status} == active'`) and `{var}` templates are
  unchanged — only dotted references, which substitution can never leave behind, are refused.

- ffd2ce2: `registerFlow`'s remaining validators cover structured regions (#4389).

  #4347 closed the conversion and predicate halves of "metadata behaves differently
  depending on how deep it sits". Three validators were left walking `flow.nodes` only, so
  the same class stayed open one layer over: an ADR-0031 container keeps a whole sub-graph
  in its open `config`, and each of these checked _part_ of the flow while reporting on all
  of it.

  - **`validateControlFlow` recurses.** A container nested inside another container's region
    was never validated at registration — it reached run time, where `runRegion` →
    `findRegionEntry` throws mid-iteration, after the enclosing loop has begun and its side
    effects have landed. This cannot break a working flow: everything newly rejected was
    already guaranteed to throw on execution. It also closes cycle detection over nested
    regions, since region bodies are cycle-checked by `analyzeRegion` here rather than by
    `detectCycles`.
  - **`validateNodeTypes` covers region nodes.** Soft-fail. A node in a `loop` body is as
    executable as one beside it, so the warning that exists to predict `NO_EXECUTOR` went
    quiet on exactly the nodes whose run-time failure is hardest to place.
  - **`validateNodeConfigKeys` covers region nodes.** Hard-fail. `visibleIf` is the typo
    #4277 exists to catch, and moving the node into a region restored the silence #4277
    closed. Violations carry the region (`loop 'sweep' body · node 'w' …`). No
    double-reporting from the container side: all three container descriptors declare their
    region slot as a bare `nodes: { type: 'array' }` with no `items`, so the schema-lockstep
    walk stops there instead of descending twice.

  **Measured before extending the two hard-fail checks**, since widening a rejecting
  validator is a behaviour change rather than a bugfix: registering every flow in
  `app-showcase`, `app-crm` and `app-todo` through the real `registerFlow` and re-running
  each validator's own code over all 9 region graphs produced **0 new findings**. Nothing
  that registers today stops registering, so the checks land at their existing severity
  rather than staged through a warning window.

  `validateNodeInputSchemas` is deliberately **not** extended. It declares 0 uses across all
  159 example flow nodes, and its check compares a config value's runtime type against the
  declared one — so extending it would newly fail a region node carrying a `{var}` template
  string in a `number`-typed slot, which is a live authoring shape. Widening a check with a
  known false-positive mode and no demonstrated reader is not worth it; the traversal gap is
  noted on #4389 instead.

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

- 667b83e: feat(spec,automation): publish executor-derived config contracts for the schemaless flow nodes (#4278)

  The five descriptor-schemaless builtins (`decision` / `script` / `subflow` /
  `wait` / `connector_action`) deliberately publish no `configSchema`, so their
  Studio form lives only in objectui's hand-written `FLOW_NODE_CONFIG` table —
  and nothing reconciled that table against the executors. `script` had drifted:
  the form offered an `outputVariables` key nothing reads, two `actionType`
  options (`sms` / `notification`) that fail every run, a no-op default (`code`),
  and could not author the `function` / `inputs` / `outputVariable` path that
  works.

  New in `@objectstack/spec/automation` — contract exports only. Unlike their
  `builtin-node-config.zod.ts` siblings, which #4277 wired into execute-time
  parsing, no engine path `parse()`s node config with these: `script`'s legal key
  set depends on `actionType` and `decision` may branch purely on edge
  predicates, so a flat parse would either reject valid shapes or check nothing.
  Their enforcement is the objectui reconciliation test.

  - `ScriptConfigSchema` / `SubflowConfigSchema` / `DecisionConfigSchema` (+
    `DecisionConditionSchema`) — written from the executors in
    `service-automation`, the machine-readable half of the cross-repo
    reconciliation objectui's `flow-node-config` test now performs. `wait` and
    `connector_action` need no new schema — their contracts are the existing
    `FlowNodeSchema` sibling blocks (`waitEventConfig` / `connectorConfig`).
  - `SCRIPT_BUILTIN_ACTION_TYPES` (`['email', 'slack']`) and
    `SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` (`'invoke_function'`) — the `script`
    executor now builds its dispatch set from the published constant, so the
    designer's options, the dispatch set, and the "not a built-in action"
    failure message can no longer disagree.

  Undeclared-alias graduation in the same change (Prime Directive #12, the
  `map.flow` path): the `subflow` executor's bare `cfg.flowName ?? cfg.flow`
  fallback is deleted, replaced by the ADR-0087 D2 conversion
  `flow-node-subflow-flow-alias` — a stored `subflow` node authored with
  `config.flow` is rewritten to the canonical `config.flowName` at load
  (including the `AutomationEngine.registerFlow` rehydration seam). FROM
  `config.flow` TO `config.flowName`; one-line fix for hand-maintained sources:
  rename the key.

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

- 9b702dc: The `wait` executor reads its declared contract only; the loose `config` back door graduates into the conversion layer (#4045).

  `wait` keeps its contract in `waitEventConfig` — a declared, `.describe()`-annotated
  block on `FlowNodeSchema` that is in the authorable-field list, reaches the generated
  reference, and is what the showcase actually authors. Its descriptor publishes no
  `configSchema`, which is by design rather than the gap it first looks like.

  The executor nevertheless also read six loose `config` keys behind `wec.X ?? loose.X`,
  two of them (`duration`, `signal`) spellings the spec never declared anywhere. That is
  the `notify.source` shape #4050 retired: a second de-facto contract announced only by a
  code comment, so an author who wrote it got a flow that worked forever and was never
  steered to the declared spelling (PD #12). Not hypothetical: the showcase's own
  `wait_revision` node authored it (`config: { eventType: 'signal', signalName: … }`) and
  moves to the declared block here.

  - New ADR-0087 D2 conversion `flow-node-wait-event-config-lift` lifts
    `config.{eventType,timerDuration,duration,timeoutMs,signalName,signal}` onto the
    declared `waitEventConfig` block, in the executor's own `??` precedence — a declared
    value wins and its loose counterpart is left shadowed, exactly as `renameConfigKey`
    treats a shadowed alias.
  - `eventType` is stamped `'timer'` whenever the lift would otherwise leave the block
    without one. This is load-bearing: the loader parses the **converted** flow
    (`applyConversionsToFlow` → `FlowSchema.parse`) and `waitEventConfig.eventType` is
    required once the block exists — so a stored flow carrying only
    `config: { duration: 'PT1M' }` would have gone from working to failing to load.
    `'timer'` is the exact default the executor applied to that shape.
  - The executor's six `?? loose.*` fallbacks are deleted. The surviving `?? 'timer'` is
    not one: `waitEventConfig` is itself optional, and a wait node without one is a valid
    timer wait.

  Verified at the real seam: the new executor tests author the legacy shape and go through
  `registerFlow`, which is what applies the conversion, so they prove the graduation
  end-to-end on a legacy source rather than only that the executor stopped looking. A
  negative control pins the `eventType` default — deleting it from the converted output
  makes `FlowSchema.parse` throw.

  Two things this deliberately does **not** change, filed as #4158 rather than fixed in
  passing: `waitEventConfig.timeoutMs` is declared as a timeout guard but read as a timer
  duration, and `waitEventConfig.onTimeout` has zero readers anywhere — so `wait` has no
  timeout implementation at all, while the showcase authors `onTimeout: 'continue'`.
  Implementing or retracting that is a behaviour change, not a contract cleanup.

- ab16331: feat(spec)!: retire `waitEventConfig.timeoutMs` / `.onTimeout` — `wait` never had a timeout (#4158)

  Both keys described a timeout and neither delivered one, so protocol 17 removes the pair
  rather than leaving a promise the runtime does not keep (PD #10).

  - **`onTimeout`** had **zero** readers. No path ever inspected it, so neither `'fail'` nor
    `'continue'` ever happened — and its `.default('fail')` stamped a decision nothing made
    onto every wait node. The showcase set `onTimeout: 'continue'`, which did nothing.
  - **`timeoutMs`** said _"maximum wait time before timeout"_ while its only reader used it
    as the timer **duration** when `timerDuration` was absent. It did something, just not
    what it claimed.

  Together they declared a timeout `wait` does not have: a run resumes when its timer
  elapses or its signal arrives, never on a deadline. Real timeout semantics are left
  unimplemented deliberately — they should be built to a requirement, not retrofitted to
  fit two keys that happened to be declared.

  `timeoutMs` **converts to `timerDuration`** rather than being dropped, because that is
  what it did. It is stringified on the way: the target is `z.string()` while `timeoutMs`
  was `z.number()`, and `parseIsoDuration` reads a bare numeric string as milliseconds — so
  `timeoutMs: 60000` and `timerDuration: '60000'` are the same wait. Moving the number
  unstringified would have produced a block that no longer parses, which a test pins. With
  `timerDuration` already set it is dropped instead: the executor's `??` never looked past
  the duration, so it was already dead metadata.

  Both leave the **load path** (`retiredFromLoadPath`), which is the registry's existing
  split: a key retired for being _renamed_ keeps a load window, because punishing an author
  for a spelling nobody warned them about is pointless; a key that **misdescribed itself**
  does not, because silently absorbing it lets the author keep believing they configured a
  timeout. That is why `api.requireAuth`, the tool/app/flow inert keys and RLS `priority`
  all left it too. The migration chain converts stored sources mechanically; the schema
  tombstones name the replacement.

  One fixture interaction worth recording: the #4045 lift fixture used
  `waitEventConfig.timeoutMs` to demonstrate its fourth ledger entry, and the fixture
  harness replays the whole table — so its `after` described an end state protocol 17 makes
  unreachable. It now lifts `eventType` instead. The harness caught this itself.

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
  - @objectstack/formula@17.0.0-rc.1

## 17.0.0-rc.0

### Major Changes

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

### Minor Changes

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

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- 2f47489: fix(automation): a `fault` edge must not switch off a guardrail (#3863)

  A `fault` edge routes a failed node to a handler instead of aborting the run.
  That is the right primitive for the world not cooperating — an `http` node that
  404s, a connector that rate-limited, a rejected write.

  It was also, until now, routing the **refuse-to-execute** family. Those guards
  report that the METADATA is wrong, not that an operation failed: #3810
  (interpolation erased a filter condition), ADR-0049/#1888 (the run would execute
  unscoped), a data node naming no object. Because they surfaced as ordinary node
  failures, one declared edge silently disabled them.

  **The live consequence, reproduced in a test before the fix:** attach a `fault`
  edge to a `delete_record` whose filter has a typo (`{record.ownr}`), and #3810's
  protection against emptying the object was gone — the guard fired, the handler
  swallowed it, and the run reported `success: true`. That is the exact fail-open
  direction #3810 was opened to close, reachable from a single edge, and it is the
  kind of suppression an AI authoring loop reaches for first when trying to make a
  diagnostic go away.

  **Failures now carry a class.** `NodeExecutionResult.errorClass` is `'runtime'`
  (default — every existing executor keeps its current routing) or `'guard'`.
  Guard-class failures are never routed: they stay fatal with or without a `fault`
  edge, and the run fails with the guard's own message. Thrown guards are covered
  too — `UnscopedRunDataAccessError` is branded via a shared `guard-refusal`
  module, so the engine's catch path cannot become the bypass the return path no
  longer is.

  Marked as guard-class: the three `resolveNodeFilter` refusals (#3810), the four
  `objectName required` refusals, and `UnscopedRunDataAccessError` (ADR-0049).
  Genuine engine failures (`get_record(x) failed: …`) stay runtime-class and keep
  routing.

  **Also in this change**

  - `{<nodeId>.error}` now carries a failed node's message alongside the run-wide
    `{$error}`. `$error` names only the most recent failure, so a handler shared by
    two fault edges could not tell which node it was handling; `{charge_card.error}`
    is addressable from any downstream template. Additive — `$error` is unchanged.
  - Fault edges are **documented** for the first time (`content/docs/automation/flows.mdx`
    and the automation skill), including the routable/not-routable split. The skill
    entry says plainly not to add a fault edge to silence a guard error, since that
    is the misuse the class split now makes impossible.

  A run that takes a fault branch still reports success, and the failed step still
  carries `status: 'failure'` and its message in the trace — recovery does not
  erase the record of what failed (#3356/#3407).

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

- 5524f84: feat(automation): opt-in single-hop lookup expansion for record-change flow templates (#3475)

  A record-change flow can now declare `expand: ['<lookup_field>', …]` on its start
  node config so node templates resolve `{record.<lookup>.<field>}` (e.g.
  `{record.account.name}` in a notify title, closing the #3426 gap for lookups).

  The engine re-reads the declared relations AFTER identity resolution, as the
  run's OWN principal — `resolveRunDataContext` honors `runAs`, so a `runAs:'user'`
  run reads the referenced object as the **triggering user** (its RLS/FLS enforced)
  rather than system-elevated. This is what made expansion unsafe to do in the
  trigger's re-read (which has no resolved grants) and is why it lives in the
  engine (new `AutomationEngine.setRecordExpander`, bridged by the plugin to the
  same data engine the CRUD nodes use).

  Only the declared relation keys are grafted onto the run record, so bare lookup
  ids and `multiple` lookup arrays (#1872) on other relations — and the formula
  fields the trigger already hydrated — are untouched. Opt-in ⇒ zero cost when
  unused; best-effort ⇒ a re-read failure leaves the record unexpanded and never
  breaks the flow.

  The `os validate` lint rule `flow-template-lookup-traversal` (#3426/#3472) is now
  suppressed for a relation once the flow declares it in `config.expand`.

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

### Patch Changes

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

- fb90784: fix(approvals): the status mirror names the human who caused the transition (#3783)

  When an approval moves, the service writes the new status onto the business
  record (`approvalStatusField`). That write is what fires the record-change flows
  bound to that object — so it is the seam "when the invoice is approved, do X"
  runs through. It presented a bare `{ isSystem: true }` context with **no
  `userId`**, at six call sites that each know exactly who acted: a submitter
  submitting, an approver approving, rejecting, sending back, recalling.

  Combined with #3760 — which stopped letting a `runAs:'user'` run with no trigger
  user touch data — that identity gap made the most natural approvals automation
  there is unwritable in its obvious form. The cascade inherited no user, so its
  data nodes were refused, and the author's only way forward was to declare
  `runAs: 'system'` and take blanket elevation for a case where a perfectly good
  scoped identity existed at the call site all along.

  The mirror now carries the acting user. It stays `isSystem` — the record is
  normally locked while its approval is live, so only a platform write can land the
  status — because elevation and anonymity are separate choices, and this write
  only ever needed the first. Cascades now run as the deciding user with RLS
  enforced.

  - **The identity is the authenticated principal, never the request body's
    `actorId`.** `actorId` arrives from the caller (`body.actorId ?? context.userId`)
    and is only checked against the pending approver slate, never against the
    caller. That is tolerable on an audit row; promoting it to the identity of an
    RLS-scoped write would have turned a mislabelled audit trail into identity
    spoofing.
  - **Approval-by-email-link is attributed too.** ADR-0043 action links carry no
    session, so they used to decide as pure system. The single-use hashed token
    binds exactly one approver and is re-checked against the live slate at
    redemption — that is an authentication — so the redeemed decision now presents
    that approver, and an emailed approval cascades identically to one made in the
    UI.
  - **The two machine-driven transitions stay user-less on purpose**: the SLA
    escalation's auto-decision and the dead-run sweep. `system:sla` and
    `system:dead-run` are reserved audit actors, not users, and presenting one as a
    user would put a non-user in `updated_by` and in every downstream flow's
    identity. A flow that wants to react to those declares `runAs:'system'` — the
    honest answer, and now a deliberate one rather than an artefact.
  - **Attribution only — the write is not newly org-scoped.** On an
    ExecutionContext `tenantId` is a driver-scoping knob, not attribution
    (ObjectQL turns it into a tenant predicate), so passing the request's org would
    have silently no-op'd the mirror on a record whose org differs. The automation
    engine already back-fills a run's `tenantId` from the resolved user's grants.

  **Visible change:** the mirrored record's `updated_by` now names the acting user
  instead of retaining its previous value — ObjectQL's audit stamping is gated on
  the write context's `userId` alone, and `isSystem` buys no exemption. That is the
  attribution this fix is for: the approver who set the record to `approved` is now
  its last modifier.

- 9dcc0ae: fix(automation): array-form flow `triggerType` fails loudly instead of silently never firing (#3481)

  An array `triggerType` on a flow start node — the shape an author (or an AI
  authoring pass) naturally reaches for to fire on more than one event, e.g.

  ```ts
  config: { objectName: 'app_task', triggerType: ['record-after-create', 'record-after-delete'] }
  ```

  was accepted everywhere and armed nowhere. Multi-event unions are deliberately
  unsupported (only the single tokens plus the `record-after-write` create-OR-update
  union exist — see #3457), but nothing said so: `defineFlow` passed the array
  (start-node `config` is an open record), the engine's `typeof === 'string'` check
  folded it to no trigger and misclassified the flow as **manual**, so it never
  entered the trigger-binding audit, and the flow-trigger-readiness lint used the
  same `typeof` narrowing and produced no finding. The flow bound to nothing and
  never fired, with zero output at any layer — the same silent-never-fire class as
  #3427 / #3472, and the last authoring shape still slipping past every guard.

  This is a **defensive** fix — arrays remain unsupported; they now fail loudly:

  - **lint** (`validate-flow-trigger-readiness`): an array `triggerType` containing
    any `record-*` element now yields a `flow-trigger-unknown-event` warning at
    `os validate` time, steering to `record-after-write` (for created-or-updated) or
    one flow per event.
  - **engine** (`resolveTriggerBinding`): such an array is routed to the
    `record_change` trigger — exactly as an unmappable single token is — instead of
    being folded to a manual flow, so it reaches the trigger's bind-time rejection.
  - **trigger** (`record-change`): the bind-time rejection detects the array shape
    and emits a targeted warning (naming the flow, pointing at `record-after-write`
    and #3457) rather than the generic unknown-token line.

- 7ef20d0: feat(cli,automation): catch `label: 'error'` written where `type: 'fault'` was meant (#3863)

  Two of the three items left open on #3863. Both are about making the fault-edge
  contract legible; neither changes routing behaviour.

  **New lint — `flow-error-label-not-fault`.** `type: 'fault'` is what routes a
  failure; `label` is cosmetic on an ordinary edge. So this, which reads exactly
  like error handling:

  ```ts
  { source: 'charge_card', target: 'flag_for_review', label: 'error' }
  ```

  is an ordinary out-edge — and `traverseNext` runs every unconditional out-edge
  in parallel. The handler fires on every **successful** run of `charge_card`,
  concurrently with the real success path, and never on a failure. The run still
  aborts when the node fails.

  Silent in both directions: the author believes failures are handled, and never
  notices the handler running when nothing went wrong. The reading is especially
  natural for an AI author, since the label is precisely what the intent sounds
  like — which is why this is worth a build-time diagnostic rather than leaving it
  to a puzzled look at a run trace.

  Deliberately narrow, because a label IS load-bearing on a branching node: a
  `decision` / `approval` executor returns a `branchLabel` and traversal then
  prefers the edge carrying it. Edges out of those node types are excluded, as are
  conditional edges (a guarded path is not the unconditional footgun) and edges
  already typed `fault`. Matches the obvious synonyms (`error`, `failure`,
  `catch`, `on_error`, …) case-insensitively. Verified against the shipped
  showcase: no findings.

  An alias — accepting `label: 'error'` as if it were `type: 'fault'` — was
  considered and rejected: two spellings for one concept is harder to read than
  one spelling plus a diagnostic that names the fix.

  **Pinned: a handled failure does not consume a flow-level retry.** The two
  recovery mechanisms have different scopes and must not compound — a `fault` edge
  handles one node, while `errorHandling.retry` replays the flow **from the
  start**, re-running every node that already succeeded (a second notification, a
  second created record). A failure a fault edge handled is not a flow failure, so
  it does not consume a retry. That already held by construction (a routed failure
  never propagates out of `executeNode`); it is now a test, so a refactor of the
  catch path cannot quietly change it.

  Docs and the automation skill gain both points, plus a note on the edge-property
  table that `label` does not select a path except on a branching node.

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

- c88eeda: fix(automation): flow string templates serialize object tokens readably, never `[object Object]` (#3450)

  A flow string field that embeds an object-valued token — most notably the
  engine's `$error` (`{nodeId, message, ...}`, set on a failed step) in a fault
  handler's notify body — rendered as the useless `[object Object]`. The
  multi-token branch of `interpolateString` coerced every value with `String()`,
  and `notify-node` did the same for a sole `{$error}` token.

  - New shared `stringifyForTemplate` helper (`builtin/template.ts`): objects and
    arrays are JSON-serialized (so the text stays legible and still carries the
    message), primitives pass through, `null`/`undefined` render as ''.
  - `interpolateString`'s embedded-substitution branch and `notify-node`'s
    title/body coercion use it. The sole-token branch still returns the raw value
    (typed config fields keep their type), and `{$error.message}` still resolves
    to just the message string — the documented, cleanest author form.

  Split from #3425 (the readonly-strip half shipped in #3465).

- 5602211: fix(automation): close the default-routable footgun on refuse-to-execute guards (#3863)

  #3881 stopped a `fault` edge from swallowing a guard refusal, keyed on
  `NodeExecutionResult.errorClass`. That field defaults to `'runtime'`, which was
  right for compatibility — every executor written before the split keeps its
  routing — but it leaves the footgun pointing the other way: **a new guard is
  routable unless its author remembers to classify it**, and forgetting is silent.
  Nothing in the type system catches it.

  Three changes close that for the guards that exist and make the next one hard to
  get wrong.

  **`refuseNode(reason)`** — one call that returns a guard-class failure, so
  "write a guard" and "mark it un-routable" become the same act. Its doc states
  the test for using it: re-running unchanged can never succeed AND the fix is to
  edit metadata. It also states the inverse, because over-marking is not the safe
  direction — classifying a handleable condition as `guard` turns a recoverable
  integration into a dead run.

  **Five guards that were never marked** are now un-routable. All are missing
  required config or a defective graph, none can succeed on a retry:

  - `http` with no `url`
  - `subflow` with no `config.flowName`, and `subflow` exceeding max nesting depth
    (a recursive graph nests exactly as deep next run)
  - `map` with no `config.flowName`
  - `connector_action` with no `connectorId` / `actionId`

  The seven `crud-nodes` guards from #3881 move to the helper — same behaviour,
  one spelling.

  **A behavioural inventory test** drives every known guard through the engine
  with a fault edge attached and asserts it is still fatal, matching on the
  refusal text so a guard failing for a different reason cannot pass vacuously.
  Verified to have teeth: un-marking one guard fails its row immediately. The
  negative half is pinned too — a plain node failure and a thrown error must still
  route, since that is what fault edges are for.

  Deliberately **not** marked, and why: a degraded connector (#3017 says recovery
  is automatic), a collection that did not resolve to an array, a collection over
  the iteration cap, and a subflow that failed on its own. Those are conditions
  the world caused, and an author must be able to handle them.

  Considered and rejected: making `errorClass` required on the result type. It
  would enforce classification at compile time, but it breaks every node executor
  returning a failure — 281 call sites across the repo plus third-party
  executors — for a type-only gain over the helper.

- 9bf4588: fix(service-automation): bind `previous` (as null) on the create leg so start conditions can discriminate create vs update (#3427)

  The engine bound `previous` into the flow condition scope only when it was
  truthy, so on a record insert (`record-after-create`, and the create leg of
  `record-after-write`) `previous` was an **unknown** CEL variable. Any reference to
  it — including the documented `previous == null` create-discrimination — threw
  `condition failed to evaluate as CEL: Unknown variable: previous`, failing the
  whole start condition and dropping the run.

  `previous` is now always bound, to `null` when there is no prior row. So
  `previous == null` is the create leg and `previous != null` / `previous.<field>`
  the update leg — the pattern the `record-after-write` docs and the Studio flow
  designer advertise. Update-triggered flows are unaffected (`previous` was, and
  stays, the prior row there).

- 70a1ce1: fix(automation): the resume gate follows `map:` too, and the route stops accepting engine-internal variables (#3853)

  Two holes in the #3801 resume gate, both demonstrated with a repro.

  **1. The chain walk missed `map:`.** `resumeInternal` handles the two linked-run
  correlations oppositely — a `subflow:` pause _delegates_ the signal to the child,
  a `map:` pause _re-runs_ the map node — and the gate followed only the first. So
  a run parked on a `map` node was judged on `map` itself (`resumeAuthority: 'any'`)
  and let through even while the item it was waiting on sat on an `approval`.

  `map` is the batch-approval shape, and the map parent's run id is the one a
  launcher holds. Since `$mapState.started` is advanced past the in-flight item
  before the suspend, an empty-body resume of the parent **skipped that item's
  approval outright**, orphaning its still-pending request; a later real decision
  then bubbled into a parent already waiting on the next item, cascading the
  misalignment.

  The walk now follows both prefixes: a linked-run pause is waiting on a CHILD, so
  the child's node carries the authority — the gate reads _the item, not the loop_.

  **2. Resume `inputs` could write the engine's `$` namespace.** They are applied
  as bare flow variables, so a caller could set the exact handoff keys the engine's
  map bubble uses (`<nodeId>.$mapItemDone` / `$mapItemOutput`) and have the map
  record a per-item result for a decision nobody made — the node id is readable
  from `GET /automation/:name`. The same reached `$runId`, which `approval` /
  `wait` nodes use to correlate external state back to a run.

  `POST /automation/:name/runs/:runId/resume` now answers **400** when `inputs`
  names anything in the engine namespace (`$…`, or a `.$` segment). Enforced at the
  transport, not in the engine, so the in-process bubble keeps working — the same
  trust split the gate itself uses.

  Nothing changes for author-declared variables: `{ new_assignee: 'ada' }` and
  dotted names like `collect.note` are unaffected. If you were driving a batch-
  approval `map` by resuming the map's own run id, resume the **item's** run
  through its owning service instead (e.g. `client.approvals.approve`) — the map
  advances itself when the item completes.

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
  - @objectstack/formula@17.0.0-rc.0

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
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0

## 16.0.0

### Minor Changes

- 780b4b5: feat(automation): schema-aware flow-condition validation at registration (#1928)

  `registerFlow` now runs the same schema-aware condition checks as
  `objectstack build` — so a flow registered dynamically (via the API / Studio,
  bypassing the build lint) still gets the guardrail. When the host wires an
  object-schema resolver, a flow condition that references an unknown field,
  likely-typos a field name, or does arithmetic/ordering on a text/boolean field
  against a number is surfaced as an **advisory warning** (logged), pointing at
  the object's real schema.

  - New `AutomationEngine.setObjectSchemaResolver(resolver)` bridge (mirrors
    `setFunctionResolver`); `AutomationServicePlugin` wires it to
    `objectql.registry.getObject` in `start()`, before the flow pull, so
    registry-sourced flows are covered too.
  - **Strictly additive / zero regression**: the fatal set is unchanged (syntax,
    brace-in-CEL, unknown-function still throw); everything the schema pass adds is
    logged, never thrown, and the whole thing is a no-op when no resolver is wired.
    Flow conditions bind fields flat, so the check runs in `flattened` scope
    (flow variables stay `dyn` and are never flagged; equality is runtime-safe).

  Builds on the tier-4 type-soundness check in `@objectstack/formula` /
  `@objectstack/lint` (#1928).

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- 1e145eb: fix(automation): region-aware run-history compaction keeps loop containers + early failures (#3234)

  `compactStepsForHistory` bounded a terminal run's persisted step log to the last
  `MAX_PERSISTED_HISTORY_STEPS` entries with a plain tail-slice. With the ADR-0031
  structured-region step logs (#1505) a single `loop` can emit
  `iterations × body-steps` entries, so the tail-slice dropped the
  `loop`/`parallel`/`try_catch` **container** step (it precedes all its body steps)
  and every early iteration — leaving `getRun`/`listRuns` (after a process restart
  or ring-buffer eviction) with body steps the Runs surface could no longer nest,
  and silently hiding an early failure.

  Compaction is now region-aware (new exported `compactStepLogForHistory`): over
  budget it keeps the run's structural backbone — every top-level step (including
  the region container steps) and every failure, each pulled in with its ancestor
  container chain — plus the most recent body steps, order-preserving and
  hard-capped at `max` so `steps_json` stays bounded (#2585). Every retained body
  step keeps its enclosing container(s), so the compacted log never contains an
  orphan and the observability surface's per-iteration / per-region nesting still
  reconstructs.

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

- 02eafa5: test(automation): end-to-end coverage for the #1928 object-schema resolver wiring

  Adds a kernel-level integration test proving `AutomationServicePlugin` bridges
  the engine's object-schema resolver to the live `objectql.registry.getObject` at
  `start()` (fields + types resolved from the registry), and that a flow
  registered through the running kernel with a text field misused in arithmetic
  emits the tier-4 advisory — while a sound condition stays quiet. Locks in the
  production integration point that the engine-level unit tests (which set the
  resolver by hand) could not exercise. Test-only; no behavior change.

- b320158: feat(automation): publish configSchemas for the keyValue-capable nodes (flow designer parity, #3304)

  The `assignment`, `create_record` / `update_record` / `delete_record` /
  `get_record`, and `screen` nodes shipped no `configSchema`, so the flow designer
  had no server-driven form for them. Each descriptor now carries one that mirrors
  the objectui hardcoded field group field-for-field: object references as `xRef`,
  the screen repeater's `visibleWhen` as `xExpression: 'expression'`, and the
  free-form maps (`fields` / `filter` / `assignments` / `defaults`) as JSON-Schema
  open objects (`additionalProperties: true`, no fixed `properties`) — the shape
  the designer's schema adapter renders with its flat keyValue editor. Values stay
  fully permissive because real metadata carries operator objects (`{"$ne": null}`),
  `{var}` templates, and non-string literals.

  Deliberately still schemaless (no online/offline divergence exists for a node
  with no configSchema, and a partial schema would drop editors): `decision`
  (virtual Target column derived from edges), `wait` (top-level `waitEventConfig`),
  `script` (actionType-conditional form), `subflow` (top-level `timeoutMs`).

  Additive and backward-compatible: descriptor metadata only, no runtime behavior
  change. Requires an objectui with the keyValue schema mapping (objectui #2708)
  for the maps to render as structured editors; older designers keep their
  hardcoded forms.

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

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- f8c1b69: feat(automation): publish a configSchema for the `map` node (flow designer parity, #3304)

  The `map` (sequential multi-instance) node shipped no `configSchema`, so the flow
  designer fell back to its hardcoded field group online and to raw Advanced-JSON
  where that wasn't present. Its descriptor now carries a structured `configSchema`
  that mirrors the objectui hardcoded `map` field group field-for-field —
  `collection` (marked `xExpression: 'template'`, an `interpolate()` `{items}`
  template, same as `loop.collection`), `flowName` + `itemObject` as typed
  references (`xRef`), and `iteratorVariable` / `outputVariable` as plain text — so
  the online (schema-driven) and offline forms match.

  `map` is the one previously-schemaless flow node whose fields are all scalars and
  typed references, so it maps cleanly through objectui's `jsonSchemaToFlowFields`
  with zero regression. The remaining schemaless nodes lean on editor kinds the
  schema→fields adapter does not yet reproduce (`keyValue` maps, the decision
  virtual `target` column, `wait`'s top-level block), and are deferred to #3304
  until that adapter is extended. Additive and backward-compatible: no runtime
  behavior change; an older designer that ignores the schema is unaffected.

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

## 16.0.0-rc.1

### Patch Changes

- b320158: feat(automation): publish configSchemas for the keyValue-capable nodes (flow designer parity, #3304)

  The `assignment`, `create_record` / `update_record` / `delete_record` /
  `get_record`, and `screen` nodes shipped no `configSchema`, so the flow designer
  had no server-driven form for them. Each descriptor now carries one that mirrors
  the objectui hardcoded field group field-for-field: object references as `xRef`,
  the screen repeater's `visibleWhen` as `xExpression: 'expression'`, and the
  free-form maps (`fields` / `filter` / `assignments` / `defaults`) as JSON-Schema
  open objects (`additionalProperties: true`, no fixed `properties`) — the shape
  the designer's schema adapter renders with its flat keyValue editor. Values stay
  fully permissive because real metadata carries operator objects (`{"$ne": null}`),
  `{var}` templates, and non-string literals.

  Deliberately still schemaless (no online/offline divergence exists for a node
  with no configSchema, and a partial schema would drop editors): `decision`
  (virtual Target column derived from edges), `wait` (top-level `waitEventConfig`),
  `script` (actionType-conditional form), `subflow` (top-level `timeoutMs`).

  Additive and backward-compatible: descriptor metadata only, no runtime behavior
  change. Requires an objectui with the keyValue schema mapping (objectui #2708)
  for the maps to render as structured editors; older designers keep their
  hardcoded forms.

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- f8c1b69: feat(automation): publish a configSchema for the `map` node (flow designer parity, #3304)

  The `map` (sequential multi-instance) node shipped no `configSchema`, so the flow
  designer fell back to its hardcoded field group online and to raw Advanced-JSON
  where that wasn't present. Its descriptor now carries a structured `configSchema`
  that mirrors the objectui hardcoded `map` field group field-for-field —
  `collection` (marked `xExpression: 'template'`, an `interpolate()` `{items}`
  template, same as `loop.collection`), `flowName` + `itemObject` as typed
  references (`xRef`), and `iteratorVariable` / `outputVariable` as plain text — so
  the online (schema-driven) and offline forms match.

  `map` is the one previously-schemaless flow node whose fields are all scalars and
  typed references, so it maps cleanly through objectui's `jsonSchemaToFlowFields`
  with zero regression. The remaining schemaless nodes lean on editor kinds the
  schema→fields adapter does not yet reproduce (`keyValue` maps, the decision
  virtual `target` column, `wait`'s top-level block), and are deferred to #3304
  until that adapter is extended. Additive and backward-compatible: no runtime
  behavior change; an older designer that ignores the schema is unaffected.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 780b4b5: feat(automation): schema-aware flow-condition validation at registration (#1928)

  `registerFlow` now runs the same schema-aware condition checks as
  `objectstack build` — so a flow registered dynamically (via the API / Studio,
  bypassing the build lint) still gets the guardrail. When the host wires an
  object-schema resolver, a flow condition that references an unknown field,
  likely-typos a field name, or does arithmetic/ordering on a text/boolean field
  against a number is surfaced as an **advisory warning** (logged), pointing at
  the object's real schema.

  - New `AutomationEngine.setObjectSchemaResolver(resolver)` bridge (mirrors
    `setFunctionResolver`); `AutomationServicePlugin` wires it to
    `objectql.registry.getObject` in `start()`, before the flow pull, so
    registry-sourced flows are covered too.
  - **Strictly additive / zero regression**: the fatal set is unchanged (syntax,
    brace-in-CEL, unknown-function still throw); everything the schema pass adds is
    logged, never thrown, and the whole thing is a no-op when no resolver is wired.
    Flow conditions bind fields flat, so the check runs in `flattened` scope
    (flow variables stay `dyn` and are never flagged; equality is runtime-safe).

  Builds on the tier-4 type-soundness check in `@objectstack/formula` /
  `@objectstack/lint` (#1928).

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- 1e145eb: fix(automation): region-aware run-history compaction keeps loop containers + early failures (#3234)

  `compactStepsForHistory` bounded a terminal run's persisted step log to the last
  `MAX_PERSISTED_HISTORY_STEPS` entries with a plain tail-slice. With the ADR-0031
  structured-region step logs (#1505) a single `loop` can emit
  `iterations × body-steps` entries, so the tail-slice dropped the
  `loop`/`parallel`/`try_catch` **container** step (it precedes all its body steps)
  and every early iteration — leaving `getRun`/`listRuns` (after a process restart
  or ring-buffer eviction) with body steps the Runs surface could no longer nest,
  and silently hiding an early failure.

  Compaction is now region-aware (new exported `compactStepLogForHistory`): over
  budget it keeps the run's structural backbone — every top-level step (including
  the region container steps) and every failure, each pulled in with its ancestor
  container chain — plus the most recent body steps, order-preserving and
  hard-capped at `max` so `steps_json` stays bounded (#2585). Every retained body
  step keeps its enclosing container(s), so the compacted log never contains an
  orphan and the observability surface's per-iteration / per-region nesting still
  reconstructs.

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

- 02eafa5: test(automation): end-to-end coverage for the #1928 object-schema resolver wiring

  Adds a kernel-level integration test proving `AutomationServicePlugin` bridges
  the engine's object-schema resolver to the live `objectql.registry.getObject` at
  `start()` (fields + types resolved from the registry), and that a flow
  registered through the running kernel with a text field misused in arithmetic
  emits the tier-4 advisory — while a sound condition stays quiet. Locks in the
  production integration point that the engine-level unit tests (which set the
  resolver by hand) could not exercise. Test-only; no behavior change.

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
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/formula@15.1.1

## 15.1.0

### Minor Changes

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

- f531a26: feat(connectors): ADR-0096 runtime re-materialization of declarative connectors (#2977 follow-up)

  Provider-bound declarative `connectors:` instances (ADR-0096) previously
  materialized only at boot — a connector published from Studio while the server
  ran did not become dispatchable until a restart. `materializeDeclaredConnectors`
  is now a **reconcile** run both at boot and on `metadata:reloaded`:

  - **Add** newly-declared instances, **tear down** removed / newly-`enabled:false`
    ones (calling their `close`, e.g. an MCP connection), and **re-materialize**
    only instances whose signature — a stable hash of `provider` + `providerConfig`
    - `auth` + identity — changed. An unchanged MCP instance is never needlessly
      reconnected on an unrelated metadata reload.
  - **Boot stays fatal** ("fail loudly"): unknown provider / invalid providerConfig
    / unresolvable credentialRef / name conflict aborts startup. **Reload is soft**:
    the same problems are logged and the offending entry skipped, so a bad publish
    never crashes a running server; a changed instance's old connector keeps
    serving until its replacement materializes successfully.

  Also: `ConnectorDescriptor` (served by `GET /api/v1/automation/connectors`) now
  carries an `origin` field (`'plugin' | 'declarative'`), so a designer can
  distinguish a materialized declarative instance from a plugin-registered
  connector.

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
  - @objectstack/formula@15.1.0

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

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0

## 14.5.0

### Minor Changes

- 33ebd34: ADR-0057 (#2834): `retention.onlyWhen` status predicate — mixed tables can scope the age reap.

  - **spec**: `lifecycle.retention.onlyWhen` — a row filter (per-field equality or `{ $in: [...] }`) the retention window applies to; rows outside it are retained regardless of age. Rejected when combined with rotation `storage` (shard DROPs ignore filters) or `archive` (the Archiver moves rows by age alone).
  - **objectql**: the LifecycleService Reaper merges `onlyWhen` into every retention delete, including tenant-override passes.
  - **service-automation**: the run-history age sweep is now declarative — `sys_automation_run` declares `retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } }` and the platform Reaper owns it; suspended (`paused`) runs never match. The plugin's own sweep loop is retired: `ObjectStoreSuspendedRunStore.pruneHistory`, the `DEFAULT_RUN_HISTORY_RETENTION_DAYS` export, and the `runHistoryRetentionDays` / `runHistorySweepMs` plugin options are removed (launch-window breaking-as-minor). The write-time per-flow overflow cap (`runHistoryMaxPerFlow`) stays.

### Patch Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0

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
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0

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
  - @objectstack/formula@14.0.0

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
  - @objectstack/formula@13.0.0

## 12.6.0

### Minor Changes

- 0adcc1c: Flow `notify` node: support a click-through target so inbox notifications can be clicked into the related record (#2675).

  The `notify` node now reads `sourceObject` / `sourceId` (or the nested `source: { object, id }` form) and `actorId` from its config and forwards them to the messaging service, which persists `sys_notification.source_object` / `source_id` / `actor_id` and synthesizes a `/{object}/{id}` inbox deep-link. Both keys interpolate flow variables (e.g. `sourceId: '{new_quotation.id}'`), and a half-specified target (object without id, or vice versa) is dropped so the inbox never renders a dead link. `url` is now accepted as an alias for `actionUrl` (an explicit URL still overrides the synthesized link). The node also publishes a `configSchema` documenting all accepted keys for the Studio form.

  Previously the node consumed only `recipients` / `title` / `message` / `channels`, so every notification it emitted had `source_object` / `source_id` = `null` and could not be clicked through to a record.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0

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

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0

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
  - @objectstack/formula@12.2.0

## 12.1.0

### Minor Changes

- 8bcd994: Automation run observability follow-ups (#2585): retention for `sys_automation_run` run history, and durable single-run detail.

  **Retention (closes the unbounded-growth risk #2581 introduced).** Terminal run-history rows are now bounded by default, ADR-0057 posture:

  - A write-time per-flow cap keeps the newest 100 terminal runs per flow (`runHistoryMaxPerFlow`, `0` disables).
  - A default-on periodic sweep deletes terminal rows older than 30 days (`runHistoryRetentionDays`, `0` disables; `runHistorySweepMs` tunes the interval, default 1 h).
  - Suspended (`paused`) rows are live resumable state and are never pruned.

  **Durable single-run detail.** `AutomationEngine.getRun(runId)` now falls back to the durable history row when the run is no longer in the in-memory buffer (e.g. after a restart), and terminal rows persist a bounded per-node step log (`steps_json`: newest 200 steps, stacks stripped, 64 KB cap) — so "open a past failed run and see which node blew up" survives a restart. New `SuspendedRunStore.loadTerminal(runId)` backs this; `RunRecord` gains `finishedAt` and `steps`.

- 497bda8: feat(automation): honor flow deployment status for enable/disable + expose runtime enable/bound state

  The engine bound and ran **every** registered flow, ignoring the flow's
  persisted `status` — so an author had no way to turn an automation off (short of
  deleting it) and no way to see whether one was actually live. This is the engine
  half of the Studio's "clear on/off switch + visible enabled/bound status".

  - **`registerFlow` now honors `status`:** a flow whose deployment `status` is
    `obsolete` or `invalid` is treated as **disabled** — its trigger is not bound
    and `execute()` refuses it. `draft` / `active` — and any legacy flow with no
    explicit status — stay enabled, so **existing flows are unaffected** (zero
    regression; this is the on/off switch persisting via the existing `status`
    field, applied on the next publish rebind). A status flip back OUT of a
    disabled state re-enables on re-register even if the flow had been turned off;
    a runtime `toggleFlow()` override on a still-enabled flow is preserved.

  - **New `getFlowRuntimeStates()` + `GET /api/v1/automation/_status`:** returns
    `[{ name, enabled, bound }]` for every registered flow — the truth behind the
    Studio's status badges (persisted `status` is metadata; whether a flow is
    actually enabled and wired to its trigger is engine state). Underscore-prefixed
    so no flow name can shadow the route; degrades to an empty list on an older
    service.

  Tests cover: draft/active flows bind + enable (unchanged), an `obsolete` flow is
  neither bound nor enabled and `execute()` refuses it, a status flip
  obsolete→active re-enables + re-binds, and the `_status` route shape.

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0

## 12.0.0

### Minor Changes

- ffafb30: feat(automation): durable run history — every terminal run leaves a queryable record with its failure reason

  Automation runs were observable **only in memory**: the engine kept the last N
  `ExecutionLogEntry` records in a ring buffer, so "did this flow run, and why did
  it fail?" could not be answered after a process restart (or once the buffer
  evicted the entry), and a failed run surfaced no reason at all. This was the
  biggest silent-trust gap for anyone authoring automations — a flow could stop
  firing or start failing with nothing durable to inspect.

  `sys_automation_run` — previously the ADR-0019 store for _live suspended_ runs
  only — becomes a durable **run-history** table. On every terminal run the engine
  mirrors a row through the `SuspendedRunStore` (`recordTerminal`): `status`
  (`completed` / `failed`), `finished_at`, `duration_ms`, and, for a failure, the
  `error` message a designer needs to fix it. `listRuns()` merges this durable
  history with the in-memory buffer (in-memory wins on id, newest-first) so the
  Studio "Runs" surface shows runs that predate the current process.

  The design is **safe and additive**. Terminal history rows use a `run_`-prefixed
  id, disjoint from live suspended runs (which key on the raw `runId` with
  `status: 'paused'`), so the suspend save/load/delete/list path is untouched and
  resume sweeps (`list()` filters `status: 'paused'`) never see history rows.
  Persisting is **best-effort and fire-and-forget** — a history-write failure is
  logged and swallowed, never breaking the run that produced it. New object fields
  (`finished_at`, `duration_ms`, `error`) are all optional and the `status` enum
  gains `running` / `completed` / `failed` alongside the existing `paused`.

  Verified end-to-end on a clean showcase instance: a schedule-triggered flow and
  seven task-completion flows each left durable `completed` rows; a genuinely
  failing flow (`showcase_resilient_sync`) left a `failed` row carrying its
  `try_catch` failure reason; a live `paused` suspended run coexisted without
  collision; and after a full process restart the `failed` row — reason intact —
  was still queryable via `/api/v1/data/sys_automation_run`. New `run-history.test.ts`
  covers completed/failed persistence, read-across-restart, and best-effort isolation.

### Patch Changes

- f84f8d5: fix(automation): bind flow triggers on a cold boot, not just after an HMR reload

  Record-triggered (and other trigger-typed) flows silently never fired on a
  fresh process start — in dev and in production. The automation service's
  boot-time flow pull reads `ql.registry.listItems('flow')`, which is **empty for
  flows defined inline in an app manifest** — `registry.registerApp()` stores the
  app under type `'app'` and never promotes its inline flows to standalone
  registry `'flow'` items. The re-sync that _could_ see them only ran on the
  `metadata:reloaded` hook, which never fires on a cold boot (`os dev` restarts
  the process on recompile rather than firing it, and production never reloads).

  Net effect: after any real restart, **no flow bound its trigger**, so
  record-change automations did not fire at all.

  Fix: bind flows at `kernel:ready` from `protocol.getMetaItems({ type: 'flow' })`
  — the canonical flattened flow view that `GET /meta/flow` serves and that does
  surface inline app flows — once every plugin has finished `init()`/`start()`
  (so the app, hence its flows, is registered). `registerFlow` is idempotent, so
  re-binding a flow the boot pull already registered is harmless.

  Verified end-to-end on a clean instance: before the fix, updating a record
  fired **0** flows (0 bound at boot); after, a cold boot binds all flows and a
  single record update fires every matching record-triggered flow. Regression
  test boots a kernel with an inline-app record-triggered flow served only via
  `protocol.getMetaItems` and asserts it is bound after `bootstrap()` alone with
  no `metadata:reloaded` fired — it fails on the pre-fix code.

- 9693a36: fix(automation): bind a flow published while the server runs, without a restart

  Follow-up to #2560 (cold-boot flow binding). A flow **published while the server
  is running** — the Studio online-authoring journey: author a record-triggered
  automation, publish it, immediately update a matching record — did **not** fire.
  Its trigger only bound on the next process restart.

  Two gaps, both fixed:

  1. **The publish path fired no rebind signal.** `POST /packages/:id/publish-drafts`
     → `protocol.publishPackageDrafts` promotes the drafts to active but emitted no
     event the automation service listens to. The runtime dispatcher now announces
     `metadata:reloaded` after a successful publish — the same signal a dev artifact
     reload fires (`MetadataPlugin._reloadAndAnnounce`) — so boot-cached consumers
     re-sync without a restart.

  2. **The runtime re-sync read the wrong source.** The automation service's
     `metadata:reloaded` re-sync pulled `metadata.list('flow')`, which returns 0 in a
     real running server (it does not surface inline app flows), so even when the
     hook fired it bound nothing. It now reads `protocol.getMetaItems({ type: 'flow' })`
     — the same flattened flow view #2560's cold-boot bind and `GET /meta/flow` use —
     while keeping the teardown of flows removed from the artifact. A failed or
     unavailable protocol read is a no-op and never tears down live flows.

  Production is largely unaffected (a deploy reboots the process, so #2560's
  cold-boot bind covers it); this closes the gap for dev and single-instance
  Studio authoring.

  Verified end-to-end on a clean instance: authored a record-triggered flow in a
  package, published it via `POST /packages/:id/publish-drafts` **without
  restarting**, then updated a matching record and observed the flow fire (before
  the fix it did not). New regression tests boot a kernel whose protocol serves a
  flow only after boot and assert `metadata:reloaded` binds it — and that the
  re-sync reads the protocol, not `metadata.list` — both failing on the pre-fix code.

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
  - @objectstack/formula@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/formula@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0

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
  - @objectstack/formula@11.1.0

## 11.0.0

### Major Changes

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

### Minor Changes

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

### Patch Changes

- 4b5ec6e: fix(automation): re-bind scheduled-flow jobs on `os dev` hot-reload

  Editing a schedule-triggered flow under `objectstack dev` silently kept firing
  the OLD definition until a full server restart. The dev watcher recompiles
  `dist/objectstack.json` and MetadataPlugin reloads it into the MetadataManager
  (so GET /meta reads + UI HMR are fresh), but the AutomationEngine pulls its flow
  definitions and trigger/job bindings ONCE at boot — nothing re-registered them
  on reload. So the scheduled job bound at boot kept running the pre-edit flow
  (old `runAs`, schedule, or logic) on its timer, with no signal that the edit had
  no effect.

  Fix: MetadataPlugin now fires a generic `metadata:reloaded` hook after each
  artifact reload (the HMR POST handler and the server-side artifact-file watcher;
  never on the initial boot load). AutomationServicePlugin subscribes and re-syncs
  the engine from the metadata service — re-registering every current flow
  (idempotent: `registerFlow` re-binds the trigger, and `ScheduleTrigger.start`
  cancels + reschedules the job) and unregistering flows removed from the artifact
  so their jobs stop firing. This covers all auto-triggered flow types
  (schedule / record-change / api), not just scheduled ones, since record-change
  flows were also executing their boot-time definitions after an edit. Production
  deployments are unaffected — nothing reloads the artifact there.

- b6a4972: fix(automation): honor the `assignments` wrapper shape on assignment nodes

  The built-in `assignment` node executor set each TOP-LEVEL `config` key as a flow
  variable. But the surfaces that author these nodes all emit an `assignments`
  wrapper instead:

  - Studio's visual Assignment editor → `config: { assignments: { <var>: <value> } }`
  - bundled example flows (app-crm, showcase) → `config: { assignments: [{ variable, value }] }`

  So a node designed in Studio (or any of the shipped examples) silently set a
  single variable literally named `assignments` to the whole map/array and never
  set the intended variables — it passed build and no-oped at run time, leaving
  every downstream reference unresolved.

  The executor now normalizes all three shapes (`assignments` map, `assignments`
  array of `{ variable | name | key, value }`, and the legacy flat
  `{ <var>: <value> }`) and interpolates `{var}` templates in the values, matching
  the CRUD / screen nodes. Adds `logic-nodes.test.ts` covering each shape as a
  regression guard.

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
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/formula@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/formula@10.0.0
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
  - @objectstack/formula@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/formula@9.9.1

## 9.9.0

### Minor Changes

- 134043a: feat(automation): declarative screen-flow completion/error messages + action `errorMessage`

  A screen flow can now declare `successMessage` / `errorMessage` (FlowSchema). The
  engine surfaces them on the terminal `AutomationResult` (`successMessage` on
  success, `errorMessage` on failure), so the UI flow-runner shows a meaningful
  toast instead of a generic "Done" / the raw error — no manual "success screen"
  node needed. The CRM convert-lead wizard sets a friendly completion message.

  Also exposes `errorMessage` on the UI Action schema. The runtime (ActionRunner)
  already honoured it; it just wasn't declarable in the spec — closing a
  spec↔runtime gap so authors can set a friendly failure toast.

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

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [c17d2c8]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/formula@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/core@9.7.0

## 9.6.0

### Minor Changes

- 6c82aa0: fix(automation): `create_record` outputVariable exposes the created record so `{var.id}` resolves (#1873)

  A `create_record` node stored only the created record's **id string** in its
  `outputVariable`, so a later node referencing `{var.id}` (or any `{var.<field>}`)
  traversed into a string and resolved to empty — the created record was
  effectively unreferenceable downstream. `get_record` already stores the record
  object (that's why `{rec.field}` works there); `create_record` now matches.

  Behavior change: `outputVariable` holds the created **record** (an object with
  `id` + fields), not the bare id. Reference the id explicitly as `{var.id}`. A
  bare `{var}` that previously yielded the id now yields the record — update such
  references to `{var.id}` (the in-repo `app-todo` create-task flow was updated).
  When the driver returns a bare id, it's wrapped as `{ id }` so `{var.id}` still works.

- dc8b2de: feat(automation): resolve & validate `script`-node callables; first-class function registration (#1870)

  A flow `script` node that pointed at an unregistered callable (or declared no
  `actionType`/`function` at all) built fine and silently did nothing at runtime.
  Two changes close that gap:

  - **Loud runtime resolution.** The built-in `script` executor now resolves its
    target in order — built-in side-effect (`email`/`slack`) → a registered
    function (`config.function`, or a bare `config.actionType` that matches no
    built-in) → otherwise **fail the step loudly**. The old `(no-op handler)`
    success path is gone, so an unwired callable can no longer quietly skip.
  - **First-class registration path.** `AutomationEngine.setFunctionResolver()` /
    `resolveFunction()` bridge flow nodes to the host function registry. The
    automation plugin wires it to ObjectQL's `resolveFunction` (populated from
    `bundle.functions` / `defineStack({ functions })`), so an authored package can
    register a function and call it from a `script` node:
    `{ type: 'script', config: { function: 'my_fn', inputs: { … } } }`.
  - **Build-time structural check.** `objectstack build` now flags a `script` node
    that declares neither `actionType` nor `function` (the `actionType: undefined`
    repro). Function _existence_ is verified at runtime — functions are code, not
    serialized into the artifact.

- 1402be0: feat(automation): script-node `outputVariable` + interpolated inputs — the pure-function pattern (#1870)

  A flow `function` (script node) is a PURE compute step: it receives `ctx.input`
  and RETURNS a value. Two additions make the value usable on the flow graph
  without giving functions raw data access (which would hide I/O from the graph
  and bypass governance):

  - `config.outputVariable` exposes the function's return value as a flow variable,
    so a later declarative node persists it (`update_record fields: { x: '{ai.x}' }`).
  - `config.inputs` are now interpolated against the live flow variables, so a
    function can consume a prior node's output (`inputs: { id: '{record.id}' }`).

  Data writes stay declarative (visible, governed, build-checkable); data-lifecycle
  side effects belong in L2 hooks (which get `ctx.api`), not flow functions.

### Patch Changes

- b0df09c: fix(automation): record-change flows see multi-lookup fields + support array-index interpolation (#1872)

  A `multiple: true` lookup is an array column the data driver may not echo back
  on create, so it was absent from the after-create record a record-change flow
  saw — `record.target_channels != null` was false and `{rec.target_channels.0}`
  resolved empty. Two fixes:

  - **trigger-record-change**: `buildContext` now reads the lifecycle hook's
    `input.data` (the actual key objectql uses for insert/update; it had been
    reading a non-existent `input.doc`) and overlays the after-row on it, so fields
    the driver didn't return stay visible to the flow's condition + interpolation.
  - **service-automation**: `{var.path.N}` numeric segments now index into arrays,
    so a multi-value lookup can be referenced positionally (`{record.channels.0}`).

- ab942f2: feat(automation): accept `functionName` alias + `invoke_function` marker on script nodes (#1870 DX)

  AI-authored templates commonly emit `config: { actionType: 'invoke_function', functionName: 'my_fn' }`,
  but the runtime only read `config.function`. Now:

  - `config.functionName` is accepted as an alias for `config.function` (runtime + build).
  - `actionType: 'invoke_function'` is treated as a MARKER ("call the named function") — the
    name comes from `function`/`functionName`, not from actionType itself; it no longer
    tries to resolve a function literally named `invoke_function`.
  - `objectstack build` errors on `actionType: 'invoke_function'` with no `function`/`functionName`
    (it names no callable) instead of letting it fail at runtime.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1

## 9.5.0

### Minor Changes

- f19caef: feat(P1-2): messaging retention default-on; automation log cap configurable

  Closes the remaining two P1-2 unbounded-growth items (launch-readiness):

  - **service-messaging** — notification-pipeline retention is now **default-on**.
    `MessagingServicePlugin`'s `retentionDays` defaults to
    `DEFAULT_NOTIFICATION_RETENTION_DAYS` (90) instead of `0`; the
    already-built/tested sweeper now prunes `sys_notification` (+ delivery / inbox /
    receipt) older than 90 days by default. **Behaviour change:** notification
    history auto-prunes at 90d — set `retentionDays: 0` to keep it forever.
  - **service-automation** — the in-memory execution-log ring buffer (already
    bounded; no OOM risk) gets a tunable window via
    `AutomationServicePluginOptions.maxLogSize`, defaulting to
    `DEFAULT_MAX_EXECUTION_LOG_SIZE` (1000, unchanged). Durable
    `sys_automation_run`-style persistence remains a post-GA HA item.

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0

## 9.3.0

### Minor Changes

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- ad4e97f: ADR-0041 Tier 1 complete: `@objectstack/trigger-api` — inbound webhook/HTTP flow trigger. The engine now derives an `api` trigger binding for `type: 'api'` flows (activating the long-reserved enum value); the trigger mounts `POST /api/v1/automation/hooks/:flowName/:hookId` with GitHub/Stripe-style HMAC verification (`x-objectstack-signature`, constant-time compare, identical 404s for unknown flows and wrong hookIds) and queue-backed ingestion — the handler enqueues and ACKs 202, a queue consumer executes the flow with the JSON payload as the trigger record (`$record` / `record.*` / bare references), and `x-idempotency-key` passes through to the queue's dedup window. The CLI's serve preset auto-loads the trigger alongside record-change and schedule.

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
  - @objectstack/formula@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/formula@8.0.1

## 8.0.0

### Patch Changes

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
  - @objectstack/formula@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/formula@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [f01f9fa]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/core@7.7.0

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

- cf03ef2: Persist suspended flow runs so a durable pause survives a process restart (#1518).

  `service-automation` kept suspended runs in an in-memory `Map` only, so a flow
  paused at an `approval` / `wait` / `screen` node could never be resumed after the
  process restarted — a hard blocker on hibernating/serverless hosts (e.g. the
  Cloudflare Workers control plane), where the approval record persists but
  `resume(runId)` had nothing to continue.

  The engine now backs that map with a pluggable `SuspendedRunStore` (ADR-0019):

  - **`SuspendedRunStore`** interface + two implementations — `InMemorySuspendedRunStore`
    (the default; JSON round-trips so it faithfully mirrors a DB boundary) and
    `ObjectStoreSuspendedRunStore`, which persists to a new **`sys_automation_run`**
    system object via the ObjectQL engine. `AutomationServicePlugin` registers the
    object and auto-enables the DB-backed store when an ObjectQL engine is present
    (opt out with `suspendedRunStore: 'memory'`).
  - **Durable suspend/resume** — a run is persisted on suspend and deleted on
    terminal completion. `resume(runId)` rehydrates from the store when the run is
    not in memory (cold boot), so a fully restarted kernel can continue from the
    paused node down the correct branch and run the downstream nodes. The resumable
    state (`variables` / `steps` / `context` / `screen`) round-trips through the
    store, including nested objects.
  - **Idempotent resume** — the suspension is consumed before downstream work runs,
    plus an in-process guard rejects a concurrent duplicate `resume`, so a repeated
    resume after a partial restart can't double-run side effects.
  - Run ids are now process-unique (random component) so they don't collide with a
    still-suspended run persisted by a previous process lifetime.

  New exports: `SuspendedRun`, `SuspendedRunStore`, `StepLogEntry`,
  `InMemorySuspendedRunStore`, `ObjectStoreSuspendedRunStore`,
  `SuspendedRunStoreEngine`, `SysAutomationRun`, plus
  `AutomationEngine.setSuspendedRunStore()` and `listSuspendedRunsDurable()`.
  Existing service-automation and plugin-approvals tests pass unchanged.

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

- f06a6a5: feat(automation): structured parallel block (ADR-0031, task 3)

  Implement engine execution for the `parallel` block — a structured construct
  with an **implicit join** (ADR-0031 §Decision 2). The `parallel` node declares N
  branch regions in `config.branches[]`; the executor runs them concurrently in
  the enclosing variable scope (via `AutomationEngine.runRegion`) and continues
  once when all branches complete — no author-visible split/join gateway.

  - New `builtin/parallel-node.ts` executor (registered as a built-in).
  - Branch failure fails the block (surfaced as a node failure → fault edge/error
    handling); durable pause inside a branch is a clear error.
  - Well-formedness (≥2 branches, single-entry/single-exit regions) is already
    enforced at `registerFlow()` by `validateControlFlow` (shipped with the loop
    container).

  Showcase `FanOutNotifyFlow` demonstrates the parallel block. Try/catch execution
  and BPMN interop mapping remain follow-ups (#1479 tasks 4–5).

- 4ee139d: feat(automation): structured try/catch/retry block (ADR-0031, task 4)

  Implement engine execution for the `try_catch` construct — structured error
  handling (ADR-0031 §Decision 3). The node runs a protected `try` region; on
  failure it retries with exponential backoff (`config.retry`), and if it still
  fails the optional `catch` region runs with the caught error bound to
  `config.errorVariable` (default `$error`). Both regions execute in the enclosing
  variable scope via `AutomationEngine.runRegion`.

  - New `builtin/try-catch-node.ts` executor (registered as a built-in).
  - `try` success (incl. a successful retry) → node succeeds; `catch` handling a
    failure → node succeeds; no `catch` / failing `catch` → node fails to the
    flow's fault edge / error handling.
  - Well-formedness (single-entry/single-exit `try`/`catch` regions) is already
    enforced at `registerFlow()` by `validateControlFlow` (shipped with the loop
    container).

  Showcase `ResilientSyncFlow` demonstrates the construct. This completes the
  native control-flow execution trio (loop / parallel / try-catch); BPMN interop
  mapping remains a follow-up (#1479 task 5).

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
  - @objectstack/formula@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Minor Changes

- 1560880: Implement the `subflow` node executor — invoke another flow as a reusable step.

  The designer offered a `subflow` node but the engine had no executor, so a flow
  using it couldn't run. `subflow` now:

  - resolves `config.input` (a `{token}` mapping) against the parent's variables,
  - runs `config.flowName` via `engine.execute(...)`, and
  - writes the child's output back — under `${nodeId}.output`, and under
    `config.outputVariable` as a bare variable when given.

  Scope (v1): **synchronous** subflows that run to completion. If the child
  _suspends_ (a nested `approval` / `screen` / `wait`), the node fails with a
  clear message rather than silently dropping the run — nested durable pause is a
  deliberate follow-up. A depth guard (16) turns an accidental recursive cycle
  into a clean error instead of a stack overflow.

  A bare `AutomationServicePlugin` now ships 14 executors including `subflow`.

  Tests: `subflow-node.test.ts` — invoke + input-mapping + output capture,
  missing `flowName`, child-not-found, child-suspended, recursion guard.
  service-automation **118 passing**. Worked examples added to the showcase: a
  reusable `showcase_notify_owner` subflow (`template: true`) invoked by
  `showcase_task_done_notify_owner`.

- a2263e6: Implement the `wait` node executor — durable timer / signal pause.

  The flow designer offered a `wait` node but the engine had no executor for it, so
  a flow using it couldn't run. `wait` now suspends the run on entry (ADR-0019
  durable pause, the same suspend/resume machinery as `screen` / `approval`) and
  resumes by one of two paths, per `waitEventConfig.eventType`:

  - **timer** — schedules a one-shot job (`IJobService`, `{ type: 'once', at }`)
    that calls `engine.resume(runId)` when the ISO-8601 `timerDuration` elapses.
    With no job service the run still suspends and is resumable via an external
    `resume(runId)` (logged) — never silently no-ops or fails the flow.
  - **signal / webhook / manual / condition** — suspends with the signal name as
    the correlation key; an external producer resumes the run when the event
    arrives.

  Reads its run id from the engine-injected `$runId` variable (same mechanism the
  approval node uses). Adds a `parseIsoDuration` helper (`PT1H`, `P3D`, `PT90M`,
  `P1DT12H`, bare ms). Registered as a built-in node, so a bare
  `AutomationServicePlugin` now ships 13 executors including `wait`.

  Tests: `wait-node.test.ts` — duration parsing, suspend→resume traversal,
  one-shot job scheduling + handler-driven resume, named-signal suspend.
  service-automation **113 passing**. A worked `showcase_task_follow_up` flow
  (wait → notify) demonstrates it end-to-end.

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/formula@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/formula@7.4.1

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

### Patch Changes

- a6d4cbb: Fix conditional & record-change flows silently skipping.

  Two bugs together caused every flow with a start-node / edge **condition** to
  silently skip (record-change triggers fired but the flow body never ran;
  audit-style `previous.*` gates and `budget > 100000`-style gates all evaluated
  to false):

  - **service-automation — CEL engine unreachable in ESM.** The condition
    evaluator loaded the formula engine via a CommonJS `require('@objectstack/formula')`.
    In the package's ESM build (`"type": "module"`) that resolves to tsup's
    throwing `__require` stub, so **every** CEL evaluation threw and the
    swallowing `catch` returned `false`. Replaced with a static top-level import,
    which binds correctly in both the ESM and CJS builds.

  - **objectql — prior record not exposed to update hooks.** `HookContext`
    documents a `previous` snapshot for update/delete, but `engine.update` never
    populated it (the row it fetched for validation was a local var). Record-change
    conditions like `status == "done" && previous.status != "done"` therefore had
    no `previous` to read. The engine now attaches the pre-update record to
    `hookContext.previous` for single-id updates whenever a validation rule needs
    it or an `afterUpdate` hook is registered.

  Both paths are covered by new unit tests.

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
  - @objectstack/formula@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/formula@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/formula@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/formula@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/formula@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/formula@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/formula@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/formula@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/formula@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/formula@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/formula@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/formula@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/formula@4.0.5

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
