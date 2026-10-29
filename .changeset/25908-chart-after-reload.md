---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): an assistant answer's chart is still there after a reload

Clause-②: yes (widening)
Metadata-protocol: none

The live stream draws a chart from a transient `data-chart` part that the server never stores, so a reloaded answer used to come back as text only. The `visualize_data` tool result is stored, and its `chart` key holds the same descriptor the part carried. The chat now reads it back:

- **Server history.** A stored message with no `data-chart` part takes its charts from its `visualize_data` results, each placed where its tool part sat among the text. The chart has the same title, series labels and rows as the live one. The result's top-level `rows`, a preview cut for the model's narration, are never drawn. A result stored before the producer wrote `chart` gets no chart, and nothing is rebuilt from its other keys.
- **API mode.** `useObjectChat` rebuilds a hydrated message's `charts` into the store as `data-chart` parts between the text runs they sat between, so the chart keeps its place after the round trip. A live message that carries both the part and the result still draws the chart once.
- **New exports** on the package root and `@object-ui/plugin-chatbot/core`: `chartsFromParts(parts)` returns a stored message's charts with their `textOffset`, and `chartAnswerParts(content, charts)` is its inverse (text runs with `data-chart` parts between them), plus the `ChartAnswerPart` type. The console uses both to restore charts from server history and from its message cache.
