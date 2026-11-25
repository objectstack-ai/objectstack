---
'@objectstack/spec': patch
'@object-ui/i18n': patch
---

feat(ai): `get_record_context` joins the cloud `service-ai` group of `PLATFORM_TOOLS_BY_PACKAGE`, with its chat step label

Clause-②: yes (widening) — `PLATFORM_TOOLS_BY_PACKAGE` and `PLATFORM_PROVIDED_TOOL_NAMES` gain `get_record_context`, so `ai-skill-tool-unresolved` stops reporting it on a `mcpPrompt: false` skill; nothing that resolved before is reported
Metadata-protocol: none
Skills-docs: none — `skills/objectstack-ai/SKILL.md` points at the registry file and names no tool

The in-app assistant (cloud `@objectstack/service-ai`) registers `get_record_context` from the same definition the MCP door serves and delegates to the same `record-context` executor (ADR-0160 D4). Its name now sits in that group of the platform tool registry, so `PLATFORM_PROVIDED_TOOL_NAMES` resolves it. The `skill.tools[]` lint rule therefore stops reporting it for a skill kept out of MCP (`mcpPrompt: false`); before, it reported the name as served over MCP only. Nothing an author writes changes.

New locale key: `chatbot.tool.get_record_context` in all eleven packs (en "Read the record context", zh-Hans 读取记录资料), the step name the chat shows while the assistant reads a record's context pack.
