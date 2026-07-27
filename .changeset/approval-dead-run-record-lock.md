---
"@objectstack/service-automation": patch
"@objectstack/plugin-approvals": patch
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

fix(approvals): a dead approval run no longer leaves the record RECORD_LOCKED (#3456)

The record lock is keyed on a **pending** `sys_approval_request`, and it could
not tell *the run that owns that request* from *an unrelated user editing the
record*. So a flow that touched its own target record while its own approval was
still pending — a manual `resume` with no decision, or a node that writes the
record between opening the approval and the decision — died on its own
`RECORD_LOCKED`, and the record stayed locked behind the dead run. Recovery
existed (#3424 lets an admin `recall`/`reject` to release it) but nothing made it
self-healing.

Both halves are now closed.

**Prevention — the owning run may write its own record.** The automation engine
stamps `flowRunId` onto the run context at setup, alongside `runAs`, and it
travels with every data node's ObjectQL context into `ctx.session`. The lock hook
exempts a write whose `flowRunId` matches the pending request's `flow_run_id`.
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

Residual, deliberately not changed here: a `runAs:'user'` run with no trigger
user (a schedule) passes no ObjectQL context at all, so it carries no
`flowRunId` and is still subject to the lock. Manufacturing a context just to
carry the run id would flip that run from its documented unscoped fail-open
(#1888) to baseline-member RLS — a separate, larger change. The sweep is what
recovers that shape.
