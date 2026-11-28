---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ui` action-type table no longer lists `ask_ai`

Clause-②: no
Metadata-protocol: none

The `ask_ai` action type left `ActionType` (ADR-0160 D7), so `skills/objectstack-ui/SKILL.md` stops listing it: the `ask_ai` row leaves the *Action Types* table, and the line under the table reads "Every type but `script` requires `target`", which is what `TARGET_REQUIRED_TYPES` in the spec says. The entry to the in-app assistant is the shell's 「问 AI」 entry, which carries the current record automatically; no page declares an AI button of its own. The file's token ceiling follows the measurement down, 2262 to 2228.
