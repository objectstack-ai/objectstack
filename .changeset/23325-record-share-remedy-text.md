---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): a record-share grant refused for a non-user recipient names the sharing-rule recipient that delivers it, so a `group` caller is sent to `team`

Clause-②: no

**What was wrong.** `ISharingService.grant` writes a record share for a `user` only (ADR-0078), and refuses `group`, `position` and `unit_and_subordinates` with one sentence. FROM: "VALIDATION_FAILED: recipientType must be 'user' (received "group") — group/position recipients are delivered via sharing rules (ADR-0111 D7)". The sharing-rule vocabulary has no `group` recipient: a rule spells it `team`, since the ADR-0090 D3 rename. A caller or an AI that followed the remedy wrote a rule naming `group`, which neither the authoring `sharedWith.type` enum nor the `sys_sharing_rule.recipient_type` select offers. A `unit_and_subordinates` caller read a sentence that did not name its value.

**What changed.** Each declared value's remedy names its own rule recipient. TO:

- `group`: "… — a group recipient is delivered via a sharing rule with recipient type 'team', its name since the ADR-0090 D3 rename (ADR-0111 D7)"
- `position`: "… — a position recipient is delivered via a sharing rule with recipient type 'position' (ADR-0111 D7)"
- `unit_and_subordinates`: "… — a unit_and_subordinates recipient is delivered via a sharing rule with recipient type 'unit_and_subordinates' (ADR-0111 D7)"

A value no record share declares (an untyped REST body sending `team`, say) is told so, and is named no route: "… — "team" is not a record-share recipient type (ADR-0111 D7)".

**Unchanged.** Which values `grant()` accepts (`user` only), the `VALIDATION_FAILED` code and its 400, the first clause of every refusal, the retired `guest` value's own prescription, and the record-share vocabulary. Nothing is written for a refused grant.
