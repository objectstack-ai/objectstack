---
'@objectstack/skills': patch
---

docs(skills): the AI skill teaches a skill's `context` key and its MCP record argument

Clause-②: no (published prose only; teaches the key and the argument already on main)
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md` (Skill Configuration) lists `context` among a skill's optional keys: the bare name of the context pack the skill works from, resolved in the skill's package and then its dependency closure, and refused at parse unless `tools` binds `get_record_context`, by name or wildcard. `skills/objectstack-ai/references/context-packs.md` (Serving and calling it) says how such a skill is offered over MCP: where the name resolves to a pack and the server serves `get_record_context`, the prompt takes an optional `recordId`; with it the message is the instructions, a fixed line asking for that call and its arguments as JSON, never the record itself; without it the prompt is unchanged. The `os validate` table gains the two warnings for a skill: `ai-skill-context-unknown` (a `context` no pack of the stack's own has; a dependency's pack is not read) and `ai-skill-context-omitted` (the tool bound with no `context` while an object has several packs).

`evals/skills-tools-knowledge.json`: a new case 12 asks for a skill that answers questions about one policy from a shipped context pack and that an external agent can start from a record over MCP; the expected answer is a `defineSkill` with `context` naming the pack by its bare name and `get_record_context` bound in `tools`, and says the prompt then takes an optional `recordId`.

Both prose files sat at their token ceiling, so the words are paid for in the same file and no ceiling moves. `SKILL.md` no longer calls `instructions` "the one field the open edition serves" (`tools`, `mcpPrompt` and now `context` are read there too), and drops a sentence that restated the binding rule from the author's side. `context-packs.md` drops lines its own tables and bullets already carry: the opening list of a pack's three parts, what `name` and `label` are used for at the call, and that the tool is absent without the service.
