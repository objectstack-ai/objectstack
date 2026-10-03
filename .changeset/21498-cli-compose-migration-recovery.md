---
"@objectstack/cli": patch
---

`os migrate resume --run <id> --yes` can resume an interrupted `os migrate recorded-by` run, and `os serve` reports interrupted migration runs at boot (#21498)

Clause-②: no

`MigrationRecoveryPlugin` owns two things: the `migration-plans` registry, where a journal-backed migration's code is looked up, and the boot scan that reports runs which started and never finished. No CLI boot composed it. So `os migrate resume` found no plan for any run. It refused with "no loaded package registers" the plan, even though the plan's package was loaded in that process. And no `os serve`, `os start` or `os dev` boot ever scanned the migration journal.

- **The `os migrate` data commands** (`recorded-by`, `resume`, `value-shapes`, `summary-nulls`, `files-to-references`, `meta --stored`, `audit-metadata-bodies`, `os storage orphans`) now boot with the plugin. A run interrupted before any of its chunks committed now resumes to completion. A command booted over an interrupted run also warns about that run on stderr first.
- **Every `os serve` boot** (and so `os start` and `os dev`, which spawn it) composes the plugin beside `PlatformObjectsPlugin`, which registers the journal the scan reads. An interrupted run is reported once at boot, with the `os migrate resume --run <id>` command that resumes it. Nothing is resumed automatically. A database with no interrupted run prints nothing. A config that composes its own `new MigrationRecoveryPlugin()` keeps that instance.
- **A run that had committed a chunk, or that was started with a non-default `--chunk-size`,** reaches the runner too. The runner fix that lets it resume is in the `@objectstack/core` entry for #21528.
