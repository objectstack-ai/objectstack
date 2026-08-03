---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a seed failure that is COUNTED as an error now logs at `error` (#4729)

`SeedLoaderService`'s pass-2 deferred back-fill carried a comment stating that a
failed back-fill "must be a reported, counted error, **never** a silent warning"
— and the line under it called `logger.warn`. The count was right (the failure
lands in `result.errors`, flips `success: false`) but the level contradicted it,
and that log line is the only trace a seed leaves in a host's console. `warn` is
the level #4420 proved nobody reads.

**What changed**

- The failed back-fill logs at **`error`**, and the line now owes what
  AGENTS.md → "Degradation log levels" requires of one: the **consequence**
  (`<object>.<field>` stays NULL on a named record, the row itself was seeded so
  every row counter reads clean, the circular relationship is half-written) and
  the **fix** (nothing retries it — repair the write error, which is either a
  transient failure that outlasted the retry budget or a validation rule vetoing
  the update, then re-run the seed).
- The rest of the file was audited against the same criterion — *is this failure
  counted in the load's `errors` (i.e. does it make `success: false`)?* Five more
  sites answered yes while logging `warn`, and were raised to `error`: a failed
  batch insert row, a record dropped because its `cel` expression could not
  resolve, the two invalid-reference paths that DROP a reference field (the row
  lands without its association and the row counters stay clean — framework#3932),
  and the two write-failure catches on the sequential/update paths. The two
  dropped-reference lines also gained the consequence and fix in the message.
- Deliberately left at `warn`, and now documented as audited: "Halting on first
  error" (a control-flow notice about failures already reported at `error`), the
  `NODE_ENV` scope warning (a functional, fail-open degradation), and the
  roll-up-summary recompute (records *were* written; whether a stale summary
  column is the same class is #4998).
- The seam is now pinned by CI, not only by tests: the back-fill write was
  extracted as `writeDeferredReference` and added — with `writeRecord` — to
  `DURABILITY_CRITICAL_CALLEES` in `scripts/check-durability-degradation-log-level.mjs`,
  so `pnpm check:durability-log-level` fails if either catch is ever quietened
  again.

No API, schema or result-object change: the same errors are reported in
`SeedLoaderResult` exactly as before. What changed is the level and the wording
of what a seeding host sees in its log.
