---
'@objectstack/mcp': patch
---

test(mcp): drift guard — SKILL.md must document every registered native tool

The registered surface is obtained by driving the real registration path (a
`tools/list` round-trip against `MCPServerRuntime` with a full data+action
bridge), not a hand-maintained list, so adding a tool to `mcp-http-tools.ts`
without teaching `skill.ts` fails the suite. Guards against a recurrence of
the 7-of-9 gap fixed in #2715; red-proven by temporarily removing
`run_action` from the skill.
