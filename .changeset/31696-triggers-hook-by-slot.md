---
'@objectstack/service-automation': patch
'@objectstack/trigger-api': patch
'@objectstack/trigger-schedule': patch
'@objectstack/runtime': patch
---

feat(automation): triggers and the inbound hook dispatch by slot, so each package's flow of a name two packages hold is armed on its trigger and reached by its own hook (ADR-0150 D4/D5, part of #31696)

Clause-②: yes (widening)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or renamed. A slot of a shared name that was declined at arming is now armed, and every hook answer a post could already get is unchanged (the bare hook of a shared name still answers the one 401), so there is nothing for a migration to rewrite and no tombstone. -->

- **Triggers.** A trigger now arms each slot of a flow name two packages hold under the slot's key (`PACKAGE/NAME`) and fires that slot's own body. It never re-resolves the bare name at fire time. Before, both slots were declined at arming, each with a warning. A name one package holds keeps its bare binding and its run unchanged. The one slot left when the registry holds a name twice but one body was refused stays declined, behind the same warning.
- **Re-arming.** When a second package's flow of a name arrives, the incumbent's binding is released before it is armed under its qualified key, and the reverse happens when that package leaves. An event the released binding still delivers (a job whose cancel has not landed) runs nothing, so each slot fires once across the re-arm window. A schedule job is `flow-schedule:NAME` while one package holds the name and `flow-schedule:PACKAGE/NAME` for each slot of a shared one. The run reads the flow's own name in `params.flowName`, never a slot key.
- **Dispatch keys.** `AutomationEngine.flowDispatchHolder` answers a slot key with the slot's package, `claimBare: false`, and the flow's `name`. The schedule and time-relative triggers spell the dispatch key with that name (`schedule:PACKAGE:NAME:WINDOW`), which is the key the same slot claimed while it held the name alone. The `name` member is optional on both triggers' structural interfaces.
- **Inbound hook.** The new `AutomationEngine.inboundHookSlot(flowName, address?)` says which slot's hook an address reaches. It answers `undefined` for any other name, and those addresses are judged exactly as before.
  - The qualified hook `/api/v1/automation/hooks/:ns/:flowName/:hookId` serves its namespace's slot. Its secret is read by slot through the flow credential channel.
  - The bare hook of a shared name names neither flow, so it answers the door's one refusal (401), exactly as before this change and as every unverified post is answered; nothing is enqueued. Its cause (`shared-name`) and both holders are written to the server log only. ADR-0150 D5's `409` naming the holders does not apply to this anonymous door, whose answer never says whether a flow name exists or which packages are installed.
  - A qualified address no slot answers, and a slot key in the name position, get the hook's one unverified answer (401).
  - The self-hosted mount and the `trigger-api` member both route this way. The hosted face (`@objectstack/runtime`) routes the qualified address and serves a routed slot through the service's new `handleInboundSlotHook` door (not on the `ITriggerApiService` contract). Its bare route still reads no service before the member.
