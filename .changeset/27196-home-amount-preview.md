---
'@object-ui/i18n': patch
'@object-ui/fields': patch
---

feat(ui): a record-mode amount previews the home amount the save will store

Clause-②: yes (widening)
Metadata-protocol: none

While a `record`-mode amount that declares `currencyConfig.homeAmount` (ADR-0144 D5) is edited, a line under it says what the save will store in the home field: "≈ AMOUNT at RATE on DATE" for a foreign currency, or "≈ AMOUNT (home currency)" when the amount is already in the home currency. The rate is the `sys_exchange_rate` row with the latest effective date on or before the document date, read once per currency and date. The arithmetic is `@objectstack/formula`'s, the same functions the engine stores the home amount with, so the preview matches the saved number digit for digit.

With no rate in force, the line says the save is refused until one is added. With no document date, it asks for one. A member who may not read exchange rates sees that the amount is converted when they save, never "no rate" and never a guessed amount.

`@object-ui/i18n` adds five locale keys in every pack: `fields.currencyHome.preview`, `previewSame`, `awaitingRate`, `awaitingDate` and `rateUnreadable`. `@object-ui/fields` now depends on `@objectstack/formula`, which `@object-ui/core` already depends on.
