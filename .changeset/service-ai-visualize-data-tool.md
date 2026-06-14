---
"@objectstack/service-ai": minor
---

feat(service-ai): `visualize_data` tool — return charts from AI data queries

Adds a `visualize_data` AI tool so the data-query assistant can answer with a
CHART instead of plain text/markdown. The tool runs an aggregation through the
existing analytics service (auto-inferred cube), maps the result into the SDUI
`<chart>` contract, and emits it to the client as a `data-chart` custom stream
part (the same `onProgress` channel `data-build-progress` already uses). It also
returns a compact textual summary so the model narrates the answer alongside the
rendered chart.

- `tools/visualize-data.tool.ts` — tool definition, handler, and register fn
  (function+field → analytics measure key; single dimension → x-axis; measures →
  series; `chartType` bar/line/pie/…).
- `plugin.ts` — registers the tool when an analytics service is present and
  persists it as tool metadata in lockstep (Studio visibility).
- `skills/data-explorer-skill.ts` — exposes `visualize_data` plus chart trigger
  phrases and guidance to prefer it for "chart/plot/trend/breakdown" requests.
