---
'@objectstack/skills': patch
---

docs(skills): the objectstack-automation skill names the `save_notice` flow node and points to the save notice's one home

Clause-②: no
Metadata-protocol: none

`skills/objectstack-automation/SKILL.md` listed no `save_notice` node, so an author designing a "sent for approval" flow from this skill never found it. Its Data Operations table now carries a `save_notice` row that points at `objectstack-data` `rules/lifecycle.md` § Save Notice, which stays the one full teaching. That section gains what the code does and it lacked: a hook's `ctx.notice` message is shown untranslated; a `save_notice` message translates under `flows.<flow>.notices.<node_id>.message`; the node refuses by name in a `subflow` / `map` child, and a flow with one after a `subflow` / `map` whose child can pause is not armed (`unboundCause: 'notice_after_suspending_subflow'`). `evals/flows-triggers-approvals.json` gains case 16. Growth in both files is paid by same-file deletions of restated text; no ratchet row moves.
