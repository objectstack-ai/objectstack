---
'@objectstack/skills': patch
---

docs(skills): the automation skill teaches that an approval's decision outputs are enforced at the decision

Clause-②: no
Metadata-protocol: none

The `decisionOutputs` teaching in objectstack-automation's state-machines-and-approvals reference said only that a typed entry renders a record picker in the decision dialog. It now also says what the approvals service enforces, on approve and reject alike and before any write: a picker value must resolve through the `expression` approver's resolvers (`user` by any account's record id, `department` by record id in the request's organization, `team` by record id not owned by another organization, `position` by the machine name of a position someone in that organization holds); `multiple: true` takes a list of distinct values for every kind, bare keys included, and without it one value; any other non-blank value is refused with `400 VALIDATION_FAILED` naming `outputs.KEY`. The Console sends a list for a `multiple: true` text output. No schema, key or behaviour changes.
