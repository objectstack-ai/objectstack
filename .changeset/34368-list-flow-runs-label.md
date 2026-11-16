---
'@object-ui/i18n': patch
---

feat(i18n): the chat step for `list_flow_runs` reads in the user's language

Clause-②: no
Metadata-protocol: none

Every built-in locale pack gains `chatbot.tool.list_flow_runs`, the step label for the build agent's read-only tool that reads a flow's recent runs (en "Check automation runs", zh-Hans 「查看自动化运行记录」; zh-Hant regenerated). Until now the chat fell back to the English title-caser, "List flow runs", in every language. The comment above each pack's `chatbot` block no longer says `test_flow` / `toggle_flow` are ahead of the registry: they are in it.
