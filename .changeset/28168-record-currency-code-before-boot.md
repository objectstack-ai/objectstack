---
'@objectstack/cli': patch
---

fix(cli): `os migrate record-currency-codes` refuses a `--code` outside ISO 4217 before it probes the database, prompts or boots

Clause-②: no
Metadata-protocol: none

A code that is not an uppercase ISO 4217 code (`usd`, `EURO`) used to be refused only by the backfill, after the app had booted, and an `--apply` boot creates missing tables and columns before that refusal. The command now judges `--code` first, with the same predicate the backfill uses, and answers with the same `INVALID_FIELD` / 400 envelope (`code` and `httpStatus` under `--json`) and exit 1. Nothing is probed, prompted or booted for a bad code. The backfill in `@objectstack/objectql` keeps its own check unchanged.
