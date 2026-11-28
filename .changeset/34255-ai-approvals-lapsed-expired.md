---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(plugin-chatbot): a pending AI action that lapsed reads "Expired" in the AI Approvals inbox and in the chat's approval card, not "Rejected"

Clause-②: yes (widening)
Metadata-protocol: none

Widened: `@object-ui/plugin-chatbot`'s exported `ToolDecisionState` gains the member `expired` (read from `useHitlInChat().decisions`, passed in through `ChatbotEnhancedProps.toolDecisions`); `@object-ui/i18n` gains `aiApprovals.statusExpired` and `aiApprovals.expiredDetail` in every locale pack.

A pending action nobody decided in time, or whose proposer lost access, is stored `status: 'rejected'`, `rejection_reason: 'lapsed'`, with no `decided_by`. The AI Approvals inbox badge, its phone card and its detail drawer now read such a row as "Expired", say why, and name no decider; a row a person rejected (a `decided_by` is recorded) still reads "Rejected". A decision on a lapsed item, answered `409` with `error.details.reason: 'pending_action_lapsed'`, now reads "Expired" in place of the conflict error: in the inbox the list is re-read, so the row turns "Expired"; in the chat the approval card (and the record-write card) settles on a new `ToolDecisionState` value, `expired`. Two new locale keys, `aiApprovals.statusExpired` and `aiApprovals.expiredDetail`, in all 11 packs.
