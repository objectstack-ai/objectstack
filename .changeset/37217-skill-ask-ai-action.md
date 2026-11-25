---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ai` teaches the `ask_ai` action — the **Ask AI** button on a record

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md`, a new subsection *The Ask AI button — `type: 'ask_ai'`* under *Actions as AI Tools*:

- What the action does: it pins the assistant's conversation to the record it runs on and opens the assistant, sending no message; it is declared on the object in `locations: ['record_header']` or `['record_more']`, with a `defineAction` example that type-checks against the spec.
- What the parse refuses beside it: a `target`, `ai.exposed: true`, and `actionType: 'ask_ai'` on a dashboard header (a header runs on no record).
- That nothing serves it headless: `list_actions` skips it, `run_action` refuses it, and no `action_` tool exists for it.
- Where it is absent rather than disabled: the console draws it only where the assistant surface is on and the AI service honours a conversation focus.

Paid for by deleting restatement in the same file, with the token ceiling unchanged (6801; the file now measures 6786):

- the *App AI Blueprint* table (its three rows restate *Skill Configuration*, *Knowledge Sources* and the `defineStack` note);
- the alias sentence under *Platform agents* (`data_chat` / `metadata_assistant` for old bookmarks: the agent type is closed to third parties, so no author writes either);
- the pointer to `references/_index.md` for `AgentSchema` (the *References* section already points there);
- the rung-2 sentence "Read that file for the exact set" (the sentence before it names the file);
- the two product-analogy parentheticals beside `ask` and `build`;
- the memory clause of pitfall 1, kept to its two facts (the required keys and that there is no storage backend to choose).

`evals/skills-tools-knowledge.json`: a new case 10 asks for an Ask AI button on the contract record page; the expected answer is a `type: 'ask_ai'` action in `record_header` with no `target` and no `ai.exposed: true`.
