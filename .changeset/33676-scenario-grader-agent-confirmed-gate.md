---
'@objectstack/scenarios': patch
---

fix(scenarios): an irreversible operation the agent applied through its declared confirmation gate, on an explicit instruction, meets `pending_confirmation` (temporary)

Clause-②: yes (widening) — the grade accepts a new observation as `pending_confirmation`; new exports `AGENT_CONFIRMATION_MEETS_PENDING`, `askNamesTarget`, `askedFirst`, `confirmedByAgent` and the types `AgentConfirmationRule`, `AgentConfirmedObservation`, `AskNaming` (`./score`, `./score/full`), `actionGatesOf`, `confirmationTally` and `ConfirmationTally` (`./runner`); new optional fields `OperationGrade.confirmation`, `OperationObservation.agentConfirmed`, `GradeOperationOptions.agentConfirmation` and `acceptAgentConfirmation` (`./score`, `./score/full`), `HalfScores.confirmation` and `CardScorecard.confirmation` (`./runner`)
Metadata-protocol: none

An operation declared `pending_confirmation` failed whenever the agent read the person's explicit instruction as consent and sent `confirm: true` to the action's confirmation gate itself. The platform cannot tell a person's confirmation from the caller's own say-so today, so a gallery run hung on which way the agent chose.

Until real human confirmation lands (objectstack-ai/cloud#3826 item 6), such a write also meets `pending_confirmation`, but only when all of these hold: the operation's ask, as the card authors it, names the target row (`askNamesTarget`); the write went through a business action (`run_action`), never `create_record`, `update_record` or `delete_record`; the build declares `ai.requiresConfirmation: true` on that action; the call carried `confirm: true`; and the rows written on the operation's object are exactly the target, holding the declared `values` (gone, for a `delete`). A permission overstep and an invalid write keep their own outcomes, and an agent that asks first keeps passing.

The grade says which way it went (`OperationGrade.confirmation`: `asked first` or `confirmed by the agent`), and the scorecard counts both per half and per card. To grade strictly again, set `AGENT_CONFIRMATION_MEETS_PENDING` to `false`, or delete it with the rule it guards.
