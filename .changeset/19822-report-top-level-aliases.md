---
'@objectstack/spec': patch
---

A top-level report now corrects the same ten misspelled keys a joined-report block already corrects. Before this change, `measures:` on a plain report was rejected with no suggestion, while the same key on a block was told to use `values`.

Clause-②: no

`ReportSchema`'s alias table says it is kept parallel to `JoinedReportBlockSchema`'s, but ten of the block's entries were missing from it. The rejection now names the target key, and every target is a key the report declares:

| authored key on a report | before | now |
| :--- | :--- | :--- |
| `measures`, `metrics` | no suggestion | ``Did you mean `measures` → `values`?`` |
| `dimensions`, `groupBy`, `groupings` | no suggestion | ``Did you mean `dimensions` → `rows`?`` |
| `sort`, `sortBy` | no suggestion | ``Did you mean `sort` → `order`?`` |
| `orderBy` | `order`, found by edit distance | `order`, from the alias table |
| `objectName`, `object` | no suggestion | ``Did you mean `objectName` → `dataset`?`` |

**Every accept/reject verdict is unchanged.** The same reports are refused, with the same `unrecognized_keys` issue. Only the prescription in that issue's message is new. Nothing authorable is added, removed or renamed.
