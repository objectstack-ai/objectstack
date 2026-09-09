---
'@objectstack/types': patch
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
'@objectstack/cli': patch
---

fix(types,metadata-protocol,metadata,cli): a stored operator record names the dialect again, not the driver's composed refusal

Since the raw-SQL seam began declaring its own fault, `SqlDriver.execute()` no longer
lets the dialect's error out: it raises `code: DATABASE_ERROR` / `status: 500` with a
COMPOSED message that discloses neither the statement nor the diagnostic, and carries
the dialect error whole under a non-enumerable `cause`. That envelope is deliberate and
is unchanged here.

What changed underneath it is what every consumer STORED. Each migration probe, backfill
and rename in `@objectstack/metadata-protocol` / `@objectstack/metadata` embedded
`error.message` into an operator-facing record, so those records began reading

    the database refused to run a raw statement

where they used to read

    no such column: foo

For a live console that costs nothing — the driver prints the statement and the dialect
text to its warn sink one line earlier. For a record read later it costs everything:
whoever opens a customer install's backfill result a week on never had that line, and the
dialect's words were unrecoverable for them.

`@objectstack/types` now exports `operatorFacingErrorText(error)` — a depth-bounded walk
of the `cause` chain, shaped like the `matchesDriverError` beside it — and the eleven
stored-record sites plus `os db clean`'s console line read through it:

- `runtime-index-preflight` — the per-probe `detail` and the seam-failure fan-out;
- `seed-tenancy-backfill` — the `absent` detail, the organization-probe report and the
  three per-object warnings;
- `partial-index-probe` — the `detail` both callers report (and its two module comments,
  which stated the opposite of what happened);
- `migrate-env-id-to-project-id`, `migrate-project-id-to-environment-id`,
  `migrate-sys-notification-to-event`, `drop-projection-tables` — the per-table `error`;
- `os db clean` — the `VACUUM failed` line.

Two narrowings are part of the contract, not incidental: an UNDECLARED throw is returned
byte-for-byte on its own message channel, and a declared envelope that is not the raw-path
one — the typed read exits' terminal, which composes a different sentence — is left exactly
as it arrived.
