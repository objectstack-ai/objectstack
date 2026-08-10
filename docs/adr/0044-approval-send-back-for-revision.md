# ADR-0044: Flow-level send-back-for-revision — `revise` branch + typed back-edge re-entry

**Status**: Accepted — engine + model implemented; designer pending (objectui) (proposed 2026-06-12 · calibrated 2026-06-12 · **amended 2026-07-28 (#3823): the revise pause moves to a service-owned node — D3's generic `wait` is superseded; amendment ratified by the maintainer and implemented 2026-08-05 as the `approval_revise` node type, see the amendment below**)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0019](./0019-approval-as-flow-node.md) (approval as a durable-pause flow node), [ADR-0039](./0039-token-scope-tree-execution.md) (single-program-counter suspend model), thread interactions (#1740), [ADR-0042](./0042-approval-sla-escalation.md) (audit-first discipline)
**Closes**: [#1744](https://github.com/objectstack-ai/objectstack/issues/1744)
**Consumers**: `@objectstack/spec` (flow edge type, branch labels, contracts), `@objectstack/service-automation` (back-edge traversal), `@objectstack/plugin-approvals` (send-back / resubmit runtime), REST, Console approvals inbox

---

## TL;DR

`requestInfo()` (#1740) is a conversation: the request stays pending, the
record stays locked, the approver keeps the slot. Mainstream approval
centers also model 退回修改 / *send back for revision* — a **flow
movement**: the current approval request terminates, the flow walks a
`revise` out-edge to a wait point where the record unlocks and the
submitter edits it, and a *resubmit* walks a **back-edge** into the
approval node, opening a fresh request (round 2) with a clean approver
slate. A `maxRevisions` guard auto-rejects instances that would orbit
forever.

```
approval (suspended, round N)
  ├─ approve ──▶ …
  ├─ reject ───▶ …
  └─ revise ──▶ wait (suspended; record unlocked; submitter edits)
                  └─ resubmit ──[back-edge]──▶ approval (round N+1)
```

## Decisions

### D1 — the sent-back request's terminal state is a new `ApprovalStatus: 'returned'`

A third terminal state alongside `approved` / `rejected` / `recalled`
(do **not** reuse `recalled`: recall is submitter-initiated withdrawal,
returned is approver-initiated rework — inbox filters, SLA reporting and
the status mirror must distinguish them). Because the record lock and the
`openNodeRequest` per-(object, record) pending-dedupe are both keyed on
`status: 'pending'`, finalizing round N as `returned` *automatically*
unlocks the record and clears the way for round N+1 — no lock-machinery
change at all.

Sync points (dual-source enums, all updated together):
`ApprovalStatus` (spec contracts), `sys_approval_request.object.ts`
status select, and the Console status filters/badges.

### D2 — `revise` joins `APPROVAL_BRANCH_LABELS`; `maxRevisions` joins the node config

- `APPROVAL_BRANCH_LABELS = { approve, reject, revise }`. The decision
  surface stays `approve | reject` (`ApprovalDecision` unchanged);
  send-back is a **separate service verb** (`sendBack`), mirroring how
  `recall` is not a "decision".
- `ApprovalNodeConfigSchema` gains
  `maxRevisions: int ≥ 0, default 3` — the maximum number of send-backs
  per (run, node). A send-back that would *exceed* the budget instead
  **auto-rejects**: the request finalizes `rejected` (audit carries the
  revise intent + an auto-reject marker comment), and the run resumes
  down the `reject` edge with `output.decision = 'reject'`,
  `output.autoRejected = true`. `maxRevisions: 0` ⇒ send-back always
  auto-rejects (effectively disabled, loudly).
- A flow whose approval node has **no `revise` out-edge** rejects
  `sendBack` with `VALIDATION_FAILED` (checked against
  `automation.getFlow()` before any mutation). This guards the engine's
  label-fallback behavior — resuming with an unmatched `branchLabel`
  falls back to *all* out-edges, which must never happen by a user
  clicking a button.

### D3 — wait-node + REST resubmit (not record-change triggers)

The revise edge targets an ordinary **`wait` node** (signal flavor) — the
durable pause already shipped for timers/signals. The revise window is
therefore *visible flow state* (designer canvas, run logs, suspended-run
stores all already understand it), not an invisible service limbo.

> **Superseded 2026-07-28 (#3823).** Reusing the generic `wait` put an
> author-placed, raw-resumable node in a service-owned position. Once #3801
> made `resume` authorization-bearing, that became exploitable (unauthorized
> resubmit with no audit row; a colliding request can permanently destroy the
> run). The revise pause moves to a **dedicated service-owned node** — still
> visible on the canvas, no longer raw-resumable. Shipped 2026-08-05 as
> **`approval_revise`**; read D3 as "the revise edge targets an
> `approval_revise` node". See the amendment below.

Resubmit is an explicit REST verb by the submitter:

```
POST /api/v1/approvals/requests/:id/revise    (approver; audited 'revise')
POST /api/v1/approvals/requests/:id/resubmit  (submitter; audited 'resubmit')
```

`resubmit` validates: actor is the submitter, the request is `returned`,
and it is the **latest** request for its (run, node) — then resumes the
run (branch label `resubmit`, informational). Traversal walks the
back-edge into the approval node, whose executor re-runs `openNodeRequest`
→ round N+1 pending request → re-lock → suspend. A record-change trigger
was rejected: saving a draft mid-edit must not resubmit; an explicit
"I'm done" verb matches every mainstream approval center and gives the
UI an unambiguous button.

New audit kinds `'revise'` / `'resubmit'` join `ApprovalActionKind` AND
the `sys_approval_action` select enum (dual-source, missed sync = insert
500). Both rows land on the *round-N* request: round N's trail ends
`… revise → resubmit`, round N+1 opens with its own `submit`.

### D4 — round numbering rides the config snapshot (`__round`), no migration

`openNodeRequest` counts existing requests for (`flow_run_id`,
`flow_node_id`) and stamps `__round: N+1` into `node_config_json`
(precedent: `__flowLabel` / `__nodeLabel`). Surfaced as `round?: number`
on `ApprovalRequestRow` (absent/1 ⇒ first round). `current_step_index`
keeps its existing meaning; no schema change, old rows read as round 1.

### D5 — engine: typed back-edges, re-entry semantics, runaway guard

The flow spec docs already promise back-edges (*"back-to-previous
rejection → a back-edge to an earlier node"*); the executor now honours
them, under explicit constraints:

- **Authoring**: `FlowEdgeSchema.type` gains `'back'`. A back-edge is an
  ordinary traversal edge at run time; its *only* special property is
  that **cycle validation ignores it**. `registerFlow` validation becomes:
  the graph **minus `back`-typed edges must be a DAG** (the existing
  `detectCycles` runs on the reduced graph). An unmarked cycle is still
  rejected — authors must opt in, edge by edge.
- **Re-entry semantics** (same node, second visit): node outputs are
  written under `${nodeId}.${key}` — a re-entry **overwrites** (latest
  round wins), which is exactly what `decision`-style outputs want;
  the step log appends (every visit is a separate step entry, so run
  observability shows round 1 and round 2); a re-suspend at the same
  node persists a fresh continuation under the same `runId` (the resume
  path already rebuilds `SuspendedRun` from live state — no keyed-by-node
  assumption exists).
- **ADR-0039 compatibility**: the single-program-counter invariant is
  untouched — a back-edge moves the *one* position backwards; it never
  creates a second concurrent position. Back-edges remain **banned inside
  structured regions** (regions stay acyclic per ADR-0031 validation, and
  durable pause inside a region is already rejected). ADR-0039's D7
  "no back-edges" applied to *Track B's runtime tokens*; this ADR amends
  the authoring surface deliberately and narrowly.
- **Runaway guard**: `executeNode` counts top-level visits per node
  (step-log entries without a `parentNodeId`, so loop-region iterations
  don't count); exceeding `MAX_NODE_REENTRIES = 100` fails the run with
  a loud error. This is the engine's backstop; the *product* guard is
  `maxRevisions` (D2), which terminates well before.

### D6 — lock lifecycle and the interaction matrix

| moment | request status | lock |
|---|---|---|
| round N pending | `pending` | locked |
| revise window (run at the `approval_revise` node) | `returned` | **unlocked** (hook keys on pending) |
| after resubmit (round N+1) | new row `pending` | re-locked |

- **unanimous × revise**: one approver's send-back finalizes the request
  immediately (like reject under unanimous). Round N+1 reopens with the
  **full approver set**; prior approvals do not carry over — the data
  changed, so every sign-off is stale by definition.
- **recall × revise window**: the submitter may abandon a revision —
  `recall` on the *latest `returned`* request (the one normal recall
  precondition `pending` doesn't cover) flips it `returned → recalled`
  (the one sanctioned terminal→terminal transition) and audits `recall`.
  The run is paused at the *revise window* node, which has no `reject` out-edge to
  resume down — so this lands the engine's first **run-cancel primitive**:
  `cancelRun(runId, reason)` consumes the continuation and records a
  terminal `cancelled` log (`ExecutionStatus` already reserves the value).
  Recall of a *pending* request keeps its existing reject-edge resume.
  SLA escalation, reminders and action links all key on `pending` and are
  naturally inert during the window.
- **escalation × revise**: `returned` requests are invisible to the
  escalation sweep (it scans `pending`); round N+1 starts a fresh SLA
  clock from its own `created_at`. Deliberate: the clock measures *this
  approver's* latency, not the submitter's rework time.

## Why not the alternatives

- **Reuse `recalled` for sent-back** — collapses two different actors and
  intents into one state; the inbox can no longer say "waiting on you to
  fix and resubmit" vs "you withdrew this".
- **Approval node re-suspends itself in a "revise mode"** (no wait node,
  no back-edge) — hides a whole state machine inside one node, invisible
  to the canvas/run log, and still needs re-entry semantics the moment a
  second round opens a new request. *(Partially reversed 2026-07-28, #3823:
  the objection is to hiding the state inside the approval node, and it does
  **not** apply to a **dedicated** revise-pause node — visible on the canvas
  like `wait`, but typed as service-owned. The real axis was reuse-vs-a-new-type,
  not visibility-vs-enforcement. See the amendment.)*
- **Record-change-triggered resubmit** — every draft save becomes a
  resubmission; no explicit user intent; collides with the lock hook's
  system-write exemptions.
- **Generic engine `goto`/jump API** — strictly more power than needed;
  typed back-edges keep the authored graph the single source of truth
  and keep validation decidable.

## Consequences

- **Revise window × record-change triggers**: an edit made inside the
  window can re-fire the very record-change trigger that opened the flow
  (the showcase budget flow gates on `budget != previous.budget`), opening
  a *parallel* run's pending request on the same record. `resubmit`
  refuses with `DUPLICATE_REQUEST` while any pending request collides on
  the record — refusing *before* the suspension is consumed, so the
  parked run stays resumable once the collision is recalled. Flow authors
  should gate such start conditions (e.g. on the mirrored approval-status
  field) when the trigger field is one the submitter is expected to edit
  during revision.

- The DAG invariant softens to "DAG modulo declared back-edges" — cycle
  detection, designer validation and AI flow authoring all need the same
  reduced-graph rule (Studio designer support for *drawing* revise edges
  is a follow-up issue; the model/engine land first).
- Two enum dual-sources gain values (`returned`; `revise`/`resubmit`) —
  the known 500-on-insert trap if either side is missed.
- `IApprovalService` grows `sendBack()` / `resubmit()`; REST grows the
  two verbs; Console inbox grows the approver button, the submitter
  resubmit entry, timeline rendering and ten-locale strings.
- Round-aware inbox: `round` on the row enables "Round 2" chips with no
  migration.

## Test matrix (the real cost, ADR-0039 style)

multi-round (1→2→3) × `unanimous` (send-back mid-round clears partial
approvals) × lock states (locked → unlocked → re-locked) × recall crossing
the revise window × `maxRevisions` overflow auto-reject × flows with no
revise edge (sendBack rejected) × engine: back-edge registration passes /
unmarked cycle still rejected / re-entry overwrites outputs / runaway
guard trips.

---

## Amendment (2026-07-28, #3823) — the revise pause must be service-owned; the generic `wait` was the wrong reuse

**What reverses.** D3's "the revise edge targets an ordinary `wait` node" and the
second *Why not* bullet's rejection of a service-owned revise pause. Both stand on
information this ADR did not have: at authoring time `resume(runId)` had **no
authorization model**, so *which node the run is parked on* carried no security
weight — a `wait` was as safe as anything, and reuse was pure upside. [#3801](https://github.com/objectstack-ai/objectstack/issues/3801)
then made the resume seam authorization-bearing (a node's descriptor declares
`resumeAuthority`, and an `approval` pause is refused to anyone but its owning
service). That reframes the choice: **a generic node sitting in a service-owned
position is now precisely what a type-keyed gate cannot see.** This is new
information reversing an earlier trade-off, not a defect in the original call.

**The hole it opened** (demonstrated in #3823 — a repro on the real engine +
`ApprovalService`, not reasoned). The revise window parks the run on an
author-placed `wait`, which is `resumeAuthority: 'any'`. A raw
`POST …/runs/:runId/resume` therefore:

1. walks the `resubmit` back-edge into the approval node with **no submitter
   check and no `resubmit` audit row** — an unauthorized resubmit the trail
   never records (an empty body suffices; no `branchLabel` is needed); and
2. worse — when a colliding pending request exists on the record, the exact case
   `resubmit` refuses with `DUPLICATE_REQUEST` *specifically to keep the run
   alive* (see Consequences) — the raw resume goes around that guard, the
   approval node's re-entry fails **after** the engine has consumed the
   suspension, and the run is **permanently destroyed**: the round-N request is
   stuck `returned`, the run that owned it is gone, and no resubmit can ever
   reach it.

The first is unconditional; the second is opportunistic but is remote run
destruction, not merely a missing audit row.

**Why the original objection no longer decides it.** This ADR rejected the
service-owned revise pause because it "hides a whole state machine inside one
node, invisible to the canvas/run log." That objection is against re-suspending
*inside the approval node*. It does **not** apply to a **dedicated revise-pause
node type**: that node is still a first-class box on the canvas and in the run
log — visible exactly as the generic `wait` is today — while its descriptor
declares `resumeAuthority: 'service'`, so the existing #3801 gate covers it with
no new machinery. The real axis was never visibility-vs-enforcement; it was
**reuse-vs-a-new-type.** ADR-0044 chose reuse (no new node type), and reuse is
what seated a generic node in a privileged position.

**Ruling (2026-08-05).** The maintainer approved this reversal. The criterion set
for the implementation was that the revise pause become visible to the existing
#3801 `resumeAuthority` type gate **with zero new machinery**; the owner-claim
alternative (a per-suspension capability) was rejected outright, its
screen-inheritance hazard being part of why. See *Implementation* below for what
shipped.

**Decision of record (the short-term fix).**

- The `revise` edge targets a **dedicated service-owned pause** — a distinct node
  type whose descriptor carries `resumeAuthority: 'service'` (equivalently, the
  approval node re-suspends in a revise mode that surfaces as its own step). It
  stays visible on the canvas and in run logs; it is no longer raw-resumable.
- `resubmit` remains the only door into the window, so the submitter check, the
  latest-request check and the `resubmit` audit row are back on the only path
  that can advance it — and the `DUPLICATE_REQUEST` run-preservation guard can no
  longer be bypassed.
- **Publish-time graph-lint rejects a `revise` edge wired into a bare `wait`.**
  The previously-recommended shape becomes *un-authorable*, surfaced at authoring
  rather than runtime — the cloud#688 pattern (fix the producer + reject the
  wrong shape; never tolerate it at the consumer). This is the decisive property
  for a metadata-driven platform: an AI author following the *original* D3 sketch
  would generate the vulnerable graph verbatim, because nothing in the metadata
  expressed that the wait sat in a privileged position. Making the wrong shape
  unrepresentable is the only fix that survives AI authoring.

**Directions recorded but deliberately not built here** (ADR-0049 posture — no
speculative machinery ahead of a consumer):

- *Fail-closed descriptor default.* `resumeAuthority` defaults to `'any'`, so
  every future pausing node ships fail-open unless the author remembers the flag
  — the "declared ≠ enforced" trap (AGENTS.md Prime Directive #10) one node away.
  The long-term-correct default is that a pause is **not** raw-resumable unless it
  opts into `'any'` (screen / wait-signal declaring it explicitly). A breaking
  change to the descriptor default; needs a migration; tracked separately.
- *Per-suspension owner claim.* The general answer for pauses whose authority
  depends on runtime **position** rather than declared **type**: the pause mints a
  capability the resumer must present (the Step Functions task-token shape — our
  `RESUME_AUTHORITY_SERVICE` symbol, but bound to the suspension *instance* rather
  than the node type). Not needed for the two cases we have (approval, revise),
  both of which type + a fail-closed default resolve. It also carries a
  non-obvious hazard: a claim must **not** be inherited by a downstream pause — an
  approval whose `approve` branch reaches a `screen` must leave that screen
  caller-continuable, so blanket inheritance would break screen flows. A reason
  not to reach for it prematurely.

**How mainstream approval/workflow engines inform this.** None exposes a
generic, node-type-agnostic "resume run X at its current pause" to untrusted
callers. Salesforce / ServiceNow make each pause a distinct authorized operation
(approve / reject / recall). Camunda separates user-task `complete` from message
`correlate`, with manual token moves gated as an audited admin escape hatch.
Temporal routes through named signals the workflow itself gates. Step Functions
mints a task token at suspend that the resumer must hold. ObjectStack's one
generic resume door is the outlier; keying its authority on node type is a
reasonable stopgap, but the revise `wait` is the model showing the key doesn't
always match the trust boundary. The short-term fix realigns them for the one
case that matters; the two deferred directions are how the platform would
generalise if a third case appears.

Refs #3801, #3853, #3879; security lineage in ADR-0019's #3801 / #3879 addenda.

### Implementation (2026-08-05, #3823)

Of the two equivalent shapes the amendment allowed, the **dedicated node type**
shipped:

- **`approval_revise`** (`APPROVAL_REVISE_NODE_TYPE`, `spec/automation/approval.zod.ts`)
  — registered by `plugin-approvals` alongside the `approval` node, one call site
  so no deployment can hold half the feature. Its descriptor declares
  `resumeAuthority: 'service'`, `supportsPause`, `isAsync`, `category: 'human'`
  and **no `configSchema`**: the window is pure position in the graph, with no
  signal and no timer, so nothing invents an authorable surface that has no
  reader. Its executor suspends and arms nothing, hence no
  `onSuspensionReleased` pairing (contrast the wait node's timer one-shot).
- **Nothing in the engine changed.** The #3801 gate keys on the suspended node's
  registry type; a node type that declares service ownership is covered as-is.
  That was the ruling's criterion and it held literally — the diff touches no
  file in `service-automation`.
- **Two refusals, both prescriptive.** `ApprovalService.sendBack` refuses a
  `revise` edge whose target is not `approval_revise` **before any mutation**
  (alongside the existing missing-edge check), so a run can never be parked in a
  window something else can advance; and
  `flow-approval-revise-target-not-service-owned` (`@objectstack/lint`,
  severity `error`) rejects the shape at authoring time — `os build` / `os
  validate` / `os lint` and the runtime metadata publish gate, via the already-wired
  `lintFlowPatterns` entry. It qualifies for `error` under that module's stated
  bar ("the runtime refuses"), which is why the deliberately-narrow lint promotion
  needed no new rule wiring either.

**Why the approval node does not re-suspend itself.** The equivalent shape was
available and cheaper by one node type, but it would skip the author's `revise`
edge — every node on that branch (a `notify`, a status update) would stop running,
and the window would vanish from the canvas and the run log, which is the property
D3 chose the generic `wait` for. Only the *reuse* was wrong.

**Backward compatibility, stated plainly.** A flow authored against the original
D3 (`revise` → a plain `wait`) keeps registering and running; its approvals stay
decidable (`approve` / `reject` / `recall` / `reassign` are untouched). What
changes is that its **send-back is refused** with a message naming the node and
the one-token fix (`type: 'wait'` → `type: 'approval_revise'`), and re-publishing
it reports the lint error. A run **already parked** in a legacy revise window
before the upgrade stays raw-resumable: `SuspendedRun.nodeType` is recorded at
pause time and read recorded-first on purpose, so a republish cannot re-type a
node under a live run — such a run is drained by `resubmit` or `recall` as usual.

An ADR-0087 D2 conversion (silently rewriting a `revise`-target `wait` to the new
type at load) was considered and **rejected**: unlike the conversions in that
layer it would not be a lossless re-spelling but a topology-conditional semantic
rewrite, and it would silently drop a timer-flavoured wait's timer or make a wait
shared by another in-edge service-only for that path too — breakage a conversion
cannot see. The measured population argues the same way: the Studio designer
cannot author revise edges yet (this ADR's own follow-up), the `cloud` repo has no
revise flow, and this repo's single one is the showcase, migrated in the same PR.
A loud refusal with a one-token fix beats a tolerance layer that would have to be
retired later — and beats it most for AI authors, who read the diagnostic.

**Narrowing worth knowing:** the `revise` edge's **immediate** target must be the
window. A graph that wanted `revise → notify → window` is refused rather than
analysed for "every pause reachable on this branch is service-owned", which is
unbounded. Send-back already notifies the submitter itself, so the pattern has no
lost capability behind it.

### Fail-closed descriptor default — landed (2026-08-08, #5561)

The first of the two "directions recorded but deliberately not built here" is now
built, in two steps, and this section supersedes the paragraph above that says
`resumeAuthority` "defaults to `'any'`".

- **Step one (#5561, PR #5725, non-breaking).** `ActionDescriptorSchema.resumeAuthority`
  dropped its Zod `.default('any')` and became `.optional()`. That default was not
  merely a bad value, it was an *erasure*: `defineActionDescriptor` filled the key
  before any consumer saw the object, so "the author chose `'any'`" and "the author
  never considered it" parsed byte-identically and the omission could not be
  detected at all. With the default gone, absent means absent — which is what made
  a registration warning (`AutomationEngine.registerNodeExecutor`, once per node
  type) and a CI gate (`check:resume-authority-declared`, AST over shipped
  `defineActionDescriptor` literals) expressible. The four pausing built-ins
  (`screen`, `wait`, `subflow`, `map`) declared `'any'` explicitly in the same
  step, so the warning named nothing on a stock boot the day it shipped.
- **Step two (#5561, this change, breaking).** `AutomationEngine.resolveResumeAuthority`
  resolves an absent value to `'service'` instead of `'any'`. A pausing node type
  that never declares who may continue its pauses is now closed to the generic
  resume route: `POST /automation/:name/runs/:runId/resume` answers **403** and
  names the missing field. The generic door is an **opt-in** a descriptor states
  with `resumeAuthority: 'any'`, not a default every pausing node inherits.

**Why the amendment's reasoning survives the split.** The direction was always
about which way to guess when nobody declared. Guessing `'any'` continues a run
past a decision nothing recorded, and says nothing — that is #3823 exactly, and
its demonstrated cost was an unaudited resubmit plus a destroyed remote run.
Guessing `'service'` refuses a resume and hands the author back the one-line
declaration that fixes it. Only one of the two mistakes is discoverable by the
person who made it, and for a platform whose node vocabulary is extended by
plugins and by AI-written metadata, discoverability at authoring time is the whole
argument.

**Migration.** One line, on the descriptor of any pausing executor that relied on
the old default: `resumeAuthority: 'any'`. Registered in the ADR-0087 chain as
`action-descriptor-resume-authority-default-flip` (step 17, semantic — it is a
posture change with no metadata shape to rewrite, the same category as protocol
12's `api.requireAuth` flip). In-tree the flip moves nothing: all six shipped
pausing types already declare their authority, which the resolver tests assert
alongside the inventory they depend on.

**The second deferred direction is untouched.** *Per-suspension owner claim* stays
unbuilt and unneeded for the same reason as before — the cases we have are
resolved by node type plus a fail-closed default, which is now what exists.
