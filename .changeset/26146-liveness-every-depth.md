---
'@objectstack/lint': patch
---

fix(lint): the liveness author warnings and their status census read ledger rows at every depth of `children`

Clause-②: no
Metadata-protocol: none

The liveness rule built its warn map, and its census of the status words the ledgers use, from the top-level rows and one level of `children`. The ledgers have rows two and three levels down, and those were never read. On the tree this was measured on, 41 rows two levels down and 2 rows three levels down carry a status.

- **Warnings.** A row at any depth now warns under the same rules as a shallower one. Its verdict warns on its own (`dead`, `live-elsewhere`, `experimental`), or the row opts in with `authorWarn`. The only rows this reaches today are the dashboard's `widgets[].chartConfig.type`, `.xAxis`, `.yAxis`, `.series` and `.aria`, all `dead`. Each of them is already a retired key that the schema refuses, so `os lint` handed an unparsed stack now also reports `liveness-dead-property` for them. No row at depth 2 or deeper carries `authorWarn`, so no other warning appears.
- **Status census.** A status word used only at depth 2 or deeper now reaches the vocabulary check that makes sure every status has an author-facing branch.
