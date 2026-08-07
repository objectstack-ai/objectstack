---
"@objectstack/cli": patch
---

fix(cli): `os migrate --json` no longer exits with its own runtime as the status code (#4873)

A **successful** `os migrate recorded-by --json` returned a different non-zero
exit code on every invocation — 208, 171, 176, 163, 62, 19, 48, 57 — while
printing correct JSON, printing `✅ Graceful shutdown complete`, and leaving
stderr completely empty. `os migrate resume --json` had it too. Nothing that an
author reads was wrong; the only thing that was wrong is the only thing a CI
step, a `set -e` script, a Makefile, or a container entrypoint reads. `--json`
exists for programs, and the first thing a program consumes is the exit status.

**Root cause.** `emitJson(payload, exitCode, opts)` takes its exit code as the
second positional argument, and both commands were passing `timer.elapsed()`
there — a duration in milliseconds. So a run that took 531 ms set
`process.exitCode = 531`, and the shell saw `531 & 0xFF` = 19. The codes looked
random because they *were* the run's duration, and no two runs take the same
number of milliseconds.

It was not what it looked like from the outside: no native `abort` during
teardown, no libsql/sqlite handle, no `safeExit`, and not a leftover of #4813
(whose 120-second hang is fixed and unrelated — the random codes predate and
survive it).

**What changed.**

- Both commands now report their duration where every other `--json` command in
  this CLI already reports it — inside the payload, as `duration`. A successful
  run exits `0`; a failing one still exits `1`, unchanged.
- `emitJson` / `emitText` narrow that parameter from `number` to
  `CliExitCode = 0 | 1`, so handing a duration (or any other stray number) to
  the exit-code slot is now a compile error instead of a silent false failure.

**Payload change.** `os migrate recorded-by --json` and `os migrate resume
--json` gained a `duration` key (milliseconds). Consumers that were reading the
exit status of these two commands should note that a zero now means what it
says.
