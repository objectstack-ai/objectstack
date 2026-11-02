---
'@objectstack/skills': patch
---

docs(skills): objectstack-data rules/lifecycle.md teaches the save notice

Clause-②: no
Metadata-protocol: none

- **Before.** A hook can tell the person who made a create or update what the save set in motion (`ctx.notice(message)`, answered as the create/update `notice`), and a flow a record create/update trigger starts can set the same message with a `save_notice` node, but no published skill taught it, so an AI author writing a save hook from `objectstack-data` kept reaching for a `record:alert` banner.
- **Now.** `objectstack-data/rules/lifecycle.md` gains *Save Notice — what the save set in motion*: the `ctx.notice` spelling for inline `handler` and sandboxed `body` alike (no capability), info severity and the distinction from validation `warnings` and from a `record:alert` banner, one message per write with the last call winning, the dispatches that carry it, the non-string refusal, and the flow face (`save_notice`, refused outside a create/update record trigger and after an `approval` / `wait`).
- The file stays under its token ceiling: the new text is paid for by deleting the Decision Tree (which restated the class table and the syntax examples), the telemetry-growth anecdote and a Safety Semantics restatement. No ceiling moves; no schema, key or behaviour changes.
