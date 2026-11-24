---
'@objectstack/service-knowledge': patch
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
'@objectstack/lint': patch
---

feat(mcp,service-knowledge): the MCP door serves `search_knowledge`, and a skill MCP withholds is no longer withheld in silence

Clause-②: yes
Metadata-protocol: none

**`search_knowledge` over MCP.** An app that mounts the knowledge service (`KnowledgeServicePlugin`) now has its knowledge sources searchable from any MCP client: `tools/list` lists `search_knowledge` wherever the kernel holds a `knowledge` service and the connection's grant reaches the read family (`data:read`, or an API key or session, which carry no OAuth grant). Before, no MCP connection served a knowledge tool, so a BYO-AI client could not reach an app's knowledge base at all, and every skill whose `tools` named `search_knowledge` was dropped from `prompts/list`.

- **One definition, one executor (ADR-0149 D2).** `@objectstack/service-knowledge` exports the tool's `AIToolDefinition` (`getKnowledgeToolDefinitions`) and its executor (`createKnowledgeTools`, also `KnowledgeService.knowledgeTools()`). The MCP door registers the definition as the service hands it over, on HTTP and on stdio, and holds no copy of its description or argument schema. Arguments: `query` (required), `sourceIds`, `topK` (1 to 20, default 5); any other key is refused before the search runs.
- **As the caller.** Each call runs with the caller's execution context, and the knowledge service re-checks every passage indexed from a record against the caller's row-level security; on an OAuth connection that is the delegating person's own reach.
- **Only `aiExposed` sources.** The tool searches only the sources whose `aiExposed` is not `false`, and refuses a `sourceIds` entry naming any other source with `NOT_FOUND` and the sentence an unknown id gets, so an agent never learns a withheld source exists. `IKnowledgeService.search` itself is unchanged: it still searches a source its caller names explicitly, because it also serves platform callers that are not agents.
- `MCP_DOOR_TOOL_NAMES` (`@objectstack/spec/system`) lists `search_knowledge`, so `os lint` resolves it for a skill offered over MCP, as it already did through the platform registry.

**A withheld skill is said, twice.**

- **Authoring time.** The `ai-skill-tool-unresolved` rule gains a verdict for a skill MCP would offer as a prompt (`instructions`, not `mcpPrompt: false`, not `active: false`) whose `tools` names one of the `ask` product's data tools no MCP connection serves (`aggregate_data`, `query_data`, `visualize_data`): the name resolves, but MCP withholds the skill from every `prompts/list`, and the warning names the tool. Fix: bind tools both doors serve, or set `mcpPrompt: false` on a skill written for the in-product agents.
- **Runtime.** On the HTTP door, each `prompts/list` that withholds a skill logs one `debug` line naming the skill and each bound tool the connection does not serve.
