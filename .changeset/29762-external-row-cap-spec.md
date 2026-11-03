---
'@objectstack/spec': minor
---

feat(spec): a plugin-driver datasource can declare its row cap, `external.rowCap`, up to a platform maximum of 10,000 (#29762)

Clause-②: yes (widening) — one optional, bounded key joins the external datasource settings; the default keeps today's 1,000
Metadata-protocol: added

`ExternalDatasourceSettingsSchema` declares one optional key, `rowCap`: a whole number from 1 to `EXTERNAL_ROW_CAP_CEILING` (10,000). It is the most rows the engine reads from a plugin driver for one request, and so the most rows one read on such a datasource may match before it is refused with `EXTERNAL_ROW_CAP_EXCEEDED` (422). Absent, the cap is `EXTERNAL_ROW_CAP_DEFAULT` (1,000), today's fixed value, so no existing datasource changes. Both constants are exported from `@objectstack/spec/data`.

- **Refused where it would do nothing.** On a built-in driver (which runs the whole query itself and is never capped) the key is refused at `external.rowCap`, naming the driver. On a managed datasource it is refused by the existing managed-block refusal, which names it among the keys to remove. A value above the ceiling, zero, a negative or a fraction is refused at parse. `maxRows` and `rowLimit` are folded onto `rowCap` in the refusal's suggestion.
- **Not acted on yet.** This is the contract half. The engine's floor over a plugin driver reads the key in a following change; until then a datasource that sets it still reads at 1,000 rows. The liveness ledger grades it `planned` until that reader lands.
