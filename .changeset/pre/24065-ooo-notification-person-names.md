---
'@objectstack/plugin-approvals': patch
---

Clause-②: no

The two out-of-office approval notifications name people by their display name instead of their raw user id. The delegate's `approval.ooo_substituted` body used to read `You are covering an approval on Deal D_123 while u_ooo is out of office.`, and now names the absent approver: `… while Olive Away is out of office.` The absent approver's `approval.ooo_skipped` body used to read `… was routed to u_bob while you are out of office.`, and now names the delegate: `… was routed to Bob …`.

The names come from the same user-name lookup the approvals inbox uses for pending approvers and the timeline, read once per opening for every person the out-of-office routing touched. An account row with no name is named by its email, as the inbox names it. A person with no readable name (no account row for the id, or a failed read) is still named by the user id, as before. The `ooo_substitute` entry on the request's audit trail is unchanged and still records the two user ids (`u_ooo → u_bob — reason`).
