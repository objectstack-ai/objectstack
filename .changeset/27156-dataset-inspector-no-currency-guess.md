---
'@object-ui/i18n': patch
---

fix(studio): the dataset inspector stores no guessed measure currency

Clause-②: no
Metadata-protocol: none

Picking the "Currency" display format for a dataset measure with no currency chosen used to store `currency: 'USD'`, and the currency picker pre-selected USD. A measure's own `currency` outranks the source field's fixed currency and the tenant default, so a measure saved that way showed `$` on a tenant whose default is another currency. The inspector now guesses nothing:

- **Over a `currency` field** the picker opens on "Inherit — field or organization default" and the saved measure carries no `currency` key, so it resolves the field's fixed currency, then the tenant default. A numeral format with no code over such a field reads back as Currency · inherit.
- **Over any other field** there is nothing to inherit, so the picker offers no inherit row and asks for a code; the format kind stays Currency until one is picked.
- **A stored `currency`**, `'USD'` included, is explicit authoring and is left as written: no migration, no rewrite on load.

`@object-ui/i18n` gains `engine.inspector.dataset.currencyInherit` and `engine.inspector.dataset.currencyChoose` in the studio namespace (en, zh).
