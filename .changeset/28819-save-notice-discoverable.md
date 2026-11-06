---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data skill now leads a hook author to the save notice

Clause-②: no
Metadata-protocol: none

The `objectstack-data` rule index described `rules/lifecycle.md` as retention-only, and `references/data-hooks.md` listed no `notice` member, so an author writing a save hook from this skill never found `ctx.notice(message)`. The index entry now names the save notice, and the sandbox `ctx.*` table and the `HookContext` listing each carry a `notice` row that points at `rules/lifecycle.md` § Save Notice. Growth is paid by same-file deletions of restated prose; both token-ratchet rows are re-locked down at the landed counts.
