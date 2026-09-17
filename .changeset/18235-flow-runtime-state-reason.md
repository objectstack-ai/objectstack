---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/types": patch
---

`FlowRuntimeState` now declares `reason` — the optional sentence saying WHY a flow is not armed — and the automation engine populates it, so `GET /automation/_status` can tell a policy-disabled flow apart from a broken binding (#18235).

Ruling G item 6 on #17396 names three surfaces that must each carry a DISTINCT reason for a flow left unarmed because package-authored scheduled work is switched off, and must never read as "binding failed". Two of them shipped: `getTriggerBindingAudit()` and the CLI startup summary. The third — a console — could not be built: Studio's only status door answers `FlowRuntimeState` rows, and that shape had no field a reason could travel in, so on the wire a policy-disabled flow was `enabled: true, bound: false, triggerType: 'schedule'`, byte-identical to one whose trigger is missing.

**Clause-②: yes (widening)** — one new key on an already-published payload, so the shape a consumer reads against grows. Nothing previously emitted is removed or renamed, and no producer is required to write it.

- **Optional, and additive by measurement.** Every producer of these rows — the engine, and the test doubles in `packages/runtime`, `packages/cli` and `packages/qa/dogfood` — writes `{ name, enabled, bound }` at minimum; a required key would have broken all of them and would demand a reason from rows that have none. The key is absent (not `undefined`-valued) on any row that is bound, disabled, or declares no trigger.
- **One vocabulary, not a new one.** The sentence is the one `getTriggerBindingAudit()` already answers for the same flow: both doors now read a single private `describeUnboundReason()` on the engine, so Studio and the boot summary cannot drift. A free-form string, matching the two surfaces that already carry this reason; ⛔ consumers render it, they do not parse it.
- **Read from the RECORD, never re-derived.** The policy sentence comes from the engine's recorded refusal (`policyDisabledFlows`, cleared the moment a flow gets past the gate), never from a live `resolveScheduledWorkPolicy()` read at call time. `_status` is served on demand, arbitrarily long after the bind — re-deriving would report a binding failure for a trigger that was never called, the defect the implementing round of #17396 already caught once.
- **Wire, not rendering.** `SCHEDULED_WORK_DISABLED_REASON`'s docblock is corrected: Studio's door now carries the reason, while displaying it distinctly remains objectui#9217's card. Declared is not delivered, and reaching the wire is not being shown. The published prose carrying the same claim moves with it — `content/docs/automation/flows.mdx`'s callout said the status door "has no field to say why", which this change makes false; both carriers are corrected in one landing, and neither now claims a console *renders* it.
