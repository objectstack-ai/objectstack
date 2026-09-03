---
"@objectstack/platform-objects": patch
"@objectstack/lint": patch
"@objectstack/mcp": patch
---

fix(ai): author the CANONICAL agent id everywhere the platform teaches one — Studio's pin, the MCP prompt example, and the lint's value roster (#14461)

`skills/objectstack-ai` tells authors that `data_chat` and `metadata_assistant`
"are **not** vocabulary — always write `ask` / `build`". The platform then
taught the opposite from every live example it ships. Nothing was broken at
runtime; what was wrong is what an author copies.

**Studio's pin.** `studio.app.ts` was the repo's ONLY `app.defaultAgent` usage,
and it spelled the alias:

```
- defaultAgent: 'metadata_assistant',
+ defaultAgent: 'build',
```

The triage card left this undecidable — if the cloud plugin registered the
agent under the legacy id, re-pinning would be a behaviour change in a
consumer this repo cannot see. Measured instead of assumed, at `cloud`
`main@3856fbf7`: `service-ai-studio/src/agents/metadata-assistant-agent.ts:12,40`
ships the record as `name: BUILD_AGENT_NAME` = `'build'`, and `plugin.ts:58`
registers `metadata_assistant` as a **one-way, resolution-only** legacy alias.
The canonical id *is* `build`; the old pin reached it by detour.

Nor is the re-pin cosmetic. Alias resolution depends on an in-memory
`registerAgentAlias` call having run at plugin init, and cloud carries two
defensive docblocks about that registration silently no-op'ing for real under
bundle load ordering (`service-ai-studio/src/plugin.ts:44-57`,
`service-ai/src/agent-runtime.ts:30-41` — "a missed alias must never hide a
real platform agent like `build`"). The canonical id never touches the alias
table, so this drops a load-order dependency from the platform's own flagship
authoring surface. On the UI side nothing moves: `objectui`'s
`AGENT_ALIAS_GROUPS` is bidirectional and canonical-first, and
`SURFACE_DEFAULT['studio-build']` was already `'build'`.

**The MCP prompt example.** `mcp-server-runtime.ts`'s `agent_prompt` argument
described itself as `'Name of the agent to load (e.g. "data_chat",
"metadata_assistant")'` — two retired aliases, neither canonical id present.
That string is served to every MCP client asking what to pass, so the one
surface that suggests a spelling to an LLM suggested the two the catalogue
forbids. Now `(e.g. "ask", "build")`.

**The lint's value roster.** `validate-ai-agent-authoring`'s `defaultAgent`
**value** limb reused the four-name `PLATFORM_AGENT_NAMES` set, so it
deliberately passed `metadata_assistant` — the gate that exists to make
authoring mistakes loud waved through the exact spelling the catalogue bans,
which is the silent-tolerance shape ADR-0078 exists to close, committed by the
gate itself. The two limbs now read different tables, because they ask
different questions:

- **declaration limb** — unchanged, still all four names. Declaring
  `metadata_assistant` shadows the `build` record through the alias exactly as
  declaring `build` does.
- **value limb** — canonical `ask` / `build` only. A legacy alias gets its own
  rule id `default-agent-legacy-alias` (exported) and its own wording, because
  an alias **resolves** (the app gets the agent it meant — a spelling defect)
  while an unknown name does **not** (the pin is inert). Describing the alias
  as "no effect" would send an author hunting a bug that is not there.

Both of the #6041 ruling's operative decisions are kept intact: still
`warning` tier, still no Zod enum narrowing. `defaultAgent: 'metadata_assistant'`
keeps parsing, building, and resolving — the only change is that authoring it
now says so.

Not breaking: nothing an author can write was removed, and both aliases stay
resolvable for old bookmarks and persisted `agent_id`s, which is the only job
ADR-0063 §2 ever gave them.
