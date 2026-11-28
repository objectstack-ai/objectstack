---
'@objectstack/spec': patch
---

fix(spec): the `knowledge_source` tombstones say what the author of a registration in code does

Clause-②: no
Metadata-protocol: none

Text only. No schema shape changes, and nothing that parsed is refused.

- **The prescriptions.** Each prescription of a renamed or removed `knowledge_source` key that ends with `os migrate meta --from 18` (`id`, `source.contentFields`, `embedding`, `vectorStore`, `adapterConfig`, `refresh.cron`, and the `'*'` member of `source.content`) now first says what to do with a source registered in code (`KnowledgeServicePlugin({ sources })`, `registerSource`): it is in no stack collection, so the command lists no edit for it, and the edit is made in the registration itself. Every source written for 18 is such a registration, because a stack could not hold `knowledgeSources` before 19.
- **The upgrade entry.** `knowledge-source-registration-governed`, which `os migrate meta --from 18` prints, now covers a source whose 18 `id` began with an underscore. A `name` starts with a letter, so that source is renamed, and an adapter keys what it holds by the source's name: the source is built again under the new name, and the adapter keeps the index it built under the old id. Nothing drops that index for you. Call `dropSource({ source })` on the adapter (`IKnowledgeService.getAdapter`) with the old id as the source's `name`; an adapter without `dropSource` keeps it until it is removed in the adapter's own store.
