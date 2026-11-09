---
'@objectstack/cli': patch
---

feat(cli): `os deploy` to a self-hosted runtime shows the upgrade plan before it installs: `--dry-run`, `--json`, and a confirmation on the terminal for an undeclared rename or a risky type change

Clause-②: yes (widening)
Metadata-protocol: none

Who sees it: a developer deploying to a self-hosted runtime (`os environments use-runtime`) with `os deploy`, or with the `d` key in `os dev`.

- **The plan comes first, and a plain upgrade is not interrupted.** `os deploy` already printed the runtime's upgrade plan (added and removed fields, type changes, renames declared with `renamedFrom`, suspected renames, seed datasets) before it installed. A plan with only additions and declared renames still installs with no question, so the `d` key stays one key press.
- **An undeclared rename or a risky type change stops the deploy before anything is written**, as before, and now asks on a terminal: "Deploy anyway, accepting each finding as listed?". Yes sends the same install again with the finding-set token from the runtime's refusal. Anything else deploys nothing and exits 1. The `d` key gets the same question, because it runs `os deploy` on the same terminal. Off a terminal (CI, a pipe) nothing is asked: the refusal prints both ways forward, as before. Either declare the old key in the new field's `renamedFrom` and rebuild, or run `os deploy --confirm-upgrade <token>`. There is no `--rename` flag: a rename is declared in the package.
- **`os deploy --dry-run`** builds, prints the plan and installs nothing. It also says whether the install would stop for a confirmation, using the framework's own verdict on the plan the runtime answered. The token that confirms comes only from the install's refusal.
- **`os deploy --json`** prints one JSON document on stdout: `target`, `url`, `result` (`planned`, `installed`, `refused` or `failed`), `package`, `plan`, `environment`, `wouldStop`, `refusal` (the runtime's error, verbatim), `confirm` (the command that confirms the refused findings) and `error`. Progress goes to stderr. A refusal or a failure exits non-zero.
- With ObjectOS Cloud as the target, `--dry-run` and `--json` are refused by name before anything is built or sent. This command does not read a cloud environment's plan yet.
- `os package install --dry-run` and `os deploy` print the plan and the refusal with one shared printer, so the two cannot disagree.
- For code that runs the install command in-process: `PackageInstall.outcome` (the `os package install` command class) gains a `refused` variant (`status`, `code`, `message`, `details`, and `schemaUpgrade` when the refusal is a schema upgrade stop), and it is set whenever the endpoint answers the install with a refusal (any non-zero error status; a timeout or a refused connection is not one).
