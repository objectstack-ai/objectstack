---
"@objectstack/service-automation": patch
"@objectstack/plugin-approvals": patch
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

fix(approvals): a schedule-triggered run can write its own locked record (#3712)

#3456 let the run that opened a pending approval write its own target record,
keyed on `flowRunId`. It worked for every run that resolves an identity and
missed the one that doesn't: an effective `runAs:'user'` run with **no trigger
user** — a schedule being the canonical case — passed no ObjectQL context at
all, so nothing carried the run id and the run still died on its own
`RECORD_LOCKED`.

The blocker was never the lock. It was that "no identity" and "no context" were
the same thing on the wire, so a run could not say *who it was* without also
claiming *what it was allowed to do*.

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
answers *who is calling* and is absent when no identity envelope was supplied —
a distinction real gates depend on (the attachment access gate skips bare-kernel
writes on exactly that test). Folding a run id into `session` would have forced
an identity-less run to present an empty session, silently turning "no caller"
into "an anonymous caller" and narrowing the #1888 fail-open for attachments
alone. `HookContext.provenance.flowRunId` says what produced the write; the
approvals lock reads it there.

Also relaxes `BaseEngineOptionsSchema.context` to a partial envelope
(`ExecutionContextInput`). `positions`/`permissions`/`isSystem` carry parse-time
defaults, which made them *required* on a caller-supplied option and asserted
something untrue — that every data-engine context carries a principal. Callers
have always passed slices (`{ isSystem: true }` for a system read); the type now
says so.

Migration: nothing to change unless you read the run id inside a hook. If you
wrote `ctx.session.flowRunId`, read `ctx.provenance.flowRunId` instead — the
field never shipped under the old name.
