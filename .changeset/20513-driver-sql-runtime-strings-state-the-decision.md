---
'@objectstack/driver-sql': patch
---

driver-sql refusals, drift reports and log lines no longer cite tracker numbers; each states the reason in words

Clause-②: no

Many messages the SQL driver shows to authors and operators ended with an issue-tracker number where
the reason belonged. The number goes, and where the sentence did not already say what was decided, it
now does:

- Filter refusals (`INVALID_FILTER`): the withheld-detail wording ("withheld from the message; the full
  diagnostic is in the server log"), the JSON-column, zero-operator, `$null` / `$exists`, undefined
  comparand and unknown-combinator refusals, and the filter-array refusal.
- Schema and index messages: the `reference_to` DDL refusal (the FOREIGN KEY DDL that key used to gate
  is retired, because it could never fire for a spec-conformant lookup), the MySQL TEXT-key and
  row-size explanations, the hash-shadow UNIQUE messages, and the `os migrate plan` drift entries.
- The NULL-safe UNIQUE messages now say why rows without an organization were never constrained: SQL
  UNIQUE is NULL-distinct.
- Boot log lines for the SQLite datetime, time and json canonicalisation and the MySQL `TIMESTAMP` /
  `TIME` widening now say what the conversion is for.

Text only: no error code, field name, status or behaviour changes. Three aggregate refusals keep their
citation for now, because a test in `@objectstack/driver-turso` compares them byte for byte with the
Turso remote transport's copies; they change together with those copies.
