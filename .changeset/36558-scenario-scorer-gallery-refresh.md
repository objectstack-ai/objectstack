---
'@objectstack/scenarios': patch
---

fix(scenarios): scorer and card defects from the 18.6.0 gallery refresh

Clause-②: no
Metadata-protocol: none

- On a `withheld` question, a sentence about what a dataset or report covers ("The Approved Leave dataset can't group by medical note") is no longer read as a decline, unless it binds to the asker.
- The agent-action check also fails an action the build gates (`ai.requiresConfirmation: true`) where the card has the agent act at once (`confirm: false`): `action:OBJECT.NAME->not-confirm-gated`. The build prompt says an unmarked action runs with no confirmation gate.
- `persona-grant:*:delete` reads the platform's owner-only delete floor: `allowDelete` without Modify All (or a write depth of `org`) no longer passes a delete of a seed row the persona does not own; a delete only a row-dependent rule, a `controlled_by_parent` master gate or a declared route action could admit is not measured.
- A declared `VALIDATION_FAILED` is met by a hook's own refusal with no declared code (`HOOK_ABORTED`) at a client-error status.
- Card wording: service_desk `log_ticket` states it assigns the signed-in agent and opens the ticket; leave_balances `sick_by_medical_note` asks by what the medical note says; requisition_to_receipt and travel_expense ask for a record-triggered flow.
