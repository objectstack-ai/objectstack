---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches the `dynamic` roll-up over a stored home amount

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/field-types.md` § Currency now says how a roll-up of a home-currency amount is drawn as money: a `sum` / `min` / `max` / `avg` `summary` over a child field that a `homeAmount.field` names declares `currencyConfig: { currencyMode: 'dynamic' }` with no `defaultCurrency`, and is then shown in the organization's home currency (`localization.currency`) instead of as a bare number. Metadata never names the home currency (ADR-0144), so the roll-up is never `fixed` with that code; `defineStack` (`os validate`, the build) refuses `dynamic` on any other roll-up, and a `count` carries no `currencyConfig`. One worked example and a matching eval case. To pay for it, two same-file restatements are cut: the `currency` row's list of `currencyConfig` keys (§ Currency spells each) and the Autonumber snippet (the `autonumber` row and the token table carry the same `CASE-{0000}` format). No schema or runtime change.
