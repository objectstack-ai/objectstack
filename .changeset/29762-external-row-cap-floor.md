---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

feat(objectql): the engine's floor over a plugin driver reads the datasource's `external.rowCap`, so a whole-set view over a virtual object can match up to 10,000 rows (#29762)

Clause-②: yes (widening) — the engine floor honours the per-datasource cap from PR 1 (#29762 spec slice)
Metadata-protocol: none

A plugin-driver datasource (a non-managed datasource whose `driver` is not built in, OData included) reads at most `external.rowCap` rows from its driver for one request: the driver is sent `limit` of that cap plus one, and a read that matches more is refused with `EXTERNAL_ROW_CAP_EXCEEDED` (422). Without the key the cap stays 1,000, so no existing datasource changes.

- **Read on every request.** The floor asks the engine for the datasource's current definition on each read, so a datasource whose `external.rowCap` is edited takes the new cap on its next read. A definition that reached the engine without the spec's parse is held at `EXTERNAL_ROW_CAP_CEILING` (10,000) above it, and read as the default when it is not a whole number from 1; either way the server log says so once per value written, naming the datasource, the value and the cap in force.
- **The refusal names the cap.** `ExternalRowCapExceededError` carries the datasource's cap in its message and `details.cap`. Below the ceiling, its message adds that an administrator may raise `external.rowCap`.
- **Contract.** `EngineDatasourceDef.external` (`@objectstack/spec/contracts`) and objectql's `DatasourceDef.external` declare the optional `rowCap` the engine now reads. `EXTERNAL_ROW_CAP` (`@objectstack/objectql`) is now read from `EXTERNAL_ROW_CAP_DEFAULT` in `@objectstack/spec/data`, with the same value.
- **Docs.** The virtual-objects guide has a section on the row cap (what a higher cap costs the remote) and one on views that read the whole set (gantt, tree, calendar, map): the server's row cap and the views' own 2,000-row ceiling, and what a planner does past each. The OData page says the cap is the datasource's.

To raise the cap on a plugin-driver datasource, set `external: { rowCap: 5000 }` (at most 10,000). Each list page reads every match up to the cap from the remote twice, for the rows and for the total, so raise it only as far as the widest read needs.
