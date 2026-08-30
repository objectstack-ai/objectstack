---
'@objectstack/spec': patch
---

liveness ledger: `tool.json`'s `parameters` note now records the post-#13317 reality (#13345)

The `_note` on `ToolSchema`'s `parameters` entry asserted, in substance, that
`registerToolFromDefinition` registered every bridged tool with **no**
`inputSchema` — "so this key never reaches an MCP client" — and cited that as
the asymmetry with `name` / `description` (filed as #13271). PR #13317
(`e29fc212`, merged 2026-08-30T04:42:09Z) fixed exactly that: `parameters` is
now converted through zod@4's `fromJSONSchema`
(`packages/mcp/src/mcp-server-runtime.ts#toolInputSchema`) and forwarded as
the SDK `inputSchema`
(`registerToolFromDefinition`), so the key reaches `tools/list` too. The old
sentence was stale and, left as-is, would have mis-described the current
framework MCP bridge.

The note is corrected to record the fix and keep a sharper nuance than "no
schema" ever captured: the pre-fix behaviour was the SDK synthesising
`EMPTY_OBJECT_JSON_SCHEMA` (`{"type":"object","properties":{}}`) for a
schema-less registration — a positive claim that the tool takes no arguments,
not silence.

The grade does not move: `parameters` was `live` before this change and stays
`live` — the cloud LLM path (`vercel-adapter.ts#buildVercelOptions`) has read
it all along, and that's what the verdict has always rested on. This closes an
asymmetry between two consumers, not a change in liveness status.

Data-only: no schema, no runtime, no authoring surface changes. `liveness/` is
in this package's `files` array, so this ledger ships in the npm tarball and
this is published data.
