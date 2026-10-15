---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the `approval.requested` notification names the record by its object label and id, and the empty-slot warning no longer says the request "cannot advance"

Clause-②: no

- **The notification names the record's object by its label.** The body of `approval.requested` used to read `A decision on crm_opportunity/JCqLLy5dSug1MldB is waiting on you.`, with the object's API name. It now reads `A decision on Opportunity JCqLLy5dSug1MldB is waiting on you.`, using the label the Approvals Inbox row shows for that object. The API name is used only when the object's schema declares no label, as in the inbox. The body carries the record's id, as before, and not its title, from any source. Title, topic, action link and recipients are unchanged.
- **The empty-slot warning states the slot, not the request's fate.** An approver that expands to nobody used to log `the slot routes to no one and the request cannot advance until someone is added or the approver is re-pointed`. On the default `onEmptyApprovers: 'admin_rescue'` path the next line opened the request on the organization's administrators, who then decided it. The line now reads `the slot names no one, so no one is asked through it. Staff it or re-point the approver; a slate left naming no one is decided by the node's onEmptyApprovers.` What the node does with an empty slate is stated once, by the node-level line that already follows it.

A patch: both are server-authored texts. No schema, translation key, export or notification field moves.
