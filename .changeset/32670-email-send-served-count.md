---
'@objectstack/plugin-email': patch
---

fix(plugin-email): a template name an enabled and a disabled package hold sends what it sends when only the enabled package holds it (ADR-0150 D3)

Clause-②: no
Metadata-protocol: none

While one of two packages that hold an email template name is disabled, the send (over the metadata protocol's execution list) now reads the bundle the way it reads a name one package holds: from the environment-wide list, which no longer lists a disabled package's members, its customization pair's rows or a dependent's added locales. Before, it read the enabled package's own address, which leaves out the locales its dependents add.

FROM → TO, with `B` disabled and `A` the one enabled holder: a send of a locale that both `A`'s customization pair (`A.custom`) and a dependent of `A` carry answered the pair's row, and now answers the same member a send answers when `B` holds nothing of the name (the dependent's locale). Every other answer is unchanged, and nothing changes while no holder of the name is disabled, or when the loader reads the registry's own list (no protocol registered).
