---
"@objectstack/mcp": patch
---

docs(mcp): rewrite the published README to the shipped host-extension surface (#9579)

`packages/mcp/README.md` is in the package's `files` array with `private` unset,
so it is the page npm renders. It told the reader to extend the server
imperatively at six call sites:

```ts
kernel.getService('mcp').registerTool(calculateRevenueTool);
kernel.getService('mcp').registerResource({ … });
kernel.getService('mcp').registerPrompt({ … });
```

`MCPServerRuntime` has never had any of those members. Measured against the
built `dist/index.d.ts`, a consumer who copies those lines gets three
`TS2339 Property … does not exist on type 'MCPServerRuntime'`. The receiver is a
local variable, so `check:published-readme-exports` is structurally blind to
them — both of its halves key on a name the fence *imported*, and this one is
neither imported nor a bare identifier.

Ruled 2026-08-18: **document the shipped surface; do not grow the API to match
the docs.** So the imperative narrative is gone and the page now documents what
actually ships — the bridge methods (`bridgeTools`, `bridgeDataTools`,
`bridgeResources`, `bridgePrompts`), `handleHttpRequest` / `renderSkill`, and the
exported `registerObjectTools` / `registerActionTools` / `registerSkillPrompts`
helpers driving an `McpServer`. Every row is probed against the built type entry
the `exports` map resolves, and the page's one host-extension example compiles
clean against it.

Neighbouring fabrications the audit turned up, all corrected in the same pass —
each of them was reachable only through prose or an unimported receiver, which is
why nothing had read them:

- **A tool family that does not exist.** The page listed
  `objectstack_find` / `objectstack_findOne` / `objectstack_create` /
  `objectstack_update` / `objectstack_delete` / `objectstack_describeObject` /
  `objectstack_listObjects` / `objectstack_listFields` as "auto-registered". No
  such tool name occurs anywhere in the repo. The real names are the
  `list_objects` … `run_action` set the page listed separately, one section down.
- **`aggregate_records` was missing** from the list that *was* correct, along
  with the fact that it registers only when the bridge implements `aggregate`.
- **Resource URIs were wrong in both directions.** The page taught
  `objectstack://objects/{name}/records` (no such resource) and
  `objectstack://objects/{name}/{id}` (real shape is
  `…/{name}/records/{id}`), and omitted `objectstack://objects` and
  `objectstack://metadata/types` entirely.
- **The advertised capability block was invented.** It claimed
  `tools.listChanged`, `resources.subscribe`, `resources.listChanged`,
  `prompts.listChanged` and `experimental.streaming`. The server hand-declares
  only `logging`; everything else is *derived* from what was actually registered,
  which is the ADR-0076 D12 contract the README was contradicting. The
  "Streaming Support" feature bullet and the streaming-resource example went with
  it — neither names anything that ships.
- **The stdio transport could not be started by following the page.** Neither
  `OS_MCP_STDIO_ENABLED` nor `OS_MCP_STDIO_API_KEY` was documented, and stdio
  auto-start refuses to boot without the key (ADR-0101, fail-closed). The three
  client config blocks now carry both. The Debugging section also taught
  `OS_MCP_SERVER_ENABLED=true` as the stdio switch, which is the deprecated path
  that logs a warning.
- **A broken relative link.** `../../spec/src/ai/` resolves above the repo root
  from `packages/mcp/`; the target is `../spec/src/ai/`.

Docs only — no runtime code changed, and no API was added. `registerTool` /
`registerResource` / `registerPrompt` remain unbuilt by ruling; a future
imperative API is its own card on measured pull.
