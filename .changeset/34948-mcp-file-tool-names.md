---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

fix(lint): a skill bound to `read_file` or `create_upload_link` no longer gets `ai-skill-tool-unresolved`, because the MCP door serves both

Clause-②: yes (widening) — `ai-skill-tool-unresolved` stops warning on two tool names the MCP door registers, and `@objectstack/spec/system` gains the export `MCP_FILE_TOOL_NAMES`; nothing that resolved before is reported
Metadata-protocol: none

`@objectstack/mcp` registers two file tools: `read_file` reads a file a record carries, and `create_upload_link` mints a single-use link to upload a file onto a record. A skill bound to either is offered over MCP. But `os lint --strict` reported both names as tools that resolve to nothing. No cloud AI package registers them, so they were missing from `PLATFORM_PROVIDED_TOOL_NAMES`, the only platform list the rule read. A skill that handles receipts or attachments could not bind the tools it uses without failing `--strict`.

For a skill offered over MCP, the rule now also resolves names from a new `@objectstack/spec/system` export, `MCP_FILE_TOOL_NAMES`, which holds exactly the file tools the MCP door registers. A skill kept out of MCP (`mcpPrompt: false`) runs only in the in-product agents, which do not have these tools, so naming either there is still reported. `@objectstack/mcp` has a test that keeps this list equal to what the door registers. The names do not join `PLATFORM_TOOLS_BY_PACKAGE`: each group there stays the exact set one cloud package registers. Everything that reads `PLATFORM_PROVIDED_TOOL_NAMES` answers as before, including the MCP bridge's tool annotations. `os explain ai-skill-tool-unresolved` now lists the new source and this limit.

Nothing to migrate. To bind them, add `read_file` or `create_upload_link` to the skill's `tools`.
