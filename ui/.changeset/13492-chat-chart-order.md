---
"@object-ui/plugin-chatbot": patch
---

Clause-②: no
Metadata-protocol: none

An assistant answer now renders its text and its charts in the order the stream produced them. A chart the model drew before writing its analysis shows first, instead of below every paragraph of it, so an open-ended analysis in the assistant panel puts its chart on the first screen. `mapMessages` records where each `data-chart` part arrived among the text parts as the chart's new optional `textOffset`, and `<ChatbotEnhanced>` splits the answer at those points. A message without offsets (one a host builds itself, or the legacy string-content shape) keeps the old layout: all the text, then the charts. `content` and `charts` keep their shape; long-answer folding and record links work in every text run.
