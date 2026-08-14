# @objectstack/plugin-approvals

## 17.0.0

### Minor Changes

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

- f92096b: fix(approvals): an approval action is recorded against the authenticated caller, never a body field (#3800)

  Every mutating approvals entrypoint takes an `actorId`, and the REST routes
  filled it from `body.actorId ?? body.actor_id ?? context.userId` — so the body
  won. The service then authorized _that value_: `pending_approvers.includes(
input.actorId)` for a decision, `submitter_id === actorId` for a recall. It never
  checked that the value named the caller.

  So any authenticated user could POST `{"actorId": "<someone else>"}` and have
  that person's approval recorded, the request finalized, and the owning flow run
  resumed down the `approve` edge — or name a request's submitter and recall it.
  With `api.requireAuth` unset the anonymous-deny never fires either, so an
  unauthenticated request could do the same.

  #3783 drew this line for the _data-write_ identity and called the audit-row half
  "tolerable". It was not: the same unchecked string was the authorization key, so
  naming someone else was not a mislabelled audit row, it was how you got through
  the door.

  The actor is now resolved server-side (`ApprovalService.resolveActor`) on all
  nine entrypoints — `decide` / `decideNode`, `recall`, `sendBack`, `resubmit`,
  `reassign`, `remind`, `requestInfo`, `comment`.

  **The rule is not "`actorId` must equal `context.userId`."** A slot can
  legitimately be keyed by something else: the approver resolver stores the
  `type:value` literal when a graph lookup finds no holders, and the Console picks
  from the caller's own identity list — user id, email, or `role:<r>`. The rule is
  **"the actor must be an identity the server can prove belongs to the caller"**:

  - A **system** context keeps its explicit actor. The SLA sweep's reserved
    `system:sla` sentinel and the ADR-0043 action link — whose single-use hashed
    token binds exactly one approver — are unchanged. They are the only callers
    holding a trustworthy actor with no session behind them.
  - A caller with **no identity at all** is now refused. This is the anonymous case
    above.
  - **No `actorId`, or one naming the caller**, resolves to the caller. This is the
    common path and what the Console already sends.
  - **Any other value** is accepted only when the server can prove the caller holds
    it — `position:<p>` / `role:<p>` against the positions on the resolved authz
    context, or the caller's own email (one lazy `sys_user` read, taken only when
    nothing cheaper matched). Otherwise `FORBIDDEN`.

  REST still forwards the body value; it is now a _hint_ the service validates,
  which is what keeps the email and `type:value` slot cases working.

  **Upgrade note.** A client that deliberately sent another user's `actorId` now
  gets `403 FORBIDDEN` instead of silently succeeding. Send the action as the
  acting user's own session — the field can be omitted entirely, and the caller is
  used. Server-to-server callers that legitimately act for someone else should
  present a system context, as the SLA sweep and the action link already do.

  This also makes two existing claims true that were previously aspirational: the
  approval object's declared actions say "`actorId` defaults to the caller
  server-side… the service remains the authority on who may act", and
  `attachViewers` documents `can_act` as mirroring "the exact authorization the
  decision methods enforce".

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

