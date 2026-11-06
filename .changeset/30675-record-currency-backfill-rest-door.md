---
'@objectstack/rest': patch
'@objectstack/client': patch
'@objectstack/objectql': patch
'@objectstack/cli': patch
'@objectstack/metadata-protocol': patch
---

feat(rest, client): a tenant-admin REST door for the record-currency code backfill

Clause-②: yes (widening)
Metadata-protocol: none

An organization admin with no shell on the deployment can now run the record-currency code backfill (`os migrate record-currency-codes`) over HTTP: `POST /api/v1/meta/_migrate-record-currency-codes` with `{ object, field, code, apply? }`, or `client.meta.migrateRecordCurrencyCodes(...)` from the SDK.

- It fills the codeless rows of **the caller's current organization only**. There is no environment-wide form, and the body takes no organization: `organizationId`, `allOrganizations` or any other key outside the four is refused with `VALIDATION_ERROR` / 400. A request with no current organization is refused `403 FORBIDDEN`.
- It requires `setup.write` in that organization (`403 FORBIDDEN` otherwise), and it is mounted behind `metadata.endpoints.maintenance` with the other maintenance routes.
- Preview unless `apply` is `true`. The answer is the report the CLI prints under `--json`, and the code, field and object refusals are the CLI's.
- The SDK method answers `unknown`: the report's named type lives in `@objectstack/objectql`.
- The 409 `destructive_change` finding `currency_mode_to_record` now names this route beside the CLI command.
- `@objectstack/objectql` now exports `RecordCurrencyBackfillOrganization` and `RecordCurrencyBackfillOrganizationsRefusal` from its entry.
- A backfill walk stopped by `--max-records` no longer prints "nothing to backfill" for rows it did not examine. It says the walk is incomplete, and an unscoped run says its organization check saw only the rows examined.
