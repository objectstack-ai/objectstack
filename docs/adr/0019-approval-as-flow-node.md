# ADR-0019: Collapse Approval into Flow — one engine, approval as a durable-pause node

**Status**: Accepted (2026-05-31) — fully implemented (A1–A5)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0018](./0018-unified-node-action-registry.md) (open action registry — approval becomes a consumer), [ADR-0009](./0009-execution-pinned-metadata.md) (execution pinning — reconcile to one mechanism), [ADR-0012](./0012-notification-platform.md) (outbox / `notify`), [ADR-0010](./0010-nl-to-flow-authoring.md) + [ADR-0011](./0011-actions-as-ai-tools.md) (AI authoring — the design center)
**Revises**: ADR-0018's premise that Approval stays a separate paradigm with its own closed `ApprovalActionType` enum, and the "Workflow-Rule → Flow compiler" (M5) — both dropped here (greenfield, no legacy).
**Consumers**: `@objectstack/spec` (`automation/approval.*`, `automation/flow.zod.ts`), `@objectstack/services/service-automation`, `@objectstack/plugins/plugin-approvals`, `@objectstack/platform-objects` (`audit/sys-approval-*`), `../objectui` (`plugin-workflow` designer)

---

## TL;DR

Approval is currently a **second execution engine** (`@objectstack/plugin-approvals`, ~1500 LOC) that runs *beside* Flow with its own action executor, its own execution pinning, and its own lifecycle. Its declarative `ApprovalProcessSchema` cannot express a graphical branch and cannot place an ordinary Flow node (e.g. an HTTP connector) between two approval steps, so admins must choose which tool to model in.

ADR-0018 opened the node/action registry; this ADR uses it to **collapse approval onto the one Flow engine**. Approval becomes a **first-class durable-pause node** contributed through the open registry (like the existing `screen` node), not a parallel engine and not engine core. The standalone `ApprovalProcessSchema` is **deprecated as an authoring type** — its step-sequencing dissolves into Flow graph edges, its per-step actions into downstream Flow nodes (over the ADR-0018 registry), and its approver/escalation/lock model into **node config**. The approval *runtime state* (`sys_approval_request` / `sys_approval_action`, lock, status mirror, approver resolution) is **kept** — it just stops carrying a second execution loop.

Because the future authoring path is **AI generates the Flow, the human previews the diagram and confirms**, a single composable IR (one Flow graph with rich nodes) beats a constrained side DSL: the human reviews one picture, and the AI targets one representation instead of choosing among DSLs with escape hatches.

## Context

### Greenfield — no migration constraint

