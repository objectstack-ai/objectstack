---
'@objectstack/objectql': patch
'@objectstack/cli': patch
'@objectstack/metadata-protocol': patch
---

feat(objectql,cli,metadata-protocol): backfill the currency code of rows stored before an amount field was switched to `currencyMode: 'record'`, and acknowledge the switch at the metadata save

Clause-②: yes (widening) — a new `@objectstack/objectql` export (`backfillRecordCurrencyCodes` and its report helpers), a new command `os migrate record-currency-codes`, and a new finding `currency_mode_to_record` registered in the existing 409 `destructive_change` face, lifted by its existing `force`
Metadata-protocol: none

An existing `dynamic` or `fixed` amount switched to `record` names a code field, and the rows already stored hold an amount beside a blank code. Such a row is not refused for resting, but until it holds a code it displays as a plain number, falls into the `null` group of a grouped aggregate, and sits outside every currency-paired filter.

- **The backfill.** `os migrate record-currency-codes --object <object> --field <amount> --code <ISO 4217>` writes the code you give into every row whose amount is not blank and whose code is blank. ⛔ The code is never derived: not from a former `defaultCurrency`, not from the organization's `localization.currency`. A row that holds a code is never touched; a row with a blank amount is left alone. Dry run by default; `--apply` writes (with `--yes` when not interactive). The report counts the rows written, the rows skipped because they hold a code, and the rows skipped because their amount is blank. Running it again finds nothing, so a clean second report is the verification. A code that is not an ISO 4217 code, or a field that is not a `record`-mode currency field, is refused before any row is read (`INVALID_FIELD`, 400). Each row is written through the engine's update, so the write is judged and audited like any other. No `sys_migration` flag is recorded.
- **The engine function.** `backfillRecordCurrencyCodes(engine, logger, { object, field, code, apply })` from `@objectstack/objectql`, with `formatRecordCurrencyBackfillReport` and `recordCurrencyBackfillComplete`; `isRecordCurrencyBlank` is the one blank predicate the write guard and the backfill share.
- **The save.** Saving an object (REST `PUT /meta`, Studio, a package publish) whose stored amount field moves to `currencyMode: 'record'` from any other mode now answers the existing 409 `DESTRUCTIVE_CHANGE` with the finding `currency_mode_to_record`, whose message names the three consequences and the command. Re-submit with `force` to save. It reads no row, and fires only where a previous version exists: a code-declared package registered at boot is not refused.
