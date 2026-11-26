---
'@objectstack/driver-sql': patch
---

feat(driver-sql): on Oracle the share-grant subquery converts `record_id` the way the id list binds a `RAW(16)` uuid key (ADR-0155 O2)

Clause-②: yes
Metadata-protocol: none

No visible change on its own: nothing writes a `SharedRecordIds` leaf yet. The sharing plugin starts writing it at ADR-0155's last step, and this makes that step answer the right rows on Oracle tables keyed by a `RAW(16)` uuid (`SYS_GUID()` keys).

- **Oracle, a `RAW(16)` uuid key.** The compiled subquery `id IN (SELECT record_id FROM sys_record_share WHERE …)` now projects the id list's own conversion when the compared column is a `RAW(16)` uuid column, the same catalog reading that makes the list bind its members as `HEXTORAW(?)`: `HEXTORAW(CASE WHEN REGEXP_LIKE(record_id, UUID_PATTERN, 'i') THEN REPLACE(record_id, '-', '') ELSE 'not-a-uuid' END)`. A grant in upper, lower or mixed case, dashed (8-4-4-4-12) or as 32 undashed digits, names the same row it names in the list. `UUID_PATTERN` is the list's own uuid-text check, written for Oracle from the same constant. Before, Oracle compared the column as its upper-case hex text: the subquery matched no row and its negation every row, with no error.
- **A grant the id list refuses fails the statement.** The list refuses a value that is not uuid text before any statement (`INVALID_FILTER` / 400). Every such stored grant fails the subquery's statement instead, with `DATABASE_ERROR` / 500 (ORA-01465), on the read and on its negation: hex of another length (31 or 33 digits, `0123`), 32 digits with dashes out of place, a grant of dashes only, a blank or a padded uuid, a braced uuid, or text that is not hex. None of them answers a row, and none empties a negation.
- **Unchanged.** Any other Oracle key compiles exactly as before; a `NUMBER` key converts each grant as it converts the list's text binds (measured: the same rows, and the same ORA-01722 for a grant that is not a number). Every other dialect compiles exactly as before.
