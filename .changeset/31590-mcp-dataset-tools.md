---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(mcp): serve `list_datasets` and `query_dataset` over MCP under `data:read`

Clause-②: yes (widening)
Metadata-protocol: none

An MCP client can now answer business questions through the governed dataset layer (ADR-0149 D2). `McpDataBridge` gains three optional members, `listDatasets`, `queryDataset` and `datasetToolDefinitions`, and `wireBridgeTools` registers the two tools only when a bridge carries all three and the caller's grant admits `data:read` (an API key or a session keeps them, as every read tool). Both bridges carry the members where the `analytics` service serves its dataset executor (`datasetTools`) and none of them otherwise, so a deployment without the analytics service lists exactly the tools it listed before.

The tools run the service-analytics executor as the caller, with no gate added or skipped: each tool's description is the executor's own definition, its input is the spec declaration (`ListDatasetsInputSchema` / `QueryDatasetInputSchema`), `query_dataset` is held to the same page cap as `query_records`, and a refusal answers in the coded envelope the other data tools use. The generated `SKILL.md` names both tools where they register and teaches the selection rule: an exact word match on a member's name, label or synonym is the only hit, one hit answers through `query_dataset`, several hits are a question for the user, and no hit falls back to the object tools with the answer marked as not a governed metric.
