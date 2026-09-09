---
'@objectstack/types': minor
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
'@objectstack/cli': patch
'@objectstack/driver-sql': patch
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
of the `cause` chain, shaped like the `matchesDriverError` beside it — and the thirteen
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
on its own message channel, its `cause` never walked, and a declared envelope that is not
the raw-path one — the typed read exits' terminal, which composes a different sentence —
is left exactly as it arrived.

That message channel is deliberately NOT byte-identical to what the replaced expressions
computed. Two shapes read differently, and both read better: a thrown non-`Error` now
yields prose where `(e as Error).message` yielded `undefined`, and an error whose message
is EMPTY reads `Error` / `TypeError` — the `|| String(error)` last resort — where those
expressions yielded `''`, or `unknown error` at the one site that ors in a default.

## The levels, and why they are not uniform

`@objectstack/types` takes **`minor`**: it is the one package here that grows a published
surface — `operatorFacingErrorText` is a new export, present in `dist/index.d.ts` and in the
export list. A purely additive widening takes at least `minor`.

The other four take **`patch`**, because none of them widens anything: they are a bug fix in a
released package, which is exactly what `patch` is for. `@objectstack/driver-sql` is named
because this change moves its `src/**` — by one ADDED file, the `.test.ts` that pins the helper
against a real `SqlDriver.execute()` refusal. Its published `dist/` is byte-unchanged by this
PR: no entry point reaches a test file, and `files` packs `dist` only.

**Not breaking, and deliberately not marked so.** Nothing is removed, renamed or made stricter.
The only value that changes is the TEXT inside an operator-facing `detail` / `error` field, and
only where the thrown error declares `DATABASE_ERROR` *and* its message is the raw path's
composed sentence — the case where that text was the wrong text. Every other throw reaches
these records on its own message channel — as before, save for the two shapes named above,
where the text gets better rather than different in kind. The field names and types are
unchanged, and the sentence being replaced is not a value any consumer can have been
parsing: it is an opaque human diagnostic. A consumer reading these records gets the
dialect's words back where it had been getting a placeholder.
