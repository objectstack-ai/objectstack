---
'@objectstack/mcp': patch
---

fix(mcp): refuse undeclared argument keys on every MCP tool instead of stripping them

`query_records` answered `{"objectName":"crm_opportunity","sort":"-amount","limit":3}` with `200`
and rows in seed order, and `{"objectName":"crm_opportunity","filters":[["name","contains","Meridian"]]}`
with `200` and the full unfiltered set. Neither key is declared, and zod's strip default — reached
through the MCP SDK's raw-shape wrap — deleted both before the handler ran, so the handler could not
report what it never received. Nothing in either payload distinguished it from a real answer, and the
consumer of these tools is an AI agent: it reads a successful response and reports the wrong answer
confidently. A dropped sort key answers a differently ORDERED set; a dropped filter key answers a
WIDER one.

All eleven tools held that posture; none refused. Each tool's `inputSchema` is now a built strict
object, so an undeclared key is refused before dispatch, the data bridge is never reached, and
`tools/list` advertises `additionalProperties: false` — the closed set is readable off the schema
rather than discoverable only by being refused. The refusal names the offending key and, where the
spelling is recognisable, the declared one to send instead.

Spellings that used to be accepted-and-ignored, and what to send now. Every one of them was already
inert: it was dropped, and the call proceeded exactly as if it had never been sent.

| previously sent and ignored | send instead | on |
| :-- | :-- | :-- |
| `sort`, `sortBy`, `order`, `order_by` | `orderBy` | `query_records` |
| `filters`, `filter`, `conditions`, `criteria` | `where` | `query_records` |
| `select`, `columns`, `projection` | `fields` | `query_records` |
| `pageSize`, `top`, `take` | `limit` | `query_records` |
| `skip`, `start` | `offset` | `query_records` |
| `filters`, `filter`, `conditions` | `where` | `aggregate_records` |
| `metrics`, `aggregates`, `aggs` | `aggregations` | `aggregate_records` |
| `group_by` | `groupBy` | `aggregate_records` |
| `tz`, `timeZone` | `timezone` | `aggregate_records` |
| `object`, `table` | `objectName` | every object-scoped tool |
| `id`, `record_id` | `recordId` | `get_record`, `update_record`, `delete_record`, `run_action` |
| `record`, `values`, `fields` | `data` | `create_record`, `update_record` |
| `action`, `name`, `action_name` | `actionName` | `run_action` |
| `args`, `input`, `arguments`, `parameters` | `params` | `run_action` |
| `formula`, `expr`, `cel` | `expression` | `validate_expression` |

A key outside this table is refused with its name echoed back and a closest-declared-key suggestion
when one is within a length-relative edit distance.