- 91f4c78: feat(approvals,spec): structured reassign hand-off parties on `sys_approval_action` (#4365)

  A reassign's audit row used to encode "who handed the slot to whom" only inside
  a default free-text comment — `"<from_id> → <to_id>"`, two raw user ids — which
  clients could neither parse reliably nor render readably, so the approvals
  timeline showed opaque identifier soup for the single most important fact of
  the entry.

  - `sys_approval_action` gains `reassign_from` / `reassign_to`
    (`lookup('sys_user')`), written by `ApprovalService.reassign()`.
  - `comment` is pure user input again: nothing is invented when the actor
    supplies none.
  - `listActions()` resolves both parties' display names into
    `reassign_from_name` / `reassign_to_name`, alongside the existing
    `actor_name`, so timelines can render "from A to B" without extra lookups.
  - `ApprovalActionRow` (spec contract) declares the four new fields.

  Pre-existing rows keep their legacy comment; clients should prefer the
  structured fields when present and fall back to `comment` otherwise.

- ddc2527: fix(approvals): the ADR-0044 revise window is a service-owned node type, not a bare `wait` (#3823)

  #3801 gated `POST /api/v1/automation/:name/runs/:runId/resume` on the **node type**
  that produced the suspension: an `approval` pause declares
  `resumeAuthority: 'service'`, so it continues only through `ApprovalService`.
  ADR-0044's **revise window** was the same trust boundary in a shape that key
  could not see. Send-back parked the run on an ordinary `wait` node the flow
  author placed — correctly `resumeAuthority: 'any'`, because a signal wait is
  _meant_ to be resumable by an external producer — and `ApprovalService.resubmit`
  was the only thing that checked anything about continuing it.

  Demonstrated (not reasoned) against the real engine: a raw `resume(runId)` with
  an **empty body**, from any caller, walked the `resubmit` back-edge into the
  approval node and opened round N+1 with **no submitter check and no `resubmit`
  audit row** (`['submit','revise']` — no third row, ever). Worse, when another
  request was already pending on the record — the exact case `resubmit` refuses
  with `DUPLICATE_REQUEST` _specifically to keep the run alive_ — the raw resume
  went around that guard: the approval node's re-entry failed **after** the engine
  consumed the suspension, and the run was **permanently destroyed** with its
  round-N request stuck `returned` and no resubmit able to reach it.

  The revise pause is therefore its own node type:

  - **`approval_revise`** (`APPROVAL_REVISE_NODE_TYPE`), registered by
    `@objectstack/plugin-approvals` alongside the `approval` node, declaring
    `resumeAuthority: 'service'`. It stays a first-class box on the canvas, in the
    run log and in the suspended-run store — only the _reuse_ of `wait` was wrong.
    It takes **no config**: the window ends on the submitter's explicit resubmit,
    never on a signal or timer. The `resumeAuthority` gate itself is unchanged.
  - `sendBack` refuses a `revise` edge whose target is not an `approval_revise`
    node, **before any mutation** (like the existing missing-`revise`-edge check),
    so no run can be parked in a window something else can advance.
  - New gating lint `flow-approval-revise-target-not-service-owned`
    (severity `error`, on `os build` / `os validate` / `os lint` and the runtime
    metadata publish gate) rejects the old shape at authoring time.

  **Upgrading a flow authored against the original ADR-0044 D3.** One token:

  - **FROM:** `{ id: 'wait_revision', type: 'wait', waitEventConfig: { eventType: 'signal', … } }`
  - **TO:** `{ id: 'wait_revision', type: 'approval_revise' }` — drop
    `waitEventConfig` / any `config`; the window has no event to wait on.

  Until you do, such a flow keeps registering and running and its approvals stay
  decidable (`approve` / `reject` / `recall` / `reassign` are untouched), but
  **send-back is refused** with a message naming the node and this fix, and
  re-publishing it reports the lint error. A run _already parked_ in a legacy
  revise window keeps its recorded node type (a republish never re-types a live
  pause) and is drained by `resubmit` or `recall` as usual.

  ADR-0044's 2026-07-28 amendment records the reversal of its D3 and of its
  `Alternatives` rejection of a service-owned revise pause, with the evidence
  above; the implementation section there records what shipped, why the approval
  node does not re-suspend itself instead, and why no ADR-0087 conversion was
  added for the old shape.

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

- 5fa04fb: Point the account app's **Approvals** navigation entry at the Approvals Inbox component, and contribute an **Approvals Inbox** entry to Setup (#7234).

  The entry point has not moved — the account menu still shows **Approvals** with the same
  label and icon in every locale. Its destination has. It used to open the raw
  `sys_approval_request` grid, which is an admin/diagnostic view of the engine's own table
  and cannot show an approver a single decision button: every action on that object is gated
  on `record.viewer.can_act || record.viewer.can_override`, and the `viewer` block is
  attached only by the approvals REST path, never by the generic data API the object route
  reads. The result was a correct-looking list of rows nobody could act on. The entry is now
  `{ type: 'component', componentRef: 'approvals:inbox' }`, so it opens the full inbox —
  decision actions, business vocabulary, node progress and the request drawer.

  - **Account app**: `nav_account_approvals` becomes a component entry gated by
    `requiresService: 'approvals'`, so it disappears where `plugin-approvals` is not
    installed (the previous `requiresObject` gate does not apply to a component entry).
  - **Setup**: `plugin-approvals` contributes a new **Approvals Inbox** entry at the top of
    **Setup → Approvals**, above the three raw tables, which stay exactly as they were —
    admin-gated by `manage_platform_settings` and now unambiguously the diagnostic surface.
    Labels ship in all four locales (zh-CN 审批中心).
  - `sys_approval_request` is no longer surfaced raw to end users anywhere.
  - **Docs**: the approver's queue is documented as the Approvals Inbox, with a snippet for
    mounting it in any business app — one navigation entry naming the component-registry key
    `approvals:inbox`, never a console path.

  Reaching the inbox end to end in the browser additionally requires the console pin bump,
  tracked separately.

- d75edb9: Approval nodes now resolve `field` / `manager` approvers against the record's **live** state at node entry, not the trigger snapshot the flow froze at submit time (#3447). An earlier step — or the approver of an earlier step — can now write the field that routes a later step's approvers, enabling dynamic routing / dynamic co-sign (e.g. a lead reviewer picking which departments co-review, then those departments resolving as parallel approvers). Graph approvers (team / position / department / tier) already resolved live; this brings the in-record types into line.

  Also fixes two latent defects on the same path: a multi-select user field now fans out into one approver slot per user (previously the array was stringified to a single bogus id), and out-of-office delegation is applied per fanned-out user (previously silently skipped for multi-value fields). When the record can't be re-read (hard-deleted mid-flow, or a backend that can't serve a point read), resolution falls back to the trigger snapshot and warns rather than wedging the flow.

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

- cd6b9f2: `decisionOutputs` entries may now be declared `required` (objectui#2955). A typed entry `{ key, label?, type?, multiple?, required?: true }` tells the runtime — not just the decision UI — that an approver must supply the value: an **approve** carrying no value, or a blank one (`''`, whitespace, `[]`, an array of blanks), is rejected with `VALIDATION_FAILED` before any write, so the audit row and the request are untouched and the run can never resume past the node with the key missing.

  That gap is what the flag closes. `decisionOutputs` exists so a decision can route the next step (`approvers: [{ type: 'expression', value: 'vars.lead_review.next_reviewers' }]`), but nothing made the approver actually answer: a skipped output resumed the run with the key absent, and the next node either faulted with `EXPRESSION_FAILED` or resolved an empty slate and stalled on `onEmptyApprovers: 'admin_rescue'` — long after the one person who could have filled it in had moved on. `onEmptyApprovers` was the only backstop, and it is a recovery mechanism, not a contract.

  **Reject never requires them.** The run leaves down the `reject` edge, where nothing reads the outputs — demanding routing data to say "no" would trap the rejection. Outputs still ride a reject when the approver filled them in.

  **No elevation bypass.** A one-click email action link and an `auto_approve` SLA escalation both fail the same way rather than advancing into a node that would resolve nobody; the escalation sweep already isolates a throwing request, so that decision stays pending and visibly overdue instead of silently breaking the run downstream. Enforcement is per decision, so on a `unanimous` / `quorum` node every approver supplies the required outputs and the finalizing decision's values are what the flow resumes with.

  `required` rides `normalizeDecisionOutputs`, so it reaches clients on `decision_output_defs` — a decision UI marks the field required and blocks locally instead of round-tripping to a 400. The console side ships in objectui#2955.

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

- 57bab76: Typed `decisionOutputs` declarations (#3447 follow-up). A `decisionOutputs` entry may now be `{ key, label?, type: 'text' | 'user' | 'department' | 'position' | 'team', multiple? }` alongside the bare-string form — a typed entry tells the decision UI to render the matching record picker (id values; `multiple` collects an id array) instead of free text, turning "paste user ids" into "pick people". The type shapes only the input widget: the runtime whitelist works by `key` either way, via the new `normalizeDecisionOutputs` helper exported from `@objectstack/spec/automation` — the single reader of the union shape shared by the service, the request read, and `os lint`. The request read now carries `decision_output_defs` (normalized declarations) alongside the version-skew-safe `decision_outputs` key list.

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

- d058594: fix(approvals): refuse `organization` on directory-less approver types instead
  of silently ignoring it (ADR-0105 D9)

  `user`, `field` and `manager` return EARLY in `resolveApproverSpec` — they name
  a person outright rather than expanding a directory. D9's org resolution was
  placed after those returns, so an `organization` declared on one of them never
  reached the check: it was silently INERT.

  That is the one behaviour ADR-0105 D9 rules out and the authoring docs
  explicitly promise against ("`organization` on those is refused at runtime").
  The `os lint` rule caught it at author time, but the runtime claim was false —
  and a stored flow that predates the lint, or one assembled programmatically,
  got no signal at all.

  Resolution now happens at the top of `resolveApproverSpec`, above every early
  return, so the refusal reaches all three types. The ordinary path is unchanged
  and still costs nothing: with no `organization` declared the resolver returns
  the request's organization without reading anything.

  Found by cloud's group-posture dogfood driving a real `group` boot — the
  resolver's own unit tests could not see it, because they call the resolver
  directly and never traverse the early return.

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

- 2ba560a: fix(plugin-approvals): give the decision actions a visual hierarchy (objectui#2762 P1-5)

  The `sys_approval_request` decision actions all declared as equal-weight
  buttons, so the drawer's action bar rendered five identical outlined
  buttons with no emphasis on the primary path. `approval_approve` now
  declares `variant: 'primary'` and `approval_reject` declares
  `variant: 'danger'`, so a metadata-driven renderer highlights Approve and
  styles Reject as destructive — matching the hierarchy the mobile card
  already has. Pure metadata; the secondary levers stay unstyled (tertiary).

- 2dda6e7: fix(plugin-approvals): localize the declared decision-action labels (objectui#2762 P0-3)

  The Approval Center's decision drawer rendered the `sys_approval_request`
  declared actions with their literal metadata labels — English **Approve /
  Reject / Reassign / Send back / Request info** in a zh-CN workspace, sitting
  next to the same page's localized 通过 / 拒绝 inbox buttons. The plugin's
  translation bundle covered fields and views but had no `_actions` node, so
  the console's `_actions.<name>.label` resolution had nothing to hit.

  - Re-ran `os i18n extract` against the plugin's config: the bundles now carry
    `_actions` translations (label, confirmText, successMessage, param labels
    and helpText) for all eight decision actions — `approval_approve`,
    `approval_reject`, `approval_reassign`, `approval_send_back`,
    `approval_request_info`, `approval_remind`, `approval_recall`,
    `approval_resubmit` — in zh-CN, ja-JP and es-ES (en keeps the metadata
    literals).
  - The extract also surfaced other untranslated gaps, now filled in all three
    locales: the `returned` status option, the `sys_approval_action.action`
    audit options (`reassign` / `remind` / `request_info` / `comment` /
    `revise` / `resubmit` / `ooo_substitute`), the `attachments` field, and the
    `my_pending` / `recent` view empty states.

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

- 7abdd74: approvals: rejecting or recalling a request now opens ONE dialog instead of two

  `sys_approval_request`'s `approval_reject` and `approval_recall` actions declared
  both `confirmText` and `params`. The console action runner chains confirmation
  **then** param collection, both awaited, so a single decision opened a confirm
  prompt, then a second dialog the approver never asked for — and nothing was sent
  until that second Confirm, while the first prompt already read as "the action is
  running".

  Each action now carries its confirm question in the action's top-level
  `description` (the key added in #7367), which the param dialog renders under its
  title. The wording is unchanged in all four shipped locales — including the
  finality warning "A rejection is final for every approver." — so one decision is
  one condition, one wording, one dialog, and nothing is sent until its own Confirm.

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

- 5a84d41: fix(approvals): record an admin override of a staffed approver slate AS an override (#4466)

  An admin who is not in a request's `pending_approvers` may still act on it — the
  `#3424` privileged-override path exists so a request routed to an unstaffed
  position, or to approvers who have all left, is not undecidable forever. The
  override is defensible; what was not is what the audit trail recorded.

  `sys_approval_action` had no override column at all. So an admin overriding a
  properly-staffed slate wrote a row **byte-for-byte identical** to the designated
  approver approving normally: a reader of the timeline saw `approve` by the admin
  and could not tell whether the admin _was_ an approver or _overrode_ the ones who
  were, and the bypassed approver's later `409 INVALID_STATE` was the only trace —
  existing only if they happened to try. The platform knows at decision time (it
  took the `isOverrideActor` branch to admit the call at all), so this was dropped
  information, not unavailable information. The whole point of an approval record
  is to answer "who authorized this, and were they entitled to?".

  `sys_approval_action` now carries **`via_override`** (boolean, optional), set on
  exactly the actions admitted by that branch — `decideNode`'s approve/reject and
  `reassign`'s admin rescue. It is surfaced on `ApprovalActionRow.via_override`
  (`@objectstack/spec/contracts`), returned by `listActions`, and added to the
  object's `highlightFields` and two grid list views so a timeline can say
  "overrode the approver slate" instead of rendering it as an ordinary approval.

  Three distinctions the column keeps apart deliberately:

  - **`true`** — the actor held no slot in the slate and was admitted only by the
    override branch.
  - **`false`** — checked, and it was not an override. An admin who _is_ a
    designated approver is approving normally and records `false`: the marker is
    about which branch admitted the call, not about whether the actor holds admin
    rights.
  - **absent** — a row written before this column existed. "Not recorded" is not
    the same claim as "not an override", so `rowFromAction` maps `null` to
    `undefined` rather than to `false`.

  Additive and nullable, so this needs no data migration: existing rows keep
  working and simply read as unrecorded. Levelled `patch` rather than `minor`
  because nothing an author writes changes — but note it _is_ an observable
  behaviour change on a read surface: `listActions` responses and the
  `sys_approval_action` grid views now carry a field consumers did not see before,
  and `sys_approval_action` gains a column on next schema sync.

- d2a8695: fix(approvals)!: an approval request is visible to its participants, not to the whole tenant (#3590)

  `getRequest` / `listRequests` / `countRequests` deliberately query with
  `SYSTEM_CTX` to bypass RLS — as the code comments say, the approver-visibility
  rule spans identity forms RLS cannot model cleanly, so it has to be expressed in
  the service. Only the **tenant** half of that rule was ever applied. The
  participant half was named in the comment and never written, so **any
  authenticated user could read any approval request in their tenant** — its
  payload snapshot, its full decision history, and (once decision attachments
  derived their access from the request, #3580) its files.

  `approverId` on `listRequests` is a _filter_, not authorization: omitting it
  returned the whole tenant.

  A caller now sees a request when they are a participant — the submitter, a
  current approver (via the normalized approver index, so every identity form the
  write path recorded is covered), or someone who has already acted on it (a past
  approver whose slot has moved on, a commenter). Admins with override authority
  keep the unrestricted view the "all requests" console surface depends on, and a
  tokenless context sees nothing.

  Keying on the concrete user id is sufficient rather than an approximation:
  position/team/manager/field approvers are resolved to concrete user ids at open
  time, and the `type:value` literal is only the fallback for a spec that resolved
  to _nobody_ — a slot no one can act on either way. So this cannot hide a request
  from someone who could actually act on it.

  **A write path's own result is not re-gated.** Every operation echoes back the
  request it just changed; the operation already authorized itself, and re-asking
  would answer wrong for a context carrying no `userId` (a flow-driven resume, a
  service-to-service call), turning a successful write into `null`.

  Marked breaking because a client that listed requests without an `approverId`
  filter and expected the whole tenant will now receive only its own — which is
  the point.

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

- 0b795da: fix(approvals): the record lock now holds for predicate (`multi`) updates (#4778)

  The ADR-0019 record lock — "while a record has a pending `sys_approval_request`,
  block edits to it" — was enforced only for updates that reach the hook with an
  `input.id`. The engine extracts that id from a **scalar** `where.id` alone; an
  operator object (`{ $in: [...] }`) or any other predicate is a multi-row write
  that routes to `updateMany` and arrives with no id. The hook opened with
  `if (!id) return`, so it read _"no row was resolved"_ as _"there is nothing to
  authorize"_ when the truth was _"nothing was ever queried"_.

  Rewriting the very same edit as `multi: true` therefore walked straight past the
  lock:

  ```ts
  // rec_1 carries a pending approval, lockRecord is not disabled
  await ql.update(
    "crm_opportunity",
    { amount: 999 },
    { where: { id: "rec_1" } }
  ); // RECORD_LOCKED
  await ql.update(
    "crm_opportunity",
    { amount: 999 },
    { where: { id: { $in: ["rec_1"] } }, multi: true }
  ); // went through
  await ql.update(
    "crm_opportunity",
    { amount: 999 },
    { where: { name: "x" }, multi: true }
  ); // went through
  ```

  No privilege was needed for that bypass — not an `admin` role, not `isSystem`,
  not `lockRecord: false`, not a whitelisted `approvalStatusField`. Every caller
  shape that can spell a predicate (SDK, ObjectQL, a flow's `update_record`) could
  produce it. It is the same fail-open reasoning fixed for `sys_attachment`
  (#4757) and `sys_comment` (#4630), in the one place where it needed no
  privilege at all.

  **The hook now resolves the rows a write touches before deciding.** By-id writes
  are unchanged (the driver writes by primary key, so the rest of `where` must not
  narrow the verdict). A predicate write is decided by intersecting the caller's
  predicate with the records that are actually locked — which is also what keeps
  it cheap: the query is bounded by the object's **pending approvals**, never by
  the update's match set, so a mass update of 50 000 unlocked rows costs one
  bookkeeping probe and is allowed. An unscoped `multi` update over the whole
  table reaches every locked row of the object and is refused while any is held.

  **Fail-closed, both ways.** Past 1 000 locked records — the bound the attachment
  and comment guards use — or if the intersection query fails, the write is
  refused rather than allowed: the lock could not prove the write misses a locked
  row. The approvals bookkeeping being unreadable at all stays the one fail-open,
  as before: this hook is global over every object, so a kernel without
  `sys_approval_request` would otherwise refuse every update in the deployment.
  Both the bookkeeping and the match-set resolution are read under a **system**
  context — a guard's own input must never be narrowed by the caller's
  visibility, since a locked row you cannot read is still a row you may not write.

  **Every exemption moved with the guard**, which is the other way this class of
  fix goes wrong — a guard extended to more rows that carries only its deny rules
  turns a fail-open into a false-positive. `isSystem`, the `admin` override, the
  `approvalStatusField` status mirror, `lockRecord: false` and the owning run's
  `flowRunId` (#3456 / #3712) all decide a predicate write exactly as they decide
  a by-id write, each pinned by tests on both predicate shapes. Refusals now name
  the record and object that are locked.

- 820eff9: fix(spec,plugin-approvals): the two approval vocabularies are derived, not hand-matched (#3786)

  `sys_approval_request.status` and `sys_approval_action.action` spelled their
  option lists out — five values and twelve — each under a "Keep in sync with
  `ApprovalStatus` / `ApprovalActionKind` (spec/contracts)" comment, while the
  contract held the same sets as bare type unions. Seventeen strings matched by
  hand across a package boundary, with nothing checking them. They did all still
  agree; the sweep that found them (#3786) verified that verbatim before changing
  anything.

  Agreeing is not the same as being held, and both directions of drift are quiet:

  - a value the **column** accepts and the contract omits is invisible to every
    consumer typed against the contract — the row exists and nothing can narrow it;
  - a value the **contract** declares and the column rejects surfaces only at write
    time, on whichever tenant first reaches that transition.

  An audit vocabulary is a bad place for either. So the contract now publishes the
  lists as values — `APPROVAL_STATUSES` and `APPROVAL_ACTION_KINDS` — with
  `ApprovalStatus` / `ApprovalActionKind` derived from them via
  `(typeof X)[number]`, and the two columns spread the constants. The per-entry
  rationale (which action kinds move the flow, which are thread-only, why
  `returned` differs from `recalled`) moved onto the constants, where the values
  live.

  **New exports, no behaviour change.** The emitted option lists are byte-identical
  — verified against the built artifact before and after. Existing imports of the
  two types are unaffected; the types resolve to the same unions.

  `approval-vocabularies.test.ts` pins the qualifier that derivation alone cannot:
  the columns agree with the contract _while the spread is there_, and the test
  fails if either is re-inlined as a literal that has drifted. It also guards the
  guard (an unresolvable import would compare two empty lists and pass) and asserts
  the two vocabularies stay distinct, since a copy-paste pointing one column at the
  other constant would satisfy "derived from the contract" while being the wrong
  vocabulary entirely.

  Verified by mutation in both directions: adding a value to `APPROVAL_STATUSES`
  propagates into the built `sys_approval_request.status` options (the derivation
  is live, not a stale build), and re-inlining a drifted literal fails
  `sys_approval_request.status offers exactly the contract statuses, in order`.

- 7e5ac28: fix(approvals): 删除两处读 `session.roles` 的 admin 豁免 —— 记录锁与委托守卫回到单一权限词汇 (#4839)

  `plugin-approvals` 的 `lifecycle-hooks.ts` 里有两处 admin 豁免,都读
  `ctx.session.roles`:审批**记录锁**的 `bindApprovalLockHook`,以及
  `sys_approval_delegation` 的 `bindDelegationWriteGuard`。两处都已删除。

  **这不是行为变更。** `session.roles` 在整个平台没有生产者 —— ObjectQL 的
  `buildSession()` 逐字段构造 session,从不写 `roles` —— 所以两个分支在任何真实引擎
  路径上都是死代码,记录锁一直就对 admin 生效,委托一直就只能本人管理。删除让代码
  说出运行时本来就在做的事(spec 的 `HookContext` 声明了 `roles`,消费方在读,生产方
  从不写:典型的 declared ≠ enforced)。

  **为什么不是「改用正确判据」而是删除。** `roles.includes('admin')` 还是第二套权限
  方言:本仓库的权限一律由 ADR-0095 词汇裁决(能力授予 `permissions`、任职
  `positions`、由其派生的 posture),ADR-0090 D3 更是直接禁掉 `role` 这个拼法。同包的
  `ApprovalService.isOverrideActor` 已经这么做了。维护者裁定两处都取「删除」而非改判据:

  - **记录锁**:admin 释放锁定记录的正规路径已经存在(#3424 —— `recall` /
    `decideNode` 驳回 / `reassign`,全部由 `isOverrideActor` 把关并留痕
    `via_override`)。让审批终结来释放锁,记录就永远不会在审批在途时被改写 —— 这正是
    合规场景购买记录锁所要的保证。
  - **委托**:最终语义确定为**仅本人管理**(`delegator_id` 必须等于写入者;只有 system
    上下文旁路)。审批人临时不可用时,替他处置**在途**审批用的是
    `reassign`(把该审批人的名额交给替代人,连 per_group 分组归属一起带过去)/
    `recall` / 驳回。反过来,「替别人建一条委托」本来也做不到这件事:委托只在请求
    **开启**时(`resolveApproverSpec` 内的 `applyOooDelegation`)被查询,对已经挂在该
    审批人名下的在途审批毫无作用。

  新增 `admin-exemption-retired.test.ts`,把上述证据变成可执行断言,并加了一道源码级
  pin:本包非测试源码中不得再出现 `roles` 标识符或与字符串 `'admin'` 的比较。

  spec 侧 `session.roles` 的退役(至此零消费方)按 ADR-0049 enforce-or-remove 另立协议
  单处理,不在本次改动内。

- 19e1a8f: fix(approvals): an approval decision can no longer strand a flow run silently when no automation engine is attached (#4420)

  #4420's fix closed every path by which a decision could be recorded while its
  flow stayed parked — except one, and it is the one where none of the new guards
  could run. Every guard it added (`assertRunResumable`'s pre-flight, the
  `RESUME_TARGET_LOST` refusal, the `RESUME_FAILED` throw) hangs off the
  automation engine. In a process where **no engine is attached**, all of them
  were skipped by the same `typeof this.automation?.resume === 'function'`
  condition that wrapped the resume itself — so the decision was written, the
  mirrored status field advanced, and the call answered HTTP 200 with
  `resumed: false` and **nothing logged at all**. That is #4420's reported
  symptom exactly, reproduced in the one composition its fix could not see.

  The composition is reachable the same way the original bug was: a flow parks at
  an `approval` node in a process that has the automation service, and the
  decision arrives in one that does not (the plugin failed to init, or the host
  was recomposed between releases). The request row still carries a
  `flow_run_id` — which is the row's own declaration that a run is parked on this
  decision.

  **What changes.** The decision still stands. Rolling it back is not on the
  table (a human really decided, and the row is durable by then), and refusing
  every such call would break the standalone approvals compositions the
  pre-flight deliberately protects — so `finalized` and `resumed` are unchanged
  for every existing caller. What changes is that the gap is no longer silent:

  - it is logged at **`error`**, per the durability rule in `AGENTS.md` —
    persisted state and runtime state disagree while nothing looks broken from
    the outside, which is the class that rule exists for;
  - the response carries **`resumeError`**, so `resumed: false` arrives with its
    reason and the stranded run's id instead of leaving the caller to guess
    whether a resume was even attempted.

  It reuses the already-registered `RESUME_FAILED` code and the existing resume
  message shape rather than introducing a new vocabulary — the fact being
  reported (an outcome recorded whose run did not advance) is the same one.

  Applied at all five sites that resume a recorded outcome: `decide`, the
  revision-limit auto-rejection, `sendBack`, `resubmit`, and both branches of
  `recall` (whose revise-window path needs `cancelRun` rather than `resume`).

  A request that names **no** run is unaffected and stays quiet — there is
  nothing parked on it, and reporting one there would be the mirror-image
  failure that trains operators to skim `error`.

- debc23a: feat(approvals): enrich inbox rows with `payload_labels` (snapshot field labels)

  The approvals inbox summary title-cased raw snapshot machine keys
  (`assessment_status` → "Assessment Status") because the API sent no field
  labels. `ApprovalService.enrichRows` now attaches `payload_labels` (snapshot
  field key → the target object's field label), symmetric with the existing
  `payload_display` (which resolves the values), and `ApprovalRequestRow` gains
  the field. For a single-locale project the schema label is already the
  localized string, so a client can render the human field name (e.g. "考核状态")
  instead of a prettified English key.

- f40c5b4: refactor(plugin-approvals,plugin-reports): enforcement implementations annotate the full `ExecutionContext` (#7135)

  The services half of #7070, mirroring what PR #7140 did for
  `plugin-sharing` / `plugin-audit`. #6523 converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with the six-field shape the contracts used to name, so nothing they could
  _read_ had widened.

  `ApprovalService`, the approval flow-node provider and `ReportService` now
  declare `ExecutionContext` on all 43 of those positions, and the casts the
  narrow annotation forced are gone:

  - `isOverrideActor()` read the derived `posture` (ADR-0095) through an
    unchecked `(context as any)`. That gate decides whether a platform or tenant
    admin may release a STUCK approval — one routed to an unstaffed position, the
    only in-product recovery from a permanently locked record — so an erasure sat
    directly on an enforcement input: a mistyped rung would have compiled and
    silently denied every override. It is a declared read now.
  - Both services' `SYSTEM_CTX` is typed as the envelope and passed as itself,
    retiring the `SYSTEM_CTX as unknown as …` double casts at the three sites
    that hand it to a contract method.
  - The `(context as any).userId` / `.tenantId` reads in `ApprovalService` now
    read declared fields.
  - `OwnerContextResolver` returns the envelope, which is what a scheduled report
    actually resolves for its owner (#2849 / #2980).

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is
  affected, and no public export changes shape.

  Casts deliberately kept, and now documented where they sit: `organizationId`
  is not a field of the envelope at all — that spelling has its own history
  (#5858 / `check:org-identifier`) and was held out of this change by #7070. In
  `approval-node.ts` the single remaining assertion exists only because the
  literal names that key; it was reduced from `as unknown as …` to a single
  `as ExecutionContext`, which still requires the literal to be comparable to
  the envelope.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module per
  package, `exec-context-annotation.pin.ts`: it hands each parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

  The exported `SharingExecutionContext` type itself is NOT removed here: it is
  defined in `packages/spec`, which is single-owner, so its retirement is a
  separate follow-up.

- c2a1134: fix(approvals): find the zombie requests nothing was looking at (#4469)

  #4460 stopped new zombies being produced; the rows already stuck had no mechanism
  to find or release them. The failure shape (#4420) is a request flipped to
  `approved` / `rejected` / `returned` whose `flow_run_id` points at a run that no
  longer exists — the decision landed, the flow never moved. Any deployment on
  17.0.0-rc.1 that hit the wiring hole and crossed a restart mid-approval can be
  carrying these rows.

  `releaseDeadRunRequests` could not see them, and the reason is worth stating
  plainly: it scans `status: 'pending'`, and the very step that zombifies a request
  is the one that takes it OUT of `pending`. The act of breaking it removed it from
  the only sweeper's field of view — a large part of why this class of failure
  stayed silent. It could not have answered the question even if it had looked: its
  liveness oracle is `getRun`, which reads the execution LOG and returns `null` for
  a perfectly ALIVE suspended run after a restart. It treats `null` as alive
  (conservative, and correct for what it does) — which is exactly why it has no way
  to say "this run is really gone".

  Adds `ApprovalService.inspectStrandedRequests()`, which uses BOTH oracles and
  reports only rows that fail both:

  - `hasSuspendedRun(runId) === false` — the suspension store itself says no live
    pause exists. It THROWS when the store cannot be read, and that case is
    SKIPPED and counted as `undetermined`, never condemned: an unreadable store
    means "unknown", and a storage outage must not be published as a lost run.
  - `getRun(runId) == null` — no terminal history row either. A run that merely
    finished is not stranded; a request whose run neither waits nor ever completed
    is.

  **It reports; it never rewrites.** No status is changed and no run is cancelled.
  The decision genuinely happened — a human approved or rejected — and silently
  rolling it back would make the audit trail disagree with the facts. The report
  carries what an operator needs to decide: which requests are stuck at which step,
  and what the mirrored status field on the business record still reads (usually
  the stale value the user is staring at). Whether to re-run the downstream actions
  or re-open the approval is a judgement call this cannot make.

  It rides the existing escalation/dead-run sweep clock, so the finding surfaces in
  the logs without an operator knowing to go looking for it. `recalled` is
  deliberately out of scope: a recall abandons its run on purpose, and reporting
  those would bury the real findings under expected ones.

  New export: `StrandedApprovalRequest` (the report row shape).

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

- 376a061: Surface the approval node's author-declared `decisionOutputs` keys on the request read as `ApprovalRequestRow.decision_outputs` (#3447 P2 UI enablement). The set varies per request (each node declares its own), so it rides the row rather than the object's static action params — a decision UI renders one input per key and POSTs `outputs` with the decision.
- 3ea7271: fix(approvals): a `department` approver resolves against env-wide business units (#3807)

  `expandBusinessUnitUsers` scoped its `sys_business_unit` reads with a strict
  `organization_id = <request org>` equality, so a unit whose `organization_id`
  is `null` was invisible: the seed check found no row, the expansion returned
  `[]`, and the approver fell back to the dead `department:<id>` literal that
  routes to nobody.

  That is the normal case, not an edge case. An app's org tree is seeded, and a
  seed cannot know the organization id the runtime mints at boot, so every seeded
  unit carries `organization_id = null` — while an approval request always
  carries an org. Every business unit a flow author could pick therefore resolved
  to nobody, silently: the request opens, the slate is empty, and (with
  `lockRecord`) the record stays locked with no one able to act (#3424 is the
  downstream shape of the same dead end). Verified against a live showcase stack:
  a `{ type: 'department', value: 'bu_hq_finance' }` approver produced
  `pending_approvers: "department:bu_hq_finance"` while the unit's member sat
  right there in `sys_business_unit_member`.

  Both the seed check and the subtree descent now scope to **this org ∪
  env-wide** — `$or: [{ organization_id: <org> }, { organization_id: null }]` —
  the same predicate `sys_metadata`'s pending-draft listing settled on for the
  identical reason (a strict equality silently dropping env-wide rows). The wall
  between two organizations is unchanged: another org's unit still fails the
  match, and a null-org parent does not drag another org's child unit into the
  subtree.

  Note the same strict-equality scope exists in `plugin-sharing`'s
  `BusinessUnitGraphService.orgScope`. It is not reachable today — every
  materialized `sys_sharing_rule` row carries `organization_id = null`, so the
  filter is skipped — and is left alone here rather than widen an
  access-granting path on a defect that cannot currently fire.

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

- 5d12675: Unify the approval-status vocabulary across the `sys_approval_request` i18n bundles (#7232).

  A request rendered through the generic object surfaces used a different word than the same
  request in the Approvals Inbox and in the account-app navigation. The bundles now say what
  those surfaces already say:

  - **zh-CN**: the `status` option `pending` reads 待审批 (was 待处理), and the `my_pending`
    view reads 待我审批 (was 我的待办), matching the account-app nav entry; the view's
    empty-state title was aligned to the same wording.
  - **en**: the `status` options are humanized — `Pending` / `Approved` / `Rejected` /
    `Recalled` / `Returned` — instead of shipping the raw enum values as labels.
  - **ja-JP / es-ES**: the `my_pending` view label now matches the nav wording (承認待ち /
    Aprobaciones pendientes).

  Status **values** are unchanged — this is display wording only, so no stored data, filter,
  or API payload is affected.

- 8af76ae: The i18n extractor's default locale now tracks the source instead of merging (#8543), and the approval vocabularies carry authored English labels in the contract (#8580).

  - `os i18n extract` merge mode no longer applies to the default locale: `en` is a copy of the source, not a translation, so an edited label/description/help now reaches the regenerated `en` bundle instead of being silently shadowed by the stale entry forever (53 stale entries had accumulated across 6 packages under the old behavior; all rewritten here). Translated locales (`zh-CN` / `ja-JP` / `es-ES`) keep merge semantics exactly as before — no existing translation is overwritten.
  - Bare-string and label-less select options now seed through the extractor's derived channel: the machine value still seeds the skeleton, but the coverage gate no longer demands "translations" of machine identifiers, and a copied value can no longer masquerade as authored display text.
  - New `@objectstack/spec/contracts` exports `APPROVAL_STATUS_LABELS` and `APPROVAL_ACTION_KIND_LABELS`: the authored English for `sys_approval_request.status` (previously living only in the generated `en` bundle) and `sys_approval_action.action` (previously shipping raw machine values such as `submit` / `request_info` — the #7232 humanization missed this sibling field). Both columns derive their option labels from these maps; the regenerated `en` bundles copy them verbatim.

- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

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

- db48ad5: fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

  The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
  request is admitted only when the object grants the `bulk` **primitive** and the
  batched child operation is itself allowed. Before that, the `*Many` routes
  checked only the child verb, so a boilerplate CRUD-five whitelist
  (`['get','list','create','update','delete']`) batched fine.

  The companion fix — adding the `bulk` primitive wherever an explicit whitelist
  survived — was applied only inside `platform-objects`. Eight objects carrying
  the same boilerplate live in other packages and kept the gap, so `/batch`,
  `createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
  delete were wide open. `data-objectstack` rethrows that 405 without falling back
  to per-row writes, which surfaced as a hard error on multi-select delete in the
  Setup grids.

  Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
  `sys_capability`, `sys_permission_set`, `sys_position`,
  `sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
  (plugin-security); `sys_approval_delegation` (plugin-approvals);
  `sys_view_definition` (metadata-core).

  No new authority is granted: `bulk` only permits batching verbs each object
  already exposes one record at a time, and every batched row still passes the
  same row- and field-level permission checks. The whitelists stay explicit rather
  than being deleted — seven of the eight are `managedBy`, and
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so dropping the line would silently disable the managed-write
  backstop.

- dadd1ad: refactor(spec,plugin-sharing): retire the exported `SharingExecutionContext` type (#7218)

  <!-- adr-0087: registered sharing-execution-context-retired -->

  **BREAKING — public surface removal.** `SharingExecutionContext` is deleted from
  `@objectstack/spec` (`contracts/sharing-service`) and from
  `@objectstack/plugin-sharing`, which re-exported it. Both `api-surface/` and
  `export-origins/` snapshots are regenerated accordingly.

  This is the deferred deletion recorded when #7070 split the convergence in two.
  #6523 / PR #7068 converged 36 contract signatures onto the full
  `resolveAuthzContext` envelope (`ExecutionContext`), applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  consumer halves then re-annotated the implementations: PR #7140 (identity:
  `plugin-sharing`, `plugin-audit`) and PR #7206 (services: `plugin-approvals`,
  `plugin-reports`). Both landed with the type still exported, because it is
  DEFINED in `packages/spec` and that package's retirement is the spec seat's to
  make. Nothing declares it any more, so it goes.

  **Migration.** Anyone who imported `SharingExecutionContext` from either package
  should import `ExecutionContext` from `@objectstack/spec` instead — the type the
  contracts have declared since #7068. The old shape was six optional fields, all
  of which exist on the envelope with the same names and types, so a value that
  satisfied the retired type already satisfies `ExecutionContext`; only the
  spelling of the annotation changes.

  **No runtime behaviour changes.** The type was erased at compile time and no
  signature's accepted shape moved: the contracts already took the wide envelope.

  **What the retirement did NOT remove — the reason to read the pins.** Deleting
  the type does not make re-narrowing a compile error. Structural subtyping still
  accepts a six-field context where the envelope is expected, so the boundary is
  held by the declared parameter type plus the pins, exactly as before. The three
  `exec-context-annotation.pin.ts` files (`plugin-sharing`, `plugin-approvals`,
  `plugin-reports`) told their failure story as "the parameter narrows back to
  `SharingExecutionContext`", which a deletion would have quietly hollowed out.
  Each now keeps the retired six-field shape as a local, non-exported SPECIMEN
  type and refutes every enforcement parameter against it by type identity, so a
  re-narrowing under ANY name is red — alongside the fresh-literal
  excess-property checks they already carried. `sharing-service.test.ts` in
  `packages/spec` is re-anchored the same way, and its "twin unchanged in shape"
  case becomes a "twin stays retired" case. The narrative the retired type's doc
  block carried (the measured `(context as any).posture` specimen, and why tsc
  cannot police this) moves to the module doc of `contracts/sharing-service`,
  which the contracts and pins now point at.

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
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
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
- Updated dependencies [c44dd5e]
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
- Updated dependencies [52200b4]
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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
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
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
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
- Updated dependencies [f549a0d]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
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
- Updated dependencies [59c544d]
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
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
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
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [fda61e4]
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
- Updated dependencies [4921a95]
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
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
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
- Updated dependencies [e787608]
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
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [c073b8c]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
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
- Updated dependencies [d71ff32]
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
- Updated dependencies [9aa5510]
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
  - @objectstack/platform-objects@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 5fa04fb: Point the account app's **Approvals** navigation entry at the Approvals Inbox component, and contribute an **Approvals Inbox** entry to Setup (#7234).

  The entry point has not moved — the account menu still shows **Approvals** with the same
  label and icon in every locale. Its destination has. It used to open the raw
  `sys_approval_request` grid, which is an admin/diagnostic view of the engine's own table
  and cannot show an approver a single decision button: every action on that object is gated
  on `record.viewer.can_act || record.viewer.can_override`, and the `viewer` block is
  attached only by the approvals REST path, never by the generic data API the object route
  reads. The result was a correct-looking list of rows nobody could act on. The entry is now
  `{ type: 'component', componentRef: 'approvals:inbox' }`, so it opens the full inbox —
  decision actions, business vocabulary, node progress and the request drawer.

  - **Account app**: `nav_account_approvals` becomes a component entry gated by
    `requiresService: 'approvals'`, so it disappears where `plugin-approvals` is not
    installed (the previous `requiresObject` gate does not apply to a component entry).
  - **Setup**: `plugin-approvals` contributes a new **Approvals Inbox** entry at the top of
    **Setup → Approvals**, above the three raw tables, which stay exactly as they were —
    admin-gated by `manage_platform_settings` and now unambiguously the diagnostic surface.
    Labels ship in all four locales (zh-CN 审批中心).
  - `sys_approval_request` is no longer surfaced raw to end users anywhere.
  - **Docs**: the approver's queue is documented as the Approvals Inbox, with a snippet for
    mounting it in any business app — one navigation entry naming the component-registry key
    `approvals:inbox`, never a console path.

  Reaching the inbox end to end in the browser additionally requires the console pin bump,
  tracked separately.

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

- f40c5b4: refactor(plugin-approvals,plugin-reports): enforcement implementations annotate the full `ExecutionContext` (#7135)

  The services half of #7070, mirroring what PR #7140 did for
  `plugin-sharing` / `plugin-audit`. #6523 converged 36 contract signatures onto
  the complete `resolveAuthzContext` envelope, applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  implementations behind those contracts still annotated their own parameters
  with the six-field shape the contracts used to name, so nothing they could
  _read_ had widened.

  `ApprovalService`, the approval flow-node provider and `ReportService` now
  declare `ExecutionContext` on all 43 of those positions, and the casts the
  narrow annotation forced are gone:

  - `isOverrideActor()` read the derived `posture` (ADR-0095) through an
    unchecked `(context as any)`. That gate decides whether a platform or tenant
    admin may release a STUCK approval — one routed to an unstaffed position, the
    only in-product recovery from a permanently locked record — so an erasure sat
    directly on an enforcement input: a mistyped rung would have compiled and
    silently denied every override. It is a declared read now.
  - Both services' `SYSTEM_CTX` is typed as the envelope and passed as itself,
    retiring the `SYSTEM_CTX as unknown as …` double casts at the three sites
    that hand it to a contract method.
  - The `(context as any).userId` / `.tenantId` reads in `ApprovalService` now
    read declared fields.
  - `OwnerContextResolver` returns the envelope, which is what a scheduled report
    actually resolves for its owner (#2849 / #2980).

  **No runtime behaviour changes.** The values were always complete — this
  family's damage was type-side — so every gate answers exactly what it answered
  before. Method parameters only WIDEN what they accept, so no caller is
  affected, and no public export changes shape.

  Casts deliberately kept, and now documented where they sit: `organizationId`
  is not a field of the envelope at all — that spelling has its own history
  (#5858 / `check:org-identifier`) and was held out of this change by #7070. In
  `approval-node.ts` the single remaining assertion exists only because the
  literal names that key; it was reduced from `as unknown as …` to a single
  `as ExecutionContext`, which still requires the literal to be comparable to
  the envelope.

  Because a re-narrowed annotation would compile, ship and pass every test in
  these packages, the convergence is pinned by a new compile-time module per
  package, `exec-context-annotation.pin.ts`: it hands each parameter a fresh
  literal naming envelope-only fields (`posture`, `accessible_org_ids`,
  `org_user_ids`), which TypeScript's excess-property check rejects the moment a
  parameter narrows back, plus negative cases so a parameter erased to `any`
  cannot pass either.

  The exported `SharingExecutionContext` type itself is NOT removed here: it is
  defined in `packages/spec`, which is single-owner, so its retirement is a
  separate follow-up.

- 5d12675: Unify the approval-status vocabulary across the `sys_approval_request` i18n bundles (#7232).

  A request rendered through the generic object surfaces used a different word than the same
  request in the Approvals Inbox and in the account-app navigation. The bundles now say what
  those surfaces already say:

  - **zh-CN**: the `status` option `pending` reads 待审批 (was 待处理), and the `my_pending`
    view reads 待我审批 (was 我的待办), matching the account-app nav entry; the view's
    empty-state title was aligned to the same wording.
  - **en**: the `status` options are humanized — `Pending` / `Approved` / `Rejected` /
    `Recalled` / `Returned` — instead of shipping the raw enum values as labels.
  - **ja-JP / es-ES**: the `my_pending` view label now matches the nav wording (承認待ち /
    Aprobaciones pendientes).

  Status **values** are unchanged — this is display wording only, so no stored data, filter,
  or API payload is affected.

- dadd1ad: refactor(spec,plugin-sharing): retire the exported `SharingExecutionContext` type (#7218)

  <!-- adr-0087: registered sharing-execution-context-retired -->

  **BREAKING — public surface removal.** `SharingExecutionContext` is deleted from
  `@objectstack/spec` (`contracts/sharing-service`) and from
  `@objectstack/plugin-sharing`, which re-exported it. Both `api-surface/` and
  `export-origins/` snapshots are regenerated accordingly.

  This is the deferred deletion recorded when #7070 split the convergence in two.
  #6523 / PR #7068 converged 36 contract signatures onto the full
  `resolveAuthzContext` envelope (`ExecutionContext`), applying the #6206 ruling —
  enforcement adjudicates on the whole envelope, never a per-site subset. The
  consumer halves then re-annotated the implementations: PR #7140 (identity:
  `plugin-sharing`, `plugin-audit`) and PR #7206 (services: `plugin-approvals`,
  `plugin-reports`). Both landed with the type still exported, because it is
  DEFINED in `packages/spec` and that package's retirement is the spec seat's to
  make. Nothing declares it any more, so it goes.

  **Migration.** Anyone who imported `SharingExecutionContext` from either package
  should import `ExecutionContext` from `@objectstack/spec` instead — the type the
  contracts have declared since #7068. The old shape was six optional fields, all
  of which exist on the envelope with the same names and types, so a value that
  satisfied the retired type already satisfies `ExecutionContext`; only the
  spelling of the annotation changes.

  **No runtime behaviour changes.** The type was erased at compile time and no
  signature's accepted shape moved: the contracts already took the wide envelope.

  **What the retirement did NOT remove — the reason to read the pins.** Deleting
  the type does not make re-narrowing a compile error. Structural subtyping still
  accepts a six-field context where the envelope is expected, so the boundary is
  held by the declared parameter type plus the pins, exactly as before. The three
  `exec-context-annotation.pin.ts` files (`plugin-sharing`, `plugin-approvals`,
  `plugin-reports`) told their failure story as "the parameter narrows back to
  `SharingExecutionContext`", which a deletion would have quietly hollowed out.
  Each now keeps the retired six-field shape as a local, non-exported SPECIMEN
  type and refutes every enforcement parameter against it by type identity, so a
  re-narrowing under ANY name is red — alongside the fresh-literal
  excess-property checks they already carried. `sharing-service.test.ts` in
  `packages/spec` is re-anchored the same way, and its "twin unchanged in shape"
  case becomes a "twin stays retired" case. The narrative the retired type's doc
  block carried (the measured `(context as any).posture` specimen, and why tsc
  cannot police this) moves to the module doc of `contracts/sharing-service`,
  which the contracts and pins now point at.

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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [a954634]
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
- Updated dependencies [91cefb8]
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
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
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
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/metadata-core@17.0.0-rc.6
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
  - @objectstack/metadata-core@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- ddc2527: fix(approvals): the ADR-0044 revise window is a service-owned node type, not a bare `wait` (#3823)

  #3801 gated `POST /api/v1/automation/:name/runs/:runId/resume` on the **node type**
  that produced the suspension: an `approval` pause declares
  `resumeAuthority: 'service'`, so it continues only through `ApprovalService`.
  ADR-0044's **revise window** was the same trust boundary in a shape that key
  could not see. Send-back parked the run on an ordinary `wait` node the flow
  author placed — correctly `resumeAuthority: 'any'`, because a signal wait is
  _meant_ to be resumable by an external producer — and `ApprovalService.resubmit`
  was the only thing that checked anything about continuing it.

  Demonstrated (not reasoned) against the real engine: a raw `resume(runId)` with
  an **empty body**, from any caller, walked the `resubmit` back-edge into the
  approval node and opened round N+1 with **no submitter check and no `resubmit`
  audit row** (`['submit','revise']` — no third row, ever). Worse, when another
  request was already pending on the record — the exact case `resubmit` refuses
  with `DUPLICATE_REQUEST` _specifically to keep the run alive_ — the raw resume
  went around that guard: the approval node's re-entry failed **after** the engine
  consumed the suspension, and the run was **permanently destroyed** with its
  round-N request stuck `returned` and no resubmit able to reach it.

  The revise pause is therefore its own node type:

  - **`approval_revise`** (`APPROVAL_REVISE_NODE_TYPE`), registered by
    `@objectstack/plugin-approvals` alongside the `approval` node, declaring
    `resumeAuthority: 'service'`. It stays a first-class box on the canvas, in the
    run log and in the suspended-run store — only the _reuse_ of `wait` was wrong.
    It takes **no config**: the window ends on the submitter's explicit resubmit,
    never on a signal or timer. The `resumeAuthority` gate itself is unchanged.
  - `sendBack` refuses a `revise` edge whose target is not an `approval_revise`
    node, **before any mutation** (like the existing missing-`revise`-edge check),
    so no run can be parked in a window something else can advance.
  - New gating lint `flow-approval-revise-target-not-service-owned`
    (severity `error`, on `os build` / `os validate` / `os lint` and the runtime
    metadata publish gate) rejects the old shape at authoring time.

  **Upgrading a flow authored against the original ADR-0044 D3.** One token:

  - **FROM:** `{ id: 'wait_revision', type: 'wait', waitEventConfig: { eventType: 'signal', … } }`
  - **TO:** `{ id: 'wait_revision', type: 'approval_revise' }` — drop
    `waitEventConfig` / any `config`; the window has no event to wait on.

  Until you do, such a flow keeps registering and running and its approvals stay
  decidable (`approve` / `reject` / `recall` / `reassign` are untouched), but
  **send-back is refused** with a message naming the node and this fix, and
  re-publishing it reports the lint error. A run _already parked_ in a legacy
  revise window keeps its recorded node type (a republish never re-types a live
  pause) and is drained by `resubmit` or `recall` as usual.

  ADR-0044's 2026-07-28 amendment records the reversal of its D3 and of its
  `Alternatives` rejection of a service-owned revise pause, with the evidence
  above; the implementation section there records what shipped, why the approval
  node does not re-suspend itself instead, and why no ADR-0087 conversion was
  added for the old shape.

### Patch Changes

- 7e5ac28: fix(approvals): 删除两处读 `session.roles` 的 admin 豁免 —— 记录锁与委托守卫回到单一权限词汇 (#4839)

  `plugin-approvals` 的 `lifecycle-hooks.ts` 里有两处 admin 豁免,都读
  `ctx.session.roles`:审批**记录锁**的 `bindApprovalLockHook`,以及
  `sys_approval_delegation` 的 `bindDelegationWriteGuard`。两处都已删除。

  **这不是行为变更。** `session.roles` 在整个平台没有生产者 —— ObjectQL 的
  `buildSession()` 逐字段构造 session,从不写 `roles` —— 所以两个分支在任何真实引擎
  路径上都是死代码,记录锁一直就对 admin 生效,委托一直就只能本人管理。删除让代码
  说出运行时本来就在做的事(spec 的 `HookContext` 声明了 `roles`,消费方在读,生产方
  从不写:典型的 declared ≠ enforced)。

  **为什么不是「改用正确判据」而是删除。** `roles.includes('admin')` 还是第二套权限
  方言:本仓库的权限一律由 ADR-0095 词汇裁决(能力授予 `permissions`、任职
  `positions`、由其派生的 posture),ADR-0090 D3 更是直接禁掉 `role` 这个拼法。同包的
  `ApprovalService.isOverrideActor` 已经这么做了。维护者裁定两处都取「删除」而非改判据:

  - **记录锁**:admin 释放锁定记录的正规路径已经存在(#3424 —— `recall` /
    `decideNode` 驳回 / `reassign`,全部由 `isOverrideActor` 把关并留痕
    `via_override`)。让审批终结来释放锁,记录就永远不会在审批在途时被改写 —— 这正是
    合规场景购买记录锁所要的保证。
  - **委托**:最终语义确定为**仅本人管理**(`delegator_id` 必须等于写入者;只有 system
    上下文旁路)。审批人临时不可用时,替他处置**在途**审批用的是
    `reassign`(把该审批人的名额交给替代人,连 per_group 分组归属一起带过去)/
    `recall` / 驳回。反过来,「替别人建一条委托」本来也做不到这件事:委托只在请求
    **开启**时(`resolveApproverSpec` 内的 `applyOooDelegation`)被查询,对已经挂在该
    审批人名下的在途审批毫无作用。

  新增 `admin-exemption-retired.test.ts`,把上述证据变成可执行断言,并加了一道源码级
  pin:本包非测试源码中不得再出现 `roles` 标识符或与字符串 `'admin'` 的比较。

  spec 侧 `session.roles` 的退役(至此零消费方)按 ADR-0049 enforce-or-remove 另立协议
  单处理,不在本次改动内。

- 19e1a8f: fix(approvals): an approval decision can no longer strand a flow run silently when no automation engine is attached (#4420)

  #4420's fix closed every path by which a decision could be recorded while its
  flow stayed parked — except one, and it is the one where none of the new guards
  could run. Every guard it added (`assertRunResumable`'s pre-flight, the
  `RESUME_TARGET_LOST` refusal, the `RESUME_FAILED` throw) hangs off the
  automation engine. In a process where **no engine is attached**, all of them
  were skipped by the same `typeof this.automation?.resume === 'function'`
  condition that wrapped the resume itself — so the decision was written, the
  mirrored status field advanced, and the call answered HTTP 200 with
  `resumed: false` and **nothing logged at all**. That is #4420's reported
  symptom exactly, reproduced in the one composition its fix could not see.

  The composition is reachable the same way the original bug was: a flow parks at
  an `approval` node in a process that has the automation service, and the
  decision arrives in one that does not (the plugin failed to init, or the host
  was recomposed between releases). The request row still carries a
  `flow_run_id` — which is the row's own declaration that a run is parked on this
  decision.

  **What changes.** The decision still stands. Rolling it back is not on the
  table (a human really decided, and the row is durable by then), and refusing
  every such call would break the standalone approvals compositions the
  pre-flight deliberately protects — so `finalized` and `resumed` are unchanged
  for every existing caller. What changes is that the gap is no longer silent:

  - it is logged at **`error`**, per the durability rule in `AGENTS.md` —
    persisted state and runtime state disagree while nothing looks broken from
    the outside, which is the class that rule exists for;
  - the response carries **`resumeError`**, so `resumed: false` arrives with its
    reason and the stranded run's id instead of leaving the caller to guess
    whether a resume was even attempted.

  It reuses the already-registered `RESUME_FAILED` code and the existing resume
  message shape rather than introducing a new vocabulary — the fact being
  reported (an outcome recorded whose run did not advance) is the same one.

  Applied at all five sites that resume a recorded outcome: `decide`, the
  revision-limit auto-rejection, `sendBack`, `resubmit`, and both branches of
  `recall` (whose revise-window path needs `cancelRun` rather than `resume`).

  A request that names **no** run is unaffected and stays quiet — there is
  nothing parked on it, and reporting one there would be the mirror-image
  failure that trains operators to skim `error`.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
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
- Updated dependencies [db0d53c]
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
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
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
- Updated dependencies [f104bab]
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
- Updated dependencies [946a131]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4
  - @objectstack/metadata-core@17.0.0-rc.4

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

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

### Patch Changes

- 5a84d41: fix(approvals): record an admin override of a staffed approver slate AS an override (#4466)

  An admin who is not in a request's `pending_approvers` may still act on it — the
  `#3424` privileged-override path exists so a request routed to an unstaffed
  position, or to approvers who have all left, is not undecidable forever. The
  override is defensible; what was not is what the audit trail recorded.

  `sys_approval_action` had no override column at all. So an admin overriding a
  properly-staffed slate wrote a row **byte-for-byte identical** to the designated
  approver approving normally: a reader of the timeline saw `approve` by the admin
  and could not tell whether the admin _was_ an approver or _overrode_ the ones who
  were, and the bypassed approver's later `409 INVALID_STATE` was the only trace —
  existing only if they happened to try. The platform knows at decision time (it
  took the `isOverrideActor` branch to admit the call at all), so this was dropped
  information, not unavailable information. The whole point of an approval record
  is to answer "who authorized this, and were they entitled to?".

  `sys_approval_action` now carries **`via_override`** (boolean, optional), set on
  exactly the actions admitted by that branch — `decideNode`'s approve/reject and
  `reassign`'s admin rescue. It is surfaced on `ApprovalActionRow.via_override`
  (`@objectstack/spec/contracts`), returned by `listActions`, and added to the
  object's `highlightFields` and two grid list views so a timeline can say
  "overrode the approver slate" instead of rendering it as an ordinary approval.

  Three distinctions the column keeps apart deliberately:

  - **`true`** — the actor held no slot in the slate and was admitted only by the
    override branch.
  - **`false`** — checked, and it was not an override. An admin who _is_ a
    designated approver is approving normally and records `false`: the marker is
    about which branch admitted the call, not about whether the actor holds admin
    rights.
  - **absent** — a row written before this column existed. "Not recorded" is not
    the same claim as "not an override", so `rowFromAction` maps `null` to
    `undefined` rather than to `false`.

  Additive and nullable, so this needs no data migration: existing rows keep
  working and simply read as unrecorded. Levelled `patch` rather than `minor`
  because nothing an author writes changes — but note it _is_ an observable
  behaviour change on a read surface: `listActions` responses and the
  `sys_approval_action` grid views now carry a field consumers did not see before,
  and `sys_approval_action` gains a column on next schema sync.

- 0b795da: fix(approvals): the record lock now holds for predicate (`multi`) updates (#4778)

  The ADR-0019 record lock — "while a record has a pending `sys_approval_request`,
  block edits to it" — was enforced only for updates that reach the hook with an
  `input.id`. The engine extracts that id from a **scalar** `where.id` alone; an
  operator object (`{ $in: [...] }`) or any other predicate is a multi-row write
  that routes to `updateMany` and arrives with no id. The hook opened with
  `if (!id) return`, so it read _"no row was resolved"_ as _"there is nothing to
  authorize"_ when the truth was _"nothing was ever queried"_.

  Rewriting the very same edit as `multi: true` therefore walked straight past the
  lock:

  ```ts
  // rec_1 carries a pending approval, lockRecord is not disabled
  await ql.update(
    "crm_opportunity",
    { amount: 999 },
    { where: { id: "rec_1" } }
  ); // RECORD_LOCKED
  await ql.update(
    "crm_opportunity",
    { amount: 999 },
    { where: { id: { $in: ["rec_1"] } }, multi: true }
  ); // went through
  await ql.update(
    "crm_opportunity",
    { amount: 999 },
    { where: { name: "x" }, multi: true }
  ); // went through
  ```

  No privilege was needed for that bypass — not an `admin` role, not `isSystem`,
  not `lockRecord: false`, not a whitelisted `approvalStatusField`. Every caller
  shape that can spell a predicate (SDK, ObjectQL, a flow's `update_record`) could
  produce it. It is the same fail-open reasoning fixed for `sys_attachment`
  (#4757) and `sys_comment` (#4630), in the one place where it needed no
  privilege at all.

  **The hook now resolves the rows a write touches before deciding.** By-id writes
  are unchanged (the driver writes by primary key, so the rest of `where` must not
  narrow the verdict). A predicate write is decided by intersecting the caller's
  predicate with the records that are actually locked — which is also what keeps
  it cheap: the query is bounded by the object's **pending approvals**, never by
  the update's match set, so a mass update of 50 000 unlocked rows costs one
  bookkeeping probe and is allowed. An unscoped `multi` update over the whole
  table reaches every locked row of the object and is refused while any is held.

  **Fail-closed, both ways.** Past 1 000 locked records — the bound the attachment
  and comment guards use — or if the intersection query fails, the write is
  refused rather than allowed: the lock could not prove the write misses a locked
  row. The approvals bookkeeping being unreadable at all stays the one fail-open,
  as before: this hook is global over every object, so a kernel without
  `sys_approval_request` would otherwise refuse every update in the deployment.
  Both the bookkeeping and the match-set resolution are read under a **system**
  context — a guard's own input must never be narrowed by the caller's
  visibility, since a locked row you cannot read is still a row you may not write.

  **Every exemption moved with the guard**, which is the other way this class of
  fix goes wrong — a guard extended to more rows that carries only its deny rules
  turns a fail-open into a false-positive. `isSystem`, the `admin` override, the
  `approvalStatusField` status mirror, `lockRecord: false` and the owning run's
  `flowRunId` (#3456 / #3712) all decide a predicate write exactly as they decide
  a by-id write, each pinned by tests on both predicate shapes. Refusals now name
  the record and object that are locked.

- c2a1134: fix(approvals): find the zombie requests nothing was looking at (#4469)

  #4460 stopped new zombies being produced; the rows already stuck had no mechanism
  to find or release them. The failure shape (#4420) is a request flipped to
  `approved` / `rejected` / `returned` whose `flow_run_id` points at a run that no
  longer exists — the decision landed, the flow never moved. Any deployment on
  17.0.0-rc.1 that hit the wiring hole and crossed a restart mid-approval can be
  carrying these rows.

  `releaseDeadRunRequests` could not see them, and the reason is worth stating
  plainly: it scans `status: 'pending'`, and the very step that zombifies a request
  is the one that takes it OUT of `pending`. The act of breaking it removed it from
  the only sweeper's field of view — a large part of why this class of failure
  stayed silent. It could not have answered the question even if it had looked: its
  liveness oracle is `getRun`, which reads the execution LOG and returns `null` for
  a perfectly ALIVE suspended run after a restart. It treats `null` as alive
  (conservative, and correct for what it does) — which is exactly why it has no way
  to say "this run is really gone".

  Adds `ApprovalService.inspectStrandedRequests()`, which uses BOTH oracles and
  reports only rows that fail both:

  - `hasSuspendedRun(runId) === false` — the suspension store itself says no live
    pause exists. It THROWS when the store cannot be read, and that case is
    SKIPPED and counted as `undetermined`, never condemned: an unreadable store
    means "unknown", and a storage outage must not be published as a lost run.
  - `getRun(runId) == null` — no terminal history row either. A run that merely
    finished is not stranded; a request whose run neither waits nor ever completed
    is.

  **It reports; it never rewrites.** No status is changed and no run is cancelled.
  The decision genuinely happened — a human approved or rejected — and silently
  rolling it back would make the audit trail disagree with the facts. The report
  carries what an operator needs to decide: which requests are stuck at which step,
  and what the mirrored status field on the business record still reads (usually
  the stale value the user is staring at). Whether to re-run the downstream actions
  or re-open the approval is a judgement call this cannot make.

  It rides the existing escalation/dead-run sweep clock, so the finding surfaces in
  the logs without an operator knowing to go looking for it. `recalled` is
  deliberately out of scope: a recall abandons its run on purpose, and reporting
  those would bury the real findings under expected ones.

  New export: `StrandedApprovalRequest` (the report row shape).

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

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
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
- Updated dependencies [b25a116]
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
- Updated dependencies [65f184b]
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
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/metadata-core@17.0.0-rc.2
  - @objectstack/formula@17.0.0-rc.2

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

- 91f4c78: feat(approvals,spec): structured reassign hand-off parties on `sys_approval_action` (#4365)

  A reassign's audit row used to encode "who handed the slot to whom" only inside
  a default free-text comment — `"<from_id> → <to_id>"`, two raw user ids — which
  clients could neither parse reliably nor render readably, so the approvals
  timeline showed opaque identifier soup for the single most important fact of
  the entry.

  - `sys_approval_action` gains `reassign_from` / `reassign_to`
    (`lookup('sys_user')`), written by `ApprovalService.reassign()`.
  - `comment` is pure user input again: nothing is invented when the actor
    supplies none.
  - `listActions()` resolves both parties' display names into
    `reassign_from_name` / `reassign_to_name`, alongside the existing
    `actor_name`, so timelines can render "from A to B" without extra lookups.
  - `ApprovalActionRow` (spec contract) declares the four new fields.

  Pre-existing rows keep their legacy comment; clients should prefer the
  structured fields when present and fall back to `comment` otherwise.

- cd6b9f2: `decisionOutputs` entries may now be declared `required` (objectui#2955). A typed entry `{ key, label?, type?, multiple?, required?: true }` tells the runtime — not just the decision UI — that an approver must supply the value: an **approve** carrying no value, or a blank one (`''`, whitespace, `[]`, an array of blanks), is rejected with `VALIDATION_FAILED` before any write, so the audit row and the request are untouched and the run can never resume past the node with the key missing.

  That gap is what the flag closes. `decisionOutputs` exists so a decision can route the next step (`approvers: [{ type: 'expression', value: 'vars.lead_review.next_reviewers' }]`), but nothing made the approver actually answer: a skipped output resumed the run with the key absent, and the next node either faulted with `EXPRESSION_FAILED` or resolved an empty slate and stalled on `onEmptyApprovers: 'admin_rescue'` — long after the one person who could have filled it in had moved on. `onEmptyApprovers` was the only backstop, and it is a recovery mechanism, not a contract.

  **Reject never requires them.** The run leaves down the `reject` edge, where nothing reads the outputs — demanding routing data to say "no" would trap the rejection. Outputs still ride a reject when the approver filled them in.

  **No elevation bypass.** A one-click email action link and an `auto_approve` SLA escalation both fail the same way rather than advancing into a node that would resolve nobody; the escalation sweep already isolates a throwing request, so that decision stays pending and visibly overdue instead of silently breaking the run downstream. Enforcement is per decision, so on a `unanimous` / `quorum` node every approver supplies the required outputs and the finalizing decision's values are what the flow resumes with.

  `required` rides `normalizeDecisionOutputs`, so it reaches clients on `decision_output_defs` — a decision UI marks the field required and blocks locally instead of round-tripping to a 400. The console side ships in objectui#2955.

### Patch Changes

- 820eff9: fix(spec,plugin-approvals): the two approval vocabularies are derived, not hand-matched (#3786)

  `sys_approval_request.status` and `sys_approval_action.action` spelled their
  option lists out — five values and twelve — each under a "Keep in sync with
  `ApprovalStatus` / `ApprovalActionKind` (spec/contracts)" comment, while the
  contract held the same sets as bare type unions. Seventeen strings matched by
  hand across a package boundary, with nothing checking them. They did all still
  agree; the sweep that found them (#3786) verified that verbatim before changing
  anything.

  Agreeing is not the same as being held, and both directions of drift are quiet:

  - a value the **column** accepts and the contract omits is invisible to every
    consumer typed against the contract — the row exists and nothing can narrow it;
  - a value the **contract** declares and the column rejects surfaces only at write
    time, on whichever tenant first reaches that transition.

  An audit vocabulary is a bad place for either. So the contract now publishes the
  lists as values — `APPROVAL_STATUSES` and `APPROVAL_ACTION_KINDS` — with
  `ApprovalStatus` / `ApprovalActionKind` derived from them via
  `(typeof X)[number]`, and the two columns spread the constants. The per-entry
  rationale (which action kinds move the flow, which are thread-only, why
  `returned` differs from `recalled`) moved onto the constants, where the values
  live.

  **New exports, no behaviour change.** The emitted option lists are byte-identical
  — verified against the built artifact before and after. Existing imports of the
  two types are unaffected; the types resolve to the same unions.

  `approval-vocabularies.test.ts` pins the qualifier that derivation alone cannot:
  the columns agree with the contract _while the spread is there_, and the test
  fails if either is re-inlined as a literal that has drifted. It also guards the
  guard (an unresolvable import would compare two empty lists and pass) and asserts
  the two vocabularies stay distinct, since a copy-paste pointing one column at the
  other constant would satisfy "derived from the contract" while being the wrong
  vocabulary entirely.

  Verified by mutation in both directions: adding a value to `APPROVAL_STATUSES`
  propagates into the built `sys_approval_request.status` options (the derivation
  is live, not a stale build), and re-inlining a drifted literal fails
  `sys_approval_request.status offers exactly the contract statuses, in order`.

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

- 9881074: fix(batch): the background walks seek instead of counting, so they stop skipping rows (#4363)

  #4363 made a single paged read a partition of its result set. It could not make
  a _walk_ one: seven background scans paged with a growing `offset` while writing
  to the very rows they were reading, and an offset counts into a set those writes
  are changing. Rows slide past the cursor and are never visited.

  That is not a slow page in any of these — it is a wrong answer wearing the shape
  of a clean run:

  - **`rebuildApproverIndex`** built its desired state by walking
    `sys_approval_request WHERE status = 'pending'` with no `orderBy` at all, then
    **deleted** every index row that state did not explain. A skipped request
    meant an approver silently dropped from someone's queue. (The loop beside it
    ordered by `created_at` — not unique, so its pages were never a partition
    either.)
  - **`verifyFileReferences`** decides which files nothing references. A record it
    never visits is reported as an unreferenced file.
  - **`backfillFileReferences`** and the **pinyin companion backfill** rewrite
    each row they read, so their own writes were shifting the set out from under
    the cursor. Records were left unconverted and unsearchable by a run that
    reported success.
  - **`scanValueShapes`** exists to vouch that no stored value is off-shape, and
    it opens a migration gate on that evidence.

  All of them now go through `keysetWalk` (`@objectstack/types`): order by a
  unique key, and seek past the last one instead of counting from the start. A
  row's key does not move when the row is updated, and cannot be shifted when
  another is deleted, so the walk is stable under exactly the mutation these
  functions perform. It is also O(n) rather than O(n²/page) — measured on
  Postgres over 2M rows, deep pages cost ~1.1 s by offset against ~0.09 s by seek.

  One deliberate non-conversion: the REST **export** stream keeps its offset. It
  honors a caller-chosen sort, and a keyset walk would have to re-order the export
  by `id` to seek — changing what the user asked for to fix a cost. Its pages are
  already a partition since #4363; only the depth cost remains.

  `keysetWalk` merges the cursor with `$and` rather than spreading it into the
  caller's filter, so a walk whose own `where` constrains the key column
  (`{ id: { $in: [...] } }`) keeps that constraint instead of having it silently
  overwritten. When a `max` cap is set it reads one row beyond the cap to tell
  "the cap stopped us" from "the source ended exactly there" — without that, a
  walk that read everything still reports `truncated`, and a caller acting on it
  goes looking for rows that were never withheld.

  The storage suites' fake engines now **throw** on an `offset` instead of serving
  one, so the conversion is pinned rather than merely passing.

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
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
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
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/metadata-core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

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

- f92096b: fix(approvals): an approval action is recorded against the authenticated caller, never a body field (#3800)

  Every mutating approvals entrypoint takes an `actorId`, and the REST routes
  filled it from `body.actorId ?? body.actor_id ?? context.userId` — so the body
  won. The service then authorized _that value_: `pending_approvers.includes(
input.actorId)` for a decision, `submitter_id === actorId` for a recall. It never
  checked that the value named the caller.

  So any authenticated user could POST `{"actorId": "<someone else>"}` and have
  that person's approval recorded, the request finalized, and the owning flow run
  resumed down the `approve` edge — or name a request's submitter and recall it.
  With `api.requireAuth` unset the anonymous-deny never fires either, so an
  unauthenticated request could do the same.

  #3783 drew this line for the _data-write_ identity and called the audit-row half
  "tolerable". It was not: the same unchecked string was the authorization key, so
  naming someone else was not a mislabelled audit row, it was how you got through
  the door.

  The actor is now resolved server-side (`ApprovalService.resolveActor`) on all
  nine entrypoints — `decide` / `decideNode`, `recall`, `sendBack`, `resubmit`,
  `reassign`, `remind`, `requestInfo`, `comment`.

  **The rule is not "`actorId` must equal `context.userId`."** A slot can
  legitimately be keyed by something else: the approver resolver stores the
  `type:value` literal when a graph lookup finds no holders, and the Console picks
  from the caller's own identity list — user id, email, or `role:<r>`. The rule is
  **"the actor must be an identity the server can prove belongs to the caller"**:

  - A **system** context keeps its explicit actor. The SLA sweep's reserved
    `system:sla` sentinel and the ADR-0043 action link — whose single-use hashed
    token binds exactly one approver — are unchanged. They are the only callers
    holding a trustworthy actor with no session behind them.
  - A caller with **no identity at all** is now refused. This is the anonymous case
    above.
  - **No `actorId`, or one naming the caller**, resolves to the caller. This is the
    common path and what the Console already sends.
  - **Any other value** is accepted only when the server can prove the caller holds
    it — `position:<p>` / `role:<p>` against the positions on the resolved authz
    context, or the caller's own email (one lazy `sys_user` read, taken only when
    nothing cheaper matched). Otherwise `FORBIDDEN`.

  REST still forwards the body value; it is now a _hint_ the service validates,
  which is what keeps the email and `type:value` slot cases working.

  **Upgrade note.** A client that deliberately sent another user's `actorId` now
  gets `403 FORBIDDEN` instead of silently succeeding. Send the action as the
  acting user's own session — the field can be omitted entirely, and the caller is
  used. Server-to-server callers that legitimately act for someone else should
  present a system context, as the SLA sweep and the action link already do.

  This also makes two existing claims true that were previously aspirational: the
  approval object's declared actions say "`actorId` defaults to the caller
  server-side… the service remains the authority on who may act", and
  `attachViewers` documents `can_act` as mirroring "the exact authorization the
  decision methods enforce".

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

- d75edb9: Approval nodes now resolve `field` / `manager` approvers against the record's **live** state at node entry, not the trigger snapshot the flow froze at submit time (#3447). An earlier step — or the approver of an earlier step — can now write the field that routes a later step's approvers, enabling dynamic routing / dynamic co-sign (e.g. a lead reviewer picking which departments co-review, then those departments resolving as parallel approvers). Graph approvers (team / position / department / tier) already resolved live; this brings the in-record types into line.

  Also fixes two latent defects on the same path: a multi-select user field now fans out into one approver slot per user (previously the array was stringified to a single bogus id), and out-of-office delegation is applied per fanned-out user (previously silently skipped for multi-value fields). When the record can't be re-read (hard-deleted mid-flow, or a backend that can't serve a point read), resolution falls back to the trigger snapshot and warns rather than wedging the flow.

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

- 57bab76: Typed `decisionOutputs` declarations (#3447 follow-up). A `decisionOutputs` entry may now be `{ key, label?, type: 'text' | 'user' | 'department' | 'position' | 'team', multiple? }` alongside the bare-string form — a typed entry tells the decision UI to render the matching record picker (id values; `multiple` collects an id array) instead of free text, turning "paste user ids" into "pick people". The type shapes only the input widget: the runtime whitelist works by `key` either way, via the new `normalizeDecisionOutputs` helper exported from `@objectstack/spec/automation` — the single reader of the union shape shared by the service, the request read, and `os lint`. The request read now carries `decision_output_defs` (normalized declarations) alongside the version-skew-safe `decision_outputs` key list.

### Patch Changes

- d058594: fix(approvals): refuse `organization` on directory-less approver types instead
  of silently ignoring it (ADR-0105 D9)

  `user`, `field` and `manager` return EARLY in `resolveApproverSpec` — they name
  a person outright rather than expanding a directory. D9's org resolution was
  placed after those returns, so an `organization` declared on one of them never
  reached the check: it was silently INERT.

  That is the one behaviour ADR-0105 D9 rules out and the authoring docs
  explicitly promise against ("`organization` on those is refused at runtime").
  The `os lint` rule caught it at author time, but the runtime claim was false —
  and a stored flow that predates the lint, or one assembled programmatically,
  got no signal at all.

  Resolution now happens at the top of `resolveApproverSpec`, above every early
  return, so the refusal reaches all three types. The ordinary path is unchanged
  and still costs nothing: with no `organization` declared the resolver returns
  the request's organization without reading anything.

  Found by cloud's group-posture dogfood driving a real `group` boot — the
  resolver's own unit tests could not see it, because they call the resolver
  directly and never traverse the early return.

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

- 2ba560a: fix(plugin-approvals): give the decision actions a visual hierarchy (objectui#2762 P1-5)

  The `sys_approval_request` decision actions all declared as equal-weight
  buttons, so the drawer's action bar rendered five identical outlined
  buttons with no emphasis on the primary path. `approval_approve` now
  declares `variant: 'primary'` and `approval_reject` declares
  `variant: 'danger'`, so a metadata-driven renderer highlights Approve and
  styles Reject as destructive — matching the hierarchy the mobile card
  already has. Pure metadata; the secondary levers stay unstyled (tertiary).

- 2dda6e7: fix(plugin-approvals): localize the declared decision-action labels (objectui#2762 P0-3)

  The Approval Center's decision drawer rendered the `sys_approval_request`
  declared actions with their literal metadata labels — English **Approve /
  Reject / Reassign / Send back / Request info** in a zh-CN workspace, sitting
  next to the same page's localized 通过 / 拒绝 inbox buttons. The plugin's
  translation bundle covered fields and views but had no `_actions` node, so
  the console's `_actions.<name>.label` resolution had nothing to hit.

  - Re-ran `os i18n extract` against the plugin's config: the bundles now carry
    `_actions` translations (label, confirmText, successMessage, param labels
    and helpText) for all eight decision actions — `approval_approve`,
    `approval_reject`, `approval_reassign`, `approval_send_back`,
    `approval_request_info`, `approval_remind`, `approval_recall`,
    `approval_resubmit` — in zh-CN, ja-JP and es-ES (en keeps the metadata
    literals).
  - The extract also surfaced other untranslated gaps, now filled in all three
    locales: the `returned` status option, the `sys_approval_action.action`
    audit options (`reassign` / `remind` / `request_info` / `comment` /
    `revise` / `resubmit` / `ooo_substitute`), the `attachments` field, and the
    `my_pending` / `recent` view empty states.

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

- d2a8695: fix(approvals)!: an approval request is visible to its participants, not to the whole tenant (#3590)

  `getRequest` / `listRequests` / `countRequests` deliberately query with
  `SYSTEM_CTX` to bypass RLS — as the code comments say, the approver-visibility
  rule spans identity forms RLS cannot model cleanly, so it has to be expressed in
  the service. Only the **tenant** half of that rule was ever applied. The
  participant half was named in the comment and never written, so **any
  authenticated user could read any approval request in their tenant** — its
  payload snapshot, its full decision history, and (once decision attachments
  derived their access from the request, #3580) its files.

  `approverId` on `listRequests` is a _filter_, not authorization: omitting it
  returned the whole tenant.

  A caller now sees a request when they are a participant — the submitter, a
  current approver (via the normalized approver index, so every identity form the
  write path recorded is covered), or someone who has already acted on it (a past
  approver whose slot has moved on, a commenter). Admins with override authority
  keep the unrestricted view the "all requests" console surface depends on, and a
  tokenless context sees nothing.

  Keying on the concrete user id is sufficient rather than an approximation:
  position/team/manager/field approvers are resolved to concrete user ids at open
  time, and the `type:value` literal is only the fallback for a spec that resolved
  to _nobody_ — a slot no one can act on either way. So this cannot hide a request
  from someone who could actually act on it.

  **A write path's own result is not re-gated.** Every operation echoes back the
  request it just changed; the operation already authorized itself, and re-asking
  would answer wrong for a context carrying no `userId` (a flow-driven resume, a
  service-to-service call), turning a successful write into `null`.

  Marked breaking because a client that listed requests without an `approverId`
  filter and expected the whole tenant will now receive only its own — which is
  the point.

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

- 376a061: Surface the approval node's author-declared `decisionOutputs` keys on the request read as `ApprovalRequestRow.decision_outputs` (#3447 P2 UI enablement). The set varies per request (each node declares its own), so it rides the row rather than the object's static action params — a decision UI renders one input per key and POSTs `outputs` with the decision.
- 3ea7271: fix(approvals): a `department` approver resolves against env-wide business units (#3807)

  `expandBusinessUnitUsers` scoped its `sys_business_unit` reads with a strict
  `organization_id = <request org>` equality, so a unit whose `organization_id`
  is `null` was invisible: the seed check found no row, the expansion returned
  `[]`, and the approver fell back to the dead `department:<id>` literal that
  routes to nobody.

  That is the normal case, not an edge case. An app's org tree is seeded, and a
  seed cannot know the organization id the runtime mints at boot, so every seeded
  unit carries `organization_id = null` — while an approval request always
  carries an org. Every business unit a flow author could pick therefore resolved
  to nobody, silently: the request opens, the slate is empty, and (with
  `lockRecord`) the record stays locked with no one able to act (#3424 is the
  downstream shape of the same dead end). Verified against a live showcase stack:
  a `{ type: 'department', value: 'bu_hq_finance' }` approver produced
  `pending_approvers: "department:bu_hq_finance"` while the unit's member sat
  right there in `sys_business_unit_member`.

  Both the seed check and the subtree descent now scope to **this org ∪
  env-wide** — `$or: [{ organization_id: <org> }, { organization_id: null }]` —
  the same predicate `sys_metadata`'s pending-draft listing settled on for the
  identical reason (a strict equality silently dropping env-wide rows). The wall
  between two organizations is unchanged: another org's unit still fails the
  match, and a null-org parent does not drag another org's child unit into the
  subtree.

  Note the same strict-equality scope exists in `plugin-sharing`'s
  `BusinessUnitGraphService.orgScope`. It is not reachable today — every
  materialized `sys_sharing_rule` row carries `organization_id = null`, so the
  filter is skipped — and is left alone here rather than widen an
  access-granting path on a defect that cannot currently fire.

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

- db48ad5: fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

  The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
  request is admitted only when the object grants the `bulk` **primitive** and the
  batched child operation is itself allowed. Before that, the `*Many` routes
  checked only the child verb, so a boilerplate CRUD-five whitelist
  (`['get','list','create','update','delete']`) batched fine.

  The companion fix — adding the `bulk` primitive wherever an explicit whitelist
  survived — was applied only inside `platform-objects`. Eight objects carrying
  the same boilerplate live in other packages and kept the gap, so `/batch`,
  `createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
  delete were wide open. `data-objectstack` rethrows that 405 without falling back
  to per-row writes, which surfaced as a hard error on multi-select delete in the
  Setup grids.

  Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
  `sys_capability`, `sys_permission_set`, `sys_position`,
  `sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
  (plugin-security); `sys_approval_delegation` (plugin-approvals);
  `sys_view_definition` (metadata-core).

  No new authority is granted: `bulk` only permits batching verbs each object
  already exposes one record at a time, and every batched row still passes the
  same row- and field-level permission checks. The whitelists stay explicit rather
  than being deleted — seven of the eight are `managedBy`, and
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so dropping the line would silently disable the managed-write
  backstop.

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
- Updated dependencies [c073b8c]
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
  - @objectstack/formula@17.0.0-rc.0
  - @objectstack/metadata-core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/metadata-core@16.1.0

## 16.0.0

### Minor Changes

- e412fb6: feat(approvals): declare file attachments on approve/reject decisions

  The declared `approval_approve` / `approval_reject` actions on
  `sys_approval_request` gain an optional multi-file `attachments` param
  (`type: 'file'`, `multiple`). The console renders `type:'file'` action params
  through the shared upload widget (objectui ADR-0059) and POSTs the resolved
  `attachments: string[]`, so a reviewer can attach supporting files to a
  decision through the generic declared-action dialog — letting the approvals
  inbox retire its hand-wired attachment composer (objectui#2698).

  Purely additive metadata: the decision route already forwards
  `body.attachments` to `ApprovalService.decide`, and the
  `sys_approval_action.attachments` column (file, multiple) already persists them
  (#3266/#3274). No service or route change.

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

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

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
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/metadata-core@16.0.0

## 16.0.0-rc.1

### Minor Changes

- e412fb6: feat(approvals): declare file attachments on approve/reject decisions

  The declared `approval_approve` / `approval_reject` actions on
  `sys_approval_request` gain an optional multi-file `attachments` param
  (`type: 'file'`, `multiple`). The console renders `type:'file'` action params
  through the shared upload widget (objectui ADR-0059) and POSTs the resolved
  `attachments: string[]`, so a reviewer can attach supporting files to a
  decision through the generic declared-action dialog — letting the approvals
  inbox retire its hand-wired attachment composer (objectui#2698).

  Purely additive metadata: the decision route already forwards
  `body.attachments` to `ApprovalService.decide`, and the
  `sys_approval_action.attachments` column (file, multiple) already persists them
  (#3266/#3274). No service or route change.

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

### Patch Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/metadata-core@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

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
- Updated dependencies [06cb319]
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
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/metadata-core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/metadata-core@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/platform-objects@15.1.1

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
  - @objectstack/formula@15.1.0
  - @objectstack/metadata-core@15.1.0

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
  - @objectstack/formula@15.0.0
  - @objectstack/metadata-core@15.0.0

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
  - @objectstack/formula@14.8.0
  - @objectstack/metadata-core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/metadata-core@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/metadata-core@14.6.0

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
  - @objectstack/formula@14.5.0
  - @objectstack/metadata-core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/metadata-core@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/metadata-core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/metadata-core@14.2.0

## 14.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/metadata-core@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Minor Changes

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
  - @objectstack/formula@14.0.0
  - @objectstack/metadata-core@14.0.0

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
  - @objectstack/formula@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/metadata-core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/metadata-core@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/metadata-core@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/metadata-core@12.3.0
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
  - @objectstack/metadata-core@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/metadata-core@12.1.0
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
  - @objectstack/formula@12.0.0
  - @objectstack/metadata-core@12.0.0

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
  - @objectstack/metadata-core@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/metadata-core@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/metadata-core@11.8.0
  - @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/metadata-core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/metadata-core@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/metadata-core@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/metadata-core@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/metadata-core@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/metadata-core@11.2.0
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
  - @objectstack/formula@11.1.0
  - @objectstack/metadata-core@11.1.0

## 11.0.0

### Patch Changes

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

- Updated dependencies [4d99a5c]
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
  - @objectstack/metadata-core@11.0.0
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/metadata-core@10.3.0
- @objectstack/formula@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/metadata-core@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/metadata-core@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Patch Changes

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

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
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
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/metadata-core@10.0.0

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
  - @objectstack/metadata-core@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/metadata-core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/metadata-core@9.9.1
- @objectstack/formula@9.9.1
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
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0
  - @objectstack/metadata-core@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [c17d2c8]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/formula@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/metadata-core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/core@9.7.0
  - @objectstack/metadata-core@9.7.0
  - @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/metadata-core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1
  - @objectstack/metadata-core@9.5.1
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
  - @objectstack/formula@9.5.0
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
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Minor Changes

- 3219191: ADR-0043 actionable approval links (#1743). `remind()` now fans out per approver: every concrete identity gets its own single-use approve/reject links in the notification payload. Tokens are 256-bit, stored as SHA-256 hashes only (`sys_approval_token`), scoped to one request + action + approver, 72h TTL, consumed-before-decide (replay burns), and re-validated at redemption against the live request (decided/recalled/reassigned ⇒ dead link). The plugin mounts a session-less bilingual confirm page at `GET /api/v1/approvals/act` (renders only — mail-gateway prefetch safe) and redeems exclusively on the `POST`, auditing the decision as the bound approver.
- f3c1735: Approver join table — the #1745 follow-up that makes approver-filtered pagination exact. New `sys_approval_approver` object holds one row per (pending request, approver identity); the service mirrors every `pending_approvers` change into it (open / decide / recall / send-back / reassign / SLA-escalate) and clears the rows when a request leaves `pending`, so the table tracks the live work queue, not the append-only history. `listRequests` / `countRequests` now resolve approver filters through this index (`$in` on indexed equality instead of a per-row CSV scan) and push status arrays down as `$in` — every filter is engine-side, so the page window and totals are correct at any table size; the old 500-row bounded-scan residual is gone. `rebuildApproverIndex()` rebuilds the index from the CSV source of truth, and runs idempotently at plugin start to backfill rows written before the index existed.
- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- 50b7b47: Approvals server-side pagination + search pushdown (#1745). `listRequests` accepts `q` / `limit` / `offset` — free-text search pushes into the engine query as an `$or` of `$contains` terms (the `payload_json` snapshot carries record titles, so titles match without a join), and the page window pushes down whenever the filter is fully pushable; approver/status-array filters still post-filter their bounded scan and window in memory (the documented residual until the approver join-table follow-up). New `countRequests` returns the unwindowed total (engine `count` when pushable). REST: `GET /approvals/requests` gains `q`/`limit`/`offset` and returns `{data, total}` when paging.
- f15d6f6: ADR-0042 SLA auto-escalation + ADR-0041 mechanical landing. plugin-approvals now owns a jobs-backed escalation scanner (`runEscalations`, interval job `approvals-sla-escalation` + boot catch-up): overdue pending requests escalate **at most once** (the `escalate` audit row is the idempotency marker, written audit-first) executing the node's `escalation.action` — notify / reassign-to-`escalateTo` / auto_approve / auto_reject as the reserved actor `system:sla`. The trigger packages drop their `plugin-` prefix (`@objectstack/trigger-record-change`, `@objectstack/trigger-schedule`) per ADR-0041, and `ActionDescriptor` gains an optional `maturity: 'ga' | 'beta' | 'reserved'` field so designers can grey out contract-ahead-of-runtime surfaces.
- f8684ea: Approvals thread interactions — the collaboration layer between submit and decide. `reassign()` hands a pending-approver slot to someone else (audit-first ordering, new approver notified via the optional `messaging` service), `remind()` nudges every pending approver with a 4h per-request throttle (`THROTTLED` → HTTP 429), `requestInfo()` sends a request back to the submitter for more material while it stays pending, and `comment()` adds free-form thread replies. Rows expose `sla_due_at` (`created_at + escalation.timeoutHours`, display-only) and single reads attach `flow_steps` (the owning flow's approval trunk with done/current/upcoming states). REST grows the four matching POST routes; the `sys_approval_action.action` enum gains the new kinds.

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
  - @objectstack/formula@9.3.0
  - @objectstack/metadata-core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0
  - @objectstack/metadata-core@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0
  - @objectstack/metadata-core@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1
  - @objectstack/metadata-core@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0
  - @objectstack/metadata-core@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/metadata-core@8.0.1
- @objectstack/formula@8.0.1
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
  - @objectstack/formula@8.0.0
  - @objectstack/metadata-core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/metadata-core@7.9.0
- @objectstack/formula@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [f01f9fa]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/metadata-core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/metadata-core@7.7.0
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
  - @objectstack/formula@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/metadata-core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/metadata-core@7.5.0
- @objectstack/formula@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/metadata-core@7.4.1
- @objectstack/formula@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

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
  - @objectstack/formula@7.4.0
  - @objectstack/metadata-core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/metadata-core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/metadata-core@7.2.1
- @objectstack/formula@7.2.1
- @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/metadata-core@7.2.0
- @objectstack/formula@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0
  - @objectstack/metadata-core@7.1.0

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
  - @objectstack/formula@7.0.0
  - @objectstack/metadata-core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/metadata-core@6.9.0
- @objectstack/formula@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/metadata-core@6.8.1
- @objectstack/formula@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0
  - @objectstack/metadata-core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/metadata-core@6.7.1
- @objectstack/formula@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0
  - @objectstack/metadata-core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0
  - @objectstack/platform-objects@6.6.0
  - @objectstack/metadata-core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/metadata-core@6.5.1
- @objectstack/formula@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/metadata-core@6.5.0
- @objectstack/formula@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0
  - @objectstack/platform-objects@6.4.0
  - @objectstack/metadata-core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/metadata-core@6.3.0
- @objectstack/formula@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0
  - @objectstack/platform-objects@6.2.0
  - @objectstack/metadata-core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/metadata-core@6.1.1
- @objectstack/formula@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0
  - @objectstack/platform-objects@6.1.0
  - @objectstack/metadata-core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0
  - @objectstack/metadata-core@6.0.0

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

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/metadata-core@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/formula@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.0.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0
  - @objectstack/platform-objects@4.1.0
