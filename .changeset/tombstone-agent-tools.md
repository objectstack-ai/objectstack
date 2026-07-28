---
"@objectstack/spec": patch
---

fix(spec): tombstone `agent.tools` instead of deleting it — main was red (#3894 follow-up)

#3894 removed `agent.tools` (and `AIToolSchema`) outright. That broke
`pnpm --filter @objectstack/spec build` on `main`: the authorable-surface
ratchet (ADR-0104 / #3733) fails when an authorable key disappears from
the contract, because none of these schemas is `.strict()` — Zod silently
STRIPS an unknown key, so an author who keeps writing `tools:` would get a
clean parse and an agent that reaches none of the tools they listed. That
is the same silent-capability-loss shape #3820 exists to eliminate,
restored one layer down. The gate was right and the removal was wrong.

The removal itself stands — ADR-0064's "an agent reaches exactly its
surface-compatible skills' tools, nothing falls through to the global
registry" needs the second slot gone. What changes is HOW:

- **`agent.tools` is now `retiredKey()`** — authoring it throws with the
  fix in the message (use `skills`; a platform tool by name, or
  `action_<name>` for your own AI-exposed Action; `os migrate meta
  --from 16`). This supersedes #3894's changeset line saying the key
  "remains a silent no-op rather than a parse error": loud is correct,
  and it is what this repo's ratchet requires.
- **A D2 conversion `agent-tools-to-skills`** plus its D3 chain step, so
  the removal reaches `spec-changes.json`, the upgrade guide, and the
  `spec_changes` MCP tool. Unlike the protocol-17 renames beside it this
  has no lossless target — each entry must become a reference inside a
  skill, a human decision — so the conversion drops the dead key (the
  runtime stopped reading it in cloud#910) and emits one notice per agent
  marking where capability has to be re-declared.
- **The three `ai/AITool:*` baseline lines are deleted deliberately**, the
  one case the ratchet sanctions in-PR. Those keys were authorable only as
  the element shape of `agent.tools`; with the parent tombstoned there is
  no path that reaches them, so they cannot vanish silently — the parent
  speaks first, with a prescription.

Agent tests updated to pin the rejection (and its message) rather than the
strip semantics they asserted before.
