---
'@object-ui/plugin-report': patch
'@object-ui/plugin-dashboard': patch
---

fix(plugin-report,plugin-dashboard): a report, chart, table or cross-tab drill on a filtered measure lists the records the number counted

Clause-②: no
Metadata-protocol: none

A drill used to list the clicked bucket AND the report or widget filter only. The number also carries the dataset's own `filter` and the measure's own `filter`, so a drill on a filtered measure listed a superset: on the app-showcase Revenue Pulse dashboard, the Paid Invoices cell of the Sent row reads 0 and its drill listed all 4 sent invoices. The drill now also ANDs in the answer's `drillScopes` entry for the measure it stands for (the server's per-measure list filter; `{}` adds nothing, so a drill on an unfiltered measure is unchanged).

- **What a click stands for.** A chart mark stands for its series' measure (a pivoted chart for its one measure), a cross-tab or matrix cell for its column's measure, and a table row for every measure it holds.
- **A table row whose measures select different records drills cell by cell.** When the row's measures all share one scope (one measure, or several plain ones), the row drills as before. Otherwise each measure cell with a scope is its own drill target (test id `dataset-drill-cell`) and the row is not.
- **No list that does not match the number.** A measure with no `drillScopes` entry (a derived measure, or a scope naming a relationship path) offers no drill, and neither does any measure of an answer that carries no `drillScopes`. A comparison (`<measure>__compare`) series opens nothing. A chart none of whose drawn measures has an entry gets no click handler.
- **Unchanged:** a report answer with no `object` (a server older than ADR-0021 D2) still hands the host its group-key fallback drill.
