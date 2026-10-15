---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the `approval.requested` notification names the record by its object label and title, and the empty-slot warning no longer says the request "cannot advance"

Clause-②: no

- **The notification names the record.** The body of `approval.requested` used to read `A decision on crm_opportunity/JCqLLy5dSug1MldB is waiting on you.`, so a grouped bell entry could not tell an approver which record was waiting. It now names the record the way the Approvals Inbox row does, from the same resolution: the object's label, then the record's title in quotes, `A decision on Opportunity "Acme renewal" is waiting on you.` A record with no title is named by its label and id, `A decision on Opportunity JCqLLy5dSug1MldB is waiting on you.`, which is what the body carried before. The object's API name stands in only when its schema declares no label, as in the inbox. The title is never taken from the submit snapshot, which the inbox serves only after redacting it for its reader. Title, topic, action link and recipients are unchanged.
- **The empty-slot warning states the slot, not the request's fate.** An approver that expands to nobody used to log `the slot routes to no one and the request cannot advance until someone is added or the approver is re-pointed`, and on the default `onEmptyApprovers: 'admin_rescue'` path the next line opened the request on the organization's administrators, who then decided it. The line now reads `the slot names no one, so no one is asked through it. Staff it or re-point the approver; a slate left naming no one is decided by the node's onEmptyApprovers.` What the node does with an empty slate is stated once, by the node-level line that already follows it.

A patch: both are server-authored texts. No schema, translation key, export or notification field moves.
