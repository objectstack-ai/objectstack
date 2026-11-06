---
'@objectstack/skills': patch
---

docs(skills): the automation skill teaches the mail `option` formatter for a notice's select label, and that a user target owns a row only while an active member

Clause-②: no
Metadata-protocol: none

Two lines in `objectstack-automation/SKILL.md`, each following a platform change that landed before it. In the `notify` section: an option label in a notice is written in the mail `template` as `{{ stage | option:opportunity.stage }}`, which prints the label in each recipient's language and is mail-only (refused in an inline `title` / `message`) — never `label()` in `templateData`, which is evaluated once per run, before recipients fan out. In "Assignment rules": `assignTo: { type: 'user', value: '<id>' }` names an owner who holds the row only while an active member of its organization, else the row is written ownerless. Eval 15 of `evals/flows-triggers-approvals.json` grades the notice case. The docs page `automation/queues-and-assignment-rules` gains the organization-authored `sys_assignment_rule` rules beside the declared ones: evaluated first, by `sort_order` then name, first match wins, a failed read of the organization's rules routes nothing, and the active-member rule for a `user` target. Paid inside the skill by deleting the CRM Automation Blueprint section (the `src/flows` layout objectstack-platform's bootstrap reference carries) and two restatements.
