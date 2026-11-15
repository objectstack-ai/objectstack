---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): two sharing rules that reach one user on one record keep one grant each, so the widest level wins and revoking one rule leaves the other

Clause-②: no
Metadata-protocol: none

A user that two sharing rules reach on the same record now ends with the most permissive access either rule grants. Before this fix the two rules shared one `sys_record_share` row: `SharingService.grant` looked a rule grant up by object, record, recipient and source, without the rule's id, and overwrote the row it found. The last rule written won whatever its level, so an `edit` rule followed by a `read` rule left the user with `read`, and a project manager who is also on the project team could not edit the project. Each rule also revokes by its own id, so the merged row belonged to whichever rule wrote last: revoking that rule removed access the other rule still granted, and revoking the other rule removed nothing.

A rule-materialised grant is now keyed by its rule id too, one row per rule and recipient. The read and write gates already take the widest level across a user's rows, so nothing on the read side changes. A manual grant, and any grant made outside the rule evaluator, keeps its one row per recipient.

No migration is needed. A row two rules already share is split by the next reconcile of the rule whose id it no longer carries: that rule writes its own row, and the user regains its access.
