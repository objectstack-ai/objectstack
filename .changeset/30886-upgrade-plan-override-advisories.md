---
'@objectstack/objectql': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat(objectql): the package upgrade plan lists, as advice, each `.custom` override that hides a change of the upgrade, and each override already stale

Clause-②: yes (widening)
Metadata-protocol: none

Who sees it: whoever previews a base package upgrade before it runs — `os package install … --dry-run` (the install-local door's `dryRun: true`) and a hosted upgrade preview that reads the `manifest` service's `planUpgrade`.

The plan's environment reading gains an advisory class, `environment.overrides` (ADR-0146 D2, as amended): for every base package the upgrade replaces, each item of its paired `<base>.custom` package that the reads serve over a base item (the protocol's served-override list) is read against the installed and the incoming version of the base.

- `hidesChange`: the base's item differs between the two versions (`change: 'changed'`), the new version no longer ships it (`'removed'`), or now ships it (`'added'`). The override keeps being served, so it hides that change.
- `stale`: the override's `basedOn` is not the installed base version.

Each finding names the type, the name, the bundle member where the type has one, `basedOn`, the installed and the incoming base version, and the next step in Studio: open the item, compare, re-base it, or restore the package original. Advice only: nothing is refused on it, no confirmation token covers it, and nothing is merged or rebased; the upgrade installs exactly as before. `null` means the overrides could not be read (no protocol service, or the read failed), never "none". `os package install --dry-run` prints both lists after the schema plan.

The `overrides.basedOn` description (`@objectstack/spec`, and the generated reference pages) no longer says no upgrade diff reads it: it never gates, and the upgrade plan reads it as advice.
