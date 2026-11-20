---
'@objectstack/driver-sql': patch
---

feat(driver-sql): on Oracle the share-grant subquery converts `record_id` the way the id list binds a `RAW(16)` uuid key (ADR-0155 O2)

Clause-②: yes
Metadata-protocol: none

No visible change on its own: nothing writes a `SharedRecordIds` leaf yet. The sharing plugin starts writing it at ADR-0155's last step, and this makes that step answer the right rows on Oracle tables keyed by a `RAW(16)` uuid (`SYS_GUID()` keys).

- **Oracle, a `RAW(16)` uuid key.** The compiled subquery `id IN (SELECT record_id FROM sys_record_share WHERE …)` now projects `HEXTORAW(REPLACE(record_id, '-', ''))` when the compared column is a `RAW(16)` uuid column, the same catalog reading that makes the id list bind its members as `HEXTORAW(?)`. A grant in upper or lower case, dashed or undashed, names the same row it names in the list. Before, Oracle compared the column as its upper-case hex text: the subquery matched no row and its negation every row, with no error.
- **A grant the id list refuses.** The list refuses a value that is not uuid text before any statement (`INVALID_FILTER` / 400). A stored grant that is not hex (`not-a-uuid`, a braced uuid) fails the subquery's statement with `DATABASE_ERROR` / 500 (ORA-01465); hex of another length names no row.
- **Unchanged.** Any other Oracle key compiles exactly as before; a `NUMBER` key converts each grant as it converts the list's text binds (measured: the same rows, and the same ORA-01722 for a grant that is not a number). Every other dialect compiles exactly as before.
