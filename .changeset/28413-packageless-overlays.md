---
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
---

feat(cli,metadata-protocol): `os migrate packageless-overlays` moves package-less Setup customizations of a package's view, dashboard, report, translation or email template into its paired `.custom` package as declared overrides

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — the one taught line this touches, `skills/objectstack-platform/SKILL.md`'s "a package-unbound Setup row still wins over the base's until D11", stays true: the ceremony moves such rows when an operator runs it, and the package-less write that makes new ones stays open until #28576, which is the change that retires that line. No file under `skills/**` teaches the `os migrate` operator ceremonies (a `git grep` of `skills/` for `packageless` and `security-catalog-overlays` names nothing).

**The one operator step of this release.** After upgrading, run `os migrate packageless-overlays` once (preview), then `os migrate packageless-overlays --apply`, on each deployment that has Setup customizations. Until it runs, those customizations are still served, but they stay rows of no package: they are not exported and do not reach another environment.

- **What moves.** Every `sys_metadata` row bound to no package, of the five overlay types (`view`, `dashboard`, `report`, `translation`, `email_template`, active or draft), over a name exactly one installed read-only package ships. It moves into that package's paired `<base>.custom` — created through the ensure door when absent and persisted to `sys_packages` — with `overrides: { package: <base>, basedOn: <the base's installed version> }` in its body, saved through the metadata save door in its own state. The new row is read back as the served override, and only then is the package-less row deleted (with its history tombstone). Every read of the name serves the same content as before. A second run moves nothing.
- **What is left alone, and listed.** A name several packages ship; a row whose body already declares an override of another package; and a row the pair already overrides (a customization made in Studio first — the report names the two ways out: delete the package-less row, or "Restore package original" in Studio and re-run). A name no package ships is environment metadata and is not touched. Permission sets and positions are not overlay types; `os migrate security-catalog-overlays` is theirs.
- **Declarations missing `basedOn`.** A row of a pair that declares `overrides: { package }` with no `basedOn` is read as an override but refused on its next save. The same command records `basedOn` (the base's installed version) on it.
- **Setup keeps working on a moved item.** Until the package-less write closes, a save that names no package and lands on a moved row (Setup's form save and reset) keeps that row's `overrides` block when the body carries none, and is judged as the write into the pair when the body carries one — so it is no longer refused `403 NOT_OVERRIDABLE`. A package-less delete removes the pair's row, and the package's own document is served again.
- **Flags.** `--apply` (with `--yes` or the prompt), `--json`, `--force` past a busy SQLite file, `--database-url`, and `serve`'s `--preset` / `--dev`. The command is the operator's; the HTTP door that creates a pair keeps its walled refusal.

`ObjectStackProtocolImplementation` gains `listPackagelessOverlays()` and `migratePackagelessOverlays({ actor })`.
