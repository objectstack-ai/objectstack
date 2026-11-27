---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ai` no longer teaches an authored AI button on a record page

Clause-②: no
Metadata-protocol: none

ADR-0160, seventh amendment (D6, "Entry point"): the entry to the in-app assistant is the shell's 「问 AI」 entry, and no page declares an AI button of its own.

`skills/objectstack-ai/SKILL.md`: the subsection *The Ask AI button — `type: 'ask_ai'`* under *Actions as AI Tools* is removed, with its `defineAction` example. One sentence stands in its place: no page declares an AI button of its own, so there is no action to write for one, and the shell's 「问 AI」 entry opens the in-app assistant and carries the current record automatically. The file's token ceiling follows the measurement down, 6795 to 6613.

`evals/skills-tools-knowledge.json`: case 10 keeps its prompt, an Ask AI button on the contract record page, and now expects the opposite answer: no action is written, and the answer names the shell's 「问 AI」 entry. Its `must_contain` is that entry's name, and its `must_not_contain` holds `defineAction(` and `locations:`, two tokens that only an authored action carries.

The `objectstack-ui` action-type table is unchanged: it is held row for row to the members of `ActionType`, which still include `ask_ai`.
