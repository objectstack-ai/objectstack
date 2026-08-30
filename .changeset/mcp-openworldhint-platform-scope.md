---
"@objectstack/mcp": patch
---

fix(mcp): assert `openWorldHint: false` only for platform-registered tool names (#13350)

The MCP tool bridge (`registerToolFromDefinition` in `mcp-server-runtime.ts`)
put `openWorldHint: false` in every bridged tool's `annotations` — for every
tool an app registers under its own name as well as the platform's own. No
source existed for that claim: `AIToolDefinition` has no member expressing it,
so the `false` was a property of the bridge file presented to every MCP client
as a property of the tool. An app tool that calls a weather API, an LLM or any
other outbound service was announced as having a closed, well-defined domain of
interaction. Same defect class as the `readOnlyHint` / `destructiveHint` repair
that preceded it.

The hint is now derived from `PLATFORM_PROVIDED_TOOL_NAMES`
(`@objectstack/spec/system`) — the canonical registry of the statically named
tools the cloud AI runtime registers, and the same registry the bridge's
existing `readOnlyHint` name fallback is pinned to as a subset. A platform name
keeps `openWorldHint: false`, which is known-correct: those tools act on this
stack's own records and metadata. Every other bridged tool is served **no
`openWorldHint` key at all**.

⚠️ **What omission means here, and why it differs from the sibling hints.**
`@modelcontextprotocol/sdk` 1.30.0 documents `openWorldHint` as `Default: true`
(`ToolAnnotationsSchema`), so an app tool that declares nothing is now read by
a conforming host as reaching an **open** world — where before it was told the
world was closed. That is the intended direction: the bridge has no source for
an app tool, and the protocol's own default is a better answer than a
fabricated one. It is the opposite of the `readOnlyHint` (`Default: false`) and
`destructiveHint` (`Default: true`) cases, where omission lands on the cautious
reading; the asymmetry is documented at the derivation site so it is not
"tidied" back into the defect.

Hosts that keyed behaviour off a bridged app tool's `openWorldHint: false` will
now see the annotation absent. The platform tools' `false` is unchanged, and
the object-CRUD and action bridges in `mcp-http-tools.ts` — including
`run_action`'s deliberate `openWorldHint: true` — are untouched.

Making the hint a property of the tool (a declared member on
`AIToolDefinition`, with action-backed tools inheriting `run_action`'s
`openWorldHint: true`) is a public contract extension and was ruled a
follow-up; this is the zero-contract-change half.
