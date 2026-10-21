---
'@objectstack/cli': minor
---

fix(cli)!: `os migrate apply` exits `1` when the confirmation it needs is not given, as every other `os migrate` subcommand with a `--yes` gate already does

In a non-interactive shell (stdin is not a terminal) or under `--json`, `os migrate apply` without `--yes` applies nothing and prints `⚠ Confirmation required. Re-run with --yes to apply, or use "os migrate plan" to preview.` (under `--json`, its `confirmation_required` document). It exited `0` there, so a deploy script or an agent reading the exit status took a run that applied nothing for an applied one, and the next boot still reported the drift. Every other `os migrate` subcommand that writes behind `--yes` — `comment-reactions --apply`, `meta --stored --apply`, `recorded-by --apply`, `resume --run` and the rest — already exits `1` in that situation, as `organization-ownership --apply` does without `--backup-taken`. `apply` now answers the same way, in both faces. The warning and the `--json` document are unchanged.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the exit status one CLI command returns when it applied nothing because the confirmation it asks for was not given; the remedy is a flag on the caller's command line (`--yes`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an exit status narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** `os migrate apply` (with or without `--allow-destructive`) on a database with changes to apply, without `--yes`, with stdin not a terminal or with `--json`: nothing applied, exit `0`.
- **TO:** nothing applied, exit `1`. The printed warning and the `--json` document (`message: 'confirmation_required'`, `hint: 'pass --yes'`) are unchanged.
- **Unchanged:** answering `n` at the `[y/N]` prompt in a terminal still prints `Aborted — no changes made.` and exits `0`; a run with `--yes` applies and exits `0`; a database with nothing to apply exits `0` without asking.
- **The fix for a script:** a script that means to apply passes `--yes` (`os migrate apply --yes`, or `os migrate apply --allow-destructive --yes`); one that only wants to know what would change runs `os migrate plan`.
