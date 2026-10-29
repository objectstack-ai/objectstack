---
'@objectstack/types': patch
'@object-ui/console': patch
---

fix(types, console): a shared `record`-mode currency amount shows its record's own currency (ADR-0144 D2, D9)

Clause-②: no
Metadata-protocol: none

The share-link resolve answer's field projection (`buildShareLinkResolveAnswer`, `@objectstack/types`) carried a currency field's `currencyMode` and `defaultCurrency` only, so a shared `record`-mode amount, whose currency lives in a sibling code field, rendered as a plain number. A currency field's projected `currencyConfig` now also carries `currencyField`, the amount's code-field pointer, when the answer's `record` carries that code field. A link that redacts the code field gets neither the code nor the pointer, so the answer still describes nothing the record hides, and the amount shows as a plain number.

The shared-record page hands the shared record to the currency face, which reads the code from it, so the amount shows in the currency its own record names. Every other field and every other key of the answer is unchanged.

⛔ Not released alone: this ships in the same release as `currencyMode: 'record'` itself.
