---
'@object-ui/i18n': patch
---

feat(i18n): `chatbot.tool.delete_package` label in every pack

Clause-②: no
Metadata-protocol: none

The spec registry now lists the cloud build agent's `delete_package` tool (cloud#3656), so the chatbot's tool timeline gets a sentence for that step in every pack ("Delete a package" / 「删除一个应用包」; the zh-Hant pack regenerated from zh-Hans as 「刪除一個應用包」), matching the sibling `delete_field` and `create_package` labels and keeping `toolLabels-locale-parity-7481` and `toolLabels-sentences-12724` green.
