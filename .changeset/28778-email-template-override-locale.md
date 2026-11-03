---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform says an email-template override names a locale its base ships; a new locale carries no `overrides`

Clause-②: no
Metadata-protocol: none

- **Before.** The ADR-0146 customization paragraph taught that a same-named item in the paired `.custom` package with `overrides` replaces the base's item, and listed `email_template` among the honoured types, but said nothing about the locale. An email template is one item per `(name, locale)`, and the override write gate refuses a declared override of a locale the base does not ship (`declared_package_ships_no_such_item`), so an author following the skill could declare `overrides` on a locale the base never shipped and be refused.
- **Now.** One sentence in that paragraph: an email template is one item per (name, locale), an override names a locale the base ships, and a locale the base does not ship is added without `overrides`. The file stays at its token ceiling: the sentence is paid for by naming the not-yet-honoured types as the rest of `OVERRIDABLE_METADATA_TYPES` instead of enumerating them, and by dropping four filler intro clauses. No rule is removed, no frontmatter, schema or behaviour changes.
