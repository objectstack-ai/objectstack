---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta --stored` no longer tells the operator that a row it could not rewrite is fine; a flow the engine refuses is named as not registered at boot

Clause-②: no

The closing line of a `--stored` run (human output, not `--json`) that reports `failed` rows said every one of them was fine. That is false for two of the pass's four failed kinds. A stored body that is not valid JSON does not load at all. A flow that does not canonicalize fails the same parse in `AutomationEngine.registerFlow`, so it is not registered at boot and does not run.

FROM: "N row(s) could not be rewritten. They keep reading canonically through the chain, so nothing is broken — but their stored bytes stay legacy until the reason above is fixed."

TO: "N row(s) could not be rewritten. Each stays as stored, and reads as it did before this run, until the reason printed beside it is fixed. That does not mean it works: a row whose stored body is not valid JSON does not load at all, and a flow whose reason says it does not canonicalize is refused by the engine at boot as well, so it is not registered and does not run."

The flow sentence is printed only when a failed row is a flow. The report, its row reasons, the exit code (1) and the `--json` payload are unchanged.
