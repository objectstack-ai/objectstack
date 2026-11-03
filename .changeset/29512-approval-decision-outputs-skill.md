---
'@objectstack/skills': patch
---

docs(skills): the automation skill teaches that an approval's decision outputs are enforced at the decision

Clause-②: no
Metadata-protocol: none

- **Before.** `skills/objectstack-automation/references/state-machines-and-approvals.md` said only that a typed `decisionOutputs` entry renders the matching record picker in the decision dialog (`multiple` collects an id array). An agent writing an approval flow from it could read `type` and `multiple` as widget hints and not know that a value the next step cannot use is refused.
- **Now.** The *Recording a decision* section says what the approvals service enforces, on approve and reject alike and before any write: a picker value must resolve through the `expression` approver's resolvers (`user` by any account's record id, `department` by record id in the request's organization, `team` by record id not owned by another organization, `position` by the machine name of a position someone in that organization holds); `multiple: true` takes a list of distinct values for every kind, bare keys included, and without it one value; any other non-blank value is refused with `400 VALIDATION_FAILED` naming `outputs.KEY`. The Console sends a list for a `multiple: true` text output. The existing `lead_review` node is the example. The file stays within its token ceiling (5724 of 5730).
