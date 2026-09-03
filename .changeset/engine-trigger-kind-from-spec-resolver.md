---
"@objectstack/service-automation": patch
---

refactor(service-automation): take the trigger KIND from spec's `resolveFlowTriggerKind` instead of a second private copy of the chain (#14328)

No behaviour change and no API change — `patch` because nothing observable moves.
`resolveTriggerBinding` is `private`, no export is added or removed, no payload
key changes, and the kind reported for every flow is the kind reported before
(1,223 `service-automation` cases and 81 `trigger-record-change` cases green
unchanged, plus new pins across the whole precedence chain). What changes is that
one rule now has one home.

**The defect.** `AutomationEngine.resolveTriggerBinding` hand-kept the chain that
decides which trigger a flow asks for — string `record-*` token, array form,
`timeRelative` descriptor, `schedule` cadence or `type: 'schedule'`, `type: 'api'`
or `triggerType: 'api'` — in parallel with `@objectstack/spec`'s
`resolveFlowTriggerKind`, the authoring-time mirror of that same rule. Both
authoring surfaces already read the spec one: `defineStack`'s trigger-capability
refusal and `@objectstack/lint`'s `validate-flow-trigger-readiness`. The engine
did not, and nothing pinned the two together. A branch added to one side leaves
`defineStack` accepting a stack the runtime leaves inert, or refusing one it would
arm — the drift the shared resolver was hoisted to prevent, reopened one layer
down. The two agreed on every string-form flow, so this was an observation rather
than a live defect; the harm was future drift.

**The shape.** `resolveTriggerBinding` now takes its kind from
`resolveFlowTriggerKind(flow)` and keeps only the per-kind BINDING construction —
which start-node fields each trigger needs. `getTriggerBindingAudit` and the boot
banner therefore name the kind authoring named, by construction.

**The one deliberate divergence is preserved, not unified.** The ARRAY form of
`triggerType` (`['record-after-create', 'record-after-delete']`) resolves to *no*
kind in spec — multi-event unions are unsupported (#3457), and reading the shape
as "asks for a record-change trigger" would have `defineStack` demand a capability
the flow can never use and would widen the lint rule's auto-triggered set. The
engine routes it to the record-change trigger anyway, from an explicit pre-check
that runs BEFORE the resolver, for one reason: so that trigger refuses it LOUDLY
at bind time (#3481) instead of the flow folding into "manual" and vanishing from
every surface. Pre-check *ordering* is load-bearing too — array form outranks
`timeRelative`, which the resolver, blind to the array, would otherwise answer for
a start node carrying both.

**What now catches the drift.** Two guards, one static and one runtime. The
per-kind `switch` is exhaustive over `FlowTriggerKind` with a `never` default, so a
kind added to spec fails this package's type-check until its binding shape is
written; and a new case asserts every kind in `FLOW_TRIGGER_KINDS` is reachable
through the real engine. The preserved divergence is pinned on both sides: engine
routing and pre-check precedence in `service-automation`, and the refusal itself —
asserted as a refusal, on a binding the real engine produced — end-to-end against
the real trigger in `@objectstack/trigger-record-change`.
