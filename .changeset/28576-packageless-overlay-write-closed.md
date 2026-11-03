---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
'@objectstack/skills': patch
'@object-ui/app-shell': patch
---

fix(metadata-protocol)!: a write naming no package onto an installed package's view, dashboard, report, translation or email template is refused where `os migrate packageless-overlays` can move its row as a declared override, naming the base's `.custom` pair and the command

Clause-②: yes (narrowing) — the metadata save, publish, delete and rollback doors refuse a write that names no package onto an item of the five overlay types that one installed read-only package ships, where the ceremony would classify the row (or the first write's body) `movable` and its move as a declared override can succeed; they accepted it before as a package-unbound Setup row. Every row the ceremony lists and does not move keeps that write. One write is widened: a rollback of the `.custom` pair's own declared row of an item its base ships (#28644 item 1) is judged as the pair's declared override, where the store sealed it as an artifact override before, on every type the pair can override (a page or flow pair row included).

Metadata-protocol: narrowed (the `allowEnvironmentOverlay` flag of `view`, `dashboard`, `report`, `translation` and `email_template` no longer opens a package-less write onto a packaged item the ceremony can move as a declared override; it stays the predicate the migration ceremony, the read of an unmigrated row and every row the ceremony leaves use)

Skills-docs: updated here — `skills/objectstack-platform/SKILL.md`'s ADR-0146 paragraph said "a package-unbound Setup row still wins over the base's until D11"; it now says such a row from before D11 wins over the base's until `os migrate packageless-overlays` moves it, and that its package-less save, reset and rollback are refused once the command can move it. To stay under the bundle's token ceiling, the same paragraph drops "the base's is unchanged" after the export sentence (which "replaces the base's document whole" already implies) and the aside that the other overridable types wait for their doors (the sentence already names the six types the read honours today).

<!-- adr-0087: registered packageless-overlay-write-closed -->

**BREAKING** write narrowing at the metadata doors (`@objectstack/metadata-protocol`), shipped as `minor` during the launch window.

**Upgrade, then run the ceremony.** The command ships in this release. On each deployment with Setup customizations of a package's items, upgrade, run `os migrate packageless-overlays` (preview) with the flags and environment the deployment boots with (`--preset` and `--dev` mean what they mean to `os serve`), then `os migrate packageless-overlays --apply`. Nothing breaks at the upgrade: between the upgrade and `--apply`, every customization is served as before, and the package-less save, reset, publish and rollback of one the command moves as a declared override are refused, naming the command (one it moves as the pair's own member keeps that write, see `movable` below). Done when the preview lists no movable row.

The preview lists five dispositions; only `movable` rows are moved, and every other row keeps its package-less write:

- `movable`: `--apply` moves it into the pair, as the base's declared override (outcome `moved` with its `basedOn`). A row of an `email_template` locale the base does not ship (the preview lists it as the pair's own member; `--json` carries it as `addedMember`) moves instead as the pair's own member at that locale, declaring nothing (outcome `moved` with that `addedMember` in place of a `basedOn`), since a declared override of a locale the base does not ship is refused; its package-less write stays open, before and after the move. A move that ends `failed` keeps the row as it was; fix what the error names and re-run. When the error names the pair (it cannot be ensured, or it refuses the row) or, for a declared override, the base's missing version, the row also keeps its package-less write and may be left.
- `multi_shipped` (several packages ship the name): delete it naming no package, then save it into the pair of the package it customizes if it is still wanted (the pair's override is then served at that base's address, `?package=<base>`; a read naming no package is not pinned to it while several packages ship the name).
- `no_pair` (the base's id forms no pair): nothing to do.
- `foreign_declaration` (its `overrides` names another package): remove the key with a save naming no package, then re-run: the move declares the right override. (A package-less save that keeps a corrected `overrides` is refused by the override write gate.)
- `shadowed` (the pair already holds the item; the pair's row is served when it declares the override, otherwise this row still is): nothing to do to keep the pair's declared override; or restore the package original (`DELETE …?package=<base>.custom`) and re-run to move this one.

### Migration: FROM → TO

FROM, a customization of the installed package `com.acme.crm`'s view written with no package:

```http
PUT /api/v1/meta/view/account_list
{ "name": "account_list", "label": "My accounts" }
```

TO, the same customization written into the base's paired `.custom`, declaring what it overrides:

```http
PUT /api/v1/meta/view/account_list?package=com.acme.crm.custom
{ "name": "account_list", "label": "My accounts", "overrides": { "package": "com.acme.crm", "basedOn": "1.4.0" } }
```

To restore the package original, FROM `DELETE /api/v1/meta/view/account_list` TO `DELETE /api/v1/meta/view/account_list?package=com.acme.crm.custom`. `basedOn` is the base's installed `manifest.version`. The pair is created by `os migrate packageless-overlays --apply`, or by Studio's Customize. A locale of an email template the base does not ship is the pair's own member, not an override: write it into the pair with no `overrides` (one declaring the base is refused), and `DELETE …?package=<base>.custom&member=<locale>` removes it (with no `member`, the delete addresses the canonical locale).

- **Now refused.** A save (draft or publish mode), a publish, a delete of the active item, or a rollback whose restored row is package-less, with no `?package=` (or an empty one), of a `view`, `dashboard`, `report`, `translation` or `email_template` that exactly one installed read-only package ships, where the item's stored package-less row in that state (or, with none, the saved body) is one the ceremony classifies `movable`, the pair can be ensured (the base has a namespace and a SemVer version), and the override write gate admits that row, declared as the base's override, into the pair (so not an `email_template` locale the base does not ship: see **Still open**). This covers an unmigrated `movable` row, and the first package-less write of an item the pair already holds (a moved one). Each answers `403 NOT_OVERRIDABLE`, writes nothing, and its message names the item, the shipping package, the pair (`?package=<base>.custom`), the `overrides` declaration and `os migrate packageless-overlays`; a rollback's message says to save a version from before the move into the pair, declaring it. The metadata item page shows that message as sent when its URL holds no `?package=`. The refusal comes before every gate that reads a stored row's lock, so it is the same with or without `overrides` in the body.
- **Still open.** Every write naming `?package=<base>.custom` (the pair's save, publish, delete and rollback, judged by the override write gate as before); a rollback of the pair's own declared row, which is judged as the pair's override; a write of a name no installed package ships (environment metadata); and every package-less write the ceremony would not move, as before this release: a name several read-only packages ship (`multi_shipped`); a base whose id forms no pair (`no_pair`); a base whose pair cannot be ensured (no namespace, or a version that is not SemVer); a stored package-less row whose `overrides` names another package (`foreign_declaration`) or beside the pair's row of the item (`shadowed`; its package-less writes are addressed to the pair's row as before, so its package-less delete restores the package original). Every package-less write of an `email_template` locale the base does not ship stays open too, before and after the ceremony moves its row as the pair's own member (#28904): the close judges only the declared-override move, and the override write gate refuses a declared override of that locale (#28777). Discarding a draft stays open.
- **Unchanged.** A package-less row stored before this release is still served exactly as before, by every read. The ceremony still moves it: it writes into the pair, never package-less.
- **Studio.** The read-only item notice no longer links to the package-less Setup overlay (`@object-ui/app-shell`).
- **Removed with it.** #28413's interim allowance, by which a package-less save that landed on a moved row kept that row's `overrides` block, is gone: such a save is refused like any other.
