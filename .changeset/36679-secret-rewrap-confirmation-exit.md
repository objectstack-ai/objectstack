---
'@objectstack/cli': patch
---

fix(cli)!: `os secret rewrap --apply` without `--yes` in a non-interactive shell exits 1

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata, stored shape or export moves; the remedy is a flag on the caller's command line -->

**BREAKING** (an exit status narrows), shipped as `patch`: the change is not to the metadata protocol.

- **FROM:** `os secret rewrap --apply` on a database with a version-1 `sys_secret` row to re-wrap, without `--yes`, with stdin not a terminal, text face: nothing opened or written, `Aborted — no row was opened or written.`, exit `0`.
- **TO:** nothing opened or written, `Confirmation required. Re-run with --yes to re-wrap. No row was opened or written.`, exit `1`.
- **Unchanged:** answering `n` at the `[y/N]` prompt in a terminal still prints `Aborted — …` and exits `0`; `--json` without `--yes` already exited `1` with `confirmation_required`; a run with `--yes` re-wraps as before; a dry run, or an `--apply` run with nothing to re-wrap, exits `0` without asking.
- **The fix for a script:** pass `--yes` to re-wrap; drop `--apply` to get only the dry-run report.

This is the rule the `os migrate` commands and `os db orphans --delete` / `os secret orphans --delete` already follow: a run that did not get its confirmation is a refused run, so a script, CI job or cron reading `$?` never takes it for a key rotation that happened.
