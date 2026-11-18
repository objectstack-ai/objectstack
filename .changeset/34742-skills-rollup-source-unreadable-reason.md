---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` teaches `rollupSourceUnreadableReason` beside `security-rollup-source-unreadable`

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/relationships.md` named two ways to resolve `security-rollup-source-unreadable` on a permission set that reads a roll-up `summary` but not the child data under it: grant the child read, or mask the summary. It now names the third. When the request says the set should see the total but not the children, keep the column readable and add `rollupSourceUnreadableReason` to the set's entry for it: `fields: { 'project.task_count': { readable: true, rollupSourceUnreadableReason: 'Clients see progress counts, not tasks' } }`. The warning for that set and column is then reported as a note quoting the reason. A blank reason, or one beside `readable: false`, is refused at parse time. The reason is never added to silence a total the request withholds: that one is masked.

The mask sentence now names Modify All alone as what must leave the set first. A set's own `readable: false` binds beside its own View All, so the skill no longer asks for View All to be removed.

Six restatements in the same file are cut to pay for it, so the file's token ceiling goes down, 4229 to 4221. The skill's evals gain one case (the set sees the total but not the rows, so the answer acknowledges it with a reason) beside the existing mask case.
