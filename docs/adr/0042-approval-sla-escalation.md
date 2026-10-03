# ADR-0042: Approval SLA escalation — a jobs-backed scanner with audit-row idempotency

**Status**: Accepted — implemented (proposed 2026-06-12 · calibrated 2026-06-12)
· **Superseded in part (2026-08-02, [ADR-0118](./0118-non-user-actor-contract.md) D1)** — §2's reserved actor `system:sla`, wherever this record names it: machine actions record `actor_id` null, and the `escalate` row is the attribution.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0019](./0019-approval-as-flow-node.md) (approval as flow node), [ADR-0041](./0041-flow-trigger-family.md) (triggers vs jobs vs hooks — this is the canonical "jobs, not trigger" case), thread interactions (#1740)
**Closes**: [#1742](https://github.com/objectstack-ai/objectstack/issues/1742)
**Consumers**: `@objectstack/plugin-approvals` (scanner + execution), `@objectstack/service-job` (the clock), Console inbox (timeline rendering)

---

## TL;DR

`ApprovalEscalationSchema` (`timeoutHours`, `action: reassign | auto_approve |
auto_reject | notify`, `escalateTo`, `notifySubmitter`) has been contract-
complete for a while, and #1740 made the deadline *visible* (`sla_due_at`
chips). Nothing *executes* it: a breached SLA changes a chip color and
nothing else.

**Decision**: plugin-approvals owns a periodic scanner registered directly
on the `job` service (`IJobService`) — per ADR-0041's boundary, a plugin-
internal clock is a job, not a trigger. The scanner escalates each overdue
pending request **at most once** (single-shot), using the `escalate` audit
row itself as the idempotency marker — no schema migration. Machine
decisions are recorded under the reserved actor id **`system:sla`**. The
SLA clock runs from `created_at` and does **not** pause during
`request_info` round-trips in v1 (recorded as a future option).

## Context (verified 2026-06-12)

- Execution primitives all exist after #1740: `decide()` (with
  `context.isSystem` bypassing the approver check), approver-slot
  rewriting (reassign), `notify()` via the optional messaging surface, and
  the `escalate` member of the audit-action enum (both contract and
  `sys_approval_action` select).
- `sla_due_at = created_at + escalation.timeoutHours` is already computed
  by the row mapper and rendered by the Console.
- The runtime auto-loads `service-job` (`JobServicePlugin`, registered as
  service **`job`**) with interval/cron/once adapters.
- The request table has no escalation bookkeeping column, and the
  append-only `sys_approval_action` table is already the audit source of
  truth.

## The three policy decisions

### 1. Idempotency & multi-instance safety → single-shot, audit-row marker

An escalation fires **at most once per request, ever**. The marker is the
`escalate` audit row, written **before** any mutation (the audit-first
ordering #1740 established for `reassign`):

```
scan: overdue && no prior 'escalate' action → escalate
```

Rationale:

- **No schema migration.** An `escalated_at` column would need a column add
  across drivers; the audit row is already durable, queryable, and
  tenant-scoped.
- **Crash-safe.** If the process dies between the audit insert and the
  mutation, the next scan skips the request (marker present) — the failure
  mode is "escalation logged but not executed", which an operator can see
  on the timeline, rather than a double `auto_approve`.
- **Multi-instance**: the in-process job adapters run one scheduler per
  node. Two nodes could race between the marker check and the insert; the
  window is milliseconds and the worst case is a duplicate *notify* (the
  mutating actions are guarded again by `decide()`'s pending-status check,
  which makes the second decision throw `INVALID_STATE`). A distributed
  lock is deliberately out of scope until clustered deployments demand it
  (`service-cluster` exists when that day comes).

Repeat/laddered escalation (re-escalate every N hours, multi-level chains)
is a recorded non-goal for v1 — single-shot covers the dominant "don't let
it rot silently" need.

### 2. Machine decisions → reserved actor `system:sla`

`auto_approve` / `auto_reject` call `decide()` with
`actorId: 'system:sla'` under a system context. Consequences:

- The audit trail shows two rows: `escalate` (what policy fired, with the
  configured action in the comment) followed by `approve`/`reject` **by
  `system:sla`** — a reader can always distinguish a human decision from a
  policy decision.
- Clients render `system:sla` as a localized display name ("System (SLA)")
  — it is a reserved identity, never a `sys_user` row.
- Deployments that must forbid machine decisions simply don't author
  `auto_approve`/`auto_reject` in their flows; a platform-level kill switch
  is deferred until a compliance requirement actually arrives.

### 3. The clock → `created_at`, no pause in v1

The deadline stays `created_at + timeoutHours` — exactly what the Console
already shows. A `request_info` round-trip does **not** pause or re-arm the
clock: the approver who needs more material can see the deadline coming and
the submitter is incentivised to answer fast. ServiceNow-style SLA pause
("clock stops while waiting on the requester") is a future option that
would require per-request clock bookkeeping (schema change) and is exactly
the kind of speculative state this ADR avoids; it gets built when a real
tenant asks.

## Mechanics

- **Wiring**: `ApprovalsServicePlugin.start()` resolves the `job` service
  (optional, like `messaging`); when present it schedules an interval job
  `approvals-sla-escalation` (default every 5 min,
  `escalationScanIntervalMs` plugin option) and fires one **catch-up scan
  at boot** so restarts don't extend a breach by a scan period. `stop()`
  cancels the job. No job service → SLA stays display-only, exactly as
  today.
- **Scan** (`runEscalations()`): list pending requests (the same capped
  read the inbox uses), keep rows whose node config declares
  `escalation.timeoutHours` and whose deadline has passed, skip rows with a
  prior `escalate` action, then per action:
  - `notify` (default): message pending approvers + `escalateTo`;
  - `reassign`: replace `pending_approvers` with `escalateTo` (falls back
    to `notify` when `escalateTo` is missing) and notify the new approver;
  - `auto_approve` / `auto_reject`: `decide()` as `system:sla` — the owning
    flow resumes down the matching branch like any human decision;
  - in all cases, notify the submitter when `notifySubmitter !== false`.
- **Failure isolation**: per-request try/catch; one bad row never stops the
  sweep. The scan logs `{scanned, escalated}`.

## Consequences

- A breached SLA now *does* something, closing the "red chip, no action"
  gap — and the timeline explains exactly what and why.
- No migrations, no new services, no new packages: one service method, one
  optional wiring block, UI timeline rendering for `escalate` +
  `system:sla`.
- The single-shot + audit-marker discipline gives clustered deployments a
  bounded, documented race (duplicate notify at worst) instead of a silent
  double-decision hazard.
- Future work has clean seams: laddered escalation = relax the marker rule;
  SLA pause = add clock bookkeeping; compliance kill-switch = plugin
  option.

## References

- Schema: `ApprovalEscalationSchema`
  (`packages/spec/src/automation/approval.zod.ts`)
- Primitives: `decide` / `notify` / audit-first ordering in
  `packages/plugins/plugin-approvals/src/approval-service.ts` (#1740)
- Clock: `IJobService` (`packages/spec/src/contracts/job-service.ts`),
  registered as `job` by `@objectstack/service-job`
- Boundary rationale: ADR-0041 §1 (plugin clocks are jobs, not triggers)