The platform is not launched; there is no production approval data and no legacy automation to translate. This removes the usual reason to keep a deprecated model alive for compatibility, and it removes the reason for a Workflow-Rule → Flow compiler entirely (Workflow Rules were already removed in #1398, and `workflow` was reclaimed for state machines). **Migration is a code refactor, not a data migration.**

### Today: approval is a separate engine (the Salesforce pit, in our codebase)

ADR-0018 §Context argued — correctly — that *multiple authoring paradigms are fine; multiple execution vocabularies are not*. Approval is where that line is currently crossed at the **engine** level, not just the vocabulary level:

- `@objectstack/plugin-approvals` is ~1500 LOC of runtime: an 816-line `approval-service.ts` state machine, a **313-line parallel `action-executor.ts`**, 250-line lifecycle hooks, and a 128-line plugin.
- The contract is explicit that this is a separate engine: [`packages/spec/src/contracts/approval-service.ts`](../../packages/spec/src/contracts/approval-service.ts) — *"Sits on top of (but does not depend on) `IWorkflowService` … driven by humans rather than transition rules."*
- The parallel `action-executor.ts` re-implements `field_update` / `inbox_notify` / `webhook` and carries the **same** `connector_action` / `script` / `email_alert` "unimplemented, logged + skipped" stubs that ADR-0018 set out to retire.
- It has its **own** ADR-0009 execution pinning (`process_hash` → `getByHash`), parallel to Flow's.
- It registers its own lifecycle hooks: `afterInsert` auto-trigger, `beforeUpdate` record-lock ([`plugin-approvals/src/lifecycle-hooks.ts`](../../packages/plugins/plugin-approvals/src/lifecycle-hooks.ts)).

This is precisely the failure mode Salesforce lived for years: Approval Process as a separate engine from Flow, never cleanly folded in, leaving admins to pick a tool and the platform to maintain two of everything.

### Why the declarative `ApprovalProcessSchema` hits a wall

[`automation/approval.zod.ts`](../../packages/spec/src/automation/approval.zod.ts) is a *linear* model: `steps[]`, per-step `approvers` / `behavior` / `rejectionBehavior`, and per-step `onApprove` / `onReject` actions drawn from a **closed** `ApprovalActionType` enum. Two concrete things it cannot do:

1. **No graphical branch.** A reviewer cannot see, or author, an arbitrary branch — only a step list plus `rejectionBehavior: back_to_previous`.
2. **No mid-process Flow step.** You cannot place a connector / HTTP / decision node *between* approval step 2 and step 3; the only "between" available is the limited per-step action enum. Any real integration forces an escape out of the model.

The result is exactly the tool-choice tax: simple approvals go in the approval model, anything composite has to be rebuilt as a Flow.

### The design-center shift: AI generates, humans preview

The intended authoring path (ADR-0010 / ADR-0011) is **AI generates the automation; the human previews the design diagram and confirms it matches intent**. This changes what the representation must optimize for:

- The "fill a 30-second form vs. wire a 30-node graph" authoring-ergonomics argument for a constrained DSL **evaporates** — the human is not authoring either way; the AI is, and the human *reviews a diagram*.
- Reviewing **one** unified Flow graph is easier than reviewing "a linear approval config *and* a Flow graph" side by side.
- An AI targets **one composable IR** more reliably than it chooses among several constrained DSLs and their escape hatches.

So the design center now favors a single expressive Flow representation with a rich Approval node, not a separate approval DSL.

## Decision

Collapse approval onto the one Flow engine. The four sub-decisions:

### D1 — One execution engine; approval rides it as a durable-pause node

There is **one** execution loop: the Flow engine. The engine core owns a generic **durable-pause-and-resume** primitive — a node may suspend the run and resume on an external signal (timer, event, or a human decision). The `screen` node already uses this (`supportsPause` / `isAsync`); we formalize "resume on external signal" as the shared mechanism. Approval is a node that uses it. The parallel approval execution loop (`approval-service.ts`'s stepping + `action-executor.ts`) is removed.

> The "one engine" property — not "one state table" — is what avoids the Salesforce pit. The pit was two *execution loops*. Approval keeping its own state objects is correct and necessary (see "What must NOT be lost"); a second execution loop is not.

### D2 — Approval is a plugin that contributes a node, not engine core

The Approval node is registered through the **ADR-0018 open registry** (`registerNodeExecutor`), by a slimmed-down approval plugin — **not** baked into `service-automation` core. Rationale:

- It is the ADR-0018 thesis applied to ourselves: the engine is the substrate, capabilities are contributed nodes.
- **Layering.** Approver resolution depends on the org / sharing model — `sys_team`, `sys_department` (recursive BFS), `sys_user.manager_id`, `sys_department_member` ([`packages/plugins/plugin-approvals/src/approval-service.ts#sys_team`](../../packages/plugins/plugin-approvals/src/approval-service.ts)). The Flow engine core must **not** depend on the org model; the approval plugin may. So approval cannot live in core.
- `service-automation` stays lean; approval becomes a well-behaved node provider that rides the engine instead of a parallel engine.

### D3 — Deprecate `ApprovalProcessSchema` as a top-level authoring type; re-home its concepts

`ApprovalProcessSchema` / `approval.form.ts` are deprecated as a standalone *authoring* metadata type. Nothing is thrown away — each concept moves:

| In `approval.zod.ts` today | Re-homed to |
|:---|:---|
| `steps[]` (sequence) | Multiple Approval nodes connected by Flow edges (sequence becomes a graph) |
| `rejectionBehavior: back_to_previous` | A back-edge in the Flow graph (the branch is now visible) |
| `onApprove` / `onReject` + `ApprovalActionType` enum | Downstream Flow nodes on the node's approve/reject outputs, over the ADR-0018 registry (**enum deleted**) |
| `ApproverType` (user/role/team/department/manager/field/queue), `behavior` (unanimous/first_response), `escalation`, `lockRecord`, `approvalStatusField` | **Approval node config schema** (`configSchemaRef` per the descriptor) |

### D4 — Delete the parallel pieces

- `plugin-approvals/src/action-executor.ts` (313 LOC) — replaced by downstream Flow nodes + the ADR-0018 action registry.
- `ApprovalActionType` enum and the dangling `connector_action` it still carries.
- The Workflow-Rule → Flow compiler (ADR-0018 M5) and the `connector_action` remnants in `flow.zod.ts` — no legacy to migrate.
- Reconcile to **one** ADR-0009 execution-pinning mechanism: the Flow definition is pinned; approval's separate `process_hash` pinning is retired.

### What must NOT be lost

The normalized **approval runtime state** is kept as first-class state owned by the approval plugin:

- `sys_approval_request` (current step, current approver, status, history pointer) and `sys_approval_action` (immutable audit) — a Flow-run log **cannot** answer "approvals pending on Alice > 3 days", drive a "my approvals" inbox, or serve recall / delegate. These need the normalized shape.
- Record lock (`beforeUpdate` hook) + status mirror field; approver resolution (team / department BFS / manager / role / queue, ~200 LOC) — moved nearly verbatim under the node, not rewritten.
- Approve / reject / **recall**, `unanimous` / `first_response`, and SLA escalation remain required capabilities of the Approval node — enumerated here so a naive "just use a pause node" refactor cannot silently drop them.

## Consequences

**Positive**
- One execution engine — the Salesforce two-engine pit is closed in our own codebase.
- One authoring surface — no admin tool-choice; approvals and integrations live in the same Flow.
- Graphical branching and a connector node *between* approval steps both become trivial — the two concrete walls of `ApprovalProcessSchema` are gone.
- One IR for AI to emit and a human to review; one action vocabulary (ADR-0018 registry) instead of a parallel enum.
- Net deletion: the 313-LOC parallel `action-executor.ts`, `ApprovalActionType`, the M5 compiler, and the `connector_action` remnants.

**Cost / risk**
- ~1500-LOC plugin refactor — but roughly half is *keep-and-re-home* (approver resolution ~200 LOC, state objects, lock hooks ~250 LOC), not rewrite. No data migration (greenfield).
- The engine core must generalize durable-pause into "resume on external human decision"; today only `screen` exercises the pause path.
- **Primary risk:** a refactor that degrades approval into a bare pause node and drops approver richness / escalation / recall / audit. Mitigated by enumerating these as required node capabilities (above) and by keeping the existing `approval-service.test.ts` / `phase-b.test.ts` behavioral suites green against the new node.

## Phased plan

Tracked separately from the ADR-0018 PR. The first three phases land **additively** — the
node path is built and proven green *beside* the standalone engine, so the destructive
removal (A4/A5) can be reviewed and sequenced on its own once consumers move over.

1. **A1 — this ADR.** ✅ **Done.** Fix the boundary before code.
2. **A2 — engine durable pause + node config schema.** ✅ **Done.** Generalized the engine's
   durable-pause into a real **suspend/resume** primitive (`AutomationResult.status: 'paused'`
   + `runId`, `IAutomationService.resume` / `listSuspendedRuns`, in-memory `suspendedRuns`;
   the `screen` node opts in via `config.waitForInput`). Added the canonical Approval **node**
   config (`ApprovalNodeConfigSchema`, `APPROVAL_NODE_TYPE`, `ApprovalDecision`,
   `APPROVAL_BRANCH_LABELS`) lowering `ApproverType` / `behavior` / `escalation` /
   `lockRecord` / `approvalStatusField` to node config; deprecated `ApprovalProcessSchema`
   (JSDoc) without removing it yet.
3. **A3 — node provider (additive).** ✅ **Done.** `plugin-approvals` now contributes the
   `approval` node via the ADR-0018 registry (`approval-node.ts`): on entry it opens a
   `sys_approval_request` (reusing approver resolution / audit / lock / status mirror verbatim)
   and **suspends**; `decideApprovalNode` finalizes and **resumes** the run down the matching
   `approve` / `reject` edge. New correlation fields on `sys_approval_request`
   (`flow_run_id` / `flow_node_id` / `node_config_json`). The standalone process engine is left
   intact for the migration window.
4. **A4 — delete parallel pieces.** ✅ **Done (this PR, destructive).** Removed
   `action-executor.ts`, `ApprovalActionType`, `ApprovalProcessSchema` / `ApprovalStepSchema` /
   `ApprovalActionSchema` (top-level) + `approval.form.ts`, the `sys_approval_process` object,
   the `approvals` stack collection, the lifecycle auto-trigger, the REST `/approvals/processes`
   + submit/recall routes, and the app-plugin process seeder; retired `process_hash` pinning in
   favor of Flow pinning. All actions now route through the ADR-0018 registry. Consumers (CRM /
   showcase examples, API routes, app seeders, `metadata-type-schemas.ts` /
   `metadata-form-registry.ts`, CLI / metadata stats) migrated off the process model.
5. **A5 — cleanup.** ✅ **Done (this PR).** The M5 compiler was already removed in #1398; the
   `workflow_rule` paradigm remnants are gone with the process engine. `connector_action` is
   **retained** — it is a deliberate open extension point on the ADR-0018 registry, not a process
   remnant. `approval-service.test.ts` rewritten to drive the Approval node; `phase-b.test.ts`
   deleted.

> **Landed across two PRs:** A1–A3 (additive foundation) shipped first — the engine gained real
> durable suspend/resume (P1), spec gained the Approval node contract (P2), and `plugin-approvals`
> gained the working node bridge (P3). **This PR lands A4–A5**: the destructive removal of the
> now-superseded standalone process engine. Approval exists *only* as a flow node. Green across
> spec / platform-objects / plugin-approvals / runtime / rest / cli / metadata and both example apps.

## Migration map

| Asset | Disposition |
|:---|:---|
| `plugin-approvals` execution loop + `action-executor.ts` | **Delete** (engine + actions now Flow's) |
| `ApprovalActionType`, M5 compiler (`workflow_rule`) | **Delete** |
| `connector_action` | **Keep** — deliberate open extension point (ADR-0018), not a process remnant |
| `ApprovalProcessSchema`, `approval.form.ts` (top-level authoring type) | **Deprecate / remove** — concepts → Approval node config + Flow graph |
| `ApproverType`, `behavior`, `escalation`, `lockRecord`, `approvalStatusField` | **Re-home** → Approval node config schema |
| Approver resolution (team/dept BFS/manager/role/queue) | **Keep** (move under node, ~verbatim) |
| `sys_approval_request` / `sys_approval_action`, lock hook, status mirror | **Keep** (first-class approval state, owned by the plugin) |
| `approval-service.test.ts` / `phase-b.test.ts` | **Migrate** to drive the Approval node |

## Tiering (open-source vs enterprise)

The open-source / enterprise split is **not** an architectural concern and is **out of scope for this ADR** — the open registry (ADR-0018) plus the node-config shape make the tier line a *packaging* decision (which approver types / orchestration features ship in which package), not an engine boundary. The split is maintained privately in `cloud/docs/design/approval-tiering.md`. This ADR keeps the engine and the node contract tier-neutral.


## Addendum (2026-06-10) — Nested durable pause: subflow chains (linked-runs model)

A pausing node inside a **subflow** now suspends the whole chain instead of failing the parent.
Model: **linked runs** (the inter-flow half of the long-term execution-state architecture —
cf. Step Functions nested executions / Temporal child workflows; the intra-flow half, a
token/scope tree replacing the single-program-counter continuation, is [ADR-0039](./0039-token-scope-tree-execution.md)).

- The child's continuation persists under its **own run id** (run identity keeps per-flow version
  pinning, run logs, and `$runId`-based approval/wait correlation intact). The parent suspends at
  the `subflow` node with `correlation: 'subflow:<childRunId>'`; linkage metadata
  (`$parentRunId` / `$parentNodeId` / `$parentOutputVariable`) rides on the child's persisted
  `context` — **no schema change** to `sys_automation_run`.
- `resume()` completes the chain in both directions, recursively: resuming the **child** directly
  (approval service, wait timer) **bubbles up** — the parent auto-resumes with the child's output,
  mapped exactly like the synchronous path (`${nodeId}.output` + bare `outputVariable`); resuming
  the **parent** (a UI holding the original run id, incl. multi-screen wizards) **delegates down**
  to the suspended child. A child failing terminally after the pause **fails every waiting
  ancestor** (bounded walk), so no run is stranded as resumable-forever.

**v1 boundaries (deliberate):** the subflow node's `fault` out-edges / enclosing `try_catch` do
not catch a *post-pause* child failure (the parent run fails terminally instead); `timeoutMs`
does not count across a suspension; a crash exactly between child completion and the parent
bubble leaves the parent paused — an operator can compensate with a manual
`resume(parentRunId, { output })` (outbox-grade exactly-once chaining is future work).

## Addendum (2026-07-28, #3801) — the resume seam is a trust boundary: `resumeAuthority`

Collapsing approval onto the flow engine made `AutomationEngine.resume` the **one** way any pause
continues — including an approval decision. That is the right execution model, but it left the
authorization model behind: `POST /api/v1/automation/:name/runs/:runId/resume` forwards a
caller-supplied `{ inputs, output, branchLabel }` straight through, and `resumeInternal` validated
**machine state only** (the concurrent-resume latch, the run exists, the flow exists, the suspended
node still exists). Nothing asked *who*. A raw resume with `branchLabel: 'approve'` therefore walked
the approve edge with **no approver check, no `sys_approval_action` row and no status mirror** —
leaving the `sys_approval_request` row and the run permanently disagreeing. The only thing standing
between the route and the approvals rules was convention, spelled out in a showcase comment. A
comment in an example is not an access control.

Deleting the route was never an option: it is load-bearing for **screen flows** — the UI flow-runner
posts `{ inputs }` to advance a paused `screen` node, which is its whole reason to exist. So the gate
discriminates by **what the run is parked on**, not by the route:

- **`ActionDescriptor.resumeAuthority`** (ADR-0018 registry, `'any'` | `'service'`, default `'any'`).
  A pausing node declares who may continue it. `approval` declares `'service'`; `screen` / `wait`
  keep the default and behave exactly as before.
- **The suspension carries its own node type.** `SuspendedRun.nodeType` (column
  `sys_automation_run.node_type`) is captured at suspend time rather than re-derived from the live
  flow, so a flow republished mid-pause cannot re-type the node out from under the gate. Rows
  written before this shipped fall back to the flow definition.
- **The marker is a symbol.** `RESUME_AUTHORITY_SERVICE` (`@objectstack/spec/contracts`) is stamped
  on the `ResumeSignal` by the owning service — `ApprovalService` does it in one place
  (`serviceResume`), on the tail of a decision it already authorized and recorded. The transport
  builds its signal out of a JSON body, and no JSON body can produce a symbol-keyed property, so the
  route cannot forge it; the gate does not need to trust the caller's claims about itself.
- **The gate follows the linked-run chain.** A parent parked on a `subflow` node *delegates* the
  signal to its suspended child (see the 2026-06-10 addendum), so the gate resolves the effective
  suspension first and judges the node the signal actually lands on. Resuming the parent is not a way
  around it. *(As shipped this covered `subflow:` only; `map:` was added in #3853 — see the addendum
  below.)*
- **Refusal is an authorization answer.** `resume` returns `{ success: false, code: 'forbidden' }`
  and the route answers **403** — not a 200 carrying `success: false`, which reads as "your resume
  ran and the flow failed". Nothing is consumed: the request stays pending and the run stays parked,
  so the real decision still lands.

Engine-internal continuations (subflow delegation and up-bubble, `map` re-entry, the wait-timer wake)
go through the private `resumeInternal` and are **not** re-gated — they continue work an
already-authorized call started.

**Known gap, tracked separately:** ADR-0044's revise window parks the run on an ordinary `wait` node
(signal flavor) placed by the flow author, which the type-keyed gate cannot distinguish from any
other wait. A raw resume there still forces a resubmit without a `sys_approval_action` row. Filed as
a follow-up — closing it needs a per-suspension owner claim rather than a node-type one.

## Addendum (2026-07-28, #3853) — the chain walk covers `map:` too, and the transport owns the `$` namespace

Two defects in the gate the addendum above describes, both demonstrated with a repro rather than
reasoned:

**1. `map:` was not walked.** `resumeInternal` handles the two linked-run correlations *oppositely*:
a `subflow:` pause DELEGATES the signal down to the child, while a `map:` pause RE-RUNS the map node.
The gate's chain walk followed only the first, so a run parked on a `map` node was judged on `map`
itself — `resumeAuthority: 'any'` — and let through even while the item it was waiting on sat on an
`approval`. Since `$mapState.started` is advanced past the in-flight item *before* the suspend, and
the re-entry records a result only when `$mapItemDone` is set, an empty-body resume of the map parent
**skipped that item's approval outright**, orphaning its still-pending request; a later real decision
then bubbled into a parent already waiting on the *next* item, cascading the misalignment. The map
parent's run id is the one a launcher holds, which is what made it reachable.

The walk now follows both prefixes. The unifying rule is that a linked-run pause is waiting on a
CHILD, so the child's node carries the authority — the gate reads *the item, not the loop*. The two
differ only in what continuing would mean: for `subflow` the signal lands on the child, for `map` it
advances past it. Both are refusals for the same reason.

**2. The transport could write the engine's variable namespace.** `signal.variables` are applied as
BARE flow variables, so a caller could set the exact handoff keys `bubbleToParent` uses
(`<nodeId>.$mapItemDone` / `$mapItemOutput`) and have the map record a per-item result for a decision
nobody made — with the node id readable from `GET /automation/:name`. The same hole reaches `$runId`,
which `approval` / `wait` nodes use to correlate external state back to a run. `$` is the engine's
namespace (`$runId`, `$flowName`, `$flowLabel`, `$record`, `$error`, `$parentRunId`, `$parentMapNode`,
`$parentOutputVariable`, `<nodeId>.$mapState`); authors never write there.

The **route** now refuses a resume whose `inputs` name anything in that namespace (`$…` or a `.$`
segment) with a 400. Deliberately at the transport and not in the engine: `bubbleToParent` legitimately
writes those keys in-process, and this is the same trust split the gate itself uses — strict at the
untrusted boundary, unrestricted for the code that already holds the authority. Refuse rather than
silently strip, so a mis-authored screen input fails at the door instead of many nodes downstream.

> **Half of this was wrong — see the addendum below (#3879).** Guarding `inputs` at the transport left
> `output` untouched, and `output` keys land under `${nodeId}.${key}`, which for a map-parked run is
> the map node itself — the identical reserved key, forgeable through the other field. The *placement*
> argument above was the error: "strict at the untrusted boundary" is right about where the rule
> BINDS, not about where it LIVES. The rule moved into the engine, at the one place a signal touches
> the variable map.

## Addendum (2026-07-28, #3879) — one chokepoint for the resume signal, because guarding a field at a time failed twice

The addendum above guarded `signal.variables` **at the route**. That closed one of two equivalent
paths into the same variable map and left the other open: `signal.output` keys are merged under
`${run.nodeId}.${key}`, and for a run parked on a `map` node `run.nodeId` **is** the map node — so
`{ "output": { "$mapItemDone": true, "$mapItemOutput": … } }` writes exactly the
`<mapNodeId>.$mapItemDone` the `inputs` guard had just refused. Demonstrated, then fixed.

Note what the map gate (#3853) still bought: a batch whose pending item sits on an `approval` is
refused before any of this, so the **approval bypass stayed closed**. The residual was forging the
recorded result of an item on an *ungated* pause — map-state corruption, not a decision bypass.

Two escapes with one shape is a design signal, not two bugs. The seam had **three** open-coded writers
into one variable map (`output` prefixed, `variables` bare, and the engine's own map handoff), so
"guard the field that was exploited" was always going to invite the next field. The fix is structural:

- **`applyResumeSignal` is the one place a resume signal reaches the variable map.** Both fields are
  collected into a single write list — already in final, prefixed form — checked, then applied. A new
  signal field is covered by construction rather than by remembering.
- **All-or-nothing.** A rejected signal applies nothing, not even legitimate keys sent alongside, and
  the check runs *before* the suspension is consumed, so the run stays parked and the real
  continuation still lands.
- **The engine owns the rule; the transport maps the verdict.** `resume` returns
  `{ success: false, code: 'invalid_signal' }` and the route answers 400. This corrects the placement
  argument in the previous addendum: "strict at the untrusted boundary" is right about where a rule
  BINDS, not where it LIVES — implemented in the transport it protected exactly one transport and one
  field of it, and the SDK, any future adapter, and `output` all sat outside it.
- **Engine-built signals are exempt via a module-private symbol** (`ENGINE_BUILT_SIGNAL`), stamped by
  `bubbleToParent` and the subflow output mapping — the only writers that legitimately set the handoff
  keys, and unreachable from a transport. Deliberately *not* `RESUME_AUTHORITY_SERVICE`: that marker
  answers "the owning service authorized this decision", and a service still has no business writing
  engine internals. Two different questions, two different markers.
