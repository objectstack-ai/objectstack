# Run records

One JSON file per executed checklist sweep, named `YYYY-MM-DD-<slug>.json`,
**append-only**: a record is never edited after landing — a re-run is a new record.
The record shape and the verdict rules are defined in [../RUNNER.md](../RUNNER.md);
verdicts are only meaningful next to the item `revision` they ran against.

Each run record may carry an `evidenceDir` pointing at a committed folder of
screenshots and network traces (see the landed run below).

## Landed runs

- **`2026-08-08-console-login-demo.json`** — first real execution: `platform-core.console-login`
  driven in headless Chromium against an isolated showcase boot. Verdict **pass** (6 clauses +
  wrong-password negative). Screenshots + network traces under `evidence/2026-08-08-console-login/`.
  Notable: the runner's automation self-check (RUNNER rule 2) caught a false "dead shell" P0 — a
  cookie-only clear left the console authed via its localStorage bearer token; a full credential
  clear produced the real redirect-to-login. Also surfaced a run-time precondition (the vendored
  `/_console` dist must be built separately) now noted in the env block.
