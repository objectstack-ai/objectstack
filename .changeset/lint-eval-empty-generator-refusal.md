---
"@objectstack/cli": minor
---

**BREAKING** `os lint --eval --generator ""` now refuses instead of quietly running the offline eval, matching the rule the same flag already follows without `--eval`.

Eval mode guarded the generator load with a truthiness test, so an empty string fell straight through it: the module was never loaded, no warning was printed, and the `Failed to load generator` message that exists for exactly this failure was never reached. What came out was the ordinary offline report — `Mode: offline`, `5/5 passed · mean 99/100`, exit 0 — to someone who had asked for a live run and read that score as their generator's.

It was not merely ineffective. Driven against the same command with the flag absent entirely, and with the elapsed-time token normalised, the two runs produced byte-identical stdout, empty stderr and the same exit code on every face the command has, `--json` included. There was no channel on which the difference was visible. The usual way to type it is `--generator "$GEN"` in a script where `GEN` is unset.

The guard now tests whether the flag was provided rather than whether its value is truthy — the same test `os lint --generator` outside `--eval` has used since it started refusing — so one flag has one rule for "the operator typed it". No new failure shape is introduced: an empty string is a path that names no module, so it answers through the load path an unresolvable path already answered through, with the reason on `error`, exit 1, and on `--json` a single JSON document. No error code is invented for it.

A scripted invocation that passed an empty `--generator` to `os lint --eval` now exits 1 with the reason, where it previously exited 0 having silently scored the bundled corpus instead. Every other invocation is untouched: `--eval --generator <module>` still loads the module and scores live output, `--eval` alone still scores the bundled corpus offline, and a plain project lint is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) The change narrows what one CLI flag value is accepted at invocation time. No metadata surface, stored row or spec declaration is touched, so `objectstack migrate meta` has nothing to carry and the ledger has nothing to record. -->
