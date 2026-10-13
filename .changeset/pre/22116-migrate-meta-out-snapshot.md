---
"@objectstack/cli": patch
---

fix(cli): `os migrate meta --out FILE` writes its snapshot on a range that crosses no step (#22116)

Clause-②: no

`os migrate meta --from 18 --to 18 --out FILE` exited 0, printed no snapshot line and wrote no `FILE`. The same command with `--json` wrote `FILE`. The human report returned early on a run with nothing to migrate, and that return came before the `--out` write. An operator or a CI step that keeps `FILE` as the record of the run then found no file, or read an earlier run's file as this one's.

- The human mode now writes `FILE` and prints the line that names it on every run. On a run with nothing to migrate, the line comes after the range answer, before `--write`'s outcome and the data migrations, the same order as on every other run.
- The bytes are the ones `--json` writes for the same run: the stack the chain returned, which for a range with no step is the stack as loaded.
- The fix sits in the branch both "nothing to migrate" answers share. A range with steps that applies and lists nothing takes the same branch, but no range reaches it on this build, because every major carries semantic notices and the chain lists them all.
- Unchanged: the `--json` mode, `--write`, `--stored` and the chain. A range with steps writes `FILE` exactly as before.
