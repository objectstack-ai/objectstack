---
"@objectstack/service-ai": minor
---

feat(service-ai): steer the agent to `visualize_data` for chart requests

Small models sometimes answered a "draw a bar chart" request with a markdown
TABLE instead of calling `visualize_data` — a tool-selection problem where the
chart preference was buried as a low-priority guideline competing with
"format with markdown tables".

- `data-explorer-skill.ts` — adds a prominent "Choosing the right tool" section
  above the guidelines: chart intent (incl. CN terms 图表/柱状图/折线图/饼图/画图)
  MUST call `visualize_data`, never substitute a table; reconciles the
  table-formatting guideline and fixes duplicate guideline numbering.
- `visualize-data.tool.ts` — strengthens the tool description to be imperative
  ("the ONLY tool that draws a chart… if you already fetched the numbers, still
  call `visualize_data` to render them").

Prompt-only tuning — no behavior/contract change.
