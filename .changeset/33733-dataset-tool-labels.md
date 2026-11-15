---
'@objectstack/spec': minor
'@object-ui/i18n': patch
---

feat(spec, i18n): the platform tool registry lists the ask agent's dataset pair, `list_datasets` and `query_dataset`, and every locale pack names their chat steps

Clause-②: yes (widening) — `PLATFORM_TOOLS_BY_PACKAGE['service-ai']` (and so `PLATFORM_PROVIDED_TOOL_NAMES`) gains `list_datasets` and `query_dataset`, two more names a `skill.tools[]` entry resolves to; the `@object-ui/i18n` packs gain `chatbot.tool.list_datasets` and `chatbot.tool.query_dataset` in all eleven shipped locales. Nothing is removed or narrowed.
Metadata-protocol: added
Skills-docs: none — `skills/objectstack-ai/SKILL.md` teaches the registry by name (`PLATFORM_PROVIDED_TOOL_NAMES`) and lists no `service-ai` member it would now miss.

Cloud's `service-ai` registers the dataset pair for the in-product ask agent (cloud#4551): `list_datasets` reads the installed datasets and the metrics each defines, and `query_dataset` answers a question through one governed metric. The names and shapes are the ones ADR-0149 D2 declares in `@objectstack/spec` (`LIST_DATASETS_TOOL_NAME`, `QUERY_DATASET_TOOL_NAME`).

- **Skill references resolve.** A skill naming either tool was reported by `ai-skill-tool-unresolved` as a tool nothing registers; both now resolve as platform tools.
- **The chat names the step.** While the agent ran either tool, the step list showed the English title-caser's output of the tool id on every console language. Each pack now carries a sentence for both, for example 「查看指标」 and 「按指标查询」 in Simplified Chinese.
