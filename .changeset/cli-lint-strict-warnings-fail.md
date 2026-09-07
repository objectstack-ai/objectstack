---
"@objectstack/cli": minor
---

`os lint --strict` makes warning-severity findings fail the run, so an app can rely on the platform's warning-level rules as its gate instead of re-implementing them locally (#15935)

Only an `error` failed `os lint` before. `packages/lint` ships ≈250 authoring rules, 119 of them at `warning`, and a run with any number of warnings and no errors exited 0 — so an app that wanted one of those rules to gate its CI had to re-implement it locally at error level, or bolt a script onto the JSON output to promote a family by hand.

New public flag: **`os lint --strict`**. With it, a run with one or more `warning`-severity findings exits 1 exactly as an `error` does, and the console says why, naming the count and the flag:

```
✗ 1 warning(s) fail this run under --strict (a warning is advisory without the flag)
```

`suggestion`s stay advisory under both. ⛔ The default is unchanged: without the flag the same stack still exits 0, and no existing `os lint` expectation moves.

The `--json` face carries the verdict so a gate can read it without re-deriving it from the counts. Two keys, unconditionally present on every project-lint payload, flag or no flag:

```json
{ "passed": false, "errors": 0, "warnings": 1, "suggestions": 0, "strict": true, "failing": 1 }
```

`strict` says whether the flag was in effect; `failing` is the count the exit code was read from — `errors`, or `errors + warnings` under `--strict`; and `passed` is `failing === 0`, the same statement the exit code makes — so `--strict --json` on a warning-only stack reads `passed: false` beside exit 1, never `passed: true` next to a failing exit.

Not in this change: per-rule severity configuration, any change to a rule's severity, and `--eval` mode, which keeps its own pass bar (`--eval-min`).
