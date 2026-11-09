---
'@objectstack/objectql': patch
---

fix(objectql): the record-currency backfill cleans a driver's raw text out of a failed row, as the import door does

Clause-②: no
Metadata-protocol: none

A failed row in the record-currency backfill report (`failures[].error`) now reads the import row's cleaned sentence (`sanitizeRowError` from `@objectstack/core`, the one rule both doors call) when the row's write threw anything other than a sandboxed hook's error. A driver's SQL statement, constraint name or column list no longer reaches the report, which a tenant admin reads over `POST /api/v1/meta/_migrate-record-currency-codes` and the operator reads in `os migrate record-currency-codes`. A message with no driver text reads as before. The operator's warning line keeps the whole text, so nothing is lost for diagnosis.
