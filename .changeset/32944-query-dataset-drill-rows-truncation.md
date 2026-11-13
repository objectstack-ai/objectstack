---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a truncated `query_dataset` answer carries drill sidecars for the served rows only

Clause-②: no
Metadata-protocol: none

`query_dataset` asks the dataset query for one row past its cap so `truncated` is a fact, and serves `cap` rows. The two answer members aligned to `rows` by index, `drillRawRows` and `drillRanges`, were served untrimmed, so each held one more entry than `rows` (a `limit: 1` answer carried two `drillRawRows` entries). They are now served to the same length as `rows`, entry i beside row i, on the MCP tool and on the chat tool alike. Members that are not row-indexed (`totals`, `drillRawTotals`, `dimensionFields`, `drillScopes`, `fields`, `object`) are served as before, and an answer within the cap is unchanged.
