---
'@objectstack/cli': patch
---

fix(cli): `os migrate recorded-by`, `resume` and `account-issuer` print exactly one `--json` document, and a completed run exits 0 (#21434)

Clause-②: no

`os migrate recorded-by --apply --yes --json` converted the rows, printed its result, then printed a second document, `{"error":"EEXIT: 0","duration":…}`, and exited 1. A script that read the exit status took the completed run for a failure, and a parser that read stdout failed on the second document. The cause was the command's own `catch`: the `this.exit(…)` inside its `try` throws oclif's exit signal, and the `catch` reported the signal as an error.

The same `catch` sat in three more commands:

- **`os migrate resume --run <id> --json`.** A run that was already concluded printed a second `{"error":"EEXIT: 0"}` and exited 1 instead of 0. A resumed run did the same. Every refusal inside the command (unknown run id, plan not loaded, confirmation required) printed a second `{"error":"EEXIT: 1"}` under its own document.
- **`os migrate account-issuer --json`.** A refused pre-flight printed a second `{"error":"EEXIT: 1"}` under its report. Without `--json`, it printed an extra `EEXIT: 1` error line.
- **`os migrate apply`** (text output). A `sys_account.issuer` pre-flight refusal printed an extra `EEXIT: 1` error line.

Each command now prints one document and exits with the status it computes. A completed `recorded-by --apply` and an already-concluded or resumed `resume --run` exit 0. Refusals and failed runs still exit 1. A script that worked around the second document or the exit status 1 can drop that workaround.
