---
'@objectstack/cli': patch
---

fix(cli)!: `os db orphans --delete` and `os secret orphans --delete` exit `1` when the confirmation they need is not given, as every `os migrate` subcommand with a `--yes` gate already does

Clause-②: no (narrowing)
Metadata-protocol: none

In a non-interactive shell (stdin is not a terminal), `--delete` without `--yes` deletes nothing and writes no export. Both commands printed `Aborted — no export was written and no row was deleted.` there and exited `0`, so a script, a CI job or a cron reading the exit status took a run that deleted nothing for one that did. They now print `Confirmation required. Re-run with --yes to delete. No export was written and no row was deleted.` and exit `1`, the rule the `os migrate` family follows. What either command exports or deletes is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the exit status two CLI commands return when they deleted nothing because the confirmation they ask for was not given; the remedy is a flag on the caller's command line (`--yes`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an exit status narrows), shipped as `patch`: the change is not to the metadata protocol (`Metadata-protocol: none`).

- **FROM:** `os db orphans --delete --export PATH` or `os secret orphans --delete --export PATH` on a database with rows to delete, without `--yes`, with stdin not a terminal, text face: nothing exported or deleted, `Aborted — …`, exit `0`.
- **TO:** nothing exported or deleted, `Confirmation required. Re-run with --yes to delete. No export was written and no row was deleted.`, exit `1`.
- **Unchanged:** answering `n` at the `[y/N]` prompt in a terminal still prints `Aborted — no export was written and no row was deleted.` and exits `0`; `--json` without `--yes` already exited `1` with `confirmation_required`; a run with `--yes` deletes as before; a run with nothing to delete exits `0` without asking.
- **The fix for a script:** a script that means to delete passes `--yes` (`os db orphans --delete --export PATH --yes`); one that only wants the report drops `--delete`.
