---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a `notify` node that does not name the `email` channel fails on a written-out address no user holds, instead of reporting success

Clause-②: no (narrowing: a `notify` node whose `channels` do not include `email`, and whose `recipients` write out an email address no user holds, or write one out as `user:ADDRESS`, now fails the node at run time instead of reporting success)
Metadata-protocol: none

An email address written out in `recipients` is the author's constant and is sent as written, and only the email channel sends to an address itself. The inbox delivers to a user, and so does the sms channel (or to a literal phone number). So on a node whose `channels` do not include `email` (the inbox, the default, or `inbox` or `sms` named), an address reaches someone only when a user holds it.

- **BREAKING (run time): such a node now fails when no user holds the address.** Before, the address went on as it stood: the inbox wrote a `sys_inbox_message` row whose `user_id` was the address, which no inbox reads, and the node reported success. Now the node fails before anything is written, and the message names the node, each such recipient and the fix. `user:ADDRESS` fails the same way, because `user:` takes a user id and the address is handed on as one with no lookup. With no data engine to look the address up, or a lookup that fails, the node fails too.
- **Unchanged.** An address a user holds, written bare, still reaches that user. A node whose `channels` include `email` sends a written-out address as written, as before. A recipient a value expression computes is not looked at on a node that does not name `email`. The node never adds the `email` channel its author did not declare.
- **Who moves.** A flow whose `notify` node does not name `email` and writes out an address no user holds. Fix: add `email` to the node's `channels` to mail the address, or name a user: a user id, an audience selector such as `role:NAME`, or the address that user holds, written bare. In this repository, the app-showcase node `alert_exec` (flow `showcase_project_escalation`) wrote out `exec@example.com` on the inbox, and now notifies `role:owner`.

<!-- adr-0087: not-required (no-migration-prescription) a run-time refusal in a `notify` node whose `channels` do not include `email` of a written-out recipient that is an email address no user holds: no authorable key, spelling or stored shape moves, the parse is unchanged, and no stored flow is read, rewritten or converted. The repair is the author's choice between mailing the address (adding `email` to `channels`) and naming a user, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
