---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(plugin-chatbot): the AI build progress panel names its dataset and permission groups

Clause-②: no
Metadata-protocol: none

During an AI build the progress panel heads each group of staged artifacts with a translated name. Two groups, datasets and permissions, had no name in the language packs, so the panel printed their raw type ids (`dataset`, `permission`) in the middle of an otherwise translated list. They now read 「数据集」/「权限」 in Chinese and `Datasets` / `Permissions` in English, with the matching word in every other shipped locale. An artifact type the panel has no name for is now headed by a neutral `Other` (「其他」) instead of its type id. `@object-ui/i18n` gains the three `chatbot.build.group` keys (`dataset`, `permission`, `other`) in all ten locales.
