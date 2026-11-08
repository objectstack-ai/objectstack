---
'@objectstack/driver-sql': patch
---

fix(driver-sql): an Oracle `RAW(16)` uuid column (a `SYS_GUID()` key, or a lookup over one) is now filtered and written by the uuid text it reads back as

Clause-②: yes (widening)
Metadata-protocol: none

The driver already read a `RAW(16)` column as a lowercase hyphenated uuid, but it bound that same text back as a string, which Oracle refuses against `RAW`. So a lookup keyed by a `SYS_GUID()` column displayed correctly and could not be filtered, written, updated or deleted by its value.

The driver now reads, once per federated object, which of its remote columns are `RAW(16)` (`ALL_TAB_COLUMNS`), and binds a comparand, a written value or a by-id key for those columns as `HEXTORAW(?)` over the uuid's 32 hex digits. The column type decides, never the value: a `VARCHAR2` column holding uuids is bound as text, as before. Uuid text is accepted dashed (the read form) or as the 32 digits undashed, in either case. Anything else is refused before the statement is sent: a filter comparand with `INVALID_FILTER` / 400, a written value with `VALIDATION_ERROR` / 400. A failed catalog read changes nothing: values are bound as before and the next read asks again. Other dialects are unchanged.
