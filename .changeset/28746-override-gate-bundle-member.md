---
'@objectstack/metadata-protocol': minor
'@objectstack/cloud-connection': minor
---

fix(metadata-protocol)!: the override write gate judges an email template by its locale, so a `<base>.custom` override of a locale the base does not ship is refused (#28746)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: the override write gate (ADR-0146 D2) now counts the packages that ship an email template at the bundle member the body addresses, as the read side already serves it. A stored row this gate would refuse is not converted: it is served as before, and its next save meets the gate's own refusal with its remedy (drop `overrides`). -->

**BREAKING** accept-set narrowing at the override write gate, with one widening beside it. An email template is one item per `(name, locale)` (`ITEM_KEY_DISCRIMINATORS`), but the gate asked which packages of the closure ship the template's NAME, across every locale.

- **Narrowed.** A `<base>.custom` pair declaring `overrides: { package: <base> }` on a locale the base does not ship is refused `403 NOT_OVERRIDABLE` (`declared_package_ships_no_such_item`, the sentence now naming the locale) at the save door, at the per-item publish (`?member=`) and at a package publish, by `os validate` / `os build`, and at `POST /api/v1/marketplace/install-local`. It was admitted and served as an override, with no base member for drift detection or "Restore package original" to compare against. The remedy is in the sentence: remove `overrides` to keep it as the pair's own locale.
- **Widened.** A locale the base does not ship, saved in the pair WITHOUT `overrides`, is the pair's own new member and is admitted at the same doors. It was refused `undeclared_same_name`, which told the author to declare an override of a member that does not exist. The same holds for a dependent package's template of a name its base ships in another locale: it collides with no base member.
- **Unchanged.** A declared override of a locale the base ships is admitted; an undeclared same-locale item is still refused `undeclared_same_name`; every other type's identity is its name alone, as before; the read side already served per member.
- **At rest.** A pair row stored before this release that declares an override of an unshipped locale keeps being served. Its next save carrying `overrides` is refused with the remedy; saved without `overrides`, it is the pair's own locale.

`@objectstack/metadata-protocol` exports `overrideWriteIdentityOf(type, identity, item)`, the one identity the gate's callers compare shipped and incoming items on: an item's name (an action's `<objectName>:<name>`), joined with its bundle member for a pair-identified type. `OverrideWriteItem.identity` (from `overrideWriteItemsOf`) is spelled through it, so an email template's identity now carries its locale.
