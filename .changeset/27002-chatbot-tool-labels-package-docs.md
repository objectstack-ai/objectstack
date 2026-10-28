---
'@object-ui/i18n': patch
---

feat(i18n): `chatbot.tool.read_package_doc` and `chatbot.tool.search_package_docs` labels in all ten packs (#27002)

The spec registry `PLATFORM_TOOLS_BY_PACKAGE['service-ai']` now lists the cloud ask agent's two package-doc tools, so the chatbot's tool timeline can show them. Each pack gets a sentence in its own language ("Read the app guide", "Search the app guides" in English; "阅读应用文档", "在应用文档中查找" in Chinese), keeping the `toolLabels-locale-parity-7481` and `toolLabels-sentences-12724` tests green.

Clause-②: no
Metadata-protocol: none
