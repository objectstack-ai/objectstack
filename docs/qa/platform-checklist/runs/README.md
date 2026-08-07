# Run records

One JSON file per executed checklist sweep, named `YYYY-MM-DD-<slug>.json`,
**append-only**: a record is never edited after landing — a re-run is a new record.
The record shape and the verdict rules are defined in [../RUNNER.md](../RUNNER.md);
verdicts are only meaningful next to the item `revision` they ran against.

Nothing here yet: the first sweep against the standing ledger lands the first record.
