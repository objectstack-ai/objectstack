---
'@objectstack/spec': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(spec): an AI pending action can be `held`: a member-confirmed write that a host policy holds for an approver outside the conversation is no longer recorded as `executed`

Clause-②: yes (widening)
Metadata-protocol: none

`PendingActionStatus` (`@objectstack/spec/contracts`) and its wire mirror `AiPendingActionStatusSchema` (`@objectstack/spec/api`) gain `held`, and `approvePendingAction` / `ApproveAiPendingActionResponseSchema.status` may answer `held`. It means the confirmation was accepted and the write waits on an approval outside the conversation: nothing has been written yet. Like `failed`, it is a 200. It is not a final state: the host that held the action writes `executed`, `rejected` or `failed` when that approval resolves.

A consumer that switches on the approve outcome should handle `held` before treating a 200 as success. In `@object-ui/plugin-chatbot`, `useHitlInChat` records it as a new `ToolDecisionState` member, `{ state: 'held', decision: 'approved', result }`, and sends no continuation turn. The record-write card and the generic approval strip draw "Waiting for approval" for it, never success wording. `AiPendingActionsInbox` labels `held` rows and a held approve outcome the same way, instead of "Executed" or a failure. `@object-ui/i18n` adds `aiApprovals.statusHeld` in every locale.
