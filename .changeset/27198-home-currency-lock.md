---
'@objectstack/service-settings': patch
---

feat(service-settings): the default currency (`localization.currency`) is locked once an exchange rate or a home-currency amount uses it, and the Localization page names what uses it (ADR-0144 D4)

Clause-②: yes (widening)
Metadata-protocol: none

⛔ Not released alone: this ships in the same release as the exchange-rate table and the home-currency amount it guards (ADR-0144 D9, release R2).

The organization's default currency is its home currency: exchange rates are entered against it, and home-currency amounts are converted into it and stored. Changing it afterwards would relabel every amount already converted. So:

- **The save is refused once the currency is used.** A change to a set default currency, to another code or to empty, is refused with `400 SETTINGS_VALIDATION` while the organization holds any exchange rate row, or any object declares `currencyConfig.homeAmount` on a field. The refusal sits on the `currency` field (`invalid_value`), names what uses it ("in use by 2 objects (Invoice, Order) and 14 exchange rates"), and carries the same facts as `constraint: { lockedBy: 'in_use', objects, exchangeRates }`. Re-saving the value in force is never refused, so the rest of the page still saves.
- **Choosing a first currency is never blocked.** While the currency is unset, nothing has been converted into it, so the first save passes; the page then asks for one.
- **The page says so.** Settings → Localization opens with a banner naming the lock and what uses the currency, or a warning while it is unset and already needed, in English, 简体中文, 日本語 or Español, following the request's language.
- **It lifts by itself** once the last exchange rate row is deleted and the last `homeAmount` declaration is removed. Nothing is recorded at boot; every save and every page read asks the engine.

New for packages that own state a setting depends on: `SettingsService.registerWritePredicate(namespace, key, predicate)`, a rule over engine state asked when a write changes that key. A refusal refuses the whole batch before any row is written. Exported with its types `SettingsWritePredicate`, `SettingsWritePredicateInput`, `SettingsWriteRefusal` and `SettingsDisplayOptions` (the display language `setMany` and `liveStatusOf` now accept beside the caller's context).
