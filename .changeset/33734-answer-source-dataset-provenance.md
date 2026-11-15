---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(plugin-chatbot): an AI chat answer computed from a dataset shows which dataset and metrics it used

Clause-②: yes (widening) — `@object-ui/plugin-chatbot` exports `detectAnswerSource`, whose return type grows from `ObjectQuerySource` to `AnswerSource` (`ObjectQuerySource | DatasetProvenance`); the exported `AnswerSource` type, which was `ObjectQuerySource`, is now that union; and a chat tool invocation's `answerSource` member widens to the same union. `AnswerSourceBlock`'s `sources` prop (package-internal) takes the union too. Code that reads an object-query member (`object`, `filter`, `scope`) off an `AnswerSource` first checks it has no `kind: 'dataset'`.
Metadata-protocol: none

- **"How this was computed" now covers dataset answers.** When the AI answers a business question through `query_dataset` (ADR-0149 D3), the collapsed block under the answer lists the dataset, each metric by its label with its name beside it and its business definition when it has one, what the figures were grouped by, and the filter the question added. A filter that cannot be shown as rows is shown as sent. When the question added no filter, the block says so, because the dataset's own definition still applies.
- **Object-query answers draw as before.** The object, filter, grouping, aggregations, record count and "Only records visible to you" lines are unchanged, and a turn whose tools answered neither block shows no block.
- **The block survives a reload.** A conversation restored from the browser cache keeps the dataset block.
- New strings `chatbot.answerSource.dataset`, `chatbot.answerSource.metrics` and `chatbot.answerSource.noAddedFilter` ship in every locale pack.
