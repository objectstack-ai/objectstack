---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): a reloaded answer draws a redrawn chart once, not once per draw

Clause-②: no
Metadata-protocol: none

When the model redraws a chart in one answer, the live stream replaces the chart in place, so the answer shows one chart. After a reload the chat rebuilds an answer's charts from its stored `visualize_data` results, one per draw, and the replaced chart came back beside the one that replaced it.

The history reader (`chartsFromParts` and the message mapper) now reads the `chartId` a `visualize_data` result carries at the top level of its envelope, beside `chart`. Within one message, results that share a `chartId` give one chart: the last result's chart, at the place in the text where the first one sat. A result without a `chartId` (older history, other producers) is read exactly as before, and results are never merged across messages, because a `chartId` is unique only within one request. A message that carries `data-chart` parts (the live stream) is unchanged.
