---
'@objectstack/cli': patch
---

fix(cli): `os db orphans --delete` and `os secret orphans --delete` without `--yes` in a non-interactive shell exit 1

Clause-②: no
Metadata-protocol: none

Run where stdin is not a terminal (a script, a CI job, a cron) and without `--yes`, both commands printed `Aborted — no export was written and no row was deleted.` and exited 0, so a caller reading `$?` took a run that deleted nothing for one that did. They now print `Confirmation required. Re-run with --yes to delete. No export was written and no row was deleted.` and exit 1, the rule the `os migrate` family already follows. What either command exports or deletes is unchanged, and nothing is exported or deleted on this path, as before.

An operator who answers `n` at the interactive prompt still sees `Aborted — …` and exit 0: a decline is a choice, not a failed run. The `--json` face already answered exit 1 with `confirmation_required` and is unchanged.

A script that ran either command with `--delete` and no `--yes`, and relied on exit 0, should pass `--yes` (it deleted nothing before either).
