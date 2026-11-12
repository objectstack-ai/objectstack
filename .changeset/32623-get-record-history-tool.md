---
'@objectstack/spec': patch
'@object-ui/i18n': patch
---

feat(spec, i18n): register the `ask` agent tool `get_record_history` in `PLATFORM_TOOLS_BY_PACKAGE['service-ai-studio']` and give it a `chatbot.tool.get_record_history` label in every locale pack

Clause-②: yes
Metadata-protocol: none

The cloud AI runtime now registers a read-only `get_record_history` tool (cloud#4347): it reads the change history of one record the user may see, so a chat can offer to undo the last edit; the restore itself still goes through the existing confirm card. `PLATFORM_PROVIDED_TOOL_NAMES` and `isPlatformProvidedToolName('get_record_history')` now answer `true`, so a skill that lists the tool in `tools[]` no longer draws the advisory unknown-tool finding. The chat panel's step list shows the tool as "Read the record history" (and its translation in each of the eleven built-in packs) instead of the title-cased tool id. Nothing existing changes.
